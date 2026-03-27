import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, TrendingUp, Search, Wrench, FileText, Play, Loader2, ChevronRight,
  ArrowRight,
} from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import { useApi } from '../hooks/useApi';
import * as api from '../services/api';
import type { AgentInfo, PipelineResult } from '../types';

const AGENT_ICONS: Record<string, React.ElementType> = {
  monitoring: Eye,
  predictive: TrendingUp,
  diagnostic: Search,
  remediation: Wrench,
  reporting: FileText,
};

const AGENT_COLORS: Record<string, string> = {
  monitoring: 'from-green-500/15 to-green-100/30',
  predictive: 'from-cyan-500/15 to-cyan-100/30',
  diagnostic: 'from-purple-500/15 to-purple-100/30',
  remediation: 'from-orange-500/15 to-orange-100/30',
  reporting: 'from-blue-500/15 to-blue-100/30',
};

const AGENT_GLOW: Record<string, string> = {
  monitoring: '#16a34a',
  predictive: '#0891b2',
  diagnostic: '#9333ea',
  remediation: '#ea580c',
  reporting: '#2563eb',
};

const PIPELINE_STEPS = ['monitoring', 'predictive', 'diagnostic', 'human_review', 'remediation', 'reporting'];

export default function Agents() {
  const { data: agents, loading } = useApi<AgentInfo[]>(api.getAgents);
  const [running, setRunning] = useState(false);
  const [nodeName, setNodeName] = useState('');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeStep, setActiveStep] = useState(-1);

  const agentList = agents || [];

  const handleRunPipeline = async () => {
    setRunning(true);
    setResult(null);
    setActiveStep(0);

    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      setActiveStep(i);
      await new Promise(r => setTimeout(r, 400));
    }

    try {
      const body = nodeName ? { node_name: nodeName } : {
        custom_metrics: {
          node_name: 'demo-server', node_type: 'server', provider: 'manual', region: 'us-east-1',
          cpu_percent: 92, memory_percent: 88, disk_percent: 70,
          network_in_mbps: 100, network_out_mbps: 50, request_rate: 500,
          error_rate: 12, latency_ms: 1200,
        },
      };
      const res = await api.runPipeline(body);
      setResult(res);
      setActiveStep(PIPELINE_STEPS.length);
    } catch (e: any) {
      setResult({ status: 'error', is_anomaly: false, severity: null, incident_id: null } as any);
    } finally {
      setRunning(false);
    }
  };

  const handleRunAll = async () => {
    setRunning(true);
    try {
      const res = await api.runPipelineAll();
      setResult(res);
    } catch { /* */ } finally { setRunning(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Agent Pipeline</h1>
        <p className="text-sm text-slate-500 mt-1">Monitor, predict, diagnose, remediate, report — autonomously</p>
      </div>

      {/* ── Agent cards ───────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {agentList.map((agent, i) => {
          const Icon = AGENT_ICONS[agent.name] || Eye;
          const glowColor = AGENT_GLOW[agent.name] || '#16a34a';
          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ scale: 1.03, boxShadow: `0 4px 24px ${glowColor}18` }}
              className={`glass p-5 bg-gradient-to-b ${AGENT_COLORS[agent.name]} space-y-3`}
            >
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                     style={{ background: `${glowColor}12` }}>
                  <Icon size={18} style={{ color: glowColor }} />
                </div>
                <StatusBadge status={agent.status} pulse />
              </div>
              <h3 className="text-slate-800 font-semibold capitalize">{agent.name}</h3>
              <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">{agent.description}</p>
            </motion.div>
          );
        })}
      </div>

      {/* ── Pipeline flow visualization ──────────────────────── */}
      <GlassCard hover={false}>
        <h2 className="text-sm font-semibold text-slate-600 mb-5">Pipeline Flow</h2>
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-2">
          {PIPELINE_STEPS.map((step, i) => {
            const isActive = i <= activeStep;
            const isCurrent = i === activeStep && running;
            const color = step === 'human_review' ? '#ca8a04' : AGENT_GLOW[step] || '#16a34a';
            return (
              <div key={step} className="flex items-center gap-1 shrink-0">
                <motion.div
                  animate={{
                    borderColor: isActive ? color : 'rgba(22,163,74,0.15)',
                    background: isActive ? `${color}12` : 'transparent',
                    scale: isCurrent ? [1, 1.05, 1] : 1,
                  }}
                  transition={isCurrent ? { duration: 0.8, repeat: Infinity } : { duration: 0.3 }}
                  className="px-4 py-2.5 rounded-xl border text-xs font-medium text-center min-w-[90px]"
                  style={{ color: isActive ? color : '#64748b' }}
                >
                  {step === 'human_review' ? 'Human Review' : step.charAt(0).toUpperCase() + step.slice(1)}
                </motion.div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <ArrowRight size={14} className={isActive ? 'text-accent' : 'text-slate-300'} />
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* ── Trigger controls ──────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-5">
        <GlassCard hover={false}>
          <h2 className="text-sm font-semibold text-slate-600 mb-4">Trigger Pipeline</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Node Name (optional — blank = demo anomaly)</label>
              <input
                value={nodeName}
                onChange={e => setNodeName(e.target.value)}
                placeholder="e.g. web-server-1"
                className="w-full bg-black/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRunPipeline}
                disabled={running}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run Pipeline
              </button>
              <button
                onClick={handleRunAll}
                disabled={running}
                className="flex items-center gap-2 px-5 py-2.5 bg-black/5 text-slate-600 rounded-lg text-sm font-medium hover:bg-black/10 transition-colors disabled:opacity-40"
              >
                Run All Nodes
              </button>
            </div>
          </div>
        </GlassCard>

        {/* ── Pipeline result ─────────────────────────────────── */}
        <GlassCard hover={false}>
          <h2 className="text-sm font-semibold text-slate-600 mb-4">Pipeline Result</h2>
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-2 text-xs"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={result.status || 'unknown'} />
                  {result.severity && <StatusBadge status={result.severity} />}
                  {result.is_anomaly && (
                    <span className="text-red-600 font-medium">Anomaly Detected</span>
                  )}
                </div>
                {result.incident_id && (
                  <p className="text-slate-500">Incident <b className="text-slate-800">#{result.incident_id}</b> created</p>
                )}
                {result.monitoring_result?.description && (
                  <p className="text-slate-500"><b className="text-slate-700">Monitoring:</b> {result.monitoring_result.description as string}</p>
                )}
                {result.diagnostic_result?.root_cause && (
                  <p className="text-slate-500"><b className="text-slate-700">Root Cause:</b> {result.diagnostic_result.root_cause as string}</p>
                )}
                {result.remediation_result?.plan_summary && (
                  <p className="text-slate-500"><b className="text-slate-700">Remediation:</b> {result.remediation_result.plan_summary as string}</p>
                )}
                {(result as any).total_nodes !== undefined && (
                  <p className="text-slate-500">
                    Scanned <b className="text-slate-800">{(result as any).total_nodes}</b> nodes,{' '}
                    <b className="text-orange-600">{(result as any).anomalies_detected}</b> anomalies detected
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.p key="empty" className="text-slate-400 text-center py-6 text-xs">
                Run the pipeline to see results here
              </motion.p>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </motion.div>
  );
}
