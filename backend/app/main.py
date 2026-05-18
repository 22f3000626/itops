from __future__ import annotations
"""
Dynamic IT Operations Orchestrator — FastAPI Application

Multi-agent AIOps platform for autonomous infrastructure monitoring,
predictive failure detection, root cause analysis, and self-healing
remediation with human-in-the-loop approval.
"""

import asyncio
import logging
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database.session import init_db, SessionLocal
from app.api.routes import infrastructure, incidents, agents, ws, datasources, simulators, settings as settings_routes
from app.services.infra_service import InfraService
from app.services.simulator_service import apply_metric_variance
from app.agents.orchestrator import run_pipeline
from app.agents.monitoring import preliminary_monitoring_check
from app.data_sources.simulator import SimulatorDataSource
from app.data_sources.base import MetricEvent, LogEvent, registry
from app.config import utc_now

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("itops")

# Background task handles
_monitoring_task: asyncio.Task | None = None
_simulator_task: asyncio.Task | None = None
_auto_pipeline_task: asyncio.Task | None = None
_last_pipeline_dispatch: dict[tuple[int, str], float] = {}
# Live tasks spawned via asyncio.create_task — we keep strong refs so the
# event loop doesn't GC them mid-flight, and drop each when it's done.
_inflight_pipeline_tasks: set[asyncio.Task] = set()

PIPELINE_REPEAT_COOLDOWN_SECONDS = 300
# Idle dispatch keys older than this get evicted so the dict can't grow forever.
PIPELINE_DISPATCH_TTL_SECONDS = 3600
# Max concurrent pipeline runs spawned from the monitoring / auto-run loops.
# Protects the event loop and the SQLite writer during anomaly storms.
PIPELINE_MAX_CONCURRENT = int(os.getenv("PIPELINE_MAX_CONCURRENT", "4"))
_pipeline_spawn_semaphore: asyncio.Semaphore | None = None


def _get_pipeline_semaphore() -> asyncio.Semaphore:
    """Lazy init — asyncio primitives must bind to a running loop."""
    global _pipeline_spawn_semaphore
    if _pipeline_spawn_semaphore is None:
        _pipeline_spawn_semaphore = asyncio.Semaphore(PIPELINE_MAX_CONCURRENT)
    return _pipeline_spawn_semaphore


def _prune_dispatch_history(now_monotonic: float) -> None:
    """Drop dispatch keys older than the TTL so the dict stays bounded."""
    cutoff = now_monotonic - PIPELINE_DISPATCH_TTL_SECONDS
    stale = [key for key, ts in _last_pipeline_dispatch.items() if ts < cutoff]
    for key in stale:
        _last_pipeline_dispatch.pop(key, None)


def _spawn_pipeline(coro) -> asyncio.Task:
    """Spawn a pipeline coroutine with a concurrency cap and a live-tasks set."""
    async def _bounded():
        async with _get_pipeline_semaphore():
            await coro

    task = asyncio.create_task(_bounded())
    _inflight_pipeline_tasks.add(task)
    task.add_done_callback(_inflight_pipeline_tasks.discard)
    return task

SIMULATOR_LOG_LEVEL_PATTERNS = (
    ("CRITICAL", re.compile(r"\b(CRITICAL|FATAL|PANIC)\b", re.IGNORECASE)),
    ("ERROR", re.compile(r"\bERROR\b", re.IGNORECASE)),
    ("WARN", re.compile(r"\bWARN(?:ING)?\b", re.IGNORECASE)),
    ("INFO", re.compile(r"\bINFO\b", re.IGNORECASE)),
)


def _event_from_sim(sim_row) -> MetricEvent:
    """Build a MetricEvent from a running user-created simulator with metrics."""
    cfg = apply_metric_variance(sim_row.metrics_config or {})
    from app.services.simulator_service import SIMULATOR_TO_NODE_TYPE
    node_type = SIMULATOR_TO_NODE_TYPE.get(sim_row.simulator_type, "server")
    return MetricEvent(
        node_name=sim_row.name,
        node_type=node_type,
        provider="simulated",
        region="us-east-1",
        ip_address=f"10.1.0.{sim_row.id}",
        cpu_percent=cfg.get("cpu_percent", 45),
        memory_percent=cfg.get("memory_percent", 60),
        disk_percent=cfg.get("disk_percent", 35),
        network_in_mbps=cfg.get("network_in_mbps", 50),
        network_out_mbps=cfg.get("network_out_mbps", 30),
        request_rate=cfg.get("request_rate", 200),
        error_rate=cfg.get("error_rate", 1),
        latency_ms=cfg.get("latency_ms", 80),
    )


def _event_to_ws_payload(event: MetricEvent, stat_result: dict) -> dict:
    """Convert a MetricEvent + anomaly check into the WS payload dict."""
    return {
        "node_name": event.node_name,
        "node_type": event.node_type,
        "provider": event.provider,
        "region": event.region,
        "metrics": {
            "cpu_percent": event.cpu_percent,
            "memory_percent": event.memory_percent,
            "disk_percent": event.disk_percent,
            "network_in_mbps": event.network_in_mbps,
            "network_out_mbps": event.network_out_mbps,
            "request_rate": event.request_rate,
            "error_rate": event.error_rate,
            "latency_ms": event.latency_ms,
        },
        "is_anomaly": stat_result.get("is_anomaly", False),
        "anomaly_severity": stat_result.get("max_severity") if stat_result.get("is_anomaly") else None,
        "metadata": event.metadata,
    }


def _simulator_log_event(simulator_name: str, line: str) -> LogEvent:
    """Map an uploaded simulator log line into the shared log schema."""
    level = "INFO"
    for candidate_level, pattern in SIMULATOR_LOG_LEVEL_PATTERNS:
        if pattern.search(line):
            level = candidate_level
            break

    source = "simulator"
    source_match = re.search(r"\b([a-zA-Z0-9_.-]+):", line)
    if source_match:
        source = source_match.group(1)[:100]

    return LogEvent(
        node_name=simulator_name,
        timestamp=utc_now(),
        level=level,
        source=source,
        message=line,
    )


def _persist_incident_sync(node_id: int, state: dict) -> None:
    """Create the incident record in a worker thread so the event loop is not blocked."""
    from app.services.incident_service import IncidentService
    db = SessionLocal()
    try:
        incident_svc = IncidentService(db)
        incident_svc.create_incident_from_pipeline(node_id, state)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def _run_pipeline_background(node_id: int, node_name: str, full_metrics: dict, metric_history: str, log_history: str):
    """Run the LLM pipeline in the background so the monitoring loop is not blocked."""
    try:
        state = await run_pipeline(full_metrics, metric_history, log_history)
        if state.get("is_anomaly"):
            try:
                await asyncio.to_thread(_persist_incident_sync, node_id, state)
            except Exception as e:
                logger.error(f"Incident creation error for {node_name}: {e}")
    except Exception as e:
        logger.error(f"Pipeline error for {node_name}: {e}")


def _should_dispatch_pipeline(
    node_id: int,
    anomaly_type: str | None,
    previous_is_anomaly: bool,
    previous_anomaly_type: str | None,
) -> bool:
    """
    Suppress repeated background pipeline runs for the same node/anomaly
    while the node remains continuously unhealthy.

    First detection always runs immediately. Repeated runs for the same
    anomaly type are cooled down to reduce duplicate incidents and DB churn.
    """
    normalized_type = anomaly_type or "unknown"
    key = (node_id, normalized_type)
    now = time.monotonic()
    _prune_dispatch_history(now)

    if not previous_is_anomaly or previous_anomaly_type != normalized_type:
        _last_pipeline_dispatch[key] = now
        return True

    last_dispatched = _last_pipeline_dispatch.get(key)
    if last_dispatched is None or (now - last_dispatched) >= PIPELINE_REPEAT_COOLDOWN_SECONDS:
        _last_pipeline_dispatch[key] = now
        return True

    return False


def _cooldown_allows_dispatch(node_id: int, anomaly_type: str | None) -> bool:
    """Shared cooldown check for periodic background/auto pipeline runs."""
    normalized_type = anomaly_type or "unknown"
    key = (node_id, normalized_type)
    now = time.monotonic()
    _prune_dispatch_history(now)
    last_dispatched = _last_pipeline_dispatch.get(key)
    if last_dispatched is None or (now - last_dispatched) >= PIPELINE_REPEAT_COOLDOWN_SECONDS:
        _last_pipeline_dispatch[key] = now
        return True
    return False


async def _process_event(
    event: MetricEvent,
    infra_svc,
    incident_svc,
    db,
    sim_source=None,
    generate_correlated_logs: bool = True,
):
    """Store a metric event + logs, run anomaly detection, and trigger the pipeline if enabled."""
    from app.services.settings_service import settings as _rt_settings

    node = infra_svc.ensure_node_exists(event)
    previous_snapshot = infra_svc.get_latest_metric_snapshot(node.id)
    previous_scores = previous_snapshot.anomaly_scores if previous_snapshot and previous_snapshot.anomaly_scores else {}
    previous_is_anomaly = bool(previous_snapshot.is_anomaly) if previous_snapshot else False
    previous_anomaly_type = previous_scores.get("anomaly_type") if isinstance(previous_scores, dict) else None
    metrics_dict = {
        "cpu_percent": event.cpu_percent,
        "memory_percent": event.memory_percent,
        "disk_percent": event.disk_percent,
        "network_in_mbps": event.network_in_mbps,
        "network_out_mbps": event.network_out_mbps,
        "request_rate": event.request_rate,
        "error_rate": event.error_rate,
        "latency_ms": event.latency_ms,
    }

    # Generate and store correlated logs only when there is no dedicated
    # log stream already associated with this node.
    if sim_source is not None and generate_correlated_logs:
        log_events = sim_source.generate_logs_for_event(event)
        infra_svc.store_logs_batch(node, log_events)

    log_history = infra_svc.get_recent_logs_as_history(node.id)
    stat_result = preliminary_monitoring_check(metrics_dict, log_history)
    infra_svc.store_metric(
        node, event,
        is_anomaly=stat_result.get("is_anomaly", False),
        anomaly_scores=stat_result,
    )

    if stat_result.get("is_anomaly"):
        max_sev = stat_result.get("max_severity", "medium")
        if max_sev == "critical":
            infra_svc.update_node_status(node, "critical")
        else:
            infra_svc.update_node_status(node, "degraded")

        full_metrics = {
            **metrics_dict,
            "node_name": event.node_name,
            "node_type": event.node_type,
            "provider": event.provider,
            "region": event.region,
        }
        metric_history = infra_svc.get_recent_metrics_as_history(node.id)
        db.commit()

        anomaly_type = stat_result.get("anomaly_type")
        if not _rt_settings.auto_run_pipeline:
            logger.info(
                "Anomaly on %s (%s) detected, but automatic pipeline execution is disabled",
                event.node_name,
                max_sev,
            )
        elif _should_dispatch_pipeline(
            node.id,
            anomaly_type,
            previous_is_anomaly=previous_is_anomaly,
            previous_anomaly_type=previous_anomaly_type,
        ):
            logger.info(f"Anomaly on {event.node_name} ({max_sev}) — running pipeline")
            # Fire pipeline as a background task so the monitoring loop
            # is never blocked by slow analysis. Concurrency-capped by
            # PIPELINE_MAX_CONCURRENT so a fleet-wide anomaly storm can't
            # spawn unbounded tasks.
            _spawn_pipeline(
                _run_pipeline_background(node.id, event.node_name, full_metrics, metric_history, log_history)
            )
        else:
            logger.info(
                "Anomaly on %s persists (%s) — skipping duplicate pipeline within %ss cooldown",
                event.node_name,
                anomaly_type or "unknown",
                PIPELINE_REPEAT_COOLDOWN_SECONDS,
            )
    else:
        infra_svc.update_node_status(node, "healthy")

    return stat_result


async def _start_cloud_adapters() -> None:
    """Connect and register any cloud adapters that have credentials configured."""
    from app.services.settings_service import settings as _rt_settings
    from app.data_sources.cloudwatch import CloudWatchDataSource
    from app.data_sources.azure_monitor import AzureMonitorDataSource
    from app.data_sources.gcp_monitoring import GCPMonitoringDataSource

    adapters = [
        (
            "cloudwatch",
            CloudWatchDataSource,
            lambda s: bool(s.cloudwatch_access_key_id and s.cloudwatch_secret_access_key),
        ),
        (
            "azure",
            AzureMonitorDataSource,
            lambda s: bool(s.azure_tenant_id and s.azure_client_id and s.azure_client_secret and s.azure_subscription_id),
        ),
        (
            "gcp",
            GCPMonitoringDataSource,
            lambda s: bool(s.gcp_project_id and s.gcp_service_account_json),
        ),
    ]
    for name, cls, has_creds in adapters:
        if not has_creds(_rt_settings):
            continue
        try:
            adapter = cls()
            await adapter.connect()
            registry.register(adapter)
            asyncio.create_task(_cloud_polling_loop(adapter))
            logger.info("Cloud adapter registered on startup: %s", name)
        except Exception as exc:
            logger.warning("Cloud adapter %s failed to connect on startup: %s", name, exc)


async def _cloud_polling_loop(adapter) -> None:
    """Drive a cloud adapter's stream_metrics loop through _process_event."""
    from app.api.routes.ws import manager as ws_manager
    logger.info("Cloud polling loop started: %s", adapter.provider_name)
    try:
        async for batch in adapter.stream_metrics():
            db = SessionLocal()
            try:
                infra_svc = InfraService(db)
                ws_payloads = []
                for event in batch:
                    stat_result = await _process_event(
                        event,
                        infra_svc,
                        None,
                        db,
                        sim_source=None,
                        generate_correlated_logs=False,
                    )
                    ws_payloads.append(_event_to_ws_payload(event, stat_result))
                db.commit()
                if ws_payloads:
                    import json as _json
                    await ws_manager.broadcast(_json.dumps({
                        "type": "metrics_batch",
                        "data": ws_payloads,
                    }))
            except Exception as exc:
                logger.error("Cloud poll processing error (%s): %s", adapter.provider_name, exc)
                db.rollback()
            finally:
                db.close()
    except Exception as exc:
        logger.error("Cloud polling loop crashed (%s): %s", adapter.provider_name, exc)


async def background_monitoring_loop():
    """
    Continuous background loop that:
    1. Streams simulated metrics from the fleet data source.
    2. Also generates metrics for running user simulators (vm/db/cache/lb/queue)
       that have metrics_enabled.
    3. Runs statistical anomaly detection on every event.
    4. For anomalous nodes, triggers the full agent pipeline only when
       automatic pipeline execution is enabled in Settings.
    5. Persists all results to the database.
    6. Broadcasts the combined payload to WebSocket clients so the
       Dashboard shows exactly the same data as Infrastructure.
    """
    from app.api.routes.ws import manager as ws_manager

    sim = SimulatorDataSource()
    await sim.connect()
    registry.register(sim)

    # Start any cloud adapters that have credentials pre-configured
    await _start_cloud_adapters()

    logger.info("Background monitoring loop started")

    try:
        async for batch in sim.stream_metrics():
            db = SessionLocal()
            try:
                infra_svc = InfraService(db)
                from app.services.incident_service import IncidentService
                from app.database.models import (
                    Simulator as _SimModel,
                    SimulatorType as _SimType,
                    SimulatorStatus as _SimStatus,
                )
                incident_svc = IncidentService(db)

                ws_payload: list[dict] = []

                # ── 1.  Fleet nodes (metrics-type simulators) ─────────
                active_fleet = set(
                    row.name for row in db.query(_SimModel.name)
                    .filter(
                        _SimModel.simulator_type == _SimType.METRICS,
                        _SimModel.status == _SimStatus.RUNNING,
                    ).all()
                )

                for event in batch:
                    if event.node_name not in active_fleet:
                        continue
                    stat_result = await _process_event(
                        event,
                        infra_svc,
                        incident_svc,
                        db,
                        sim_source=sim,
                        generate_correlated_logs=True,
                    )
                    ws_payload.append(_event_to_ws_payload(event, stat_result))

                # ── 2.  User simulators with metrics enabled ──────────
                user_sims = (
                    db.query(_SimModel)
                    .filter(
                        _SimModel.simulator_type != _SimType.METRICS,
                        _SimModel.status == _SimStatus.RUNNING,
                        _SimModel.metrics_enabled.is_(True),
                    )
                    .all()
                )
                for sim_row in user_sims:
                    if not sim_row.metrics_config:
                        continue
                    event = _event_from_sim(sim_row)
                    stat_result = await _process_event(
                        event,
                        infra_svc,
                        incident_svc,
                        db,
                        sim_source=sim,
                        generate_correlated_logs=not bool(sim_row.log_file_content),
                    )
                    ws_payload.append(_event_to_ws_payload(event, stat_result))

                db.commit()

                # ── 3.  Broadcast to all WebSocket clients ────────────
                if ws_payload:
                    await ws_manager.broadcast({
                        "type": "metric_batch",
                        "data": ws_payload,
                        "timestamp": utc_now().isoformat() + "Z",
                    })

            except Exception as e:
                logger.error(f"Monitoring loop error: {e}", exc_info=True)
                db.rollback()
            finally:
                db.close()

    except asyncio.CancelledError:
        logger.info("Background monitoring loop cancelled")
    finally:
        await sim.disconnect()


async def background_simulator_advancement():
    """
    Advance log lines for all running simulators at their configured intervals.
    Runs every second and advances any simulator whose interval has elapsed.
    """
    from app.database.models import Simulator as SimModel, SimulatorStatus as SimStatus, SimulatorType as SimType
    from app.services.simulator_service import SimulatorService

    logger.info("Simulator advancement loop started")
    while True:
        await asyncio.sleep(1)
        db = SessionLocal()
        try:
            now = utc_now()
            # Only advance log-playback simulators (not fleet metrics sims)
            running = (
                db.query(SimModel)
                .filter(
                    SimModel.status == SimStatus.RUNNING,
                    SimModel.simulator_type != SimType.METRICS,
                )
                .all()
            )
            for sim in running:
                reference = sim.last_advance_at or sim.updated_at or now
                elapsed = (now - reference).total_seconds()
                if elapsed >= sim.interval_seconds:
                    svc = SimulatorService(db)
                    line, finished = svc.advance_line(sim.id)
                    if line:
                        infra_svc = InfraService(db)
                        node = infra_svc.get_node_by_name(sim.name)
                        if node:
                            infra_svc.store_log(node, _simulator_log_event(sim.name, line))
                    sim.last_advance_at = now
                    if finished:
                        svc.set_status(sim.id, SimStatus.STOPPED)
                    else:
                        db.commit()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Simulator advancement error: {e}")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()


async def auto_run_pipeline_loop():
    """
    Background loop that periodically runs the full agent pipeline
    for ALL infrastructure nodes when auto_run_pipeline is enabled
    in Settings.  Checks the toggle every second and only fires
    the pipeline batch at the configured interval.
    """
    from app.services.settings_service import settings as _rt_settings

    logger.info("Auto-run pipeline loop started (initially paused)")
    last_run = 0.0

    while True:
        try:
            await asyncio.sleep(1)

            if not _rt_settings.auto_run_pipeline:
                last_run = 0.0
                continue

            now = time.monotonic()
            interval = _rt_settings.auto_run_interval_seconds
            if interval < 5:
                interval = 5

            if last_run == 0.0:
                last_run = now
                continue

            if (now - last_run) < interval:
                continue

            last_run = now
            logger.info(f"Auto-run pipeline: triggering for all nodes (interval={interval}s)")

            db = SessionLocal()
            try:
                infra_svc = InfraService(db)
                nodes = infra_svc.get_all_nodes()
                dispatched = 0
                for node in nodes:
                    latest = infra_svc.get_node_metrics(node.id, limit=1)
                    if not latest:
                        continue
                    snap = latest[0]
                    metric_history = infra_svc.get_recent_metrics_as_history(node.id)
                    log_history = infra_svc.get_recent_logs_as_history(node.id)
                    full_metrics = {
                        "cpu_percent": snap.cpu_percent,
                        "memory_percent": snap.memory_percent,
                        "disk_percent": snap.disk_percent,
                        "network_in_mbps": snap.network_in_mbps,
                        "network_out_mbps": snap.network_out_mbps,
                        "request_rate": snap.request_rate,
                        "error_rate": snap.error_rate,
                        "latency_ms": snap.latency_ms,
                        "node_name": node.node_name,
                        "node_type": node.node_type,
                        "provider": node.provider,
                        "region": node.region,
                    }
                    latest_anomaly = preliminary_monitoring_check(
                        {
                            "cpu_percent": snap.cpu_percent,
                            "memory_percent": snap.memory_percent,
                            "disk_percent": snap.disk_percent,
                            "network_in_mbps": snap.network_in_mbps,
                            "network_out_mbps": snap.network_out_mbps,
                            "request_rate": snap.request_rate,
                            "error_rate": snap.error_rate,
                            "latency_ms": snap.latency_ms,
                        },
                        log_history,
                    )
                    if not latest_anomaly.get("is_anomaly"):
                        continue
                    if not _cooldown_allows_dispatch(node.id, latest_anomaly.get("anomaly_type")):
                        continue
                    _spawn_pipeline(
                        _run_pipeline_background(node.id, node.node_name, full_metrics, metric_history, log_history)
                    )
                    dispatched += 1
                logger.info(f"Auto-run pipeline: dispatched {dispatched} pipeline tasks")
            except Exception as e:
                logger.error(f"Auto-run pipeline error: {e}", exc_info=True)
            finally:
                db.close()

        except asyncio.CancelledError:
            logger.info("Auto-run pipeline loop cancelled")
            return
        except Exception as e:
            logger.error(f"Auto-run pipeline loop error: {e}")
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start/stop background monitoring."""
    global _monitoring_task, _simulator_task, _auto_pipeline_task

    # Initialize database
    init_db()
    logger.info("Database initialized")

    # Seed fleet nodes as metrics-type simulators (so they appear in the Simulators page)
    from app.data_sources.simulator import _build_fleet
    from app.services.simulator_service import SimulatorService as _SimSvc
    _seed_db = SessionLocal()
    try:
        fleet_nodes = _build_fleet()
        seeded = _SimSvc(_seed_db).seed_fleet_simulators(fleet_nodes)
        if seeded:
            logger.info(f"Seeded {seeded} fleet metrics simulators into DB")
    finally:
        _seed_db.close()

    # Start background tasks
    _monitoring_task = asyncio.create_task(background_monitoring_loop())
    _simulator_task = asyncio.create_task(background_simulator_advancement())
    _auto_pipeline_task = asyncio.create_task(auto_run_pipeline_loop())
    logger.info("Background monitoring started")

    yield

    # Shutdown
    for task in (_monitoring_task, _simulator_task, _auto_pipeline_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    logger.info("Application shutdown complete")


# ── App setup ───────────────────────────────────────────────────────

app = FastAPI(
    title="IT Operations Orchestrator",
    description=(
        "Autonomous Multi-Agent AIOps Platform for Self-Healing Enterprise Infrastructure. "
        "Monitors infrastructure, predicts failures, diagnoses root causes, "
        "and orchestrates remediation with human-in-the-loop approval."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

_cors_env = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).strip()
_allow_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
_cors_allow_credentials = "*" not in _allow_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(infrastructure.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(datasources.router, prefix="/api")
app.include_router(simulators.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(ws.router)


@app.get("/")
def root():
    return {
        "name": "IT Operations Orchestrator",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "agents": [
            "monitoring", "predictive", "diagnostic",
            "remediation", "reporting",
        ],
        "data_sources": registry.provider_names,
    }


@app.get("/health")
def health():
    """Liveness + dependency check.

    Returns 200 with per-component status when everything is healthy,
    503 when any critical component is down. Suitable for use as a
    readiness probe.
    """
    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    components: dict[str, dict] = {}
    overall_ok = True

    # DB
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            components["database"] = {"ok": True}
        finally:
            db.close()
    except Exception as e:
        components["database"] = {"ok": False, "error": str(e)[:200]}
        overall_ok = False

    # Vector store — only check that the singleton loads; embedding server is optional.
    try:
        from app.memory.vector_store import get_memory
        mem = get_memory()
        components["vector_store"] = {
            "ok": True,
            "incidents": mem.incident_count,
            "runbooks": mem.runbook_count,
        }
    except Exception as e:
        components["vector_store"] = {"ok": False, "error": str(e)[:200]}
        overall_ok = False

    # Background tasks
    task_states = {
        "monitoring": _monitoring_task,
        "simulator_advancement": _simulator_task,
        "auto_pipeline": _auto_pipeline_task,
    }
    for name, task in task_states.items():
        if task is None:
            components[name] = {"ok": False, "error": "not started"}
            overall_ok = False
        elif task.done():
            exc = task.exception() if not task.cancelled() else None
            components[name] = {
                "ok": False,
                "error": f"exited: {exc!r}" if exc else "exited cleanly (unexpected)",
            }
            overall_ok = False
        else:
            components[name] = {"ok": True}

    payload = {
        "status": "healthy" if overall_ok else "degraded",
        "components": components,
        "inflight_pipelines": len(_inflight_pipeline_tasks),
    }
    return JSONResponse(payload, status_code=200 if overall_ok else 503)
