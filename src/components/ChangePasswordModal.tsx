/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.9.0 — Self-service "Change my password" for the currently signed-in
 * user. Opened from SettingsTab.
 *
 * Flow:
 *   1. User enters current password (Firebase requires re-auth before
 *      sensitive operations like password change).
 *   2. We build an EmailAuthProvider credential and call
 *      reauthenticateWithCredential — fails fast with a clear error if
 *      the current password is wrong.
 *   3. On success, we call updatePassword with the new value. Sessions
 *      stay live (no auto-signout); Firebase rotates the auth token.
 *
 * Sticky modal per the v5.3.1 form-modal pattern.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { getFirebaseAuth } from '../lib/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const MIN_PASSWORD_LEN = 8;

export function ChangePasswordModal({ isOpen, onClose }: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setShowCurrent(false);
      setShowNew(false);
      setBusy(false);
      setError(null);
      setDone(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPwd.length < MIN_PASSWORD_LEN) {
      setError(t('changePassword.error.tooShort', { min: MIN_PASSWORD_LEN }));
      return;
    }
    if (newPwd !== confirmPwd) {
      setError(t('changePassword.error.mismatch'));
      return;
    }
    if (newPwd === currentPwd) {
      setError(t('changePassword.error.same'));
      return;
    }
    setBusy(true);
    try {
      const auth = await getFirebaseAuth();
      const user = auth.currentUser;
      if (!user || !user.email) {
        setError(t('changePassword.error.noUser'));
        return;
      }
      const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('firebase/auth');
      // Re-auth is mandatory before updatePassword; Firebase rejects the
      // direct call with auth/requires-recent-login otherwise. The
      // re-auth itself surfaces auth/wrong-password if the current
      // password is wrong, which we map to a friendly message below.
      const credential = EmailAuthProvider.credential(user.email, currentPwd);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPwd);
      setDone(true);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError(t('changePassword.error.wrongCurrent'));
      } else if (code === 'auth/weak-password') {
        setError(t('changePassword.error.weak'));
      } else if (code === 'auth/too-many-requests') {
        setError(t('changePassword.error.tooMany'));
      } else if (code === 'auth/network-request-failed') {
        setError(t('changePassword.error.network'));
      } else {
        setError(t('changePassword.error.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('changePassword.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('changePassword.title')}</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{t('changePassword.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {done ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200 leading-relaxed">{t('changePassword.success.title')}</p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">{t('changePassword.success.body')}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-sm font-bold uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-white transition-all shadow-md"
              >
                {t('changePassword.success.done')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            <PasswordField
              label={t('changePassword.field.current')}
              autoComplete="current-password"
              value={currentPwd}
              onChange={setCurrentPwd}
              show={showCurrent}
              onToggleShow={() => setShowCurrent(v => !v)}
              autoFocus
            />
            <PasswordField
              label={t('changePassword.field.new', { min: MIN_PASSWORD_LEN })}
              autoComplete="new-password"
              value={newPwd}
              onChange={setNewPwd}
              show={showNew}
              onToggleShow={() => setShowNew(v => !v)}
            />
            <PasswordField
              label={t('changePassword.field.confirm')}
              autoComplete="new-password"
              value={confirmPwd}
              onChange={setConfirmPwd}
              show={showNew}
              onToggleShow={() => setShowNew(v => !v)}
            />
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
                disabled={busy || !currentPwd || !newPwd || !confirmPwd}
                className={cn(
                  'px-6 py-2 rounded text-[11px] font-bold uppercase tracking-widest transition-all',
                  busy || !currentPwd || !newPwd || !confirmPwd
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md',
                )}
              >
                {busy ? t('changePassword.updating') : t('changePassword.update')}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, onToggleShow, autoComplete, autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full ps-4 pe-11 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
