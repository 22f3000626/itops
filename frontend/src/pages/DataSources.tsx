import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Cloud, Server, Container, FileText, Send,
  Plus, X, CheckCircle, AlertCircle, Loader2, Trash2, TestTube,
  ChevronRight,
} from 'lucide-react';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import Portal from '../components/ui/Portal';
import { useApi } from '../hooks/useApi';
import * as api from '../services/api';
import type { DataSourceProvider, ConfiguredSource } from '../types';

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  simulated: Server,
  aws: Cloud,
  azure: Cloud,
  gcp: Cloud,
  prometheus: Database,
  docker: Container,
  logfile: FileText,
  custom: Send,
};

const PROVIDER_COLORS: Record<string, { bg: string; accent: string; glow: string }> = {
  simulated:  { bg: 'from-green-500/10 to-green-100/40',  accent: '#22c55e', glow: '0 0 30px rgba(34,197,94,0.1)' },
  aws:        { bg: 'from-orange-500/10 to-orange-100/40', accent: '#f97316', glow: '0 0 30px rgba(249,115,22,0.1)' },
  azure:      { bg: 'from-blue-500/10 to-blue-100/40',    accent: '#3b82f6', glow: '0 0 30px rgba(59,130,246,0.1)' },
  gcp:        { bg: 'from-red-500/10 to-red-100/40',      accent: '#ef4444', glow: '0 0 30px rgba(239,68,68,0.1)' },
  prometheus: { bg: 'from-rose-500/10 to-rose-100/40',    accent: '#e11d48', glow: '0 0 30px rgba(225,29,72,0.1)' },
  docker:     { bg: 'from-sky-500/10 to-sky-100/40',      accent: '#0ea5e9', glow: '0 0 30px rgba(14,165,233,0.1)' },
  logfile:    { bg: 'from-teal-500/10 to-teal-100/40',    accent: '#14b8a6', glow: '0 0 30px rgba(20,184,166,0.1)' },
  custom:     { bg: 'from-violet-500/10 to-violet-100/40', accent: '#8b5cf6', glow: '0 0 30px rgba(139,92,246,0.1)' },
};

export default function DataSources() {
  const { data, loading, refetch } = useApi<{
    sources: ConfiguredSource[];
    available_providers: DataSourceProvider[];
  }>(api.getDataSources);

  const [configuring, setConfiguring] = useState<DataSourceProvider | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Manual ingest state
  const [showIngest, setShowIngest] = useState(false);
  const [ingestData, setIngestData] = useState({
    node_name: '', node_type: 'server', cpu_percent: '50', memory_percent: '40',
    disk_percent: '30', error_rate: '1', latency_ms: '25',
  });
  const [ingestMsg, setIngestMsg] = useState('');

  if (loading) return <Loader text="Loading data sources..." />;

  const sources = data?.sources || [];
  const providers = data?.available_providers || [];

  const handleTest = async (provider: DataSourceProvider) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testDataSource({ provider: provider.id, config: formData });
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    } finally { setTesting(false); }
  };

  const handleSave = async (provider: DataSourceProvider) => {
    setSaving(true);
    try {
      await api.configureDataSource({ provider: provider.id, enabled: true, config: formData });
      refetch();
      setConfiguring(null);
      setFormData({});
      setTestResult(null);
    } catch { /* */ } finally { setSaving(false); }
  };

  const handleRemove = async (provider: string) => {
    try {
      await api.removeDataSource(provider);
      refetch();
    } catch { /* */ }
  };

  const handleIngest = async () => {
    try {
      const res = await api.ingestMetrics({
        node_name: ingestData.node_name,
        node_type: ingestData.node_type,
        provider: 'custom',
        region: 'custom',
        ip_address: '0.0.0.0',
        cpu_percent: +ingestData.cpu_percent,
        memory_percent: +ingestData.memory_percent,
        disk_percent: +ingestData.disk_percent,
        network_in_mbps: 0, network_out_mbps: 0, request_rate: 0,
        error_rate: +ingestData.error_rate,
        latency_ms: +ingestData.latency_ms,
      });
      setIngestMsg(`Ingested for node ${res.node_name} (ID: ${res.node_id})`);
    } catch (e: any) { setIngestMsg(e.message); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="font-display text-[24px] sm:text-[28px] leading-tight text-[var(--color-ink)]">Data Sources</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Connect to cloud platforms, monitoring tools, or use simulated data
        </p>
      </div>

      {/* ── Active sources ────────────────────────────────────── */}
      {sources.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3">Active Sources</h2>
          <div className="flex flex-wrap gap-3">
            {sources.map(src => {
              const c = PROVIDER_COLORS[src.provider] || PROVIDER_COLORS.simulated;
              const Icon = PROVIDER_ICONS[src.provider] || Database;
              return (
                <motion.div
                  key={src.id}
                  layout
                  className="glass-sm flex items-center gap-3 px-4 py-3"
                  style={{ boxShadow: c.glow }}
                >
                  <Icon size={16} style={{ color: c.accent }} />
                  <div>
                    <span className="text-sm font-medium text-slate-800">{src.name || src.provider}</span>
                    <StatusBadge status={src.status} />
                  </div>
                  {src.provider !== 'simulated' && (
                    <button
                      onClick={() => handleRemove(src.provider)}
                      className="ml-2 p-1 hover:bg-red-100 rounded transition-colors"
                    >
                      <Trash2 size={12} className="text-red-600" />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Provider cards ────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Available Providers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {providers.map((prov, i) => {
            const Icon = PROVIDER_ICONS[prov.id] || Database;
            const c = PROVIDER_COLORS[prov.id] || PROVIDER_COLORS.simulated;
            const isConfigured = sources.some(s => s.provider === prov.id);

            return (
              <motion.div
                key={prov.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ scale: 1.02, boxShadow: c.glow }}
                onClick={() => {
                  if (prov.id === 'custom') { setShowIngest(true); return; }
                  if (prov.config_fields.length === 0 && prov.id === 'simulated') return;
                  setConfiguring(prov);
                  setFormData({});
                  setTestResult(null);
                }}
                className={`glass p-5 cursor-pointer bg-gradient-to-b ${c.bg} space-y-3 transition-all`}
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${c.accent}15` }}>
                    <Icon size={20} style={{ color: c.accent }} />
                  </div>
                  {isConfigured ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle size={12} /> Connected
                    </span>
                  ) : (
                    <ChevronRight size={16} className="text-slate-400" />
                  )}
                </div>
                <h3 className="text-slate-800 font-semibold">{prov.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{prov.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ── Configuration modal ───────────────────────────────── */}
      <AnimatePresence>
        {configuring && (
          <Portal>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-lg flex items-center justify-center px-4"
            onClick={() => setConfiguring(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="glass-modal w-full max-w-lg p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">Configure {configuring.name}</h2>
                <button onClick={() => setConfiguring(null)} className="p-2 hover:bg-black/8 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              </div>

              <p className="text-xs text-slate-500">{configuring.description}</p>

              {/* Config fields */}
              <div className="space-y-3">
                {configuring.config_fields.map(field => (
                  <div key={field.key}>
                    <label className="text-xs text-slate-500 block mb-1">
                      {field.label} {field.required && <span className="text-red-600">*</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={formData[field.key] || ''}
                        onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
                      >
                        <option value="">Select...</option>
                        {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={formData[field.key] || ''}
                        onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                        rows={4}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 resize-none"
                      />
                    ) : field.type === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData[field.key] === 'true'}
                          onChange={e => setFormData({ ...formData, [field.key]: String(e.target.checked) })}
                          className="w-4 h-4 rounded accent-accent"
                        />
                        <span className="text-sm text-slate-600">Enable</span>
                      </label>
                    ) : (
                      <input
                        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                        value={formData[field.key] || ''}
                        onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Test result */}
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
                    testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {testResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {testResult.message}
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => handleTest(configuring)}
                  disabled={testing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-black/5 text-slate-600 rounded-lg text-sm font-medium hover:bg-black/10 transition-colors disabled:opacity-40"
                >
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                  Test Connection
                </button>
                <button
                  onClick={() => handleSave(configuring)}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Save & Connect
                </button>
              </div>
            </motion.div>
          </motion.div>
          </Portal>
        )}
      </AnimatePresence>

      {/* ── Custom API Ingest modal ───────────────────────────── */}
      <AnimatePresence>
        {showIngest && (
          <Portal>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-lg flex items-center justify-center px-4"
            onClick={() => setShowIngest(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="glass-modal w-full max-w-lg p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">Push Metrics via API</h2>
                <button onClick={() => setShowIngest(false)} className="p-2 hover:bg-black/8 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Manually push metric data for any node. Useful for testing or custom integrations.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'node_name', label: 'Node Name', full: true },
                  { key: 'node_type', label: 'Node Type' },
                  { key: 'cpu_percent', label: 'CPU %', type: 'number' },
                  { key: 'memory_percent', label: 'Memory %', type: 'number' },
                  { key: 'disk_percent', label: 'Disk %', type: 'number' },
                  { key: 'error_rate', label: 'Error Rate %', type: 'number' },
                  { key: 'latency_ms', label: 'Latency ms', type: 'number' },
                ].map(f => (
                  <div key={f.key} className={f.full ? 'col-span-2' : ''}>
                    <label className="text-xs text-slate-500 block mb-1">{f.label}</label>
                    <input
                      type={f.type || 'text'}
                      value={(ingestData as any)[f.key]}
                      onChange={e => setIngestData({ ...ingestData, [f.key]: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
                    />
                  </div>
                ))}
              </div>

              {ingestMsg && (
                <div className="text-xs text-accent bg-accent/10 p-2 rounded-lg">{ingestMsg}</div>
              )}

              <button
                onClick={handleIngest}
                disabled={!ingestData.node_name}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
              >
                <Send size={14} />
                Push Metrics
              </button>
            </motion.div>
          </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
