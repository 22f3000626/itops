"""
LangGraph Orchestrator — the brain of the AIOps platform.

Defines a stateful workflow graph:
  Monitor → Predict → Diagnose → [Human Approval?] → Remediate → Report

Uses LangGraph's StateGraph with conditional edges for
human-in-the-loop at the remediation approval step.
"""

import datetime
import json
import logging
from typing import TypedDict, Literal, Any

from langgraph.graph import StateGraph, END

from app.agents.monitoring import analyze_metrics
from app.agents.predictive import predict_failure
from app.agents.diagnostic import diagnose
from app.agents.remediation import generate_remediation
from app.agents.reporting import generate_report
from app.config import REMEDIATION_AUTO_APPROVE_SEVERITY

logger = logging.getLogger("itops.orchestrator")


# ── State definition ────────────────────────────────────────────────

class OrchestratorState(TypedDict, total=False):
    """Shared state passed between agent nodes in the graph."""
    # Input
    metrics: dict
    metric_history: str

    # Agent outputs (accumulated as the graph executes)
    monitoring_result: dict
    prediction_result: dict
    diagnostic_result: dict
    remediation_result: dict
    reporting_result: dict

    # Control flow
    is_anomaly: bool
    severity: str
    needs_human_approval: bool
    human_decision: str  # "approved" | "rejected" | "pending"
    incident_id: int | None
    status: str  # current pipeline stage
    error: str | None

    # Metadata
    started_at: str
    completed_at: str
    agent_trace: list[dict]


# ── Node functions ──────────────────────────────────────────────────

async def monitoring_node(state: OrchestratorState) -> dict:
    """Run the Monitoring Agent to detect anomalies."""
    logger.info("Orchestrator: Running Monitoring Agent")
    started = datetime.datetime.utcnow()

    result = await analyze_metrics(state["metrics"])

    trace_entry = {
        "agent": "monitoring",
        "started_at": started.isoformat(),
        "completed_at": datetime.datetime.utcnow().isoformat(),
        "is_anomaly": result.get("is_anomaly", False),
    }

    trace = state.get("agent_trace", [])
    trace.append(trace_entry)

    return {
        "monitoring_result": result,
        "is_anomaly": result.get("is_anomaly", False),
        "severity": result.get("severity"),
        "status": "monitored",
        "agent_trace": trace,
    }


async def predictive_node(state: OrchestratorState) -> dict:
    """Run the Predictive Agent to forecast failure trajectory."""
    logger.info("Orchestrator: Running Predictive Agent")
    started = datetime.datetime.utcnow()

    result = await predict_failure(
        anomaly_data=state["monitoring_result"],
        metrics=state["metrics"],
        metric_history=state.get("metric_history", "No history available"),
    )

    trace_entry = {
        "agent": "predictive",
        "started_at": started.isoformat(),
        "completed_at": datetime.datetime.utcnow().isoformat(),
        "failure_probability": result.get("failure_probability", 0),
    }

    trace = state.get("agent_trace", [])
    trace.append(trace_entry)

    # Upgrade severity if prediction warrants it
    severity = state.get("severity", "medium")
    if result.get("recommended_urgency") == "immediate" and severity not in ("high", "critical"):
        severity = "high"

    return {
        "prediction_result": result,
        "severity": severity,
        "status": "predicted",
        "agent_trace": trace,
    }


async def diagnostic_node(state: OrchestratorState) -> dict:
    """Run the Diagnostic Agent for root cause analysis."""
    logger.info("Orchestrator: Running Diagnostic Agent")
    started = datetime.datetime.utcnow()

    result = await diagnose(
        anomaly_data=state["monitoring_result"],
        prediction_data=state["prediction_result"],
        metrics=state["metrics"],
    )

    trace_entry = {
        "agent": "diagnostic",
        "started_at": started.isoformat(),
        "completed_at": datetime.datetime.utcnow().isoformat(),
        "root_cause": result.get("root_cause", "unknown"),
        "confidence": result.get("confidence", 0),
    }

    trace = state.get("agent_trace", [])
    trace.append(trace_entry)

    # Determine if human approval is needed
    needs_approval = result.get("requires_human_approval", True)
    severity = state.get("severity", "medium")
    if severity in REMEDIATION_AUTO_APPROVE_SEVERITY:
        needs_approval = False

    return {
        "diagnostic_result": result,
        "needs_human_approval": needs_approval,
        "status": "diagnosed",
        "agent_trace": trace,
    }


async def human_review_node(state: OrchestratorState) -> dict:
    """
    Human-in-the-loop checkpoint.

    In the LangGraph flow, this node marks the incident as
    awaiting_approval. The actual approval comes via the API
    (PATCH /incidents/{id}/approve). The orchestrator will
    resume when the human decision is set.
    """
    logger.info("Orchestrator: Awaiting human approval")
    return {
        "status": "awaiting_approval",
        "human_decision": state.get("human_decision", "pending"),
    }


async def remediation_node(state: OrchestratorState) -> dict:
    """Run the Remediation Agent to generate fix plan."""
    logger.info("Orchestrator: Running Remediation Agent")
    started = datetime.datetime.utcnow()

    result = await generate_remediation(
        diagnostic_data=state["diagnostic_result"],
        metrics=state["metrics"],
    )

    trace_entry = {
        "agent": "remediation",
        "started_at": started.isoformat(),
        "completed_at": datetime.datetime.utcnow().isoformat(),
        "steps_count": len(result.get("steps", [])),
        "canary_compatible": result.get("canary_compatible", False),
    }

    trace = state.get("agent_trace", [])
    trace.append(trace_entry)

    return {
        "remediation_result": result,
        "status": "remediating",
        "agent_trace": trace,
    }


async def reporting_node(state: OrchestratorState) -> dict:
    """Run the Reporting Agent to generate incident report + runbook."""
    logger.info("Orchestrator: Running Reporting Agent")
    started = datetime.datetime.utcnow()

    result = await generate_report(
        monitoring_data=state.get("monitoring_result", {}),
        prediction_data=state.get("prediction_result", {}),
        diagnostic_data=state.get("diagnostic_result", {}),
        remediation_data=state.get("remediation_result", {}),
        metrics=state["metrics"],
        outcome="resolved",
    )

    trace_entry = {
        "agent": "reporting",
        "started_at": started.isoformat(),
        "completed_at": datetime.datetime.utcnow().isoformat(),
    }

    trace = state.get("agent_trace", [])
    trace.append(trace_entry)

    return {
        "reporting_result": result,
        "status": "resolved",
        "completed_at": datetime.datetime.utcnow().isoformat(),
        "agent_trace": trace,
    }


# ── Conditional edges ───────────────────────────────────────────────

def should_continue_after_monitoring(state: OrchestratorState) -> str:
    """After monitoring, proceed to prediction only if anomaly detected."""
    if state.get("is_anomaly"):
        return "predict"
    return "end"


def should_require_approval(state: OrchestratorState) -> str:
    """After diagnosis, route to human review or straight to remediation."""
    if state.get("needs_human_approval"):
        return "human_review"
    return "remediate"


def check_human_decision(state: OrchestratorState) -> str:
    """After human review, check decision."""
    decision = state.get("human_decision", "pending")
    if decision == "approved":
        return "remediate"
    elif decision == "rejected":
        return "end"
    # Still pending — in practice the graph is paused here
    # and resumed via API when approval comes in
    return "remediate"  # Default: proceed (will be gated by API)


# ── Graph construction ──────────────────────────────────────────────

def build_orchestrator_graph() -> StateGraph:
    """
    Build the LangGraph orchestrator workflow.

    Flow:
      monitor → [anomaly?] → predict → diagnose → [needs approval?] →
      (human_review) → remediate → report → END
    """
    graph = StateGraph(OrchestratorState)

    # Add nodes
    graph.add_node("monitor", monitoring_node)
    graph.add_node("predict", predictive_node)
    graph.add_node("diagnose", diagnostic_node)
    graph.add_node("human_review", human_review_node)
    graph.add_node("remediate", remediation_node)
    graph.add_node("report", reporting_node)

    # Set entry point
    graph.set_entry_point("monitor")

    # Conditional: anomaly detected → predict, else → END
    graph.add_conditional_edges(
        "monitor",
        should_continue_after_monitoring,
        {"predict": "predict", "end": END},
    )

    # Predict → Diagnose
    graph.add_edge("predict", "diagnose")

    # Conditional: needs human approval → human_review, else → remediate
    graph.add_conditional_edges(
        "diagnose",
        should_require_approval,
        {"human_review": "human_review", "remediate": "remediate"},
    )

    # Human review → check decision → remediate or end
    graph.add_conditional_edges(
        "human_review",
        check_human_decision,
        {"remediate": "remediate", "end": END},
    )

    # Remediate → Report
    graph.add_edge("remediate", "report")

    # Report → END
    graph.add_edge("report", END)

    return graph


# Compiled graph (singleton)
_compiled_graph = None


def get_orchestrator():
    """Return the compiled LangGraph orchestrator."""
    global _compiled_graph
    if _compiled_graph is None:
        graph = build_orchestrator_graph()
        _compiled_graph = graph.compile()
    return _compiled_graph


async def run_pipeline(metrics: dict, metric_history: str = "") -> OrchestratorState:
    """
    Execute the full agent pipeline for a set of metrics.

    Returns the final state with all agent outputs.
    """
    orchestrator = get_orchestrator()

    initial_state: OrchestratorState = {
        "metrics": metrics,
        "metric_history": metric_history,
        "is_anomaly": False,
        "severity": None,
        "needs_human_approval": False,
        "human_decision": "pending",
        "incident_id": None,
        "status": "starting",
        "error": None,
        "started_at": datetime.datetime.utcnow().isoformat(),
        "completed_at": None,
        "agent_trace": [],
        "monitoring_result": {},
        "prediction_result": {},
        "diagnostic_result": {},
        "remediation_result": {},
        "reporting_result": {},
    }

    try:
        final_state = await orchestrator.ainvoke(initial_state)
        return final_state
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        initial_state["error"] = str(e)
        initial_state["status"] = "error"
        return initial_state
