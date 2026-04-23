from __future__ import annotations

"""Agent management & pipeline trigger API routes."""

import asyncio
import datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.session import get_db, SessionLocal
from app.api.schemas import (
    PipelineRunRequest, PipelineResult, AgentInfo, RunbookEntryOut,
)
from app.agents.orchestrator import run_pipeline
from app.services.infra_service import InfraService
from app.services.incident_service import IncidentService
from app.data_sources.simulator import SimulatorDataSource
from app.data_sources.base import MetricEvent
from app.database.models import RunbookEntry

logger = logging.getLogger("itops.api.agents")

router = APIRouter(prefix="/agents", tags=["Agents"])
_pipeline_runs: dict[str, dict] = {}


def _persist_pipeline_incident(metrics: dict, state: dict) -> int | None:
    """Persist a pipeline result as an incident. Runs on a worker thread."""
    db = SessionLocal()
    try:
        infra_svc = InfraService(db)
        incident_svc = IncidentService(db)
        node = infra_svc.get_node_by_name(metrics.get("node_name", ""))
        if not node:
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
        return incident.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# ── Agent registry (for frontend display) ───────────────────────────

AGENT_REGISTRY = [
    AgentInfo(
        name="monitoring",
        description="Monitors infrastructure metrics and correlates log signals using deterministic thresholds and pattern matching.",
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
        description="Generates concise remediation steps and downloadable scripts for operator review.",
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


def _build_pipeline_result(state: dict, incident_id: int | None = None) -> dict:
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
    ).model_dump()


def _resolve_pipeline_context(body: PipelineRunRequest, db: Session) -> tuple[dict, str, str]:
    infra_svc = InfraService(db)

    if body.custom_metrics:
        metrics = body.custom_metrics
    elif body.node_name:
        node = infra_svc.get_node_by_name(body.node_name)
        if not node:
            raise HTTPException(404, f"Node '{body.node_name}' not found in infrastructure")
        latest = infra_svc.get_latest_metric_snapshot(node.id)
        if not latest:
            raise HTTPException(404, f"No metrics recorded yet for '{body.node_name}'")
        metrics = {
            "node_name": node.node_name,
            "node_type": node.node_type,
            "provider": node.provider,
            "region": node.region,
            "cpu_percent": latest.cpu_percent,
            "memory_percent": latest.memory_percent,
            "disk_percent": latest.disk_percent,
            "network_in_mbps": latest.network_in_mbps,
            "network_out_mbps": latest.network_out_mbps,
            "request_rate": latest.request_rate,
            "error_rate": latest.error_rate,
            "latency_ms": latest.latency_ms,
        }
    else:
        raise HTTPException(400, "Provide node_name or custom_metrics")

    metric_history = ""
    log_history = ""
    node = infra_svc.get_node_by_name(metrics.get("node_name", ""))
    if node:
        metric_history = infra_svc.get_recent_metrics_as_history(node.id)
        log_history = infra_svc.get_recent_logs_as_history(node.id)

    return metrics, metric_history, log_history


def _append_progress_event(run_id: str, event: dict) -> None:
    run = _pipeline_runs.get(run_id)
    if not run:
        return

    run["progress_events"].append(event)
    phase = event.get("phase")
    agent = event.get("agent")
    if phase == "started":
        run["current_agent"] = agent
        run["current_phase"] = phase
    elif phase == "completed" and run.get("current_agent") == agent:
        run["current_phase"] = phase
    elif phase == "error":
        run["current_agent"] = agent
        run["current_phase"] = phase
        run["error"] = event.get("error") or event.get("message")


async def _run_pipeline_job(run_id: str, metrics: dict, metric_history: str, log_history: str):
    run = _pipeline_runs[run_id]
    run["status"] = "running"

    async def _progress_callback(event: dict):
        _append_progress_event(run_id, event)

    state = await run_pipeline(
        metrics,
        metric_history,
        log_history,
        progress_callback=_progress_callback,
    )

    incident_id = None
    if state.get("is_anomaly"):
        try:
            incident_id = await asyncio.to_thread(_persist_pipeline_incident, metrics, state)
        except Exception as e:
            logger.error(f"Async pipeline persistence failed for run {run_id}: {e}", exc_info=True)
            run["error"] = str(e)
            run["status"] = "failed"

    run["result"] = _build_pipeline_result(state, incident_id)
    run["completed_at"] = state.get("completed_at") or datetime.datetime.utcnow().isoformat()
    run["current_agent"] = None
    run["current_phase"] = None
    if run.get("status") != "failed":
        if state.get("error"):
            run["status"] = "failed"
            run["error"] = state.get("error")
        else:
            run["status"] = "completed"


@router.post("/pipeline/start")
async def start_pipeline_run(body: PipelineRunRequest, db: Session = Depends(get_db)):
    """Start a pipeline run in the background and return a run id for polling."""
    metrics, metric_history, log_history = _resolve_pipeline_context(body, db)
    run_id = uuid.uuid4().hex
    _pipeline_runs[run_id] = {
        "run_id": run_id,
        "status": "queued",
        "node_name": metrics.get("node_name", "custom"),
        "current_agent": None,
        "current_phase": None,
        "progress_events": [],
        "result": None,
        "error": None,
        "started_at": datetime.datetime.utcnow().isoformat(),
        "completed_at": None,
    }
    asyncio.create_task(_run_pipeline_job(run_id, metrics, metric_history, log_history))
    return {"run_id": run_id, "status": "queued"}


@router.get("/pipeline/runs/{run_id}")
def get_pipeline_run(run_id: str):
    run = _pipeline_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    return run


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
    metrics, metric_history, log_history = _resolve_pipeline_context(body, db)

    # Run the full pipeline
    logger.info(f"Triggering pipeline for: {metrics.get('node_name', 'custom')}")
    state = await run_pipeline(metrics, metric_history, log_history)

    # Persist incident if anomaly was detected
    incident_id = None
    if state.get("is_anomaly"):
        incident_id = await asyncio.to_thread(_persist_pipeline_incident, metrics, state)

    return PipelineResult(**_build_pipeline_result(state, incident_id))


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
        log_history = infra_svc.get_recent_logs_as_history(node.id)

        # Run pipeline
        state = await run_pipeline(metrics, metric_history, log_history)

        incident_id = None
        if state.get("is_anomaly"):
            # Update node status
            severity = state.get("severity", "medium")
            if severity in ("critical",):
                infra_svc.update_node_status(node, "critical")
            elif severity in ("high",):
                infra_svc.update_node_status(node, "degraded")
            db.commit()

            incident_id = await asyncio.to_thread(_persist_pipeline_incident, metrics, state)
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
        "incidents_created": sum(1 for r in results if r["incident_id"] is not None),
        "results": results,
    }


@router.get("/runbooks", response_model=list[RunbookEntryOut])
def list_runbooks(limit: int = 2000, db: Session = Depends(get_db)):
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
