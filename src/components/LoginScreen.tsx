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

interface Props {
  // Fired when the user wants to switch to a different Firebase project or
  // add a new one. AppShell flips its forceSetup flag and re-routes to
  // OnlineSetup so the user can pick / add / relink.
  onSwitchDatabase?: () => void;
}

export function LoginScreen({ onSwitchDatabase }: Props) {
  const { signIn } = useAuth();
  const activeEntry = getActiveStoredEntry();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      // Firebase Auth error codes are stable; map the common ones to readable text.
      const msg = code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
        ? 'Email or password is incorrect.'
        : code === 'auth/user-disabled'
          ? 'This account has been disabled. Contact your super-admin.'
          : code === 'auth/too-many-requests'
            ? 'Too many attempts — try again in a few minutes.'
            : code === 'auth/network-request-failed'
              ? 'No connection. Check internet and retry.'
              : (err?.message ?? 'Sign-in failed.');
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
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-1">Sign in</h1>
          {activeEntry ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center justify-center gap-1.5">
              <Database className="w-3 h-3" />
              <span className="font-bold text-slate-700 dark:text-slate-200">{activeEntry.label}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Iraqi Labor Scheduler · Online mode
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 space-y-5 shadow-sm">
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Email</label>
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
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Password</label>
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
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-3">
          {onSwitchDatabase && (
            <button
              onClick={onSwitchDatabase}
              className="apple-press inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-mono"
            >
              <Database className="w-3 h-3" />
              Switch / add database
            </button>
          )}
          <button
            onClick={switchToOffline}
            className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Switch to Offline Demo
          </button>
        </div>
      </div>
    </div>
  );
}
