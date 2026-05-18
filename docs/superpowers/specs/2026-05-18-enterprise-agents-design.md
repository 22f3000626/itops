# Enterprise Agent & Cloud Adapter Design

**Date:** 2026-05-18
**Status:** Approved — proceeding to implementation

---

## Goal

Make the 5 LangGraph agents production-grade and connect the AIOps platform to real cloud infrastructure: AWS CloudWatch, Azure Monitor, and GCP Cloud Monitoring. All sources coexist alongside the simulator. Agents are hardened with adaptive thresholds, EWMA trending, richer LLM reasoning, provider-aware remediation, and orchestrator resilience.

---

## 1. Cloud Adapters

### New files
- `backend/app/data_sources/cloudwatch.py` — `CloudWatchDataSource`
- `backend/app/data_sources/azure_monitor.py` — `AzureMonitorDataSource`
- `backend/app/data_sources/gcp_monitoring.py` — `GCPMonitoringDataSource`

### All three share the same contract
- Subclass `DataSource` ABC
- `connect()` validates credentials with a dry API call; raises on failure
- `stream_metrics()` polls at `settings.<provider>_poll_interval_seconds` (default 30s)
- `get_current_snapshot()` single poll
- Output: canonical `MetricEvent` with provider-native raw values in `metadata["<provider>"]`
- Retry: 3× exponential backoff (1s → 2s → 4s); after 3 failures sets `<provider>_status = "error"` and `<provider>_error = <message>` in settings

### AWS CloudWatch
- Auth: `access_key_id`, `secret_access_key`, `region`, `instance_ids[]` from settings
- SDK: `boto3`
- Metrics: EC2 `CPUUtilization`, `NetworkIn`, `NetworkOut`, `StatusCheckFailed`; RDS `FreeStorageSpace`, `DatabaseConnections`, `CPUUtilization`; ELB `RequestCount`, `TargetResponseTime`, `HTTPCode_ELB_5XX_Count`
- Canonical mapping: `CPUUtilization→cpu_percent`, `NetworkIn→network_in_mbps`, `NetworkOut→network_out_mbps`, `HTTPCode_ELB_5XX_Count / RequestCount → error_rate`, `TargetResponseTime * 1000 → latency_ms`

### Azure Monitor
- Auth: `tenant_id`, `client_id`, `client_secret`, `subscription_id`, `resource_group` from settings
- SDK: `azure-identity`, `azure-monitor-query`
- Metrics: VM `Percentage CPU`, `Network In Total`, `Network Out Total`, `Disk Read Bytes`, `Available Memory Bytes`; SQL `connection_failed`, `deadlock`; App Service `AverageResponseTime`, `Http5xx`
- Canonical mapping: `Percentage CPU→cpu_percent`, `Available Memory Bytes` inverted → `memory_percent`, `Http5xx / requests → error_rate`

### GCP Cloud Monitoring
- Auth: `project_id`, `service_account_json` (inline JSON string) from settings
- SDK: `google-cloud-monitoring`
- Metrics: Compute `instance/cpu/utilization`, `instance/memory/balloon/ram_used`, `instance/disk/read_bytes_count`, `instance/network/received_bytes_count`; Cloud SQL `database/cpu/utilization`, `database/disk/utilization`
- Canonical mapping follows same pattern; zone filter optional

### Registration
- `main.py` startup: reads settings, instantiates and registers each configured+connected adapter into `DataSourceRegistry`
- `SimulatorDataSource` always registered (provider = `"simulated"`)
- Infrastructure page filter uses `InfrastructureNode.provider` field (already exists)

---

## 2. Settings Extensions

### `runtime_settings.json` new fields
Per provider: `*_access_key_id / *_secret_access_key / *_region / *_instance_ids / *_poll_interval_seconds / *_status / *_error` (CloudWatch); tenant/client/secret/subscription/resource_group/poll/status/error (Azure); project_id/service_account_json/zone/poll/status/error (GCP).

Secrets (`secret_access_key`, `client_secret`, `service_account_json`) are never returned in GET responses.

### New API endpoints
- `POST /api/settings/cloudwatch` — save + test connection
- `POST /api/settings/azure` — save + test connection
- `POST /api/settings/gcp` — save + test connection
- Each returns `{ok: bool, message: str, nodes_found: int}`

---

## 3. Agent Improvements

### Monitoring Agent
- Replace `THRESHOLDS` with `NODE_TYPE_THRESHOLDS`: separate baselines for `server`, `database`, `cache`, `load_balancer`, `queue`
- Add **rate-of-change detection**: parse last 5 metric history readings; flag `rising_fast` if a metric increases >5% per cycle
- New output fields: `threshold_profile`, `trend_signals: [{metric, direction, velocity}]`

### Predictive Agent
- Replace oldest-vs-latest comparison with **EWMA** (α=0.3) over history window
- EWMA slope replaces raw delta for trend boost calculation
- **Multi-metric correlation bonus**: +0.08 to failure_probability when 3+ metrics simultaneously elevated
- New output field: `ewma_scores: {metric: score}`

### Diagnostic Agent
- LLM prompt enriched with: `provider`, `region`, `node_type`, `trend_signals`, `native_metrics` excerpt
- Remove 3-item cap on `causal_chain` and `blast_radius` (now up to 5 each)
- LLM system role upgraded to chain-of-thought: "think step by step before answering"

### Remediation Agent
- Remove `steps[:3]` cap — all runbook steps returned
- Provider-aware command generation: `aws` → AWS CLI commands; `azure` → `az` CLI; `gcp` → `gcloud` CLI; `simulated/other` → `systemctl`
- LLM fallback prompt includes provider context

### Reporting Agent
- New output fields: `mttr_estimate_minutes`, `sla_impact`, `timeline: [{agent, started_at, completed_at, duration_ms}]`
- All derived deterministically from existing `agent_trace` + pipeline state

### Orchestrator
- Per-node **30s timeout** via `asyncio.wait_for`
- On timeout/exception: emit `partial_failure` in `agent_trace`, continue pipeline with partial state
- `run_pipeline` retries once on transient exception (2s delay) before setting `status: error`

---

## 4. New Dependencies

```
boto3>=1.34
azure-identity>=1.15
azure-monitor-query>=1.3
google-cloud-monitoring>=2.18
```

---

## 5. File Change Summary

| File | Change |
|------|--------|
| `data_sources/cloudwatch.py` | New |
| `data_sources/azure_monitor.py` | New |
| `data_sources/gcp_monitoring.py` | New |
| `config.py` | Add cloud provider env vars |
| `services/settings_service.py` | Add cloud provider typed properties |
| `api/routes/settings.py` | Add 3 test-connection endpoints |
| `agents/monitoring.py` | Adaptive thresholds + rate-of-change |
| `agents/predictive.py` | EWMA + multi-metric correlation |
| `agents/diagnostic.py` | Richer LLM prompt + remove caps |
| `agents/remediation.py` | Remove step cap + provider-aware commands |
| `agents/reporting.py` | MTTR + SLA impact + timeline |
| `agents/orchestrator.py` | Timeout + retry + partial failure |
| `agents/llm_fallback.py` | Provider context in prompts |
| `main.py` | Register cloud adapters on startup |
| `requirements.txt` | Add 4 new dependencies |
