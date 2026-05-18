from __future__ import annotations

"""
Predictive Agent — failure forecasting.

Uses lightweight local heuristics so the pipeline can return quickly
without waiting on another model round-trip.
"""

import re

SEVERITY_BASE_SCORE = {
    "low": 0.2,
    "medium": 0.45,
    "high": 0.72,
    "critical": 0.9,
}

ANOMALY_IMPACTS = {
    "memory_leak": "the service may hit OOM conditions and start failing requests",
    "cpu_spike": "request latency and timeout rates may continue to rise",
    "disk_full": "writes, log rotation, and service recovery may fail",
    "network_saturation": "network drops and upstream communication failures may spread",
    "connection_pool_exhaustion": "application requests may fail while waiting for database connections",
    "cascading_failure": "dependent services may fail in sequence as retries pile up",
    "latency_degradation": "user-facing response times may breach SLA thresholds",
    "error_spike": "the service may become unstable under continued request failures",
}

ANOMALY_ESCALATION = {
    "memory_leak": "medium",
    "cpu_spike": "medium",
    "disk_full": "high",
    "network_saturation": "high",
    "connection_pool_exhaustion": "high",
    "cascading_failure": "high",
    "latency_degradation": "medium",
    "error_spike": "medium",
}


def _parse_history_tail(metric_history: str) -> list[dict[str, float]]:
    readings: list[dict[str, float]] = []
    if not metric_history or "No history available" in metric_history:
        return readings

    pattern = re.compile(
        r"CPU=(?P<cpu>[\d.]+)% MEM=(?P<mem>[\d.]+)% DISK=(?P<disk>[\d.]+)% "
        r"ERR=(?P<err>[\d.]+)% LAT=(?P<lat>[\d.]+)ms NET_IN=(?P<net>[\d.]+)Mbps"
    )
    for line in metric_history.splitlines():
        match = pattern.search(line)
        if not match:
            continue
        readings.append({k: float(v) for k, v in match.groupdict().items()})
    return readings[-8:]


def _ewma(values: list[float], alpha: float = 0.3) -> list[float]:
    """Exponential Weighted Moving Average."""
    if not values:
        return []
    result = [values[0]]
    for v in values[1:]:
        result.append(alpha * v + (1.0 - alpha) * result[-1])
    return result


def _ewma_slope(values: list[float], alpha: float = 0.3) -> float:
    """Slope of the EWMA series normalised by number of steps."""
    if len(values) < 2:
        return 0.0
    smoothed = _ewma(values, alpha)
    return (smoothed[-1] - smoothed[0]) / max(len(smoothed) - 1, 1)


def _trend_boost(metrics: dict, history: list[dict[str, float]]) -> float:
    """EWMA-based trend scoring — steeper slope = higher boost."""
    if not history:
        return 0.0

    boost = 0.0

    if metrics.get("memory_percent", 0) >= 80:
        slope = _ewma_slope([r["mem"] for r in history if "mem" in r])
        if slope >= 2.0:
            boost += min(0.12, slope * 0.015)

    if metrics.get("disk_percent", 0) >= 80:
        slope = _ewma_slope([r["disk"] for r in history if "disk" in r])
        if slope >= 1.0:
            boost += min(0.10, slope * 0.02)

    if metrics.get("error_rate", 0) >= 3:
        slope = _ewma_slope([r["err"] for r in history if "err" in r])
        if slope >= 0.5:
            boost += min(0.12, slope * 0.025)

    if metrics.get("latency_ms", 0) >= 300:
        slope = _ewma_slope([r["lat"] for r in history if "lat" in r])
        if slope >= 50.0:
            boost += min(0.10, slope * 0.0005)

    if metrics.get("cpu_percent", 0) >= 80:
        slope = _ewma_slope([r["cpu"] for r in history if "cpu" in r])
        if slope >= 2.0:
            boost += min(0.08, slope * 0.012)

    return boost


def _multi_metric_correlation_bonus(metrics: dict) -> float:
    """Extra probability boost when 3+ metrics are simultaneously elevated."""
    elevated = sum([
        metrics.get("cpu_percent", 0) >= 80,
        metrics.get("memory_percent", 0) >= 80,
        metrics.get("disk_percent", 0) >= 80,
        metrics.get("error_rate", 0) >= 5,
        metrics.get("latency_ms", 0) >= 500,
        metrics.get("network_in_mbps", 0) >= 800,
    ])
    if elevated >= 5:
        return 0.12
    if elevated >= 4:
        return 0.08
    if elevated >= 3:
        return 0.05
    return 0.0


def _metric_pressure(metrics: dict) -> float:
    score = 0.0
    if metrics.get("cpu_percent", 0) >= 95:
        score += 0.08
    if metrics.get("memory_percent", 0) >= 95:
        score += 0.1
    if metrics.get("disk_percent", 0) >= 95:
        score += 0.12
    if metrics.get("error_rate", 0) >= 15:
        score += 0.12
    if metrics.get("latency_ms", 0) >= 2000:
        score += 0.1
    if metrics.get("network_in_mbps", 0) >= 950:
        score += 0.08
    return score


def _estimate_time_to_failure(failure_probability: float, anomaly_type: str, metrics: dict) -> int | None:
    if failure_probability < 0.35:
        return None
    if anomaly_type == "disk_full":
        return 5 if metrics.get("disk_percent", 0) >= 95 else 15
    if anomaly_type in {"cascading_failure", "connection_pool_exhaustion"}:
        return 10
    if anomaly_type in {"memory_leak", "cpu_spike"}:
        return 15
    if failure_probability >= 0.85:
        return 10
    if failure_probability >= 0.65:
        return 20
    return 30


async def predict_failure(
    anomaly_data: dict,
    metrics: dict,
    metric_history: str = "No history available",
    log_history: str = "No logs available",
) -> dict:
    """Predict failure trajectory using fast local heuristics."""
    anomaly_type = anomaly_data.get("anomaly_type") or "threshold_breach"
    severity = anomaly_data.get("severity") or "medium"

    history = _parse_history_tail(metric_history)
    score = SEVERITY_BASE_SCORE.get(severity, 0.45)
    score += _metric_pressure(metrics)
    score += _trend_boost(metrics, history)
    score += _multi_metric_correlation_bonus(metrics)

    if anomaly_type == "cascading_failure":
        score = max(score, 0.92)
    if anomaly_type == "disk_full" and metrics.get("disk_percent", 0) >= 95:
        score = max(score, 0.94)
    if anomaly_type == "connection_pool_exhaustion" and metrics.get("latency_ms", 0) >= 1000:
        score = max(score, 0.88)

    failure_probability = round(min(score, 0.98), 2)
    escalation_risk = ANOMALY_ESCALATION.get(anomaly_type, "medium")
    predicted_impact = ANOMALY_IMPACTS.get(anomaly_type)

    if predicted_impact is None:
        # Unknown anomaly type — try LLM for a meaningful prediction
        try:
            from app.agents.llm_fallback import llm_predict_impact
            llm_result = await llm_predict_impact(anomaly_type, metrics)
            if llm_result:
                predicted_impact = llm_result.get("predicted_impact", "")
                escalation_risk = llm_result.get("escalation_risk", escalation_risk)
        except Exception:
            pass
        if not predicted_impact:
            predicted_impact = "service health may continue to degrade if no corrective action is taken"

    estimated_time_to_failure = _estimate_time_to_failure(failure_probability, anomaly_type, metrics)

    if failure_probability >= 0.85:
        recommended_urgency = "immediate"
    elif failure_probability >= 0.55:
        recommended_urgency = "soon"
    else:
        recommended_urgency = "monitor"

    reasoning_parts = [
        f"Severity is {severity}",
        f"current anomaly type is {anomaly_type.replace('_', ' ')}",
    ]
    if history:
        reasoning_parts.append("recent metric history shows continued pressure")
    if "ERROR" in log_history.upper() or "CRITICAL" in log_history.upper():
        reasoning_parts.append("recent logs include high-severity events")

    return {
        "failure_probability": failure_probability,
        "predicted_impact": predicted_impact,
        "escalation_risk": escalation_risk,
        "estimated_time_to_failure": estimated_time_to_failure,
        "recommended_urgency": recommended_urgency,
        "reasoning": "; ".join(reasoning_parts) + ".",
        "ewma_scores": {
            "cpu_slope": round(_ewma_slope([r["cpu"] for r in history if "cpu" in r]), 3),
            "mem_slope": round(_ewma_slope([r["mem"] for r in history if "mem" in r]), 3),
            "err_slope": round(_ewma_slope([r["err"] for r in history if "err" in r]), 3),
        },
        "agent": "predictive",
    }
