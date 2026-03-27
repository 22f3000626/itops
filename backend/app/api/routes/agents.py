"""Agent management & pipeline trigger API routes."""

import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.api.schemas import (
    PipelineRunRequest, PipelineResult, AgentInfo, RunbookEntryOut,
)
from app.agents.orchestrator import run_pipeline
from app.services.infra_service import InfraService
from app.services.incident_service import IncidentService
from app.data_sources.simulator import SimulatorDataSource
from app.database.models import RunbookEntry

logger = logging.getLogger("itops.api.agents")

router = APIRouter(prefix="/agents", tags=["Agents"])

# ── Agent registry (for frontend display) ───────────────────────────

AGENT_REGISTRY = [
    AgentInfo(
        name="monitoring",
        description="Monitors infrastructure metrics and detects anomalies using statistical thresholds + LLM reasoning.",
        status="active",
    ),
    AgentInfo(
        name="predictive",
        description="Predicts failure trajectory, estimates time-to-failure, and assesses escalation risk.",
        status="active",
    ),
    AgentInfo(
        name="diagnostic",
        description="Performs root cause analysis using causal reasoning and RAG from institutional memory.",
        status="active",
    ),
    AgentInfo(
        name="remediation",
        description="Generates executable remediation plans with canary rollout and rollback scripts.",
        status="active",
    ),
    AgentInfo(
        name="reporting",
        description="Generates incident reports, timelines, and auto-creates runbook entries.",
        status="active",
    ),
]


@router.get("/", response_model=list[AgentInfo])
def list_agents():
    """List all available agents and their status."""
    return AGENT_REGISTRY


@router.post("/pipeline/run", response_model=PipelineResult)
async def trigger_pipeline(
    body: PipelineRunRequest,
    db: Session = Depends(get_db),
):
    """
    Manually trigger the full agent pipeline.

    Provide either a node_name (to use current simulated data)
    or custom_metrics dict for testing.
    """
    infra_svc = InfraService(db)
    incident_svc = IncidentService(db)

    if body.custom_metrics:
        metrics = body.custom_metrics
    elif body.node_name:
        # Get fresh simulated data for this node
        sim = SimulatorDataSource()
        await sim.connect()
        snapshot = await sim.get_current_snapshot()
        matching = [e for e in snapshot if e.node_name == body.node_name]
        if not matching:
            raise HTTPException(404, f"Node '{body.node_name}' not found in simulator fleet")
        event = matching[0]
        metrics = {
            "node_name": event.node_name,
            "node_type": event.node_type,
            "provider": event.provider,
            "region": event.region,
            "cpu_percent": event.cpu_percent,
            "memory_percent": event.memory_percent,
            "disk_percent": event.disk_percent,
            "network_in_mbps": event.network_in_mbps,
            "network_out_mbps": event.network_out_mbps,
            "request_rate": event.request_rate,
            "error_rate": event.error_rate,
            "latency_ms": event.latency_ms,
        }
        await sim.disconnect()
    else:
        raise HTTPException(400, "Provide node_name or custom_metrics")

    # Get metric history if node exists
    metric_history = ""
    node = infra_svc.get_node_by_name(metrics.get("node_name", ""))
    if node:
        metric_history = infra_svc.get_recent_metrics_as_history(node.id)

    # Run the full pipeline
    logger.info(f"Triggering pipeline for: {metrics.get('node_name', 'custom')}")
    state = await run_pipeline(metrics, metric_history)

    # Persist incident if anomaly was detected
    incident_id = None
    if state.get("is_anomaly"):
        if not node:
            from app.data_sources.base import MetricEvent
            event = MetricEvent(
                node_name=metrics.get("node_name", "custom-node"),
                node_type=metrics.get("node_type", "server"),
                provider=metrics.get("provider", "manual"),
                region=metrics.get("region", "unknown"),
                ip_address=metrics.get("ip_address", "0.0.0.0"),
                cpu_percent=metrics.get("cpu_percent", 0),
                memory_percent=metrics.get("memory_percent", 0),
                disk_percent=metrics.get("disk_percent", 0),
                network_in_mbps=metrics.get("network_in_mbps", 0),
                network_out_mbps=metrics.get("network_out_mbps", 0),
                request_rate=metrics.get("request_rate", 0),
                error_rate=metrics.get("error_rate", 0),
                latency_ms=metrics.get("latency_ms", 0),
            )
            node = infra_svc.ensure_node_exists(event)
            db.commit()

        incident = incident_svc.create_incident_from_pipeline(node.id, state)
        incident_id = incident.id

    return PipelineResult(
        incident_id=incident_id,
        status=state.get("status", "unknown"),
        is_anomaly=state.get("is_anomaly", False),
        severity=state.get("severity"),
        monitoring_result=state.get("monitoring_result", {}),
        prediction_result=state.get("prediction_result", {}),
        diagnostic_result=state.get("diagnostic_result", {}),
        remediation_result=state.get("remediation_result", {}),
        reporting_result=state.get("reporting_result", {}),
        agent_trace=state.get("agent_trace", []),
        started_at=state.get("started_at"),
        completed_at=state.get("completed_at"),
    )


@router.post("/pipeline/run-all")
async def trigger_pipeline_all_nodes(db: Session = Depends(get_db)):
    """
    Run the pipeline for ALL nodes in the simulated fleet.
    Returns a summary of results.
    """
    sim = SimulatorDataSource()
    await sim.connect()
    snapshot = await sim.get_current_snapshot()
    await sim.disconnect()

    infra_svc = InfraService(db)
    incident_svc = IncidentService(db)

    results = []
    for event in snapshot:
        metrics = {
            "node_name": event.node_name,
            "node_type": event.node_type,
            "provider": event.provider,
            "region": event.region,
            "cpu_percent": event.cpu_percent,
            "memory_percent": event.memory_percent,
            "disk_percent": event.disk_percent,
            "network_in_mbps": event.network_in_mbps,
            "network_out_mbps": event.network_out_mbps,
            "request_rate": event.request_rate,
            "error_rate": event.error_rate,
            "latency_ms": event.latency_ms,
        }

        # Ensure node exists in DB
        node = infra_svc.ensure_node_exists(event)
        infra_svc.store_metric(node, event)
        db.commit()

        # Get history
        metric_history = infra_svc.get_recent_metrics_as_history(node.id)

        # Run pipeline
        state = await run_pipeline(metrics, metric_history)

        incident_id = None
        if state.get("is_anomaly"):
            # Update node status
            severity = state.get("severity", "medium")
            if severity in ("critical",):
                infra_svc.update_node_status(node, "critical")
            elif severity in ("high",):
                infra_svc.update_node_status(node, "degraded")
            db.commit()

            incident = incident_svc.create_incident_from_pipeline(node.id, state)
            incident_id = incident.id
        else:
            infra_svc.update_node_status(node, "healthy")
            db.commit()

        results.append({
            "node_name": event.node_name,
            "is_anomaly": state.get("is_anomaly", False),
            "severity": state.get("severity"),
            "incident_id": incident_id,
            "status": state.get("status", "unknown"),
        })

    return {
        "total_nodes": len(results),
        "anomalies_detected": sum(1 for r in results if r["is_anomaly"]),
        "results": results,
    }


@router.get("/runbooks", response_model=list[RunbookEntryOut])
def list_runbooks(limit: int = 50, db: Session = Depends(get_db)):
    """List auto-generated runbook entries."""
    entries = (
        db.query(RunbookEntry)
        .order_by(RunbookEntry.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        RunbookEntryOut(
            id=e.id,
            title=e.title,
            problem_pattern=e.problem_pattern,
            solution_steps=e.solution_steps,
            source_incident_id=e.source_incident_id,
            effectiveness_score=e.effectiveness_score,
            times_used=e.times_used,
            created_at=e.created_at,
        )
        for e in entries
    ]


@router.get("/memory/search")
def search_memory(query: str, collection: str = "incidents", n: int = 5):
    """Search the institutional memory (vector store) via RAG."""
    from app.memory.vector_store import get_memory
    memory = get_memory()
    if collection == "runbooks":
        results = memory.search_runbooks(query, n_results=n)
    else:
        results = memory.search_similar_incidents(query, n_results=n)
    return {"query": query, "collection": collection, "results": results}
