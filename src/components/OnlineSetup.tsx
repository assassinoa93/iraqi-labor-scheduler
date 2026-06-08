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
import { useI18n } from '../lib/i18n';
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

const FIELDS: Array<{ key: keyof StoredFirebaseConfig; labelKey: string; required: boolean; placeholder: string }> = [
  { key: 'apiKey',           labelKey: 'onlineSetup.field.apiKey',            required: true,  placeholder: 'AIzaSy...' },
  { key: 'authDomain',       labelKey: 'onlineSetup.field.authDomain',        required: true,  placeholder: 'your-project.firebaseapp.com' },
  { key: 'projectId',        labelKey: 'onlineSetup.field.projectId',         required: true,  placeholder: 'your-project' },
  { key: 'appId',            labelKey: 'onlineSetup.field.appId',             required: true,  placeholder: '1:123:web:abc' },
  { key: 'storageBucket',    labelKey: 'onlineSetup.field.storageBucket',     required: false, placeholder: 'your-project.firebasestorage.app' },
  { key: 'messagingSenderId',labelKey: 'onlineSetup.field.messagingSenderId', required: false, placeholder: '123456789012' },
];

const EMPTY_FIELDS: StoredFirebaseConfig = {
  apiKey: '', authDomain: '', projectId: '',
  storageBucket: '', messagingSenderId: '', appId: '',
};

export function OnlineSetup({ onConfigured, onCancel }: Props) {
  const { t } = useI18n();
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
      const labels = missing.map((f) => t(f.labelKey)).join(', ');
      setError(
        missing.length > 1
          ? t('onlineSetup.error.missingFields', { fields: labels })
          : t('onlineSetup.error.missingField', { fields: labels }),
      );
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
      title: t('onlineSetup.saved.removeTitle', { label }),
      message: t('onlineSetup.saved.removeMessage'),
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
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">{t('onlineSetup.role.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('onlineSetup.role.subtitle')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={() => pickRole('super-admin')}
            className="apple-press text-start p-7 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-xl transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mb-5 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25 transition-colors">
              <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-300" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 mb-1.5">{t('onlineSetup.role.superAdmin.title')}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('onlineSetup.role.superAdmin.desc')}
            </p>
          </button>

          <button
            onClick={() => pickRole('user')}
            className="apple-press text-start p-7 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-5 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
              <UsersIcon className="w-6 h-6 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 mb-1.5">{t('onlineSetup.role.user.title')}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('onlineSetup.role.user.desc')}
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
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">{t('onlineSetup.superActions.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('onlineSetup.superActions.subtitle')}
          </p>
        </div>

        <SavedDatabasesList stored={stored} onPick={handlePickSaved} onRemove={handleRemoveSaved} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={() => setStep('wizard')}
            className="apple-press text-start p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-xl transition-all group"
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mb-4 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25 transition-colors">
              <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">{t('onlineSetup.superActions.newDb.title')}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('onlineSetup.superActions.newDb.desc')}
            </p>
          </button>
          <button
            onClick={() => setStep('reconnect-wizard')}
            className="apple-press text-start p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
          >
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-4 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
              <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">{t('onlineSetup.superActions.reconnect.title')}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('onlineSetup.superActions.reconnect.desc')}
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
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">{t('onlineSetup.userActions.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('onlineSetup.userActions.subtitle')}
          </p>
        </div>

        <SavedDatabasesList stored={stored} onPick={handlePickSaved} onRemove={handleRemoveSaved} />

        <button
          onClick={() => setStep('paste')}
          className="apple-press w-full text-start p-6 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-4 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
            <Link2 className="w-5 h-5 text-blue-600 dark:text-blue-300" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">{t('onlineSetup.userActions.join.title')}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('onlineSetup.userActions.join.desc')}
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
          {isSuperAdmin ? t('onlineSetup.paste.title.super') : t('onlineSetup.paste.title.user')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {isSuperAdmin
            ? t('onlineSetup.paste.subtitle.super')
            : t('onlineSetup.paste.subtitle.user')}
        </p>
      </div>

      {isSuperAdmin && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 mb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {t('onlineSetup.paste.where.title')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 p-4 bg-emerald-50/50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">{t('onlineSetup.paste.where.otherPc.title')}</p>
              </div>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                {t('onlineSetup.paste.where.otherPc.before')}<strong>{t('onlineSetup.paste.where.otherPc.path')}</strong>{t('onlineSetup.paste.where.otherPc.mid')}<code className="font-mono">ils-connect:…</code>{t('onlineSetup.paste.where.otherPc.after')}
              </p>
            </div>

            <div className="space-y-2 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{t('onlineSetup.paste.where.console.title')}</p>
              </div>
              <ol className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-1 list-decimal list-inside">
                <li>{t('onlineSetup.paste.where.console.step1.before')}<a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-300 underline">console.firebase.google.com</a>{t('onlineSetup.paste.where.console.step1.after')}</li>
                <li>{t('onlineSetup.paste.where.console.step2.before')}<strong>{t('onlineSetup.paste.where.console.step2.path')}</strong>.</li>
                <li>{t('onlineSetup.paste.where.console.step3.before')}<strong>{t('onlineSetup.paste.where.console.step3.path')}</strong>{t('onlineSetup.paste.where.console.step3.after')}</li>
                <li>{t('onlineSetup.paste.where.console.step4.before')}<code className="font-mono">firebaseConfig</code>{t('onlineSetup.paste.where.console.step4.after')}</li>
              </ol>
            </div>
          </div>

          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('onlineSetup.paste.where.footer.before')}<strong>{t('onlineSetup.paste.where.footer.path1')}</strong>{t('onlineSetup.paste.where.footer.mid')}<strong>{t('onlineSetup.paste.where.footer.path2')}</strong>{t('onlineSetup.paste.where.footer.after')}
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-7 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {t('onlineSetup.paste.quickLabel')}
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
              {t('onlineSetup.paste.recognized')}
            </p>
          ) : (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('onlineSetup.paste.helper.before')}<code className="font-mono">ils-connect:</code>{t('onlineSetup.paste.helper.after')}
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
            {t('onlineSetup.paste.manualLabel')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  {t(f.labelKey)}{f.required && <span className="text-rose-500"> *</span>}
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
          {t('onlineSetup.paste.save')}
        </button>

        {!isSuperAdmin && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            <strong>{t('onlineSetup.paste.noCode.q')}</strong>{t('onlineSetup.paste.noCode.before')}<strong>{t('onlineSetup.paste.noCode.path1')}</strong>{t('onlineSetup.paste.noCode.mid')}<code className="font-mono">ils-connect:…</code>{t('onlineSetup.paste.noCode.mid2')}<strong>{t('onlineSetup.paste.noCode.path2')}</strong>{t('onlineSetup.paste.noCode.after')}
          </p>
        )}
      </div>

      <p className="mt-5 text-center text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
        {t('onlineSetup.paste.publicNote')}
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
  const { t } = useI18n();
  if (stored.entries.length === 0) return null;
  return (
    <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('onlineSetup.saved.title')}
        </p>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          {t('onlineSetup.saved.count', { n: stored.entries.length })}
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
            <button onClick={() => onPick(e.id)} className="flex items-center gap-3 flex-1 min-w-0 text-start">
              <Database className={cn(
                "w-4 h-4 shrink-0",
                stored.active === e.id ? "text-blue-600 dark:text-blue-300" : "text-slate-500 dark:text-slate-400",
              )} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{e.label}</p>
                <p className="text-[9px] text-slate-500 dark:text-slate-400 font-mono truncate">{e.config.projectId}</p>
              </div>
            </button>
            {stored.active === e.id && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-200 flex items-center gap-1">
                <Check className="w-3 h-3" />
                {t('onlineSetup.saved.active')}
              </span>
            )}
            <button
              onClick={() => onRemove(e.id, e.label)}
              title={t('onlineSetup.saved.removeTooltip')}
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
  const { t } = useI18n();
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
              {t('onlineSetup.frame.back')}
            </button>
          ) : <span />}
          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-3 h-3" />
              {t('onlineSetup.frame.cancel')}
            </button>
          )}
        </div>
        {children}
        <button
          onClick={onSwitchOffline}
          className="mt-6 w-full text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {t('onlineSetup.frame.switchOffline')}
        </button>
      </div>
    </div>
  );
}
