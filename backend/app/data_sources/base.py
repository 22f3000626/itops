"""
Pluggable data source interface.

To connect a real cloud provider, implement the DataSource ABC
and register it in the DataSourceRegistry. The simulator is provided
as the default for development/demo.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class MetricEvent:
    """Canonical metric event — cloud-agnostic representation."""
    node_name: str
    node_type: str  # server, database, load_balancer, cache, queue
    provider: str  # aws, azure, gcp, simulated
    region: str
    ip_address: str
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    network_in_mbps: float
    network_out_mbps: float
    request_rate: float
    error_rate: float
    latency_ms: float
    metadata: dict = field(default_factory=dict)


class DataSource(ABC):
    """Abstract base class for all infrastructure data sources."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        ...

    @abstractmethod
    async def connect(self) -> None:
        """Initialize connection to the data source."""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Clean up connection."""
        ...

    @abstractmethod
    async def stream_metrics(self) -> AsyncIterator[list[MetricEvent]]:
        """Yield batches of metric events. Each yield = one polling cycle."""
        ...

    @abstractmethod
    async def get_current_snapshot(self) -> list[MetricEvent]:
        """Return the latest metrics for all nodes — single poll."""
        ...


class DataSourceRegistry:
    """Registry that allows plugging in multiple data sources."""

    def __init__(self):
        self._sources: dict[str, DataSource] = {}

    def register(self, source: DataSource) -> None:
        self._sources[source.provider_name] = source

    def get(self, provider: str) -> DataSource | None:
        return self._sources.get(provider)

    @property
    def all_sources(self) -> list[DataSource]:
        return list(self._sources.values())

    @property
    def provider_names(self) -> list[str]:
        return list(self._sources.keys())


# Global registry
registry = DataSourceRegistry()
