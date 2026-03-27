"""
Reporting Agent — incident summarization and runbook generation.

Generates human-readable incident reports and auto-creates runbook
entries from successfully resolved incidents for institutional memory.
"""

import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from app.config import OPENAI_API_KEY, OPENAI_MODEL, AGENT_TEMPERATURE

REPORTING_SYSTEM_PROMPT = """\
You are the Reporting Agent in an enterprise AIOps platform.
Your role is to generate clear, actionable incident reports and
extract reusable knowledge into runbook entries.

Given the full incident lifecycle data (detection, prediction,
diagnosis, remediation), produce:

1. An executive summary (2-3 sentences).
2. A detailed timeline of events.
3. A runbook entry that can help resolve similar issues in the future.
4. Lessons learned and preventive recommendations.

Respond in this exact JSON format (no markdown):
{{
  "executive_summary": "...",
  "timeline": [
    {{"time": "T+0s", "event": "Anomaly detected", "details": "..."}},
    ...
  ],
  "runbook_entry": {{
    "title": "...",
    "problem_pattern": "...",
    "solution_steps": "Step 1: ...\\nStep 2: ...\\n...",
    "tags": ["tag1", "tag2"]
  }},
  "lessons_learned": ["..."],
  "preventive_recommendations": ["..."],
  "incident_score": 0.0-10.0
}}
"""

REPORTING_HUMAN_PROMPT = """\
Incident Report Data:

Node: {node_name} (Type: {node_type})
Severity: {severity}

Detection:
{monitoring_summary}

Prediction:
{prediction_summary}

Diagnosis:
- Root Cause: {root_cause}
- Causal Chain: {causal_chain}
- Blast Radius: {blast_radius}

Remediation:
{remediation_summary}

Outcome: {outcome}

Generate the incident report and runbook entry.
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


def build_reporting_chain():
    prompt = ChatPromptTemplate.from_messages([
        ("system", REPORTING_SYSTEM_PROMPT),
        ("human", REPORTING_HUMAN_PROMPT),
    ])
    return prompt | _get_llm()


async def generate_report(
    monitoring_data: dict,
    prediction_data: dict,
    diagnostic_data: dict,
    remediation_data: dict,
    metrics: dict,
    outcome: str = "resolved",
) -> dict:
    """Generate a full incident report + runbook entry."""
    chain = build_reporting_chain()

    response = await chain.ainvoke({
        "node_name": metrics.get("node_name", "unknown"),
        "node_type": metrics.get("node_type", "server"),
        "severity": monitoring_data.get("severity", "medium"),
        "monitoring_summary": (
            f"Anomaly Type: {monitoring_data.get('anomaly_type', 'N/A')}\n"
            f"Description: {monitoring_data.get('description', 'N/A')}\n"
            f"Affected Metrics: {', '.join(monitoring_data.get('affected_metrics', []))}"
        ),
        "prediction_summary": (
            f"Failure Probability: {prediction_data.get('failure_probability', 'N/A')}\n"
            f"Escalation Risk: {prediction_data.get('escalation_risk', 'N/A')}\n"
            f"Urgency: {prediction_data.get('recommended_urgency', 'N/A')}\n"
            f"Reasoning: {prediction_data.get('reasoning', 'N/A')}"
        ),
        "root_cause": diagnostic_data.get("root_cause", "N/A"),
        "causal_chain": " -> ".join(diagnostic_data.get("causal_chain", [])),
        "blast_radius": ", ".join(diagnostic_data.get("blast_radius", [])),
        "remediation_summary": (
            f"Plan: {remediation_data.get('plan_summary', 'N/A')}\n"
            f"Steps: {len(remediation_data.get('steps', []))}\n"
            f"Duration: {remediation_data.get('total_estimated_duration_seconds', 'N/A')}s\n"
            f"Canary: {remediation_data.get('canary_compatible', False)}"
        ),
        "outcome": outcome,
    })

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {
            "executive_summary": "Report generation encountered an error — review raw data.",
            "timeline": [],
            "runbook_entry": {
                "title": f"Issue on {metrics.get('node_name', 'unknown')}",
                "problem_pattern": monitoring_data.get("description", ""),
                "solution_steps": remediation_data.get("plan_summary", ""),
                "tags": [],
            },
            "lessons_learned": [],
            "preventive_recommendations": [],
            "incident_score": 5.0,
        }

    result["agent"] = "reporting"
    return result
