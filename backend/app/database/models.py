import datetime
import enum
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime, Enum, Boolean, ForeignKey, JSON
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class Severity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentStatus(str, enum.Enum):
    DETECTED = "detected"
    ANALYZING = "analyzing"
    DIAGNOSED = "diagnosed"
    AWAITING_APPROVAL = "awaiting_approval"
    REMEDIATING = "remediating"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    FAILED = "failed"


class RemediationStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTING = "executing"
    CANARY_5 = "canary_5"
    CANARY_25 = "canary_25"
    CANARY_100 = "canary_100"
    COMPLETED = "completed"
    ROLLED_BACK = "rolled_back"
    FAILED = "failed"


class InfrastructureNode(Base):
    __tablename__ = "infrastructure_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_name = Column(String(255), unique=True, nullable=False)
    node_type = Column(String(50), nullable=False)  # server, database, load_balancer, cache, queue
    provider = Column(String(50), default="simulated")  # aws, azure, gcp, simulated
    region = Column(String(100), default="us-east-1")
    status = Column(String(20), default="healthy")  # healthy, degraded, critical, offline
    ip_address = Column(String(45))
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    metrics = relationship("MetricSnapshot", back_populates="node", cascade="all, delete-orphan")
    incidents = relationship("Incident", back_populates="node", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<InfraNode {self.node_name} ({self.node_type}) - {self.status}>"


class MetricSnapshot(Base):
    __tablename__ = "metric_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(Integer, ForeignKey("infrastructure_nodes.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    cpu_percent = Column(Float)
    memory_percent = Column(Float)
    disk_percent = Column(Float)
    network_in_mbps = Column(Float)
    network_out_mbps = Column(Float)
    request_rate = Column(Float)
    error_rate = Column(Float)
    latency_ms = Column(Float)
    is_anomaly = Column(Boolean, default=False)
    anomaly_scores = Column(JSON, default=dict)

    node = relationship("InfrastructureNode", back_populates="metrics")

    def to_dict(self):
        return {
            "id": self.id,
            "node_id": self.node_id,
            "node_name": self.node.node_name if self.node else None,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "cpu_percent": self.cpu_percent,
            "memory_percent": self.memory_percent,
            "disk_percent": self.disk_percent,
            "network_in_mbps": self.network_in_mbps,
            "network_out_mbps": self.network_out_mbps,
            "request_rate": self.request_rate,
            "error_rate": self.error_rate,
            "latency_ms": self.latency_ms,
            "is_anomaly": self.is_anomaly,
            "anomaly_scores": self.anomaly_scores,
        }


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(Integer, ForeignKey("infrastructure_nodes.id"), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text)
    severity = Column(Enum(Severity), default=Severity.MEDIUM)
    status = Column(Enum(IncidentStatus), default=IncidentStatus.DETECTED)
    detected_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    root_cause = Column(Text, nullable=True)
    prediction_details = Column(JSON, default=dict)
    diagnostic_details = Column(JSON, default=dict)
    metric_snapshot_id = Column(Integer, ForeignKey("metric_snapshots.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    node = relationship("InfrastructureNode", back_populates="incidents")
    metric_snapshot = relationship("MetricSnapshot")
    remediations = relationship("Remediation", back_populates="incident", cascade="all, delete-orphan")
    agent_logs = relationship("AgentLog", back_populates="incident", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Incident #{self.id} [{self.severity.value}] {self.title[:50]}>"


class Remediation(Base):
    __tablename__ = "remediations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=False)
    action_type = Column(String(100), nullable=False)
    description = Column(Text)
    script_content = Column(Text)
    status = Column(Enum(RemediationStatus), default=RemediationStatus.PENDING)
    requires_approval = Column(Boolean, default=False)
    approved_by = Column(String(255), nullable=True)
    canary_stage = Column(String(20), default="pending")
    rollback_script = Column(Text, nullable=True)
    execution_log = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    incident = relationship("Incident", back_populates="remediations")

    def __repr__(self):
        return f"<Remediation #{self.id} [{self.status.value}] {self.action_type}>"


class AgentLog(Base):
    __tablename__ = "agent_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=True)
    agent_name = Column(String(100), nullable=False)
    action = Column(String(255), nullable=False)
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    duration_ms = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    incident = relationship("Incident", back_populates="agent_logs")


class RunbookEntry(Base):
    __tablename__ = "runbook_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False)
    problem_pattern = Column(Text, nullable=False)
    solution_steps = Column(Text, nullable=False)
    source_incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=True)
    effectiveness_score = Column(Float, default=0.0)
    times_used = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
