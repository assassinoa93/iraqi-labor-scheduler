/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.4 / 3.6 — Super-admin onboarding wizard.
 *
 * Goal: take a fresh app install (or a returning super-admin's new PC) to
 * a fully-working Online setup with the fewest possible Console-only
 * detours. The only step that *must* happen in Firebase Console is
 * creating the project itself + enabling Firestore + Auth — Firebase
 * doesn't expose those operations to the Spark plan. Everything else
 * (user creation, super_admin claim, service-account link) happens
 * inside this wizard.
 *
 * Two modes:
 *
 *   • `mode='fresh'` (default) — first-time install on the first PC:
 *     1. Create Firebase project + enable Firestore + Auth (Console).
 *     2. Paste firebaseConfig.
 *     3. Link service-account JSON via native file picker.
 *     4. Create your super-admin account (email + password) — the Admin
 *        SDK creates the Auth user AND grants the super_admin claim
 *        atomically.
 *     5. Done — sign in.
 *
 *   • `mode='reconnect'` — returning super-admin on a NEW PC. The
 *     Firebase project + super-admin account already exist; we just need
 *     to re-establish the local connection AND re-link a service-account
 *     JSON for this device:
 *     1. Paste firebaseConfig (or an `ils-connect:` code from the other PC).
 *     2. Link service-account JSON for this PC.
 *     3. Done — sign in to the existing account.
 *
 * Without the reconnect mode, returning super-admins would land in the
 * SuperAdmin tab and hit "service account not linked" because nothing
 * had asked them to link it on the new device.
 *
 * The wizard reads/writes the same `setStoredConfig()` localStorage entry
 * as OnlineSetup so once it completes, AppShell's reload boots Online
 * mode normally.
 *
 * v5.16.0 — fully i18n'd. Pre-v5.16 every wizard string was hardcoded
 * English so an Arabic-locale super-admin saw English on every step
 * (then Arabic returned the moment they signed in). HTML-rich step
 * intros use dangerouslySetInnerHTML against translated strings — the
 * source HTML lives in the dictionary under our control, never user
 * input, so XSS isn't a risk.
 */

import React, { useEffect, useState } from 'react';
import {
  Sparkles, ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, FilePlus2,
  AlertCircle, KeyRound, ShieldCheck, Database, RefreshCw, Check, Copy,
} from 'lucide-react';
import {
  setStoredConfig, parseAnyConfigInput, isConnectionCode, StoredFirebaseConfig,
} from '../../lib/firebaseConfigStorage';
import * as adminApi from '../../lib/adminApi';
import { getActiveConfig } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { clearMode } from '../../lib/mode';
import { useI18n } from '../../lib/i18n';

function serviceAccountsConsoleUrl(): string {
  const projectId = getActiveConfig()?.projectId;
  return projectId
    ? `https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`
    : 'https://console.firebase.google.com/';
}

type WizardMode = 'fresh' | 'reconnect';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
  // Defaults to 'fresh'. Pass 'reconnect' for a returning super-admin
  // bringing their existing project to a new PC.
  mode?: WizardMode;
}

type StepId = 'project' | 'config' | 'serviceAccount' | 'account' | 'done';
interface StepDef {
  id: StepId;
  titleKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS_FRESH: StepDef[] = [
  { id: 'project',        titleKey: 'wizard.step.project',        icon: Database },
  { id: 'config',         titleKey: 'wizard.step.config',         icon: KeyRound },
  { id: 'serviceAccount', titleKey: 'wizard.step.serviceAccount', icon: FilePlus2 },
  { id: 'account',        titleKey: 'wizard.step.account',        icon: ShieldCheck },
  { id: 'done',           titleKey: 'wizard.step.done',           icon: CheckCircle2 },
];

const STEPS_RECONNECT: StepDef[] = [
  { id: 'config',         titleKey: 'wizard.step.configReconnect', icon: KeyRound },
  { id: 'serviceAccount', titleKey: 'wizard.step.serviceAccount',  icon: FilePlus2 },
  { id: 'done',           titleKey: 'wizard.step.done',            icon: CheckCircle2 },
];

export function SuperAdminWizard({ onComplete, onCancel, mode = 'fresh' }: Props) {
  const { t } = useI18n();
  const STEPS = mode === 'reconnect' ? STEPS_RECONNECT : STEPS_FRESH;
  const [stepIdx, setStepIdx] = useState(0);
  const [config, setConfig] = useState<StoredFirebaseConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStep = STEPS[stepIdx];

  const goNext = () => { setError(null); setStepIdx((i) => Math.min(i + 1, STEPS.length - 1)); };
  const goBack = () => { setError(null); setStepIdx((i) => Math.max(i - 1, 0)); };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-3xl w-full space-y-6">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          {t('wizard.cancel')}
        </button>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <Stepper steps={STEPS} currentIdx={stepIdx} />

          <div className="p-8">
            <div className="mb-7">
              <h2 className="text-xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                {t(currentStep.titleKey)}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                {t('wizard.stepCounter', { current: stepIdx + 1, total: STEPS.length })}
              </p>
            </div>

            {currentStep.id === 'project' && <StepProject onNext={goNext} />}

            {currentStep.id === 'config' && (
              <StepConfig
                mode={mode}
                initial={config}
                onSave={(cfg) => { setConfig(cfg); setStoredConfig(cfg); goNext(); }}
                onBack={stepIdx > 0 ? goBack : undefined}
              />
            )}

            {currentStep.id === 'serviceAccount' && (
              <StepServiceAccount onNext={goNext} onBack={goBack} setError={setError} />
            )}

            {currentStep.id === 'account' && (
              <StepAccount onComplete={goNext} onBack={goBack} setError={setError} />
            )}

            {currentStep.id === 'done' && (
              <StepDone mode={mode} onSignIn={onComplete} />
            )}

            {error && (
              <div className="mt-5 flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => { clearMode(); location.reload(); }}
          className="w-full text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {t('wizard.switchOffline')}
        </button>
      </div>
    </div>
  );
}

function Stepper({ steps, currentIdx }: { steps: StepDef[]; currentIdx: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center px-8 py-5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center gap-1.5 shrink-0 min-w-[64px]">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                done && "bg-emerald-500 text-white",
                active && "bg-blue-600 text-white shadow-md shadow-blue-500/30",
                !done && !active && "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500",
              )}>
                {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-widest text-center max-w-[80px] leading-tight",
                active ? "text-blue-700 dark:text-blue-300" : "text-slate-400 dark:text-slate-500",
              )}>
                {t(s.titleKey)}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                "h-px flex-1 mx-1 transition-colors min-w-[16px]",
                done ? "bg-emerald-400 dark:bg-emerald-500" : "bg-slate-200 dark:bg-slate-700",
              )} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Create Firebase project ──────────────────────────────────────

function StepProject({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
        {t('wizard.project.intro')}
      </p>

      <ol className="space-y-3 text-[12px] text-slate-700 dark:text-slate-300">
        <ListItem n={1}><span dangerouslySetInnerHTML={{ __html: t('wizard.project.step1.html') }} /></ListItem>
        <ListItem n={2}><span dangerouslySetInnerHTML={{ __html: t('wizard.project.step2.html') }} /></ListItem>
        <ListItem n={3}><span dangerouslySetInnerHTML={{ __html: t('wizard.project.step3.html') }} /></ListItem>
      </ol>

      <a
        href="https://console.firebase.google.com"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        {t('wizard.openConsole')}
      </a>

      <div className="flex justify-end pt-3">
        <PrimaryNext onClick={onNext} label={t('wizard.action.continue')} />
      </div>
    </div>
  );
}

// ── Step 2: Paste firebaseConfig ─────────────────────────────────────────

function StepConfig({ mode, initial, onSave, onBack }: {
  mode: WizardMode;
  initial: StoredFirebaseConfig | null;
  onSave: (cfg: StoredFirebaseConfig) => void;
  // Optional — undefined when 'config' is the first step (reconnect mode)
  // and there's nothing to go back to inside the wizard. The user can
  // still leave via the top-level "Cancel" button.
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [blob, setBlob] = useState('');
  const [parsed, setParsed] = useState<StoredFirebaseConfig | null>(initial);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (v: string) => {
    setBlob(v);
    setError(null);
    const p = parseAnyConfigInput(v);
    if (p) setParsed(p);
  };

  return (
    <div className="space-y-5">
      <p
        className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: t(mode === 'reconnect' ? 'wizard.config.reconnect.html' : 'wizard.config.fresh.html') }}
      />

      <div className="space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('wizard.config.label')}
        </label>
        <textarea
          value={blob}
          onChange={(e) => handleChange(e.target.value)}
          rows={6}
          placeholder={`const firebaseConfig = {\n  apiKey: "AIzaSy...",\n  authDomain: "your-project.firebaseapp.com",\n  projectId: "your-project",\n  ...\n};`}
          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {parsed && (
          <p className="text-[10px] text-emerald-600 dark:text-emerald-300 font-bold uppercase tracking-widest">
            {isConnectionCode(blob)
              ? t('wizard.config.recognized.code', { label: t('wizard.config.recognized', { projectId: parsed.projectId }) })
              : t('wizard.config.recognized', { projectId: parsed.projectId })}
          </p>
        )}
        {error && <p className="text-[10px] text-rose-600 dark:text-rose-300">{error}</p>}
      </div>

      <div className="flex justify-between pt-3">
        {onBack ? <SecondaryBack onClick={onBack} /> : <span />}
        <PrimaryNext
          disabled={!parsed}
          onClick={() => parsed ? onSave(parsed) : setError(t('wizard.config.invalid'))}
          label={t('wizard.action.saveContinue')}
        />
      </div>
    </div>
  );
}

// ── Step 3: Link service-account JSON ────────────────────────────────────

function StepServiceAccount({ onNext, onBack, setError }: {
  onNext: () => void; onBack: () => void; setError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!adminApi.isAvailable()) { setLinked(false); return; }
    try {
      const s = await adminApi.isLinked();
      setLinked(s.linked);
    } catch {
      setLinked(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleLink = async () => {
    if (!adminApi.isAvailable()) {
      setError(t('wizard.serviceAccount.error.notDesktop'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.linkServiceAccount();
      await refresh();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code !== 'CANCELLED') setError(err.message ?? t('wizard.serviceAccount.error.linkFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p
        className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: t('wizard.serviceAccount.intro.html', { url: serviceAccountsConsoleUrl() }) }}
      />

      <div className={cn(
        "flex items-start gap-3 p-4 rounded-xl border",
        linked
          ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30"
          : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700",
      )}>
        {linked
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
          : <FilePlus2 className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />}
        <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed">
          {linked
            ? t('wizard.serviceAccount.linked')
            : t('wizard.serviceAccount.notLinked')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleLink}
          disabled={busy}
          className="apple-press px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60 flex items-center gap-2"
        >
          <FilePlus2 className="w-3 h-3" />
          {busy ? t('wizard.serviceAccount.linking') : linked ? t('wizard.serviceAccount.relink') : t('wizard.serviceAccount.link')}
        </button>
        <button
          onClick={refresh}
          disabled={busy}
          className="apple-press px-4 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60 flex items-center gap-2"
        >
          <RefreshCw className="w-3 h-3" />
          {t('wizard.serviceAccount.recheck')}
        </button>
      </div>

      <div className="flex justify-between pt-3">
        <SecondaryBack onClick={onBack} />
        <PrimaryNext disabled={!linked} onClick={onNext} label={t('wizard.action.continueShort')} />
      </div>
    </div>
  );
}

// ── Step 4: Create super-admin account (in-app, via Admin SDK) ───────────

function StepAccount({ onComplete, onBack, setError }: {
  onComplete: () => void; onBack: () => void; setError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generateSuggestedPassword());
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  // v5.1.4 — outcome of the auto-rules-deploy that runs at the end of
  // bootstrapSuperAdminAccount. null = bootstrap not yet run, or the
  // server didn't return a rulesDeploy field (older bridge build).
  const [rulesDeployStatus, setRulesDeployStatus] = useState<adminApi.RulesDeployResult | null>(null);

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — user can select+copy manually */ }
  };

  const handleCreate = async () => {
    if (!adminApi.isAvailable()) {
      setError(t('wizard.account.error.notDesktop'));
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError(t('wizard.account.error.required'));
      return;
    }
    if (password.length < 6) {
      setError(t('wizard.account.error.tooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.bootstrapSuperAdminAccount({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      // v5.1.4 — capture the rules-deploy outcome from the bootstrap so
      // the wizard can show whether the Firestore rules landed cleanly.
      // A failed deploy isn't fatal (account is still created, super-
      // admin can sync from Database panel later) but the user should
      // know about it instead of finding out later when manager + super-
      // visor edits start hitting permission-denied.
      setRulesDeployStatus(res.rulesDeploy ?? null);
      setDone(true);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.message ?? t('wizard.account.error.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
        {t('wizard.account.intro')}
      </p>

      {done ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-200 font-bold">
                {t('wizard.account.success.title')}
              </p>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                {t('wizard.account.success.email', { email })}
              </p>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                {t('wizard.account.success.next', { finish: t('wizard.action.finish') })}
              </p>
            </div>
          </div>

          {/* v5.1.4 — surface the rules-deploy outcome that ran as part of
              the bootstrap. Success: confirm the rules landed. Failure:
              tell the user the account is fine but they need to retry
              the rules sync from Super Admin → Database after sign-in. */}
          {rulesDeployStatus && !rulesDeployStatus.error && (
            <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-300 mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="text-[11px] text-blue-700 dark:text-blue-200 font-bold">
                  {t('wizard.account.rules.success.title')}
                </p>
                <p className="text-[10px] text-blue-700 dark:text-blue-200/80 leading-relaxed">
                  {t('wizard.account.rules.success.body', { name: rulesDeployStatus.name })}
                </p>
              </div>
            </div>
          )}
          {rulesDeployStatus && rulesDeployStatus.error && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="text-[11px] text-amber-800 dark:text-amber-200 font-bold">
                  {t('wizard.account.rules.error.title')}
                </p>
                <p className="text-[10px] text-amber-700 dark:text-amber-200/80 leading-relaxed">
                  {rulesDeployStatus.error.message}
                </p>
                <p className="text-[10px] text-amber-700 dark:text-amber-200/80 leading-relaxed">
                  {t('wizard.account.rules.error.body')}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={t('wizard.account.field.email')} required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </Field>
          <Field label={t('wizard.account.field.password')} required helper={t('wizard.account.field.password.help')}>
            <div className="flex gap-2">
              <input
                type="text"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setCopied(false); }}
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <button
                type="button"
                onClick={handleCopyPassword}
                aria-label={copied ? t('wizard.account.copied') : t('wizard.account.copy')}
                title={copied ? t('wizard.account.copied') : t('wizard.account.copy')}
                className={cn(
                  "apple-press px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors",
                  copied
                    ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
                )}
              >
                {copied ? <><Check className="w-3 h-3" />{t('wizard.account.copied')}</> : <><Copy className="w-3 h-3" />{t('wizard.account.copy')}</>}
              </button>
            </div>
          </Field>
          <Field label={t('wizard.account.field.displayName')}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </Field>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="apple-press px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60 flex items-center gap-2"
          >
            <ShieldCheck className="w-3 h-3" />
            {busy ? t('wizard.account.creating') : t('wizard.account.create')}
          </button>
        </div>
      )}

      <div className="flex justify-between pt-3">
        <SecondaryBack onClick={onBack} />
        <PrimaryNext disabled={!done} onClick={onComplete} label={t('wizard.action.finish')} />
      </div>
    </div>
  );
}

// ── Step 5: Done ─────────────────────────────────────────────────────────

function StepDone({ mode, onSignIn }: { mode: WizardMode; onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">{t('wizard.done.title')}</p>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
            {mode === 'reconnect' ? t('wizard.done.body.reconnect') : t('wizard.done.body.fresh')}
          </p>
        </div>
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{t('wizard.done.next.title')}</p>
        <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed list-disc list-inside">
          {mode === 'reconnect' ? (
            <>
              <li>{t('wizard.done.next.reconnect.1')}</li>
              <li>{t('wizard.done.next.reconnect.2')}</li>
            </>
          ) : (
            <>
              <li>{t('wizard.done.next.fresh.1')}</li>
              <li dangerouslySetInnerHTML={{ __html: t('wizard.done.next.fresh.2.html') }} />
              <li dangerouslySetInnerHTML={{ __html: t('wizard.done.next.fresh.3.html') }} />
            </>
          )}
        </ul>
      </div>

      <div className="flex justify-end pt-3">
        <PrimaryNext onClick={onSignIn} label={t('wizard.action.signIn')} />
      </div>
    </div>
  );
}

// ── Common UI ────────────────────────────────────────────────────────────

function Field({ label, required, helper, children }: { label: string; required?: boolean; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {helper && <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">{helper}</p>}
    </div>
  );
}

function ListItem({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function PrimaryNext({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "apple-press px-5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-2 transition-colors",
        disabled
          ? "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed"
          : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20",
      )}
    >
      {label}
      <ArrowRight className="w-3 h-3" />
    </button>
  );
}

function SecondaryBack({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      className="apple-press px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
    >
      <ArrowLeft className="w-3 h-3" />
      {t('wizard.action.back')}
    </button>
  );
}

function generateSuggestedPassword(): string {
  // 14 alphanumeric chars from a confusable-free alphabet — short enough
  // to type by hand, long enough to be secure for the super-admin's first
  // login. They're encouraged to change it after.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Sparkles import remains so the wizard can swap icons later without an
// eslint warning when the placeholder usage is removed.
void Sparkles;
