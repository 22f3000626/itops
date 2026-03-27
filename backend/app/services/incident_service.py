"""Service layer for incident management."""

import datetime
import logging

from sqlalchemy.orm import Session

from app.database.models import (
    Incident, IncidentStatus, Severity, Remediation, RemediationStatus,
    AgentLog, RunbookEntry, InfrastructureNode, MetricSnapshot,
)
from app.memory.vector_store import get_memory
from app.remediation.executor import get_executor

logger = logging.getLogger("itops.incident_service")


class IncidentService:

    def __init__(self, db: Session):
        self.db = db

    def create_incident_from_pipeline(
        self, node_id: int, pipeline_state: dict
    ) -> Incident:
        """Create an incident record from the orchestrator pipeline output."""
        monitoring = pipeline_state.get("monitoring_result", {})
        prediction = pipeline_state.get("prediction_result", {})
        diagnostic = pipeline_state.get("diagnostic_result", {})
        severity_str = pipeline_state.get("severity", "medium")

        try:
            severity = Severity(severity_str)
        except ValueError:
            severity = Severity.MEDIUM

        status_str = pipeline_state.get("status", "detected")
        try:
            status = IncidentStatus(status_str)
        except ValueError:
            status = IncidentStatus.DETECTED

        incident = Incident(
            node_id=node_id,
            title=f"{monitoring.get('anomaly_type', 'Anomaly')} on node (severity: {severity_str})",
            description=monitoring.get("description", ""),
            severity=severity,
            status=status,
            root_cause=diagnostic.get("root_cause"),
            prediction_details=prediction,
            diagnostic_details=diagnostic,
        )
        self.db.add(incident)
        self.db.flush()

        # Log each agent's work
        for trace in pipeline_state.get("agent_trace", []):
            log = AgentLog(
                incident_id=incident.id,
                agent_name=trace.get("agent", "unknown"),
                action=f"pipeline_{trace.get('agent', 'unknown')}",
                output_data=trace,
                duration_ms=self._calc_duration(
                    trace.get("started_at"), trace.get("completed_at")
                ),
            )
            self.db.add(log)

        # Create remediation record if pipeline produced one
        remediation_data = pipeline_state.get("remediation_result", {})
        if remediation_data.get("steps"):
            needs_approval = pipeline_state.get("needs_human_approval", False)
            rem = Remediation(
                incident_id=incident.id,
                action_type=remediation_data.get("plan_summary", "auto-remediation")[:100],
                description=remediation_data.get("plan_summary", ""),
                script_content=str(remediation_data.get("steps", [])),
                status=(
                    RemediationStatus.PENDING
                    if needs_approval
                    else RemediationStatus.APPROVED
                ),
                requires_approval=needs_approval,
            )
            if not needs_approval:
                rem.status = RemediationStatus.APPROVED
            self.db.add(rem)

            if needs_approval:
                incident.status = IncidentStatus.AWAITING_APPROVAL

        # Store in vector memory for RAG
        if diagnostic.get("root_cause"):
            try:
                memory = get_memory()
                memory.store_incident(
                    incident_id=incident.id,
                    title=incident.title,
                    description=incident.description or "",
                    root_cause=diagnostic.get("root_cause", ""),
                    resolution=remediation_data.get("plan_summary", ""),
                    severity=severity_str,
                    node_type=pipeline_state.get("metrics", {}).get("node_type", "server"),
                )
            except Exception as e:
                logger.warning(f"Failed to store in vector memory: {e}")

        # Create runbook entry from reporting
        reporting = pipeline_state.get("reporting_result", {})
        runbook_data = reporting.get("runbook_entry")
        if runbook_data and runbook_data.get("title"):
            runbook = RunbookEntry(
                title=runbook_data["title"],
                problem_pattern=runbook_data.get("problem_pattern", ""),
                solution_steps=runbook_data.get("solution_steps", ""),
                source_incident_id=incident.id,
            )
            self.db.add(runbook)
            self.db.flush()
            try:
                memory = get_memory()
                memory.store_runbook(
                    runbook_id=runbook.id,
                    title=runbook.title,
                    problem_pattern=runbook.problem_pattern,
                    solution_steps=runbook.solution_steps,
                )
            except Exception as e:
                logger.warning(f"Failed to store runbook in vector memory: {e}")

        self.db.commit()
        self.db.refresh(incident)
        return incident

    async def approve_incident(
        self, incident_id: int, approved_by: str, decision: str
    ) -> Incident | None:
        """Approve or reject remediation for an incident."""
        incident = self.db.query(Incident).get(incident_id)
        if not incident:
            return None

        remediation = (
            self.db.query(Remediation)
            .filter(Remediation.incident_id == incident_id)
            .first()
        )

        if decision == "approved":
            incident.status = IncidentStatus.REMEDIATING
            if remediation:
                remediation.status = RemediationStatus.APPROVED
                remediation.approved_by = approved_by

                # Execute remediation
                import json
                try:
                    steps = json.loads(remediation.script_content) if isinstance(remediation.script_content, str) else remediation.script_content
                except (json.JSONDecodeError, TypeError):
                    steps = []

                executor = get_executor()
                exec_result = await executor.execute_remediation({"steps": steps if isinstance(steps, list) else []})

                if exec_result["success"]:
                    remediation.status = RemediationStatus.COMPLETED
                    remediation.completed_at = datetime.datetime.utcnow()
                    incident.status = IncidentStatus.RESOLVED
                    incident.resolved_at = datetime.datetime.utcnow()
                else:
                    remediation.status = RemediationStatus.FAILED
                    incident.status = IncidentStatus.FAILED

                remediation.execution_log = str(exec_result.get("execution_log", []))

        elif decision == "rejected":
            incident.status = IncidentStatus.ESCALATED
            if remediation:
                remediation.status = RemediationStatus.REJECTED

        self.db.commit()
        self.db.refresh(incident)
        return incident

    def get_incidents(self, status: str | None = None, limit: int = 50) -> list[Incident]:
        query = self.db.query(Incident).order_by(Incident.created_at.desc())
        if status:
            try:
                query = query.filter(Incident.status == IncidentStatus(status))
            except ValueError:
                pass
        return query.limit(limit).all()

    def get_incident(self, incident_id: int) -> Incident | None:
        return self.db.query(Incident).get(incident_id)

    def get_incident_agent_logs(self, incident_id: int) -> list[AgentLog]:
        return (
            self.db.query(AgentLog)
            .filter(AgentLog.incident_id == incident_id)
            .order_by(AgentLog.timestamp)
            .all()
        )

    @staticmethod
    def _calc_duration(start: str | None, end: str | None) -> int | None:
        if not start or not end:
            return None
        try:
            s = datetime.datetime.fromisoformat(start)
            e = datetime.datetime.fromisoformat(end)
            return int((e - s).total_seconds() * 1000)
        except Exception:
            return None
