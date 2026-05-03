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
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS_FRESH: StepDef[] = [
  { id: 'project',        title: 'Create Firebase project',  icon: Database },
  { id: 'config',         title: 'Connect to project',       icon: KeyRound },
  { id: 'serviceAccount', title: 'Link service account',     icon: FilePlus2 },
  { id: 'account',        title: 'Create your account',      icon: ShieldCheck },
  { id: 'done',           title: 'All set',                  icon: CheckCircle2 },
];

const STEPS_RECONNECT: StepDef[] = [
  { id: 'config',         title: 'Connect to your project',  icon: KeyRound },
  { id: 'serviceAccount', title: 'Link service account',     icon: FilePlus2 },
  { id: 'done',           title: 'All set',                  icon: CheckCircle2 },
];

export function SuperAdminWizard({ onComplete, onCancel, mode = 'fresh' }: Props) {
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
          Cancel and go back
        </button>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <Stepper steps={STEPS} currentIdx={stepIdx} />

          <div className="p-8">
            <div className="mb-7">
              <h2 className="text-xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                {currentStep.title}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                Step {stepIdx + 1} of {STEPS.length}
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
          Switch to Offline Demo
        </button>
      </div>
    </div>
  );
}

function Stepper({ steps, currentIdx }: { steps: StepDef[]; currentIdx: number }) {
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
                {s.title}
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
  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
        Open Firebase Console in your browser and follow these steps. This is the only Console-only piece — everything else happens in this wizard.
      </p>

      <ol className="space-y-3 text-[12px] text-slate-700 dark:text-slate-300">
        <ListItem n={1}>
          Click <strong>Add project</strong>. Pick any name (e.g. "iraqi-labor-scheduler"). Skip Google Analytics.
        </ListItem>
        <ListItem n={2}>
          Sidebar → <strong>Build → Firestore Database → Create database</strong>. Pick the <strong>europe-west3</strong> region (Frankfurt — lowest latency from Iraq), then <strong>Production mode</strong>.
        </ListItem>
        <ListItem n={3}>
          Sidebar → <strong>Build → Authentication → Get started → Email/Password → Enable → Save</strong>. Then in <strong>Settings</strong> tab, uncheck <strong>Enable create (sign-up)</strong> and Save (so only you can add users).
        </ListItem>
      </ol>

      <a
        href="https://console.firebase.google.com"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Open Firebase Console
      </a>

      <div className="flex justify-end pt-3">
        <PrimaryNext onClick={onNext} label="I've finished — continue" />
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
      {mode === 'reconnect' ? (
        <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
          Two ways to bring your existing project's connection here. <strong>Recommended:</strong> on the PC where you set up the project, open <strong>Settings → Generate connection code</strong>, copy the <code className="font-mono">ils-connect:…</code> string, and paste it below — fields auto-fill. <strong>Otherwise:</strong> open{' '}
          <a
            href="https://console.firebase.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-baseline gap-1 text-blue-600 dark:text-blue-300 underline hover:no-underline font-medium"
          >
            Firebase Console
            <ExternalLink className="w-3 h-3 self-center" />
          </a>
          {' '}(<strong>gear icon → Project settings → Your apps → your web app</strong>) and copy the <code className="font-mono">firebaseConfig</code> block.
        </p>
      ) : (
        <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
          Open{' '}
          <a
            href="https://console.firebase.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-baseline gap-1 text-blue-600 dark:text-blue-300 underline hover:no-underline font-medium"
          >
            Firebase Console
            <ExternalLink className="w-3 h-3 self-center" />
          </a>
          {' '}(<strong>gear icon → Project settings → Your apps → click the &lt;/&gt; Web icon → register</strong>). Firebase shows a code block with <code className="font-mono">const firebaseConfig = &#123;&#125;</code> — copy the whole block and paste below.
        </p>
      )}

      <div className="space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          firebaseConfig (or ils-connect: code)
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
            ✓ Recognized: {parsed.projectId}{isConnectionCode(blob) && ' (from connection code)'}
          </p>
        )}
        {error && <p className="text-[10px] text-rose-600 dark:text-rose-300">{error}</p>}
      </div>

      <div className="flex justify-between pt-3">
        {onBack ? <SecondaryBack onClick={onBack} /> : <span />}
        <PrimaryNext
          disabled={!parsed}
          onClick={() => parsed ? onSave(parsed) : setError('Paste a valid firebaseConfig first')}
          label="Save and continue"
        />
      </div>
    </div>
  );
}

// ── Step 3: Link service-account JSON ────────────────────────────────────

function StepServiceAccount({ onNext, onBack, setError }: {
  onNext: () => void; onBack: () => void; setError: (m: string | null) => void;
}) {
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
      setError('Service-account linking requires the desktop app — not available in this build.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.linkServiceAccount();
      await refresh();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code !== 'CANCELLED') setError(err.message ?? 'Link failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
        Open the Service Accounts tab in{' '}
        <a
          href={serviceAccountsConsoleUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-baseline gap-1 text-blue-600 dark:text-blue-300 underline hover:no-underline font-medium"
        >
          Firebase Console
          <ExternalLink className="w-3 h-3 self-center" />
        </a>
        {' '}(<strong>gear icon → Project settings → Service accounts → Generate new private key → Generate key</strong>). A JSON file downloads. Click below to link it — the file stays only on your machine and is stored under a folder named after this project, so multi-database super-admins keep their projects cleanly separated.
      </p>

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
            ? 'Service account linked for this project. You can re-pick the file if you generated a new one.'
            : 'No service account linked yet for this project. Click below to pick the JSON file you just downloaded.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleLink}
          disabled={busy}
          className="apple-press px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60 flex items-center gap-2"
        >
          <FilePlus2 className="w-3 h-3" />
          {busy ? 'Linking…' : linked ? 'Re-link service account' : 'Link service account'}
        </button>
        <button
          onClick={refresh}
          disabled={busy}
          className="apple-press px-4 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60 flex items-center gap-2"
        >
          <RefreshCw className="w-3 h-3" />
          Re-check
        </button>
      </div>

      <div className="flex justify-between pt-3">
        <SecondaryBack onClick={onBack} />
        <PrimaryNext disabled={!linked} onClick={onNext} label="Continue" />
      </div>
    </div>
  );
}

// ── Step 4: Create super-admin account (in-app, via Admin SDK) ───────────

function StepAccount({ onComplete, onBack, setError }: {
  onComplete: () => void; onBack: () => void; setError: (m: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generateSuggestedPassword());
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — user can select+copy manually */ }
  };

  const handleCreate = async () => {
    if (!adminApi.isAvailable()) {
      setError('This step requires the desktop app — not available in this build.');
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    if (password.length < 6) {
      setError('Firebase requires passwords to be at least 6 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.bootstrapSuperAdminAccount({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setDone(true);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.message ?? 'Account creation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
        Create your super-admin account. The Admin SDK (using the service account you just linked) will create the Firebase Auth user AND grant the super_admin role in one step — no Console roundtrip required.
      </p>

      {done ? (
        <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-200 font-bold">
              Account created and super-admin role granted
            </p>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
              Email: <span className="font-mono">{email}</span>
            </p>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
              Click <strong>Finish</strong> to sign in.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </Field>
          <Field label="Password" required helper="At least 6 characters. Save this somewhere safe — you'll use it to sign in.">
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
                aria-label={copied ? 'Copied' : 'Copy password'}
                title={copied ? 'Copied' : 'Copy password'}
                className={cn(
                  "apple-press px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors",
                  copied
                    ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
                )}
              >
                {copied ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
              </button>
            </div>
          </Field>
          <Field label="Display name (optional)">
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
            {busy ? 'Creating…' : 'Create account + grant super-admin'}
          </button>
        </div>
      )}

      <div className="flex justify-between pt-3">
        <SecondaryBack onClick={onBack} />
        <PrimaryNext disabled={!done} onClick={onComplete} label="Finish setup" />
      </div>
    </div>
  );
}

// ── Step 5: Done ─────────────────────────────────────────────────────────

function StepDone({ mode, onSignIn }: { mode: WizardMode; onSignIn: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Setup complete</p>
          {mode === 'reconnect' ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
              Firebase project reconnected, service account linked for this PC. Sign in with your existing email + password and you'll have full super-admin access from this device.
            </p>
          ) : (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
              Firebase project connected, super-admin account created, service account linked. From now on you'll manage everything (users, companies, audit log) directly from the User Management and Super Admin tabs — Firebase Console is no longer needed for routine work.
            </p>
          )}
        </div>
      </div>

      {mode === 'reconnect' ? (
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">What's next</p>
          <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed list-disc list-inside">
            <li>Sign in with your existing super-admin email + password.</li>
            <li>User Management, Super Admin → Connection / Companies / Database, and audit-log retention will all work on this device immediately.</li>
          </ul>
        </div>
      ) : (
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">What's next</p>
          <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed list-disc list-inside">
            <li>Sign in with the email + password you just created.</li>
            <li>Open <strong>Settings → Generate connection code</strong> to share with your team.</li>
            <li>Open <strong>User Management → New user</strong> to create accounts for admins and supervisors. Each can be granted granular per-tab permissions.</li>
          </ul>
        </div>
      )}

      <div className="flex justify-end pt-3">
        <PrimaryNext onClick={onSignIn} label="Sign in" />
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
  return (
    <button
      onClick={onClick}
      className="apple-press px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
    >
      <ArrowLeft className="w-3 h-3" />
      Back
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
