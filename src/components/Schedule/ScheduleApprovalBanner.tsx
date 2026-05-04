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
  Send, Inbox, Undo2, ArrowLeft, ArrowRight, Pencil, GitCompare, Loader2,
  PackageCheck, Download,
} from 'lucide-react';
import type { ApprovalBlock, ApprovalStatus, ScheduleDiffSummary } from '../../lib/firestoreSchedules';
import type { Role } from '../../lib/auth';
import { availableActionsFor, formatApprovalActor } from '../../lib/scheduleApproval';
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

  // v5.1.0 — re-approval diff view. The banner owns the toggle visibility
  // (it knows the status / has-snapshot context) but App.tsx owns the
  // snapshot fetch and diff state. Toggle button only renders when
  // hasArchivedSnapshot AND the schedule has been through a save → reopen
  // cycle (or is currently post-reopen). Body line "Resubmitted after
  // previous archive" appears in the same circumstances so reviewers
  // know they're looking at a re-approval.
  hasArchivedSnapshot?: boolean;
  diffEnabled?: boolean;
  diffLoading?: boolean;
  diffSummary?: ScheduleDiffSummary | null;
  diffSnapshotLabel?: string | null;
  onToggleDiff?: (next: boolean) => void;

  // v5.1.0 — HRIS manual-bundle export. Renders only in 'saved' state.
  // App.tsx owns the assembly + download + Firestore stamp + audit.
  onExportHrisBundle?: () => void;
  hrisExportBusy?: boolean;
  hrisLastExportedAt?: number | null;
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
  hasArchivedSnapshot, diffEnabled, diffLoading,
  diffSummary, diffSnapshotLabel, onToggleDiff,
  onExportHrisBundle, hrisExportBusy, hrisLastExportedAt,
}: Props) {
  const status: ApprovalStatus = approval?.status ?? 'draft';
  const actions = availableActionsFor(status, role);

  // v5.10.0 — show a minimal status badge in Offline Demo mode (role===null)
  // too. Pre-v5.10 the banner returned null entirely there because there's
  // no approval workflow to show actions for, but the user explicitly asked
  // for "a current status indicator" on every month plan including Offline.
  // Render a stripped-down badge: just the status pill (no actions, no
  // history, no diff toggle), so the supervisor always sees "Working
  // draft" while editing locally.
  if (role === null && status === 'draft') {
    return (
      <div className="rounded-2xl border p-3 mb-5 shadow-sm flex items-center gap-3 bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700">
        <Pencil className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            <span>Working draft</span>
            <span className="ms-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">· {monthLabel}</span>
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
            Auto-saved locally. Use the Save Draft button on the toolbar for an immediate flush + confirmation.
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
          Draft
        </span>
      </div>
    );
  }

  // v5.1.0 — "this is a re-approval" detection. Three signals that this
  // schedule has been through a save → reopen cycle:
  //   • hasArchivedSnapshot — at least one /snapshots doc exists
  //   • approval.history contains a 'reopen' action — explicit user intent
  //   • the schedule already entered 'saved' once (savedAt is set even if
  //     the current status is now 'draft' / 'submitted' / 'locked')
  // Any of those is enough; the snapshot existence is the strongest signal
  // because it's the artifact reviewers will diff against.
  const wasReopened = !!approval?.history?.some((h) => h.action === 'reopen');
  const isReApproval = !!hasArchivedSnapshot || wasReopened || !!approval?.savedAt;

  const config = bannerConfigFor(status, approval, isReApproval);

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

          {/* v5.1.0 — Export HRIS bundle. Renders only in 'saved' state
              (the official archive). Available to admin / super-admin —
              we mirror the role gate from the workflow rather than adding
              a separate one, since admins are who deal with payroll
              integrations. The button shows "Re-export" wording when a
              prior export exists so it's clear they're producing a fresh
              snapshot of the same archive. */}
          {status === 'saved' && (role === 'admin' || role === 'super_admin') && onExportHrisBundle && (
            <button
              onClick={onExportHrisBundle}
              disabled={!!hrisExportBusy}
              title={
                hrisLastExportedAt
                  ? `Last exported ${format(new Date(hrisLastExportedAt), 'yyyy-MM-dd HH:mm')}. Re-exporting produces a fresh bundle with a new bundle ID.`
                  : 'Assemble the HRIS handoff bundle (manifest + schedule.csv + roster.csv + leaves.csv + compliance.json + README) as a single .zip download.'
              }
              className={cn(
                'apple-press inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm border',
                'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
                hrisExportBusy && 'opacity-60 cursor-wait',
              )}
            >
              {hrisExportBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageCheck className="w-3 h-3" />}
              {hrisLastExportedAt ? 'Re-export HRIS bundle' : 'Export HRIS bundle'}
              <Download className="w-3 h-3" />
            </button>
          )}

          {/* v5.1.0 — Show changes since last archive. Only renders when
              there's a snapshot to diff against AND the schedule isn't in
              pristine 'draft' state with no prior approval cycle (the diff
              would be empty there). The button is independent of the
              role-driven action buttons — every reviewer sees it. */}
          {isReApproval && onToggleDiff && (
            <DiffToggleButton
              enabled={!!diffEnabled}
              loading={!!diffLoading}
              summary={diffSummary ?? null}
              snapshotLabel={diffSnapshotLabel ?? null}
              onToggle={onToggleDiff}
            />
          )}
        </div>

        {/* v5.1.0 — last-exported hint under the saved-state action row.
            Confirms to the admin that a previous export exists; the
            re-export button above re-runs the same flow. */}
        {status === 'saved' && hrisLastExportedAt && (
          <p className="text-[10px] font-medium text-emerald-700/80 dark:text-emerald-200/70 mt-1">
            HRIS bundle last exported {format(new Date(hrisLastExportedAt), 'yyyy-MM-dd HH:mm')}.
          </p>
        )}

        {/* Diff legend — only when the diff is on AND we have a result.
            Quick visual key so reviewers don't have to guess what each
            colour ring means. */}
        {diffEnabled && diffSummary && diffSummary.total > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mt-1">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-emerald-500 dark:border-emerald-400" />
              Added · {diffSummary.added}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-amber-500 dark:border-amber-300" />
              Modified · {diffSummary.modified}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-rose-500 dark:border-rose-400" />
              Removed · {diffSummary.removed}
            </span>
            {diffSnapshotLabel && (
              <span className="ms-auto font-mono normal-case text-slate-400 dark:text-slate-500">{diffSnapshotLabel}</span>
            )}
          </div>
        )}
        {diffEnabled && diffSummary && diffSummary.total === 0 && (
          <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 italic mt-1">
            No changes since the last archived version.
          </p>
        )}
      </div>
    </div>
  );
}

// v5.1.0 — bundled toggle so the button itself + busy state + summary pill
// stay in one component. Keeping it inside this file rather than its own
// keeps the banner self-contained for the diff feature; the cell-level
// outline is the only piece outside.
function DiffToggleButton({
  enabled, loading, summary, snapshotLabel, onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  summary: ScheduleDiffSummary | null;
  snapshotLabel: string | null;
  onToggle: (next: boolean) => void;
}) {
  const totalLabel = enabled && summary ? ` · ${summary.total}` : '';
  return (
    <button
      onClick={() => onToggle(!enabled)}
      disabled={loading}
      title={
        snapshotLabel
          ? `Compare current schedule to the latest archived snapshot (${snapshotLabel})`
          : 'Compare current schedule to the latest archived snapshot'
      }
      aria-pressed={enabled}
      className={cn(
        'apple-press inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm border',
        enabled
          ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
          : 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-200 border-blue-300 dark:border-blue-500/40 hover:bg-blue-50 dark:hover:bg-blue-500/10',
        loading && 'opacity-60 cursor-wait',
      )}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
      {enabled ? 'Hide changes' : 'Show changes'}{totalLabel}
    </button>
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

function bannerConfigFor(
  status: ApprovalStatus,
  approval: ApprovalBlock | undefined,
  isReApproval: boolean,
): BannerConfig {
  // v5.1.0 — when a schedule has already been through a save → reopen
  // cycle, prepend a body line so reviewers immediately know they're
  // looking at a re-approval (not a fresh submission). The "Show changes
  // since last archive" toggle (rendered separately as the diff button)
  // is the actionable companion to this signal.
  const reApprovalLine = (status: ApprovalStatus): string | null => {
    if (!isReApproval) return null;
    if (status === 'saved') return 'Re-saved after a previous archive — the latest snapshot is now the official record.';
    if (status === 'draft') return 'Reopened from a previous archive — edit cells, then resubmit through the chain.';
    return 'Resubmitted after a previous archive — use "Show changes" below to compare against the latest archived snapshot.';
  };
  const prefixWithReApproval = (lines: string[]): string[] => {
    const re = reApprovalLine(status);
    return re ? [re, ...lines] : lines;
  };

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
        bodyLines: prefixWithReApproval(['Edit cells freely, then submit for approval when ready.']),
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
        bodyLines: prefixWithReApproval([
          `Submitted by ${formatApprovalActor(approval?.submittedByName, approval?.submittedByPosition, approval?.submittedBy)} on ${formatStamp(approval?.submittedAt)}.`,
          'Cells are read-only until a manager locks or sends it back.',
        ]),
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
        bodyLines: prefixWithReApproval(['Make the requested changes, then resubmit.']),
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
        bodyLines: prefixWithReApproval([
          `Locked by ${formatApprovalActor(approval?.lockedByName, approval?.lockedByPosition, approval?.lockedBy)} on ${formatStamp(approval?.lockedAt)}.`,
          'Cells are read-only. Admin can save & finalize, or send back to manager.',
        ]),
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
        bodyLines: prefixWithReApproval([
          `Saved by ${formatApprovalActor(approval?.savedByName, approval?.savedByPosition, approval?.savedBy)} on ${formatStamp(approval?.savedAt)}.`,
          'This is the official version. Admin can export to HRIS or reopen for amendments.',
        ]),
      };
  }
}
