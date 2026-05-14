import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, ChevronDown, ChevronUp,
  Shield, Brain, Wrench, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import StatusBadge from '../components/ui/StatusBadge';
import ArtifactViewer from '../components/remediation/ArtifactViewer';
import { usePolling } from '../hooks/useApi';
import * as api from '../services/api';
import type { Incident, RemediationDetail } from '../types';

export default function Incidents() {
  const { data: incidents } = usePolling<Incident[]>(
    () => api.getIncidents(), 8000, []
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [remediationByIncident, setRemediationByIncident] = useState<Record<number, RemediationDetail | null | undefined>>({});
  const [remediationLoading, setRemediationLoading] = useState<Record<number, boolean>>({});

  const loadRemediation = async (incidentId: number) => {
    if (remediationByIncident[incidentId] !== undefined || remediationLoading[incidentId]) return;
    setRemediationLoading((prev) => ({ ...prev, [incidentId]: true }));
    try {
      const remediation = await api.getIncidentRemediation(incidentId);
      setRemediationByIncident((prev) => ({ ...prev, [incidentId]: remediation }));
    } catch {
      setRemediationByIncident((prev) => ({ ...prev, [incidentId]: null }));
    } finally {
      setRemediationLoading((prev) => ({ ...prev, [incidentId]: false }));
    }
  };

  const incidentList = incidents || [];

  // ── Pagination ───────────────────────────────────────────
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(incidentList.length / PAGE_SIZE));
  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return incidentList.slice(start, start + PAGE_SIZE);
  }, [incidentList, currentPage]);

  // Reset page when data changes significantly
  useMemo(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="font-display text-[24px] sm:text-[28px] leading-tight text-[var(--color-ink)]">Incidents</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">Detected anomalies, diagnostics, and remediation tracking</p>
      </div>



      {/* ── Incident list ─────────────────────────────────────── */}
      <div className="space-y-3">
        <AnimatePresence>
          {paginatedIncidents.map(inc => {
            const isOpen = expanded === inc.id;
            const diagnostic = inc.diagnostic_details as {
              causal_chain?: string[];
              blast_radius?: string[];
              reasons?: string[];
              issue_type?: string;
            };
            const remediationSteps = (remediationByIncident[inc.id]?.steps || []) as Array<Record<string, any>>;
            return (
              <motion.div
                key={inc.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`glass overflow-hidden transition-all ${inc.severity === 'critical' ? 'border-red-400/25 glow-red' : ''
                  }`}
              >
                {/* Header row */}
                <div
                  onClick={() => {
                    const next = isOpen ? null : inc.id;
                    setExpanded(next);
                    if (next != null) void loadRemediation(inc.id);
                  }}
                  className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4 cursor-pointer hover:bg-green-50/50"
                >
                  <span className="text-xs sm:text-sm font-mono text-slate-400 w-8 sm:w-12 shrink-0">#{inc.id}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">{inc.title}</p>
                    <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">{inc.node_name} &middot; {inc.detected_at ? new Date(inc.detected_at).toLocaleString() : ''}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <StatusBadge status={inc.severity} />
                    <StatusBadge status={inc.status} />
                  </div>
                  <div className="flex sm:hidden shrink-0">
                    <StatusBadge status={inc.severity} />
                  </div>
                  {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
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
                        {remediationLoading[inc.id] && (
                          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                            <Loader2 size={12} className="animate-spin" />
                            Loading remediation scripts...
                          </div>
                        )}

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
                            {diagnostic.reasons && diagnostic.reasons.length > 0 && (
                              <div className="sm:col-span-2">
                                <span className="text-xs font-semibold text-slate-600 block mb-1">Why This Happened</span>
                                <div className="space-y-1">
                                  {diagnostic.reasons.map((reason, i) => (
                                    <div key={i} className="text-xs text-slate-500 flex items-start gap-1.5 bg-green-50/60 rounded-lg px-3 py-2">
                                      <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-amber-500/70 shrink-0" />
                                      <span>{reason}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {diagnostic.causal_chain && (
                              <div>
                                <span className="text-xs font-semibold text-slate-600 block mb-1">Causal Chain</span>
                                <div className="space-y-1">
                                  {diagnostic.causal_chain.map((c, i) => (
                                    <div key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                                      {c}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {diagnostic.blast_radius && (
                              <div>
                                <span className="text-xs font-semibold text-slate-600 block mb-1">Blast Radius</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {diagnostic.blast_radius.map((s, i) => (
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

                        {remediationByIncident[inc.id] && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Wrench size={14} className="text-orange-600" />
                              <span className="text-xs font-semibold text-slate-600">Remediation</span>
                            </div>

                            {remediationByIncident[inc.id]?.plan_summary && (
                              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                <div className="bg-green-50/60 rounded-lg p-3">
                                  <div className="text-slate-400 mb-1">Plan Summary</div>
                                  <div className="text-slate-700 leading-relaxed">
                                    {remediationByIncident[inc.id]?.plan_summary}
                                  </div>
                                </div>
                                <div className="bg-green-50/60 rounded-lg p-3">
                                  <div className="text-slate-400 mb-1">Delivery Strategy</div>
                                  <div className="text-slate-700 capitalize">
                                    {remediationByIncident[inc.id]?.strategy || 'shell'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {remediationSteps.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold text-slate-600 mb-2">Simple Fix Steps</div>
                                <div className="space-y-2">
                                  {remediationSteps.map((step, index) => {
                                    const action = String(step['action'] || `Step ${index + 1}`);
                                    const description = String(step['description'] || '');
                                    return (
                                      <div key={index} className="rounded-lg bg-orange-50/70 border border-orange-100 px-3 py-2">
                                        <div className="text-xs font-medium text-slate-700">{index + 1}. {action}</div>
                                        {description && (
                                          <div className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <ArtifactViewer
                              artifacts={remediationByIncident[inc.id]?.artifacts || []}
                              title="Generated Remediation Files"
                              emptyLabel="This incident has a remediation record, but no downloadable scripts were generated."
                              downloadUrlBuilder={(artifact) =>
                                api.getIncidentRemediationArtifactDownloadUrl(inc.id, artifact.id)
                              }
                            />
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
            <p>No incidents found</p>
          </div>
        )}

        {/* ── Pagination controls ─────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 flex-wrap gap-3">
            <p className="text-xs text-slate-400">
              Showing <b className="text-slate-600">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, incidentList.length)}</b> of <b className="text-slate-600">{incidentList.length}</b> incidents
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-glass-border text-xs font-medium text-slate-600 hover:bg-accent/5 hover:border-accent/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <span className="text-xs text-slate-500 font-medium px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-glass-border text-xs font-medium text-slate-600 hover:bg-accent/5 hover:border-accent/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
