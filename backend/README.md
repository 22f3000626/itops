# Dynamic IT Operations Orchestrator

**Autonomous Multi-Agent AIOps Platform for Self-Healing Enterprise Infrastructure**

Team: Tank Busters (P.Shiva Santhosh, N.S.J.S.Dhanush, P.Shikhar)

---

## Architecture Overview

```
                          ┌──────────────────────────────────────────────┐
                          │          LangGraph Orchestrator              │
                          │                                              │
  Simulated/Real  ──►     │  Monitor ─► Predict ─► Diagnose ─►          │
  Infrastructure          │           │                    │             │
  Data Sources            │           │              [Human-in-the-Loop] │
                          │           │                    │             │
                          │           └──► Remediate ─► Report ──► END  │
                          └──────────────────────────────────────────────┘
                                    │                           │
                          ┌─────────┴──────────┐    ┌──────────┴────────┐
                          │   SQLite + SQLAlchemy │    │  ChromaDB Vector  │
                          │   (Incidents, Metrics,│    │  Store (RAG for   │
                          │    Nodes, Runbooks)   │    │  Institutional    │
                          └────────────────────────┘    │  Memory)          │
                                                        └───────────────────┘
```

## Tech Stack

| Component | Technology |
|---|---|
| Backend Framework | FastAPI |
| AI Agents | LangChain + LangGraph |
| LLM | OpenAI (gpt-4o-mini / gpt-4o) |
| Database | SQLite + SQLAlchemy ORM |
| Vector Store | ChromaDB (institutional memory / RAG) |
| Real-time | WebSocket (streaming metrics) |
| Data Sources | Pluggable architecture (simulator included) |

## Agents

### 1. Monitoring Agent
- **Role**: Anomaly detection using statistical thresholds + LLM reasoning
- **How it works**: Two-stage detection — fast threshold-based pre-filter, then LLM for context-aware classification
- **Output**: Anomaly type, severity, affected metrics

### 2. Predictive Agent
- **Role**: Failure forecasting and trajectory prediction
- **How it works**: Analyzes current anomaly + metric history trends via LLM to predict failure probability, time-to-failure, and cascading risk
- **Output**: Failure probability, escalation risk, urgency recommendation

### 3. Diagnostic Agent (Root Cause Analysis)
- **Role**: Causal reasoning to identify root cause
- **How it works**: Uses LLM + RAG from institutional memory (past incidents, runbooks) for root cause analysis
- **Output**: Root cause, causal chain, blast radius, remediation recommendations

### 4. Remediation Agent
- **Role**: Generate executable remediation plans
- **How it works**: Creates step-by-step bash scripts with rollback scripts, supports canary rollout (5% → 25% → 100%)
- **Output**: Remediation plan, scripts, rollback scripts, risk assessment

### 5. Reporting Agent
- **Role**: Incident reports and knowledge capture
- **How it works**: Generates executive summaries, timelines, and auto-creates runbook entries for institutional memory
- **Output**: Report, runbook entry, lessons learned

## Human-in-the-Loop

- **Low/Medium severity**: Auto-approved (configurable via `REMEDIATION_AUTO_APPROVE_SEVERITY`)
- **High/Critical severity**: Requires human approval via `POST /api/incidents/{id}/approve`
- The LangGraph workflow pauses at the approval checkpoint and resumes on decision

## Data Source Architecture (Pluggable)

The system uses an abstract `DataSource` interface. To connect real infrastructure:

```python
from app.data_sources.base import DataSource, MetricEvent, registry

class AWSDataSource(DataSource):
    provider_name = "aws"

    async def connect(self):
        # Initialize boto3 CloudWatch client
        ...

    async def stream_metrics(self):
        # Yield MetricEvent batches from CloudWatch
        ...

# Register it
registry.register(AWSDataSource())
```

The built-in **SimulatorDataSource** generates realistic metrics with:
- Diurnal load patterns (time-of-day variation)
- Node-type-specific baselines (DB, cache, LB, server, queue)
- Probabilistic anomaly injection (6 scenarios: memory leak, CPU spike, disk full, network saturation, connection pool exhaustion, cascading failure)
- Self-resolving anomalies (20% chance per cycle)

## API Endpoints

### Infrastructure
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/infrastructure/nodes` | List all infrastructure nodes |
| GET | `/api/infrastructure/nodes/{id}` | Get node details |
| GET | `/api/infrastructure/nodes/{id}/metrics` | Get node metric history |
| GET | `/api/infrastructure/dashboard` | Dashboard aggregate stats |

### Incidents
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/incidents/` | List incidents (filter by status) |
| GET | `/api/incidents/{id}` | Get incident details |
| POST | `/api/incidents/{id}/approve` | Approve/reject remediation (HITL) |
| GET | `/api/incidents/{id}/logs` | Get agent execution logs |

### Agents & Pipeline
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/agents/` | List all agents and status |
| POST | `/api/agents/pipeline/run` | Trigger pipeline for one node |
| POST | `/api/agents/pipeline/run-all` | Trigger pipeline for all nodes |
| GET | `/api/agents/runbooks` | List auto-generated runbooks |
| GET | `/api/agents/memory/search?query=...` | RAG search institutional memory |

### WebSocket
| Endpoint | Description |
|---|---|
| `ws://localhost:8000/ws/metrics` | Real-time metric stream |

## Setup & Run

```bash
# 1. Navigate to backend
cd backend

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 5. Run the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The server starts at `http://localhost:8000`. Open `http://localhost:8000/docs` for the interactive Swagger UI.

The background monitoring loop starts automatically and:
1. Generates simulated metrics every 10 seconds
2. Detects anomalies via statistical thresholds
3. Runs the full LangGraph pipeline for anomalous nodes
4. Stores incidents, metrics, and runbooks in the database
5. Builds institutional memory in ChromaDB

## Frontend Design Guide

The React frontend should have these main sections, accessible via a **top navbar with tabs**:

### Tab 1: Dashboard
- **Real-time fleet overview**: Grid/cards showing all nodes with status indicators (green/yellow/red)
- **Key metrics**: Total nodes, healthy/degraded/critical counts, open incidents, success rate
- **Live charts**: CPU, Memory, Error Rate trends (connect to WebSocket `ws://localhost:8000/ws/metrics`)
- **Recent incidents feed**: Latest incidents with severity badges

### Tab 2: Agents
- **Agent cards**: Show each of the 5 agents (Monitoring, Predictive, Diagnostic, Remediation, Reporting) with:
  - Status indicator (active/idle)
  - Description
  - Run count
  - Last execution time
- **Pipeline trigger**: Button to run pipeline on a specific node or all nodes
- **Agent communication view**: Visual flow showing the LangGraph pipeline stages for a selected incident (Monitor → Predict → Diagnose → [Approve?] → Remediate → Report)
- **Agent logs**: Expandable logs showing input/output for each agent

### Tab 3: Incidents
- **Incident table**: Sortable/filterable list with columns: ID, Node, Severity, Status, Root Cause, Detected At
- **Incident detail view**: Full details including:
  - Monitoring analysis
  - Prediction details
  - Root cause + causal chain visualization
  - Blast radius visualization
  - Remediation plan with steps
  - **Approve/Reject buttons** for incidents awaiting approval (HITL)
  - Report and timeline

### Tab 4: Infrastructure
- **Node list**: All infrastructure nodes with health status
- **Node detail**: Click a node to see metric history charts (CPU, memory, disk, latency, error rate over time)
- **Topology view** (optional): Visual graph of service dependencies

### Tab 5: Runbooks / Knowledge Base
- **Auto-generated runbooks**: List of runbooks created from resolved incidents
- **RAG search**: Search bar to query institutional memory for similar past incidents
- **Effectiveness scores**: Show how often each runbook was applied successfully

### Tech Recommendations for Frontend
- React 18 + TypeScript
- Tailwind CSS for styling
- Recharts or Chart.js for metric visualizations
- React Query (TanStack Query) for API data fetching
- Native WebSocket or `reconnecting-websocket` for real-time data
- React Router for tab navigation

### Key Frontend-Backend Interactions
```
Dashboard         → GET /api/infrastructure/dashboard
                  → WebSocket ws://localhost:8000/ws/metrics

Agents tab        → GET /api/agents/
                  → POST /api/agents/pipeline/run
                  → POST /api/agents/pipeline/run-all

Incidents tab     → GET /api/incidents/?status=...
                  → GET /api/incidents/{id}
                  → POST /api/incidents/{id}/approve  (Human-in-the-loop)
                  → GET /api/incidents/{id}/logs

Infrastructure    → GET /api/infrastructure/nodes
                  → GET /api/infrastructure/nodes/{id}/metrics

Runbooks          → GET /api/agents/runbooks
                  → GET /api/agents/memory/search?query=...
```
