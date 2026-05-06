/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI Services tab (foundation phase).
 *
 * What ships in this phase:
 *   - Per-user encrypted OpenRouter key entry (Electron safeStorage)
 *   - Live key validation + balance / usage readout
 *   - Workspace-wide AI policy (super_admin-controlled)
 *   - First-use consent dialog (data-leaves-device disclosure)
 *   - Model picker filtered by allowedModels and tool-support
 *   - No-training toggle (sets provider.data_collection: 'deny')
 *   - Empty state when no key is set; full settings panel when a key exists
 *
 * The chat panel + scoped business-context tools land in the next phase
 * (step 4 of the AI Services build plan). This tab is intentionally
 * marked BETA via the sidebar tag — every text surface acknowledges
 * that the feature is in active development.
 *
 * Why local-first key storage: the OpenRouter key is BYOK — each
 * eligible user (manager/admin/super_admin) brings their own. The key
 * is encrypted at rest via the OS keychain (safeStorage), keyed by a
 * hash of the user id, and NEVER synced to Firestore. A user signing
 * in on a second machine re-pastes their key. By design.
 */

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, KeyRound, ShieldCheck, AlertTriangle, CheckCircle2,
  ExternalLink, Loader2, Trash2, RefreshCw, Lock, Eye, EyeOff,
  Database, Building2, Users, Calendar, FileSpreadsheet, Clock, Flag,
} from 'lucide-react';
import type { CompanyData } from '../types';
import { useAuth } from '../lib/auth';
import { getMode } from '../lib/mode';
import { useConfirm } from '../components/ConfirmModal';
import {
  aiKeyStore, getAiUserId, isAiBridgeAvailable,
} from '../lib/ai/keyStorage';
import {
  useWorkspaceAiPolicy, useAiUserPrefs, isModelAllowed,
} from '../lib/ai/policy';
import {
  listModels, getKeyInfo, validateKey, pricePerMtok, supportsTools,
  type OpenRouterModel, type OpenRouterKeyInfo,
} from '../lib/ai/openrouter';
import { useStationProfiles, countProfiled } from '../lib/ai/profiles';
import { useAiScope, type AiScope } from '../lib/ai/scope';
import { listAvailableData, type DataSurvey } from '../lib/ai/dataSurvey';
import { ScopeBar, ApplyDefaultScopeButton } from '../components/AI/ScopeBar';
import {
  TOOLS, READ_ONLY_TOOL_NAMES, classify, TOKEN_BUDGET,
  type ToolContext, type BudgetVerdict,
} from '../lib/ai/tools';
import { ChatPanel } from '../components/AI/ChatPanel';

const MODEL_CACHE_KEY = 'ils.ai.modelCache';
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface ModelCache {
  models: OpenRouterModel[];
  fetchedAt: number;
}

function readModelCache(): ModelCache | null {
  try {
    const raw = localStorage.getItem(MODEL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelCache;
    if (Date.now() - parsed.fetchedAt > MODEL_CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeModelCache(models: OpenRouterModel[]) {
  localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify({ models, fetchedAt: Date.now() }));
}

interface AIServicesTabProps {
  /** Active company's full data slice. Used by the Workspace Overview card
   *  to surface what the AI assistant will see when it runs. */
  companyData: CompanyData;
  activeCompanyId: string;
}

export function AIServicesTab({ companyData, activeCompanyId }: AIServicesTabProps) {
  const { user, role } = useAuth();
  const isSuperAdmin = role === 'super_admin';
  // Offline mode (role===null) treats everyone as fully privileged, same
  // as every other tab. Online mode goes through tabAccess role gates.
  const userId = useMemo(() => getAiUserId(user?.uid ?? null), [user?.uid]);
  const [policy, setPolicy] = useWorkspaceAiPolicy();
  const [prefs, setPrefs] = useAiUserPrefs(userId);
  const { confirm, slot: confirmSlot } = useConfirm();

  // ── Phase 2: workspace overview + scope state ─────────────────────────
  const mode = getMode();
  const { profiles, updateProfile } = useStationProfiles(
    activeCompanyId || null,
    mode,
    user?.uid ?? userId,
  );
  const profilesCount = useMemo(() => {
    const stationIds = companyData.stations.map((s) => s.id);
    return countProfiled(stationIds, profiles, 40).profiled;
  }, [companyData.stations, profiles]);
  const survey = useMemo<DataSurvey>(
    // v5.20.1 — pass the full profile map so the survey carries the
    // station list + group rollup the chat panel relies on for
    // batched Arabic-aware interviews.
    () => listAvailableData(companyData, profiles),
    [companyData, profiles],
  );
  const [scope, setScope] = useAiScope();

  // ── Phase 3: tool context for the inspector + future chat panel ───────
  const toolCtx = useMemo<ToolContext>(() => ({
    companyData,
    profiles,
    updateProfile,
  }), [companyData, profiles, updateProfile]);

  // ── Bridge / key state ─────────────────────────────────────────────────
  const bridgeReady = isAiBridgeAvailable();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null);
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Live readouts ─────────────────────────────────────────────────────
  const [keyInfo, setKeyInfo] = useState<OpenRouterKeyInfo | null>(null);
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // ── Consent dialog ─────────────────────────────────────────────────────
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingPasteKey, setPendingPasteKey] = useState<string | null>(null);

  // Hydrate bridge availability + existing key/consent on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!bridgeReady) {
        if (!cancelled) {
          setHasKey(false);
          setEncryptionAvailable(false);
          setConsentAccepted(false);
        }
        return;
      }
      try {
        const [enc, has, consent] = await Promise.all([
          aiKeyStore.isEncryptionAvailable(),
          aiKeyStore.hasKey(userId),
          aiKeyStore.getConsent(userId),
        ]);
        if (cancelled) return;
        setEncryptionAvailable(enc);
        setHasKey(has);
        setConsentAccepted(consent.accepted);
      } catch (e) {
        if (cancelled) return;
        setSaveError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [bridgeReady, userId]);

  // Load key info + models whenever a key exists. Pulls cached models if
  // fresh, otherwise re-fetches from /models.
  const refreshKeyState = async () => {
    if (!bridgeReady) return;
    setLoadingInfo(true);
    setInfoError(null);
    try {
      const apiKey = await aiKeyStore.getKey(userId);
      if (!apiKey) {
        setKeyInfo(null);
        setModels(null);
        return;
      }
      const cached = readModelCache();
      if (cached) {
        setModels(cached.models);
      } else {
        const fetched = await listModels(apiKey);
        setModels(fetched);
        writeModelCache(fetched);
      }
      const info = await getKeyInfo(apiKey);
      setKeyInfo(info);
    } catch (e) {
      setInfoError((e as Error).message);
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    if (hasKey) refreshKeyState();
    // We deliberately re-run only on hasKey transitions; refreshKeyState
    // closes over userId which is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, userId]);

  // ── Key entry handlers ────────────────────────────────────────────────
  const handlePasteAndValidate = async () => {
    setSaveError(null);
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setSaveError('Paste your OpenRouter key first.');
      return;
    }
    setSavingKey(true);
    try {
      const valid = await validateKey(trimmed);
      if (!valid) {
        setSaveError('Key was rejected by OpenRouter (401/403). Double-check it on openrouter.ai/keys.');
        return;
      }
      // First-time use: surface the consent dialog before persisting.
      if (!consentAccepted) {
        setPendingPasteKey(trimmed);
        setConsentOpen(true);
        return;
      }
      await persistKey(trimmed);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const persistKey = async (plaintext: string) => {
    await aiKeyStore.saveKey(userId, plaintext);
    setHasKey(true);
    setKeyInput('');
    await refreshKeyState();
  };

  const handleConsentAccept = async () => {
    if (!pendingPasteKey) return;
    setConsentOpen(false);
    setSavingKey(true);
    try {
      await aiKeyStore.setConsent(userId, true);
      setConsentAccepted(true);
      await persistKey(pendingPasteKey);
      setPendingPasteKey(null);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleConsentDecline = () => {
    setConsentOpen(false);
    setPendingPasteKey(null);
  };

  const handleDeleteKey = async () => {
    const ok = await confirm({
      title: 'Remove your OpenRouter key?',
      message: 'The encrypted key will be deleted from this device. AI Services on this device will be disabled until you paste a new key. Your OpenRouter account itself is not affected.',
    });
    if (!ok) return;
    await aiKeyStore.deleteKey(userId);
    setHasKey(false);
    setKeyInfo(null);
    setModels(null);
    setConsentAccepted(false);
  };

  // ── Workspace policy disabled → render disabled state ─────────────────
  if (!policy.aiModeEnabled && !isSuperAdmin) {
    return (
      <div className="max-w-3xl space-y-6">
        <Header />
        <DisabledByAdminCard />
        {confirmSlot}
      </div>
    );
  }

  // ── Bridge missing (browser preview, not Electron) ────────────────────
  if (!bridgeReady) {
    return (
      <div className="max-w-3xl space-y-6">
        <Header />
        <NoBridgeCard />
        {confirmSlot}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <Header />

      {/* Workspace policy section — super_admin only. Offline mode (role===null)
          also gets it since there's effectively a single user. */}
      {(isSuperAdmin || role === null) && (
        <WorkspacePolicyCard policy={policy} setPolicy={setPolicy} />
      )}

      {/* Phase 2 — Workspace overview + session scope. Visible regardless of
          key state so planners can preview what the AI would see before they
          paste a key. */}
      {activeCompanyId && (
        <WorkspaceOverviewCard
          survey={survey}
          scope={scope}
          setScope={setScope}
        />
      )}

      {/* Phase 3 — Tool inspector. Lets the planner run any read-only tool
          against the current scope and inspect the JSON the AI would
          receive. No key required — these are pure functions over local
          workspace data. */}
      {activeCompanyId && <ToolInspectorCard ctx={toolCtx} scope={scope} />}

      {/* Per-user key + settings */}
      {hasKey === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading…</span>
        </div>
      ) : !hasKey ? (
        <EmptyKeyState
          keyInput={keyInput}
          setKeyInput={setKeyInput}
          showKey={showKey}
          setShowKey={setShowKey}
          savingKey={savingKey}
          saveError={saveError}
          encryptionAvailable={encryptionAvailable}
          onSave={handlePasteAndValidate}
        />
      ) : (
        <>
          <ConfiguredKeyState
            keyInfo={keyInfo}
            models={models}
            prefs={prefs}
            setPrefs={setPrefs}
            policy={policy}
            loadingInfo={loadingInfo}
            infoError={infoError}
            onRefresh={refreshKeyState}
            onDelete={handleDeleteKey}
          />
          {/* Phase 4 — chat panel. Hidden until a key is set; shows a
              "pick a model first" empty state internally when prefs.selectedModel
              is null. */}
          {activeCompanyId && (
            <ChatPanel
              aiUserId={userId}
              model={prefs.selectedModel}
              noTraining={prefs.noTraining}
              ctx={toolCtx}
              scope={scope}
              companyData={companyData}
            />
          )}
        </>
      )}

      <FuturePhaseNotice />

      {confirmSlot}

      {/* First-use consent dialog */}
      <ConsentDialog
        open={consentOpen}
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Header() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-300" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight">
            AI Services
          </h3>
          <span
            className="px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-widest uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30"
            title="This feature is in active development. Behaviour may change between releases."
          >
            Beta · Testing
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          Bring your own OpenRouter key. The assistant explores stations, schedules, payroll, and workforce plans with you and surfaces liability / cost / risk findings.
        </p>
      </div>
    </div>
  );
}

function DisabledByAdminCard() {
  return (
    <div className="p-5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/70 rounded-2xl">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-slate-400 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-100">AI Services are disabled in this workspace</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A super-admin has turned AI Services off workspace-wide. Ask them to re-enable it from this tab if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoBridgeCard() {
  return (
    <div className="p-5 bg-amber-50/60 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Desktop app required</p>
          <p className="text-xs text-amber-700 dark:text-amber-300/80">
            AI Services use the OS keychain to encrypt your OpenRouter key at rest. That requires the Electron desktop app — the browser preview can&apos;t access the keychain. Run the installed app or <code className="font-mono">npm run electron:dev</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

function WorkspacePolicyCard({
  policy, setPolicy,
}: {
  policy: ReturnType<typeof useWorkspaceAiPolicy>[0];
  setPolicy: ReturnType<typeof useWorkspaceAiPolicy>[1];
}) {
  const [allowedModelsText, setAllowedModelsText] = useState(
    (policy.allowedModels ?? []).join(', '),
  );
  // Keep the input in sync if policy changes from elsewhere (e.g. another tab).
  useEffect(() => {
    setAllowedModelsText((policy.allowedModels ?? []).join(', '));
  }, [policy.allowedModels]);

  const commitAllowedModels = () => {
    const parts = allowedModelsText.split(',').map(s => s.trim()).filter(Boolean);
    setPolicy({ ...policy, allowedModels: parts.length ? parts : null });
  };

  return (
    <div className="p-5 bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/70 rounded-2xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-500 dark:text-blue-300" />
        <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
          Workspace Policy
        </h4>
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          Super-admin only
        </span>
      </div>

      <PolicyToggle
        label="AI mode enabled"
        description="Master switch. When off, AI Services are hidden for everyone in this workspace regardless of role or per-user keys."
        checked={policy.aiModeEnabled}
        onChange={(v) => setPolicy({ ...policy, aiModeEnabled: v })}
      />

      <PolicyToggle
        label="Usage log"
        description="When on, log each AI session (user + timestamp + action) so admins can see who is using the feature. The contents of prompts and responses are never logged."
        checked={policy.aiUsageLog}
        onChange={(v) => setPolicy({ ...policy, aiUsageLog: v })}
      />

      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Allowed models
        </label>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Optional. Comma-separated OpenRouter model ids users may select. Leave empty for no restriction. Useful for capping spend by allowing only Haiku / Sonnet / Mini class models.
        </p>
        <input
          type="text"
          value={allowedModelsText}
          onChange={(e) => setAllowedModelsText(e.target.value)}
          onBlur={commitAllowedModels}
          placeholder="e.g. anthropic/claude-haiku-4.5, openai/gpt-4o-mini"
          className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
        />
      </div>
    </div>
  );
}

function PolicyToggle({
  label, description, checked, onChange,
}: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
          checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

function EmptyKeyState({
  keyInput, setKeyInput, showKey, setShowKey, savingKey, saveError, encryptionAvailable, onSave,
}: {
  keyInput: string;
  setKeyInput: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  savingKey: boolean;
  saveError: string | null;
  encryptionAvailable: boolean | null;
  onSave: () => void;
}) {
  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-2xl space-y-4 shadow-sm">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
          Bring your own OpenRouter key
        </h4>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        AI Services use <strong>your</strong> OpenRouter account, not a shared one. The app does not ship with a key — every user pastes their own. Your key is encrypted with the OS keychain and stored only on this machine; it is never synced to Firestore or shared with other users.
      </p>

      {encryptionAvailable === false && (
        <div className="p-3 bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <p className="text-[11px] text-amber-800 dark:text-amber-200 font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            OS encryption unavailable — install gnome-keyring (Linux) before saving your key.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          API key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-…"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 pe-9 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={savingKey || !keyInput.trim() || encryptionAvailable === false}
            className="apple-press px-5 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {savingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {savingKey ? 'Validating…' : 'Validate & save'}
          </button>
        </div>
        {saveError && (
          <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-300">{saveError}</p>
        )}
      </div>

      <a
        href="https://openrouter.ai/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-300 hover:underline"
      >
        Get a key on openrouter.ai/keys <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

function ConfiguredKeyState({
  keyInfo, models, prefs, setPrefs, policy, loadingInfo, infoError, onRefresh, onDelete,
}: {
  keyInfo: OpenRouterKeyInfo | null;
  models: OpenRouterModel[] | null;
  prefs: ReturnType<typeof useAiUserPrefs>[0];
  setPrefs: ReturnType<typeof useAiUserPrefs>[1];
  policy: ReturnType<typeof useWorkspaceAiPolicy>[0];
  loadingInfo: boolean;
  infoError: string | null;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  // Filter models to those allowed by workspace policy AND that support
  // tool use — the AI workflow depends on the tool-use loop, so non-tool
  // models would silently break the interview flow.
  const filteredModels = useMemo(() => {
    if (!models) return [];
    return models
      .filter(m => isModelAllowed(m.id, policy.allowedModels))
      .filter(m => supportsTools(m))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [models, policy.allowedModels]);

  const selectedModel = filteredModels.find(m => m.id === prefs.selectedModel) ?? null;
  const formatUsd = (n: number | null | undefined) =>
    n == null ? '—' : `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <div className="space-y-6">
      {/* Connected card */}
      <div className="p-5 bg-emerald-50/40 dark:bg-emerald-500/[0.07] border border-emerald-200 dark:border-emerald-500/30 rounded-2xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
            <div>
              <p className="text-xs font-black text-emerald-800 dark:text-emerald-200 uppercase tracking-widest">
                OpenRouter key connected
              </p>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-300/80 mt-0.5">
                Encrypted via OS keychain. This device only.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              disabled={loadingInfo}
              className="apple-press px-3 py-1.5 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-60"
            >
              {loadingInfo ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
            <button
              onClick={onDelete}
              className="apple-press px-3 py-1.5 bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 border border-rose-200 dark:border-rose-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-500/25 flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
          </div>
        </div>

        {infoError && (
          <p role="alert" className="mt-3 text-[11px] font-bold text-rose-600 dark:text-rose-300">{infoError}</p>
        )}

        {keyInfo && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ReadoutTile label="Spend so far" value={formatUsd(keyInfo.usage)} />
            <ReadoutTile
              label="Spend cap"
              value={keyInfo.limit == null ? 'No limit' : formatUsd(keyInfo.limit)}
            />
            <ReadoutTile
              label="Plan"
              value={keyInfo.is_free_tier ? 'Free tier' : 'Paid'}
            />
            <ReadoutTile
              label="Label"
              value={keyInfo.label ?? '—'}
              mono
            />
          </div>
        )}
      </div>

      {/* Model picker + privacy */}
      <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-2xl space-y-5 shadow-sm">
        <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
          Your settings
        </h4>

        <div className="space-y-2">
          <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Model
          </label>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Filtered to models that support tool use (required for the interview / advisory flow). {policy.allowedModels && policy.allowedModels.length > 0 && (
              <span>Workspace allows {policy.allowedModels.length} model{policy.allowedModels.length === 1 ? '' : 's'}.</span>
            )}
          </p>
          <select
            value={prefs.selectedModel ?? ''}
            onChange={(e) => setPrefs({ ...prefs, selectedModel: e.target.value || null })}
            disabled={!filteredModels.length}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all disabled:opacity-60"
          >
            <option value="">— Pick a model —</option>
            {filteredModels.map((m) => {
              const price = pricePerMtok(m);
              const priceText = price.prompt != null && price.completion != null
                ? ` · $${price.prompt.toFixed(2)}/$${price.completion.toFixed(2)} per Mtok`
                : '';
              return (
                <option key={m.id} value={m.id}>
                  {m.name}{priceText}
                </option>
              );
            })}
          </select>
          {selectedModel && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{selectedModel.id}</p>
          )}
          {!loadingInfo && filteredModels.length === 0 && models && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 font-bold">
              No models match the current allowlist. Loosen the workspace allowed-models list to see options.
            </p>
          )}
        </div>

        <PolicyToggle
          label="No-training mode"
          description="When on, asks OpenRouter to set provider data_collection: 'deny' so the upstream model provider may not train on your prompts. Default on. Turn off only if you want providers to use your data for training."
          checked={prefs.noTraining}
          onChange={(v) => setPrefs({ ...prefs, noTraining: v })}
        />
      </div>
    </div>
  );
}

function ReadoutTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white/80 dark:bg-slate-900/40 border border-emerald-200/60 dark:border-emerald-500/20 rounded-lg p-3">
      <p className="text-[9px] font-black text-emerald-700/70 dark:text-emerald-300/70 uppercase tracking-widest">{label}</p>
      <p className={`text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function FuturePhaseNotice() {
  return (
    <div className="p-4 bg-blue-50/40 dark:bg-blue-500/[0.07] border border-blue-200 dark:border-blue-500/30 rounded-xl">
      <p className="text-[11px] text-blue-800 dark:text-blue-200 font-bold uppercase tracking-widest mb-1">Coming next</p>
      <p className="text-xs text-blue-700 dark:text-blue-300/90 leading-relaxed">
        The chat panel — interview + advisory flow over your stations, schedules, payroll, and workforce plans — lands in the next phase. Scope is already wired (above); the conversation surface will read from it directly when it ships.
      </p>
    </div>
  );
}

// ─── Workspace overview (phase 2) ───────────────────────────────────────

function WorkspaceOverviewCard({
  survey, scope, setScope,
}: {
  survey: DataSurvey;
  scope: ReturnType<typeof useAiScope>[0];
  setScope: ReturnType<typeof useAiScope>[1];
}) {
  const formatMonthKey = (k: { year: number; month: number } | null) => {
    if (!k) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[k.month - 1]} ${k.year}`;
  };
  const scheduleSummary = survey.schedules.earliest && survey.schedules.latest
    ? `${formatMonthKey(survey.schedules.earliest)} → ${formatMonthKey(survey.schedules.latest)} (${survey.schedules.monthCount}m)`
    : 'No schedules saved yet';
  const leaveSummary = survey.leave.earliest && survey.leave.latest
    ? `${survey.leave.earliest} → ${survey.leave.latest} (${survey.leave.totalRanges} ranges)`
    : 'No leave records yet';
  const holidaySummary = survey.holidays.count > 0
    ? `${survey.holidays.earliest} → ${survey.holidays.latest} (${survey.holidays.count})`
    : 'No holidays on file';

  const profilePct = survey.stations.count > 0
    ? Math.round((survey.stations.profiledCount / survey.stations.count) * 100)
    : 0;

  // The scope is "set" when at least one domain has a window assigned.
  // Phase 4's chat panel will treat an unset scope as "ask the user first".
  const scopeIsSet = scope.schedules !== null || scope.payroll !== null || scope.wfp !== null || scope.leave.range !== null;

  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-2xl space-y-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
          What the assistant will see
        </h4>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <OverviewTile
          icon={Building2}
          label="Stations"
          value={String(survey.stations.count)}
          hint={
            survey.stations.count > 0
              ? `${survey.stations.profiledCount} profiled (${profilePct}%)`
              : 'Add stations on Layout tab'
          }
        />
        <OverviewTile
          icon={Users}
          label="Employees"
          value={String(survey.employees.count)}
          hint={`${survey.employees.activeContractCount} active contracts`}
        />
        <OverviewTile
          icon={Clock}
          label="Shifts"
          value={String(survey.shifts.count)}
          hint={`${survey.shifts.workShiftCount} work-coded`}
        />
        <OverviewTile
          icon={Calendar}
          label="Schedules"
          value={scheduleSummary}
          hint={`${survey.schedules.monthCount} month${survey.schedules.monthCount === 1 ? '' : 's'}`}
          wide
        />
        <OverviewTile
          icon={FileSpreadsheet}
          label="Leave history"
          value={leaveSummary}
          hint="Computed from per-employee leave ranges"
          wide
        />
        <OverviewTile
          icon={Flag}
          label="Holidays"
          value={holidaySummary}
          hint={`Earliest → latest`}
          wide
        />
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Session scope</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {scopeIsSet
                ? 'Locked for this session. Click any pill to adjust.'
                : 'Not yet set. Click a pill to choose a window, or apply the suggested defaults.'}
            </p>
          </div>
          <ApplyDefaultScopeButton survey={survey} onApply={setScope} />
        </div>
        <ScopeBar scope={scope} onChange={setScope} survey={survey} />
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          WFP defaults to the active config year ({survey.wfp.defaultYear}). Pick any year — projections are computed from current employees + holidays at view time.
        </p>
      </div>
    </div>
  );
}

function OverviewTile({
  icon: Icon, label, value, hint, wide,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  wide?: boolean;
}) {
  return (
    <div className={`p-3 bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 rounded-lg ${wide ? 'sm:col-span-3' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-slate-400 dark:text-slate-500" />
        <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono">{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
    </div>
  );
}

// ─── Tool inspector (phase 3) ───────────────────────────────────────────

function ToolInspectorCard({ ctx, scope }: { ctx: ToolContext; scope: AiScope }) {
  const [selected, setSelected] = useState<string>('listAvailableData');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: unknown; tokens: number; verdict: BudgetVerdict } | null>(null);

  // Build args from the active scope when the chosen tool needs them.
  // Range-based tools fall back to `scope.schedules`. Leave tools split.
  const argsForTool = useMemo(() => {
    switch (selected) {
      case 'getSchedules':
      case 'getPayroll':
      case 'getCompliance': {
        if (!scope.schedules) return null;
        return { range: scope.schedules };
      }
      case 'getLeaveBalances':
        return { asOf: scope.leave.asOf };
      case 'getLeaveHistory': {
        if (!scope.leave.range) return null;
        return { from: scope.leave.range.from, to: scope.leave.range.to };
      }
      case 'getWFP':
        if (!scope.wfp) return null;
        return { year: scope.wfp.year };
      case 'getStationProfile':
        return { stationId: '__pick_a_station__' };
      default:
        return {};
    }
  }, [selected, scope]);

  const argsValid = argsForTool !== null && (
    selected !== 'getStationProfile' || argsForTool.stationId !== '__pick_a_station__'
  );

  const run = async () => {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const tool = TOOLS[selected];
      if (!tool) throw new Error(`No tool registered as ${selected}`);
      if (!argsForTool) throw new Error('Set the relevant scope window (above) first.');
      const out = await tool.run(argsForTool, ctx);
      setResult(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const verdictColors: Record<BudgetVerdict, string> = {
    comfortable: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40',
    soft: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 border-amber-200 dark:border-amber-500/40',
    hard: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200 border-rose-200 dark:border-rose-500/40',
    over: 'bg-rose-200 text-rose-900 dark:bg-rose-600/40 dark:text-rose-100 border-rose-300 dark:border-rose-500/60',
  };

  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-2xl space-y-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConicalIcon />
          <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
            Tool inspector
          </h4>
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Preview
          </span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 max-w-md">
          Run any read-only tool against your current scope to see what JSON the AI would receive. Helps verify scope before chat fires.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px] space-y-1">
          <label className="block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Tool</label>
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setResult(null); setError(null); }}
            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
          >
            {READ_ONLY_TOOL_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={run}
          disabled={running || !argsValid}
          className="apple-press px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RunIcon />}
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Args readout — pretty print so users see what's being passed. */}
      {argsForTool !== null && (
        <div className="space-y-1">
          <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Args (from scope)</p>
          <pre className="text-[10px] font-mono p-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-700/70 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">
{JSON.stringify(argsForTool, null, 2)}
          </pre>
          {selected === 'getStationProfile' && (
            <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold">
              The Tool Inspector doesn&apos;t pick a station for you. The chat panel will pass the right id when it ships in phase 4.
            </p>
          )}
        </div>
      )}
      {argsForTool === null && (
        <div className="p-3 bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
            Set the relevant scope window above (Schedules / Leave / WFP) before running this tool.
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 rounded-lg">
          <p className="text-[11px] font-bold text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${verdictColors[result.verdict]}`}>
              {result.verdict}
            </span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              ≈ {result.tokens.toLocaleString()} tokens
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              comfortable ≤ {TOKEN_BUDGET.comfortable.toLocaleString()} · soft ≤ {TOKEN_BUDGET.soft.toLocaleString()} · hard ≤ {TOKEN_BUDGET.hard.toLocaleString()}
            </span>
          </div>
          <pre className="text-[10px] font-mono p-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-700/70 rounded-lg overflow-x-auto max-h-96 overflow-y-auto text-slate-700 dark:text-slate-300">
{JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Tiny inline icons that don't justify a full lucide import.
function FlaskConicalIcon() {
  return (
    <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.31" /><path d="M14 9.3V1.99" /><path d="M8.5 2h7" /><path d="M14 9.3a6.5 6.5 0 1 1-4 0" /><path d="M5.52 16h12.96" />
    </svg>
  );
}
function RunIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ConsentDialog({
  open, onAccept, onDecline,
}: { open: boolean; onAccept: () => void; onDecline: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="AI data disclosure"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-6">
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3 text-center">
            Heads up: AI mode sends your data off-device
          </h3>
          <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed space-y-3">
            <p>
              When you use AI Services, the assistant sends scoped business data — schedules, payroll figures, station profiles for the period you choose — to <strong>OpenRouter</strong> and the model provider you pick. This data leaves your device.
            </p>
            <p>
              By default, the app asks providers <strong>not to use your data for training</strong> (you can change this in AI Settings). Other parts of this app remain local-first; only AI Services route data outside.
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Do not enable if your workplace data is not allowed to leave the device.
            </p>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={onDecline}
              className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onAccept}
              className="apple-press flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25"
            >
              I understand — enable AI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
