from __future__ import annotations
"""
Remediation Agent — generates and manages remediation actions.

Generates one concise remediation artifact per incident using
deterministic templates so fixes can be reviewed and downloaded
without waiting on another model call.
"""

import asyncio
import re
import logging

logger = logging.getLogger("itops.remediation")

from app.remediation.artifacts import normalize_remediation_payload

SERVICE_HINTS = [
    ("nginx", ("nginx", "load_balancer", "lb")),
    ("postgresql", ("postgres", "pg-", "database", "db")),
    ("mysql", ("mysql",)),
    ("redis", ("redis", "cache")),
    ("kafka", ("kafka", "queue")),
    ("worker", ("worker",)),
    ("api-server", ("api",)),
    ("app-server", ("app", "web")),
]


def _normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _service_from_logs(log_history: str) -> str | None:
    patterns = [
        re.compile(r"\bservice ['\"]?([a-zA-Z0-9._-]+)['\"]?", re.IGNORECASE),
        re.compile(r"\bfor service ([a-zA-Z0-9._-]+)\b", re.IGNORECASE),
        re.compile(r"\b([a-zA-Z0-9._-]+)\.service\b", re.IGNORECASE),
    ]
    for line in (log_history or "").splitlines():
        for pattern in patterns:
            match = pattern.search(line)
            if match:
                return match.group(1)
    return None


def _infer_service_name(metrics: dict, log_history: str) -> str:
    from_logs = _service_from_logs(log_history)
    if from_logs:
        return from_logs

    node_name = _normalize_text(metrics.get("node_name"))
    node_type = _normalize_text(metrics.get("node_type"))
    haystack = f"{node_name} {node_type}".lower()
    for service, hints in SERVICE_HINTS:
        if any(hint in haystack for hint in hints):
            return service
    return "app-server"


def _derive_issue_type(diagnostic_data: dict) -> str:
    explicit = diagnostic_data.get("issue_type")
    if explicit:
        return str(explicit)

    root_cause = _normalize_text(diagnostic_data.get("root_cause")).lower()
    if "memory" in root_cause or "oom" in root_cause:
        return "memory_leak"
    if "disk" in root_cause or "storage" in root_cause:
        return "disk_full"
    if "connection" in root_cause and "pool" in root_cause:
        return "connection_pool_exhaustion"
    if "network" in root_cause:
        return "network_saturation"
    if "latency" in root_cause:
        return "latency_degradation"
    if "cpu" in root_cause:
        return "cpu_spike"
    if "cascade" in root_cause or "upstream" in root_cause:
        return "cascading_failure"
    return "error_spike"


def _artifact(
    artifact_id: str,
    name: str,
    purpose: str,
    description: str,
    content: str,
) -> dict:
    return {
        "id": artifact_id,
        "name": name,
        "kind": "shell",
        "language": "bash",
        "purpose": purpose,
        "description": description,
        "content": content,
    }


def _step(
    order: int,
    action: str,
    action_type: str,
    description: str,
    script: str,
    validation_command: str,
    estimated_duration_seconds: int,
    risk_level: str = "low",
    rollback_script: str = "",
) -> dict:
    return {
        "order": order,
        "action": action,
        "action_type": action_type,
        "description": description,
        "script": script,
        "rollback_script": rollback_script,
        "risk_level": risk_level,
        "estimated_duration_seconds": estimated_duration_seconds,
        "validation_command": validation_command,
    }


def _render_script(lines: list[str]) -> str:
    return "#!/usr/bin/env bash\nset -euo pipefail\n\n" + "\n".join(lines).strip() + "\n"


def _validation_snippet(service_name: str) -> list[str]:
    return [
        f"sudo systemctl is-active --quiet '{service_name}'",
        f"journalctl -u '{service_name}' -n 20 --no-pager || true",
    ]


def _restart_service_plan(service_name: str, issue_type: str, metrics: dict) -> tuple[list[dict], list[dict], str]:
    node_name = metrics.get("node_name", "unknown-node")
    prefix = issue_type.replace("_", " ")

    inspect_script = _render_script([
        f"echo 'Inspecting {prefix} symptoms on {node_name}'",
        "date",
        "uptime",
        "ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem | head -n 15",
        "ss -s || true",
    ])
    restart_script = _render_script([
        f"echo 'Restarting {service_name} to recover from {prefix}'",
        f"sudo systemctl restart '{service_name}'",
        "sleep 5",
        *(_validation_snippet(service_name)),
    ])
    validate_script = _render_script([
        f"echo 'Validating {service_name} health and current resource pressure'",
        f"sudo systemctl is-active --quiet '{service_name}'",
        "free -m || true",
        "df -h / || true",
        "journalctl -p warning -n 20 --no-pager || true",
    ])

    steps = [
        _step(
            1,
            "Capture current node state",
            "config_change",
            "Collect quick process, socket, and uptime evidence before changing the service.",
            inspect_script,
            "uptime && ps -eo pid,cmd,%mem,%cpu --sort=-%mem | head",
            30,
        ),
        _step(
            2,
            f"Restart {service_name}",
            "restart_service",
            "Recycle the local service to clear stuck workers, leaked memory, or exhausted connections.",
            restart_script,
            f"systemctl is-active --quiet {service_name}",
            45,
            rollback_script=_render_script([
                f"echo 'Rollback for {service_name}: restart service again to restore a clean state'",
                f"sudo systemctl restart '{service_name}'",
            ]),
        ),
        _step(
            3,
            "Validate recovery",
            "config_change",
            "Confirm the service is healthy and key pressure indicators have eased.",
            validate_script,
            f"systemctl is-active --quiet {service_name} && journalctl -u {service_name} -n 20 --no-pager",
            30,
        ),
    ]

    artifact = _artifact(
        "primary-apply",
        "remediate.sh",
        "apply",
        f"Primary remediation script for {issue_type.replace('_', ' ')} on {node_name}.",
        _render_script([
            f"SERVICE=\"${{SERVICE_NAME:-{service_name}}}\"",
            f"echo 'Capturing node state before remediating {issue_type.replace('_', ' ')}'",
            "date",
            "uptime",
            "ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem | head -n 15",
            "ss -s || true",
            "",
            "echo \"Restarting ${SERVICE}\"",
            "sudo systemctl restart \"${SERVICE}\"",
            "sleep 5",
            "echo \"Validating ${SERVICE}\"",
            "sudo systemctl is-active --quiet \"${SERVICE}\"",
            "free -m || true",
            "df -h / || true",
            "journalctl -u \"${SERVICE}\" -n 20 --no-pager || true",
        ]),
    )
    rollback = _artifact(
        "primary-rollback",
        "rollback.sh",
        "rollback",
        f"Simple rollback script for the {service_name} restart procedure.",
        _render_script([
            f"SERVICE=\"${{SERVICE_NAME:-{service_name}}}\"",
            "echo \"Rolling back by restarting ${SERVICE} into a clean state\"",
            "sudo systemctl restart \"${SERVICE}\"",
            "sudo systemctl is-active --quiet \"${SERVICE}\"",
        ]),
    )

    summary = f"Capture current state, restart {service_name}, and validate that service health and node pressure recover."
    return steps, [artifact, rollback], summary


def _disk_cleanup_plan(service_name: str, metrics: dict) -> tuple[list[dict], list[dict], str]:
    node_name = metrics.get("node_name", "unknown-node")

    cleanup_script = _render_script([
        "echo 'Checking disk usage before cleanup'",
        "df -h /",
        "sudo journalctl --vacuum-time=7d || true",
        "sudo find /var/log -xdev -type f -name '*.gz' -mtime +7 -delete || true",
        "sudo find /tmp -xdev -type f -mtime +2 -delete || true",
        "echo 'Disk usage after cleanup'",
        "df -h /",
        f"sudo systemctl restart '{service_name}'",
        f"sudo systemctl is-active --quiet '{service_name}'",
    ])
    validate_script = _render_script([
        "df -h /",
        f"sudo systemctl is-active --quiet '{service_name}'",
        f"journalctl -u '{service_name}' -n 20 --no-pager || true",
    ])

    steps = [
        _step(
            1,
            "Check filesystem pressure",
            "clear_disk",
            "Verify that root volume usage is critically high before cleanup.",
            _render_script(["df -h /", "sudo du -sh /var/log /tmp 2>/dev/null || true"]),
            "df -h /",
            20,
            risk_level="medium",
        ),
        _step(
            2,
            "Free safe local disk space",
            "clear_disk",
            "Vacuum old journal files and remove stale compressed logs and temp files.",
            cleanup_script,
            "df -h /",
            60,
            risk_level="medium",
        ),
        _step(
            3,
            f"Restart {service_name} and validate",
            "restart_service",
            "Bring the service back cleanly after write capacity is restored.",
            validate_script,
            f"systemctl is-active --quiet {service_name} && df -h /",
            30,
            risk_level="medium",
        ),
    ]

    artifact = _artifact(
        "primary-apply",
        "remediate.sh",
        "apply",
        f"Disk recovery script for {node_name}.",
        cleanup_script,
    )
    summary = "Recover disk headroom by cleaning safe stale files, then restart and validate the affected service."
    return steps, [artifact], summary


KNOWN_ISSUE_TYPES = {
    "memory_leak", "cpu_spike", "disk_full", "network_saturation",
    "connection_pool_exhaustion", "cascading_failure", "latency_degradation",
    "error_spike",
}


async def _similar_remediation_context(issue_type: str, root_cause: str) -> tuple[str, bool]:
    """Search past incidents and runbooks for similar remediation context."""
    try:
        from app.memory.vector_store import get_memory
        memory = get_memory()
        query = f"{issue_type} {root_cause}"
        similar, runbooks = await asyncio.gather(
            asyncio.to_thread(memory.search_similar_incidents, query, 3),
            asyncio.to_thread(memory.search_runbooks, query, 2),
        )

        chunks: list[str] = []
        if similar:
            chunks.append("Similar past incidents:")
            for entry in similar:
                chunks.append(f"- {entry['document'][:300]}")
        if runbooks:
            chunks.append("Relevant runbooks:")
            for entry in runbooks:
                chunks.append(f"- {entry['document'][:300]}")

        if not chunks:
            return "No similar past incidents found.", False
        return "\n".join(chunks), True
    except Exception as e:
        logger.warning(f"RAG search failed in remediation: {e}")
        return "No similar past incidents found.", False


async def _build_plan(
    issue_type: str, service_name: str, metrics: dict,
    log_history: str, root_cause: str = "",
) -> tuple[list[dict], list[dict], str, bool, str]:
    """Return (steps, artifacts, summary, generated_locally, past_context).

    Uses deterministic templates for known issue types and falls back
    to the configured LLM for anything novel.
    """
    past_context, used_rag = await _similar_remediation_context(issue_type, root_cause)

    if issue_type == "disk_full":
        steps, artifacts, summary = _disk_cleanup_plan(service_name, metrics)
        return steps, artifacts, summary, True, past_context

    if issue_type in KNOWN_ISSUE_TYPES:
        steps, artifacts, summary = _restart_service_plan(service_name, issue_type, metrics)
        return steps, artifacts, summary, True, past_context

    # ── LLM fallback for unknown issue types ─────────────────────
    try:
        from app.agents.llm_fallback import llm_remediate
        llm_result = await llm_remediate(
            issue_type=issue_type,
            service_name=service_name,
            node_name=metrics.get("node_name", "unknown-node"),
            root_cause=root_cause,
            metrics=metrics,
            past_context=past_context,
        )
        if llm_result:
            steps, artifacts, summary = llm_result
            return steps, artifacts, summary, False, past_context
    except Exception:
        pass

    # If LLM also fails, use the generic restart template
    steps, artifacts, summary = _restart_service_plan(service_name, issue_type, metrics)
    return steps, artifacts, summary, True, past_context


async def generate_remediation(diagnostic_data: dict, metrics: dict, log_history: str = "No logs available") -> dict:
    """Generate a remediation plan — deterministic first, LLM fallback for unknowns."""
    issue_type = _derive_issue_type(diagnostic_data)
    service_name = _infer_service_name(metrics, log_history)
    root_cause = diagnostic_data.get("root_cause", "")
    steps, artifacts, plan_summary, generated_locally, past_context = await _build_plan(
        issue_type, service_name, metrics, log_history, root_cause,
    )
    used_rag = past_context != "No similar past incidents found."

    reasoning = (
        f"Generated a local {issue_type.replace('_', ' ')} remediation plan for service "
        f"{service_name} using the node role, root cause, and current log evidence."
    )
    if not generated_locally:
        reasoning = (
            f"Generated an LLM-assisted {issue_type.replace('_', ' ')} remediation plan for "
            f"service {service_name} because no predefined template matched the issue type."
        )

    result = {
        "plan_summary": plan_summary,
        "strategy": "shell",
        "artifacts": artifacts,
        "steps": steps[:3],
        "total_estimated_duration_seconds": sum(step.get("estimated_duration_seconds", 0) for step in steps[:3]),
        "requires_downtime": False,
        "canary_compatible": False,
        "reasoning": reasoning,
        "issue_type": issue_type,
        "service_name": service_name,
        "agent": "remediation",
        "generated_locally": generated_locally,
        "rag_context_used": used_rag,
        "similar_past_remediations": past_context[:500] if used_rag else None,
    }

    return normalize_remediation_payload(result)
