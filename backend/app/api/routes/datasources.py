"""Data source configuration & metric ingestion API routes."""

import datetime
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.data_sources.base import registry
from app.services.infra_service import InfraService
from app.data_sources.base import MetricEvent

logger = logging.getLogger("itops.api.datasources")

router = APIRouter(prefix="/datasources", tags=["Data Sources"])


class DataSourceConfig(BaseModel):
    provider: str  # simulated, aws, azure, gcp, prometheus, docker, logfile, custom
    enabled: bool = True
    config: dict = {}


class MetricIngest(BaseModel):
    node_name: str
    node_type: str = "server"
    provider: str = "custom"
    region: str = "custom"
    ip_address: str = "0.0.0.0"
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    disk_percent: float = 0.0
    network_in_mbps: float = 0.0
    network_out_mbps: float = 0.0
    request_rate: float = 0.0
    error_rate: float = 0.0
    latency_ms: float = 0.0


class ConnectionTestRequest(BaseModel):
    provider: str
    config: dict = {}


# In-memory store for configured data sources
_configured_sources: list[dict] = [
    {
        "id": "sim-default",
        "provider": "simulated",
        "name": "Built-in Simulator",
        "enabled": True,
        "status": "connected",
        "config": {},
        "created_at": datetime.datetime.utcnow().isoformat(),
    }
]


@router.get("/")
def list_datasources():
    """List all configured data sources."""
    return {
        "sources": _configured_sources,
        "available_providers": [
            {
                "id": "simulated",
                "name": "Built-in Simulator",
                "description": "Generates realistic simulated infrastructure metrics with anomaly injection",
                "config_fields": [],
            },
            {
                "id": "aws",
                "name": "AWS CloudWatch",
                "description": "Connect to AWS CloudWatch for EC2, RDS, ELB metrics",
                "config_fields": [
                    {"key": "aws_access_key_id", "label": "Access Key ID", "type": "password", "required": True},
                    {"key": "aws_secret_access_key", "label": "Secret Access Key", "type": "password", "required": True},
                    {"key": "region", "label": "AWS Region", "type": "select", "options": ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"], "required": True},
                    {"key": "instance_ids", "label": "Instance IDs (comma-separated)", "type": "text", "required": False},
                ],
            },
            {
                "id": "azure",
                "name": "Azure Monitor",
                "description": "Connect to Azure Monitor for VM, SQL, App Service metrics",
                "config_fields": [
                    {"key": "tenant_id", "label": "Tenant ID", "type": "text", "required": True},
                    {"key": "client_id", "label": "Client ID", "type": "text", "required": True},
                    {"key": "client_secret", "label": "Client Secret", "type": "password", "required": True},
                    {"key": "subscription_id", "label": "Subscription ID", "type": "text", "required": True},
                    {"key": "resource_group", "label": "Resource Group", "type": "text", "required": False},
                ],
            },
            {
                "id": "gcp",
                "name": "GCP Cloud Monitoring",
                "description": "Connect to GCP Cloud Monitoring for Compute Engine, Cloud SQL metrics",
                "config_fields": [
                    {"key": "project_id", "label": "Project ID", "type": "text", "required": True},
                    {"key": "credentials_json", "label": "Service Account JSON", "type": "textarea", "required": True},
                    {"key": "zone", "label": "Zone", "type": "text", "required": False},
                ],
            },
            {
                "id": "prometheus",
                "name": "Prometheus",
                "description": "Scrape metrics from a Prometheus endpoint",
                "config_fields": [
                    {"key": "url", "label": "Prometheus URL", "type": "text", "required": True},
                    {"key": "scrape_interval", "label": "Scrape Interval (seconds)", "type": "number", "required": False},
                    {"key": "auth_token", "label": "Bearer Token", "type": "password", "required": False},
                ],
            },
            {
                "id": "docker",
                "name": "Docker",
                "description": "Monitor Docker containers via Docker daemon API",
                "config_fields": [
                    {"key": "docker_host", "label": "Docker Host", "type": "text", "required": True},
                    {"key": "tls_verify", "label": "TLS Verify", "type": "boolean", "required": False},
                    {"key": "cert_path", "label": "Certificate Path", "type": "text", "required": False},
                ],
            },
            {
                "id": "logfile",
                "name": "Log File Ingestion",
                "description": "Ingest metrics from CSV or JSON log files",
                "config_fields": [
                    {"key": "file_path", "label": "File Path", "type": "text", "required": True},
                    {"key": "format", "label": "Format", "type": "select", "options": ["csv", "json", "jsonl"], "required": True},
                    {"key": "watch", "label": "Watch for changes", "type": "boolean", "required": False},
                ],
            },
            {
                "id": "custom",
                "name": "Custom API Push",
                "description": "Push metrics via REST API (POST /api/datasources/ingest)",
                "config_fields": [],
            },
        ],
    }


@router.post("/configure")
def configure_datasource(body: DataSourceConfig):
    """Add or update a data source configuration."""
    existing = next((s for s in _configured_sources if s["provider"] == body.provider), None)
    if existing:
        existing["enabled"] = body.enabled
        existing["config"] = body.config
        existing["status"] = "configured"
        return {"message": f"Updated {body.provider}", "source": existing}

    new_source = {
        "id": f"{body.provider}-{len(_configured_sources)}",
        "provider": body.provider,
        "name": body.provider.upper(),
        "enabled": body.enabled,
        "status": "configured",
        "config": body.config,
        "created_at": datetime.datetime.utcnow().isoformat(),
    }
    _configured_sources.append(new_source)
    return {"message": f"Configured {body.provider}", "source": new_source}


@router.post("/test")
def test_connection(body: ConnectionTestRequest):
    """Test connection to a data source."""
    # Simulated connection test
    if body.provider == "simulated":
        return {"success": True, "message": "Simulator is always available", "latency_ms": 1}
    elif body.provider == "custom":
        return {"success": True, "message": "Custom API push is ready — use POST /api/datasources/ingest", "latency_ms": 0}
    elif body.provider in ("aws", "azure", "gcp", "prometheus", "docker", "logfile"):
        # In production, actually test the connection here
        missing = [f["key"] for f in _get_required_fields(body.provider) if f["key"] not in body.config]
        if missing:
            return {"success": False, "message": f"Missing required fields: {', '.join(missing)}"}
        return {
            "success": True,
            "message": f"Connection to {body.provider} validated (simulated test)",
            "latency_ms": 150,
        }
    return {"success": False, "message": f"Unknown provider: {body.provider}"}


@router.delete("/{provider}")
def remove_datasource(provider: str):
    """Remove a configured data source."""
    global _configured_sources
    if provider == "simulated":
        raise HTTPException(400, "Cannot remove the built-in simulator")
    _configured_sources = [s for s in _configured_sources if s["provider"] != provider]
    return {"message": f"Removed {provider}"}


@router.post("/ingest")
def ingest_metrics(body: MetricIngest, db: Session = Depends(get_db)):
    """
    Push metrics for a node directly via REST API.
    Use this for custom integrations or manual testing.
    """
    infra_svc = InfraService(db)
    event = MetricEvent(
        node_name=body.node_name,
        node_type=body.node_type,
        provider=body.provider,
        region=body.region,
        ip_address=body.ip_address,
        cpu_percent=body.cpu_percent,
        memory_percent=body.memory_percent,
        disk_percent=body.disk_percent,
        network_in_mbps=body.network_in_mbps,
        network_out_mbps=body.network_out_mbps,
        request_rate=body.request_rate,
        error_rate=body.error_rate,
        latency_ms=body.latency_ms,
    )
    node = infra_svc.ensure_node_exists(event)
    snapshot = infra_svc.store_metric(node, event)
    db.commit()

    return {
        "message": "Metrics ingested",
        "node_id": node.id,
        "snapshot_id": snapshot.id,
        "node_name": body.node_name,
    }


@router.post("/ingest/batch")
def ingest_batch(metrics: list[MetricIngest], db: Session = Depends(get_db)):
    """Push a batch of metrics for multiple nodes."""
    infra_svc = InfraService(db)
    results = []
    for body in metrics:
        event = MetricEvent(
            node_name=body.node_name,
            node_type=body.node_type,
            provider=body.provider,
            region=body.region,
            ip_address=body.ip_address,
            cpu_percent=body.cpu_percent,
            memory_percent=body.memory_percent,
            disk_percent=body.disk_percent,
            network_in_mbps=body.network_in_mbps,
            network_out_mbps=body.network_out_mbps,
            request_rate=body.request_rate,
            error_rate=body.error_rate,
            latency_ms=body.latency_ms,
        )
        node = infra_svc.ensure_node_exists(event)
        infra_svc.store_metric(node, event)
        results.append({"node_name": body.node_name, "node_id": node.id})
    db.commit()
    return {"message": f"Ingested {len(results)} metrics", "results": results}


def _get_required_fields(provider: str) -> list[dict]:
    providers = {
        "aws": [{"key": "aws_access_key_id"}, {"key": "aws_secret_access_key"}, {"key": "region"}],
        "azure": [{"key": "tenant_id"}, {"key": "client_id"}, {"key": "client_secret"}, {"key": "subscription_id"}],
        "gcp": [{"key": "project_id"}, {"key": "credentials_json"}],
        "prometheus": [{"key": "url"}],
        "docker": [{"key": "docker_host"}],
        "logfile": [{"key": "file_path"}, {"key": "format"}],
    }
    return providers.get(provider, [])
