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
  remediation_result: RemediationPlan;
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

export interface PipelineProgressEvent {
  agent: string;
  phase: string;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface PipelineRunStatus {
  run_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  node_name: string;
  current_agent: string | null;
  current_phase: string | null;
  progress_events: PipelineProgressEvent[];
  result: PipelineResult | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface DashboardStats {
  total_nodes: number;
  healthy_nodes: number;
  degraded_nodes: number;
  critical_nodes: number;
  total_incidents: number;
  open_incidents: number;
  resolved_incidents: number;
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

export interface RemediationArtifact {
  id: string;
  name: string;
  kind: 'shell' | 'terraform' | string;
  language: 'bash' | 'hcl' | string;
  purpose: 'apply' | 'rollback' | string;
  description?: string | null;
  content: string;
}

export interface RemediationPlan {
  plan_summary?: string | null;
  strategy?: 'shell' | 'terraform' | 'hybrid' | string | null;
  steps?: Record<string, unknown>[];
  artifacts?: RemediationArtifact[];
  total_estimated_duration_seconds?: number;
  requires_downtime?: boolean;
  canary_compatible?: boolean;
  reasoning?: string;
  agent?: string;
  needs_approval?: boolean;
  [key: string]: unknown;
}

export interface RemediationDetail extends Remediation {
  plan_summary?: string | null;
  strategy?: string | null;
  steps: Record<string, unknown>[];
  artifacts: RemediationArtifact[];
}

export interface RunbookEntry {
  id: number;
  title: string;
  problem_pattern: string;
  solution_steps: string;
  source_incident_id: number | null;
  effectiveness_score: number;
  times_used: number;
  issue_type: string | null;
  root_cause: string | null;
  causal_chain: string[] | null;
  blast_radius: string[] | null;
  blast_radius_severity: string | null;
  recommended_actions: Record<string, unknown>[] | null;
  remediation_summary: string | null;
  remediation_steps: Record<string, unknown>[] | null;
  artifacts: Record<string, unknown>[] | null;
  is_seeded: boolean;
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

export interface SimulatorMetrics {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  network_in_mbps?: number;
  network_out_mbps?: number;
  request_rate?: number;
  error_rate?: number;
  latency_ms?: number;
  [key: string]: number | undefined;
}

export interface Simulator {
  id: number;
  name: string;
  simulator_type: 'vm' | 'db' | 'cache' | 'load_balancer' | 'queue' | 'metrics';
  status: 'stopped' | 'running' | 'paused';
  log_file_content: string | null;
  interval_seconds: number;
  current_line_index: number;
  total_lines: number;
  metrics_enabled: boolean;
  metrics_config: SimulatorMetrics;
  created_at: string | null;
  updated_at: string | null;
}

export interface SimulatorLogEvent {
  type: 'log_line' | 'status' | 'metric_event' | 'error';
  line?: string;
  line_number?: number;
  total_lines?: number;
  status?: string;
  message?: string;
  timestamp?: string;
  current_line?: number;
  metrics?: SimulatorMetrics;
}
