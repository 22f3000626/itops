export interface InfraNode {
  id: number;
  node_name: string;
  node_type: string;
  provider: string;
  region: string;
  status: string;
  ip_address: string | null;
  metadata_?: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

export interface MetricSnapshot {
  id: number;
  node_id: number;
  node_name?: string;
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  network_in_mbps: number;
  network_out_mbps: number;
  request_rate: number;
  error_rate: number;
  latency_ms: number;
  is_anomaly: boolean;
  anomaly_scores: Record<string, unknown>;
}

export interface Incident {
  id: number;
  node_id: number;
  node_name?: string;
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  detected_at: string | null;
  resolved_at: string | null;
  root_cause: string | null;
  prediction_details: Record<string, unknown>;
  diagnostic_details: Record<string, unknown>;
  created_at: string | null;
}

export interface AgentInfo {
  name: string;
  description: string;
  status: string;
  last_run: string | null;
  runs_count: number;
}

export interface AgentLog {
  id: number;
  incident_id: number | null;
  agent_name: string;
  action: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  duration_ms: number | null;
  timestamp: string;
}

export interface PipelineResult {
  incident_id: number | null;
  status: string;
  is_anomaly: boolean;
  severity: string | null;
  monitoring_result: Record<string, unknown>;
  prediction_result: Record<string, unknown>;
  diagnostic_result: Record<string, unknown>;
  remediation_result: Record<string, unknown>;
  reporting_result: Record<string, unknown>;
  agent_trace: AgentTrace[];
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentTrace {
  agent: string;
  started_at: string;
  completed_at: string;
  [key: string]: unknown;
}

export interface DashboardStats {
  total_nodes: number;
  healthy_nodes: number;
  degraded_nodes: number;
  critical_nodes: number;
  total_incidents: number;
  open_incidents: number;
  resolved_incidents: number;
  awaiting_approval: number;
  total_remediations: number;
  success_rate: number;
  memory_incidents_stored: number;
  memory_runbooks_stored: number;
}

export interface Remediation {
  id: number;
  incident_id: number;
  action_type: string;
  description: string | null;
  status: string;
  requires_approval: boolean;
  approved_by: string | null;
  canary_stage: string | null;
  execution_log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

export interface RunbookEntry {
  id: number;
  title: string;
  problem_pattern: string;
  solution_steps: string;
  source_incident_id: number | null;
  effectiveness_score: number;
  times_used: number;
  created_at: string | null;
}

export interface DataSourceProvider {
  id: string;
  name: string;
  description: string;
  config_fields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface ConfiguredSource {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  status: string;
  config: Record<string, string>;
  created_at: string;
}

export interface WsMetricEvent {
  node_name: string;
  node_type: string;
  provider: string;
  region: string;
  metrics: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    network_in_mbps: number;
    network_out_mbps: number;
    request_rate: number;
    error_rate: number;
    latency_ms: number;
  };
  is_anomaly: boolean;
  anomaly_severity: string | null;
  metadata: Record<string, unknown>;
}
