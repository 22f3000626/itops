const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

/* ── Infrastructure ─────────────────────────────────────── */
export const getNodes = () => request<any[]>('/infrastructure/nodes');
export const getNode = (id: number) => request<any>(`/infrastructure/nodes/${id}`);
export const getNodeMetrics = (id: number, limit = 50) =>
  request<any[]>(`/infrastructure/nodes/${id}/metrics?limit=${limit}`);
export const getDashboard = () => request<any>('/infrastructure/dashboard');

/* ── Incidents ──────────────────────────────────────────── */
export const getIncidents = (status?: string) =>
  request<any[]>(`/incidents/${status ? `?status=${status}` : ''}`);
export const getIncident = (id: number) => request<any>(`/incidents/${id}`);
export const approveIncident = (id: number, decision: string, approved_by = 'operator') =>
  request<any>(`/incidents/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ decision, approved_by }),
  });
export const getIncidentLogs = (id: number) => request<any[]>(`/incidents/${id}/logs`);

/* ── Agents ─────────────────────────────────────────────── */
export const getAgents = () => request<any[]>('/agents/');
export const runPipeline = (body: any) =>
  request<any>('/agents/pipeline/run', { method: 'POST', body: JSON.stringify(body) });
export const runPipelineAll = () =>
  request<any>('/agents/pipeline/run-all', { method: 'POST' });
export const getRunbooks = () => request<any[]>('/agents/runbooks');
export const searchMemory = (query: string, collection = 'incidents') =>
  request<any>(`/agents/memory/search?query=${encodeURIComponent(query)}&collection=${collection}`);

/* ── Data Sources ───────────────────────────────────────── */
export const getDataSources = () => request<any>('/datasources/');
export const configureDataSource = (body: any) =>
  request<any>('/datasources/configure', { method: 'POST', body: JSON.stringify(body) });
export const testDataSource = (body: any) =>
  request<any>('/datasources/test', { method: 'POST', body: JSON.stringify(body) });
export const removeDataSource = (provider: string) =>
  request<any>(`/datasources/${provider}`, { method: 'DELETE' });
export const ingestMetrics = (body: any) =>
  request<any>('/datasources/ingest', { method: 'POST', body: JSON.stringify(body) });
