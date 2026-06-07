import { useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ClipboardList, Inbox, Plus, X, XCircle } from 'lucide-react';
import type { Employee, LeaveRequest, LeaveType } from '../../types';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import { remainingAnnualLeave, inclusiveDayCount } from '../../lib/leaves';

// v5.24.0 — Leave request workflow UI.
//
// One panel that hosts both halves of the workflow:
//   • Submit form (admin / manager / supervisor) — pick an employee,
//     dates, type, and reason. Submits to the queue as 'pending'.
//   • Approval queue (manager / admin / super_admin) — pending requests
//     with Approve / Reject buttons. Approved requests stamp a
//     LeaveRange on the employee's record; rejected requests stay in
//     the queue with the rejection reason captured.
//
// Pure presentational + form-state holder. Mutations come back to App
// via the on*Submit / on*Approve / on*Reject callbacks.

const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'maternity'];

interface Props {
  employees: Employee[];
  requests: LeaveRequest[];
  // When false, the submit form is hidden (e.g. role=admin can approve
  // but doesn't submit). Pending queue is always shown.
  canSubmit: boolean;
  canDecide: boolean;
  onSubmit: (args: {
    empId: string;
    type: LeaveType;
    start: string;
    end: string;
    reason: string;
  }) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

export function LeaveRequestPanel({
  employees, requests, canSubmit, canDecide,
  onSubmit, onApprove, onReject,
}: Props) {
  const { t, fmt } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [type, setType] = useState<LeaveType>('annual');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Pending rejection — when set, we render a small inline prompt for
  // the rejection reason. null means no rejection in flight.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const empById = new Map(employees.map(e => [e.empId, e]));
  const pending = requests.filter(r => r.status === 'pending');
  const recentDecisions = requests
    .filter(r => r.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .slice(0, 5);

  const resetForm = () => {
    setEmpId(''); setType('annual'); setStart(''); setEnd(''); setReason('');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!empId) { setError(t('leaveReq.error.emp')); return; }
    if (!start || !end) { setError(t('leaveReq.error.dates')); return; }
    if (start > end) { setError(t('leaveReq.error.inverted')); return; }
    if (!reason.trim()) { setError(t('leaveReq.error.reason')); return; }
    onSubmit({ empId, type, start, end, reason });
    resetForm();
    setFormOpen(false);
  };

  const handleReject = (id: string) => {
    if (!rejectReason.trim()) return;
    onReject(id, rejectReason);
    setRejectingId(null);
    setRejectReason('');
  };

  const typeLabel = (lt: LeaveType): string => t(`leaveReq.type.${lt}`);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Inbox className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">{t('leaveReq.title')}</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{t('leaveReq.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <span className="px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200 text-[10px] font-black uppercase tracking-widest">
              {t('leaveReq.pendingCount', { count: fmt.num(pending.length) })}
            </span>
          )}
          {canSubmit && (
            <button
              onClick={() => setFormOpen(o => !o)}
              className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              {formOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {formOpen ? t('action.cancel') : t('leaveReq.submit.cta')}
            </button>
          )}
        </div>
      </div>

      {/* Submit form */}
      {canSubmit && formOpen && (
        <form onSubmit={handleSubmit} className="p-5 border-b border-slate-100 dark:border-slate-700/60 space-y-3 bg-blue-50/30 dark:bg-blue-500/5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 block">{t('leaveReq.form.emp')}</label>
              <select
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                <option value="">{t('leaveReq.form.emp.placeholder')}</option>
                {employees.map(e => (
                  <option key={e.empId} value={e.empId}>{e.name} · {e.empId}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 block">{t('leaveReq.form.type')}</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as LeaveType)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {LEAVE_TYPES.map(lt => (
                  <option key={lt} value={lt}>{typeLabel(lt)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 block">{t('leaveReq.form.start')}</label>
              <input
                type="date"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 block">{t('leaveReq.form.end')}</label>
              <input
                type="date"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 block">{t('leaveReq.form.reason')}</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
              placeholder={t('leaveReq.form.reason.placeholder')}
            />
          </div>
          {error && (
            <p className="text-[11px] text-rose-700 dark:text-rose-300 font-bold">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setFormOpen(false); resetForm(); }}
              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-all"
            >
              {t('action.cancel')}
            </button>
            <button
              type="submit"
              className="apple-press px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
            >
              {t('leaveReq.submit.confirm')}
            </button>
          </div>
        </form>
      )}

      {/* Pending queue */}
      <div className="p-5">
        {pending.length === 0 ? (
          <div className="text-center py-6">
            <ClipboardList className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('leaveReq.empty')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map(req => {
              const emp = empById.get(req.empId);
              const isRejecting = rejectingId === req.id;
              return (
                <li key={req.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                        {emp?.name ?? req.empId}
                        <span className="ms-2 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[9px] font-mono font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">{typeLabel(req.type)}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        <Calendar className="w-3 h-3 inline-block me-1" />
                        {fmt.digits(req.start)} → {fmt.digits(req.end)}
                      </p>
                      {/* v5.27 — annual-leave balance context + non-blocking
                          overdraw warning. Reporting, not enforcement: the
                          Approve button stays enabled. Pure derivation; the
                          stored balance is never mutated. */}
                      {req.type === 'annual' && emp && (() => {
                        const entitlement = emp.annualLeaveBalance ?? 0;
                        const remaining = remainingAnnualLeave(emp, req.start);
                        const requested = inclusiveDayCount(req.start, req.end);
                        const overdraw = requested > remaining;
                        return (
                          <>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {t('leaveReq.balance.line', {
                                requested: fmt.num(requested),
                                remaining: fmt.num(remaining),
                                entitlement: fmt.num(entitlement),
                              })}
                            </p>
                            {overdraw && (
                              <p className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 text-[10px] font-bold border border-amber-200 dark:border-amber-500/40">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {t('leaveReq.balance.overdraw', { over: fmt.num(requested - remaining) })}
                              </p>
                            )}
                          </>
                        );
                      })()}
                      <p className="text-[11px] text-slate-700 dark:text-slate-200 mt-1 italic">"{req.reason}"</p>
                    </div>
                    {canDecide && !isRejecting && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => onApprove(req.id)}
                          className="apple-press inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {t('leaveReq.approve')}
                        </button>
                        <button
                          onClick={() => { setRejectingId(req.id); setRejectReason(''); }}
                          className="apple-press inline-flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono"
                        >
                          <XCircle className="w-3 h-3" />
                          {t('leaveReq.reject')}
                        </button>
                      </div>
                    )}
                  </div>
                  {isRejecting && (
                    <div className="mt-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 space-y-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder={t('leaveReq.reject.reason.placeholder')}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 rounded text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason(''); }}
                          className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all"
                        >
                          {t('action.cancel')}
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          disabled={!rejectReason.trim()}
                          className={cn(
                            'apple-press px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm',
                            rejectReason.trim()
                              ? 'bg-rose-600 hover:bg-rose-700 text-white'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed',
                          )}
                        >
                          {t('leaveReq.reject.confirm')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {recentDecisions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">{t('leaveReq.recent')}</p>
            <ul className="space-y-1">
              {recentDecisions.map(req => {
                const emp = empById.get(req.empId);
                const approved = req.status === 'approved';
                return (
                  <li key={req.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] bg-slate-50 dark:bg-slate-800/40 rounded border border-slate-100 dark:border-slate-700/60">
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate min-w-0">{emp?.name ?? req.empId}</span>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{fmt.digits(req.start)} → {fmt.digits(req.end)}</span>
                    <span className={cn(
                      'shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest',
                      approved
                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-200'
                        : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200',
                    )}>
                      {approved ? t('leaveReq.status.approved') : t('leaveReq.status.rejected')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
