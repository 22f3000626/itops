from __future__ import annotations

"""
Diagnostic Agent — root cause analysis.

Performs fast deterministic reasoning over metrics, logs, and previously
stored incidents/runbooks so incidents can be explained without waiting
for another model call.
"""

import asyncio

from app.memory.vector_store import get_memory

ISSUE_PROFILES = {
    "memory_leak": {
        "root_cause": "application memory consumption is growing until the node is under OOM pressure",
        "blast_radius": ["the affected node", "services routed to this node"],
        "blast_radius_severity": "medium",
        "causal_chain": [
            "application allocates memory faster than it releases it",
            "memory pressure increases and GC / reclaim overhead grows",
            "latency increases and the service risks OOM termination",
        ],
        "recommended_actions": [
            {"action": "Restart the affected service", "type": "restart_service", "priority": 1, "description": "recover memory headroom quickly"},
            {"action": "Inspect heap / process growth and reduce memory pressure", "type": "config_change", "priority": 2, "description": "identify the leaking component or workload"},
            {"action": "Add headroom or scale replicas if usage returns quickly", "type": "scale_up", "priority": 3, "description": "stabilize the service while the leak is investigated"},
        ],
    },
    "cpu_spike": {
        "root_cause": "a runaway workload or exhausted worker pool is saturating CPU on the node",
        "blast_radius": ["the affected node", "requests handled by this service"],
        "blast_radius_severity": "medium",
        "causal_chain": [
            "CPU saturation slows request processing",
            "queues build up and timeouts begin to appear",
            "error rate and latency rise for the service",
        ],
        "recommended_actions": [
            {"action": "Restart the impacted service or worker process", "type": "restart_service", "priority": 1, "description": "clear the runaway process quickly"},
            {"action": "Limit expensive workload or scale out processing", "type": "rate_limit", "priority": 2, "description": "reduce pressure while the root trigger is reviewed"},
            {"action": "Capture process/thread diagnostics", "type": "config_change", "priority": 3, "description": "identify hot paths or background jobs causing CPU burn"},
        ],
    },
    "disk_full": {
        "root_cause": "local disk capacity is exhausted, usually by logs, temp files, or write-ahead data growth",
        "blast_radius": ["the affected node", "write paths that depend on local storage"],
        "blast_radius_severity": "high",
        "causal_chain": [
            "disk utilization reaches a critical threshold",
            "writes begin to fail and log rotation / WAL growth cannot proceed",
            "service health degrades because it cannot persist required data",
        ],
        "recommended_actions": [
            {"action": "Free disk space by rotating or removing non-critical files", "type": "clear_disk", "priority": 1, "description": "recover write capacity immediately"},
            {"action": "Restart the impacted service after space is recovered", "type": "restart_service", "priority": 2, "description": "bring failed writers back cleanly"},
            {"action": "Increase disk headroom or retention policy", "type": "scale_up", "priority": 3, "description": "prevent rapid recurrence"},
        ],
    },
    "network_saturation": {
        "root_cause": "network throughput or connection tracking capacity is exhausted on the node or edge",
        "blast_radius": ["the affected node", "upstream and downstream dependencies"],
        "blast_radius_severity": "high",
        "causal_chain": [
            "network buffers and connection tables fill under abnormal traffic",
            "packet loss and connection resets increase",
            "service-to-service communication becomes unreliable",
        ],
        "recommended_actions": [
            {"action": "Rate-limit or block abusive traffic", "type": "rate_limit", "priority": 1, "description": "reduce immediate saturation"},
            {"action": "Restart edge service if connection state is wedged", "type": "restart_service", "priority": 2, "description": "clear overloaded workers or listeners"},
            {"action": "Tune or scale network handling capacity", "type": "config_change", "priority": 3, "description": "avoid repeated conntrack or buffer exhaustion"},
        ],
    },
    "connection_pool_exhaustion": {
        "root_cause": "the application cannot obtain database connections because the pool is exhausted or the backend is saturated",
        "blast_radius": ["the affected application", "database-backed request paths"],
        "blast_radius_severity": "high",
        "causal_chain": [
            "connection demand exceeds pool capacity",
            "requests wait for idle connections and latency increases",
            "timeouts and request failures occur across database-backed operations",
        ],
        "recommended_actions": [
            {"action": "Restart the application or pool manager", "type": "restart_service", "priority": 1, "description": "clear stuck or leaked connections"},
            {"action": "Reduce inflight traffic temporarily", "type": "rate_limit", "priority": 2, "description": "allow the pool to recover"},
            {"action": "Resize the pool or database connection budget", "type": "config_change", "priority": 3, "description": "match capacity to observed load"},
        ],
    },
    "cascading_failure": {
        "root_cause": "an upstream dependency is failing and retries are propagating instability to dependent services",
        "blast_radius": ["the affected service", "dependent services", "customer-facing traffic"],
        "blast_radius_severity": "high",
        "causal_chain": [
            "an upstream dependency begins returning failures",
            "retries and circuit-breaker activity increase pressure downstream",
            "multiple services begin failing in sequence",
        ],
        "recommended_actions": [
            {"action": "Fail over or isolate the unhealthy dependency", "type": "failover", "priority": 1, "description": "stop the error propagation path"},
            {"action": "Rate-limit retries and restart impacted services", "type": "rate_limit", "priority": 2, "description": "reduce retry amplification"},
            {"action": "Roll back the triggering change if recent", "type": "rollback", "priority": 3, "description": "restore the last known healthy state"},
        ],
    },
    "latency_degradation": {
        "root_cause": "resource contention or dependency slowdown is causing sustained response-time degradation",
        "blast_radius": ["the affected service", "user-facing request latency"],
        "blast_radius_severity": "medium",
        "causal_chain": [
            "service latency rises under pressure",
            "request queues and retries increase",
            "user-facing SLAs begin to degrade",
        ],
        "recommended_actions": [
            {"action": "Restart the slow service if resources are wedged", "type": "restart_service", "priority": 1, "description": "recover quickly if the node is unhealthy"},
            {"action": "Reduce traffic or expensive operations temporarily", "type": "rate_limit", "priority": 2, "description": "keep latency within a safer range"},
            {"action": "Tune backend dependency or scale capacity", "type": "config_change", "priority": 3, "description": "address the sustained bottleneck"},
        ],
    },
    "error_spike": {
        "root_cause": "application failures are rising because a dependency or local component is unstable",
        "blast_radius": ["the affected service", "requests served by the service"],
        "blast_radius_severity": "medium",
        "causal_chain": [
            "request failures begin increasing",
            "clients retry or abandon requests",
            "service health and customer experience degrade",
        ],
        "recommended_actions": [
            {"action": "Restart the failing service", "type": "restart_service", "priority": 1, "description": "recover from transient broken state"},
            {"action": "Inspect recent errors and dependency health", "type": "config_change", "priority": 2, "description": "pinpoint the failing path"},
            {"action": "Roll back recent risky changes if needed", "type": "rollback", "priority": 3, "description": "return to a known stable revision"},
        ],
    },
}

METRIC_LABELS = {
    "cpu_percent": "CPU",
    "memory_percent": "memory",
    "disk_percent": "disk",
    "network_in_mbps": "network ingress",
    "error_rate": "error rate",
    "latency_ms": "latency",
}


def _issue_profile(anomaly_type: str) -> dict:
    return ISSUE_PROFILES.get(anomaly_type, ISSUE_PROFILES["error_spike"])


def _extract_reason_lines(anomaly_data: dict, prediction_data: dict, metrics: dict) -> list[str]:
    reasons: list[str] = []

    metric_check = anomaly_data.get("statistical_check") or anomaly_data.get("combined_precheck", {}).get("metrics_check", {})
    for entry in metric_check.get("anomalies", [])[:4]:
        metric = entry.get("metric")
        value = entry.get("value")
        severity = entry.get("severity")
        if metric and value is not None:
            reasons.append(
                f"{METRIC_LABELS.get(metric, metric)} is at {value} ({severity} threshold breach)."
            )

    log_evidence = anomaly_data.get("log_evidence", "")
    if log_evidence:
        for line in log_evidence.split(" | ")[:3]:
            reasons.append(f"Log evidence: {line}")

    failure_probability = prediction_data.get("failure_probability")
    if isinstance(failure_probability, (int, float)) and failure_probability >= 0.7:
        reasons.append(
            f"Predicted failure probability is {round(failure_probability * 100)}%, so the issue is likely to escalate quickly."
        )

    estimated_time_to_failure = prediction_data.get("estimated_time_to_failure")
    if estimated_time_to_failure:
        reasons.append(
            f"Estimated time to failure is about {estimated_time_to_failure} minutes without intervention."
        )

    if not reasons and anomaly_data.get("description"):
        reasons.append(anomaly_data["description"])

    return reasons[:5]


async def _similar_context(query: str) -> tuple[str, bool]:
    memory = get_memory()
    similar, runbooks = await asyncio.gather(
        asyncio.to_thread(memory.search_similar_incidents, query, 3),
        asyncio.to_thread(memory.search_runbooks, query, 2),
    )

    chunks: list[str] = []
    if similar:
        chunks.append("Similar incidents:")
        for entry in similar:
            chunks.append(f"- {entry['document'][:220]}")
    if runbooks:
        chunks.append("Relevant runbooks:")
        for entry in runbooks:
            chunks.append(f"- {entry['document'][:220]}")

    if not chunks:
        return "No similar past incidents found.", False
    return "\n".join(chunks), True


async def diagnose(
    anomaly_data: dict,
    prediction_data: dict,
    metrics: dict,
    log_history: str = "No logs available",
) -> dict:
    """Root cause analysis using fast local reasoning plus vector memory lookup.

    If the anomaly type matches a known issue profile, the deterministic
    rulebook is used.  Otherwise the configured LLM (e.g. gemma3:4b) is
    called to generate the same structured output.
    """
    anomaly_type = anomaly_data.get("anomaly_type") or "error_spike"

    query = (
        f"{anomaly_type} on {metrics.get('node_type', 'server')} "
        f"- {anomaly_data.get('description', '')}"
    )
    past_context, used_rag = await _similar_context(query)
    reasons = _extract_reason_lines(anomaly_data, prediction_data, metrics)

    # ── Deterministic path (known profiles) ──────────────────────
    generated_locally = True
    if anomaly_type in ISSUE_PROFILES:
        profile = ISSUE_PROFILES[anomaly_type]
    else:
        # ── LLM fallback (unknown anomaly type) ──────────────────
        generated_locally = False
        try:
            from app.agents.llm_fallback import llm_diagnose
            llm_profile = await llm_diagnose(
                anomaly_type=anomaly_type,
                metrics=metrics,
                log_evidence=anomaly_data.get("log_evidence", ""),
                reasons=reasons,
                past_context=past_context,
            )
            if llm_profile:
                profile = llm_profile
            else:
                profile = ISSUE_PROFILES["error_spike"]
                generated_locally = True
        except Exception:
            profile = ISSUE_PROFILES["error_spike"]
            generated_locally = True

    confidence = 0.55
    if reasons:
        confidence += 0.1
    if anomaly_data.get("severity") in {"high", "critical"}:
        confidence += 0.1
    if used_rag:
        confidence += 0.05
    if not generated_locally:
        confidence = max(confidence - 0.05, 0.40)

    reasoning = (
        f"Classified as {anomaly_type.replace('_', ' ')} based on current metric pressure, "
        f"log evidence, and previously stored incident patterns."
    )
    if not generated_locally:
        reasoning += " Root cause analysis was generated by the LLM because no predefined profile matched."

    return {
        "root_cause": profile["root_cause"],
        "issue_type": anomaly_type,
        "reasons": reasons,
        "causal_chain": profile["causal_chain"],
        "blast_radius": profile["blast_radius"],
        "blast_radius_severity": profile.get("blast_radius_severity", "medium"),
        "confidence": round(min(confidence, 0.95), 2),
        "recommended_actions": profile["recommended_actions"],
        "similar_past_incidents": past_context,
        "reasoning": reasoning,
        "fix_summary": "; ".join(action["action"] for action in profile["recommended_actions"][:2]),
        "agent": "diagnostic",
        "rag_context_used": used_rag,
        "generated_locally": generated_locally,
    }
