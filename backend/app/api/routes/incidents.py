"""Incident management API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.api.schemas import IncidentOut, IncidentApproval, AgentLogOut
from app.services.incident_service import IncidentService

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.get("/", response_model=list[IncidentOut])
def list_incidents(
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    svc = IncidentService(db)
    incidents = svc.get_incidents(status=status, limit=limit)
    return [_to_out(i) for i in incidents]


@router.get("/{incident_id}", response_model=IncidentOut)
def get_incident(incident_id: int, db: Session = Depends(get_db)):
    svc = IncidentService(db)
    incident = svc.get_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _to_out(incident)


@router.post("/{incident_id}/approve", response_model=IncidentOut)
async def approve_incident(
    incident_id: int,
    body: IncidentApproval,
    db: Session = Depends(get_db),
):
    """Human-in-the-loop: approve or reject remediation for an incident."""
    svc = IncidentService(db)
    incident = await svc.approve_incident(
        incident_id, approved_by=body.approved_by, decision=body.decision
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _to_out(incident)


@router.get("/{incident_id}/logs", response_model=list[AgentLogOut])
def get_incident_logs(incident_id: int, db: Session = Depends(get_db)):
    svc = IncidentService(db)
    logs = svc.get_incident_agent_logs(incident_id)
    return [
        AgentLogOut(
            id=log.id,
            incident_id=log.incident_id,
            agent_name=log.agent_name,
            action=log.action,
            input_data=log.input_data or {},
            output_data=log.output_data or {},
            duration_ms=log.duration_ms,
            timestamp=log.timestamp,
        )
        for log in logs
    ]


def _to_out(incident) -> IncidentOut:
    return IncidentOut(
        id=incident.id,
        node_id=incident.node_id,
        node_name=incident.node.node_name if incident.node else None,
        title=incident.title,
        description=incident.description,
        severity=incident.severity.value if incident.severity else "medium",
        status=incident.status.value if incident.status else "detected",
        detected_at=incident.detected_at,
        resolved_at=incident.resolved_at,
        root_cause=incident.root_cause,
        prediction_details=incident.prediction_details or {},
        diagnostic_details=incident.diagnostic_details or {},
        created_at=incident.created_at,
    )
