"""
Monitoring Agent — anomaly detection.

Analyzes incoming metric snapshots to detect anomalies using
statistical thresholds + LLM reasoning for context-aware detection.
"""

import datetime
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from app.config import OPENAI_API_KEY, OPENAI_MODEL, AGENT_TEMPERATURE

MONITORING_SYSTEM_PROMPT = """\
You are the Monitoring Agent in an enterprise IT Operations platform.
Your role is to analyze infrastructure metrics and detect anomalies.

Given a set of metric values for a node, determine:
1. Whether any metric is anomalous (outside healthy thresholds).
2. The anomaly type (cpu_spike, memory_leak, disk_full, network_saturation,
   connection_pool_exhaustion, cascading_failure, latency_degradation, error_spike).
3. Severity: low / medium / high / critical.
4. A brief description of what you observe.

Healthy thresholds:
- CPU: < 75% normal, 75-85% warning, 85-95% high, >95% critical
- Memory: < 70% normal, 70-85% warning, 85-95% high, >95% critical
- Disk: < 80% normal, 80-90% warning, >90% critical
- Error Rate: < 2% normal, 2-5% warning, 5-15% high, >15% critical
- Latency: < 100ms normal, 100-500ms warning, 500-2000ms high, >2000ms critical
- Network In: < 800 Mbps normal, >800 warning, >950 critical

Respond in this exact JSON format (no markdown):
{{"is_anomaly": true/false, "anomaly_type": "...", "severity": "low|medium|high|critical", "description": "...", "affected_metrics": ["metric1", "metric2"]}}

If no anomaly is detected, respond:
{{"is_anomaly": false, "anomaly_type": null, "severity": null, "description": "All metrics within normal range", "affected_metrics": []}}
"""

MONITORING_HUMAN_PROMPT = """\
Node: {node_name} (Type: {node_type}, Provider: {provider}, Region: {region})
Timestamp: {timestamp}

Current Metrics:
- CPU: {cpu_percent}%
- Memory: {memory_percent}%
- Disk: {disk_percent}%
- Network In: {network_in_mbps} Mbps
- Network Out: {network_out_mbps} Mbps
- Request Rate: {request_rate} req/s
- Error Rate: {error_rate}%
- Latency: {latency_ms} ms

Analyze these metrics for anomalies.
"""

_llm = None


def _get_llm():
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            model=OPENAI_MODEL,
            temperature=AGENT_TEMPERATURE,
            api_key=OPENAI_API_KEY,
        )
    return _llm


def build_monitoring_chain():
    prompt = ChatPromptTemplate.from_messages([
        ("system", MONITORING_SYSTEM_PROMPT),
        ("human", MONITORING_HUMAN_PROMPT),
    ])
    return prompt | _get_llm()


# ── Statistical pre-filter (fast path before LLM) ──────────────────

THRESHOLDS = {
    "cpu_percent": {"warning": 75, "high": 85, "critical": 95},
    "memory_percent": {"warning": 70, "high": 85, "critical": 95},
    "disk_percent": {"warning": 80, "high": 90, "critical": 95},
    "error_rate": {"warning": 2, "high": 5, "critical": 15},
    "latency_ms": {"warning": 100, "high": 500, "critical": 2000},
    "network_in_mbps": {"warning": 800, "high": 900, "critical": 950},
}


def statistical_anomaly_check(metrics: dict) -> dict:
    """Fast threshold-based anomaly check. Returns anomaly details or None."""
    anomalies = []
    max_severity = "low"
    severity_rank = {"low": 0, "warning": 1, "medium": 1, "high": 2, "critical": 3}

    for metric_key, thresholds in THRESHOLDS.items():
        value = metrics.get(metric_key, 0)
        for level in ["critical", "high", "warning"]:
            if value >= thresholds[level]:
                sev = "critical" if level == "critical" else ("high" if level == "high" else "medium")
                anomalies.append({"metric": metric_key, "value": value, "severity": sev})
                if severity_rank.get(sev, 0) > severity_rank.get(max_severity, 0):
                    max_severity = sev
                break

    if not anomalies:
        return {"is_anomaly": False}

    return {
        "is_anomaly": True,
        "anomalies": anomalies,
        "max_severity": max_severity,
    }


async def analyze_metrics(metrics: dict) -> dict:
    """
    Two-stage anomaly detection:
    1. Statistical pre-filter (fast, no LLM call).
    2. LLM analysis for context + anomaly classification (only if pre-filter triggers).
    """
    stat_result = statistical_anomaly_check(metrics)
    if not stat_result["is_anomaly"]:
        return {
            "is_anomaly": False,
            "anomaly_type": None,
            "severity": None,
            "description": "All metrics within normal range.",
            "affected_metrics": [],
            "agent": "monitoring",
        }

    # LLM analysis for richer context
    import json
    chain = build_monitoring_chain()
    response = await chain.ainvoke({
        "node_name": metrics.get("node_name", "unknown"),
        "node_type": metrics.get("node_type", "server"),
        "provider": metrics.get("provider", "simulated"),
        "region": metrics.get("region", "unknown"),
        "timestamp": metrics.get("timestamp", datetime.datetime.utcnow().isoformat()),
        "cpu_percent": metrics.get("cpu_percent", 0),
        "memory_percent": metrics.get("memory_percent", 0),
        "disk_percent": metrics.get("disk_percent", 0),
        "network_in_mbps": metrics.get("network_in_mbps", 0),
        "network_out_mbps": metrics.get("network_out_mbps", 0),
        "request_rate": metrics.get("request_rate", 0),
        "error_rate": metrics.get("error_rate", 0),
        "latency_ms": metrics.get("latency_ms", 0),
    })

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        # Fallback to statistical result
        result = {
            "is_anomaly": True,
            "anomaly_type": "threshold_breach",
            "severity": stat_result["max_severity"],
            "description": f"Threshold breaches detected: {stat_result['anomalies']}",
            "affected_metrics": [a["metric"] for a in stat_result["anomalies"]],
        }

    result["agent"] = "monitoring"
    result["statistical_check"] = stat_result
    return result
