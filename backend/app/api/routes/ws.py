"""WebSocket endpoint for real-time metric streaming."""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database.session import SessionLocal
from app.database.models import SimulatorStatus, SimulatorType, InfrastructureNode, LogEntry
from app.services.simulator_service import SimulatorService, apply_metric_variance
from app.config import utc_now


def _format_db_log_line(entry: LogEntry) -> str:
    """Render a stored LogEntry as a single terminal-style line."""
    ts = entry.timestamp.isoformat() if entry.timestamp else "N/A"
    return f"[{ts}] {entry.level:<8} ({entry.source}) {entry.message}"


def _now_iso() -> str:
    return utc_now().isoformat() + "Z"

logger = logging.getLogger("itops.ws")

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._last_payload: dict | None = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send the last known metric batch immediately so new
        # clients don't have to wait for the next monitoring tick.
        if self._last_payload is not None:
            try:
                await websocket.send_json(self._last_payload)
            except Exception:
                pass
        logger.info(f"WS connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        try:
            self.active_connections.remove(websocket)
        except ValueError:
            pass  # already removed by broadcast()
        logger.info(f"WS disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        self._last_payload = message
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

    Data is pushed by the background monitoring loop via
    ``manager.broadcast()``, so this endpoint simply keeps the
    connection alive and removes it on disconnect.
    """
    await manager.connect(websocket)
    try:
        # Block until the client disconnects.  The monitoring loop in
        # main.py calls ``manager.broadcast()`` every tick, which sends
        # the data to all connected clients automatically.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WS error: {e}")
        manager.disconnect(websocket)




@router.websocket("/ws/simulator-logs/{simulator_id}")
async def websocket_simulator_logs(websocket: WebSocket, simulator_id: int):
    """
    Stream log lines for a simulator.  The background advancement loop in
    main.py drives line progression; this endpoint just observes DB state
    and pushes new lines + status updates to the connected client.

    Messages sent:
    - {"type": "log_line",    "line": "...", "line_number": N, "total_lines": M}
    - {"type": "status",      "status": "running|paused|stopped|finished", "current_line": N, "total_lines": M}
    - {"type": "metric_event","metrics": {...}, "timestamp": T}
    - {"type": "error",       "message": "..."}
    """
    await websocket.accept()
    db = SessionLocal()
    try:
        svc = SimulatorService(db)
        sim = svc.get_simulator(simulator_id)

        if not sim:
            await websocket.send_json({"type": "error", "message": "Simulator not found"})
            await websocket.close()
            return

        is_metrics = sim.simulator_type == SimulatorType.METRICS

        # Send initial status
        await websocket.send_json({
            "type": "status",
            "status": sim.status.value,
            "current_line": sim.current_line_index,
            "total_lines": sim.total_lines,
            "is_metrics": is_metrics,
        })

        # ── Fleet-metrics simulators: stream live DB-backed log entries ──
        # The background monitoring loop writes realistic LogEntry rows
        # for the matching InfrastructureNode each tick (see
        # SimulatorDataSource.generate_logs_for_event). We tail those.
        if is_metrics:
            node = (
                db.query(InfrastructureNode)
                .filter(InfrastructureNode.node_name == sim.name)
                .first()
            )
            last_log_id = 0

            # Send a small backlog so the terminal isn't empty on open
            if node is not None:
                backlog = (
                    db.query(LogEntry)
                    .filter(LogEntry.node_id == node.id)
                    .order_by(LogEntry.id.desc())
                    .limit(40)
                    .all()
                )
                for entry in reversed(backlog):
                    await websocket.send_json({
                        "type": "log_line",
                        "line": _format_db_log_line(entry),
                        "level": entry.level,
                        "source": entry.source,
                        "timestamp": entry.timestamp.isoformat() if entry.timestamp else _now_iso(),
                    })
                    if entry.id > last_log_id:
                        last_log_id = entry.id

            while True:
                # Force a fresh transaction snapshot so we see rows that
                # the background loop has committed in another session.
                db.expire_all()
                db.refresh(sim)

                if node is None:
                    node = (
                        db.query(InfrastructureNode)
                        .filter(InfrastructureNode.node_name == sim.name)
                        .first()
                    )

                if node is not None:
                    new_logs = (
                        db.query(LogEntry)
                        .filter(LogEntry.node_id == node.id, LogEntry.id > last_log_id)
                        .order_by(LogEntry.id.asc())
                        .limit(50)
                        .all()
                    )
                    for entry in new_logs:
                        await websocket.send_json({
                            "type": "log_line",
                            "line": _format_db_log_line(entry),
                            "level": entry.level,
                            "source": entry.source,
                            "timestamp": entry.timestamp.isoformat() if entry.timestamp else _now_iso(),
                        })
                        if entry.id > last_log_id:
                            last_log_id = entry.id

                await websocket.send_json({
                    "type": "status",
                    "status": sim.status.value,
                    "current_line": 0,
                    "total_lines": 0,
                    "is_metrics": True,
                })

                await asyncio.sleep(1)

        # ── Log-file playback simulators (vm/db/cache/lb/queue) ──
        last_sent_index = 0

        while True:
            db.refresh(sim)
            current_idx = sim.current_line_index

            # Stream any lines the background task has advanced past
            if current_idx > last_sent_index and sim.log_file_content:
                lines = sim.log_file_content.strip().split("\n")
                for i in range(last_sent_index, min(current_idx, len(lines))):
                    await websocket.send_json({
                        "type": "log_line",
                        "line": lines[i],
                        "line_number": i + 1,
                        "total_lines": sim.total_lines,
                        "timestamp": _now_iso(),
                    })
                last_sent_index = current_idx

            # Status pulse every tick
            await websocket.send_json({
                "type": "status",
                "status": sim.status.value,
                "current_line": current_idx,
                "total_lines": sim.total_lines,
                "is_metrics": False,
            })

            # Metrics pulse when enabled and running
            if (
                sim.metrics_enabled
                and sim.metrics_config
                and sim.status == SimulatorStatus.RUNNING
            ):
                await websocket.send_json({
                    "type": "metric_event",
                    "metrics": apply_metric_variance(sim.metrics_config),
                    "timestamp": _now_iso(),
                })

            await asyncio.sleep(1)

    except WebSocketDisconnect:
        logger.info(f"Simulator WS disconnected: {simulator_id}")
    except Exception as e:
        logger.error(f"Simulator WS error: {e}")
    finally:
        db.close()
