from __future__ import annotations
"""Service layer for infrastructure and metrics management."""

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.models import (
    InfrastructureNode, MetricSnapshot, Incident, Remediation,
    IncidentStatus, RemediationStatus, LogEntry,
)
from app.data_sources.base import MetricEvent, LogEvent
from app.config import utc_now

logger = logging.getLogger("itops.infra_service")


class InfraService:

    def __init__(self, db: Session):
        self.db = db

    def ensure_node_exists(self, event: MetricEvent) -> InfrastructureNode:
        """Create or update an infrastructure node from a metric event."""
        node = (
            self.db.query(InfrastructureNode)
            .filter(InfrastructureNode.node_name == event.node_name)
            .first()
        )
        if not node:
            node = InfrastructureNode(
                node_name=event.node_name,
                node_type=event.node_type,
                provider=event.provider,
                region=event.region,
                ip_address=event.ip_address,
                status="healthy",
            )
            self.db.add(node)
            self.db.flush()
        return node

    def store_metric(
        self, node: InfrastructureNode, event: MetricEvent, is_anomaly: bool = False,
        anomaly_scores: dict | None = None,
    ) -> MetricSnapshot:
        """Store a metric snapshot."""
        snapshot = MetricSnapshot(
            node_id=node.id,
            cpu_percent=event.cpu_percent,
            memory_percent=event.memory_percent,
            disk_percent=event.disk_percent,
            network_in_mbps=event.network_in_mbps,
            network_out_mbps=event.network_out_mbps,
            request_rate=event.request_rate,
            error_rate=event.error_rate,
            latency_ms=event.latency_ms,
            is_anomaly=is_anomaly,
            anomaly_scores=anomaly_scores or {},
        )
        self.db.add(snapshot)
        self.db.flush()
        return snapshot

    def update_node_status(self, node: InfrastructureNode, status: str) -> None:
        """Update node health status."""
        node.status = status
        node.updated_at = utc_now()
        self.db.flush()

    def get_all_nodes(self) -> list[InfrastructureNode]:
        return self.db.query(InfrastructureNode).order_by(InfrastructureNode.node_name).all()

    def get_node(self, node_id: int) -> InfrastructureNode | None:
        return self.db.get(InfrastructureNode, node_id)

    def get_node_by_name(self, name: str) -> InfrastructureNode | None:
        return (
            self.db.query(InfrastructureNode)
            .filter(InfrastructureNode.node_name == name)
            .first()
        )

    def get_node_metrics(
        self, node_id: int, limit: int = 50
    ) -> list[MetricSnapshot]:
        return (
            self.db.query(MetricSnapshot)
            .filter(MetricSnapshot.node_id == node_id)
            .order_by(MetricSnapshot.timestamp.desc())
            .limit(limit)
            .all()
        )

    def get_recent_metrics_as_history(self, node_id: int, limit: int = 10) -> str:
        """Get recent metrics formatted as a string for agent context."""
        metrics = self.get_node_metrics(node_id, limit)
        if not metrics:
            return "No historical metrics available."

        lines = []
        for m in reversed(metrics):
            lines.append(
                f"[{m.timestamp.isoformat() if m.timestamp else 'N/A'}] "
                f"CPU={m.cpu_percent}% MEM={m.memory_percent}% DISK={m.disk_percent}% "
                f"ERR={m.error_rate}% LAT={m.latency_ms}ms NET_IN={m.network_in_mbps}Mbps"
            )
        return "\n".join(lines)

    def store_log(self, node: InfrastructureNode, log_event: LogEvent) -> LogEntry:
        """Store a single log entry."""
        entry = LogEntry(
            node_id=node.id,
            timestamp=log_event.timestamp,
            level=log_event.level,
            source=log_event.source,
            message=log_event.message,
        )
        self.db.add(entry)
        self.db.flush()
        return entry

    def store_logs_batch(self, node: InfrastructureNode, log_events: list[LogEvent]) -> None:
        """Store multiple log entries efficiently."""
        for le in log_events:
            self.db.add(LogEntry(
                node_id=node.id,
                timestamp=le.timestamp,
                level=le.level,
                source=le.source,
                message=le.message,
            ))
        self.db.flush()

    def get_recent_logs(self, node_id: int, limit: int = 20) -> list[LogEntry]:
        """Get recent log entries for a node."""
        return (
            self.db.query(LogEntry)
            .filter(LogEntry.node_id == node_id)
            .order_by(LogEntry.timestamp.desc())
            .limit(limit)
            .all()
        )

    def get_recent_logs_as_history(self, node_id: int, limit: int = 20) -> str:
        """Get recent logs formatted as a string for agent context."""
        logs = self.get_recent_logs(node_id, limit)
        if not logs:
            return "No recent logs available."
        lines = []
        for log in reversed(logs):
            ts = log.timestamp.isoformat() if log.timestamp else "N/A"
            lines.append(f"[{ts}] {log.level} ({log.source}): {log.message}")
        return "\n".join(lines)

    def get_aggregated_history(self, points: int = 32) -> list[dict]:
        """Return up to `points` time-bucketed (per-second) fleet-wide averages."""
        bucket = func.strftime('%Y-%m-%dT%H:%M:%S', MetricSnapshot.timestamp).label('bucket')
        rows = (
            self.db.query(
                bucket,
                func.avg(MetricSnapshot.cpu_percent).label('cpu'),
                func.avg(MetricSnapshot.memory_percent).label('mem'),
                func.avg(MetricSnapshot.error_rate).label('err'),
                func.avg(MetricSnapshot.latency_ms).label('lat'),
            )
            .group_by(bucket)
            .order_by(bucket.desc())
            .limit(points)
            .all()
        )
        return [
            {
                'time': row.bucket,
                'cpu': round(row.cpu or 0, 1),
                'mem': round(row.mem or 0, 1),
                'err': round(row.err or 0, 1),
                'lat': round(row.lat or 0, 1),
            }
            for row in reversed(rows)
        ]

    def get_latest_metric_snapshot(self, node_id: int) -> MetricSnapshot | None:
        """Get the most recent metric snapshot for a node."""
        return (
            self.db.query(MetricSnapshot)
            .filter(MetricSnapshot.node_id == node_id)
            .order_by(MetricSnapshot.timestamp.desc())
            .first()
        )

    def get_dashboard_stats(self) -> dict:
        """Aggregate stats for the dashboard."""
        nodes = self.db.query(InfrastructureNode).all()
        incidents = self.db.query(Incident).all()
        remediations = self.db.query(Remediation).all()

        healthy = sum(1 for n in nodes if n.status == "healthy")
        degraded = sum(1 for n in nodes if n.status == "degraded")
        critical = sum(1 for n in nodes if n.status in ("critical", "offline"))

        open_statuses = {
            IncidentStatus.DETECTED, IncidentStatus.ANALYZING,
            IncidentStatus.DIAGNOSED, IncidentStatus.AWAITING_APPROVAL,
            IncidentStatus.REMEDIATING,
        }
        open_incidents = sum(1 for i in incidents if i.status in open_statuses)
        resolved = sum(1 for i in incidents if i.status == IncidentStatus.RESOLVED)
        completed_rem = sum(
            1 for r in remediations if r.status == RemediationStatus.COMPLETED
        )
        total_rem = len(remediations)
        success_rate = (completed_rem / total_rem * 100) if total_rem > 0 else 0.0

        # Vector memory stats
        try:
            from app.memory.vector_store import get_memory
            mem = get_memory()
            mem_incidents = mem.incident_count
            mem_runbooks = mem.runbook_count
        except Exception:
            mem_incidents = 0
            mem_runbooks = 0

        return {
            "total_nodes": len(nodes),
            "healthy_nodes": healthy,
            "degraded_nodes": degraded,
            "critical_nodes": critical,
            "total_incidents": len(incidents),
            "open_incidents": open_incidents,
            "resolved_incidents": resolved,
            "total_remediations": total_rem,
            "success_rate": round(success_rate, 1),
            "memory_incidents_stored": mem_incidents,
            "memory_runbooks_stored": mem_runbooks,
        }
