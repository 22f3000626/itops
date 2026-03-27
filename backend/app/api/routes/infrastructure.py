"""Infrastructure & metrics API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.api.schemas import InfraNodeOut, MetricSnapshotOut, DashboardStats
from app.services.infra_service import InfraService

router = APIRouter(prefix="/infrastructure", tags=["Infrastructure"])


@router.get("/nodes", response_model=list[InfraNodeOut])
def list_nodes(db: Session = Depends(get_db)):
    svc = InfraService(db)
    nodes = svc.get_all_nodes()
    results = []
    for n in nodes:
        results.append(InfraNodeOut(
            id=n.id,
            node_name=n.node_name,
            node_type=n.node_type,
            provider=n.provider,
            region=n.region,
            status=n.status,
            ip_address=n.ip_address,
            metadata_=n.metadata_ or {},
            created_at=n.created_at,
            updated_at=n.updated_at,
        ))
    return results


@router.get("/nodes/{node_id}", response_model=InfraNodeOut)
def get_node(node_id: int, db: Session = Depends(get_db)):
    svc = InfraService(db)
    node = svc.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return InfraNodeOut(
        id=node.id,
        node_name=node.node_name,
        node_type=node.node_type,
        provider=node.provider,
        region=node.region,
        status=node.status,
        ip_address=node.ip_address,
        metadata_=node.metadata_ or {},
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.get("/nodes/{node_id}/metrics", response_model=list[MetricSnapshotOut])
def get_node_metrics(node_id: int, limit: int = 50, db: Session = Depends(get_db)):
    svc = InfraService(db)
    node = svc.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    metrics = svc.get_node_metrics(node_id, limit)
    return [
        MetricSnapshotOut(
            id=m.id,
            node_id=m.node_id,
            node_name=node.node_name,
            timestamp=m.timestamp,
            cpu_percent=m.cpu_percent,
            memory_percent=m.memory_percent,
            disk_percent=m.disk_percent,
            network_in_mbps=m.network_in_mbps,
            network_out_mbps=m.network_out_mbps,
            request_rate=m.request_rate,
            error_rate=m.error_rate,
            latency_ms=m.latency_ms,
            is_anomaly=m.is_anomaly,
            anomaly_scores=m.anomaly_scores or {},
        )
        for m in metrics
    ]


@router.get("/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)):
    svc = InfraService(db)
    return svc.get_dashboard_stats()
