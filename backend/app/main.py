"""
Dynamic IT Operations Orchestrator — FastAPI Application

Multi-agent AIOps platform for autonomous infrastructure monitoring,
predictive failure detection, root cause analysis, and self-healing
remediation with human-in-the-loop approval.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database.session import init_db, SessionLocal
from app.api.routes import infrastructure, incidents, agents, ws, datasources
from app.services.infra_service import InfraService
from app.agents.orchestrator import run_pipeline
from app.agents.monitoring import statistical_anomaly_check
from app.data_sources.simulator import SimulatorDataSource
from app.data_sources.base import registry
from app.config import SIMULATOR_INTERVAL_SECONDS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("itops")

# Background task handle
_monitoring_task: asyncio.Task | None = None


async def background_monitoring_loop():
    """
    Continuous background loop that:
    1. Streams simulated metrics from the data source.
    2. Runs statistical anomaly detection on each batch.
    3. For anomalous nodes, triggers the full LangGraph agent pipeline.
    4. Persists results to the database.

    This is the "always-on" monitoring that makes the system autonomous.
    """
    sim = SimulatorDataSource()
    await sim.connect()
    registry.register(sim)

    logger.info("Background monitoring loop started")

    try:
        async for batch in sim.stream_metrics():
            db = SessionLocal()
            try:
                infra_svc = InfraService(db)
                from app.services.incident_service import IncidentService
                incident_svc = IncidentService(db)

                for event in batch:
                    # Ensure node exists and store metric
                    node = infra_svc.ensure_node_exists(event)
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

                    # Fast statistical check
                    stat_result = statistical_anomaly_check(metrics_dict)
                    infra_svc.store_metric(
                        node, event,
                        is_anomaly=stat_result.get("is_anomaly", False),
                        anomaly_scores=stat_result,
                    )

                    if stat_result.get("is_anomaly"):
                        # Update node status
                        max_sev = stat_result.get("max_severity", "medium")
                        if max_sev == "critical":
                            infra_svc.update_node_status(node, "critical")
                        elif max_sev == "high":
                            infra_svc.update_node_status(node, "degraded")
                        else:
                            infra_svc.update_node_status(node, "degraded")

                        # Full pipeline for anomalous nodes
                        full_metrics = {
                            **metrics_dict,
                            "node_name": event.node_name,
                            "node_type": event.node_type,
                            "provider": event.provider,
                            "region": event.region,
                        }
                        metric_history = infra_svc.get_recent_metrics_as_history(node.id)
                        db.commit()

                        logger.info(f"Anomaly on {event.node_name} ({max_sev}) — running pipeline")
                        try:
                            state = await run_pipeline(full_metrics, metric_history)
                            if state.get("is_anomaly"):
                                incident_svc.create_incident_from_pipeline(node.id, state)
                        except Exception as e:
                            logger.error(f"Pipeline error for {event.node_name}: {e}")
                    else:
                        infra_svc.update_node_status(node, "healthy")

                db.commit()
            except Exception as e:
                logger.error(f"Monitoring loop error: {e}", exc_info=True)
                db.rollback()
            finally:
                db.close()

    except asyncio.CancelledError:
        logger.info("Background monitoring loop cancelled")
    finally:
        await sim.disconnect()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start/stop background monitoring."""
    global _monitoring_task

    # Initialize database
    init_db()
    logger.info("Database initialized")

    # Start background monitoring
    _monitoring_task = asyncio.create_task(background_monitoring_loop())
    logger.info("Background monitoring started")

    yield

    # Shutdown
    if _monitoring_task:
        _monitoring_task.cancel()
        try:
            await _monitoring_task
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(infrastructure.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(datasources.router, prefix="/api")
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
    return {"status": "healthy"}
