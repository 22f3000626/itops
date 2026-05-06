from __future__ import annotations
"""Pydantic schemas for API request/response models."""

import datetime
from pydantic import BaseModel, Field


# ── Infrastructure ──────────────────────────────────────────────────

class InfraNodeOut(BaseModel):
    id: int
    node_name: str
    node_type: str
    provider: str
    region: str
    status: str
    ip_address: str | None
    metadata: dict = Field(default_factory=dict, alias="metadata_")
    created_at: datetime.datetime | None
    updated_at: datetime.datetime | None

    model_config = {"from_attributes": True, "populate_by_name": True}


class MetricSnapshotOut(BaseModel):
    id: int
    node_id: int
    node_name: str | None = None
    timestamp: datetime.datetime | None
    cpu_percent: float | None
    memory_percent: float | None
    disk_percent: float | None
    network_in_mbps: float | None
    network_out_mbps: float | None
    request_rate: float | None
    error_rate: float | None
    latency_ms: float | None
    is_anomaly: bool
    anomaly_scores: dict = Field(default_factory=dict)

    model_config = {"from_attributes": True}


# ── Incidents ───────────────────────────────────────────────────────

class IncidentOut(BaseModel):
    id: int
    node_id: int
    node_name: str | None = None
    title: str
    description: str | None
    severity: str
    status: str
    detected_at: datetime.datetime | None
    resolved_at: datetime.datetime | None
    root_cause: str | None
    prediction_details: dict = Field(default_factory=dict)
    diagnostic_details: dict = Field(default_factory=dict)
    created_at: datetime.datetime | None

    model_config = {"from_attributes": True}


# ── Remediation ─────────────────────────────────────────────────────

class RemediationOut(BaseModel):
    id: int
    incident_id: int
    action_type: str
    description: str | None
    status: str
    requires_approval: bool
    approved_by: str | None
    canary_stage: str | None
    execution_log: str | None
    started_at: datetime.datetime | None
    completed_at: datetime.datetime | None
    created_at: datetime.datetime | None

    model_config = {"from_attributes": True}


class RemediationArtifactOut(BaseModel):
    id: str
    name: str
    kind: str
    language: str
    purpose: str
    description: str | None = None
    content: str


class RemediationDetailOut(BaseModel):
    id: int
    incident_id: int
    action_type: str
    description: str | None
    status: str
    requires_approval: bool
    approved_by: str | None
    canary_stage: str | None
    execution_log: str | None
    started_at: datetime.datetime | None
    completed_at: datetime.datetime | None
    created_at: datetime.datetime | None
    plan_summary: str | None = None
    strategy: str | None = None
    steps: list[dict] = Field(default_factory=list)
    artifacts: list[RemediationArtifactOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ── Pipeline ────────────────────────────────────────────────────────

class PipelineRunRequest(BaseModel):
    """Manually trigger the pipeline for a specific node or with custom metrics."""
    node_name: str | None = None
    custom_metrics: dict | None = None


class PipelineResult(BaseModel):
    incident_id: int | None
    status: str
    is_anomaly: bool
    severity: str | None
    monitoring_result: dict = Field(default_factory=dict)
    prediction_result: dict = Field(default_factory=dict)
    diagnostic_result: dict = Field(default_factory=dict)
    remediation_result: dict = Field(default_factory=dict)
    reporting_result: dict = Field(default_factory=dict)
    agent_trace: list[dict] = Field(default_factory=list)
    started_at: str | None
    completed_at: str | None


# ── Agent ───────────────────────────────────────────────────────────

class AgentInfo(BaseModel):
    name: str
    description: str
    status: str


class AgentLogOut(BaseModel):
    id: int
    incident_id: int | None
    agent_name: str
    action: str
    input_data: dict = Field(default_factory=dict)
    output_data: dict = Field(default_factory=dict)
    duration_ms: int | None
    timestamp: datetime.datetime | None

    model_config = {"from_attributes": True}


# ── Dashboard ───────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_nodes: int
    healthy_nodes: int
    degraded_nodes: int
    critical_nodes: int
    total_incidents: int
    open_incidents: int
    resolved_incidents: int
    total_remediations: int
    success_rate: float
    memory_incidents_stored: int
    memory_runbooks_stored: int


# ── Runbook ─────────────────────────────────────────────────────────

class RunbookEntryOut(BaseModel):
    id: int
    title: str
    problem_pattern: str
    solution_steps: str
    source_incident_id: int | None
    effectiveness_score: float
    times_used: int
    issue_type: str | None = None
    root_cause: str | None = None
    causal_chain: list[str] | None = None
    blast_radius: list[str] | None = None
    blast_radius_severity: str | None = None
    recommended_actions: list[dict] | None = None
    remediation_summary: str | None = None
    remediation_steps: list[dict] | None = None
    artifacts: list[dict] | None = None
    is_seeded: bool = False
    created_at: datetime.datetime | None

    model_config = {"from_attributes": True}


# ── Simulator ──────────────────────────────────────────────────────

class SimulatorOut(BaseModel):
    id: int
    name: str
    simulator_type: str
    status: str
    log_file_content: str | None = None
    interval_seconds: int
    current_line_index: int
    total_lines: int
    metrics_enabled: bool = False
    metrics_config: dict = Field(default_factory=dict)
    created_at: datetime.datetime | None
    updated_at: datetime.datetime | None

    model_config = {"from_attributes": True}


class SimulatorAction(BaseModel):
    action: str = Field(..., pattern="^(start|stop|pause|reset)$")


class SimulatorMetricsUpdate(BaseModel):
    metrics_enabled: bool
    metrics_config: dict = Field(default_factory=dict)
