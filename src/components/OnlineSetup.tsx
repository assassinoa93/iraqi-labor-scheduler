/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Online-mode onboarding screen.
 *
 * Two-step picker so the role question is always asked first (the user's
 * AIO mental model: "tell me who you are, then show me what fits"):
 *
 *   1. Role pick — Super-admin vs Admin/Supervisor.
 *   2. Action pick (per role) — saved databases at the top + actions
 *      relevant to the chosen role.
 *
 * Super-admin actions:
 *   - Set up a brand-new Firebase project (full wizard).
 *   - Connect to a project I already set up (returning super-admin —
 *     short paste form; service-account linking happens post-login in
 *     the Super Admin tab if needed).
 *
 * Admin/Supervisor action:
 *   - Join with a connection code (or paste a firebaseConfig).
 *
 * If a config is already saved, the `onCancel` button on every screen
 * returns the user to LoginScreen — i.e. they came here from "Switch /
 * add database" and decided not to add anything.
 */

import React, { useState } from 'react';
import {
  Cloud, ArrowLeft, AlertCircle, KeyRound, Sparkles, Link2,
  Database, Check, X, ShieldCheck, Users as UsersIcon,
  ExternalLink, Smartphone,
} from 'lucide-react';
import {
  setStoredConfig, parseAnyConfigInput, isConnectionCode, StoredFirebaseConfig,
  getStoredConfigs, setActiveStoredConfig, removeStoredConfig,
} from '../lib/firebaseConfigStorage';
import { clearMode } from '../lib/mode';
import { cn } from '../lib/utils';
import { SuperAdminWizard } from './Onboarding/SuperAdminWizard';
import { useConfirm } from './ConfirmModal';

type Role = 'super-admin' | 'user';
// `wizard` = fresh setup (super-admin first PC).
// `reconnect-wizard` = returning super-admin on a new PC; same wizard
//   component, mode='reconnect' so it skips project creation + account
//   creation and just walks through firebaseConfig + service-account link.
// `paste` = admin/supervisor join via connection code (no service account
//   needed for non-super-admin roles).
type Step = 'role' | 'super-actions' | 'user-actions' | 'wizard' | 'reconnect-wizard' | 'paste';

interface Props {
  onConfigured: () => void;
  onCancel?: () => void;
}

const FIELDS: Array<{ key: keyof StoredFirebaseConfig; label: string; required: boolean; placeholder: string }> = [
  { key: 'apiKey',           label: 'API key',             required: true,  placeholder: 'AIzaSy...' },
  { key: 'authDomain',       label: 'Auth domain',         required: true,  placeholder: 'your-project.firebaseapp.com' },
  { key: 'projectId',        label: 'Project ID',          required: true,  placeholder: 'your-project' },
  { key: 'appId',            label: 'App ID',              required: true,  placeholder: '1:123:web:abc' },
  { key: 'storageBucket',    label: 'Storage bucket',      required: false, placeholder: 'your-project.firebasestorage.app' },
  { key: 'messagingSenderId',label: 'Messaging sender ID', required: false, placeholder: '123456789012' },
];

const EMPTY_FIELDS: StoredFirebaseConfig = {
  apiKey: '', authDomain: '', projectId: '',
  storageBucket: '', messagingSenderId: '', appId: '',
};

export function OnlineSetup({ onConfigured, onCancel }: Props) {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role | null>(null);
  const [blob, setBlob] = useState('');
  const [fields, setFields] = useState<StoredFirebaseConfig>(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const stored = getStoredConfigs();
  const { confirm, slot: confirmSlot } = useConfirm();

  const switchToOffline = () => { clearMode(); location.reload(); };

  const pickRole = (r: Role) => {
    setRole(r);
    setStep(r === 'super-admin' ? 'super-actions' : 'user-actions');
  };

  const handleBlobChange = (value: string) => {
    setBlob(value);
    setError(null);
    const parsed = parseAnyConfigInput(value);
    if (parsed) setFields(parsed);
  };
  const blobIsConnectionCode = isConnectionCode(blob);

  const handleSavePaste = () => {
    setError(null);
    const missing = FIELDS.filter((f) => f.required && !fields[f.key].trim());
    if (missing.length) {
      setError(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    setStoredConfig({
      apiKey: fields.apiKey.trim(),
      authDomain: fields.authDomain.trim(),
      projectId: fields.projectId.trim(),
      storageBucket: fields.storageBucket.trim(),
      messagingSenderId: fields.messagingSenderId.trim(),
      appId: fields.appId.trim(),
    });
    onConfigured();
  };

  const handlePickSaved = (id: string) => { setActiveStoredConfig(id); onConfigured(); };
  const handleRemoveSaved = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Remove "${label}"?`,
      message: "This device will forget the connection. The Firebase project itself is not deleted.",
    });
    if (!ok) return;
    removeStoredConfig(id);
    forceTick((n) => n + 1);
  };

  // ── Step: role ─────────────────────────────────────────────────────────

  if (step === 'role') {
    return (
      <Frame onSwitchOffline={switchToOffline} onCancel={onCancel}>
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
            <Cloud className="w-7 h-7 text-blue-600 dark:text-blue-300" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">Connect Online</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Who are you signing in as?
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={() => pickRole('super-admin')}
            className="apple-press text-left p-7 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-xl transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mb-5 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25 transition-colors">
              <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-300" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 mb-1.5">Super-admin</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              You set up the database (or are setting it up now). Manages users, companies, audit log — full control.
            </p>
          </button>

          <button
            onClick={() => pickRole('user')}
            className="apple-press text-left p-7 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-5 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
              <UsersIcon className="w-6 h-6 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 mb-1.5">Admin or Supervisor</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Your super-admin invited you. They gave you a connection code (or a firebaseConfig) and your email + password.
            </p>
          </button>
        </div>
      </Frame>
    );
  }

  // ── Step: super-admin actions ──────────────────────────────────────────

  if (step === 'super-actions') {
    return (
      <Frame onBack={() => setStep('role')} onSwitchOffline={switchToOffline} onCancel={onCancel}>
        {confirmSlot}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-300" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">Super-admin</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Pick one of your saved databases, set up a new one, or connect to one you already have
          </p>
        </div>

        <SavedDatabasesList stored={stored} onPick={handlePickSaved} onRemove={handleRemoveSaved} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={() => setStep('wizard')}
            className="apple-press text-left p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-xl transition-all group"
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mb-4 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25 transition-colors">
              <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">Set up a new database</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              First time, or adding a different company / branch. The wizard walks you through Firebase project creation step by step.
            </p>
          </button>
          <button
            onClick={() => setStep('reconnect-wizard')}
            className="apple-press text-left p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
          >
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-4 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
              <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">Connect to a database I already set up</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Reconnecting from a new PC. A short wizard walks you through pasting your firebaseConfig (or a connection code from another machine) and linking a service-account JSON for this device — so User Management and admin tools work immediately.
            </p>
          </button>
        </div>
      </Frame>
    );
  }

  // ── Step: user actions (admin / supervisor) ────────────────────────────

  if (step === 'user-actions') {
    return (
      <Frame onBack={() => setStep('role')} onSwitchOffline={switchToOffline} onCancel={onCancel}>
        {confirmSlot}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
            <UsersIcon className="w-7 h-7 text-blue-600 dark:text-blue-300" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">Admin / Supervisor</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Pick a saved database, or paste the connection code your super-admin shared
          </p>
        </div>

        <SavedDatabasesList stored={stored} onPick={handlePickSaved} onRemove={handleRemoveSaved} />

        <button
          onClick={() => setStep('paste')}
          className="apple-press w-full text-left p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-4 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
            <Link2 className="w-5 h-5 text-blue-600 dark:text-blue-300" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">Join with a connection code</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Paste the connection code your super-admin shared with you. After saving you'll be asked to sign in with the email + password they gave you.
          </p>
        </button>
      </Frame>
    );
  }

  // ── Step: wizard (super-admin first-time) ──────────────────────────────

  if (step === 'wizard') {
    return (
      <SuperAdminWizard
        mode="fresh"
        onComplete={onConfigured}
        onCancel={() => setStep('super-actions')}
      />
    );
  }

  // ── Step: reconnect wizard (super-admin on a new PC) ───────────────────

  if (step === 'reconnect-wizard') {
    return (
      <SuperAdminWizard
        mode="reconnect"
        onComplete={onConfigured}
        onCancel={() => setStep('super-actions')}
      />
    );
  }

  // ── Step: paste (admin / supervisor joining via connection code) ───────

  const isSuperAdmin = role === 'super-admin';
  return (
    <Frame
      onBack={() => setStep(isSuperAdmin ? 'super-actions' : 'user-actions')}
      onSwitchOffline={switchToOffline}
      onCancel={onCancel}
    >
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
          <KeyRound className="w-7 h-7 text-blue-600 dark:text-blue-300" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">
          {isSuperAdmin ? 'Connect to your existing project' : 'Paste your connection'}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {isSuperAdmin
            ? 'Two ways to get the values you need to paste below'
            : 'A connection code from your super-admin, or a firebaseConfig'}
        </p>
      </div>

      {isSuperAdmin && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 mb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Where do I get the values?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 p-4 bg-emerald-50/50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">From your other PC (recommended)</p>
              </div>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                On the machine where you set up the project, sign in and open <strong>Settings → Generate connection code</strong>. Copy the <code className="font-mono">ils-connect:…</code> string and paste it below. One paste — done.
              </p>
            </div>

            <div className="space-y-2 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">From Firebase Console</p>
              </div>
              <ol className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-1 list-decimal list-inside">
                <li>Open <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-300 underline">console.firebase.google.com</a> and pick your project.</li>
                <li>Top right gear icon → <strong>Project settings</strong>.</li>
                <li>Scroll to <strong>Your apps</strong> → click your web app.</li>
                <li>Copy the <code className="font-mono">firebaseConfig</code> code block and paste it below.</li>
              </ol>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Either way, after saving you'll sign in with your existing email + password — your super_admin role is already on the Firebase project, so there's nothing to re-grant. To manage users from this PC, link your service-account JSON later from <strong>Super Admin → Connection</strong> (or <strong>Settings → Connected databases</strong>).
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-7 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Quick paste · connection code or full firebaseConfig
          </label>
          <textarea
            value={blob}
            onChange={(e) => handleBlobChange(e.target.value)}
            rows={6}
            placeholder={`ils-connect:eyJhcGlLZXkiOiJBSXph...\n\nor:\n\nconst firebaseConfig = {\n  apiKey: "AIzaSy...",\n  ...\n};`}
            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
          />
          {blobIsConnectionCode && fields.apiKey ? (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-300 leading-relaxed font-bold uppercase tracking-widest">
              ✓ Connection code recognized — fields filled below
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Paste a <code className="font-mono">ils-connect:</code> code, or a firebaseConfig block. Fields auto-fill.
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
            Or fill in manually
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  {f.label}{f.required && <span className="text-rose-500"> *</span>}
                </label>
                <input
                  type="text"
                  value={fields[f.key]}
                  onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
            <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
          </div>
        )}

        <button
          onClick={handleSavePaste}
          className="apple-press w-full py-3 rounded-lg text-xs font-bold uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-colors"
        >
          Save and continue
        </button>

        {!isSuperAdmin && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            <strong>Don't have a code yet?</strong> Ask your super-admin to open <strong>Settings → Generate connection code</strong> on their device and share the <code className="font-mono">ils-connect:…</code> string with you (Signal / WhatsApp / in person). They'll also need to create your account first from <strong>User Management → New user</strong>.
          </p>
        )}
      </div>

      <p className="mt-5 text-center text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed font-medium">
        These values are public client identifiers, not secrets. They're saved on this device only and persist across app restarts.
      </p>
    </Frame>
  );
}

// ── Saved databases list (shared between super-actions and user-actions) ──

function SavedDatabasesList({
  stored,
  onPick,
  onRemove,
}: {
  stored: ReturnType<typeof getStoredConfigs>;
  onPick: (id: string) => void;
  onRemove: (id: string, label: string) => void;
}) {
  if (stored.entries.length === 0) return null;
  return (
    <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Use a database you already saved
        </p>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {stored.entries.length} saved
        </span>
      </div>
      <div className="space-y-1.5">
        {stored.entries.map((e) => (
          <div
            key={e.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
              stored.active === e.id
                ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/40"
                : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
            )}
          >
            <button onClick={() => onPick(e.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <Database className={cn(
                "w-4 h-4 shrink-0",
                stored.active === e.id ? "text-blue-600 dark:text-blue-300" : "text-slate-500 dark:text-slate-400",
              )} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{e.label}</p>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">{e.config.projectId}</p>
              </div>
            </button>
            {stored.active === e.id && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-200 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Active
              </span>
            )}
            <button
              onClick={() => onRemove(e.id, e.label)}
              title="Remove from this device"
              className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page chrome ───────────────────────────────────────────────────────────

interface FrameProps {
  children: React.ReactNode;
  onBack?: () => void;
  onCancel?: () => void;
  onSwitchOffline: () => void;
}

function Frame({ children, onBack, onCancel, onSwitchOffline }: FrameProps) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="flex items-center justify-between mb-4 min-h-[24px]">
          {onBack ? (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Back
            </button>
          ) : <span />}
          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          )}
        </div>
        {children}
        <button
          onClick={onSwitchOffline}
          className="mt-6 w-full text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Switch to Offline Demo
        </button>
      </div>
    </div>
  );
}
