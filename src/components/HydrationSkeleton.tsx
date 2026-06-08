import React from 'react';
import { useI18n } from '../lib/i18n';

// v5.38 — content-area placeholder shown in ONLINE mode while a company's
// first Firestore snapshot is still streaming in. Without it, returning users
// briefly saw empty states (0 employees, "no data") that read like data loss.
// Rendered as an overlay over the content area so the sidebar + header stay
// interactive (the user can still switch company / sign out). `animate-pulse`
// is automatically neutralised by the app's prefers-reduced-motion CSS.
const Block = ({ className = '' }: { className?: string }) => (
  <div className={`rounded-xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse ${className}`} />
);

export function HydrationSkeleton() {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-0 z-20 overflow-hidden bg-[#F3F4F6] dark:bg-[#0d1117] p-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t('app.hydrating')}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <Block className="h-7 w-56" />
          <Block className="h-7 w-32" />
        </div>
        {/* KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Block className="h-24" />
          <Block className="h-24" />
          <Block className="h-24" />
          <Block className="h-24" />
        </div>
        {/* Body card + rows */}
        <Block className="h-40" />
        <div className="space-y-2">
          <Block className="h-10" />
          <Block className="h-10" />
          <Block className="h-10" />
          <Block className="h-10" />
        </div>
        <p className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest pt-2">
          {t('app.hydrating')}
        </p>
      </div>
    </div>
  );
}
