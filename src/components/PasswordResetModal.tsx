/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.9.0 — Self-service "Forgot password" flow.
 *
 * Opens from the Forgot-password link on LoginScreen. The user types their
 * email; we hand it to Firebase Auth's `sendPasswordResetEmail`, which
 * mails them a one-time link that lands on a Firebase-hosted page where
 * they choose a new password. Pre-v5.9 the only reset path was the SA's
 * "generate temp password" flow in the SuperAdmin → Users panel — which
 * required the SA to be reachable any time a user forgot their password.
 *
 * Sticky modal (per the v5.3.1 form-modal pattern): backdrop click does
 * NOT dismiss; only Esc / X / Cancel.
 *
 * UX notes:
 *  - We always show the same success message regardless of whether the
 *    email matched a real account, so the form can't be used as an account-
 *    enumeration oracle. Firebase already silently swallows "user-not-
 *    found" errors for the same reason; we treat the error code defensively.
 *  - `auth/invalid-email` is the one error we surface explicitly, since
 *    that's a typo the user can fix on the spot.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { getFirebaseAuth } from '../lib/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Optional — pre-fill the email field with whatever the user typed
      on the sign-in form so they don't retype it. */
  initialEmail?: string;
}

export function PasswordResetModal({ isOpen, onClose, initialEmail }: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEmail(initialEmail ?? '');
      setBusy(false);
      setError(null);
      setSent(false);
    }
  }, [isOpen, initialEmail]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const auth = await getFirebaseAuth();
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // Only surface invalid-email — every other error (including
      // user-not-found) folds into the generic success state to avoid
      // leaking which addresses have accounts.
      if (code === 'auth/invalid-email') {
        setError(t('passwordReset.error.invalidEmail'));
      } else if (code === 'auth/network-request-failed') {
        setError(t('passwordReset.error.network'));
      } else if (code === 'auth/too-many-requests') {
        setError(t('passwordReset.error.tooMany'));
      } else {
        // Treat as success (silent: real account or not, the user sees the
        // same outcome). Logging would be the right place to surface
        // unexpected codes — but we don't want to leak detail to the UI.
        setSent(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('passwordReset.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('passwordReset.title')}</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{t('passwordReset.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {sent ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200 leading-relaxed">{t('passwordReset.success.title')}</p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">{t('passwordReset.success.body')}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('passwordReset.success.help')}
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-sm font-bold uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-white transition-all shadow-md"
              >
                {t('passwordReset.success.done')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('passwordReset.body')}
            </p>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('passwordReset.field.email')}</label>
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                placeholder="you@example.com"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all uppercase tracking-widest"
              >
                {t('action.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy || !email}
                className={cn(
                  'px-6 py-2 rounded text-[11px] font-bold uppercase tracking-widest transition-all',
                  busy || !email
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md',
                )}
              >
                {busy ? t('passwordReset.sending') : t('passwordReset.send')}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
