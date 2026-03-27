"""
Predictive Agent — failure forecasting.

Uses LLM reasoning over recent metric trends to predict impending
failures and estimate time-to-failure. In production, this would
be augmented with LSTM/Transformer models; here we use the LLM's
pattern recognition for a working demo.
"""

import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from app.config import OPENAI_API_KEY, OPENAI_MODEL, AGENT_TEMPERATURE

PREDICTIVE_SYSTEM_PROMPT = """\
You are the Predictive Intelligence Agent in an enterprise AIOps platform.
Your role is to analyze current anomaly data and recent metric trends to
predict the trajectory of the issue.

Given:
- Current anomaly details (type, severity, affected metrics)
- The node's recent metric history (last several readings)
- Node type and configuration

Predict:
1. failure_probability: 0.0-1.0 chance this leads to a full outage within 30 minutes.
2. predicted_impact: What will break if this continues unchecked.
3. escalation_risk: Will this cascade to other services? (low / medium / high)
4. estimated_time_to_failure: Minutes until critical failure (null if unlikely).
5. recommended_urgency: immediate / soon / monitor
6. reasoning: Brief explanation of your prediction logic.

Respond in this exact JSON format (no markdown):
{{"failure_probability": 0.0, "predicted_impact": "...", "escalation_risk": "low|medium|high", "estimated_time_to_failure": null, "recommended_urgency": "monitor|soon|immediate", "reasoning": "..."}}
"""

PREDICTIVE_HUMAN_PROMPT = """\
Node: {node_name} (Type: {node_type})

Current Anomaly:
- Type: {anomaly_type}
- Severity: {severity}
- Description: {anomaly_description}
- Affected Metrics: {affected_metrics}

Current Metric Values:
- CPU: {cpu_percent}%
- Memory: {memory_percent}%
- Disk: {disk_percent}%
- Error Rate: {error_rate}%
- Latency: {latency_ms}ms
- Network In: {network_in_mbps} Mbps

Recent Trend (last readings):
{metric_history}

Predict the trajectory of this issue.
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


def build_predictive_chain():
    prompt = ChatPromptTemplate.from_messages([
        ("system", PREDICTIVE_SYSTEM_PROMPT),
        ("human", PREDICTIVE_HUMAN_PROMPT),
    ])
    return prompt | _get_llm()


async def predict_failure(anomaly_data: dict, metrics: dict, metric_history: str = "No history available") -> dict:
    """Predict failure trajectory based on anomaly + trends."""
    chain = build_predictive_chain()

    response = await chain.ainvoke({
        "node_name": metrics.get("node_name", "unknown"),
        "node_type": metrics.get("node_type", "server"),
        "anomaly_type": anomaly_data.get("anomaly_type", "unknown"),
        "severity": anomaly_data.get("severity", "medium"),
        "anomaly_description": anomaly_data.get("description", ""),
        "affected_metrics": ", ".join(anomaly_data.get("affected_metrics", [])),
        "cpu_percent": metrics.get("cpu_percent", 0),
        "memory_percent": metrics.get("memory_percent", 0),
        "disk_percent": metrics.get("disk_percent", 0),
        "error_rate": metrics.get("error_rate", 0),
        "latency_ms": metrics.get("latency_ms", 0),
        "network_in_mbps": metrics.get("network_in_mbps", 0),
        "metric_history": metric_history,
    })

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {
            "failure_probability": 0.5,
            "predicted_impact": "Unable to parse prediction — treating as moderate risk.",
            "escalation_risk": "medium",
            "estimated_time_to_failure": None,
            "recommended_urgency": "soon",
            "reasoning": response.content[:500],
        }

    result["agent"] = "predictive"
    return result
