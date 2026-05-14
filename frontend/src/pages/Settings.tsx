import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon, Brain, Cpu, Timer, Plus, X, Check,
  RefreshCw, ChevronDown, Loader2, Server, Cloud, Sparkles,
  AlertCircle, KeyRound, Eye, EyeOff,
} from 'lucide-react';
import GlassCard from '../components/ui/GlassCard';
import * as api from '../services/api';

type LlmProvider = 'ollama' | 'openai' | 'gemini';

interface SettingsData {
  llm_provider: LlmProvider;

  // Ollama
  ollama_model: string;
  ollama_embedding_model: string;
  ollama_base_url: string;

  // OpenAI
  openai_api_key: string;        // "***" when set (redacted) or "" when unset
  openai_api_key_set: boolean;
  openai_model: string;

  // Gemini
  gemini_api_key: string;
  gemini_api_key_set: boolean;
  gemini_model: string;

  // Shared
  agent_temperature: number;
  custom_llm_models: string[];
  custom_embedding_models: string[];
  custom_openai_models: string[];
  custom_gemini_models: string[];
  auto_run_pipeline: boolean;
  auto_run_interval_seconds: number;
}

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface GeminiModelInfo {
  name: string;
  display_name: string;
  description: string;
  input_token_limit: number;
  output_token_limit: number;
  version: string;
  deprecated: boolean;
}

const DEFAULT_OLLAMA_LLM_OPTIONS = [
  'llama3.2:3b', 'qwen2.5-coder:7b', 'mistral-nemo',
  'deepseek-coder-v2', 'codellama:7b', 'gemma2:9b', 'gemma3:4b',
];

const DEFAULT_EMBEDDING_OPTIONS = [
  'nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'snowflake-arctic-embed',
];

const DEFAULT_OPENAI_MODELS = [
  'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4.1-mini', 'gpt-4.1', 'o3-mini',
];

const DEFAULT_GEMINI_MODELS = [
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  'gemini-1.5-pro', 'gemini-1.5-flash',
];

const PROVIDER_META: Record<LlmProvider, { label: string; subtitle: string; description: string; Icon: React.ElementType; accent: string }> = {
  ollama: { 
    label: 'Ollama', 
    subtitle: 'Local & Free', 
    description: 'Run AI models locally on your machine. No API costs, full privacy.',
    Icon: Server, 
    accent: 'emerald' 
  },
  openai: { 
    label: 'OpenAI', 
    subtitle: 'GPT-4 & GPT-4o', 
    description: 'Industry-leading models. Requires API key with usage-based billing.',
    Icon: Sparkles, 
    accent: 'indigo' 
  },
  gemini: { 
    label: 'Google Gemini', 
    subtitle: 'Gemini 2.0', 
    description: 'Google\'s latest AI models. Requires API key from Google AI Studio.',
    Icon: Cloud, 
    accent: 'sky' 
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [geminiModels, setGeminiModels] = useState<GeminiModelInfo[]>([]);
  const [geminiModelsError, setGeminiModelsError] = useState<string | null>(null);
  const [geminiModelsLoading, setGeminiModelsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom-model input state
  const [newOllamaModel, setNewOllamaModel] = useState('');
  const [newEmbeddingModel, setNewEmbeddingModel] = useState('');
  const [newOpenaiModel, setNewOpenaiModel] = useState('');
  const [newGeminiModel, setNewGeminiModel] = useState('');

  // Dropdown-open state
  const [openDropdown, setOpenDropdown] = useState<
    'ollama-llm' | 'ollama-embedding' | 'openai-model' | 'gemini-model' | null
  >(null);

  // Key-reveal state (only for unsaved edits — stored keys are never returned)
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState('');
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // Test-connection state, per provider
  const [testing, setTesting] = useState<LlmProvider | null>(null);
  const [testResult, setTestResult] = useState<Record<LlmProvider, { ok: boolean; message: string } | null>>({
    ollama: null, openai: null, gemini: null,
  });

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsData, modelsData] = await Promise.all([
        api.getSettings(),
        api.getOllamaModels(),
      ]);
      setSettings(settingsData);
      setOllamaModels(modelsData.models || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const fetchGeminiModels = useCallback(async (draftKey?: string) => {
    setGeminiModelsLoading(true);
    setGeminiModelsError(null);
    try {
      const result = await api.getGeminiModels(draftKey?.trim() || undefined);
      setGeminiModels(result.models || []);
      if (result.error) setGeminiModelsError(result.error);
    } catch (e: any) {
      setGeminiModelsError(e.message || 'Failed to fetch models');
      setGeminiModels([]);
    } finally {
      setGeminiModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings?.gemini_api_key_set && geminiModels.length === 0 && !geminiModelsLoading && !geminiModelsError) {
      fetchGeminiModels();
    }
  }, [settings?.gemini_api_key_set, geminiModels.length, geminiModelsLoading, geminiModelsError, fetchGeminiModels]);

  const save = async (partial: Partial<SettingsData>) => {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.updateSettings(partial);
      setSettings(updated);
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveProvider = (provider: LlmProvider) => save({ llm_provider: provider });

  const saveOpenaiKey = async () => {
    if (!openaiKeyDraft.trim()) return;
    await save({ openai_api_key: openaiKeyDraft.trim() });
    setOpenaiKeyDraft('');
    setShowOpenaiKey(false);
  };

  const saveGeminiKey = async () => {
    if (!geminiKeyDraft.trim()) return;
    await save({ gemini_api_key: geminiKeyDraft.trim() });
    setGeminiKeyDraft('');
    setShowGeminiKey(false);
    fetchGeminiModels();
  };

  const clearOpenaiKey = () => save({ openai_api_key: '' });
  const clearGeminiKey = () => {
    save({ gemini_api_key: '' });
    setGeminiModels([]);
    setGeminiModelsError(null);
  };

  const runTest = async (provider: LlmProvider) => {
    setTesting(provider);
    setTestResult((prev) => ({ ...prev, [provider]: null }));
    try {
      const body: any = { provider };
      if (provider === 'openai' && openaiKeyDraft.trim()) body.api_key = openaiKeyDraft.trim();
      if (provider === 'gemini' && geminiKeyDraft.trim()) body.api_key = geminiKeyDraft.trim();
      const result = await api.testLlmProvider(body);
      setTestResult((prev) => ({ ...prev, [provider]: result }));
    } catch (e: any) {
      setTestResult((prev) => ({ ...prev, [provider]: { ok: false, message: e.message } }));
    } finally {
      setTesting(null);
    }
  };

  const addCustomModel = (
    bucket: 'custom_llm_models' | 'custom_embedding_models' | 'custom_openai_models' | 'custom_gemini_models',
    value: string,
    reset: () => void,
  ) => {
    if (!settings) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const existing = settings[bucket];
    if (existing.includes(trimmed)) return;
    save({ [bucket]: [...existing, trimmed] } as Partial<SettingsData>);
    reset();
  };

  const removeCustomModel = (
    bucket: 'custom_llm_models' | 'custom_embedding_models' | 'custom_openai_models' | 'custom_gemini_models',
    model: string,
  ) => {
    if (!settings) return;
    const updated = settings[bucket].filter((m) => m !== model);
    save({ [bucket]: updated } as Partial<SettingsData>);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        <span className="ml-3 text-slate-500">Loading settings...</span>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-red-400 text-sm">Failed to load settings: {error}</p>
        <button onClick={fetchSettings} className="text-emerald-600 text-sm underline">Retry</button>
      </div>
    );
  }

  // Build dropdown options
  const installedOllamaNames = ollamaModels.map((m) => m.name);
  const isInstalled = (model: string) =>
    installedOllamaNames.some((name) => name === model || name === `${model}:latest`);

  const ollamaLlmOptions = [...new Set([
    ...installedOllamaNames, ...DEFAULT_OLLAMA_LLM_OPTIONS,
    ...settings.custom_llm_models, settings.ollama_model,
  ])].sort();

  const ollamaEmbeddingOptions = [...new Set([
    ...DEFAULT_EMBEDDING_OPTIONS, ...settings.custom_embedding_models, settings.ollama_embedding_model,
  ])].sort();

  const openaiOptions = [...new Set([
    ...DEFAULT_OPENAI_MODELS, ...settings.custom_openai_models, settings.openai_model,
  ])].sort();

  // Prefer the live catalog when available (preserves backend's smart sort);
  // otherwise fall back to the static defaults. Custom + currently-selected
  // models are always merged in so the user can still pick what they typed.
  const geminiCatalogNames = geminiModels.map((m) => m.name);
  const geminiExtraNames = [...settings.custom_gemini_models, settings.gemini_model]
    .filter((n) => n && !geminiCatalogNames.includes(n));
  const geminiOptions: string[] = geminiModels.length > 0
    ? [...geminiCatalogNames, ...geminiExtraNames]
    : [...new Set([
        ...DEFAULT_GEMINI_MODELS, ...settings.custom_gemini_models, settings.gemini_model,
      ])].sort();
  const geminiInfoByName = new Map(geminiModels.map((m) => [m.name, m]));

  const activeProvider = settings.llm_provider;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3 sm:gap-4">
        <div>
          <h1 className="font-display text-[24px] sm:text-[28px] leading-tight text-[var(--color-ink)] flex items-center gap-3">
            <SettingsIcon size={20} className="text-[var(--color-accent)]" />
            Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configure your active LLM provider, pipeline behaviour, and runtime options
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-emerald-600 flex items-center gap-1"
            >
              <Check size={14} /> Saved
            </motion.span>
          )}
          {saving && <Loader2 size={14} className="animate-spin text-emerald-500" />}
          <button
            onClick={fetchSettings}
            className="glass-sm p-2 rounded-lg hover:bg-emerald-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className="text-slate-500" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* ── AI Brain Selector ─────────────────────────────── */}
      <GlassCard hover={false} className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-100/50 to-transparent rounded-bl-full pointer-events-none" />
        
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Brain size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Choose Your AI Brain</h2>
              <p className="text-xs text-slate-500">Select which Large Language Model powers your AIOps agents</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-6">
            {(Object.keys(PROVIDER_META) as LlmProvider[]).map((p) => {
              const { label, subtitle, description, Icon } = PROVIDER_META[p];
              const active = activeProvider === p;
              return (
                <button
                  key={p}
                  onClick={() => saveProvider(p)}
                  className={`relative rounded-xl p-5 text-left transition-all duration-200 border-2 group ${
                    active
                      ? 'border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50/50 shadow-lg shadow-emerald-500/10'
                      : 'border-slate-200 hover:border-emerald-300 hover:shadow-md bg-white/50'
                  }`}
                >
                  {active && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                      <Check size={14} className="text-white" />
                    </div>
                  )}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors ${
                    active 
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-slate-100 text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-600'
                  }`}>
                    <Icon size={20} />
                  </div>
                  <h3 className={`font-semibold mb-0.5 ${active ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {label}
                  </h3>
                  <p className={`text-xs font-medium mb-2 ${active ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {subtitle}
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {description}
                  </p>
                </button>
              );
            })}
          </div>
          
          <div className="mt-5 p-3 rounded-lg bg-amber-50/80 border border-amber-200/50 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-700">
              <strong>Note:</strong> The embedding model for RAG (knowledge retrieval) always runs on Ollama, regardless of which chat provider you select above.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* ── Active provider's config ────────────────────── */}

      {activeProvider === 'ollama' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-5">
              <Server size={18} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-700">Ollama — Chat Model</h2>
            </div>

            <label className="text-xs text-slate-500 mb-1.5 block">Active Model</label>
            <div className="relative mb-4">
              <button
                onClick={() => setOpenDropdown(openDropdown === 'ollama-llm' ? null : 'ollama-llm')}
                className="w-full flex items-center justify-between glass-sm rounded-lg px-3 py-2.5 text-sm text-slate-800 hover:ring-2 hover:ring-emerald-300"
              >
                <span className="font-medium">{settings.ollama_model}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${openDropdown === 'ollama-llm' ? 'rotate-180' : ''}`} />
              </button>
              {openDropdown === 'ollama-llm' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute z-30 mt-1 w-full glass-dropdown max-h-52 overflow-y-auto"
                >
                  {ollamaLlmOptions.map((model) => (
                    <button
                      key={model}
                      onClick={() => { save({ ollama_model: model }); setOpenDropdown(null); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between ${
                        model === settings.ollama_model ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'
                      }`}
                    >
                      <span>{model}</span>
                      {isInstalled(model) && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">installed</span>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>

            <label className="text-xs text-slate-500 mb-1.5 block">Add Custom Model</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newOllamaModel}
                onChange={(e) => setNewOllamaModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomModel('custom_llm_models', newOllamaModel, () => setNewOllamaModel(''))}
                placeholder="e.g. phi3:mini"
                className="flex-1 glass-sm rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
              <button
                onClick={() => addCustomModel('custom_llm_models', newOllamaModel, () => setNewOllamaModel(''))}
                className="glass-sm rounded-lg px-3 py-2 hover:bg-emerald-50"
              >
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>
            {settings.custom_llm_models.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {settings.custom_llm_models.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                    {m}
                    <button onClick={() => removeCustomModel('custom_llm_models', m)} className="hover:text-red-500">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard hover={false}>
            <div className="flex items-center gap-2 mb-5">
              <RefreshCw size={18} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-700">Ollama Server + Test</h2>
            </div>

            <label className="text-xs text-slate-500 mb-1.5 block">Base URL</label>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={settings.ollama_base_url}
                onChange={(e) => setSettings({ ...settings, ollama_base_url: e.target.value })}
                onBlur={(e) => save({ ollama_base_url: e.target.value.trim() })}
                onKeyDown={(e) => { if (e.key === 'Enter') save({ ollama_base_url: (e.target as HTMLInputElement).value.trim() }); }}
                className="flex-1 glass-sm rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>
            <button
              onClick={() => runTest('ollama')}
              disabled={testing === 'ollama'}
              className="w-full glass-sm rounded-lg px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {testing === 'ollama' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Test Connection
            </button>
            {testResult.ollama && (
              <p className={`text-[11px] mt-2 flex items-center gap-1 ${testResult.ollama.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {testResult.ollama.ok ? <Check size={12} /> : <X size={12} />}
                {testResult.ollama.message}
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-3">
              {ollamaModels.length > 0
                ? `Connected — ${ollamaModels.length} model${ollamaModels.length > 1 ? 's' : ''} available`
                : 'Unable to reach Ollama server. Make sure it is running.'}
            </p>
          </GlassCard>
        </div>
      )}

      {activeProvider === 'openai' && (
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-5">
            <Sparkles size={18} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-700">OpenAI</h2>
          </div>

          {/* API key */}
          <label className="text-xs text-slate-500 mb-1.5 block">API Key</label>
          {settings.openai_api_key_set && !openaiKeyDraft && (
            <div className="flex items-center gap-2 mb-4 flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-[180px] glass-sm rounded-lg px-3 py-2.5 text-sm font-mono text-slate-700 flex items-center gap-2">
                <KeyRound size={14} className="text-emerald-500" />
                ••••••••••••••••
                <span className="ml-auto text-[10px] text-emerald-600">saved</span>
              </div>
              <button
                onClick={() => setOpenaiKeyDraft(' ')}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Change
              </button>
              <button
                onClick={clearOpenaiKey}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          )}
          {(!settings.openai_api_key_set || openaiKeyDraft) && (
            <div className="flex items-center gap-2 mb-4 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 min-w-[180px]">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiKeyDraft.trim() === '' ? openaiKeyDraft : openaiKeyDraft}
                  onChange={(e) => setOpenaiKeyDraft(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  className="w-full glass-sm rounded-lg px-3 py-2.5 pr-10 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showOpenaiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                onClick={saveOpenaiKey}
                disabled={!openaiKeyDraft.trim()}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
              >
                Save
              </button>
              {settings.openai_api_key_set && (
                <button
                  onClick={() => setOpenaiKeyDraft('')}
                  className="glass-sm rounded-lg px-3 py-2.5 text-xs text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Model */}
          <label className="text-xs text-slate-500 mb-1.5 block">Model</label>
          <div className="relative mb-4">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'openai-model' ? null : 'openai-model')}
              className="w-full flex items-center justify-between glass-sm rounded-lg px-3 py-2.5 text-sm text-slate-800 hover:ring-2 hover:ring-indigo-300"
            >
              <span className="font-medium">{settings.openai_model}</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${openDropdown === 'openai-model' ? 'rotate-180' : ''}`} />
            </button>
            {openDropdown === 'openai-model' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute z-30 mt-1 w-full glass-dropdown max-h-52 overflow-y-auto"
              >
                {openaiOptions.map((model) => (
                  <button
                    key={model}
                    onClick={() => { save({ openai_model: model }); setOpenDropdown(null); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 ${
                      model === settings.openai_model ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'
                    }`}
                  >
                    {model}
                  </button>
                ))}
              </motion.div>
            )}
          </div>

          {/* Add custom OpenAI model */}
          <label className="text-xs text-slate-500 mb-1.5 block">Add Custom Model</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newOpenaiModel}
              onChange={(e) => setNewOpenaiModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomModel('custom_openai_models', newOpenaiModel, () => setNewOpenaiModel(''))}
              placeholder="e.g. gpt-4.1"
              className="flex-1 glass-sm rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={() => addCustomModel('custom_openai_models', newOpenaiModel, () => setNewOpenaiModel(''))}
              className="glass-sm rounded-lg px-3 py-2 hover:bg-indigo-50"
            >
              <Plus size={16} className="text-indigo-600" />
            </button>
          </div>
          {settings.custom_openai_models.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {settings.custom_openai_models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                  {m}
                  <button onClick={() => removeCustomModel('custom_openai_models', m)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Test */}
          <button
            onClick={() => runTest('openai')}
            disabled={testing === 'openai' || (!settings.openai_api_key_set && !openaiKeyDraft.trim())}
            className="w-full glass-sm rounded-lg px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {testing === 'openai' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Test Connection
          </button>
          {testResult.openai && (
            <p className={`text-[11px] mt-2 flex items-center gap-1 ${testResult.openai.ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {testResult.openai.ok ? <Check size={12} /> : <X size={12} />}
              {testResult.openai.message}
            </p>
          )}
        </GlassCard>
      )}

      {activeProvider === 'gemini' && (
        <GlassCard hover={false}>
          <div className="flex items-center gap-2 mb-5">
            <Cloud size={18} className="text-sky-600" />
            <h2 className="text-sm font-semibold text-slate-700">Google Gemini</h2>
          </div>

          {/* API key */}
          <label className="text-xs text-slate-500 mb-1.5 block">API Key</label>
          {settings.gemini_api_key_set && !geminiKeyDraft && (
            <div className="flex items-center gap-2 mb-4 flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-[180px] glass-sm rounded-lg px-3 py-2.5 text-sm font-mono text-slate-700 flex items-center gap-2">
                <KeyRound size={14} className="text-emerald-500" />
                ••••••••••••••••
                <span className="ml-auto text-[10px] text-emerald-600">saved</span>
              </div>
              <button
                onClick={() => setGeminiKeyDraft(' ')}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Change
              </button>
              <button
                onClick={clearGeminiKey}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          )}
          {(!settings.gemini_api_key_set || geminiKeyDraft) && (
            <div className="flex items-center gap-2 mb-4 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 min-w-[180px]">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiKeyDraft.trim() === '' ? geminiKeyDraft : geminiKeyDraft}
                  onChange={(e) => setGeminiKeyDraft(e.target.value)}
                  placeholder="AIza..."
                  autoComplete="off"
                  className="w-full glass-sm rounded-lg px-3 py-2.5 pr-10 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showGeminiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                onClick={saveGeminiKey}
                disabled={!geminiKeyDraft.trim()}
                className="glass-sm rounded-lg px-3 py-2.5 text-xs font-medium text-sky-600 hover:bg-sky-50 disabled:opacity-50"
              >
                Save
              </button>
              {settings.gemini_api_key_set && (
                <button
                  onClick={() => setGeminiKeyDraft('')}
                  className="glass-sm rounded-lg px-3 py-2.5 text-xs text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Model */}
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-slate-500">Model</label>
            {settings.gemini_api_key_set && (
              <button
                onClick={() => fetchGeminiModels()}
                disabled={geminiModelsLoading}
                title="Refresh model list from Google"
                className="text-[11px] text-sky-600 hover:text-sky-700 flex items-center gap-1 disabled:opacity-50"
              >
                {geminiModelsLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {geminiModels.length > 0
                  ? `${geminiModels.length} models${geminiModels.some((m) => m.deprecated) ? ` · ${geminiModels.filter((m) => m.deprecated).length} deprecated` : ''}`
                  : 'Fetch models'}
              </button>
            )}
          </div>
          {geminiModelsError && (
            <p className="text-[11px] text-amber-600 mb-1.5 flex items-center gap-1">
              <AlertCircle size={11} />
              Couldn't fetch live model list — using defaults. ({geminiModelsError})
            </p>
          )}
          <div className="relative mb-4">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'gemini-model' ? null : 'gemini-model')}
              className="w-full flex items-center justify-between glass-sm rounded-lg px-3 py-2.5 text-sm text-slate-800 hover:ring-2 hover:ring-sky-300"
            >
              <span className="font-medium flex items-center gap-2">
                {settings.gemini_model}
                {geminiInfoByName.get(settings.gemini_model)?.deprecated && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Deprecated</span>
                )}
              </span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${openDropdown === 'gemini-model' ? 'rotate-180' : ''}`} />
            </button>
            {openDropdown === 'gemini-model' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute z-30 mt-1 w-full glass-dropdown max-h-72 overflow-y-auto"
              >
                {geminiOptions.map((model) => {
                  const info = geminiInfoByName.get(model);
                  const isSelected = model === settings.gemini_model;
                  return (
                  <button
                    key={model}
                    onClick={() => { save({ gemini_model: model }); setOpenDropdown(null); }}
                    title={info?.description || ''}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 ${
                      isSelected ? 'bg-sky-50 text-sky-700' : 'text-slate-700'
                    } ${info?.deprecated ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>
                        {info?.display_name && info.display_name !== model
                          ? <><span className="font-mono text-[12px]">{model}</span> <span className="text-slate-400">— {info.display_name}</span></>
                          : <span className="font-mono text-[12px]">{model}</span>}
                      </span>
                      {info?.deprecated ? (
                        <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">Deprecated</span>
                      ) : info ? (
                        <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded shrink-0">Active</span>
                      ) : null}
                    </div>
                    {info && (info.input_token_limit > 0 || info.output_token_limit > 0) && (
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        in {info.input_token_limit.toLocaleString()} · out {info.output_token_limit.toLocaleString()} tok
                      </div>
                    )}
                  </button>
                  );
                })}
              </motion.div>
            )}
          </div>

          {/* Add custom Gemini model */}
          <label className="text-xs text-slate-500 mb-1.5 block">Add Custom Model</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newGeminiModel}
              onChange={(e) => setNewGeminiModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomModel('custom_gemini_models', newGeminiModel, () => setNewGeminiModel(''))}
              placeholder="e.g. gemini-2.5-flash"
              className="flex-1 glass-sm rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <button
              onClick={() => addCustomModel('custom_gemini_models', newGeminiModel, () => setNewGeminiModel(''))}
              className="glass-sm rounded-lg px-3 py-2 hover:bg-sky-50"
            >
              <Plus size={16} className="text-sky-600" />
            </button>
          </div>
          {settings.custom_gemini_models.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {settings.custom_gemini_models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                  {m}
                  <button onClick={() => removeCustomModel('custom_gemini_models', m)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Test */}
          <button
            onClick={() => runTest('gemini')}
            disabled={testing === 'gemini' || (!settings.gemini_api_key_set && !geminiKeyDraft.trim())}
            className="w-full glass-sm rounded-lg px-3 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {testing === 'gemini' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Test Connection
          </button>
          {testResult.gemini && (
            <p className={`text-[11px] mt-2 flex items-center gap-1 ${testResult.gemini.ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {testResult.gemini.ok ? <Check size={12} /> : <X size={12} />}
              {testResult.gemini.message}
            </p>
          )}
        </GlassCard>
      )}

      {/* ── Embeddings (always Ollama) ───────────────────── */}
      <GlassCard hover={false}>
        <div className="flex items-center gap-2 mb-5">
          <Cpu size={18} className="text-emerald-600" />
          <h2 className="text-sm font-semibold text-slate-700">Embedding Model (RAG)</h2>
          <span className="text-[11px] text-slate-400">— runs on Ollama</span>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">Active Embedding Model</label>
            <div className="relative">
              <button
                onClick={() => setOpenDropdown(openDropdown === 'ollama-embedding' ? null : 'ollama-embedding')}
                className="w-full flex items-center justify-between glass-sm rounded-lg px-3 py-2.5 text-sm text-slate-800 hover:ring-2 hover:ring-emerald-300"
              >
                <span className="font-medium">{settings.ollama_embedding_model}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${openDropdown === 'ollama-embedding' ? 'rotate-180' : ''}`} />
              </button>
              {openDropdown === 'ollama-embedding' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute z-30 mt-1 w-full glass-dropdown max-h-52 overflow-y-auto"
                >
                  {ollamaEmbeddingOptions.map((model) => (
                    <button
                      key={model}
                      onClick={() => { save({ ollama_embedding_model: model }); setOpenDropdown(null); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 ${
                        model === settings.ollama_embedding_model ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">Add Custom Embedding Model</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newEmbeddingModel}
                onChange={(e) => setNewEmbeddingModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomModel('custom_embedding_models', newEmbeddingModel, () => setNewEmbeddingModel(''))}
                placeholder="e.g. bge-large"
                className="flex-1 glass-sm rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
              <button
                onClick={() => addCustomModel('custom_embedding_models', newEmbeddingModel, () => setNewEmbeddingModel(''))}
                className="glass-sm rounded-lg px-3 py-2 hover:bg-emerald-50"
              >
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>
            {settings.custom_embedding_models.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {settings.custom_embedding_models.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                    {m}
                    <button onClick={() => removeCustomModel('custom_embedding_models', m)} className="hover:text-red-500">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {ollamaModels.length > 0 && (
          <div className="mt-5">
            <label className="text-xs text-slate-500 mb-2 block">Installed on Ollama Server</label>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {ollamaModels.map((m) => (
                <div key={m.name} className="flex items-center justify-between text-xs text-slate-600 glass-sm rounded-lg px-3 py-1.5">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-slate-400">{formatBytes(m.size)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Shared: Temperature + Auto-run ───────────────── */}
      <GlassCard hover={false}>
        <div className="flex items-center gap-2 mb-5">
          <Timer size={18} className="text-emerald-600" />
          <h2 className="text-sm font-semibold text-slate-700">Agent Behaviour</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Temperature */}
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">
              Agent Temperature: <span className="font-medium text-slate-700">{settings.agent_temperature}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.agent_temperature}
              onChange={(e) => setSettings({ ...settings, agent_temperature: parseFloat(e.target.value) })}
              onMouseUp={(e) => save({ agent_temperature: parseFloat((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => save({ agent_temperature: parseFloat((e.target as HTMLInputElement).value) })}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>0 (Precise)</span>
              <span>1 (Creative)</span>
            </div>
          </div>

          {/* Auto-run toggle */}
          <div>
            <label className="text-xs text-slate-500 mb-3 block">Automatic Pipeline Execution</label>
            <div
              onClick={() => save({ auto_run_pipeline: !settings.auto_run_pipeline })}
              className="flex items-center justify-between gap-4 glass-sm rounded-xl px-4 py-3 cursor-pointer hover:bg-slate-50"
            >
              <div className="text-left flex-1 min-w-0">
                <span className={`text-sm font-medium ${settings.auto_run_pipeline ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {settings.auto_run_pipeline ? 'Enabled' : 'Disabled'}
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {settings.auto_run_pipeline
                    ? `Anomalies auto-run the pipeline; full sweep every ${settings.auto_run_interval_seconds}s`
                    : 'Monitoring only — no automatic incidents or pipelines'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.auto_run_pipeline}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  settings.auto_run_pipeline ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              >
                <span className="sr-only">Toggle Auto-Run</span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    settings.auto_run_pipeline ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Interval */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <input
                type="number"
                min={5}
                step={5}
                value={settings.auto_run_interval_seconds}
                onChange={(e) => {
                  const val = Math.max(5, parseInt(e.target.value) || 5);
                  setSettings({ ...settings, auto_run_interval_seconds: val });
                }}
                onBlur={(e) => save({ auto_run_interval_seconds: Math.max(5, parseInt(e.target.value) || 5) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save({ auto_run_interval_seconds: Math.max(5, parseInt((e.target as HTMLInputElement).value) || 5) });
                }}
                disabled={!settings.auto_run_pipeline}
                className={`w-24 glass-sm rounded-lg px-3 py-2 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
                  !settings.auto_run_pipeline ? 'opacity-50 cursor-not-allowed' : 'text-slate-800'
                }`}
              />
              <span className="text-sm text-slate-500">seconds</span>
              <div className="flex gap-1.5 ml-auto flex-wrap">
                {[10, 30, 60, 120, 300].map((s) => (
                  <button
                    key={s}
                    onClick={() => save({ auto_run_interval_seconds: s })}
                    disabled={!settings.auto_run_pipeline}
                    className={`text-xs px-2 py-1 rounded-full ${
                      settings.auto_run_interval_seconds === s
                        ? 'bg-emerald-100 text-emerald-700 font-medium'
                        : 'glass-sm text-slate-500 hover:bg-slate-100'
                    } ${!settings.auto_run_pipeline ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
