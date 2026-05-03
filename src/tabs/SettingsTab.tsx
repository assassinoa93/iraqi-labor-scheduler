import React from 'react';
import { Download, Upload, LogOut, Repeat, KeyRound, Link2, Copy, Check, Database, Plus, Pencil, X } from 'lucide-react';
import { Config } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import {
  clearStoredConfig, getStoredConfig, encodeConnectionCode,
  getStoredConfigs, setActiveStoredConfig, removeStoredConfig, renameStoredConfig,
} from '../lib/firebaseConfigStorage';
import { getActiveConfig } from '../lib/firebase';
import { useConfirm } from '../components/ConfirmModal';

interface SettingsTabProps {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onFactoryReset: () => void;
  // Online-mode session controls. Wired from App.tsx via useAuth().
  // In Offline mode these are not rendered (isAuthenticated === false).
  isAuthenticated?: boolean;
  onSignOut?: () => Promise<void> | void;
  onSwitchMode?: () => void;
  // Whether destructive actions (factory reset, import backup) are available.
  // True for super_admin and for offline mode; false for admin/supervisor.
  allowDestructive?: boolean;
}

// v2.1.4 — short DOW labels via i18n. Pre-2.1.4 these were hardcoded
// English; the chips stayed English even with the UI in Arabic.
const DAY_KEYS = [
  'common.day.short.sunday',
  'common.day.short.monday',
  'common.day.short.tuesday',
  'common.day.short.wednesday',
  'common.day.short.thursday',
  'common.day.short.friday',
  'common.day.short.saturday',
];

export function SettingsTab({
  config, setConfig,
  onExportBackup, onImportBackup, onFactoryReset,
  isAuthenticated, onSignOut, onSwitchMode,
  allowDestructive = true,
}: SettingsTabProps) {
  const { t } = useI18n();
  const [signingOut, setSigningOut] = React.useState(false);
  const [connectionCode, setConnectionCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const handleSignOut = async () => {
    if (!onSignOut) return;
    setSigningOut(true);
    try { await onSignOut(); } finally { setSigningOut(false); }
  };
  const handleGenerateConnectionCode = () => {
    const cfg = getActiveConfig();
    if (!cfg) return;
    setConnectionCode(encodeConnectionCode(cfg));
    setCopied(false);
  };
  const handleCopyConnectionCode = async () => {
    if (!connectionCode) return;
    try {
      await navigator.clipboard.writeText(connectionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select-all so user can Ctrl+C manually
    }
  };
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight mb-1">{t('settings.title')}</h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">{t('settings.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('settings.peakDays')}</label>
          <div className="flex gap-2 flex-wrap">
            {DAY_KEYS.map((dayKey, idx) => {
              const dayNum = idx + 1;
              const isSelected = config.peakDays.includes(dayNum);
              return (
                <button
                  key={dayKey}
                  onClick={() => {
                    setConfig(prev => ({
                      ...prev,
                      peakDays: isSelected
                        ? prev.peakDays.filter(d => d !== dayNum)
                        : [...prev.peakDays, dayNum],
                    }));
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                    isSelected
                      ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600",
                  )}
                >
                  {t(dayKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('settings.complianceOverview')}</label>
          <div className="p-4 bg-emerald-50/50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold uppercase leading-tight">{t('settings.coverageActive')}</p>
            <p className="text-[9px] text-emerald-600 dark:text-emerald-300/80 font-medium">{t('settings.coverageNote')}</p>
          </div>
        </div>
      </div>

      <div className="pt-8 border-t border-slate-100 dark:border-slate-700/60 flex justify-between items-center flex-wrap gap-4">
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('settings.dbSecurity')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-tighter">{t('settings.instance')}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button onClick={onExportBackup} className="apple-press px-6 py-2 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/25 font-mono flex items-center gap-2">
            <Download className="w-3 h-3" />
            {t('settings.exportBackup')}
          </button>
          {allowDestructive && (
            <>
              <button onClick={onImportBackup} className="apple-press px-6 py-2 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-200 border border-blue-100 dark:border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-100 dark:hover:bg-blue-500/25 font-mono flex items-center gap-2">
                <Upload className="w-3 h-3" />
                {t('settings.importBackup')}
              </button>
              <button onClick={onFactoryReset} className="apple-press px-6 py-2 bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-200 border border-red-100 dark:border-red-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 dark:hover:bg-red-500/25 font-mono">
                {t('settings.factoryReset')}
              </button>
            </>
          )}
        </div>
      </div>

      {(isAuthenticated || onSwitchMode) && (
        <div className="pt-8 border-t border-slate-100 dark:border-slate-700/60">
          <div className="space-y-1 mb-4">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Session</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-tighter">
              Sign out or switch between Offline Demo and Online modes
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {isAuthenticated && onSignOut && (
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className={cn(
                  "apple-press px-6 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-800 font-mono flex items-center gap-2",
                  signingOut && "opacity-60 cursor-wait",
                )}
              >
                <LogOut className="w-3 h-3" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            )}
            {onSwitchMode && (
              <button
                onClick={onSwitchMode}
                className="apple-press px-6 py-2 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border border-amber-100 dark:border-amber-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-amber-100 dark:hover:bg-amber-500/25 font-mono flex items-center gap-2"
              >
                <Repeat className="w-3 h-3" />
                Switch mode (reload)
              </button>
            )}
            {/* Show "Relink Firebase config" only when a runtime-pasted config
                exists. If the config came from .env.local at build time,
                clearing localStorage wouldn't change anything — so hide the
                button and avoid the confusion. */}
            {isAuthenticated && getStoredConfig() && (
              <button
                onClick={() => {
                  clearStoredConfig();
                  if (onSignOut) {
                    void Promise.resolve(onSignOut()).finally(() => location.reload());
                  } else {
                    location.reload();
                  }
                }}
                className="apple-press px-6 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-800 font-mono flex items-center gap-2"
              >
                <KeyRound className="w-3 h-3" />
                Relink Firebase config
              </button>
            )}
            {isAuthenticated && getActiveConfig() && (
              <button
                onClick={handleGenerateConnectionCode}
                className="apple-press px-6 py-2 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border border-blue-100 dark:border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-100 dark:hover:bg-blue-500/25 font-mono flex items-center gap-2"
              >
                <Link2 className="w-3 h-3" />
                Generate connection code
              </button>
            )}
          </div>
          {isAuthenticated && (
            <ConnectedDatabases onSignOut={onSignOut} />
          )}
          {connectionCode && (
            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Connection code · share via Signal / WhatsApp / in-person
                </p>
                <button
                  onClick={handleCopyConnectionCode}
                  className={cn(
                    "apple-press px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors",
                    copied
                      ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30"
                      : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
                  )}
                >
                  {copied ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                </button>
              </div>
              <textarea
                readOnly
                value={connectionCode}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 break-all"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Recipients paste this on the "Connect Online" → "Join with a connection code" screen.
                Contains your team's Firebase project identifiers (public client IDs, not secrets).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Connected databases — multi-Firebase-project switcher.
 *
 * Lets a super-admin who manages several companies/branches keep one app
 * install pointed at multiple Firebase projects, switching between them
 * without re-pasting credentials. Switching reloads the page so the cached
 * Firebase SDK singletons get rebuilt against the new project.
 *
 * "Add another database" signs the user out and reloads — AppShell sees
 * `forceSetup=false` but no signed-in user, so it routes to LoginScreen,
 * which has a "Switch / add database" button to reach OnlineSetup.
 *
 * (We can't directly route to OnlineSetup from here because it would
 * unmount the AuthProvider mid-render, which is messy. Sign-out + reload
 * is cleaner and matches existing patterns.)
 */
function ConnectedDatabases({ onSignOut }: { onSignOut?: () => Promise<void> | void }) {
  const [tick, setTick] = React.useState(0);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const stored = React.useMemo(() => getStoredConfigs(), [tick]);
  const refresh = () => setTick((t) => t + 1);
  const { confirm, slot: confirmSlot } = useConfirm();

  const handleSwitch = async (id: string) => {
    if (id === stored.active) return;
    const ok = await confirm({
      title: 'Switch active database?',
      message: "This will reload the app and you'll need to sign in to the other project.",
    });
    if (!ok) return;
    setActiveStoredConfig(id);
    if (onSignOut) {
      try { await onSignOut(); } catch { /* ignore */ }
    }
    location.reload();
  };

  const handleRemove = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Remove "${label}"?`,
      message: "This device will forget the connection. The Firebase project itself is not deleted.",
    });
    if (!ok) return;
    const wasActive = stored.active === id;
    removeStoredConfig(id);
    refresh();
    if (wasActive) {
      // Active was removed — sign out + reload so AppShell re-routes.
      if (onSignOut) {
        void Promise.resolve(onSignOut()).finally(() => location.reload());
      } else {
        location.reload();
      }
    }
  };

  const handleAddAnother = async () => {
    const ok = await confirm({
      title: 'Add another database?',
      message: "You'll be signed out and taken to the database picker, where you can run the wizard or paste a connection code.",
    });
    if (!ok) return;
    if (onSignOut) {
      try { await onSignOut(); } catch { /* ignore */ }
    }
    // Sign-out leaves AuthProvider's user as null → AppShell renders
    // LoginScreen, which has the "Switch / add database" button.
    location.reload();
  };

  const startRename = (id: string, currentLabel: string) => {
    setRenaming(id);
    setRenameValue(currentLabel);
  };
  const commitRename = () => {
    if (renaming && renameValue.trim()) {
      renameStoredConfig(renaming, renameValue.trim());
    }
    setRenaming(null);
    setRenameValue('');
    refresh();
  };

  if (stored.entries.length === 0) {
    // The user is signed in but no saved entries? Means the active config
    // came from .env.local at build time. Show a simple add-another CTA.
    return (
      <>
        <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            Your active Firebase config came from <code>.env.local</code> at build time, not from in-app paste. To switch databases, edit <code>.env.local</code> and restart.
          </p>
        </div>
        {confirmSlot}
      </>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Connected databases
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            {stored.entries.length} saved · switch between Firebase projects
          </p>
        </div>
        <button
          onClick={handleAddAnother}
          className="apple-press px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-emerald-100 dark:hover:bg-emerald-500/25 flex items-center gap-1.5"
        >
          <Plus className="w-3 h-3" />
          Add another database
        </button>
      </div>

      <div className="border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {stored.entries.map((e) => (
          <div
            key={e.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 transition-colors",
              stored.active === e.id
                ? "bg-blue-50/50 dark:bg-blue-500/10"
                : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40",
            )}
          >
            <Database className={cn(
              "w-4 h-4 shrink-0",
              stored.active === e.id ? "text-blue-600 dark:text-blue-300" : "text-slate-400 dark:text-slate-500",
            )} />
            {renaming === e.id ? (
              <form
                onSubmit={(ev) => { ev.preventDefault(); commitRename(); }}
                className="flex-1 flex gap-2"
              >
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  onChange={(ev) => setRenameValue(ev.target.value)}
                  className="flex-1 px-2 py-1 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button type="submit" className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold uppercase tracking-widest">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setRenaming(null); setRenameValue(''); }}
                  className="px-2 py-1 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold uppercase tracking-widest"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{e.label}</p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">{e.config.projectId}</p>
                </div>
                {stored.active === e.id ? (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-200 flex items-center gap-1 shrink-0">
                    <Check className="w-3 h-3" />
                    Active
                  </span>
                ) : (
                  <button
                    onClick={() => handleSwitch(e.id)}
                    className="apple-press px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold uppercase tracking-widest font-mono"
                  >
                    Switch
                  </button>
                )}
                <button
                  onClick={() => startRename(e.id, e.label)}
                  title="Rename"
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleRemove(e.id, e.label)}
                  title="Remove from this device"
                  className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {confirmSlot}
    </div>
  );
}
