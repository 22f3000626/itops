from __future__ import annotations

"""
Reporting Agent — incident summarization and runbook generation.

This stage intentionally avoids an extra LLM round-trip so the
pipeline can finish quickly once remediation planning is complete.
"""

import re


def _clean_text(value: str | None, fallback: str) -> str:
    text = re.sub(r"\s+", " ", (value or "").strip())
    return text or fallback


def _titleize_anomaly(anomaly_type: str | None) -> str:
    raw = (anomaly_type or "incident").replace("_", " ").strip()
    return raw.title() if raw else "Incident"


def _build_runbook_title(node_name: str, anomaly_type: str | None, root_cause: str | None) -> str:
    anomaly = _titleize_anomaly(anomaly_type)
    cause = _clean_text(root_cause, "")
    if cause and cause.lower() != "n/a":
        return f"{anomaly} on {node_name}: {cause[:80]}"
    return f"{anomaly} on {node_name}"


def _build_executive_summary(
    node_name: str,
    severity: str,
    anomaly_type: str | None,
    root_cause: str | None,
    remediation_summary: str | None,
    predicted_impact: str | None,
    outcome: str,
) -> str:
    anomaly = (anomaly_type or "incident").replace("_", " ")
    cause = _clean_text(root_cause, "root cause requires review")
    remediation = _clean_text(remediation_summary, "manual remediation planning")
    impact = _clean_text(predicted_impact, "")

    summary = (
        f"{severity.title()} {anomaly} detected on {node_name}. "
        f"Most likely root cause: {cause}. "
        f"Recommended response: {remediation}."
    )
    if impact:
        summary += f" Expected impact if untreated: {impact}."
    if outcome:
        summary += f" Current outcome: {outcome}."
    return summary


def _build_timeline(agent_trace: list[dict]) -> list[dict]:
    timeline = []
    for entry in agent_trace:
        started = entry.get("started_at")
        completed = entry.get("completed_at")
        duration_ms = None
        if started and completed:
            try:
                import datetime
                s = datetime.datetime.fromisoformat(started)
                c = datetime.datetime.fromisoformat(completed)
                duration_ms = int((c - s).total_seconds() * 1000)
            except Exception:
                pass
        timeline.append({
            "agent": entry.get("agent", "unknown"),
            "started_at": started,
            "completed_at": completed,
            "duration_ms": duration_ms,
        })
    return timeline


def _build_mttr_estimate(agent_trace: list[dict], remediation_data: dict) -> int | None:
    pipeline_ms = 0
    for entry in agent_trace:
        started = entry.get("started_at")
        completed = entry.get("completed_at")
        if started and completed:
            try:
                import datetime
                s = datetime.datetime.fromisoformat(started)
                c = datetime.datetime.fromisoformat(completed)
                pipeline_ms += int((c - s).total_seconds() * 1000)
            except Exception:
                pass
    remediation_seconds = remediation_data.get("total_estimated_duration_seconds", 0) or 0
    total_ms = pipeline_ms + remediation_seconds * 1000
    if total_ms <= 0:
        return None
    return max(1, round(total_ms / 60000))


def _build_sla_impact(severity: str, predicted_impact: str | None, anomaly_type: str | None) -> str:
    severity_map = {
        "critical": "P1 — immediate user-facing impact expected",
        "high": "P2 — degraded service; SLA breach likely within 30 minutes without action",
        "medium": "P3 — partial degradation; monitor closely",
        "low": "P4 — minor impact; no immediate SLA risk",
    }
    base = severity_map.get((severity or "medium").lower(), severity_map["medium"])
    impact = _clean_text(predicted_impact, "")
    if impact:
        return f"{base}. {impact}"
    return base


async def generate_report(
    monitoring_data: dict,
    prediction_data: dict,
    diagnostic_data: dict,
    remediation_data: dict,
    metrics: dict,
    outcome: str = "resolved",
    log_history: str = "No logs available",
    agent_trace: list[dict] | None = None,
) -> dict:
    """Generate a concise incident report without blocking on the model."""
    agent_trace = agent_trace or []
    node_name = metrics.get("node_name", "unknown")
    severity = monitoring_data.get("severity") or "medium"
    anomaly_type = monitoring_data.get("anomaly_type")
    root_cause = diagnostic_data.get("root_cause")
    remediation_summary = remediation_data.get("plan_summary")

    timeline = _build_timeline(agent_trace)
    mttr = _build_mttr_estimate(agent_trace, remediation_data)
    sla_impact = _build_sla_impact(
        severity=severity,
        predicted_impact=prediction_data.get("predicted_impact"),
        anomaly_type=anomaly_type,
    )

    return {
        "executive_summary": _build_executive_summary(
            node_name=node_name,
            severity=severity,
            anomaly_type=anomaly_type,
            root_cause=root_cause,
            remediation_summary=remediation_summary,
            predicted_impact=prediction_data.get("predicted_impact"),
            outcome=outcome,
        ),
        "runbook_title": _build_runbook_title(
            node_name=node_name,
            anomaly_type=anomaly_type,
            root_cause=root_cause,
        ),
        "mttr_estimate_minutes": mttr,
        "sla_impact": sla_impact,
        "timeline": timeline,
        "generated_locally": True,
        "agent": "reporting",
    }
