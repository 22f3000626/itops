"""
Diagnostic Agent — root cause analysis.

Performs causal reasoning to identify the root cause of detected anomalies.
Uses RAG from institutional memory to find similar past incidents and
their proven root causes.
"""

import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from app.config import OPENAI_API_KEY, OPENAI_MODEL, AGENT_TEMPERATURE
from app.memory.vector_store import get_memory

DIAGNOSTIC_SYSTEM_PROMPT = """\
You are the Diagnostic Agent (Root Cause Analyst) in an enterprise AIOps platform.
Your role is to perform root cause analysis on infrastructure anomalies.

You have access to:
1. Current anomaly details and metric values.
2. Prediction data (failure probability, escalation risk).
3. Similar past incidents from the institutional memory (RAG).

Your job:
1. Identify the most likely root cause.
2. Explain the causal chain (what led to what).
3. Assess the blast radius (which other services could be affected).
4. Determine if this requires human intervention or can be auto-remediated.
5. Recommend specific remediation actions.

Respond in this exact JSON format (no markdown):
{{
  "root_cause": "...",
  "causal_chain": ["cause1 -> effect1", "effect1 -> effect2"],
  "blast_radius": ["service1", "service2"],
  "blast_radius_severity": "low|medium|high",
  "requires_human_approval": true/false,
  "confidence": 0.0-1.0,
  "recommended_actions": [
    {{"action": "...", "type": "restart_service|scale_up|clear_disk|rate_limit|failover|config_change|rollback", "priority": 1, "description": "..."}}
  ],
  "similar_past_incidents": "summary of relevant past incidents if any",
  "reasoning": "..."
}}
"""

DIAGNOSTIC_HUMAN_PROMPT = """\
Node: {node_name} (Type: {node_type}, Provider: {provider})

Anomaly Details:
- Type: {anomaly_type}
- Severity: {severity}
- Description: {anomaly_description}
- Affected Metrics: {affected_metrics}

Prediction:
- Failure Probability: {failure_probability}
- Estimated Time to Failure: {time_to_failure}
- Escalation Risk: {escalation_risk}
- Predicted Impact: {predicted_impact}

Current Metrics:
- CPU: {cpu_percent}%, Memory: {memory_percent}%, Disk: {disk_percent}%
- Error Rate: {error_rate}%, Latency: {latency_ms}ms
- Network In/Out: {network_in_mbps}/{network_out_mbps} Mbps

Similar Past Incidents from Memory:
{past_incidents}

Perform root cause analysis and recommend remediation.
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


def build_diagnostic_chain():
    prompt = ChatPromptTemplate.from_messages([
        ("system", DIAGNOSTIC_SYSTEM_PROMPT),
        ("human", DIAGNOSTIC_HUMAN_PROMPT),
    ])
    return prompt | _get_llm()


async def diagnose(anomaly_data: dict, prediction_data: dict, metrics: dict) -> dict:
    """
    Root cause analysis using LLM + RAG from institutional memory.
    """
    # RAG: search similar past incidents
    memory = get_memory()
    query = (
        f"{anomaly_data.get('anomaly_type', '')} on {metrics.get('node_type', 'server')} "
        f"- {anomaly_data.get('description', '')}"
    )
    similar = memory.search_similar_incidents(query, n_results=3)
    runbooks = memory.search_runbooks(query, n_results=2)

    past_context = "No similar past incidents found."
    if similar:
        entries = []
        for s in similar:
            entries.append(f"- {s['document'][:300]}")
        past_context = "\n".join(entries)

    if runbooks:
        past_context += "\n\nRelevant Runbooks:\n"
        for r in runbooks:
            past_context += f"- {r['document'][:300]}\n"

    chain = build_diagnostic_chain()
    response = await chain.ainvoke({
        "node_name": metrics.get("node_name", "unknown"),
        "node_type": metrics.get("node_type", "server"),
        "provider": metrics.get("provider", "simulated"),
        "anomaly_type": anomaly_data.get("anomaly_type", "unknown"),
        "severity": anomaly_data.get("severity", "medium"),
        "anomaly_description": anomaly_data.get("description", ""),
        "affected_metrics": ", ".join(anomaly_data.get("affected_metrics", [])),
        "failure_probability": prediction_data.get("failure_probability", 0),
        "time_to_failure": prediction_data.get("estimated_time_to_failure", "unknown"),
        "escalation_risk": prediction_data.get("escalation_risk", "unknown"),
        "predicted_impact": prediction_data.get("predicted_impact", "unknown"),
        "cpu_percent": metrics.get("cpu_percent", 0),
        "memory_percent": metrics.get("memory_percent", 0),
        "disk_percent": metrics.get("disk_percent", 0),
        "error_rate": metrics.get("error_rate", 0),
        "latency_ms": metrics.get("latency_ms", 0),
        "network_in_mbps": metrics.get("network_in_mbps", 0),
        "network_out_mbps": metrics.get("network_out_mbps", 0),
        "past_incidents": past_context,
    })

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {
            "root_cause": "Unable to parse diagnostic — manual review recommended.",
            "causal_chain": [],
            "blast_radius": [],
            "blast_radius_severity": "medium",
            "requires_human_approval": True,
            "confidence": 0.3,
            "recommended_actions": [],
            "similar_past_incidents": past_context[:200],
            "reasoning": response.content[:500],
        }

    result["agent"] = "diagnostic"
    result["rag_context_used"] = bool(similar or runbooks)
    return result
