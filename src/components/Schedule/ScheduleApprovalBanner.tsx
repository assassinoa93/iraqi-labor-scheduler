/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.0 — Top-of-grid banner showing the schedule's approval state.
 *
 * One banner per Schedule-tab render, keyed off `approval.status`. Colour
 * + icon + copy + primary action all change with the state. The banner
 * also surfaces send-back notes (when in `rejected`) so the supervisor
 * sees exactly why their schedule came back.
 *
 * Action buttons are passed in as props from the parent (the parent owns
 * the modal-open state for the Submit / Lock / Save / Send-back / Reopen
 * flows). This component is purely presentational + status-aware.
 */

import React from 'react';
import { format } from 'date-fns';
import {
  CheckCircle2, AlertTriangle, ShieldCheck, Lock as LockIcon,
  Send, Inbox, Undo2, ArrowLeft, ArrowRight, Pencil,
} from 'lucide-react';
import type { ApprovalBlock, ApprovalStatus } from '../../lib/firestoreSchedules';
import type { Role } from '../../lib/auth';
import { availableActionsFor } from '../../lib/scheduleApproval';
import { cn } from '../../lib/utils';

interface Props {
  /** Active approval block from the schedule doc; missing/undefined = draft. */
  approval: ApprovalBlock | undefined;
  /** Active month label, e.g. "April 2026 — Iraqi Mall, Branch A". */
  monthLabel: string;
  /** Current user's role. Drives which action buttons render. */
  role: Role | null;
  /** Whether the writer-side toolbar action gate is true (tabWritable). */
  canWriteSchedule: boolean;

  // Action handlers — only those relevant to the current state need fire.
  onSubmit?: () => void;          // visible in draft / rejected for supervisor
  onLock?: () => void;            // visible in submitted for manager+
  onSendBack?: () => void;        // visible in submitted (manager) / locked (admin)
  onSave?: () => void;            // visible in locked for admin+
  onReopen?: () => void;          // visible in saved for admin+
}

// Convert any of {Date | Timestamp | number} into a human-readable label.
// Firestore Timestamp ducks expose toMillis(); fall back through seconds.
function formatStamp(stamp: unknown): string {
  if (!stamp) return '—';
  const t = stamp as { toMillis?: () => number; seconds?: number };
  let ms: number | null = null;
  if (typeof t.toMillis === 'function') ms = t.toMillis();
  else if (typeof t.seconds === 'number') ms = t.seconds * 1000;
  else if (typeof stamp === 'number') ms = stamp;
  return ms ? format(new Date(ms), 'yyyy-MM-dd HH:mm') : '—';
}

export function ScheduleApprovalBanner({
  approval, monthLabel, role, canWriteSchedule,
  onSubmit, onLock, onSendBack, onSave, onReopen,
}: Props) {
  const status: ApprovalStatus = approval?.status ?? 'draft';
  const actions = availableActionsFor(status, role);

  // Hide the banner entirely in pristine draft state when offline mode
  // (role===null) — no workflow there, the existing UI is unchanged.
  if (role === null && status === 'draft') return null;

  const config = bannerConfigFor(status, approval);

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 mb-5 shadow-sm flex items-start gap-3',
        config.bg, config.border,
      )}
    >
      <config.Icon className={cn('w-5 h-5 mt-0.5 shrink-0', config.iconColor)} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className={cn('text-sm font-bold', config.titleColor)}>
            {config.title}
          </p>
          <p className={cn('text-[11px] font-medium', config.subColor)}>
            · {monthLabel}
          </p>
        </div>

        {config.bodyLines.length > 0 && (
          <div className={cn('text-[11px] leading-relaxed space-y-0.5', config.bodyColor)}>
            {config.bodyLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}

        {/* Send-back reason — only when in rejected state */}
        {status === 'rejected' && approval?.rejectedNotes && (
          <div className={cn('mt-2 p-2.5 rounded-lg text-[11px] leading-relaxed', config.notesBg)}>
            <span className="font-bold uppercase tracking-widest text-[9px] block mb-1 opacity-80">
              {approval.rejectedFrom === 'admin' ? 'Returned by admin' : 'Returned by manager'}
            </span>
            <p className="italic">{approval.rejectedNotes}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {actions.canSubmit && canWriteSchedule && onSubmit && (
            <button
              onClick={onSubmit}
              className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              {status === 'rejected' ? <Undo2 className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              {status === 'rejected' ? 'Resubmit' : 'Submit for approval'}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          {actions.canLock && onLock && (
            <button
              onClick={onLock}
              className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              <ShieldCheck className="w-3 h-3" />
              Lock — manager-validate
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          {actions.canSave && onSave && (
            <button
              onClick={onSave}
              className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              <LockIcon className="w-3 h-3" />
              Save &amp; finalize
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          {actions.canSendBack && onSendBack && (
            <button
              onClick={onSendBack}
              className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              <ArrowLeft className="w-3 h-3" />
              Send back
            </button>
          )}
          {actions.canReopen && onReopen && (
            <button
              onClick={onReopen}
              className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              <Pencil className="w-3 h-3" />
              Reopen for editing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface BannerConfig {
  Icon: React.ComponentType<{ className?: string }>;
  bg: string;
  border: string;
  iconColor: string;
  titleColor: string;
  subColor: string;
  bodyColor: string;
  notesBg: string;
  title: string;
  bodyLines: string[];
}

function bannerConfigFor(status: ApprovalStatus, approval: ApprovalBlock | undefined): BannerConfig {
  switch (status) {
    case 'draft':
      return {
        Icon: Pencil,
        bg: 'bg-slate-50 dark:bg-slate-800/40',
        border: 'border-slate-200 dark:border-slate-700',
        iconColor: 'text-slate-500 dark:text-slate-400',
        titleColor: 'text-slate-800 dark:text-slate-100',
        subColor: 'text-slate-500 dark:text-slate-400',
        bodyColor: 'text-slate-600 dark:text-slate-300',
        notesBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300',
        title: 'Draft schedule',
        bodyLines: ['Edit cells freely, then submit for approval when ready.'],
      };
    case 'submitted':
      return {
        Icon: Inbox,
        bg: 'bg-amber-50 dark:bg-amber-500/10',
        border: 'border-amber-200 dark:border-amber-500/30',
        iconColor: 'text-amber-600 dark:text-amber-300',
        titleColor: 'text-amber-800 dark:text-amber-200',
        subColor: 'text-amber-700 dark:text-amber-300',
        bodyColor: 'text-amber-700 dark:text-amber-200/80',
        notesBg: 'bg-amber-100/60 dark:bg-amber-500/15 text-amber-800 dark:text-amber-100',
        title: 'Submitted — awaiting manager validation',
        bodyLines: [
          `Submitted by ${approval?.submittedBy ?? 'unknown'} on ${formatStamp(approval?.submittedAt)}.`,
          'Cells are read-only until a manager locks or sends it back.',
        ],
      };
    case 'rejected':
      return {
        Icon: AlertTriangle,
        bg: 'bg-rose-50 dark:bg-rose-500/10',
        border: 'border-rose-200 dark:border-rose-500/30',
        iconColor: 'text-rose-600 dark:text-rose-300',
        titleColor: 'text-rose-800 dark:text-rose-200',
        subColor: 'text-rose-700 dark:text-rose-300',
        bodyColor: 'text-rose-700 dark:text-rose-200/80',
        notesBg: 'bg-rose-100/60 dark:bg-rose-500/15 text-rose-800 dark:text-rose-100',
        title: 'Sent back for edits',
        bodyLines: [
          'Make the requested changes, then resubmit.',
        ],
      };
    case 'locked':
      return {
        Icon: ShieldCheck,
        bg: 'bg-blue-50 dark:bg-blue-500/10',
        border: 'border-blue-200 dark:border-blue-500/30',
        iconColor: 'text-blue-600 dark:text-blue-300',
        titleColor: 'text-blue-800 dark:text-blue-200',
        subColor: 'text-blue-700 dark:text-blue-300',
        bodyColor: 'text-blue-700 dark:text-blue-200/80',
        notesBg: 'bg-blue-100/60 dark:bg-blue-500/15 text-blue-800 dark:text-blue-100',
        title: 'Locked — manager-validated, awaiting admin finalization',
        bodyLines: [
          `Locked by ${approval?.lockedBy ?? 'unknown'} on ${formatStamp(approval?.lockedAt)}.`,
          'Cells are read-only. Admin can save & finalize, or send back to manager.',
        ],
      };
    case 'saved':
      return {
        Icon: CheckCircle2,
        bg: 'bg-emerald-50 dark:bg-emerald-500/10',
        border: 'border-emerald-200 dark:border-emerald-500/30',
        iconColor: 'text-emerald-600 dark:text-emerald-300',
        titleColor: 'text-emerald-800 dark:text-emerald-200',
        subColor: 'text-emerald-700 dark:text-emerald-300',
        bodyColor: 'text-emerald-700 dark:text-emerald-200/80',
        notesBg: 'bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-100',
        title: 'Saved — final, archived for record-keeping',
        bodyLines: [
          `Saved by ${approval?.savedBy ?? 'unknown'} on ${formatStamp(approval?.savedAt)}.`,
          'This is the official version. Admin can export to HRIS or reopen for amendments.',
        ],
      };
  }
}
