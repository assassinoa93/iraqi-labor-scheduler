/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.0 — Dashboard pending-action card.
 *
 * Two flavours, picked by `kind`:
 *   • 'awaiting-validation' — for managers (and admins as fallback).
 *     Lists submitted schedules in the user's scope.
 *   • 'awaiting-finalization' — for admins / super-admin.
 *     Lists locked schedules in the user's scope.
 *
 * Each row links to the schedule (parent owns `onJump` — typically jumps
 * the active tab to Schedule + sets the active company + month). Empty
 * state is "all caught up".
 */

import React from 'react';
import { format } from 'date-fns';
import { Inbox, ShieldCheck, ArrowRight } from 'lucide-react';
import type { ApprovalQueueRow } from '../../lib/useApprovalQueue';
import type { Company } from '../../types';
import { cn } from '../../lib/utils';

interface Props {
  kind: 'awaiting-validation' | 'awaiting-finalization';
  rows: ApprovalQueueRow[];
  companies: Company[];
  onJump: (companyId: string, yyyymm: string) => void;
}

export function PendingApprovalsCard({ kind, rows, companies, onJump }: Props) {
  const isValidation = kind === 'awaiting-validation';
  const Icon = isValidation ? Inbox : ShieldCheck;
  const title = isValidation
    ? 'Schedules awaiting your validation'
    : 'Schedules awaiting your finalization';
  const empty = isValidation
    ? 'No schedules waiting for your validation.'
    : 'No schedules waiting for finalization.';
  const tone = isValidation
    ? { ring: 'border-amber-200 dark:border-amber-500/30', icon: 'text-amber-600 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/10' }
    : { ring: 'border-blue-200 dark:border-blue-500/30', icon: 'text-blue-600 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/10' };

  const byId = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div className={cn(
      'rounded-2xl border bg-white dark:bg-slate-900 shadow-sm p-5 space-y-4',
      tone.ring,
    )}>
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tone.bg)}>
          <Icon className={cn('w-5 h-5', tone.icon)} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
          <p className="text-[10px] uppercase tracking-widest font-mono text-slate-400 dark:text-slate-500">
            {rows.length === 0 ? '0 pending' : `${rows.length} pending`}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => {
            const stamp = isValidation ? r.submittedAt : r.lockedAt;
            const stampBy = isValidation ? r.submittedBy : r.lockedBy;
            const stampLabel = stamp ? format(new Date(stamp), 'yyyy-MM-dd HH:mm') : '—';
            const monthLabel = (() => {
              const m = /^(\d{4})-(\d{2})$/.exec(r.yyyymm);
              if (!m) return r.yyyymm;
              return format(new Date(Number(m[1]), Number(m[2]) - 1, 1), 'MMMM yyyy');
            })();
            return (
              <li key={`${r.companyId}-${r.yyyymm}`} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {byId.get(r.companyId) ?? r.companyId} <span className="text-slate-400 dark:text-slate-500">·</span> {monthLabel}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    {isValidation ? 'Submitted' : 'Locked'} by{' '}
                    <span className="text-slate-700 dark:text-slate-200">{stampBy ?? 'unknown'}</span>
                    {' on '}
                    <span className="font-mono">{stampLabel}</span>
                  </p>
                </div>
                <button
                  onClick={() => onJump(r.companyId, r.yyyymm)}
                  className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-800 dark:hover:bg-slate-600 shadow-sm shrink-0"
                >
                  Review
                  <ArrowRight className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
