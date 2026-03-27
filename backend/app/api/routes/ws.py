"""WebSocket endpoint for real-time metric streaming."""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.data_sources.simulator import SimulatorDataSource
from app.agents.monitoring import statistical_anomaly_check

logger = logging.getLogger("itops.ws")

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WS connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WS disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.active_connections.remove(conn)


manager = ConnectionManager()


@router.websocket("/ws/metrics")
async def websocket_metrics(websocket: WebSocket):
    """
    Stream real-time simulated metrics over WebSocket.

    Each message contains the full fleet snapshot with anomaly flags.
    Frontend can use this for live dashboard updates.
    """
    await manager.connect(websocket)
    sim = SimulatorDataSource()
    await sim.connect()

    try:
        async for batch in sim.stream_metrics():
            payload = []
            for event in batch:
                metrics_dict = {
                    "cpu_percent": event.cpu_percent,
                    "memory_percent": event.memory_percent,
                    "disk_percent": event.disk_percent,
                    "network_in_mbps": event.network_in_mbps,
                    "network_out_mbps": event.network_out_mbps,
                    "request_rate": event.request_rate,
                    "error_rate": event.error_rate,
                    "latency_ms": event.latency_ms,
                }
                stat_check = statistical_anomaly_check(metrics_dict)

                payload.append({
                    "node_name": event.node_name,
                    "node_type": event.node_type,
                    "provider": event.provider,
                    "region": event.region,
                    "metrics": metrics_dict,
                    "is_anomaly": stat_check.get("is_anomaly", False),
                    "anomaly_severity": stat_check.get("max_severity") if stat_check.get("is_anomaly") else None,
                    "metadata": event.metadata,
                })

            await websocket.send_json({
                "type": "metric_batch",
                "data": payload,
                "timestamp": asyncio.get_event_loop().time(),
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WS error: {e}")
        manager.disconnect(websocket)
    finally:
        await sim.disconnect()
