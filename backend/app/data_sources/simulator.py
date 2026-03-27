"""
Simulated infrastructure data source.

Generates realistic streaming metrics for a fleet of servers, databases,
load balancers, caches, and queues. Injects anomalies probabilistically
to trigger the agent pipeline.
"""

import asyncio
import math
import random
import time
from typing import AsyncIterator

from app.config import (
    SIMULATOR_INTERVAL_SECONDS,
    NUM_SIMULATED_SERVERS,
    ANOMALY_PROBABILITY,
)
from app.data_sources.base import DataSource, MetricEvent

# ── Fleet definition ────────────────────────────────────────────────
_FLEET_TEMPLATES = [
    {"name": "web-server-{i}", "type": "server", "region": "us-east-1", "count": max(1, NUM_SIMULATED_SERVERS // 3)},
    {"name": "api-server-{i}", "type": "server", "region": "us-west-2", "count": max(1, NUM_SIMULATED_SERVERS // 3)},
    {"name": "postgres-primary", "type": "database", "region": "us-east-1", "count": 1},
    {"name": "postgres-replica-{i}", "type": "database", "region": "us-east-1", "count": 1},
    {"name": "redis-cache-{i}", "type": "cache", "region": "us-east-1", "count": 1},
    {"name": "lb-frontend", "type": "load_balancer", "region": "us-east-1", "count": 1},
    {"name": "rabbitmq-{i}", "type": "queue", "region": "us-west-2", "count": 1},
]

# ── Anomaly scenarios ──────────────────────────────────────────────
ANOMALY_SCENARIOS = [
    {
        "name": "memory_leak",
        "description": "Gradual memory leak in application process",
        "affected_metrics": {"memory_percent": (85, 99), "latency_ms": (200, 800)},
    },
    {
        "name": "cpu_spike",
        "description": "CPU spike due to runaway process or crypto-mining",
        "affected_metrics": {"cpu_percent": (90, 100), "latency_ms": (300, 1500)},
    },
    {
        "name": "disk_full",
        "description": "Disk filling up from unrotated logs",
        "affected_metrics": {"disk_percent": (90, 99), "error_rate": (5, 25)},
    },
    {
        "name": "network_saturation",
        "description": "Network bandwidth saturated by DDoS or misconfigured service",
        "affected_metrics": {"network_in_mbps": (900, 1000), "latency_ms": (500, 3000), "error_rate": (10, 40)},
    },
    {
        "name": "connection_pool_exhaustion",
        "description": "Database connection pool exhaustion",
        "affected_metrics": {"latency_ms": (1000, 5000), "error_rate": (20, 60)},
    },
    {
        "name": "cascading_failure",
        "description": "Upstream service failure causing cascading errors",
        "affected_metrics": {"error_rate": (30, 80), "latency_ms": (2000, 10000), "request_rate": (5, 20)},
    },
]


def _build_fleet() -> list[dict]:
    """Expand fleet templates into individual node definitions."""
    fleet = []
    counters: dict[str, int] = {}
    for tpl in _FLEET_TEMPLATES:
        for i in range(tpl["count"]):
            name = tpl["name"].format(i=i + 1)
            if name in counters:
                counters[name] += 1
                name = f"{name}-{counters[name]}"
            else:
                counters[name] = 1
            fleet.append({
                "name": name,
                "type": tpl["type"],
                "region": tpl["region"],
                "ip": f"10.0.{random.randint(1, 254)}.{random.randint(1, 254)}",
            })
    return fleet


class SimulatorDataSource(DataSource):
    """Generates realistic simulated infrastructure metrics."""

    def __init__(self):
        self._fleet = _build_fleet()
        self._tick = 0
        self._active_anomalies: dict[str, dict] = {}  # node_name -> scenario
        self._connected = False

    @property
    def provider_name(self) -> str:
        return "simulated"

    @property
    def fleet(self) -> list[dict]:
        return self._fleet

    async def connect(self) -> None:
        self._connected = True

    async def disconnect(self) -> None:
        self._connected = False

    def _base_metrics(self, node: dict) -> dict:
        """Generate healthy baseline metrics with realistic variance."""
        t = time.time()
        # Diurnal pattern: higher load during 'business hours'
        hour_factor = 0.5 + 0.5 * math.sin(t / 3600 * math.pi)
        jitter = random.gauss(0, 2)

        base = {
            "cpu_percent": max(0, min(100, 15 + 20 * hour_factor + jitter)),
            "memory_percent": max(0, min(100, 40 + 10 * hour_factor + random.gauss(0, 3))),
            "disk_percent": max(0, min(100, 45 + self._tick * 0.001 + random.gauss(0, 1))),
            "network_in_mbps": max(0, 50 + 30 * hour_factor + random.gauss(0, 5)),
            "network_out_mbps": max(0, 30 + 20 * hour_factor + random.gauss(0, 3)),
            "request_rate": max(0, 200 + 150 * hour_factor + random.gauss(0, 10)),
            "error_rate": max(0, 0.5 + random.gauss(0, 0.3)),
            "latency_ms": max(1, 25 + 10 * hour_factor + random.gauss(0, 5)),
        }

        # Node-type adjustments
        if node["type"] == "database":
            base["cpu_percent"] *= 0.7
            base["memory_percent"] = min(100, base["memory_percent"] * 1.3)
            base["disk_percent"] = min(100, base["disk_percent"] * 1.2)
        elif node["type"] == "cache":
            base["memory_percent"] = min(100, base["memory_percent"] * 1.5)
            base["latency_ms"] *= 0.3
        elif node["type"] == "load_balancer":
            base["request_rate"] *= 3
            base["cpu_percent"] *= 0.5

        return base

    def _maybe_inject_anomaly(self, node_name: str, metrics: dict) -> tuple[dict, dict | None]:
        """Probabilistically inject an anomaly into a node's metrics."""
        # Check if this node already has an active anomaly
        if node_name in self._active_anomalies:
            scenario = self._active_anomalies[node_name]
            # 20% chance the anomaly resolves itself
            if random.random() < 0.2:
                del self._active_anomalies[node_name]
                return metrics, None
            # Apply anomaly
            for metric_key, (low, high) in scenario["affected_metrics"].items():
                metrics[metric_key] = random.uniform(low, high)
            return metrics, scenario

        # Maybe start a new anomaly
        if random.random() < ANOMALY_PROBABILITY:
            scenario = random.choice(ANOMALY_SCENARIOS)
            self._active_anomalies[node_name] = scenario
            for metric_key, (low, high) in scenario["affected_metrics"].items():
                metrics[metric_key] = random.uniform(low, high)
            return metrics, scenario

        return metrics, None

    def _generate_batch(self) -> list[MetricEvent]:
        """Generate one batch of metrics for all fleet nodes."""
        self._tick += 1
        events = []
        for node in self._fleet:
            metrics = self._base_metrics(node)
            metrics, anomaly = self._maybe_inject_anomaly(node["name"], metrics)
            meta = {}
            if anomaly:
                meta["anomaly_scenario"] = anomaly["name"]
                meta["anomaly_description"] = anomaly["description"]
            events.append(MetricEvent(
                node_name=node["name"],
                node_type=node["type"],
                provider="simulated",
                region=node["region"],
                ip_address=node["ip"],
                cpu_percent=round(metrics["cpu_percent"], 2),
                memory_percent=round(metrics["memory_percent"], 2),
                disk_percent=round(metrics["disk_percent"], 2),
                network_in_mbps=round(metrics["network_in_mbps"], 2),
                network_out_mbps=round(metrics["network_out_mbps"], 2),
                request_rate=round(metrics["request_rate"], 2),
                error_rate=round(metrics["error_rate"], 2),
                latency_ms=round(metrics["latency_ms"], 2),
                metadata=meta,
            ))
        return events

    async def stream_metrics(self) -> AsyncIterator[list[MetricEvent]]:
        """Continuously yield metric batches at the configured interval."""
        while self._connected:
            yield self._generate_batch()
            await asyncio.sleep(SIMULATOR_INTERVAL_SECONDS)

    async def get_current_snapshot(self) -> list[MetricEvent]:
        """Return a single batch."""
        return self._generate_batch()

    @property
    def active_anomalies(self) -> dict[str, dict]:
        return dict(self._active_anomalies)
