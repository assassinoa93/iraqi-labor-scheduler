/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.0 — Five action modals for the schedule approval workflow:
 *   • Submit (supervisor → submitted)
 *   • Lock (manager → locked)
 *   • Save (admin → saved)
 *   • Send-back (manager → rejected, or admin → submitted)
 *   • Reopen (admin → draft, with tiered HRIS-export safeguards)
 *
 * Each modal is tied to a single transition action and shows the month
 * prominently in the title + confirm button — the user explicitly asked
 * for this so accidental cross-month approvals can't happen.
 *
 * Send-back and Reopen require notes (the previous user / audit trail
 * needs the reason). Submit / Lock / Save make notes optional.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Send, ShieldCheck, Lock as LockIcon, ArrowLeft, AlertTriangle, Info,
} from 'lucide-react';
import { useModalKeys } from '../../lib/hooks';
import { cn } from '../../lib/utils';

// ── Shared shell ──────────────────────────────────────────────────────────

interface ShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconTone: 'blue' | 'emerald' | 'purple' | 'rose' | 'amber';
  children: React.ReactNode;
}

const ICON_TONES = {
  blue:    { bg: 'bg-blue-50 dark:bg-blue-500/15',       fg: 'text-blue-600 dark:text-blue-300' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/15', fg: 'text-emerald-600 dark:text-emerald-300' },
  purple:  { bg: 'bg-purple-50 dark:bg-purple-500/15',   fg: 'text-purple-600 dark:text-purple-300' },
  rose:    { bg: 'bg-rose-50 dark:bg-rose-500/15',       fg: 'text-rose-600 dark:text-rose-300' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/15',     fg: 'text-amber-600 dark:text-amber-300' },
};

function ModalShell({ isOpen, onClose, title, subtitle, Icon, iconTone, children }: ShellProps) {
  const cancelRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  if (!isOpen) return null;
  const tone = ICON_TONES[iconTone];
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-md"
      role="dialog" aria-modal="true" aria-label={title}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6">
          <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4', tone.bg)}>
            <Icon className={cn('w-6 h-6', tone.fg)} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 text-center mb-1">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center mb-5">{subtitle}</p>
          )}
          {children}
          {/* Hidden focus target — Esc-to-close needs a focused element. */}
          <button ref={cancelRef} className="sr-only" aria-hidden="true" tabIndex={-1} />
        </div>
      </motion.div>
    </div>
  );
}

// ── Compliance summary block (shared by Lock + Save modals) ───────────────

interface ComplianceSummaryProps {
  violations: number;
  infos: number;
  scorePct: number;
}

function ComplianceSummary({ violations, infos, scorePct }: ComplianceSummaryProps) {
  const tone = violations > 0 ? 'rose' : infos > 0 ? 'amber' : 'emerald';
  const cls = tone === 'rose'
    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
    : tone === 'amber'
      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200'
      : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200';
  return (
    <div className={cn('rounded-lg border p-3 mb-4 text-[11px] leading-relaxed', cls)}>
      <p className="font-bold uppercase tracking-widest text-[9px] mb-1 opacity-80">Compliance summary</p>
      <p>
        Compliance score: <strong>{scorePct.toFixed(0)}%</strong>
        {' · '}
        <strong>{violations}</strong> hard violation{violations === 1 ? '' : 's'}
        {' · '}
        <strong>{infos}</strong> informational finding{infos === 1 ? '' : 's'}
      </p>
      {violations > 0 && (
        <p className="mt-1 text-[10px] opacity-80">
          The schedule still has unresolved hard violations. The platform reports — you decide whether to proceed.
        </p>
      )}
    </div>
  );
}

// ── Submit modal ──────────────────────────────────────────────────────────

interface SubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  monthLabel: string;
  companyLabel: string;
  violations: number;
  infos: number;
  scorePct: number;
  busy?: boolean;
}

export function SubmitForApprovalModal({
  isOpen, onClose, onConfirm, monthLabel, companyLabel,
  violations, infos, scorePct, busy,
}: SubmitModalProps) {
  const [notes, setNotes] = useState('');
  return (
    <ModalShell
      isOpen={isOpen} onClose={onClose}
      title={`Submit ${monthLabel} for approval?`}
      subtitle={companyLabel}
      Icon={Send} iconTone="blue"
    >
      <ComplianceSummary violations={violations} infos={infos} scorePct={scorePct} />
      <FieldLabel>Notes (optional, visible to manager on review)</FieldLabel>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="e.g. 'Holidays adjusted for Eid; one OT exception on day 12 — see Variables.'"
        className="w-full px-3 py-2 mb-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      />
      <FooterButtons
        onCancel={onClose} cancelDisabled={busy}
        confirmLabel={`Submit ${monthLabel}`}
        confirmTone="blue" confirmIcon={Send}
        confirmBusy={busy}
        onConfirm={async () => {
          await onConfirm(notes.trim());
          setNotes('');
        }}
      />
    </ModalShell>
  );
}

// ── Lock modal (manager → locked) ──────────────────────────────────────────

interface LockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  monthLabel: string;
  companyLabel: string;
  submittedBy: string | null;
  submittedAtLabel: string | null;
  violations: number;
  infos: number;
  scorePct: number;
  busy?: boolean;
}

export function LockScheduleModal({
  isOpen, onClose, onConfirm, monthLabel, companyLabel,
  submittedBy, submittedAtLabel, violations, infos, scorePct, busy,
}: LockModalProps) {
  const [notes, setNotes] = useState('');
  return (
    <ModalShell
      isOpen={isOpen} onClose={onClose}
      title={`Lock ${monthLabel}?`}
      subtitle={companyLabel}
      Icon={ShieldCheck} iconTone="emerald"
    >
      <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mb-4 space-y-0.5">
        {submittedBy && <p>Submitted by <strong>{submittedBy}</strong>{submittedAtLabel ? ` on ${submittedAtLabel}` : ''}.</p>}
        <p>Locking proceeds the schedule to admin finalization. Send back if changes are needed first.</p>
      </div>
      <ComplianceSummary violations={violations} infos={infos} scorePct={scorePct} />
      <FieldLabel>Notes (optional, visible to admin on review)</FieldLabel>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="e.g. 'Verified leave windows; one driver OT exception approved for day 8.'"
        className="w-full px-3 py-2 mb-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      />
      <FooterButtons
        onCancel={onClose} cancelDisabled={busy}
        confirmLabel={`Lock ${monthLabel}`}
        confirmTone="emerald" confirmIcon={ShieldCheck}
        confirmBusy={busy}
        onConfirm={async () => {
          await onConfirm(notes.trim());
          setNotes('');
        }}
      />
    </ModalShell>
  );
}

// ── Save modal (admin → saved) ─────────────────────────────────────────────

interface SaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  monthLabel: string;
  companyLabel: string;
  lockedBy: string | null;
  lockedAtLabel: string | null;
  violations: number;
  infos: number;
  scorePct: number;
  busy?: boolean;
}

export function SaveScheduleModal({
  isOpen, onClose, onConfirm, monthLabel, companyLabel,
  lockedBy, lockedAtLabel, violations, infos, scorePct, busy,
}: SaveModalProps) {
  const [notes, setNotes] = useState('');
  return (
    <ModalShell
      isOpen={isOpen} onClose={onClose}
      title={`Save & finalize ${monthLabel}?`}
      subtitle={companyLabel}
      Icon={LockIcon} iconTone="purple"
    >
      <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mb-4 space-y-0.5">
        {lockedBy && <p>Locked by <strong>{lockedBy}</strong>{lockedAtLabel ? ` on ${lockedAtLabel}` : ''}.</p>}
        <p>This becomes the <strong>official archived record</strong>. An immutable snapshot is written to <code className="font-mono">/snapshots</code>. Reopening later will require an admin reason note (audited).</p>
      </div>
      <ComplianceSummary violations={violations} infos={infos} scorePct={scorePct} />
      <FieldLabel>Notes (optional, recorded with the snapshot)</FieldLabel>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="e.g. 'Approved for HRIS export; payroll cycle starts April 25.'"
        className="w-full px-3 py-2 mb-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
      />
      <FooterButtons
        onCancel={onClose} cancelDisabled={busy}
        confirmLabel={`Save ${monthLabel} as final`}
        confirmTone="purple" confirmIcon={LockIcon}
        confirmBusy={busy}
        onConfirm={async () => {
          await onConfirm(notes.trim());
          setNotes('');
        }}
      />
    </ModalShell>
  );
}

// ── Send-back modal (manager→supervisor or admin→manager) ─────────────────

interface SendBackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  monthLabel: string;
  companyLabel: string;
  /** Where the schedule will land after send-back. */
  destination: 'supervisor' | 'manager';
  busy?: boolean;
}

export function SendBackModal({
  isOpen, onClose, onConfirm, monthLabel, companyLabel, destination, busy,
}: SendBackModalProps) {
  const [notes, setNotes] = useState('');
  const trimmed = notes.trim();
  const canConfirm = trimmed.length >= 3;  // minimum sanity — non-empty
  return (
    <ModalShell
      isOpen={isOpen} onClose={onClose}
      title={`Send ${monthLabel} back to ${destination}?`}
      subtitle={companyLabel}
      Icon={ArrowLeft} iconTone="rose"
    >
      <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
        <p>The schedule will return to the {destination}'s queue with your notes attached. They'll see exactly why it came back so they can make the requested changes and resubmit.</p>
      </div>
      <FieldLabel required>Notes for the {destination}</FieldLabel>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder={destination === 'supervisor'
          ? "e.g. 'Day 12 has only 1 cashier on the peak shift — coverage minimum is 2.'"
          : "e.g. 'OT cap exception on row 7 needs Variables-tab tweak before I finalize.'"}
        className="w-full px-3 py-2 mb-1 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
      />
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
        Required. The {destination} won't see the schedule again until they edit and resubmit.
      </p>
      <FooterButtons
        onCancel={onClose} cancelDisabled={busy}
        confirmLabel={`Send ${monthLabel} back`}
        confirmTone="rose" confirmIcon={ArrowLeft}
        confirmDisabled={!canConfirm}
        confirmBusy={busy}
        onConfirm={async () => {
          await onConfirm(trimmed);
          setNotes('');
        }}
      />
    </ModalShell>
  );
}

// ── Reopen modal (admin reopens saved) — tiered safeguards ────────────────

interface ReopenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  monthLabel: string;
  companyLabel: string;
  /** From `hrisSync.lastExportedAt`. null = never exported. */
  lastExportedAt: number | null;
  busy?: boolean;
}

export function ReopenModal({
  isOpen, onClose, onConfirm, monthLabel, companyLabel, lastExportedAt, busy,
}: ReopenModalProps) {
  const [notes, setNotes] = useState('');
  // v5.1.1 — auto-focus the reason textarea on open. Pre-v5.1.1 the user
  // saw a disabled-looking confirm button and a body-text warning that
  // could read as "this is blocked", missing that they only needed to
  // type a reason. Auto-focusing the textarea makes it obvious the
  // input is awaiting them.
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (isOpen) {
      const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  // Tiered safeguards — see plan's "Reopen flow" section.
  const ageHours = lastExportedAt ? (Date.now() - lastExportedAt) / 3_600_000 : null;
  const tier: 'pre-export' | 'recent-export' | 'old-export' =
    lastExportedAt === null ? 'pre-export'
      : ageHours !== null && ageHours < 24 ? 'recent-export'
        : 'old-export';
  const minNoteChars = tier === 'old-export' ? 30 : 1;
  const trimmed = notes.trim();
  const canConfirm = trimmed.length >= minNoteChars;

  // v5.1.1 — softened recent-export wording. Pre-v5.1.1 it read like a
  // hard error ("your downstream system has an out-of-date version")
  // which discouraged users from continuing. The reopen workflow is
  // intentional: of course the HRIS will be stale until re-export.
  // The note is now a forward-looking reminder.
  const tierCopy = {
    'pre-export': 'Reopening returns this schedule to draft. The current saved snapshot is preserved in the snapshot history. The supervisor (or manager) will edit, then re-submit through the chain.',
    'recent-export': 'This schedule was exported to HRIS in the last 24 hours. After you reopen, edit, and re-save, remember to re-export so HRIS has the new official version.',
    'old-export': 'This schedule was archived and previously exported. Reopening for amendments is allowed but recorded — the prior saved snapshot remains in the snapshot history for audit purposes.',
  }[tier];
  const tone: 'amber' | 'rose' = tier === 'old-export' ? 'rose' : 'amber';

  return (
    <ModalShell
      isOpen={isOpen} onClose={onClose}
      title={`Reopen ${monthLabel}?`}
      subtitle={companyLabel}
      Icon={tier === 'pre-export' ? Info : AlertTriangle}
      iconTone={tone}
    >
      <div className={cn(
        'rounded-lg border p-3 mb-4 text-[11px] leading-relaxed',
        tier === 'old-export'
          ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
          : tier === 'recent-export'
            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200'
            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
      )}>
        <p>{tierCopy}</p>
      </div>
      <FieldLabel required>
        Reason for reopening{tier === 'old-export' ? ` (min ${minNoteChars} characters)` : ''}
      </FieldLabel>
      <textarea
        ref={textareaRef}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="e.g. 'Last-minute leave request from EMP-23 — schedule needs day 14–18 reshuffle.'"
        className={cn(
          'w-full px-3 py-2 mb-1 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 transition-colors',
          // v5.1.1 — red border + ring when below the minimum so the user
          // sees at a glance why the confirm button is disabled. Pre-v5.1.1
          // the only signal was a small grey hint paragraph; users missed it.
          !canConfirm
            ? 'border-2 border-rose-300 dark:border-rose-500/50 focus:ring-rose-500/40'
            : 'border border-slate-200 dark:border-slate-700 focus:ring-amber-500/40',
        )}
      />
      <p className={cn(
        'text-[10px] mb-4 leading-relaxed font-medium',
        !canConfirm
          ? 'text-rose-600 dark:text-rose-300'
          : 'text-slate-500 dark:text-slate-400',
      )}>
        {trimmed.length < minNoteChars
          ? `Type at least ${minNoteChars} character${minNoteChars === 1 ? '' : 's'} of reason to enable Reopen. ${minNoteChars - trimmed.length} more to go.`
          : 'Recorded in audit log.'}
      </p>
      <FooterButtons
        onCancel={onClose} cancelDisabled={busy}
        confirmLabel={`Reopen ${monthLabel}`}
        confirmTone={tone} confirmIcon={AlertTriangle}
        confirmDisabled={!canConfirm}
        confirmBusy={busy}
        onConfirm={async () => {
          await onConfirm(trimmed);
          setNotes('');
        }}
      />
    </ModalShell>
  );
}

// ── Tiny shared bits ──────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
      {children}{required && <span className="text-rose-500"> *</span>}
    </label>
  );
}

interface FooterButtonsProps {
  onCancel: () => void;
  cancelDisabled?: boolean;
  confirmLabel: string;
  confirmTone: 'blue' | 'emerald' | 'purple' | 'rose' | 'amber';
  confirmIcon: React.ComponentType<{ className?: string }>;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  onConfirm: () => void | Promise<void>;
}

const CONFIRM_TONES = {
  blue:    'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/25',
  emerald: 'bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-500/25',
  purple:  'bg-purple-600 hover:bg-purple-700 shadow-md shadow-purple-500/25',
  rose:    'bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-500/25',
  amber:   'bg-amber-600 hover:bg-amber-700 shadow-md shadow-amber-500/25',
};

function FooterButtons({
  onCancel, cancelDisabled,
  confirmLabel, confirmTone, confirmIcon: ConfirmIcon,
  confirmDisabled, confirmBusy, onConfirm,
}: FooterButtonsProps) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onCancel}
        disabled={cancelDisabled}
        className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 transition-all"
      >
        Cancel
      </button>
      <button
        onClick={() => void onConfirm()}
        disabled={confirmDisabled || confirmBusy}
        className={cn(
          'apple-press flex-1 px-4 py-2 text-white rounded-lg font-bold text-[11px] uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5',
          CONFIRM_TONES[confirmTone],
        )}
      >
        <ConfirmIcon className="w-3.5 h-3.5" />
        {confirmBusy ? 'Working…' : confirmLabel}
      </button>
    </div>
  );
}
