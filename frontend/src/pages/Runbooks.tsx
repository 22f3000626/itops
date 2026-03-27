import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, Star, Hash, ChevronDown, ChevronUp } from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import Loader from '../components/ui/Loader';
import { usePolling } from '../hooks/useApi';
import * as api from '../services/api';
import type { RunbookEntry } from '../types';

export default function Runbooks() {
  const { data: runbooks, loading } = usePolling<RunbookEntry[]>(api.getRunbooks, 15000);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCollection, setSearchCollection] = useState<'incidents' | 'runbooks'>('incidents');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.searchMemory(searchQuery, searchCollection);
      setSearchResults(res.results || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  if (loading && !runbooks) return <Loader text="Loading runbooks..." />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Knowledge Base</h1>
        <p className="text-sm text-slate-500 mt-1">Auto-generated runbooks and institutional memory (RAG search)</p>
      </div>

      {/* ── RAG Search ────────────────────────────────────────── */}
      <GlassCard hover={false}>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Search Institutional Memory</h2>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search past incidents, root causes, solutions..."
              className="w-full bg-black/5 border border-glass-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent/50"
            />
          </div>
          <select
            value={searchCollection}
            onChange={e => setSearchCollection(e.target.value as any)}
            className="bg-black/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none"
          >
            <option value="incidents">Incidents</option>
            <option value="runbooks">Runbooks</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
          >
            {searching ? <span className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" /> : <Search size={14} />}
            Search
          </button>
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
                <p className="text-xs text-slate-400 text-center py-4">No matching results in memory</p>
              ) : (
                searchResults.map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="glass-sm p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-accent font-medium">
                        Match #{i + 1}
                        {r.distance != null && (
                          <span className="text-slate-400 ml-2">distance: {r.distance.toFixed(3)}</span>
                        )}
                      </span>
                    </div>
                    <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{r.document}</p>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      {/* ── Runbook entries ───────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">
          Auto-Generated Runbooks
          <span className="text-slate-400 font-normal ml-2">({runbooks?.length || 0})</span>
        </h2>

        <div className="space-y-3">
          {runbooks?.map((rb, i) => {
            const isOpen = expandedId === rb.id;
            return (
              <motion.div
                key={rb.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass overflow-hidden"
              >
                <div
                  onClick={() => setExpandedId(isOpen ? null : rb.id)}
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-green-50/40"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <BookOpen size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 font-medium truncate">{rb.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{rb.problem_pattern}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {rb.source_incident_id && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Hash size={10} />{rb.source_incident_id}
                      </span>
                    )}
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <Star size={10} />
                      {rb.effectiveness_score.toFixed(1)}
                    </div>
                    <span className="text-xs text-slate-400">Used {rb.times_used}x</span>
                    {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </div>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-glass-border pt-3">
                        <div className="mb-3">
                          <span className="text-xs font-semibold text-slate-600 block mb-1">Problem Pattern</span>
                          <p className="text-xs text-slate-500 bg-green-50/60 p-3 rounded-lg">{rb.problem_pattern}</p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-slate-600 block mb-1">Solution Steps</span>
                          <pre className="text-xs text-slate-500 bg-green-50/60 p-3 rounded-lg whitespace-pre-wrap font-sans leading-relaxed">
                            {rb.solution_steps}
                          </pre>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {(!runbooks || runbooks.length === 0) && (
            <div className="text-center py-16 text-slate-400">
              <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
              <p>No runbooks generated yet.</p>
              <p className="text-xs mt-1">Runbooks are auto-created from resolved incidents.</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
