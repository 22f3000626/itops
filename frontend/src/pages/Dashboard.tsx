import { motion } from 'framer-motion';
import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Wrench, FileText,
  Activity, Zap, Search as SearchIcon, Wifi, WifiOff,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import AnimatedNumber from '../components/ui/AnimatedNumber';
import Loader from '../components/ui/Loader';
import MagneticButton from '../components/common/MagneticButton';
import { usePolling } from '../hooks/useApi';
import { useMetricsStream } from '../hooks/useWebSocket';
import * as api from '../services/api';
import type { WsMetricEvent, DashboardStats, Incident } from '../types';
import { spring, stagger, fadeUp } from '../lib/motion';

/* ── tiny chart-data ring buffer ─────────────────────────── */
function useChartHistory(events: WsMetricEvent[], maxPoints = 32) {
  const [buf, setBuf] = useState<{ time: string; cpu: number; mem: number; err: number; lat: number }[]>([]);

  useEffect(() => {
    if (events.length) {
      const avg = (k: keyof WsMetricEvent['metrics']) =>
        +(events.reduce((s, e) => s + e.metrics[k], 0) / events.length).toFixed(1);
      setBuf(prev => {
        const next = [...prev, {
          time: new Date().toLocaleTimeString(),
          cpu: avg('cpu_percent'),
          mem: avg('memory_percent'),
          err: avg('error_rate'),
          lat: avg('latency_ms'),
        }];
        return next.length > maxPoints ? next.slice(-maxPoints) : next;
      });
    }
  }, [events, maxPoints]);

  return buf;
}

/* ── editorial donut gauge with springy fill ────────────── */
function Gauge({ value, label, sub, accent = 'var(--color-accent)', hint }: {
  value: number; label: string; sub?: string; accent?: string; hint?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="flex items-center gap-4" title={hint}>
      <div className="relative w-[68px] h-[68px] shrink-0">
        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(21,25,26,0.07)" strokeWidth="3" />
          <motion.circle
            cx="32" cy="32" r={r} fill="none"
            stroke={accent} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c}` }}
            transition={spring.smooth}
          />
        </svg>
        <div className="absolute inset-0 flex items-baseline justify-center">
          <span className="font-display text-[22px] leading-none numeric mt-[22px]">
            <AnimatedNumber value={pct} />
          </span>
          <span className="text-[10px] text-[var(--color-ink-mute)] ml-0.5 mt-[22px]">%</span>
        </div>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="label-eyebrow !text-[9.5px]">{label}</span>
        {sub && <span className="text-[11px] text-[var(--color-ink-faint)] mt-1 numeric">{sub}</span>}
      </div>
    </div>
  );
}

/* ── KPI tile (cascades in via fadeUp) ───────────────────── */
function Kpi({ label, value, suffix, hint }: {
  label: string; value: number | string; suffix?: string; hint?: string;
}) {
  return (
    <motion.div variants={fadeUp} className="glass-sm p-4 flex flex-col gap-1 gpu" title={hint}>
      <span className="label-eyebrow !text-[9.5px]">{label}</span>
      <div className="flex items-baseline justify-between mt-1">
        <span className="font-display text-[24px] leading-none numeric text-[var(--color-ink)]">
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
          {suffix && <span className="text-[12px] text-[var(--color-ink-mute)] ml-0.5 font-sans">{suffix}</span>}
        </span>
      </div>
    </motion.div>
  );
}

/* ── Pipeline step pip ───────────────────────────────────── */
const PIPELINE_STEPS = [
  { key: 'monitor',    label: 'Monitor',   sub: 'Anomaly detect',    Icon: Activity },
  { key: 'predict',    label: 'Predict',   sub: 'Forecast risk',     Icon: TrendingUp },
  { key: 'diagnose',   label: 'Diagnose',  sub: 'Root cause · RAG',  Icon: SearchIcon },
  { key: 'remediate',  label: 'Remediate', sub: 'Generate fix',      Icon: Wrench },
  { key: 'report',     label: 'Report',    sub: 'Runbook · summary', Icon: FileText },
];

function PipelineStep({ Icon, label, sub }: {
  Icon: React.ElementType; label: string; sub: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -3, scale: 1.04 }}
      transition={spring.smooth}
      className="flex flex-col items-center text-center gap-2.5 relative z-[1] cursor-default gpu"
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: 'rgba(255, 253, 247, 0.92)',
          border: '1px solid var(--color-hairline-strong)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 4px 12px -6px rgba(21,25,26,0.10)',
        }}
      >
        <Icon size={15} className="text-[var(--color-accent)]" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-medium text-[var(--color-ink)]">{label}</span>
        <span className="text-[10.5px] text-[var(--color-ink-mute)] mt-0.5">{sub}</span>
      </div>
    </motion.div>
  );
}

/* ── Sparkline ───────────────────────────────────────────── */
function Sparkline({ data, color = '#244745' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <div className="w-14 h-5" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 56, h = 18;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard() {
  const { data: stats, loading: statsLoading, error: statsError } = usePolling<DashboardStats>(api.getDashboard, 8000);
  const { data: incidents } = usePolling<Incident[]>(() => api.getIncidents(), 8000);
  const { data: wsEvents, connected } = useMetricsStream();
  const chartData = useChartHistory(wsEvents);

  const safeStats: DashboardStats = stats || {
    total_nodes: 0, healthy_nodes: 0, degraded_nodes: 0, critical_nodes: 0,
    total_incidents: 0, open_incidents: 0, resolved_incidents: 0,
    total_remediations: 0, success_rate: 0, memory_incidents_stored: 0, memory_runbooks_stored: 0,
  };

  const fleet = useMemo(() => wsEvents.slice(0, 12), [wsEvents]);
  const recentIncidents = (incidents ?? []).slice(0, 8);

  const cpuAvg = useMemo(() => {
    if (!wsEvents.length) return 0;
    return Math.round(wsEvents.reduce((s, e) => s + e.metrics.cpu_percent, 0) / wsEvents.length);
  }, [wsEvents]);
  const memAvg = useMemo(() => {
    if (!wsEvents.length) return 0;
    return Math.round(wsEvents.reduce((s, e) => s + e.metrics.memory_percent, 0) / wsEvents.length);
  }, [wsEvents]);
  const latP50 = useMemo(() => {
    if (!wsEvents.length) return 0;
    const sorted = [...wsEvents].map(e => e.metrics.latency_ms).sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
  }, [wsEvents]);
  const errAvg = useMemo(() => {
    if (!wsEvents.length) return 0;
    return +(wsEvents.reduce((s, e) => s + e.metrics.error_rate, 0) / wsEvents.length).toFixed(1);
  }, [wsEvents]);

  // Regions actually present in the live fleet
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const e of wsEvents) if (e.region) set.add(e.region);
    return Array.from(set).sort();
  }, [wsEvents]);

  // Mean time to resolution, computed from resolved incidents only
  const mttrMinutes = useMemo(() => {
    const list = incidents ?? [];
    const durations: number[] = [];
    for (const inc of list) {
      if (!inc.detected_at || !inc.resolved_at) continue;
      const d = new Date(inc.detected_at).getTime();
      const r = new Date(inc.resolved_at).getTime();
      if (Number.isFinite(d) && Number.isFinite(r) && r >= d) {
        durations.push((r - d) / 60000);
      }
    }
    if (!durations.length) return null;
    const avg = durations.reduce((s, n) => s + n, 0) / durations.length;
    return +avg.toFixed(1);
  }, [incidents]);

  // Headline that reflects real fleet state, not a static slogan
  const headline = useMemo(() => {
    if (!wsEvents.length && safeStats.total_nodes === 0) {
      return { title: 'No nodes connected.', sub: 'Connect a data source or start a simulator to begin.' };
    }
    if (safeStats.critical_nodes > 0) {
      return {
        title: `${safeStats.critical_nodes} critical node${safeStats.critical_nodes === 1 ? '' : 's'} need attention.`,
        sub: `${wsEvents.length} streaming · ${safeStats.open_incidents} open incident${safeStats.open_incidents === 1 ? '' : 's'}`,
      };
    }
    if (safeStats.degraded_nodes > 0) {
      return {
        title: 'All operational.',
        sub: `${safeStats.degraded_nodes} degraded · ${wsEvents.length} streaming`,
      };
    }
    return {
      title: `All ${safeStats.healthy_nodes || wsEvents.length} nodes healthy.`,
      sub: `${wsEvents.length} streaming live`,
    };
  }, [wsEvents.length, safeStats]);

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
  const timeLabel = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

  if (statsLoading && !stats) return <Loader text="Connecting" />;
  if (statsError && !stats) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[var(--color-critical)] text-sm">Failed to connect: {statsError}</p>
      <p className="label-eyebrow">Backend must be running on port 8000</p>
    </div>
  );

  return (
    <motion.div
      variants={stagger(0.06, 0.05)}
      initial="hidden"
      animate="visible"
      className="space-y-7"
    >
      {/* ── Editorial header ─────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-3 label-eyebrow !text-[10px] flex-wrap">
          <span>Dynamic IT Operations Orchestrator</span>
          <span className="text-[var(--color-ink-faint)]">—</span>
          {regions.length > 0 ? (
            regions.map((r, i) => (
              <span key={r} className="flex items-center gap-3">
                {i > 0 && <span className="text-[var(--color-ink-faint)]">·</span>}
                <span>{r.toUpperCase()}</span>
              </span>
            ))
          ) : (
            <span className="text-[var(--color-ink-mute)]">no regions reporting</span>
          )}
          <span className="text-[var(--color-ink-faint)]">—</span>
          <span>{dateLabel}, {timeLabel}</span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-6 flex-wrap">
          <h1 className="font-display text-[40px] leading-[1.05] text-[var(--color-ink)]">
            {headline.title}{' '}
            <span className="text-[var(--color-ink-mute)] italic">
              {headline.sub}
            </span>
          </h1>

          <div className="flex items-center gap-2">
            <Link to="/pipeline" title="Open the Pipeline page to run agents on a node">
              <MagneticButton variant="solid">
                <Zap size={13} /> Run pipeline
              </MagneticButton>
            </Link>
            <span
              className="ml-2 flex items-center gap-1.5"
              title={connected ? 'Receiving live metrics from the backend' : 'Not receiving live metrics — backend may be down'}
            >
              {connected
                ? <Wifi size={12} className="text-[var(--color-success)]" />
                : <WifiOff size={12} className="text-[var(--color-critical)]" />}
              <span className="label-eyebrow !text-[9.5px]">
                {connected ? 'Live' : 'Offline'}
              </span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── Gauges + KPIs ─────────────────────────────────── */}
      <motion.div variants={fadeUp} className="glass p-5 gpu">
        <motion.div
          variants={stagger(0.05)}
          className="grid grid-cols-1 md:grid-cols-8 gap-5 items-center"
        >
          <div className="md:col-span-3 flex items-center gap-6 flex-wrap">
            <Gauge
              value={cpuAvg}
              label="CPU AVG"
              sub={wsEvents.length ? `across ${wsEvents.length} node${wsEvents.length === 1 ? '' : 's'}` : 'no data'}
              hint="Average CPU usage across all live-streaming nodes right now"
            />
            <Gauge
              value={memAvg}
              label="MEMORY"
              sub={wsEvents.length ? 'live average' : 'no data'}
              accent="#3a6f6a"
              hint="Average memory usage across all live-streaming nodes right now"
            />
            <Gauge
              value={Math.min(99, latP50)}
              label="LATENCY"
              sub={wsEvents.length ? `${latP50}ms p50` : 'no data'}
              accent="#c08a3e"
              hint="Median (p50) request latency across the fleet — half of requests are faster than this number"
            />
          </div>
          <div className="md:col-span-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Kpi
              label="Healthy"
              value={safeStats.healthy_nodes}
              hint="Nodes operating normally with no detected anomalies"
            />
            <Kpi
              label="Degraded"
              value={safeStats.degraded_nodes}
              hint="Nodes showing performance issues but still serving requests"
            />
            <Kpi
              label="Critical"
              value={safeStats.critical_nodes}
              hint="Nodes with severe issues that need immediate attention"
            />
            <Kpi
              label="MTTR"
              value={mttrMinutes != null ? mttrMinutes : '—'}
              suffix={mttrMinutes != null ? 'min' : undefined}
              hint="Mean Time To Resolution — average minutes from incident detection to resolution, across all resolved incidents"
            />
            <Kpi
              label="Auto-fix Rate"
              value={safeStats.total_remediations > 0 ? Math.round(safeStats.success_rate) : '—'}
              suffix={safeStats.total_remediations > 0 ? '%' : undefined}
              hint="Percentage of remediation runs that succeeded automatically without human intervention"
            />
          </div>
        </motion.div>
      </motion.div>

      {/* ── Pipeline + Telemetry ──────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <GlassCard hover={false} tilt className="lg:col-span-3 !p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2
                className="font-display text-[18px] text-[var(--color-ink)]"
                title="Five specialized AI agents that run in sequence whenever an anomaly is detected"
              >
                Autonomous pipeline
              </h2>
              <span
                className="text-[10.5px] font-mono px-2 py-0.5 rounded-full"
                style={{
                  background: 'rgba(36,71,69,0.10)',
                  color: 'var(--color-accent)',
                  border: '1px solid rgba(36,71,69,0.18)',
                }}
                title="Total remediation actions executed by the agents so far"
              >
                {safeStats.total_remediations.toLocaleString()} remediation{safeStats.total_remediations === 1 ? '' : 's'} executed
              </span>
            </div>
            <span
              className="label-eyebrow !text-[9.5px]"
              title="Current agent activity"
            >
              {safeStats.open_incidents > 0
                ? `${safeStats.open_incidents} active incident${safeStats.open_incidents === 1 ? '' : 's'}`
                : 'idle · monitoring'}
            </span>
          </div>

          <div className="relative">
            <div
              className="absolute left-[5%] right-[5%] top-[20px] h-px"
              style={{ background: 'var(--color-hairline-strong)' }}
            />
            <motion.div variants={stagger(0.08)} className="grid grid-cols-5 gap-4 relative">
              {PIPELINE_STEPS.map((s) => (
                <PipelineStep key={s.key} Icon={s.Icon} label={s.label} sub={s.sub} />
              ))}
            </motion.div>
          </div>

          <div className="mt-6 pt-4 hairline" />
          <div className="flex items-center justify-center gap-6 mt-3 label-eyebrow !text-[9.5px]">
            <span title="Past incidents stored in the vector database, used by agents as RAG context">
              Memory · {safeStats.memory_incidents_stored.toLocaleString()} past incident{safeStats.memory_incidents_stored === 1 ? '' : 's'}
            </span>
            <span className="text-[var(--color-ink-faint)]">·</span>
            <span title="Auto-generated runbooks built from resolved incidents">
              {safeStats.memory_runbooks_stored.toLocaleString()} runbook{safeStats.memory_runbooks_stored === 1 ? '' : 's'}
            </span>
          </div>
        </GlassCard>

        <GlassCard hover={false} className="lg:col-span-2 !p-6">
          <div className="flex items-center justify-between mb-4">
            <h2
              className="font-display text-[18px] text-[var(--color-ink)]"
              title="Live performance metrics streamed from your nodes"
            >
              Telemetry
            </h2>
            <span
              className="label-eyebrow !text-[9.5px]"
              title="Each sample is one metric snapshot from one node — totaled across the live fleet"
            >
              {wsEvents.length} live sample{wsEvents.length === 1 ? '' : 's'}
            </span>
          </div>

          <motion.div variants={stagger(0.05)} className="grid grid-cols-2 gap-3">
            {[
              { key: 'cpu' as const, label: 'CPU avg',     val: `${cpuAvg.toFixed(1)}%`,    color: '#244745', hint: 'Average CPU utilization across the live fleet' },
              { key: 'mem' as const, label: 'Memory avg',  val: `${memAvg.toFixed(1)}%`,    color: '#3a6f6a', hint: 'Average memory utilization across the live fleet' },
              { key: 'err' as const, label: 'Error rate',  val: `${errAvg}%`,                color: '#c08a3e', hint: 'Average percentage of requests returning errors' },
              { key: 'lat' as const, label: 'Latency p50', val: `${latP50}ms`,              color: '#15191a', hint: 'Median request latency — half of requests are faster than this' },
            ].map(ch => (
              <motion.div key={ch.key} variants={fadeUp} className="glass-sm !rounded-xl p-3 gpu" title={ch.hint}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="label-eyebrow !text-[9px]">{ch.label}</span>
                  <span className="text-[12px] font-mono numeric text-[var(--color-ink)]">{ch.val}</span>
                </div>
                <ResponsiveContainer width="100%" height={42}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id={`grad-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ch.color} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={ch.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(255,253,247,0.95)',
                        border: '1px solid rgba(21,25,26,0.10)',
                        borderRadius: 8,
                        fontSize: 10.5,
                        fontFamily: 'JetBrains Mono, monospace',
                        boxShadow: '0 8px 20px -8px rgba(21,25,26,0.20)',
                      }}
                      labelStyle={{ color: 'var(--color-ink-mute)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey={ch.key}
                      stroke={ch.color}
                      strokeWidth={1.4}
                      fill={`url(#grad-${ch.key})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            ))}
          </motion.div>
        </GlassCard>
      </div>

      {/* ── Fleet table + Incidents feed ──────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <GlassCard hover={false} className="lg:col-span-3 !p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2
                className="font-display text-[18px] text-[var(--color-ink)]"
                title="Nodes currently streaming live metrics — each row is one server, database, or service"
              >
                Fleet
              </h2>
              <span className="label-eyebrow !text-[9.5px]">
                {wsEvents.length} node{wsEvents.length === 1 ? '' : 's'}
                {regions.length > 0 && ` · ${regions.length} region${regions.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10.5px] font-mono">
              <span className="flex items-center gap-1" title="Healthy nodes">
                <span className="status-dot" style={{ background: '#3d7d65' }} />
                {safeStats.healthy_nodes}
              </span>
              <span className="flex items-center gap-1" title="Degraded nodes">
                <span className="status-dot" style={{ background: '#c08a3e' }} />
                {safeStats.degraded_nodes}
              </span>
              <span className="flex items-center gap-1" title="Critical nodes">
                <span className="status-dot" style={{ background: '#c5524d' }} />
                {safeStats.critical_nodes}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="label-eyebrow !text-[9px]">
                  <th className="px-2 py-2 text-left font-medium">Node</th>
                  <th className="px-2 py-2 text-left font-medium">Type</th>
                  <th className="px-2 py-2 text-left font-medium">Region</th>
                  <th className="px-2 py-2 text-right font-medium">CPU</th>
                  <th className="px-2 py-2 text-right font-medium">Mem</th>
                  <th className="px-2 py-2 text-right font-medium">Err</th>
                  <th className="px-2 py-2 text-right font-medium">Latency</th>
                  <th className="px-2 py-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <motion.tbody variants={stagger(0.025)}>
                {fleet.map(ev => {
                  const tone = ev.is_anomaly
                    ? (ev.anomaly_severity === 'critical' ? '#c5524d' : '#c08a3e')
                    : '#3d7d65';
                  const trend = chartData.slice(-12).map(p => p.cpu);
                  return (
                    <motion.tr
                      key={ev.node_name}
                      variants={fadeUp}
                      className="border-t"
                      style={{ borderColor: 'var(--color-hairline)' }}
                      whileHover={{ backgroundColor: 'rgba(255,253,247,0.55)' }}
                      transition={spring.smooth}
                    >
                      <td className="px-2 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="status-dot" style={{ background: tone }} />
                          <span className="font-mono text-[var(--color-ink)]">{ev.node_name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-[var(--color-ink-mute)]">{ev.node_type || '—'}</td>
                      <td className="px-2 py-2.5 font-mono text-[var(--color-ink-mute)]">{ev.region || '—'}</td>
                      <td className="px-2 py-2.5 text-right numeric font-mono">{ev.metrics.cpu_percent}%</td>
                      <td className="px-2 py-2.5 text-right numeric font-mono">{ev.metrics.memory_percent}%</td>
                      <td className="px-2 py-2.5 text-right numeric font-mono">{ev.metrics.error_rate.toFixed(2)}%</td>
                      <td className="px-2 py-2.5 text-right numeric font-mono">{ev.metrics.latency_ms}ms</td>
                      <td className="px-2 py-2.5 text-right">
                        <span className="inline-flex justify-end">
                          <Sparkline data={trend} color={tone} />
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
                {fleet.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-[var(--color-ink-mute)] text-[12px]">
                      Awaiting telemetry stream…
                    </td>
                  </tr>
                )}
              </motion.tbody>
            </table>
          </div>
        </GlassCard>

        <GlassCard hover={false} className="lg:col-span-2 !p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2
                className="font-display text-[18px] text-[var(--color-ink)]"
                title="Issues detected by the agents — click an entry on the Incidents page for full details"
              >
                Incidents
              </h2>
              <span
                className="label-eyebrow !text-[9.5px]"
                title="The 8 most recent incidents — see the Incidents page for the full history"
              >
                {recentIncidents.length > 0 ? 'most recent' : 'no incidents yet'}
              </span>
            </div>
            <span
              className="text-[10.5px] font-mono px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(197,82,77,0.10)',
                color: '#923a36',
                border: '1px solid rgba(197,82,77,0.20)',
              }}
              title="Incidents that have not yet been resolved"
            >
              ● {safeStats.open_incidents} open
            </span>
          </div>

          <motion.div variants={stagger(0.04)} className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
            {recentIncidents.map(inc => (
              <motion.div
                key={inc.id}
                variants={fadeUp}
                whileHover={{ x: 2 }}
                transition={spring.smooth}
                className="glass-sm !rounded-xl p-3.5 relative gpu"
                style={{ paddingLeft: '14px' }}
              >
                <div
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
                  style={{
                    background:
                      inc.severity === 'critical' ? '#c5524d' :
                      inc.severity === 'high'     ? '#c08a3e' :
                      inc.severity === 'medium'   ? '#c08a3e' :
                                                    '#3d7d65',
                  }}
                />
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--color-ink-mute)]">#{inc.id}</span>
                    <StatusBadge status={inc.severity} />
                  </div>
                  <span className="font-mono text-[10.5px] text-[var(--color-ink-faint)]">
                    {inc.detected_at ? new Date(inc.detected_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
                <p className="text-[12.5px] text-[var(--color-ink)] font-medium leading-snug">
                  {inc.title}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-mono text-[10.5px] text-[var(--color-ink-mute)]">
                    {inc.node_name ?? 'unknown'}
                  </span>
                  <StatusBadge status={inc.status} />
                </div>
              </motion.div>
            ))}
            {recentIncidents.length === 0 && (
              <p className="text-center py-10 text-[var(--color-ink-mute)] text-[12px]">
                No incidents in window.
              </p>
            )}
          </motion.div>
        </GlassCard>
      </div>
    </motion.div>
  );
}
