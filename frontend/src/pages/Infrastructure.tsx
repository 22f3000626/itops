import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Server, Database, Globe, HardDrive, Cpu, MemoryStick, Wifi, X,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import { usePolling, useApi } from '../hooks/useApi';
import * as api from '../services/api';
import type { InfraNode, MetricSnapshot } from '../types';

const NODE_ICONS: Record<string, React.ElementType> = {
  server: Server,
  database: Database,
  load_balancer: Globe,
  cache: HardDrive,
  queue: Wifi,
};

export default function Infrastructure() {
  const { data: nodes, loading } = usePolling<InfraNode[]>(api.getNodes, 10000);
  const [selectedNode, setSelectedNode] = useState<InfraNode | null>(null);

  if (loading && !nodes) return <Loader text="Loading infrastructure..." />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Infrastructure</h1>
        <p className="text-sm text-slate-500 mt-1">All monitored nodes and their metric histories</p>
      </div>

      {/* ── Node grid ─────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {nodes?.map((node, i) => {
          const Icon = NODE_ICONS[node.node_type] || Server;
          return (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => setSelectedNode(node)}
              className={`glass p-4 cursor-pointer space-y-3 ${
                node.status === 'critical' ? 'border-red-400/30 glow-red' :
                node.status === 'degraded' ? 'border-amber-400/30 glow-amber' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    node.status === 'healthy' ? 'bg-green-100' :
                    node.status === 'degraded' ? 'bg-amber-100' : 'bg-red-100'
                  }`}>
                    <Icon size={16} className={
                      node.status === 'healthy' ? 'text-green-600' :
                      node.status === 'degraded' ? 'text-amber-600' : 'text-red-600'
                    } />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{node.node_name}</p>
                    <p className="text-[10px] text-slate-400">{node.node_type} &middot; {node.region}</p>
                  </div>
                </div>
                <StatusBadge status={node.status} pulse={node.status !== 'healthy'} />
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>{node.provider}</span>
                <span>{node.ip_address}</span>
              </div>
            </motion.div>
          );
        })}
        {(!nodes || nodes.length === 0) && (
          <div className="col-span-full text-center py-16 text-slate-400">
            <Server size={32} className="mx-auto mb-3 opacity-30" />
            <p>No nodes registered yet. Start the backend to begin monitoring.</p>
          </div>
        )}
      </div>

      {/* ── Node detail modal ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedNode && (
          <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function NodeDetail({ node, onClose }: { node: InfraNode; onClose: () => void }) {
  const { data: metrics, loading } = useApi<MetricSnapshot[]>(
    () => api.getNodeMetrics(node.id, 100), [node.id]
  );

  const chartData = metrics?.slice().reverse().map(m => ({
    time: new Date(m.timestamp).toLocaleTimeString(),
    cpu: m.cpu_percent,
    mem: m.memory_percent,
    disk: m.disk_percent,
    err: m.error_rate,
    lat: m.latency_ms,
  })) || [];

  const CHARTS = [
    { key: 'cpu', label: 'CPU %', color: '#22c55e' },
    { key: 'mem', label: 'Memory %', color: '#4ade80' },
    { key: 'disk', label: 'Disk %', color: '#06b6d4' },
    { key: 'err', label: 'Error Rate %', color: '#f97316' },
    { key: 'lat', label: 'Latency ms', color: '#a855f7' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="glass w-full max-w-3xl max-h-[75vh] overflow-y-auto p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{node.node_name}</h2>
            <p className="text-xs text-slate-500">{node.node_type} &middot; {node.provider} &middot; {node.region} &middot; {node.ip_address}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/8 rounded-lg transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <StatusBadge status={node.status} pulse={node.status !== 'healthy'} />

        {loading ? <Loader text="Loading metrics..." /> : (
          <div className="grid sm:grid-cols-2 gap-4">
            {CHARTS.map(ch => (
              <div key={ch.key} className="glass-sm p-3">
                <span className="text-xs text-slate-500 block mb-2">{ch.label}</span>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={100}>
                    <LineChart data={chartData}>
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#ffffff', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 8, fontSize: 11 }}
                      />
                      <Line type="monotone" dataKey={ch.key} stroke={ch.color} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[100px] flex items-center justify-center text-xs text-slate-600">No data</div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
