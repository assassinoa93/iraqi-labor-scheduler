/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email + password login for Online mode. Sessions persist via the SDK's
 * default browserLocalPersistence (set in lib/firebase.ts), so this screen
 * is shown only when there's no signed-in user.
 */

import React, { useState } from 'react';
import { Cloud, AlertCircle, Database, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { clearMode } from '../lib/mode';
import { cn } from '../lib/utils';
import { getActiveStoredEntry } from '../lib/firebaseConfigStorage';
import { PasswordResetModal } from './PasswordResetModal';
import { useI18n } from '../lib/i18n';

interface Props {
  // Fired when the user wants to switch to a different Firebase project or
  // add a new one. AppShell flips its forceSetup flag and re-routes to
  // OnlineSetup so the user can pick / add / relink.
  onSwitchDatabase?: () => void;
}

export function LoginScreen({ onSwitchDatabase }: Props) {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const activeEntry = getActiveStoredEntry();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v5.9.0 — self-service password reset modal. Pre-v5.9 the only reset
  // path was the SA generating a temp password in the SuperAdmin panel
  // and sharing it out-of-band, which left users locked out whenever
  // the SA was unreachable. The modal hands the email to Firebase Auth's
  // sendPasswordResetEmail, which mails them a one-time link.
  const [resetOpen, setResetOpen] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      // Firebase Auth error codes are stable; map the common ones to
      // localised strings via t(). v5.16.0 — pre-v5.16 these were
      // hardcoded English literals so Arabic-locale users got English
      // errors on every failed sign-in.
      const msg = code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
        ? t('login.error.invalidCredentials')
        : code === 'auth/user-disabled'
          ? t('login.error.userDisabled')
          : code === 'auth/too-many-requests'
            ? t('login.error.tooManyRequests')
            : code === 'auth/network-request-failed'
              ? t('login.error.networkFailed')
              : (err?.message ?? t('login.error.generic'));
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const switchToOffline = () => {
    clearMode();
    location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
            <Cloud className="w-7 h-7 text-blue-600 dark:text-blue-300" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">{t('login.title')}</h1>
          {activeEntry ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center justify-center gap-1.5">
              <Database className="w-3 h-3" />
              <span className="font-bold text-slate-700 dark:text-slate-200">{activeEntry.label}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t('login.subtitle')}
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 space-y-5 shadow-sm">
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('login.field.email')}</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('login.field.password')}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full ps-4 pe-11 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('login.password.hide') : t('login.password.show')}
                title={showPassword ? t('login.password.hide') : t('login.password.show')}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
              <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className={cn(
              "apple-press w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
              busy || !email || !password
                ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
            )}
          >
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
          {/* v5.9.0 — self-service "Forgot password" entry point. Routes
              through Firebase Auth's sendPasswordResetEmail; SA no longer
              has to be in the loop for routine resets. */}
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="block mx-auto text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
          >
            {t('login.forgot')}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-3">
          {onSwitchDatabase && (
            <button
              onClick={onSwitchDatabase}
              className="apple-press inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-mono"
            >
              <Database className="w-3 h-3" />
              {t('login.switchDatabase')}
            </button>
          )}
          <button
            onClick={switchToOffline}
            className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            {t('login.switchOffline')}
          </button>
        </div>
      </div>
      <PasswordResetModal
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        initialEmail={email}
      />
    </div>
  );
}
