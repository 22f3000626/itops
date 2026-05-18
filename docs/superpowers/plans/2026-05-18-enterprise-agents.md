# Enterprise Agents & Cloud Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire AWS CloudWatch, Azure Monitor, and GCP Cloud Monitoring into the existing pipeline as real `DataSource` adapters alongside the simulator, and harden all 5 LangGraph agents for enterprise-grade reliability.

**Architecture:** Three new `DataSource` subclasses share the same retry/backoff/status pattern; credentials live in `runtime_settings.json` (same pattern as LLM API keys); the monitoring loop polls all registered sources concurrently. Agents are improved in-place: adaptive thresholds, EWMA trending, richer LLM prompts with cloud context, no step cap on remediation, MTTR/SLA on reporting, per-node timeout + retry in orchestrator.

**Tech Stack:** `boto3`, `azure-identity`, `azure-monitor-query`, `azure-mgmt-compute`, `google-cloud-monitoring`, `google-auth`, existing FastAPI/LangGraph/SQLAlchemy stack.

---

## Task 1: Add dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add cloud SDK dependencies**

Append to `backend/requirements.txt`:
```
# Cloud provider adapters
boto3>=1.34.0
azure-identity>=1.15.0
azure-monitor-query>=1.3.0
azure-mgmt-compute>=30.0.0
azure-mgmt-resource>=23.0.0
google-cloud-monitoring>=2.18.0
google-auth>=2.28.0
```

- [ ] **Step 2: Install them**

```bash
cd /home/shiva/itops/backend
pip install boto3>=1.34.0 "azure-identity>=1.15.0" "azure-monitor-query>=1.3.0" "azure-mgmt-compute>=30.0.0" "azure-mgmt-resource>=23.0.0" "google-cloud-monitoring>=2.18.0" "google-auth>=2.28.0"
```

Expected: packages install without error.

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add cloud provider SDK dependencies (boto3, azure, gcp)"
```

---

## Task 2: Extend config.py with cloud provider env vars

**Files:**
- Modify: `backend/app/config.py`

- [ ] **Step 1: Add cloud provider config vars**

Open `backend/app/config.py`. After the `GEMINI_MODEL` line, add:

```python
# AWS CloudWatch
CLOUDWATCH_ACCESS_KEY_ID = os.getenv("CLOUDWATCH_ACCESS_KEY_ID", "")
CLOUDWATCH_SECRET_ACCESS_KEY = os.getenv("CLOUDWATCH_SECRET_ACCESS_KEY", "")
CLOUDWATCH_REGION = os.getenv("CLOUDWATCH_REGION", "us-east-1")
CLOUDWATCH_INSTANCE_IDS = [
    i.strip() for i in os.getenv("CLOUDWATCH_INSTANCE_IDS", "").split(",") if i.strip()
]
CLOUDWATCH_POLL_INTERVAL_SECONDS = int(os.getenv("CLOUDWATCH_POLL_INTERVAL_SECONDS", "30"))

# Azure Monitor
AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.getenv("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")
AZURE_SUBSCRIPTION_ID = os.getenv("AZURE_SUBSCRIPTION_ID", "")
AZURE_RESOURCE_GROUP = os.getenv("AZURE_RESOURCE_GROUP", "")
AZURE_POLL_INTERVAL_SECONDS = int(os.getenv("AZURE_POLL_INTERVAL_SECONDS", "30"))

# GCP Cloud Monitoring
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_SERVICE_ACCOUNT_JSON = os.getenv("GCP_SERVICE_ACCOUNT_JSON", "")
GCP_ZONE = os.getenv("GCP_ZONE", "")
GCP_POLL_INTERVAL_SECONDS = int(os.getenv("GCP_POLL_INTERVAL_SECONDS", "30"))
```

- [ ] **Step 2: Verify import works**

```bash
cd /home/shiva/itops/backend
python -c "from app.config import CLOUDWATCH_REGION, AZURE_TENANT_ID, GCP_PROJECT_ID; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/config.py
git commit -m "feat: add cloud provider env vars to config"
```

---

## Task 3: Extend settings_service.py

**Files:**
- Modify: `backend/app/services/settings_service.py`

- [ ] **Step 1: Add cloud imports to settings_service.py**

In `backend/app/services/settings_service.py`, extend the config import block at the top:

```python
from app.config import (
    OLLAMA_MODEL,
    OLLAMA_EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    LLM_PROVIDER,
    AGENT_TEMPERATURE,
    BASE_DIR,
    CLOUDWATCH_ACCESS_KEY_ID,
    CLOUDWATCH_SECRET_ACCESS_KEY,
    CLOUDWATCH_REGION,
    CLOUDWATCH_INSTANCE_IDS,
    CLOUDWATCH_POLL_INTERVAL_SECONDS,
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    AZURE_SUBSCRIPTION_ID,
    AZURE_RESOURCE_GROUP,
    AZURE_POLL_INTERVAL_SECONDS,
    GCP_PROJECT_ID,
    GCP_SERVICE_ACCOUNT_JSON,
    GCP_ZONE,
    GCP_POLL_INTERVAL_SECONDS,
)
```

- [ ] **Step 2: Add cloud fields to `_Settings.__init__`**

Inside `_Settings.__init__`, after the `self.auto_run_interval_seconds` line, add:

```python
        # ── AWS CloudWatch ──────────────────────────────────
        self.cloudwatch_access_key_id: str = CLOUDWATCH_ACCESS_KEY_ID
        self.cloudwatch_secret_access_key: str = CLOUDWATCH_SECRET_ACCESS_KEY
        self.cloudwatch_region: str = CLOUDWATCH_REGION
        self.cloudwatch_instance_ids: list[str] = list(CLOUDWATCH_INSTANCE_IDS)
        self.cloudwatch_poll_interval_seconds: int = CLOUDWATCH_POLL_INTERVAL_SECONDS
        self.cloudwatch_status: str = "disconnected"
        self.cloudwatch_error: str | None = None

        # ── Azure Monitor ───────────────────────────────────
        self.azure_tenant_id: str = AZURE_TENANT_ID
        self.azure_client_id: str = AZURE_CLIENT_ID
        self.azure_client_secret: str = AZURE_CLIENT_SECRET
        self.azure_subscription_id: str = AZURE_SUBSCRIPTION_ID
        self.azure_resource_group: str = AZURE_RESOURCE_GROUP
        self.azure_poll_interval_seconds: int = AZURE_POLL_INTERVAL_SECONDS
        self.azure_status: str = "disconnected"
        self.azure_error: str | None = None

        # ── GCP Cloud Monitoring ────────────────────────────
        self.gcp_project_id: str = GCP_PROJECT_ID
        self.gcp_service_account_json: str = GCP_SERVICE_ACCOUNT_JSON
        self.gcp_zone: str = GCP_ZONE
        self.gcp_poll_interval_seconds: int = GCP_POLL_INTERVAL_SECONDS
        self.gcp_status: str = "disconnected"
        self.gcp_error: str | None = None
```

- [ ] **Step 3: Add cloud fields to `_PERSISTED_FIELDS`**

Replace the existing `_PERSISTED_FIELDS` tuple with:

```python
    _PERSISTED_FIELDS = (
        "llm_provider",
        "ollama_model",
        "ollama_embedding_model",
        "ollama_base_url",
        "openai_api_key",
        "openai_model",
        "gemini_api_key",
        "gemini_model",
        "agent_temperature",
        "custom_llm_models",
        "custom_embedding_models",
        "custom_openai_models",
        "custom_gemini_models",
        "auto_run_pipeline",
        "auto_run_interval_seconds",
        # Cloud providers
        "cloudwatch_access_key_id",
        "cloudwatch_secret_access_key",
        "cloudwatch_region",
        "cloudwatch_instance_ids",
        "cloudwatch_poll_interval_seconds",
        "cloudwatch_status",
        "cloudwatch_error",
        "azure_tenant_id",
        "azure_client_id",
        "azure_client_secret",
        "azure_subscription_id",
        "azure_resource_group",
        "azure_poll_interval_seconds",
        "azure_status",
        "azure_error",
        "gcp_project_id",
        "gcp_service_account_json",
        "gcp_zone",
        "gcp_poll_interval_seconds",
        "gcp_status",
        "gcp_error",
    )
```

- [ ] **Step 4: Add cloud secrets to `_SECRET_FIELDS`**

Replace:
```python
_SECRET_FIELDS = ("openai_api_key", "gemini_api_key")
```
With:
```python
_SECRET_FIELDS = (
    "openai_api_key",
    "gemini_api_key",
    "cloudwatch_secret_access_key",
    "azure_client_secret",
    "gcp_service_account_json",
)
```

- [ ] **Step 5: Add cloud fields to `snapshot()`**

Inside `snapshot()`, after `"auto_run_interval_seconds": self.auto_run_interval_seconds,`, add:

```python
                # Cloud providers
                "cloudwatch_access_key_id": self.cloudwatch_access_key_id,
                "cloudwatch_secret_access_key": self.cloudwatch_secret_access_key,
                "cloudwatch_region": self.cloudwatch_region,
                "cloudwatch_instance_ids": list(self.cloudwatch_instance_ids),
                "cloudwatch_poll_interval_seconds": self.cloudwatch_poll_interval_seconds,
                "cloudwatch_status": self.cloudwatch_status,
                "cloudwatch_error": self.cloudwatch_error,
                "azure_tenant_id": self.azure_tenant_id,
                "azure_client_id": self.azure_client_id,
                "azure_client_secret": self.azure_client_secret,
                "azure_subscription_id": self.azure_subscription_id,
                "azure_resource_group": self.azure_resource_group,
                "azure_poll_interval_seconds": self.azure_poll_interval_seconds,
                "azure_status": self.azure_status,
                "azure_error": self.azure_error,
                "gcp_project_id": self.gcp_project_id,
                "gcp_service_account_json": self.gcp_service_account_json,
                "gcp_zone": self.gcp_zone,
                "gcp_poll_interval_seconds": self.gcp_poll_interval_seconds,
                "gcp_status": self.gcp_status,
                "gcp_error": self.gcp_error,
```

- [ ] **Step 6: Verify**

```bash
cd /home/shiva/itops/backend
python -c "from app.services.settings_service import settings; print(settings.cloudwatch_status, settings.azure_status, settings.gcp_status)"
```

Expected: `disconnected disconnected disconnected`

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/settings_service.py
git commit -m "feat: extend settings with cloud provider credential fields"
```

---

## Task 4: AWS CloudWatch adapter

**Files:**
- Create: `backend/app/data_sources/cloudwatch.py`

- [ ] **Step 1: Create the file**

Create `backend/app/data_sources/cloudwatch.py`:

```python
from __future__ import annotations
"""
AWS CloudWatch data source.

Polls EC2, RDS, and ELB metrics via boto3 and maps them to the canonical
MetricEvent shape. Provider-native datapoints are carried in metadata["cloudwatch"].
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from app.data_sources.base import DataSource, MetricEvent

logger = logging.getLogger("itops.cloudwatch")

_RETRY_DELAYS = (1.0, 2.0, 4.0)


def _safe_last(datapoints: list[dict], stat: str = "Average") -> float | None:
    if not datapoints:
        return None
    return sorted(datapoints, key=lambda x: x["Timestamp"])[-1].get(stat)


class CloudWatchDataSource(DataSource):
    """Polls AWS CloudWatch for EC2, RDS, and ELB metrics."""

    def __init__(self) -> None:
        self._connected = False
        self._client = None
        self._region = "us-east-1"
        self._instance_ids: list[str] = []
        self._poll_interval: int = 30

    @property
    def provider_name(self) -> str:
        return "aws"

    async def connect(self) -> None:
        from app.services.settings_service import settings as _s
        self._region = _s.cloudwatch_region or "us-east-1"
        self._instance_ids = [i.strip() for i in (_s.cloudwatch_instance_ids or []) if i.strip()]
        self._poll_interval = _s.cloudwatch_poll_interval_seconds or 30

        try:
            import boto3
            self._client = boto3.client(
                "cloudwatch",
                aws_access_key_id=_s.cloudwatch_access_key_id,
                aws_secret_access_key=_s.cloudwatch_secret_access_key,
                region_name=self._region,
            )
            # Validate credentials with a lightweight call
            self._client.list_metrics(Namespace="AWS/EC2", RecentlyActive="PT3H", MaxRecords=1)
            self._connected = True
            _s.update(cloudwatch_status="connected", cloudwatch_error=None)
            logger.info("CloudWatch connected (region=%s, instances=%d)", self._region, len(self._instance_ids))
        except Exception as exc:
            from app.services.settings_service import settings as _s2
            _s2.update(cloudwatch_status="error", cloudwatch_error=str(exc)[:500])
            raise ConnectionError(f"CloudWatch connection failed: {exc}") from exc

    async def disconnect(self) -> None:
        self._connected = False
        self._client = None

    def _get_stat(self, namespace: str, metric: str, dims: list[dict], period: int = 60) -> float | None:
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=period * 3)
        try:
            resp = self._client.get_metric_statistics(
                Namespace=namespace,
                MetricName=metric,
                Dimensions=dims,
                StartTime=start,
                EndTime=end,
                Period=period,
                Statistics=["Average"],
            )
            return _safe_last(resp.get("Datapoints", []))
        except Exception as exc:
            logger.debug("CloudWatch stat failed %s/%s: %s", namespace, metric, exc)
            return None

    def _ec2_event(self, instance_id: str) -> MetricEvent | None:
        dims = [{"Name": "InstanceId", "Value": instance_id}]
        cpu = self._get_stat("AWS/EC2", "CPUUtilization", dims)
        if cpu is None:
            return None
        net_in_b = self._get_stat("AWS/EC2", "NetworkIn", dims) or 0.0
        net_out_b = self._get_stat("AWS/EC2", "NetworkOut", dims) or 0.0
        status_fail = self._get_stat("AWS/EC2", "StatusCheckFailed", dims) or 0.0
        net_in_mbps = net_in_b * 8 / 1e6 / 60
        net_out_mbps = net_out_b * 8 / 1e6 / 60
        return MetricEvent(
            node_name=instance_id,
            node_type="server",
            provider="aws",
            region=self._region,
            ip_address="",
            cpu_percent=round(cpu, 2),
            memory_percent=0.0,
            disk_percent=0.0,
            network_in_mbps=round(net_in_mbps, 2),
            network_out_mbps=round(net_out_mbps, 2),
            request_rate=0.0,
            error_rate=100.0 if status_fail >= 1.0 else 0.0,
            latency_ms=0.0,
            metadata={"cloudwatch": {
                "NetworkIn_bytes": net_in_b,
                "NetworkOut_bytes": net_out_b,
                "StatusCheckFailed": status_fail,
            }},
        )

    def _rds_event(self, db_id: str) -> MetricEvent | None:
        dims = [{"Name": "DBInstanceIdentifier", "Value": db_id}]
        cpu = self._get_stat("AWS/RDS", "CPUUtilization", dims)
        if cpu is None:
            return None
        db_conns = self._get_stat("AWS/RDS", "DatabaseConnections", dims) or 0.0
        free_storage = self._get_stat("AWS/RDS", "FreeStorageSpace", dims)
        read_lat = self._get_stat("AWS/RDS", "ReadLatency", dims) or 0.0
        disk_pct = 0.0
        if free_storage is not None:
            assumed_total = 100 * 1024 ** 3  # assume 100 GB if not known
            disk_pct = max(0.0, min(100.0, (1.0 - free_storage / assumed_total) * 100.0))
        return MetricEvent(
            node_name=db_id,
            node_type="database",
            provider="aws",
            region=self._region,
            ip_address="",
            cpu_percent=round(cpu, 2),
            memory_percent=0.0,
            disk_percent=round(disk_pct, 2),
            network_in_mbps=0.0,
            network_out_mbps=0.0,
            request_rate=round(db_conns, 2),
            error_rate=0.0,
            latency_ms=round(read_lat * 1000, 2),
            metadata={"cloudwatch": {
                "DatabaseConnections": db_conns,
                "FreeStorageSpace": free_storage,
                "ReadLatency_s": read_lat,
            }},
        )

    def _elb_event(self, lb_name: str) -> MetricEvent | None:
        dims = [{"Name": "LoadBalancer", "Value": lb_name}]
        req_count = self._get_stat("AWS/ApplicationELB", "RequestCount", dims) or 0.0
        resp_time = self._get_stat("AWS/ApplicationELB", "TargetResponseTime", dims)
        err_5xx = self._get_stat("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", dims) or 0.0
        if resp_time is None and req_count == 0.0:
            return None
        error_rate = (err_5xx / max(req_count, 1)) * 100.0 if req_count > 0 else 0.0
        return MetricEvent(
            node_name=lb_name,
            node_type="load_balancer",
            provider="aws",
            region=self._region,
            ip_address="",
            cpu_percent=0.0,
            memory_percent=0.0,
            disk_percent=0.0,
            network_in_mbps=0.0,
            network_out_mbps=0.0,
            request_rate=round(req_count, 2),
            error_rate=round(error_rate, 2),
            latency_ms=round((resp_time or 0.0) * 1000, 2),
            metadata={"cloudwatch": {
                "RequestCount": req_count,
                "TargetResponseTime_s": resp_time,
                "HTTPCode_Target_5XX_Count": err_5xx,
            }},
        )

    def _event_for_resource(self, resource_id: str) -> MetricEvent | None:
        # Try EC2 first (most common), then RDS, then ELB
        event = self._ec2_event(resource_id)
        if event:
            return event
        event = self._rds_event(resource_id)
        if event:
            return event
        return self._elb_event(resource_id)

    def _generate_batch(self) -> list[MetricEvent]:
        events = []
        for rid in self._instance_ids:
            try:
                event = self._event_for_resource(rid)
                if event:
                    events.append(event)
            except Exception as exc:
                logger.warning("CloudWatch: failed to fetch %s: %s", rid, exc)
        return events

    async def _with_retry(self, fn) -> list[MetricEvent]:
        last_exc: Exception = RuntimeError("no attempts")
        for delay in _RETRY_DELAYS:
            try:
                return await asyncio.to_thread(fn)
            except Exception as exc:
                last_exc = exc
                await asyncio.sleep(delay)
        raise last_exc

    async def get_current_snapshot(self) -> list[MetricEvent]:
        return await self._with_retry(self._generate_batch)

    async def stream_metrics(self) -> AsyncIterator[list[MetricEvent]]:
        from app.services.settings_service import settings as _s
        consecutive_failures = 0
        while self._connected:
            try:
                batch = await self._with_retry(self._generate_batch)
                consecutive_failures = 0
                _s.update(cloudwatch_status="connected", cloudwatch_error=None)
                yield batch
            except Exception as exc:
                consecutive_failures += 1
                logger.warning("CloudWatch poll failure %d/3: %s", consecutive_failures, exc)
                if consecutive_failures >= 3:
                    _s.update(cloudwatch_status="error", cloudwatch_error=str(exc)[:500])
                    self._connected = False
                    return
            interval = (_s.cloudwatch_poll_interval_seconds or 30)
            await asyncio.sleep(interval)

    def test_connection(self) -> dict:
        from app.services.settings_service import settings as _s
        try:
            import boto3
            client = boto3.client(
                "cloudwatch",
                aws_access_key_id=_s.cloudwatch_access_key_id,
                aws_secret_access_key=_s.cloudwatch_secret_access_key,
                region_name=_s.cloudwatch_region or "us-east-1",
            )
            client.list_metrics(Namespace="AWS/EC2", RecentlyActive="PT3H", MaxRecords=1)
            ids = [i.strip() for i in (_s.cloudwatch_instance_ids or []) if i.strip()]
            return {"ok": True, "message": f"Connected to AWS CloudWatch ({_s.cloudwatch_region})", "nodes_found": len(ids)}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:300], "nodes_found": 0}
```

- [ ] **Step 2: Verify import**

```bash
cd /home/shiva/itops/backend
python -c "from app.data_sources.cloudwatch import CloudWatchDataSource; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/data_sources/cloudwatch.py
git commit -m "feat: add AWS CloudWatch data source adapter"
```

---

## Task 5: Azure Monitor adapter

**Files:**
- Create: `backend/app/data_sources/azure_monitor.py`

- [ ] **Step 1: Create the file**

Create `backend/app/data_sources/azure_monitor.py`:

```python
from __future__ import annotations
"""
Azure Monitor data source.

Discovers VMs, SQL databases, and App Services in the configured resource
group and polls their metrics via azure-monitor-query. Provider-native
values are carried in metadata["azure_monitor"].
"""

import asyncio
import logging
from datetime import timedelta
from typing import AsyncIterator

from app.data_sources.base import DataSource, MetricEvent

logger = logging.getLogger("itops.azure_monitor")

_RETRY_DELAYS = (1.0, 2.0, 4.0)

_VM_METRICS = [
    "Percentage CPU",
    "Network In Total",
    "Network Out Total",
    "Disk Read Bytes",
    "Available Memory Bytes",
]
_SQL_METRICS = ["cpu_percent", "storage_percent", "connection_failed", "deadlock"]
_APP_METRICS = ["CpuPercentage", "MemoryPercentage", "AverageResponseTime", "Http5xx", "Requests"]


def _last_value(metric_result) -> float | None:
    try:
        for ts in metric_result.timeseries:
            for dp in reversed(ts.data):
                if dp.average is not None:
                    return dp.average
    except Exception:
        pass
    return None


def _vm_to_event(resource_id: str, vm_name: str, region: str, results) -> MetricEvent:
    raw: dict = {}
    for m in results.metrics:
        val = _last_value(m)
        if val is not None:
            raw[m.name] = val

    cpu = raw.get("Percentage CPU", 0.0)
    net_in_b = raw.get("Network In Total", 0.0)
    net_out_b = raw.get("Network Out Total", 0.0)
    avail_mem_b = raw.get("Available Memory Bytes")
    # Assume 4 GB RAM if unknown; Available Memory → used%
    total_mem_b = 4 * 1024 ** 3
    mem_pct = max(0.0, min(100.0, (1.0 - (avail_mem_b or total_mem_b) / total_mem_b) * 100.0))

    return MetricEvent(
        node_name=vm_name,
        node_type="server",
        provider="azure",
        region=region,
        ip_address="",
        cpu_percent=round(cpu, 2),
        memory_percent=round(mem_pct, 2),
        disk_percent=0.0,
        network_in_mbps=round(net_in_b * 8 / 1e6 / 60, 2),
        network_out_mbps=round(net_out_b * 8 / 1e6 / 60, 2),
        request_rate=0.0,
        error_rate=0.0,
        latency_ms=0.0,
        metadata={"azure_monitor": raw, "resource_id": resource_id},
    )


def _app_to_event(resource_id: str, app_name: str, region: str, results) -> MetricEvent:
    raw: dict = {}
    for m in results.metrics:
        val = _last_value(m)
        if val is not None:
            raw[m.name] = val

    cpu = raw.get("CpuPercentage", 0.0)
    mem = raw.get("MemoryPercentage", 0.0)
    avg_resp = raw.get("AverageResponseTime", 0.0)
    http5xx = raw.get("Http5xx", 0.0)
    req = raw.get("Requests", 0.0)
    err_rate = (http5xx / max(req, 1)) * 100.0 if req > 0 else 0.0

    return MetricEvent(
        node_name=app_name,
        node_type="server",
        provider="azure",
        region=region,
        ip_address="",
        cpu_percent=round(cpu, 2),
        memory_percent=round(mem, 2),
        disk_percent=0.0,
        network_in_mbps=0.0,
        network_out_mbps=0.0,
        request_rate=round(req, 2),
        error_rate=round(err_rate, 2),
        latency_ms=round(avg_resp * 1000, 2),
        metadata={"azure_monitor": raw, "resource_id": resource_id},
    )


class AzureMonitorDataSource(DataSource):
    """Polls Azure Monitor for VM, SQL, and App Service metrics."""

    def __init__(self) -> None:
        self._connected = False
        self._metrics_client = None
        self._subscription_id = ""
        self._resource_group = ""
        self._region = "eastus"
        self._poll_interval = 30
        self._resources: list[dict] = []  # [{id, name, type, region}]

    @property
    def provider_name(self) -> str:
        return "azure"

    def _build_credential(self, s):
        from azure.identity import ClientSecretCredential
        return ClientSecretCredential(
            tenant_id=s.azure_tenant_id,
            client_id=s.azure_client_id,
            client_secret=s.azure_client_secret,
        )

    def _discover_resources(self, credential, subscription_id: str, resource_group: str) -> list[dict]:
        from azure.mgmt.compute import ComputeManagementClient
        from azure.mgmt.resource import ResourceManagementClient
        resources = []
        try:
            compute = ComputeManagementClient(credential, subscription_id)
            for vm in compute.virtual_machines.list(resource_group):
                loc = vm.location or "unknown"
                resources.append({
                    "id": vm.id,
                    "name": vm.name,
                    "type": "vm",
                    "region": loc,
                })
        except Exception as exc:
            logger.warning("Azure VM discovery failed: %s", exc)

        try:
            rc = ResourceManagementClient(credential, subscription_id)
            for res in rc.resources.list_by_resource_group(
                resource_group,
                filter="resourceType eq 'Microsoft.Web/sites'",
            ):
                resources.append({
                    "id": res.id,
                    "name": res.name,
                    "type": "app",
                    "region": res.location or "unknown",
                })
        except Exception as exc:
            logger.warning("Azure App Service discovery failed: %s", exc)

        return resources

    async def connect(self) -> None:
        from app.services.settings_service import settings as _s
        self._subscription_id = _s.azure_subscription_id
        self._resource_group = _s.azure_resource_group or ""
        self._poll_interval = _s.azure_poll_interval_seconds or 30

        try:
            from azure.monitor.query import MetricsQueryClient
            credential = self._build_credential(_s)
            self._metrics_client = MetricsQueryClient(credential)
            # Discover resources
            if self._resource_group:
                self._resources = await asyncio.to_thread(
                    self._discover_resources, credential, self._subscription_id, self._resource_group
                )
            self._connected = True
            _s.update(azure_status="connected", azure_error=None)
            logger.info("Azure Monitor connected (rg=%s, resources=%d)", self._resource_group, len(self._resources))
        except Exception as exc:
            from app.services.settings_service import settings as _s2
            _s2.update(azure_status="error", azure_error=str(exc)[:500])
            raise ConnectionError(f"Azure Monitor connection failed: {exc}") from exc

    async def disconnect(self) -> None:
        self._connected = False
        self._metrics_client = None

    def _query_resource(self, resource_id: str, metric_names: list[str]):
        return self._metrics_client.query_resource(
            resource_id,
            metric_names=metric_names,
            timespan=timedelta(minutes=5),
            granularity=timedelta(minutes=1),
        )

    def _generate_batch(self) -> list[MetricEvent]:
        events = []
        for res in self._resources:
            try:
                if res["type"] == "vm":
                    results = self._query_resource(res["id"], _VM_METRICS)
                    events.append(_vm_to_event(res["id"], res["name"], res["region"], results))
                elif res["type"] == "app":
                    results = self._query_resource(res["id"], _APP_METRICS)
                    events.append(_app_to_event(res["id"], res["name"], res["region"], results))
            except Exception as exc:
                logger.warning("Azure Monitor: failed to query %s: %s", res["name"], exc)
        return events

    async def _with_retry(self, fn) -> list[MetricEvent]:
        last_exc: Exception = RuntimeError("no attempts")
        for delay in _RETRY_DELAYS:
            try:
                return await asyncio.to_thread(fn)
            except Exception as exc:
                last_exc = exc
                await asyncio.sleep(delay)
        raise last_exc

    async def get_current_snapshot(self) -> list[MetricEvent]:
        return await self._with_retry(self._generate_batch)

    async def stream_metrics(self) -> AsyncIterator[list[MetricEvent]]:
        from app.services.settings_service import settings as _s
        consecutive_failures = 0
        while self._connected:
            try:
                batch = await self._with_retry(self._generate_batch)
                consecutive_failures = 0
                _s.update(azure_status="connected", azure_error=None)
                yield batch
            except Exception as exc:
                consecutive_failures += 1
                logger.warning("Azure Monitor poll failure %d/3: %s", consecutive_failures, exc)
                if consecutive_failures >= 3:
                    _s.update(azure_status="error", azure_error=str(exc)[:500])
                    self._connected = False
                    return
            await asyncio.sleep(_s.azure_poll_interval_seconds or 30)

    def test_connection(self) -> dict:
        from app.services.settings_service import settings as _s
        try:
            credential = self._build_credential(_s)
            from azure.mgmt.resource import ResourceManagementClient
            rc = ResourceManagementClient(credential, _s.azure_subscription_id)
            list(rc.resource_groups.list())
            return {"ok": True, "message": "Connected to Azure Monitor", "nodes_found": len(self._resources)}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:300], "nodes_found": 0}
```

- [ ] **Step 2: Verify import**

```bash
cd /home/shiva/itops/backend
python -c "from app.data_sources.azure_monitor import AzureMonitorDataSource; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/data_sources/azure_monitor.py
git commit -m "feat: add Azure Monitor data source adapter"
```

---

## Task 6: GCP Cloud Monitoring adapter

**Files:**
- Create: `backend/app/data_sources/gcp_monitoring.py`

- [ ] **Step 1: Create the file**

Create `backend/app/data_sources/gcp_monitoring.py`:

```python
from __future__ import annotations
"""
GCP Cloud Monitoring data source.

Queries Compute Engine CPU, memory, disk, and network metrics via the
Cloud Monitoring API. Provider-native values are carried in metadata["gcp"].
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from app.data_sources.base import DataSource, MetricEvent

logger = logging.getLogger("itops.gcp_monitoring")

_RETRY_DELAYS = (1.0, 2.0, 4.0)

_METRIC_MAP = {
    "compute.googleapis.com/instance/cpu/utilization": "cpu_ratio",
    "compute.googleapis.com/instance/memory/balloon/ram_used": "ram_used_bytes",
    "compute.googleapis.com/instance/memory/balloon/ram_size": "ram_size_bytes",
    "compute.googleapis.com/instance/disk/read_bytes_count": "disk_read_bytes",
    "compute.googleapis.com/instance/network/received_bytes_count": "net_in_bytes",
    "compute.googleapis.com/instance/network/sent_bytes_count": "net_out_bytes",
}


def _extract_value(time_series) -> tuple[str, float] | None:
    try:
        pts = list(time_series.points)
        if not pts:
            return None
        val = pts[-1].value
        numeric = getattr(val, "double_value", None) or getattr(val, "int64_value", None) or 0.0
        label = time_series.resource.labels.get("instance_id") or time_series.resource.labels.get("instance_name", "unknown")
        return label, float(numeric)
    except Exception:
        return None


class GCPMonitoringDataSource(DataSource):
    """Polls GCP Cloud Monitoring for Compute Engine instance metrics."""

    def __init__(self) -> None:
        self._connected = False
        self._client = None
        self._project_id = ""
        self._zone = ""
        self._poll_interval = 30
        self._credentials = None

    @property
    def provider_name(self) -> str:
        return "gcp"

    async def connect(self) -> None:
        from app.services.settings_service import settings as _s
        self._project_id = _s.gcp_project_id
        self._zone = _s.gcp_zone or ""
        self._poll_interval = _s.gcp_poll_interval_seconds or 30

        try:
            from google.cloud import monitoring_v3
            from google.oauth2 import service_account

            sa_json = _s.gcp_service_account_json
            if not sa_json:
                raise ValueError("gcp_service_account_json is empty")

            sa_info = json.loads(sa_json)
            self._credentials = service_account.Credentials.from_service_account_info(
                sa_info,
                scopes=["https://www.googleapis.com/auth/monitoring.read"],
            )
            self._client = monitoring_v3.MetricServiceClient(credentials=self._credentials)
            # Validate: list a single time series
            project_name = f"projects/{self._project_id}"
            now = datetime.now(timezone.utc)
            interval = monitoring_v3.TimeInterval(
                end_time={"seconds": int(now.timestamp())},
                start_time={"seconds": int((now - timedelta(minutes=2)).timestamp())},
            )
            list(self._client.list_time_series(request={
                "name": project_name,
                "filter": 'metric.type="compute.googleapis.com/instance/cpu/utilization"',
                "interval": interval,
                "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.HEADERS,
            }))
            self._connected = True
            _s.update(gcp_status="connected", gcp_error=None)
            logger.info("GCP Monitoring connected (project=%s)", self._project_id)
        except Exception as exc:
            from app.services.settings_service import settings as _s2
            _s2.update(gcp_status="error", gcp_error=str(exc)[:500])
            raise ConnectionError(f"GCP Monitoring connection failed: {exc}") from exc

    async def disconnect(self) -> None:
        self._connected = False
        self._client = None

    def _query_metric(self, metric_type: str, minutes: int = 5) -> dict[str, float]:
        from google.cloud import monitoring_v3
        project_name = f"projects/{self._project_id}"
        now = datetime.now(timezone.utc)
        interval = monitoring_v3.TimeInterval(
            end_time={"seconds": int(now.timestamp())},
            start_time={"seconds": int((now - timedelta(minutes=minutes)).timestamp())},
        )
        zone_filter = f' AND resource.labels.zone="{self._zone}"' if self._zone else ""
        results: dict[str, float] = {}
        try:
            series = self._client.list_time_series(request={
                "name": project_name,
                "filter": f'metric.type="{metric_type}"{zone_filter}',
                "interval": interval,
                "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
            })
            for ts in series:
                extracted = _extract_value(ts)
                if extracted:
                    label, value = extracted
                    results[label] = value
        except Exception as exc:
            logger.debug("GCP metric query failed %s: %s", metric_type, exc)
        return results

    def _generate_batch(self) -> list[MetricEvent]:
        cpu_map = self._query_metric("compute.googleapis.com/instance/cpu/utilization")
        ram_used_map = self._query_metric("compute.googleapis.com/instance/memory/balloon/ram_used")
        ram_size_map = self._query_metric("compute.googleapis.com/instance/memory/balloon/ram_size")
        disk_map = self._query_metric("compute.googleapis.com/instance/disk/read_bytes_count")
        net_in_map = self._query_metric("compute.googleapis.com/instance/network/received_bytes_count")
        net_out_map = self._query_metric("compute.googleapis.com/instance/network/sent_bytes_count")

        instance_ids = set(cpu_map) | set(ram_used_map) | set(net_in_map)
        events = []
        for inst_id in instance_ids:
            cpu_pct = (cpu_map.get(inst_id, 0.0)) * 100.0
            ram_used = ram_used_map.get(inst_id, 0.0)
            ram_size = ram_size_map.get(inst_id, 4 * 1024 ** 3)
            mem_pct = (ram_used / max(ram_size, 1)) * 100.0 if ram_used else 0.0
            net_in_b = net_in_map.get(inst_id, 0.0)
            net_out_b = net_out_map.get(inst_id, 0.0)

            events.append(MetricEvent(
                node_name=inst_id,
                node_type="server",
                provider="gcp",
                region=self._zone or self._project_id,
                ip_address="",
                cpu_percent=round(min(cpu_pct, 100.0), 2),
                memory_percent=round(min(mem_pct, 100.0), 2),
                disk_percent=0.0,
                network_in_mbps=round(net_in_b * 8 / 1e6 / 60, 2),
                network_out_mbps=round(net_out_b * 8 / 1e6 / 60, 2),
                request_rate=0.0,
                error_rate=0.0,
                latency_ms=0.0,
                metadata={"gcp": {
                    "cpu_utilization": cpu_map.get(inst_id),
                    "ram_used_bytes": ram_used,
                    "ram_size_bytes": ram_size,
                    "disk_read_bytes": disk_map.get(inst_id),
                }},
            ))
        return events

    async def _with_retry(self, fn) -> list[MetricEvent]:
        last_exc: Exception = RuntimeError("no attempts")
        for delay in _RETRY_DELAYS:
            try:
                return await asyncio.to_thread(fn)
            except Exception as exc:
                last_exc = exc
                await asyncio.sleep(delay)
        raise last_exc

    async def get_current_snapshot(self) -> list[MetricEvent]:
        return await self._with_retry(self._generate_batch)

    async def stream_metrics(self) -> AsyncIterator[list[MetricEvent]]:
        from app.services.settings_service import settings as _s
        consecutive_failures = 0
        while self._connected:
            try:
                batch = await self._with_retry(self._generate_batch)
                consecutive_failures = 0
                _s.update(gcp_status="connected", gcp_error=None)
                yield batch
            except Exception as exc:
                consecutive_failures += 1
                logger.warning("GCP Monitoring poll failure %d/3: %s", consecutive_failures, exc)
                if consecutive_failures >= 3:
                    _s.update(gcp_status="error", gcp_error=str(exc)[:500])
                    self._connected = False
                    return
            await asyncio.sleep(_s.gcp_poll_interval_seconds or 30)

    def test_connection(self) -> dict:
        from app.services.settings_service import settings as _s
        try:
            from google.cloud import monitoring_v3
            from google.oauth2 import service_account
            sa_info = json.loads(_s.gcp_service_account_json)
            creds = service_account.Credentials.from_service_account_info(
                sa_info,
                scopes=["https://www.googleapis.com/auth/monitoring.read"],
            )
            client = monitoring_v3.MetricServiceClient(credentials=creds)
            now = datetime.now(timezone.utc)
            interval = monitoring_v3.TimeInterval(
                end_time={"seconds": int(now.timestamp())},
                start_time={"seconds": int((now - timedelta(minutes=2)).timestamp())},
            )
            list(client.list_time_series(request={
                "name": f"projects/{_s.gcp_project_id}",
                "filter": 'metric.type="compute.googleapis.com/instance/cpu/utilization"',
                "interval": interval,
                "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.HEADERS,
            }))
            return {"ok": True, "message": f"Connected to GCP project {_s.gcp_project_id}", "nodes_found": 0}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:300], "nodes_found": 0}
```

- [ ] **Step 2: Verify import**

```bash
cd /home/shiva/itops/backend
python -c "from app.data_sources.gcp_monitoring import GCPMonitoringDataSource; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/data_sources/gcp_monitoring.py
git commit -m "feat: add GCP Cloud Monitoring data source adapter"
```

---

## Task 7: Settings API endpoints for cloud providers

**Files:**
- Modify: `backend/app/api/routes/settings.py`

- [ ] **Step 1: Add Pydantic models and endpoints**

In `backend/app/api/routes/settings.py`, after the existing `TestProviderRequest` class, add the following (before the `@router.get("/")` endpoint):

```python
class CloudWatchConfig(BaseModel):
    access_key_id: str
    secret_access_key: str
    region: str = "us-east-1"
    instance_ids: list[str] = []
    poll_interval_seconds: int = 30


class AzureMonitorConfig(BaseModel):
    tenant_id: str
    client_id: str
    client_secret: str
    subscription_id: str
    resource_group: str = ""
    poll_interval_seconds: int = 30


class GCPMonitoringConfig(BaseModel):
    project_id: str
    service_account_json: str
    zone: str = ""
    poll_interval_seconds: int = 30
```

Then add three new endpoints at the end of the file:

```python
@router.post("/cloudwatch")
async def configure_cloudwatch(body: CloudWatchConfig) -> dict:
    """Save AWS CloudWatch credentials and test the connection."""
    settings.update(
        cloudwatch_access_key_id=body.access_key_id,
        cloudwatch_secret_access_key=body.secret_access_key,
        cloudwatch_region=body.region,
        cloudwatch_instance_ids=body.instance_ids,
        cloudwatch_poll_interval_seconds=body.poll_interval_seconds,
    )
    from app.data_sources.cloudwatch import CloudWatchDataSource
    adapter = CloudWatchDataSource()
    result = await asyncio.to_thread(adapter.test_connection)
    if result["ok"]:
        settings.update(cloudwatch_status="connected", cloudwatch_error=None)
        # Re-register in the global registry
        from app.data_sources.base import registry
        try:
            await adapter.connect()
            registry.register(adapter)
        except Exception:
            pass
    else:
        settings.update(cloudwatch_status="error", cloudwatch_error=result["message"])
    return result


@router.post("/azure")
async def configure_azure(body: AzureMonitorConfig) -> dict:
    """Save Azure Monitor credentials and test the connection."""
    settings.update(
        azure_tenant_id=body.tenant_id,
        azure_client_id=body.client_id,
        azure_client_secret=body.client_secret,
        azure_subscription_id=body.subscription_id,
        azure_resource_group=body.resource_group,
        azure_poll_interval_seconds=body.poll_interval_seconds,
    )
    from app.data_sources.azure_monitor import AzureMonitorDataSource
    adapter = AzureMonitorDataSource()
    result = await asyncio.to_thread(adapter.test_connection)
    if result["ok"]:
        settings.update(azure_status="connected", azure_error=None)
        from app.data_sources.base import registry
        try:
            await adapter.connect()
            registry.register(adapter)
        except Exception:
            pass
    else:
        settings.update(azure_status="error", azure_error=result["message"])
    return result


@router.post("/gcp")
async def configure_gcp(body: GCPMonitoringConfig) -> dict:
    """Save GCP credentials and test the connection."""
    settings.update(
        gcp_project_id=body.project_id,
        gcp_service_account_json=body.service_account_json,
        gcp_zone=body.zone,
        gcp_poll_interval_seconds=body.poll_interval_seconds,
    )
    from app.data_sources.gcp_monitoring import GCPMonitoringDataSource
    adapter = GCPMonitoringDataSource()
    result = await asyncio.to_thread(adapter.test_connection)
    if result["ok"]:
        settings.update(gcp_status="connected", gcp_error=None)
        from app.data_sources.base import registry
        try:
            await adapter.connect()
            registry.register(adapter)
        except Exception:
            pass
    else:
        settings.update(gcp_status="error", gcp_error=result["message"])
    return result
```

Also add `import asyncio` at the top of the file if not already present.

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /home/shiva/itops/backend
python -c "from app.api.routes.settings import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/settings.py
git commit -m "feat: add cloud provider test-connection settings endpoints"
```

---

## Task 8: Register cloud adapters in main.py

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add cloud adapter startup to `background_monitoring_loop`**

In `backend/app/main.py`, find the `background_monitoring_loop` function. After the lines:
```python
    sim = SimulatorDataSource()
    await sim.connect()
    registry.register(sim)
```

Add the following block to also start cloud adapters and poll them concurrently:

```python
    # Start any configured cloud adapters
    await _start_cloud_adapters()
```

- [ ] **Step 2: Add `_start_cloud_adapters` and `_cloud_polling_loop` functions**

Immediately before the `background_monitoring_loop` function definition, add:

```python
async def _start_cloud_adapters() -> None:
    """Connect and register any cloud adapters that have credentials configured."""
    from app.services.settings_service import settings as _rt_settings
    from app.data_sources.cloudwatch import CloudWatchDataSource
    from app.data_sources.azure_monitor import AzureMonitorDataSource
    from app.data_sources.gcp_monitoring import GCPMonitoringDataSource

    adapters = [
        ("cloudwatch", CloudWatchDataSource, lambda s: bool(s.cloudwatch_access_key_id and s.cloudwatch_secret_access_key)),
        ("azure", AzureMonitorDataSource, lambda s: bool(s.azure_tenant_id and s.azure_client_id and s.azure_client_secret and s.azure_subscription_id)),
        ("gcp", GCPMonitoringDataSource, lambda s: bool(s.gcp_project_id and s.gcp_service_account_json)),
    ]
    for name, cls, has_creds in adapters:
        if not has_creds(_rt_settings):
            continue
        try:
            adapter = cls()
            await adapter.connect()
            registry.register(adapter)
            asyncio.create_task(_cloud_polling_loop(adapter))
            logger.info("Cloud adapter registered: %s", name)
        except Exception as exc:
            logger.warning("Cloud adapter %s failed to connect on startup: %s", name, exc)


async def _cloud_polling_loop(adapter) -> None:
    """Drive a cloud adapter's stream_metrics loop through _process_event."""
    from app.api.routes.ws import manager as ws_manager
    logger.info("Cloud polling loop started: %s", adapter.provider_name)
    try:
        async for batch in adapter.stream_metrics():
            db = SessionLocal()
            try:
                infra_svc = InfraService(db)
                from app.services.incident_service import IncidentService
                ws_payloads = []
                for event in batch:
                    stat_result = await _process_event(
                        event, infra_svc, None, db,
                        sim_source=None,
                        generate_correlated_logs=False,
                    )
                    ws_payloads.append(_event_to_ws_payload(event, stat_result))
                db.commit()
                if ws_payloads:
                    import json as _json
                    await ws_manager.broadcast(_json.dumps({
                        "type": "metrics_batch",
                        "data": ws_payloads,
                    }))
            except Exception as exc:
                logger.error("Cloud poll processing error (%s): %s", adapter.provider_name, exc)
                db.rollback()
            finally:
                db.close()
    except Exception as exc:
        logger.error("Cloud polling loop crashed (%s): %s", adapter.provider_name, exc)
```

- [ ] **Step 3: Verify the app starts without error**

```bash
cd /home/shiva/itops/backend
python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: register cloud adapters in monitoring loop on startup"
```

---

## Task 9: Monitoring agent — adaptive thresholds + rate-of-change

**Files:**
- Modify: `backend/app/agents/monitoring.py`

- [ ] **Step 1: Replace `THRESHOLDS` with `NODE_TYPE_THRESHOLDS`**

In `backend/app/agents/monitoring.py`, replace the `THRESHOLDS` dict entirely with:

```python
NODE_TYPE_THRESHOLDS: dict[str, dict] = {
    "server": {
        "cpu_percent":      {"warning": 75, "high": 85, "critical": 95},
        "memory_percent":   {"warning": 70, "high": 85, "critical": 95},
        "disk_percent":     {"warning": 80, "high": 90, "critical": 95},
        "error_rate":       {"warning": 2,  "high": 5,  "critical": 15},
        "latency_ms":       {"warning": 100,"high": 500,"critical": 2000},
        "network_in_mbps":  {"warning": 800,"high": 900,"critical": 950},
    },
    "database": {
        "cpu_percent":      {"warning": 60, "high": 75, "critical": 90},
        "memory_percent":   {"warning": 80, "high": 90, "critical": 97},
        "disk_percent":     {"warning": 70, "high": 85, "critical": 95},
        "error_rate":       {"warning": 1,  "high": 3,  "critical": 10},
        "latency_ms":       {"warning": 200,"high": 1000,"critical": 5000},
        "network_in_mbps":  {"warning": 700,"high": 850,"critical": 950},
    },
    "cache": {
        "cpu_percent":      {"warning": 70, "high": 85, "critical": 95},
        "memory_percent":   {"warning": 85, "high": 92, "critical": 97},
        "disk_percent":     {"warning": 80, "high": 90, "critical": 95},
        "error_rate":       {"warning": 1,  "high": 3,  "critical": 10},
        "latency_ms":       {"warning": 10, "high": 50, "critical": 200},
        "network_in_mbps":  {"warning": 800,"high": 900,"critical": 950},
    },
    "load_balancer": {
        "cpu_percent":      {"warning": 60, "high": 75, "critical": 90},
        "memory_percent":   {"warning": 65, "high": 80, "critical": 92},
        "disk_percent":     {"warning": 70, "high": 85, "critical": 95},
        "error_rate":       {"warning": 1,  "high": 3,  "critical": 10},
        "latency_ms":       {"warning": 50, "high": 200,"critical": 1000},
        "network_in_mbps":  {"warning": 700,"high": 850,"critical": 950},
    },
    "queue": {
        "cpu_percent":      {"warning": 65, "high": 80, "critical": 92},
        "memory_percent":   {"warning": 75, "high": 88, "critical": 95},
        "disk_percent":     {"warning": 75, "high": 88, "critical": 96},
        "error_rate":       {"warning": 2,  "high": 5,  "critical": 15},
        "latency_ms":       {"warning": 200,"high": 1000,"critical": 5000},
        "network_in_mbps":  {"warning": 700,"high": 850,"critical": 950},
    },
}

def _get_thresholds(node_type: str | None) -> dict:
    return NODE_TYPE_THRESHOLDS.get((node_type or "server").lower(), NODE_TYPE_THRESHOLDS["server"])
```

- [ ] **Step 2: Update `statistical_anomaly_check` to accept `node_type`**

Replace the existing `statistical_anomaly_check` function with:

```python
def statistical_anomaly_check(metrics: dict, node_type: str | None = None) -> dict:
    """Threshold-based anomaly check using per-node-type baselines."""
    thresholds = _get_thresholds(node_type or metrics.get("node_type"))
    anomalies = []
    max_severity = "low"

    for metric_key, threshold_set in thresholds.items():
        value = metrics.get(metric_key, 0)
        for level in ["critical", "high", "warning"]:
            if value >= threshold_set[level]:
                sev = "critical" if level == "critical" else ("high" if level == "high" else "medium")
                anomalies.append({"metric": metric_key, "value": value, "severity": sev})
                if SEVERITY_RANK.get(sev, 0) > SEVERITY_RANK.get(max_severity, 0):
                    max_severity = sev
                break

    if not anomalies:
        return {"is_anomaly": False, "max_severity": None, "anomalies": [], "threshold_profile": node_type or "server"}

    return {
        "is_anomaly": True,
        "anomalies": anomalies,
        "max_severity": max_severity,
        "threshold_profile": node_type or "server",
    }
```

- [ ] **Step 3: Add `_parse_history_readings` and `_compute_trend_signals`**

After the `_clean_log_lines` function, add:

```python
_HISTORY_PATTERN = re.compile(
    r"CPU=(?P<cpu>[\d.]+)% MEM=(?P<mem>[\d.]+)% DISK=(?P<disk>[\d.]+)% "
    r"ERR=(?P<err>[\d.]+)% LAT=(?P<lat>[\d.]+)ms NET_IN=(?P<net>[\d.]+)Mbps"
)

_VELOCITY_THRESHOLDS = {
    "cpu": 5.0,
    "mem": 4.0,
    "disk": 2.0,
    "err": 1.5,
    "lat": 100.0,
    "net": 50.0,
}

_VELOCITY_METRIC_MAP = {
    "cpu": "cpu_percent",
    "mem": "memory_percent",
    "disk": "disk_percent",
    "err": "error_rate",
    "lat": "latency_ms",
    "net": "network_in_mbps",
}


def _parse_history_readings(metric_history: str) -> list[dict[str, float]]:
    readings: list[dict[str, float]] = []
    if not metric_history or "No history" in metric_history:
        return readings
    for line in metric_history.splitlines():
        m = _HISTORY_PATTERN.search(line)
        if m:
            readings.append({k: float(v) for k, v in m.groupdict().items()})
    return readings[-6:]


def _compute_trend_signals(readings: list[dict[str, float]]) -> list[dict]:
    if len(readings) < 2:
        return []
    signals = []
    for key, canonical in _VELOCITY_METRIC_MAP.items():
        vals = [r[key] for r in readings if key in r]
        if len(vals) < 2:
            continue
        velocity = (vals[-1] - vals[0]) / max(len(vals) - 1, 1)
        threshold = _VELOCITY_THRESHOLDS.get(key, 5.0)
        if abs(velocity) >= threshold:
            signals.append({
                "metric": canonical,
                "direction": "rising" if velocity > 0 else "falling",
                "velocity_per_cycle": round(velocity, 3),
            })
    return signals
```

- [ ] **Step 4: Update `preliminary_monitoring_check` to pass `node_type` and add `trend_signals`**

In `preliminary_monitoring_check`, change the first line from:
```python
    metric_result = statistical_anomaly_check(metrics)
```
To:
```python
    node_type = metrics.get("node_type")
    metric_result = statistical_anomaly_check(metrics, node_type=node_type)
    readings = _parse_history_readings(log_history if log_history else "")
    trend_signals = _compute_trend_signals(readings)
```

And in the return dict for the non-anomaly case, add `"trend_signals": trend_signals`. In the anomaly return dict, also add `"trend_signals": trend_signals`.

Also update the final return inside `analyze_metrics` to pass `trend_signals` through:
```python
    result["trend_signals"] = precheck.get("trend_signals", [])
    result["threshold_profile"] = precheck.get("threshold_profile", "server")
```

- [ ] **Step 5: Verify**

```bash
cd /home/shiva/itops/backend
python -c "
from app.agents.monitoring import analyze_metrics
import asyncio
result = asyncio.run(analyze_metrics({'cpu_percent': 96, 'memory_percent': 40, 'disk_percent': 30, 'node_type': 'database'}, 'No logs'))
print(result['is_anomaly'], result['threshold_profile'], result['severity'])
"
```

Expected: `True database critical`

- [ ] **Step 6: Commit**

```bash
git add backend/app/agents/monitoring.py
git commit -m "feat: monitoring agent adaptive thresholds and rate-of-change detection"
```

---

## Task 10: Predictive agent — EWMA + multi-metric correlation

**Files:**
- Modify: `backend/app/agents/predictive.py`

- [ ] **Step 1: Replace `_parse_history_tail` and `_trend_boost` with EWMA-based equivalents**

In `backend/app/agents/predictive.py`, replace `_parse_history_tail` and `_trend_boost` with:

```python
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
    """Slope of the EWMA series — positive = rising trend."""
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
```

- [ ] **Step 2: Add multi-metric correlation bonus**

After the `_metric_pressure` function, add:

```python
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
```

- [ ] **Step 3: Update `predict_failure` to use correlation bonus and return `ewma_scores`**

In `predict_failure`, after `score += _trend_boost(metrics, history)`, add:

```python
    score += _multi_metric_correlation_bonus(metrics)
```

And in the return dict, add:

```python
        "ewma_scores": {
            "cpu_slope": round(_ewma_slope([r["cpu"] for r in history if "cpu" in r]), 3),
            "mem_slope": round(_ewma_slope([r["mem"] for r in history if "mem" in r]), 3),
            "err_slope": round(_ewma_slope([r["err"] for r in history if "err" in r]), 3),
        },
```

- [ ] **Step 4: Verify**

```bash
cd /home/shiva/itops/backend
python -c "
import asyncio
from app.agents.predictive import predict_failure
metrics = {'cpu_percent': 92, 'memory_percent': 88, 'disk_percent': 85, 'error_rate': 12, 'latency_ms': 600, 'network_in_mbps': 820}
anomaly = {'anomaly_type': 'cascading_failure', 'severity': 'critical'}
r = asyncio.run(predict_failure(anomaly, metrics))
print('prob:', r['failure_probability'], 'ewma:', r.get('ewma_scores'))
"
```

Expected: `prob: 0.98` (or close) with ewma_scores dict.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/predictive.py
git commit -m "feat: predictive agent EWMA trend scoring and multi-metric correlation"
```

---

## Task 11: Diagnostic agent — richer LLM prompts with cloud context

**Files:**
- Modify: `backend/app/agents/diagnostic.py`
- Modify: `backend/app/agents/llm_fallback.py`

- [ ] **Step 1: Pass cloud context into `diagnose`**

In `backend/app/agents/diagnostic.py`, update the `diagnose` function signature and query to include provider context:

Replace the query construction line:
```python
    query = (
        f"{anomaly_type} on {metrics.get('node_type', 'server')} "
        f"- {anomaly_data.get('description', '')}"
    )
```
With:
```python
    provider = metrics.get("provider", "simulated")
    region = metrics.get("region", "")
    node_type = metrics.get("node_type", "server")
    trend_signals = anomaly_data.get("trend_signals", [])
    native_metrics_excerpt = {
        k: v for k, v in (metrics.get("metadata") or {}).items()
        if k in ("cloudwatch", "azure_monitor", "gcp")
    }

    query = (
        f"{anomaly_type} on {node_type} ({provider}/{region}) "
        f"- {anomaly_data.get('description', '')}"
    )
```

- [ ] **Step 2: Pass new context fields into LLM fallback call**

In `diagnose`, update the `llm_diagnose` call to pass the new context:

Replace:
```python
            llm_profile = await llm_diagnose(
                anomaly_type=anomaly_type,
                metrics=metrics,
                log_evidence=anomaly_data.get("log_evidence", ""),
                reasons=reasons,
                past_context=past_context,
            )
```
With:
```python
            llm_profile = await llm_diagnose(
                anomaly_type=anomaly_type,
                metrics=metrics,
                log_evidence=anomaly_data.get("log_evidence", ""),
                reasons=reasons,
                past_context=past_context,
                provider=provider,
                region=region,
                node_type=node_type,
                trend_signals=trend_signals,
                native_metrics=native_metrics_excerpt,
            )
```

- [ ] **Step 3: Update the `_DIAGNOSE_PROMPT` and `llm_diagnose` in llm_fallback.py**

In `backend/app/agents/llm_fallback.py`, replace `_DIAGNOSE_PROMPT` with:

```python
_DIAGNOSE_PROMPT = """\
You are an expert SRE diagnostic engine. Think step by step before answering.

Anomaly type: {anomaly_type}
Node type: {node_type}
Cloud provider: {provider}
Region: {region}
Metrics: {metrics_summary}
Log evidence: {log_evidence}
Trend signals (rising/falling metrics): {trend_signals}
Native provider metrics: {native_metrics}
Observed reasons: {reasons}

{past_context_section}

Step 1: Identify the most likely root cause given the provider, node type, and trend signals.
Step 2: Trace the causal chain (what led to what).
Step 3: Assess blast radius (what else is affected).
Step 4: Recommend concrete actions specific to {provider} infrastructure.

Return ONLY a JSON object with these exact keys:
{{
  "root_cause": "one sentence describing the most likely root cause",
  "causal_chain": ["step1", "step2", "step3", "step4", "step5"],
  "blast_radius": ["affected component 1", "affected component 2", "affected component 3"],
  "blast_radius_severity": "low|medium|high",
  "recommended_actions": [
    {{"action": "short action title", "type": "restart_service|config_change|scale_up|rate_limit|rollback|failover|clear_disk|aws_cli|az_cli|gcloud_cli", "priority": 1, "description": "why this helps"}}
  ]
}}

Limit causal_chain to 5 items, blast_radius to 5 items, recommended_actions to 4 items.
"""
```

And update `llm_diagnose` signature to accept new params:

```python
async def llm_diagnose(
    anomaly_type: str,
    metrics: dict,
    log_evidence: str,
    reasons: list[str],
    past_context: str = "",
    provider: str = "simulated",
    region: str = "",
    node_type: str = "server",
    trend_signals: list[dict] | None = None,
    native_metrics: dict | None = None,
) -> dict | None:
    key_metrics = {
        k: metrics.get(k)
        for k in ("cpu_percent", "memory_percent", "disk_percent",
                   "error_rate", "latency_ms", "network_in_mbps")
        if metrics.get(k) is not None
    }
    past_section = ""
    if past_context and past_context != "No similar past incidents found.":
        past_section = f"Past incidents and runbooks for reference:\n{past_context}"

    prompt = _DIAGNOSE_PROMPT.format(
        anomaly_type=anomaly_type,
        node_type=node_type,
        provider=provider,
        region=region or "unknown",
        metrics_summary=json.dumps(key_metrics),
        log_evidence=log_evidence[:500] if log_evidence else "none",
        trend_signals=json.dumps(trend_signals or []),
        native_metrics=json.dumps(native_metrics or {}),
        reasons="; ".join(reasons[:5]) if reasons else "none",
        past_context_section=past_section or "No past incidents available for reference.",
    )
    result = await _call_llm(prompt)
    if not result or "root_cause" not in result:
        return None

    actions_raw = result.get("recommended_actions", [])
    actions = []
    for i, act in enumerate(actions_raw[:4]):
        if isinstance(act, dict):
            actions.append({
                "action": act.get("action", f"Action {i+1}"),
                "type": act.get("type", "config_change"),
                "priority": act.get("priority", i + 1),
                "description": act.get("description", ""),
            })

    return {
        "root_cause": str(result.get("root_cause", "unknown")),
        "causal_chain": [str(s) for s in result.get("causal_chain", [])[:5]],
        "blast_radius": [str(s) for s in result.get("blast_radius", [])[:5]],
        "blast_radius_severity": result.get("blast_radius_severity", "medium"),
        "recommended_actions": actions or [
            {"action": "Investigate and restart the affected service",
             "type": "restart_service", "priority": 1,
             "description": "recover quickly while investigating"},
        ],
    }
```

- [ ] **Step 4: Verify**

```bash
cd /home/shiva/itops/backend
python -c "from app.agents.diagnostic import diagnose; from app.agents.llm_fallback import llm_diagnose; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/diagnostic.py backend/app/agents/llm_fallback.py
git commit -m "feat: diagnostic agent richer cloud-context LLM prompts with chain-of-thought"
```

---

## Task 12: Remediation agent — remove step cap, provider-aware commands

**Files:**
- Modify: `backend/app/agents/remediation.py`
- Modify: `backend/app/agents/llm_fallback.py`

- [ ] **Step 1: Remove the `steps[:3]` cap in `generate_remediation`**

In `backend/app/agents/remediation.py`, find the `generate_remediation` function. Replace:

```python
        "steps": steps[:3],
        "total_estimated_duration_seconds": sum(step.get("estimated_duration_seconds", 0) for step in steps[:3]),
```

With:

```python
        "steps": steps,
        "total_estimated_duration_seconds": sum(step.get("estimated_duration_seconds", 0) for step in steps),
```

- [ ] **Step 2: Add provider-aware command generation to `_infer_service_name`**

In `generate_remediation`, after `service_name = _infer_service_name(metrics, log_history)`, add:

```python
    provider = metrics.get("provider", "simulated")
```

Pass `provider` to `_build_plan`:

```python
    steps, artifacts, plan_summary, generated_locally, past_context = await _build_plan(
        issue_type, service_name, metrics, log_history, root_cause, provider=provider,
    )
```

- [ ] **Step 3: Update `_build_plan` to accept and use `provider`**

Change the signature of `_build_plan`:
```python
async def _build_plan(
    issue_type: str, service_name: str, metrics: dict,
    log_history: str, root_cause: str = "", provider: str = "simulated",
) -> tuple[list[dict], list[dict], str, bool, str]:
```

And update the `context` dict to include the provider:
```python
    context = {
        "service_name": service_name,
        "node_name": metrics.get("node_name", "unknown-node"),
        "issue_type": issue_type,
        "prefix": issue_type.replace("_", " "),
        "provider": provider,
        "restart_cmd": _provider_restart_cmd(service_name, provider),
        "logs_cmd": _provider_logs_cmd(service_name, provider),
    }
```

- [ ] **Step 4: Add `_provider_restart_cmd` and `_provider_logs_cmd` helpers**

Before `_build_plan`, add:

```python
def _provider_restart_cmd(service_name: str, provider: str) -> str:
    if provider == "aws":
        return f"aws ec2 reboot-instances --instance-ids $INSTANCE_ID  # or: systemctl restart {service_name}"
    if provider == "azure":
        return f"az vm restart --name $VM_NAME --resource-group $RESOURCE_GROUP  # or: systemctl restart {service_name}"
    if provider == "gcp":
        return f"gcloud compute instances reset $INSTANCE_NAME --zone=$ZONE  # or: systemctl restart {service_name}"
    return f"systemctl restart {service_name}"


def _provider_logs_cmd(service_name: str, provider: str) -> str:
    if provider == "aws":
        return f"aws logs filter-log-events --log-group-name /aws/ec2/{service_name}"
    if provider == "azure":
        return f"az monitor activity-log list --resource-group $RESOURCE_GROUP"
    if provider == "gcp":
        return f"gcloud logging read 'resource.type=gce_instance' --limit=50"
    return f"journalctl -u {service_name} -n 100"
```

- [ ] **Step 5: Pass provider context to LLM fallback**

In `_build_plan`, update the `llm_remediate` call:
```python
        llm_result = await llm_remediate(
            issue_type=issue_type,
            service_name=service_name,
            node_name=context["node_name"],
            root_cause=root_cause,
            metrics=metrics,
            past_context=past_context,
            provider=provider,
        )
```

- [ ] **Step 6: Update `_REMEDIATE_PROMPT` and `llm_remediate` in llm_fallback.py**

In `backend/app/agents/llm_fallback.py`, replace `_REMEDIATE_PROMPT`:

```python
_REMEDIATE_PROMPT = """\
You are an expert SRE remediation engine. Generate a remediation plan for this incident.

Issue type: {issue_type}
Service: {service_name}
Node: {node_name}
Cloud provider: {provider}
Root cause: {root_cause}
Key metrics: {metrics_summary}

{past_context_section}

Use provider-appropriate CLI commands:
- AWS: use aws CLI (aws ec2, aws rds, aws logs, etc.)
- Azure: use az CLI (az vm, az monitor, etc.)
- GCP: use gcloud CLI (gcloud compute, gcloud logging, etc.)
- simulated/other: use systemctl, journalctl, standard Linux tools

Return ONLY a JSON object with these exact keys:
{{
  "plan_summary": "one sentence summarizing the fix",
  "steps": [
    {{
      "order": 1,
      "action": "short action title",
      "description": "what this step does and why",
      "bash_commands": ["cmd1", "cmd2"]
    }}
  ],
  "rollback_commands": ["cmd1", "cmd2"]
}}

Limit to 5 steps. The service is "{service_name}" on {provider} infrastructure.
"""
```

Update `llm_remediate` signature:
```python
async def llm_remediate(
    issue_type: str,
    service_name: str,
    node_name: str,
    root_cause: str,
    metrics: dict,
    past_context: str = "",
    provider: str = "simulated",
) -> tuple[list[dict], list[dict], str] | None:
```

And add `provider=provider` to the prompt format call.

- [ ] **Step 7: Verify**

```bash
cd /home/shiva/itops/backend
python -c "from app.agents.remediation import generate_remediation; print('OK')"
```

Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add backend/app/agents/remediation.py backend/app/agents/llm_fallback.py
git commit -m "feat: remediation agent removes step cap and adds provider-aware CLI commands"
```

---

## Task 13: Reporting agent — MTTR, SLA impact, timeline

**Files:**
- Modify: `backend/app/agents/reporting.py`

- [ ] **Step 1: Add helper functions**

In `backend/app/agents/reporting.py`, after the `_build_executive_summary` function, add:

```python
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
```

- [ ] **Step 2: Update `generate_report` to populate new fields**

In `generate_report`, update the result dict:

```python
    agent_trace = monitoring_data.get("agent_trace") or prediction_data.get("agent_trace") or []
    # Collect agent_trace from kwargs if passed separately
    timeline = _build_timeline(agent_trace)
    mttr = _build_mttr_estimate(agent_trace, remediation_data)
    sla_impact = _build_sla_impact(
        severity=severity,
        predicted_impact=prediction_data.get("predicted_impact"),
        anomaly_type=anomaly_type,
    )

    result = {
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
```

Also update the orchestrator `reporting_node` call to pass `agent_trace` through:

In `backend/app/agents/orchestrator.py`, update the `reporting_node` call to `generate_report` — add `agent_trace=state.get("agent_trace", [])` as a kwarg, and update `generate_report`'s signature to accept `agent_trace: list[dict] | None = None`.

In `generate_report`, replace `agent_trace = monitoring_data.get("agent_trace") or ...` with:
```python
    agent_trace = kwargs.get("agent_trace") or []
```

And update the function signature to:
```python
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
    agent_trace = agent_trace or []
```

- [ ] **Step 3: Update orchestrator reporting_node call**

In `backend/app/agents/orchestrator.py`, find the `reporting_node` call to `generate_report` and add `agent_trace=state.get("agent_trace", [])`:

```python
    result = await generate_report(
        monitoring_data=state.get("monitoring_result", {}),
        prediction_data=state.get("prediction_result", {}),
        diagnostic_data=state.get("diagnostic_result", {}),
        remediation_data=state.get("remediation_result", {}),
        metrics=state["metrics"],
        outcome="resolved",
        log_history=state.get("log_history", "No logs available"),
        agent_trace=state.get("agent_trace", []),
    )
```

- [ ] **Step 4: Verify**

```bash
cd /home/shiva/itops/backend
python -c "from app.agents.reporting import generate_report; import asyncio; r = asyncio.run(generate_report({}, {}, {}, {}, {'node_name': 'test'}, agent_trace=[])); print(r.get('sla_impact'), r.get('mttr_estimate_minutes'))"
```

Expected: a P3/P2 SLA string, `None` (no trace data).

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/reporting.py backend/app/agents/orchestrator.py
git commit -m "feat: reporting agent adds MTTR estimate, SLA impact, and agent timeline"
```

---

## Task 14: Orchestrator — per-node timeout, retry, partial failure

**Files:**
- Modify: `backend/app/agents/orchestrator.py`

- [ ] **Step 1: Add timeout wrapper for each agent node**

In `backend/app/agents/orchestrator.py`, add a constant and wrapper near the top (after imports):

```python
NODE_TIMEOUT_SECONDS = 30
```

- [ ] **Step 2: Wrap each node function with timeout + partial failure handling**

Replace the four node functions (`monitoring_node`, `predictive_node`, `diagnostic_node`, `remediation_node`) bodies with timeout-wrapped versions. Add this helper function after the `_emit_progress` function:

```python
async def _run_with_timeout(coro, node_name: str, timeout: float = NODE_TIMEOUT_SECONDS):
    """Run a coroutine with a timeout. Returns result or raises TimeoutError."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise asyncio.TimeoutError(f"Agent '{node_name}' timed out after {timeout}s")
```

Then wrap each node's core call. For example, in `monitoring_node`, replace:
```python
    result = await analyze_metrics(
        state["metrics"],
        log_history=state.get("log_history", "No logs available"),
    )
```
With:
```python
    result = await _run_with_timeout(
        analyze_metrics(
            state["metrics"],
            log_history=state.get("log_history", "No logs available"),
        ),
        "monitoring",
    )
```

Apply the same `_run_with_timeout` wrap to `predictive_node`, `diagnostic_node`, and `remediation_node` around their respective agent calls.

- [ ] **Step 3: Add partial failure handling to each node**

Wrap each node function body with try/except to emit `partial_failure` instead of crashing:

For `monitoring_node`, wrap the entire body after the started/emit lines:

```python
async def monitoring_node(state: OrchestratorState) -> dict:
    logger.info("Orchestrator: Running Monitoring Agent")
    started = utc_now()
    await _emit_progress(state, "monitoring", "started", "Monitoring agent started")
    try:
        result = await _run_with_timeout(
            analyze_metrics(
                state["metrics"],
                log_history=state.get("log_history", "No logs available"),
            ),
            "monitoring",
        )
    except Exception as exc:
        logger.warning("Monitoring agent failed (partial): %s", exc)
        result = {"is_anomaly": False, "anomaly_type": None, "severity": None,
                  "description": f"Monitoring agent failed: {exc}", "affected_metrics": [],
                  "log_evidence": "", "agent": "monitoring", "partial_failure": True}

    trace_entry = {
        "agent": "monitoring",
        "started_at": started.isoformat(),
        "completed_at": utc_now().isoformat(),
        "is_anomaly": result.get("is_anomaly", False),
        "partial_failure": result.get("partial_failure", False),
    }
    trace = state.get("agent_trace", [])
    trace.append(trace_entry)
    await _emit_progress(
        state, "monitoring", "completed" if not result.get("partial_failure") else "partial_failure",
        "Monitoring agent completed",
        is_anomaly=result.get("is_anomaly", False),
    )
    return {
        "monitoring_result": result,
        "is_anomaly": result.get("is_anomaly", False),
        "severity": result.get("severity"),
        "status": "monitored",
        "agent_trace": trace,
    }
```

Apply the same try/except + `partial_failure` flag pattern to `predictive_node`, `diagnostic_node`, and `remediation_node`.

- [ ] **Step 4: Add retry to `run_pipeline`**

In `run_pipeline`, wrap the `orchestrator.ainvoke` call with a single retry:

```python
    try:
        await _emit_progress(
            initial_state, "pipeline", "started",
            f"Pipeline started for node: {metrics.get('node_name', 'custom')}",
        )
        try:
            final_state = await orchestrator.ainvoke(initial_state)
        except Exception as first_exc:
            logger.warning("Pipeline first attempt failed (%s), retrying in 2s...", first_exc)
            await asyncio.sleep(2)
            final_state = await orchestrator.ainvoke(initial_state)

        await _emit_progress(
            final_state, "pipeline", "completed",
            f"Pipeline completed with status: {final_state.get('status', 'unknown')}",
            is_anomaly=final_state.get("is_anomaly", False),
        )
        return final_state
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        initial_state["error"] = str(e)
        initial_state["status"] = "error"
        await _emit_progress(
            initial_state, "pipeline", "error",
            f"Pipeline failed: {e}",
            error=str(e),
        )
        return initial_state
```

- [ ] **Step 5: Verify**

```bash
cd /home/shiva/itops/backend
python -c "from app.agents.orchestrator import run_pipeline, NODE_TIMEOUT_SECONDS; print('timeout:', NODE_TIMEOUT_SECONDS)"
```

Expected: `timeout: 30`

- [ ] **Step 6: Commit**

```bash
git add backend/app/agents/orchestrator.py
git commit -m "feat: orchestrator per-node 30s timeout, partial failure handling, and pipeline retry"
```

---

## Task 15: End-to-end smoke test

- [ ] **Step 1: Start the backend and verify it boots**

```bash
cd /home/shiva/itops/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
sleep 4
curl -s http://localhost:8000/api/settings/ | python -m json.tool | grep cloudwatch_status
```

Expected: `"cloudwatch_status": "disconnected"`

- [ ] **Step 2: Verify all 3 cloud settings endpoints exist**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/settings/cloudwatch \
  -H "Content-Type: application/json" \
  -d '{"access_key_id":"bad","secret_access_key":"bad","region":"us-east-1","instance_ids":[]}'
```

Expected: `200` (returns `{ok: false, message: "..."}` — bad creds fail gracefully)

- [ ] **Step 3: Run the pipeline against the simulator and verify new fields**

```bash
curl -s -X POST http://localhost:8000/api/agents/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"custom_metrics": {"node_name":"smoke-test","node_type":"server","cpu_percent":96,"memory_percent":92,"disk_percent":85,"error_rate":18,"latency_ms":2500,"network_in_mbps":920}}' \
  | python -m json.tool | grep -E '"severity"|"sla_impact"|"mttr_estimate|threshold_profile"'
```

Expected: `severity`, `sla_impact`, `mttr_estimate_minutes`, `threshold_profile` all present.

- [ ] **Step 4: Kill the dev server**

```bash
pkill -f "uvicorn app.main"
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: enterprise agents and cloud adapter implementation complete"
```
