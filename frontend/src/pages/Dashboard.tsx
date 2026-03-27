import { motion } from 'framer-motion';
import {
  Server, AlertTriangle, CheckCircle, Clock, Shield, Brain,
  Activity, Wifi, WifiOff,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import AnimatedNumber from '../components/ui/AnimatedNumber';
import Loader from '../components/ui/Loader';
import { usePolling } from '../hooks/useApi';
import { useMetricsStream } from '../hooks/useWebSocket';
import * as api from '../services/api';
import { useState, useEffect } from 'react';
import type { WsMetricEvent, DashboardStats, Incident } from '../types';

/* ── tiny chart-data ring buffer ─────────────────────────── */
function useChartHistory(events: WsMetricEvent[], maxPoints = 30) {
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

export default function Dashboard() {
  const { data: stats, loading: statsLoading, error: statsError } = usePolling<DashboardStats>(api.getDashboard, 8000);
  const { data: incidents } = usePolling<Incident[]>(() => api.getIncidents(), 8000);
  const { data: wsEvents, connected } = useMetricsStream();
  const chartData = useChartHistory(wsEvents);

  if (statsLoading && !stats) return <Loader text="Connecting to backend..." />;
  if (statsError && !stats) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <p className="text-red-400 text-sm">Failed to connect: {statsError}</p>
      <p className="text-slate-400 text-xs">Make sure the backend is running on port 8000</p>
    </div>
  );

  const safeStats: DashboardStats = stats || {
    total_nodes: 0, healthy_nodes: 0, degraded_nodes: 0, critical_nodes: 0,
    total_incidents: 0, open_incidents: 0, resolved_incidents: 0, awaiting_approval: 0,
    total_remediations: 0, success_rate: 0, memory_incidents_stored: 0, memory_runbooks_stored: 0,
  };

  const statCards = [
    { label: 'Total Nodes',    value: safeStats.total_nodes,      icon: Server,        color: 'text-accent' },
    { label: 'Healthy',        value: safeStats.healthy_nodes,     icon: CheckCircle,   color: 'text-green-400' },
    { label: 'Degraded',       value: safeStats.degraded_nodes,    icon: Clock,         color: 'text-amber-400' },
    { label: 'Critical',       value: safeStats.critical_nodes,    icon: AlertTriangle, color: 'text-red-400' },
    { label: 'Open Incidents', value: safeStats.open_incidents,    icon: AlertTriangle, color: 'text-orange-400' },
    { label: 'Resolved',       value: safeStats.resolved_incidents,icon: Shield,        color: 'text-green-400' },
    { label: 'Awaiting HITL',  value: safeStats.awaiting_approval, icon: Brain,         color: 'text-yellow-400' },
    { label: 'Success Rate',   value: safeStats.success_rate,      icon: Activity,      color: 'text-accent', suffix: '%' },
  ];

  const anomalyNodes = wsEvents.filter(e => e.is_anomaly);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time infrastructure health overview</p>
        </div>
        <div className="flex items-center gap-2">
          {connected ? <Wifi size={14} className="text-accent" /> : <WifiOff size={14} className="text-red-400" />}
          <span className={`text-xs ${connected ? 'text-accent' : 'text-red-400'}`}>
            {connected ? 'Live Stream' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {statCards.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="glass-sm p-4 flex flex-col items-center text-center gap-1"
          >
            <s.icon size={18} className={s.color} />
            <span className="text-2xl font-bold text-slate-800">
              <AnimatedNumber value={s.value} />{s.suffix || ''}
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{s.label}</span>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* ── Live fleet grid ─────────────────────────────────── */}
        <GlassCard className="lg:col-span-2" hover={false}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-600">Fleet Status</h2>
            <span className="text-xs text-slate-400">{wsEvents.length} nodes streaming</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {wsEvents.map(ev => (
              <motion.div
                key={ev.node_name}
                layout
                className={`glass-sm !rounded-lg p-3 text-xs space-y-1.5 transition-all ${
                  ev.is_anomaly ? 'border-red-500/30 glow-red' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800 truncate">{ev.node_name}</span>
                  <StatusBadge
                    status={ev.is_anomaly ? (ev.anomaly_severity === 'critical' ? 'critical' : 'degraded') : 'healthy'}
                    pulse={ev.is_anomaly}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
                  <span>CPU <b className="text-slate-700">{ev.metrics.cpu_percent}%</b></span>
                  <span>MEM <b className="text-slate-700">{ev.metrics.memory_percent}%</b></span>
                  <span>ERR <b className="text-slate-700">{ev.metrics.error_rate}%</b></span>
                  <span>LAT <b className="text-slate-700">{ev.metrics.latency_ms}ms</b></span>
                </div>
              </motion.div>
            ))}
            {wsEvents.length === 0 && (
              <div className="col-span-full text-center text-slate-400 py-8">
                Waiting for metric stream...
              </div>
            )}
          </div>
        </GlassCard>

        {/* ── Recent incidents ────────────────────────────────── */}
        <GlassCard hover={false}>
          <h2 className="text-sm font-semibold text-slate-600 mb-4">Recent Incidents</h2>
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {incidents?.slice(0, 12).map(inc => (
              <div key={inc.id} className="glass-sm !rounded-lg p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-800 font-medium truncate">#{inc.id}</span>
                  <StatusBadge status={inc.severity} />
                </div>
                <p className="text-slate-500 truncate">{inc.title}</p>
                <div className="flex items-center justify-between">
                  <StatusBadge status={inc.status} />
                  <span className="text-slate-400">{inc.node_name}</span>
                </div>
              </div>
            ))}
            {(!incidents || incidents.length === 0) && (
              <p className="text-slate-400 text-center py-6">No incidents yet</p>
            )}
          </div>
        </GlassCard>
      </div>

      {/* ── Live charts ───────────────────────────────────────── */}
      {chartData.length > 2 && (
        <div className="grid lg:grid-cols-2 gap-5">
          {[
            { key: 'cpu', label: 'Avg CPU %', color: '#22c55e' },
            { key: 'mem', label: 'Avg Memory %', color: '#4ade80' },
            { key: 'err', label: 'Avg Error Rate %', color: '#f97316' },
            { key: 'lat', label: 'Avg Latency ms', color: '#38bdf8' },
          ].map(ch => (
            <GlassCard key={ch.key} hover={false} className="!p-4">
              <span className="text-xs text-slate-500 mb-2 block">{ch.label}</span>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id={`g-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ch.color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={ch.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: '#64748b' }}
                  />
                  <Area
                    type="monotone"
                    dataKey={ch.key}
                    stroke={ch.color}
                    strokeWidth={2}
                    fill={`url(#g-${ch.key})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </GlassCard>
          ))}
        </div>
      )}
    </motion.div>
  );
}
