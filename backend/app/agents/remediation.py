"""
Remediation Agent — generates and manages remediation actions.

Generates executable remediation scripts based on diagnosis,
manages canary rollout (5% -> 25% -> 100%), and handles rollback.
"""

import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from app.config import OPENAI_API_KEY, OPENAI_MODEL, AGENT_TEMPERATURE

REMEDIATION_SYSTEM_PROMPT = """\
You are the Remediation Agent in an enterprise AIOps platform.
Your role is to generate safe, executable remediation actions for infrastructure issues.

Given the diagnosis (root cause, recommended actions), generate:
1. A concrete remediation plan with ordered steps.
2. For each step, a shell script or API call that would fix the issue.
   Since we operate on simulated infrastructure, generate realistic
   scripts that WOULD work on real Linux servers (bash scripts).
3. A rollback script for each action in case it makes things worse.
4. Risk assessment for the remediation itself.

IMPORTANT: All scripts must be safe and idempotent. Prefer restarts
over kills, config changes over rebuilds, and always include validation.

Respond in this exact JSON format (no markdown):
{{
  "plan_summary": "...",
  "steps": [
    {{
      "order": 1,
      "action": "...",
      "action_type": "restart_service|scale_up|clear_disk|rate_limit|failover|config_change|rollback",
      "description": "...",
      "script": "#!/bin/bash\\n...",
      "rollback_script": "#!/bin/bash\\n...",
      "risk_level": "low|medium|high",
      "estimated_duration_seconds": 30,
      "validation_command": "..."
    }}
  ],
  "total_estimated_duration_seconds": 60,
  "requires_downtime": false,
  "canary_compatible": true,
  "reasoning": "..."
}}
"""

REMEDIATION_HUMAN_PROMPT = """\
Node: {node_name} (Type: {node_type})

Root Cause: {root_cause}
Severity: {severity}
Blast Radius: {blast_radius}

Recommended Actions from Diagnosis:
{recommended_actions}

Causal Chain:
{causal_chain}

Generate a concrete remediation plan with executable scripts.
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


def build_remediation_chain():
    prompt = ChatPromptTemplate.from_messages([
        ("system", REMEDIATION_SYSTEM_PROMPT),
        ("human", REMEDIATION_HUMAN_PROMPT),
    ])
    return prompt | _get_llm()


async def generate_remediation(diagnostic_data: dict, metrics: dict) -> dict:
    """Generate a remediation plan based on diagnosis."""
    chain = build_remediation_chain()

    recommended_actions = diagnostic_data.get("recommended_actions", [])
    actions_str = "\n".join(
        f"- [{a.get('priority', '?')}] {a.get('action', 'N/A')} ({a.get('type', 'unknown')}): {a.get('description', '')}"
        for a in recommended_actions
    ) if recommended_actions else "No specific actions recommended — generate appropriate remediation."

    causal_chain = diagnostic_data.get("causal_chain", [])
    chain_str = " -> ".join(causal_chain) if causal_chain else "Unknown causal chain"

    blast_radius = diagnostic_data.get("blast_radius", [])
    blast_str = ", ".join(blast_radius) if blast_radius else "Contained to this node"

    response = await chain.ainvoke({
        "node_name": metrics.get("node_name", "unknown"),
        "node_type": metrics.get("node_type", "server"),
        "root_cause": diagnostic_data.get("root_cause", "unknown"),
        "severity": metrics.get("severity", "medium"),
        "blast_radius": blast_str,
        "recommended_actions": actions_str,
        "causal_chain": chain_str,
    })

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {
            "plan_summary": "Failed to generate structured plan — manual intervention required.",
            "steps": [],
            "total_estimated_duration_seconds": 0,
            "requires_downtime": False,
            "canary_compatible": False,
            "reasoning": response.content[:500],
        }

    result["agent"] = "remediation"
    # Determine if human approval is needed
    result["needs_approval"] = diagnostic_data.get("requires_human_approval", True)
    return result
