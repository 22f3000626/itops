import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Shield, Brain, Wrench, FileText, Loader2,
} from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import { usePolling } from '../hooks/useApi';
import * as api from '../services/api';
import type { Incident } from '../types';

const FILTERS = ['all', 'detected', 'analyzing', 'diagnosed', 'awaiting_approval', 'remediating', 'resolved', 'escalated', 'failed'];

export default function Incidents() {
  const [filter, setFilter] = useState('all');
  const { data: incidents, loading, refetch } = usePolling<Incident[]>(
    () => api.getIncidents(filter === 'all' ? undefined : filter), 8000, [filter]
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [approving, setApproving] = useState<number | null>(null);

  const handleApprove = async (id: number, decision: 'approved' | 'rejected') => {
    setApproving(id);
    try {
      await api.approveIncident(id, decision);
      refetch();
    } catch { /* */ } finally { setApproving(null); }
  };

  const incidentList = incidents || [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Incidents</h1>
        <p className="text-sm text-slate-500 mt-1">Detected anomalies, diagnostics, and remediation tracking</p>
      </div>

      {/* ── Filters ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-black/5 text-slate-500 border border-transparent hover:bg-black/8'
            }`}
          >
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* ── Incident list ─────────────────────────────────────── */}
      <div className="space-y-3">
        <AnimatePresence>
          {incidentList.map(inc => {
            const isOpen = expanded === inc.id;
            return (
              <motion.div
                key={inc.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`glass overflow-hidden transition-all ${
                  inc.severity === 'critical' ? 'border-red-400/25 glow-red' : ''
                }`}
              >
                {/* Header row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : inc.id)}
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-green-50/50"
                >
                  <span className="text-sm font-mono text-slate-400 w-12">#{inc.id}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">{inc.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{inc.node_name} &middot; {inc.detected_at ? new Date(inc.detected_at).toLocaleString() : ''}</p>
                  </div>
                  <StatusBadge status={inc.severity} />
                  <StatusBadge status={inc.status} pulse={inc.status === 'awaiting_approval'} />
                  {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-0 space-y-4 border-t border-glass-border">
                        {/* Root cause */}
                        {inc.root_cause && (
                          <div className="mt-4">
                            <div className="flex items-center gap-2 mb-1">
                              <Brain size={14} className="text-purple-600" />
                              <span className="text-xs font-semibold text-slate-600">Root Cause</span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed bg-green-50/60 rounded-lg p-3">{inc.root_cause}</p>
                          </div>
                        )}

                        {/* Diagnostic details */}
                        {inc.diagnostic_details && Object.keys(inc.diagnostic_details).length > 0 && (
                          <div className="grid sm:grid-cols-2 gap-3">
                            {inc.diagnostic_details.causal_chain && (
                              <div>
                                <span className="text-xs font-semibold text-slate-600 block mb-1">Causal Chain</span>
                                <div className="space-y-1">
                                  {(inc.diagnostic_details.causal_chain as string[]).map((c, i) => (
                                    <div key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                                      {c}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {inc.diagnostic_details.blast_radius && (
                              <div>
                                <span className="text-xs font-semibold text-slate-600 block mb-1">Blast Radius</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {(inc.diagnostic_details.blast_radius as string[]).map((s, i) => (
                                    <span key={i} className="px-2 py-0.5 rounded bg-red-50 text-red-600 text-xs">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Prediction details */}
                        {inc.prediction_details && (inc.prediction_details as any).failure_probability !== undefined && (
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Shield size={14} className="text-cyan-700" />
                              <span className="text-xs font-semibold text-slate-600">Prediction</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="bg-green-50/60 rounded-lg p-2 text-center">
                                <div className="text-lg font-bold text-slate-800">{((inc.prediction_details as any).failure_probability * 100).toFixed(0)}%</div>
                                <div className="text-slate-400">Failure Prob.</div>
                              </div>
                              <div className="bg-green-50/60 rounded-lg p-2 text-center">
                                <div className="text-lg font-bold text-slate-800">{(inc.prediction_details as any).escalation_risk || '—'}</div>
                                <div className="text-slate-400">Escalation</div>
                              </div>
                              <div className="bg-green-50/60 rounded-lg p-2 text-center">
                                <div className="text-lg font-bold text-slate-800">{(inc.prediction_details as any).recommended_urgency || '—'}</div>
                                <div className="text-slate-400">Urgency</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* HITL Approve/Reject */}
                        {inc.status === 'awaiting_approval' && (
                          <div className="flex items-center gap-3 pt-2">
                            <span className="text-xs text-yellow-600 font-medium">Human decision required:</span>
                            <button
                              onClick={() => handleApprove(inc.id, 'approved')}
                              disabled={approving === inc.id}
                              className="flex items-center gap-1.5 px-4 py-2 bg-green-500/15 text-green-700 rounded-lg text-xs font-medium hover:bg-green-500/25 transition-colors disabled:opacity-40"
                            >
                              {approving === inc.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                              Approve Remediation
                            </button>
                            <button
                              onClick={() => handleApprove(inc.id, 'rejected')}
                              disabled={approving === inc.id}
                              className="flex items-center gap-1.5 px-4 py-2 bg-red-500/15 text-red-700 rounded-lg text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-40"
                            >
                              <XCircle size={12} />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {incidentList.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
            <p>No incidents found{filter !== 'all' ? ` with status "${filter}"` : ''}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
