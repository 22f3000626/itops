import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, TrendingUp, Search, Wrench, FileText, Play, Loader2,
  Filter, ChevronDown, AlertTriangle, CheckCircle2,
  XCircle, Clock, Server, Activity, RefreshCw, Terminal, RotateCcw,
} from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ArtifactViewer from '../components/remediation/ArtifactViewer';
import { useApi } from '../hooks/useApi';
import * as api from '../services/api';
import type { InfraNode, PipelineResult, RemediationArtifact, PipelineRunStatus } from '../types';

const AGENT_ICONS: Record<string, React.ElementType> = {
  monitoring: Eye,
  predictive: TrendingUp,
  diagnostic: Search,
  remediation: Wrench,
  reporting: FileText,
};

const AGENT_GLOW: Record<string, string> = {
  monitoring: '#16a34a',
  predictive: '#0891b2',
  diagnostic: '#9333ea',
  remediation: '#ea580c',
  reporting: '#2563eb',
};

const PIPELINE_STEPS = ['monitoring', 'predictive', 'diagnostic', 'remediation', 'reporting'];

const NODE_TYPE_ICONS: Record<string, string> = {
  server: 'S',
  database: 'D',
  load_balancer: 'L',
  cache: 'C',
  queue: 'Q',
};

const STORAGE_KEY = 'itops_pipeline_state';

function savePipelineState(state: Record<string, any>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

function loadPipelineState(): Record<string, any> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPipelineState() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}

export default function Pipeline() {
  const { data: nodes, loading: nodesLoading } = useApi<InfraNode[]>(api.getNodes);

  // Restore persisted state on mount
  const saved = useRef(loadPipelineState());

  const [selectedNode, setSelectedNode] = useState<string>(saved.current?.selectedNode || '');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(saved.current?.result || null);
  const [error, setError] = useState<string | null>(saved.current?.error || null);
  const [runId, setRunId] = useState<string | null>(null);
  const [pipelineRun, setPipelineRun] = useState<PipelineRunStatus | null>(saved.current?.pipelineRun || null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(saved.current?.elapsedMs || 0);
  const [logs, setLogs] = useState<{ timestamp: number; message: string; type: 'info' | 'success' | 'error' | 'agent' }[]>(saved.current?.logs || []);
  const startTimeRef = useRef(0);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Persist key state to sessionStorage whenever it changes
  useEffect(() => {
    if (running) return; // don't save mid-run state
    savePipelineState({
      selectedNode,
      result,
      error,
      pipelineRun,
      elapsedMs,
      logs,
    });
  }, [selectedNode, result, error, pipelineRun, elapsedMs, logs, running]);

  // Reset everything and show node selection
  const handleSelectNewNode = useCallback(() => {
    setSelectedNode('');
    setResult(null);
    setError(null);
    setRunId(null);
    setPipelineRun(null);
    setRunning(false);
    setElapsedMs(0);
    setLogs([]);
    clearPipelineState();
  }, []);

  const nodeList = nodes || [];
  const remediationArtifacts = ((result?.remediation_result?.artifacts as RemediationArtifact[] | undefined) ?? []);
  const diagnosticReasons = ((result?.diagnostic_result?.reasons as string[] | undefined) ?? []);
  const remediationSteps = ((result?.remediation_result?.steps as Array<Record<string, any>> | undefined) ?? []);
  const completedAgents = useMemo(
    () => {
      const agents = new Set((result?.agent_trace ?? []).map((trace) => String(trace.agent)));
      for (const event of pipelineRun?.progress_events ?? []) {
        if (event.phase === 'completed' && event.agent !== 'pipeline') {
          agents.add(String(event.agent));
        }
      }
      return agents;
    },
    [pipelineRun, result],
  );
  const currentAgent = running ? (pipelineRun?.current_agent ?? null) : null;
  const displayedLogs = useMemo(() => {
    if (!pipelineRun) return logs;
    const startedAtMs = new Date(pipelineRun.started_at).getTime();
    return pipelineRun.progress_events.map((event) => ({
      timestamp: Math.max(0, new Date(event.timestamp).getTime() - startedAtMs),
      message: event.message,
      type: (event.phase === 'error'
        ? 'error'
        : event.phase === 'completed'
          ? 'success'
          : 'agent') as 'info' | 'success' | 'error' | 'agent',
    }));
  }, [pipelineRun, logs]);

  // Derive unique types from nodes
  const nodeTypes = useMemo(() => {
    const types = new Set(nodeList.map(n => n.node_type));
    return ['all', ...Array.from(types)];
  }, [nodeList]);

  // Filter nodes based on status and type filters
  const filteredNodes = useMemo(() => {
    return nodeList.filter(n => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (typeFilter !== 'all' && n.node_type !== typeFilter) return false;
      return true;
    });
  }, [nodeList, statusFilter, typeFilter]);

  // Selected node object
  const selectedNodeObj = useMemo(
    () => nodeList.find(n => n.node_name === selectedNode) || null,
    [nodeList, selectedNode],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => setDropdownOpen(false);
    if (dropdownOpen) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [dropdownOpen]);

  // Elapsed timer
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [running]);

  // Auto-scroll logs
  useEffect(() => {
    logsContainerRef.current?.scrollTo({ top: logsContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, [displayedLogs]);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let nextPoll: ReturnType<typeof setTimeout> | null = null;

    const syncElapsed = (run: PipelineRunStatus) => {
      const end = new Date(run.completed_at || new Date().toISOString()).getTime();
      const start = new Date(run.started_at).getTime();
      setElapsedMs(Math.max(0, end - start));
    };

    const poll = async () => {
      try {
        const run = await api.getPipelineRun(runId) as PipelineRunStatus;
        if (cancelled) return;

        setPipelineRun(run);
        syncElapsed(run);

        if (run.status === 'completed') {
          setResult(run.result);
          setError(null);
          setRunning(false);
          setRunId(null);
          return;
        }

        if (run.status === 'failed') {
          setResult(run.result);
          setError(run.error || 'Pipeline execution failed');
          setRunning(false);
          setRunId(null);
          return;
        }

        nextPoll = setTimeout(poll, 1000);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message || 'Failed to fetch pipeline progress');
        setRunning(false);
        setRunId(null);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (nextPoll) clearTimeout(nextPoll);
    };
  }, [runId]);

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${s}s`;
  };

  const handleRunPipeline = async () => {
    if (!selectedNode) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setPipelineRun(null);
    setRunId(null);
    setElapsedMs(0);
    startTimeRef.current = Date.now();
    setLogs([]);

    try {
      const started = await api.startPipelineRun({ node_name: selectedNode });
      setRunId(started.run_id);
    } catch (e: any) {
      setError(e.message || 'Pipeline execution failed');
      setPipelineRun(null);
      setRunning(false);
    }
  };

  const handleRunAll = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    setPipelineRun(null);
    setRunId(null);
    setElapsedMs(0);
    startTimeRef.current = Date.now();
    setLogs([]);
    try {
      const res = await api.runPipelineAll();
      const elapsed = Date.now() - startTimeRef.current;
      setResult(res);
      setElapsedMs(elapsed);
      setLogs(prev => [...prev, {
        timestamp: elapsed,
        message: `All-nodes pipeline completed in ${formatElapsed(elapsed)}`,
        type: 'success',
      }]);
    } catch (e: any) {
      setError(e.message || 'Pipeline execution failed');
      setLogs(prev => [...prev, {
        timestamp: Date.now() - startTimeRef.current,
        message: `Pipeline failed: ${e.message}`,
        type: 'error',
      }]);
    } finally {
      setRunning(false);
    }
  };

  const statusColor = (s: string) => {
    if (s === 'critical') return 'text-red-500 bg-red-500/10 border-red-500/20';
    if (s === 'degraded') return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    if (s === 'healthy') return 'text-green-500 bg-green-500/10 border-green-500/20';
    return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  };

  if (nodesLoading) return <Loader text="Loading infrastructure nodes..." />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-[24px] sm:text-[28px] leading-tight text-[var(--color-ink)]">Run Pipeline</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Select a node, review its status, and trigger the full agent pipeline
        </p>
      </div>

      {/* ── Node Selection + Filters ──────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Filters panel */}
        <GlassCard hover={false} className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <Filter size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-slate-600">Filters</h2>
          </div>

          <div className="space-y-3">
            {/* Status filter */}
            <div>
              <label className="text-xs text-slate-500 block mb-1.5 font-medium">Node Status</label>
              <div className="flex flex-wrap gap-2">
                {['all', 'critical', 'degraded', 'healthy'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${statusFilter === s
                      ? s === 'critical' ? 'bg-red-500/15 text-red-600 border-red-500/30'
                        : s === 'degraded' ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                          : s === 'healthy' ? 'bg-green-500/15 text-green-600 border-green-500/30'
                            : 'bg-accent/10 text-accent border-accent/30'
                      : 'bg-black/5 text-slate-500 border-transparent hover:border-slate-200'
                      }`}
                  >
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Type filter */}
            <div>
              <label className="text-xs text-slate-500 block mb-1.5 font-medium">Node Type</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="w-full bg-black/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-accent/50"
              >
                {nodeTypes.map(t => (
                  <option key={t} value={t}>
                    {t === 'all' ? 'All Types' : t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Count summary */}
            <div className="pt-2 border-t border-glass-border">
              <p className="text-xs text-slate-500">
                Showing <b className="text-slate-700">{filteredNodes.length}</b> of {nodeList.length} nodes
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Node selector */}
        <GlassCard hover={false} className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-slate-600">Select Node</h2>
          </div>

          {/* Custom dropdown */}
          <div className="relative mb-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between bg-black/5 border border-glass-border rounded-lg px-4 py-3 text-sm text-left hover:border-accent/40 transition-colors"
            >
              {selectedNodeObj ? (
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${statusColor(selectedNodeObj.status)}`}>
                    {NODE_TYPE_ICONS[selectedNodeObj.node_type] || 'N'}
                  </span>
                  <div className="min-w-0 truncate">
                    <span className="text-slate-800 font-medium">{selectedNodeObj.node_name}</span>
                    <span className="text-slate-400 ml-2 text-xs hidden sm:inline">({selectedNodeObj.node_type})</span>
                  </div>
                  <span className="ml-auto shrink-0">
                    <StatusBadge status={selectedNodeObj.status} />
                  </span>
                </div>
              ) : (
                <span className="text-slate-400">Choose a node to run pipeline on...</span>
              )}
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute z-50 top-full mt-1 w-full max-h-64 overflow-y-auto glass-dropdown"
                >
                  {filteredNodes.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-400">
                      No nodes match the current filters
                    </div>
                  ) : (
                    filteredNodes.map(node => (
                      <button
                        key={node.node_name}
                        onClick={() => { setSelectedNode(node.node_name); setDropdownOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/5 transition-colors ${selectedNode === node.node_name ? 'bg-accent/10' : ''
                          }`}
                      >
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${statusColor(node.status)}`}>
                          {NODE_TYPE_ICONS[node.node_type] || 'N'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-slate-800 font-medium truncate block">{node.node_name}</span>
                          <span className="text-xs text-slate-400">{node.node_type} &middot; {node.region}</span>
                        </div>
                        <StatusBadge status={node.status} />
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Selected node info + action buttons */}
          {selectedNodeObj && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-gradient-to-r from-slate-50 to-transparent border border-glass-border space-y-3"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block">Status</span>
                  <StatusBadge status={selectedNodeObj.status} />
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Type</span>
                  <span className="text-slate-700 font-medium capitalize">{selectedNodeObj.node_type.replace(/_/g, ' ')}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Provider</span>
                  <span className="text-slate-700 font-medium">{selectedNodeObj.provider}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Region</span>
                  <span className="text-slate-700 font-medium">{selectedNodeObj.region}</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 sm:gap-3 mt-4 flex-wrap">
            <button
              onClick={handleRunPipeline}
              disabled={running || !selectedNode}
              className="flex items-center gap-2 px-4 sm:px-6 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run Pipeline
            </button>
            <button
              onClick={handleRunAll}
              disabled={running}
              className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-black/5 text-slate-600 rounded-lg text-sm font-medium hover:bg-black/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} />
              Run All Nodes
            </button>
            {result && (
              <button
                onClick={handleSelectNewNode}
                disabled={running}
                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 border border-slate-200 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-all disabled:opacity-40"
              >
                <RotateCcw size={14} />
                Select New Node
              </button>
            )}
          </div>
        </GlassCard>
      </div>

      {/* ── Pipeline Flow Visualization ───────────────────────── */}
      <GlassCard hover={false}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-600">Pipeline Flow</h2>
          {(running || result?.agent_trace?.length) && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <Clock size={14} className={running ? 'text-amber-500 animate-pulse' : 'text-green-500'} />
              <span className={running ? 'text-amber-600' : 'text-green-600'}>{formatElapsed(elapsedMs)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 overflow-x-auto pb-2">
          {PIPELINE_STEPS.map((step, i) => {
            const isDone = completedAgents.has(step);
            const isCurrent = currentAgent === step;
            const isPending = !isDone;
            const color = AGENT_GLOW[step] || '#16a34a';
            const Icon = AGENT_ICONS[step] || Eye;
            return (
              <div key={step} className="flex items-center gap-3 shrink-0">
                <div className="flex flex-col items-center gap-1.5">
                  <motion.div
                    animate={running && isPending ? { opacity: [0.55, 1, 0.55] } : { opacity: 1 }}
                    transition={running && isPending ? { duration: 1.5, repeat: Infinity } : { duration: 0.3 }}
                    className={`relative w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${isDone ? 'border-green-500 bg-green-50' : isPending ? 'border-slate-200 bg-slate-50/50' : ''
                      }`}
                    style={running && isPending ? {
                      borderColor: `${color}66`,
                      background: `${color}10`,
                    } : {}}
                  >
                    {isDone ? (
                      <CheckCircle2 size={20} className="text-green-500" />
                    ) : (
                      <Icon size={20} className={running ? 'text-slate-500' : 'text-slate-400'} />
                    )}
                  </motion.div>
                  <span className={`text-[11px] font-medium ${isCurrent ? 'text-slate-800' : isDone ? 'text-green-600' : 'text-slate-400'
                    }`}>
                    {step.charAt(0).toUpperCase() + step.slice(1)}
                  </span>
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className={`w-10 h-0.5 rounded-full mb-5 transition-colors duration-500 ${isDone ? 'bg-green-400' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {running && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-2 text-xs text-amber-600 bg-amber-50/80 border border-amber-200/50 rounded-lg px-3 py-2.5"
          >
            <Loader2 size={13} className="animate-spin" />
            <span>
              {currentAgent
                ? `${currentAgent.charAt(0).toUpperCase() + currentAgent.slice(1)} agent is running`
                : 'Waiting for backend to start the pipeline'}
            </span>
          </motion.div>
        )}
      </GlassCard>

      {/* ── Pipeline Logs ──────────────────────────────────────── */}
      {displayedLogs.length > 0 && (
        <GlassCard hover={false}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-600">Pipeline Logs</h2>
            </div>
            {running && <Loader2 size={14} className="animate-spin text-accent" />}
            {!running && displayedLogs.length > 0 && (
              <button
                onClick={() => {
                  setLogs([]);
                  setPipelineRun(null);
                }}
                className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div
            ref={logsContainerRef}
            className="bg-slate-900 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs leading-5 space-y-0.5"
          >
            {displayedLogs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${log.type === 'error' ? 'text-red-400' :
                log.type === 'success' ? 'text-green-400' :
                  log.type === 'agent' ? 'text-cyan-400' :
                    'text-slate-400'
                }`}>
                <span className="text-slate-600 shrink-0">[{formatElapsed(log.timestamp)}]</span>
                <span>{log.message}</span>
              </div>
            ))}
            {running && (
              <div className="flex gap-3 text-slate-500">
                <span className="text-slate-600 shrink-0">[{formatElapsed(elapsedMs)}]</span>
                <span className="animate-pulse">█</span>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* ── Results ───────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <GlassCard hover={false} glow="red">
              <div className="flex items-center gap-3">
                <XCircle size={20} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-semibold text-red-700">Pipeline Error</h3>
                  <p className="text-xs text-red-500 mt-0.5">{error}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            {/* Summary card */}
            {(() => {
              const isRunAll = (result as any).total_nodes !== undefined;
              const anomaliesDetected = Number((result as any).anomalies_detected ?? 0);
              const incidentsCreated = Number((result as any).incidents_created ?? 0);
              const totalNodes = Number((result as any).total_nodes ?? 0);
              const hasAnomaly = isRunAll ? anomaliesDetected > 0 : Boolean(result.is_anomaly);
              const aggregateStatus = isRunAll
                ? (anomaliesDetected > 0 ? 'critical' : 'healthy')
                : (result.status || 'unknown');

              return (
                <GlassCard hover={false} glow={hasAnomaly ? 'red' : 'green'}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-slate-600">Pipeline Result</h2>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={aggregateStatus} />
                      {!isRunAll && result.severity && <StatusBadge status={result.severity} />}
                    </div>
                  </div>

                  {hasAnomaly ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50/50 border border-red-200/50 mb-4">
                      <AlertTriangle size={18} className="text-red-500" />
                      <div>
                        {isRunAll ? (
                          <>
                            <span className="text-sm font-semibold text-red-700">
                              {anomaliesDetected} {anomaliesDetected === 1 ? 'Anomaly' : 'Anomalies'} Detected
                            </span>
                            <span className="text-xs text-red-500 ml-2">
                              across {totalNodes} {totalNodes === 1 ? 'node' : 'nodes'}
                              {incidentsCreated > 0 && ` · ${incidentsCreated} ${incidentsCreated === 1 ? 'incident' : 'incidents'} created`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-semibold text-red-700">Anomaly Detected</span>
                            {result.incident_id && (
                              <span className="text-xs text-red-500 ml-2">Incident #{result.incident_id} created</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50/50 border border-green-200/50 mb-4">
                      <CheckCircle2 size={18} className="text-green-500" />
                      <span className="text-sm font-semibold text-green-700">
                        {isRunAll
                          ? `No Anomalies Across ${totalNodes} ${totalNodes === 1 ? 'Node' : 'Nodes'} — All Clear`
                          : 'No Anomaly — All Clear'}
                      </span>
                    </div>
                  )}

                  {/* Run-All summary */}
                  {isRunAll && (
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 rounded-lg bg-black/5">
                        <div className="text-lg font-bold text-slate-800">{totalNodes}</div>
                        <div className="text-xs text-slate-500">Nodes Scanned</div>
                      </div>
                      <div className="p-3 rounded-lg bg-red-500/5">
                        <div className="text-lg font-bold text-red-600">{anomaliesDetected}</div>
                        <div className="text-xs text-slate-500">Anomalies</div>
                      </div>
                      <div className="p-3 rounded-lg bg-green-500/5">
                        <div className="text-lg font-bold text-green-600">{incidentsCreated}</div>
                        <div className="text-xs text-slate-500">Incidents Created</div>
                      </div>
                    </div>
                  )}
                </GlassCard>
              );
            })()}

            {/* Agent detail cards (only for single-node runs) */}
            {result.monitoring_result && Object.keys(result.monitoring_result).length > 0 && (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {/* Monitoring */}
                <AgentResultCard
                  agent="Monitoring"
                  icon={Eye}
                  color="#16a34a"
                  items={[
                    { label: 'Anomaly Type', value: result.monitoring_result?.anomaly_type as string },
                    { label: 'Severity', value: result.monitoring_result?.severity as string, badge: true },
                    { label: 'Description', value: result.monitoring_result?.description as string },
                    { label: 'Log Evidence', value: result.monitoring_result?.log_evidence as string },
                  ]}
                />

                {/* Predictive */}
                <AgentResultCard
                  agent="Predictive"
                  icon={TrendingUp}
                  color="#0891b2"
                  items={[
                    { label: 'Failure Probability', value: result.prediction_result?.failure_probability != null ? `${Math.round((result.prediction_result.failure_probability as number) * 100)}%` : undefined },
                    { label: 'Escalation Risk', value: result.prediction_result?.escalation_risk as string, badge: true },
                    { label: 'Time to Failure', value: result.prediction_result?.estimated_time_to_failure as string },
                    { label: 'Urgency', value: result.prediction_result?.recommended_urgency as string },
                  ]}
                />

                {/* Diagnostic */}
                <AgentResultCard
                  agent="Diagnostic"
                  icon={Search}
                  color="#9333ea"
                  items={[
                    { label: 'Root Cause', value: result.diagnostic_result?.root_cause as string },
                    { label: 'Issue Type', value: result.diagnostic_result?.issue_type as string },
                    { label: 'Confidence', value: result.diagnostic_result?.confidence != null ? `${Math.round((result.diagnostic_result.confidence as number) * 100)}%` : undefined },
                    { label: 'Blast Radius', value: (result.diagnostic_result?.blast_radius as string[])?.join(', ') },
                  ]}
                />

                {/* Remediation */}
                <AgentResultCard
                  agent="Remediation"
                  icon={Wrench}
                  color="#ea580c"
                  items={[
                    { label: 'Plan', value: result.remediation_result?.plan_summary as string },
                    { label: 'Service', value: result.remediation_result?.service_name as string },
                    { label: 'Steps', value: remediationSteps.length ? `${remediationSteps.length} steps` : undefined },
                    { label: 'Canary Compatible', value: result.remediation_result?.canary_compatible ? 'Yes' : 'No' },
                    { label: 'Requires Downtime', value: result.remediation_result?.requires_downtime ? 'Yes' : 'No' },
                  ]}
                />

                {/* Reporting */}
                <AgentResultCard
                  agent="Reporting"
                  icon={FileText}
                  color="#2563eb"
                  items={[
                    { label: 'Summary', value: result.reporting_result?.executive_summary as string },
                    { label: 'Runbook', value: result.reporting_result?.runbook_title as string },
                  ]}
                />

                {/* Trace timeline */}
                {result.agent_trace && result.agent_trace.length > 0 && (
                  <GlassCard hover={false} className="md:col-span-2 xl:col-span-1">
                    <h3 className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-2">
                      <Activity size={14} className="text-accent" />
                      Agent Trace
                    </h3>
                    <div className="space-y-2">
                      {result.agent_trace.map((t, i) => {
                        const start = new Date(t.started_at);
                        const end = new Date(t.completed_at);
                        const dur = Math.max(0, end.getTime() - start.getTime());
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-accent" />
                            <span className="text-slate-700 font-medium capitalize w-20">{t.agent}</span>
                            <span className="text-slate-400 flex-1">
                              {dur > 0 ? `${(dur / 1000).toFixed(1)}s` : '<1s'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </GlassCard>
                )}
              </div>
            )}

            {(diagnosticReasons.length > 0 || remediationSteps.length > 0) && (
              <div className="grid lg:grid-cols-2 gap-4">
                {diagnosticReasons.length > 0 && (
                  <GlassCard hover={false}>
                    <h3 className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-2">
                      <Search size={14} className="text-purple-600" />
                      Why This Happened
                    </h3>
                    <div className="space-y-2">
                      {diagnosticReasons.map((reason, index) => (
                        <div key={index} className="rounded-lg bg-purple-50/60 border border-purple-100 px-3 py-2 text-xs text-slate-600 leading-relaxed">
                          {reason}
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}

                {remediationSteps.length > 0 && (
                  <GlassCard hover={false}>
                    <h3 className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-2">
                      <Wrench size={14} className="text-orange-600" />
                      Simple Fix Steps
                    </h3>
                    <div className="space-y-2">
                      {remediationSteps.map((step, index) => (
                        <div key={index} className="rounded-lg bg-orange-50/70 border border-orange-100 px-3 py-2">
                          <div className="text-xs font-medium text-slate-700">
                            {index + 1}. {String(step['action'] || `Step ${index + 1}`)}
                          </div>
                          {step['description'] && (
                            <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                              {String(step['description'])}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}
              </div>
            )}

            {remediationArtifacts.length > 0 && (
              <ArtifactViewer
                artifacts={remediationArtifacts}
                title="Generated Remediation Scripts"
                emptyLabel="No remediation scripts were generated for this pipeline run."
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!result && !error && !running && (
        <GlassCard hover={false}>
          <div className="text-center py-8">
            <Activity size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Select a node and run the pipeline to see results</p>
          </div>
        </GlassCard>
      )}
    </motion.div>
  );
}


/* ── Helper: Agent result card ─────────────────────────────── */
function AgentResultCard({
  agent, icon: Icon, color, items,
}: {
  agent: string;
  icon: React.ElementType;
  color: string;
  items: { label: string; value?: string; badge?: boolean }[];
}) {
  return (
    <GlassCard hover={false}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon size={14} style={{ color }} />
        </div>
        <h3 className="text-xs font-semibold text-slate-600">{agent}</h3>
      </div>
      <div className="space-y-2">
        {items.map(({ label, value, badge }) =>
          value ? (
            <div key={label} className="text-xs">
              <span className="text-slate-400">{label}: </span>
              {badge ? (
                <StatusBadge status={value} />
              ) : (
                <span className="text-slate-700">{value}</span>
              )}
            </div>
          ) : null,
        )}
      </div>
    </GlassCard>
  );
}
