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

async function requestWithTimeout<T>(path: string, timeoutMs: number, opts?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await request<T>(path, {
      ...opts,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ── Infrastructure ─────────────────────────────────────── */
export const getNodes = () => request<any[]>('/infrastructure/nodes');
export const getNode = (id: number) => request<any>(`/infrastructure/nodes/${id}`);
export const getNodeMetrics = (id: number, limit = 50) =>
  request<any[]>(`/infrastructure/nodes/${id}/metrics?limit=${limit}`);
export const getMetricsHistory = (points = 32) =>
  request<{ time: string; cpu: number; mem: number; err: number; lat: number }[]>(
    `/infrastructure/metrics/history?points=${points}`,
  );
export const getDashboard = () => request<any>('/infrastructure/dashboard');

/* ── Incidents ──────────────────────────────────────────── */
export const getIncidents = (status?: string) =>
  request<any[]>(`/incidents/${status ? `?status=${status}` : ''}`);
export const getIncident = (id: number) => request<any>(`/incidents/${id}`);
export const getIncidentRemediation = (id: number) => request<any>(`/incidents/${id}/remediation`);
export const getIncidentRemediationArtifactDownloadUrl = (id: number, artifactId: string) =>
  `${BASE}/incidents/${id}/remediation/artifacts/${encodeURIComponent(artifactId)}`;

/* ── Agents ─────────────────────────────────────────────── */
export const startPipelineRun = (body: any) =>
  request<any>('/agents/pipeline/start', { method: 'POST', body: JSON.stringify(body) });
export const getPipelineRun = (runId: string) =>
  request<any>(`/agents/pipeline/runs/${encodeURIComponent(runId)}`);
export const runPipeline = (body: any) =>
  requestWithTimeout<any>('/agents/pipeline/run', 120000, { method: 'POST', body: JSON.stringify(body) });
export const runPipelineAll = () =>
  requestWithTimeout<any>('/agents/pipeline/run-all', 120000, { method: 'POST' });
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

/* ── Simulators ─────────────────────────────────────────── */
export const getSimulators = () => request<any[]>('/simulators/');
export const getSimulator = (id: number) => request<any>(`/simulators/${id}`);
export const deleteSimulator = (id: number) =>
  request<{ status: string }>(`/simulators/${id}`, { method: 'DELETE' });
export const simulatorAction = (id: number, action: string) =>
  request<any>(`/simulators/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });

export const updateSimulatorMetrics = (id: number, metrics_enabled: boolean, metrics_config: Record<string, number>) =>
  request<any>(`/simulators/${id}/metrics`, {
    method: 'PUT',
    body: JSON.stringify({ metrics_enabled, metrics_config }),
  });

/* ── Settings ───────────────────────────────────────────── */
export const getSettings = () => request<any>('/settings/');
export const updateSettings = (body: any) =>
  request<any>('/settings/', { method: 'PUT', body: JSON.stringify(body) });
export const getOllamaModels = () => request<any>('/settings/ollama-models');
export const getGeminiModels = (apiKey?: string) => {
  const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
  return requestWithTimeout<{
    models: Array<{
      name: string;
      display_name: string;
      description: string;
      input_token_limit: number;
      output_token_limit: number;
      version: string;
      deprecated: boolean;
    }>;
    error?: string;
  }>(`/settings/gemini-models${qs}`, 15000);
};
export const testLlmProvider = (body: {
  provider: 'ollama' | 'openai' | 'gemini';
  model?: string;
  api_key?: string;
  base_url?: string;
}) =>
  requestWithTimeout<{ ok: boolean; message: string; model?: string }>(
    '/settings/test-provider',
    30000,
    { method: 'POST', body: JSON.stringify(body) },
  );

export const createSimulator = async (formData: FormData): Promise<any> => {
  const res = await fetch(`${BASE}/simulators/`, {
    method: 'POST',
    body: formData, // No Content-Type header — browser sets it with boundary for multipart
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
};
