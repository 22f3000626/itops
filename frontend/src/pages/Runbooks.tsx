import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Search, Hash, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  AlertTriangle, X, Wrench, Shield, FileText,
} from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import Loader from '../components/ui/Loader';
import { usePolling } from '../hooks/useApi';
import * as api from '../services/api';
import type { RunbookEntry } from '../types';

type SearchMode = 'incidents' | 'runbooks';
type SeedFilter = 'all' | 'seeded' | 'auto';
type SortKey = 'effectiveness' | 'usage' | 'newest';

interface SearchResult {
  document?: string;
  metadata?: Record<string, unknown>;
  distance?: number;
}

/* ── helpers ─────────────────────────────────────────────────── */

// Backend returns distance = 1 - keyword_overlap (lower = better, range 0..1).
// Convert to a 0–100 % match for human-friendly display.
function relevancePct(distance: number | undefined): number {
  if (distance == null || !Number.isFinite(distance)) return 0;
  const v = Math.max(0, Math.min(1, distance));
  return Math.round((1 - v) * 100);
}

function relevanceLabel(pct: number): { label: string; color: string } {
  if (pct >= 75) return { label: 'Best match', color: '#3d7d65' };
  if (pct >= 40) return { label: 'Strong match', color: '#c08a3e' };
  return { label: 'Possible match', color: '#9aa19a' };
}

// Take first non-empty line of vector text — treat it as a "title".
function summarizeDoc(doc: string | undefined): { head: string; rest: string } {
  if (!doc) return { head: '(no preview)', rest: '' };
  const lines = doc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { head: '(empty)', rest: '' };
  return { head: lines[0], rest: lines.slice(1).join('\n') };
}

/* ── search result card ──────────────────────────────────────── */
function SearchResultCard({ result, mode, index }: { result: SearchResult; mode: SearchMode; index: number }) {
  const pct = relevancePct(result.distance);
  const { label, color } = relevanceLabel(pct);
  const { head, rest } = summarizeDoc(result.document);
  const Icon = mode === 'incidents' ? AlertTriangle : BookOpen;
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="glass-sm p-3.5 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: `${color}1a`, color }}
            title={mode === 'incidents' ? 'Past incident from memory' : 'Saved runbook'}
          >
            <Icon size={12} />
          </div>
          <span className="text-xs font-medium text-slate-700 truncate">{head}</span>
        </div>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0"
          style={{ background: `${color}15`, color, border: `1px solid ${color}33` }}
          title={`Computed from keyword overlap with your query — ${label.toLowerCase()}`}
        >
          {pct}% · {label}
        </span>
      </div>
      {rest && (
        <p className="text-[11.5px] text-slate-500 whitespace-pre-wrap leading-relaxed pl-8">
          {rest}
        </p>
      )}
    </motion.div>
  );
}

/* ── runbook card ────────────────────────────────────────────── */
function RunbookCard({ rb, isOpen, onToggle }: { rb: RunbookEntry; isOpen: boolean; onToggle: () => void }) {
  const remediationSteps = (rb.remediation_steps ?? []) as Array<Record<string, unknown>>;
  const recommendedActions = (rb.recommended_actions ?? []) as Array<Record<string, unknown>>;
  const blastSeverityColor =
    rb.blast_radius_severity === 'critical' ? '#c5524d' :
    rb.blast_radius_severity === 'high'     ? '#c08a3e' :
    rb.blast_radius_severity === 'medium'   ? '#c08a3e' :
    '#3d7d65';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass overflow-hidden"
    >
      {/* Header row */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-green-50/40"
      >
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <BookOpen size={15} className="text-accent" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-slate-800 font-medium truncate">{rb.title}</p>
            {rb.is_seeded ? (
              <span
                className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100/80 text-blue-700 border border-blue-200/60"
                title="Built-in canonical runbook shipped with the system"
              >
                Built-in
              </span>
            ) : (
              <span
                className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100/80 text-emerald-700 border border-emerald-200/60"
                title="Auto-generated from a real resolved incident"
              >
                Auto-gen
              </span>
            )}
            {rb.issue_type && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono"
                title="Issue category this runbook applies to"
              >
                {rb.issue_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{rb.problem_pattern}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {rb.source_incident_id != null && (
            <span
              className="flex items-center gap-1 text-xs text-slate-400"
              title={`Generated from incident #${rb.source_incident_id}`}
            >
              <Hash size={10} />{rb.source_incident_id}
            </span>
          )}
          <span
            className="text-xs font-mono text-slate-600"
            title="Effectiveness score — how well this runbook has resolved past incidents (higher is better)"
          >
            {rb.effectiveness_score.toFixed(1)} <span className="text-slate-400">eff</span>
          </span>
          <span
            className="text-xs text-slate-500"
            title="How many times this runbook has been retrieved or applied"
          >
            {rb.times_used} {rb.times_used === 1 ? 'apply' : 'applies'}
          </span>
          {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {/* Expanded body */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-glass-border pt-4 space-y-4">
              {/* Problem pattern */}
              <div>
                <span
                  className="text-xs font-semibold text-slate-600 block mb-1"
                  title="The pattern of symptoms or anomalies that triggers this runbook"
                >
                  Problem pattern
                </span>
                <p className="text-xs text-slate-500 bg-green-50/60 p-3 rounded-lg leading-relaxed">{rb.problem_pattern}</p>
              </div>

              {/* Root cause */}
              {rb.root_cause && (
                <div>
                  <span className="text-xs font-semibold text-slate-600 block mb-1">Root cause</span>
                  <p className="text-xs text-slate-500 bg-purple-50/60 p-3 rounded-lg leading-relaxed">{rb.root_cause}</p>
                </div>
              )}

              {/* Causal chain */}
              {rb.causal_chain && rb.causal_chain.length > 0 && (
                <div>
                  <span
                    className="text-xs font-semibold text-slate-600 block mb-1"
                    title="The sequence of events that leads to this issue"
                  >
                    Causal chain
                  </span>
                  <ol className="space-y-1.5">
                    {rb.causal_chain.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                        <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-mono text-slate-500 shrink-0 mt-px">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Blast radius */}
              {rb.blast_radius && rb.blast_radius.length > 0 && (
                <div>
                  <span
                    className="text-xs font-semibold text-slate-600 block mb-1.5"
                    title="Systems and services that could be affected by this issue"
                  >
                    Blast radius
                    {rb.blast_radius_severity && (
                      <span
                        className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          background: `${blastSeverityColor}15`,
                          color: blastSeverityColor,
                          border: `1px solid ${blastSeverityColor}33`,
                        }}
                      >
                        {rb.blast_radius_severity}
                      </span>
                    )}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {rb.blast_radius.map((s, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-md text-[11px]"
                        style={{
                          background: `${blastSeverityColor}10`,
                          color: blastSeverityColor,
                          border: `1px solid ${blastSeverityColor}26`,
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended actions */}
              {recommendedActions.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Shield size={12} className="text-accent" />
                    <span className="text-xs font-semibold text-slate-600">Recommended actions</span>
                  </div>
                  <div className="space-y-1.5">
                    {recommendedActions.map((act, i) => {
                      const action = String(act['action'] ?? `Action ${i + 1}`);
                      const description = act['description'] ? String(act['description']) : '';
                      return (
                        <div key={i} className="bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2">
                          <div className="text-xs font-medium text-slate-700">{action}</div>
                          {description && (
                            <div className="text-[11.5px] text-slate-500 mt-1 leading-relaxed">{description}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Remediation summary */}
              {rb.remediation_summary && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Wrench size={12} className="text-orange-600" />
                    <span className="text-xs font-semibold text-slate-600">Fix summary</span>
                  </div>
                  <p className="text-xs text-slate-500 bg-orange-50/60 p-3 rounded-lg leading-relaxed">{rb.remediation_summary}</p>
                </div>
              )}

              {/* Remediation steps */}
              {remediationSteps.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-slate-600 block mb-1.5">Fix steps</span>
                  <ol className="space-y-1.5">
                    {remediationSteps.map((step, i) => {
                      const action = String(step['action'] ?? `Step ${i + 1}`);
                      const description = step['description'] ? String(step['description']) : '';
                      return (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-mono text-orange-700 shrink-0 mt-px">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-700">{action}</div>
                            {description && (
                              <div className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">{description}</div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {/* Fallback raw solution_steps — only when structured fields are empty */}
              {!rb.remediation_summary && remediationSteps.length === 0 && rb.solution_steps && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText size={12} className="text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600">Solution</span>
                  </div>
                  <pre className="text-xs text-slate-500 bg-slate-50/80 p-3 rounded-lg whitespace-pre-wrap font-sans leading-relaxed">
                    {rb.solution_steps}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export default function Runbooks() {
  const { data: runbooks, loading } = usePolling<RunbookEntry[]>(api.getRunbooks, 15000);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('runbooks');

  // List controls
  const [seedFilter, setSeedFilter] = useState<SeedFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('effectiveness');
  const [titleFilter, setTitleFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Pagination
  const PAGE_SIZE = 50;
  const [rbPage, setRbPage] = useState(1);

  const allRunbooks = runbooks || [];

  // Derive filtered + sorted list
  const filteredSorted = useMemo(() => {
    let list = allRunbooks;
    if (seedFilter === 'seeded') list = list.filter(rb => rb.is_seeded);
    if (seedFilter === 'auto')   list = list.filter(rb => !rb.is_seeded);
    if (titleFilter.trim()) {
      const q = titleFilter.trim().toLowerCase();
      list = list.filter(rb =>
        rb.title.toLowerCase().includes(q) ||
        (rb.issue_type ?? '').toLowerCase().includes(q) ||
        rb.problem_pattern.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sortKey === 'effectiveness') sorted.sort((a, b) => b.effectiveness_score - a.effectiveness_score);
    if (sortKey === 'usage')         sorted.sort((a, b) => b.times_used - a.times_used);
    if (sortKey === 'newest') {
      sorted.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    }
    return sorted;
  }, [allRunbooks, seedFilter, sortKey, titleFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const paginatedRunbooks = useMemo(() => {
    const start = (rbPage - 1) * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [filteredSorted, rbPage]);

  // Reset page when filters change or data shrinks
  useMemo(() => {
    if (rbPage > totalPages) setRbPage(1);
  }, [totalPages, rbPage]);

  const counts = {
    all: allRunbooks.length,
    seeded: allRunbooks.filter(rb => rb.is_seeded).length,
    auto:   allRunbooks.filter(rb => !rb.is_seeded).length,
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.searchMemory(searchQuery, searchMode);
      // Sort by relevance (lower distance = better) before display
      const list = (res.results || []) as SearchResult[];
      list.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
      setSearchResults(list);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  if (loading && !runbooks) return <Loader text="Loading runbooks..." />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div>
        <h1 className="font-display text-[28px] leading-tight text-[var(--color-ink)]">Runbooks</h1>
        <p className="text-sm text-slate-500 mt-1">
          Playbooks for known issues — built-in canonical runbooks plus auto-generated ones from past resolved incidents.
        </p>
      </div>

      {/* ── Find a fix (RAG search) ──────────────────────────── */}
      <GlassCard hover={false}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Find a fix</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Describe what you're seeing — the system will search memory for the closest match.
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1.5 mb-3">
          <button
            onClick={() => setSearchMode('runbooks')}
            title="Search the runbook library — find an existing playbook that fixes this kind of problem"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              searchMode === 'runbooks'
                ? 'bg-accent/10 text-accent border-accent/30'
                : 'bg-black/5 text-slate-500 border-transparent hover:border-slate-200'
            }`}
          >
            <BookOpen size={11} className="inline mr-1.5 -mt-px" />
            Runbooks
          </button>
          <button
            onClick={() => setSearchMode('incidents')}
            title="Search past incidents — find a similar problem we've solved before"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              searchMode === 'incidents'
                ? 'bg-accent/10 text-accent border-accent/30'
                : 'bg-black/5 text-slate-500 border-transparent hover:border-slate-200'
            }`}
          >
            <AlertTriangle size={11} className="inline mr-1.5 -mt-px" />
            Past incidents
          </button>
        </div>

        {/* Search input */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={
                searchMode === 'runbooks'
                  ? 'e.g. "memory leak on java service" or "disk full"'
                  : 'e.g. "high CPU spike" or "database connection timeouts"'
              }
              className="w-full bg-black/5 border border-glass-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent/50"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
          >
            {searching ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : <Search size={14} />}
            Search
          </button>
          {searchResults && (
            <button
              onClick={clearSearch}
              title="Clear search results"
              className="flex items-center gap-1 px-3 py-2.5 bg-black/5 text-slate-500 rounded-lg text-sm font-medium hover:bg-black/10 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Search results */}
        <AnimatePresence>
          {searchResults && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-2"
            >
              {searchResults.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  <Search size={20} className="mx-auto mb-2 opacity-30" />
                  No matches for "<b className="text-slate-600">{searchQuery}</b>" in {searchMode === 'incidents' ? 'past incidents' : 'runbooks'}.
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400 px-1">
                    {searchResults.length} match{searchResults.length === 1 ? '' : 'es'} — sorted by relevance
                  </p>
                  {searchResults.map((r, i) => (
                    <SearchResultCard key={i} result={r} mode={searchMode} index={i} />
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      {/* ── Runbook list ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">All runbooks</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {filteredSorted.length === counts.all
                ? `${counts.all} total · ${counts.seeded} built-in · ${counts.auto} auto-generated`
                : `${filteredSorted.length} of ${counts.all} matching`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Seed filter pills */}
            <div className="flex items-center gap-1 bg-black/5 rounded-lg p-1">
              {([
                { key: 'all',    label: 'All',           hint: 'Show all runbooks' },
                { key: 'seeded', label: 'Built-in',      hint: 'Only canonical runbooks shipped with the system' },
                { key: 'auto',   label: 'Auto-generated', hint: 'Only runbooks created from real resolved incidents' },
              ] as const).map(({ key, label, hint }) => (
                <button
                  key={key}
                  onClick={() => { setSeedFilter(key); setRbPage(1); }}
                  title={hint}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    seedFilter === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              title="How to order the runbook list"
              className="bg-black/5 border border-glass-border rounded-lg px-2.5 py-1.5 text-[11.5px] text-slate-700 focus:outline-none focus:border-accent/40"
            >
              <option value="effectiveness">Sort: Most effective</option>
              <option value="usage">Sort: Most used</option>
              <option value="newest">Sort: Newest first</option>
            </select>

            {/* Title filter */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={titleFilter}
                onChange={e => { setTitleFilter(e.target.value); setRbPage(1); }}
                placeholder="Filter the list..."
                title="Filter the visible runbooks by title, issue type, or problem pattern (separate from the RAG search above)"
                className="bg-black/5 border border-glass-border rounded-lg pl-7 pr-3 py-1.5 text-[11.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-accent/40 w-44"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {paginatedRunbooks.map(rb => (
            <RunbookCard
              key={rb.id}
              rb={rb}
              isOpen={expandedId === rb.id}
              onToggle={() => setExpandedId(expandedId === rb.id ? null : rb.id)}
            />
          ))}

          {filteredSorted.length === 0 && allRunbooks.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
              <p>No runbooks yet.</p>
              <p className="text-xs mt-1">Runbooks are auto-created when an incident is resolved by the pipeline.</p>
            </div>
          )}

          {filteredSorted.length === 0 && allRunbooks.length > 0 && (
            <div className="text-center py-12 text-slate-400">
              <Search size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No runbooks match your filters.</p>
              <button
                onClick={() => { setSeedFilter('all'); setTitleFilter(''); }}
                className="text-xs text-accent mt-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-slate-400">
                Showing <b className="text-slate-600">{(rbPage - 1) * PAGE_SIZE + 1}–{Math.min(rbPage * PAGE_SIZE, filteredSorted.length)}</b> of <b className="text-slate-600">{filteredSorted.length}</b>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRbPage(p => Math.max(1, p - 1))}
                  disabled={rbPage <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-glass-border text-xs font-medium text-slate-600 hover:bg-accent/5 hover:border-accent/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <span className="text-xs text-slate-500 font-medium px-2">
                  Page {rbPage} of {totalPages}
                </span>
                <button
                  onClick={() => setRbPage(p => Math.min(totalPages, p + 1))}
                  disabled={rbPage >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-glass-border text-xs font-medium text-slate-600 hover:bg-accent/5 hover:border-accent/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
