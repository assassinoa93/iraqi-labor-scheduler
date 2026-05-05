import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Plus, Users } from 'lucide-react';
import { Employee, Station, StationGroup, Shift, EmployeeCategory, Gender } from '../types';
import { cn } from '../lib/utils';
import { SettingField } from './Primitives';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

// v5.2.0 — bulk-edit modal for the Roster tab. The single-employee
// EmployeeModal is the source of truth for what's editable on a card; this
// modal mirrors that surface but applies each opted-in change to every
// selected employee in one pass. Field semantics:
//   * Lists (stations, groups, preferred / avoid shifts): mode = skip | add |
//     remove | replace. Skip leaves the field alone; replace overwrites with
//     just the picked items; add unions; remove subtracts.
//   * Scalars (role, dept, contract, weekly hrs, rest day, category,
//     annual-leave balance, gender): a "Change" toggle gates each field.
//     Toggle off = skip; toggle on = use the entered value.
//   * Boolean flags (hazardous, industrial, hour exempt): tri-state pill
//     group — Skip | True | False.
// Keeps the hairy carve-out semantics that EmployeeModal uses for individual
// edits OUT of this surface. Bulk operations need predictable add/remove
// semantics; "carve out one station from a group I just added to fifty
// people" is too magical at scale.

export type ListMode = 'skip' | 'add' | 'remove' | 'replace';
export type FlagPatch = 'skip' | true | false;

export interface BulkEditPatch {
  stations: { mode: ListMode; ids: string[] };
  groups:   { mode: ListMode; ids: string[] };
  preferredShifts: { mode: ListMode; codes: string[] };
  avoidShifts:     { mode: ListMode; codes: string[] };
  role?: string;
  department?: string;
  contractType?: string;
  contractedWeeklyHrs?: number;
  fixedRestDay?: number;
  category?: EmployeeCategory;
  gender?: Gender | null; // null = explicit "unset gender"
  annualLeaveBalance?: number;
  isHazardous?: boolean;
  isIndustrialRotating?: boolean;
  hourExempt?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  stations: Station[];
  stationGroups: StationGroup[];
  shifts: Shift[];
  onApply: (patch: BulkEditPatch) => void;
}

const emptyPatch = (): BulkEditPatch => ({
  stations:        { mode: 'skip', ids: [] },
  groups:          { mode: 'skip', ids: [] },
  preferredShifts: { mode: 'skip', codes: [] },
  avoidShifts:     { mode: 'skip', codes: [] },
});

// Canonical mode order so the pill row reads the same in every section.
const LIST_MODES: ListMode[] = ['skip', 'add', 'remove', 'replace'];

export function BulkEditEmployeesModal({
  isOpen, onClose, selectedCount, stations, stationGroups, shifts, onApply,
}: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);
  const [patch, setPatch] = useState<BulkEditPatch>(() => emptyPatch());
  // v5.18.0 — applying-state. Larger selections (200+ employees) trigger
  // a synchronous map() in App.tsx that briefly freezes the UI; the
  // button state below tells the user "we got the click, please wait"
  // so they don't tap twice and double-apply. Cleared by the modal
  // close that follows a successful apply; the parent owns the actual
  // mutation so we yield via requestAnimationFrame to give React time
  // to paint the spinner before the heavy work runs.
  const [applying, setApplying] = useState(false);
  // Reset applying state whenever the modal opens — defensive in case a
  // previous apply errored before close fired.
  useEffect(() => {
    if (isOpen) setApplying(false);
  }, [isOpen]);

  // Per-field "change me" toggles for scalar fields. Kept separate from the
  // patch object so the user can type a value, untick the toggle to back
  // out, and the typed value is preserved if they re-tick.
  const [enabled, setEnabled] = useState({
    role: false,
    department: false,
    contractType: false,
    weeklyHrs: false,
    restDay: false,
    category: false,
    gender: false,
    annualLeaveBalance: false,
    hazardous: false,
    industrial: false,
    hourExempt: false,
  });
  const [draft, setDraft] = useState({
    role: '',
    department: '',
    contractType: 'Permanent',
    weeklyHrs: 48,
    restDay: 0,
    category: 'Standard' as EmployeeCategory,
    gender: '' as '' | 'M' | 'F',
    annualLeaveBalance: 21,
    hazardous: false,
    industrial: true,
    hourExempt: false,
  });

  useEffect(() => {
    if (isOpen) {
      setPatch(emptyPatch());
      setEnabled({
        role: false, department: false, contractType: false, weeklyHrs: false,
        restDay: false, category: false, gender: false, annualLeaveBalance: false,
        hazardous: false, industrial: false, hourExempt: false,
      });
      setDraft({
        role: '', department: '', contractType: 'Permanent', weeklyHrs: 48,
        restDay: 0, category: 'Standard', gender: '', annualLeaveBalance: 21,
        hazardous: false, industrial: true, hourExempt: false,
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const setListMode = <K extends 'stations' | 'groups' | 'preferredShifts' | 'avoidShifts'>(
    key: K, mode: ListMode,
  ) => {
    setPatch(prev => ({ ...prev, [key]: { ...prev[key], mode } }));
  };
  const toggleStationId = (id: string) => {
    setPatch(prev => {
      const cur = prev.stations.ids;
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return { ...prev, stations: { ...prev.stations, ids: next } };
    });
  };
  const toggleGroupId = (id: string) => {
    setPatch(prev => {
      const cur = prev.groups.ids;
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return { ...prev, groups: { ...prev.groups, ids: next } };
    });
  };
  const togglePreferredCode = (code: string) => {
    setPatch(prev => {
      const cur = prev.preferredShifts.codes;
      const next = cur.includes(code) ? cur.filter(x => x !== code) : [...cur, code];
      return { ...prev, preferredShifts: { ...prev.preferredShifts, codes: next } };
    });
  };
  const toggleAvoidCode = (code: string) => {
    setPatch(prev => {
      const cur = prev.avoidShifts.codes;
      const next = cur.includes(code) ? cur.filter(x => x !== code) : [...cur, code];
      return { ...prev, avoidShifts: { ...prev.avoidShifts, codes: next } };
    });
  };

  const apply = () => {
    const p: BulkEditPatch = {
      stations:        patch.stations,
      groups:          patch.groups,
      preferredShifts: patch.preferredShifts,
      avoidShifts:     patch.avoidShifts,
    };
    if (enabled.role) p.role = draft.role;
    if (enabled.department) p.department = draft.department;
    if (enabled.contractType) p.contractType = draft.contractType;
    if (enabled.weeklyHrs) p.contractedWeeklyHrs = Math.max(0, draft.weeklyHrs | 0);
    if (enabled.restDay) p.fixedRestDay = Math.max(0, Math.min(7, draft.restDay | 0));
    if (enabled.category) p.category = draft.category;
    if (enabled.gender) p.gender = draft.gender === '' ? null : draft.gender;
    if (enabled.annualLeaveBalance) p.annualLeaveBalance = Math.max(0, draft.annualLeaveBalance | 0);
    if (enabled.hazardous) p.isHazardous = draft.hazardous;
    if (enabled.industrial) p.isIndustrialRotating = draft.industrial;
    if (enabled.hourExempt) p.hourExempt = draft.hourExempt;
    setApplying(true);
    // Yield to the browser so the disabled/spinner state paints before
    // the parent's heavy map() blocks the main thread. Without this the
    // button stays static while the work runs and the user thinks the
    // app froze.
    requestAnimationFrame(() => onApply(p));
  };

  // Counts a patch field as "active" so the apply button can show how many
  // distinct mutations are queued. Useful feedback when the form is wide.
  const activeChanges = (() => {
    let n = 0;
    if (patch.stations.mode !== 'skip')        n++;
    if (patch.groups.mode !== 'skip')          n++;
    if (patch.preferredShifts.mode !== 'skip') n++;
    if (patch.avoidShifts.mode !== 'skip')     n++;
    n += Object.values(enabled).filter(Boolean).length;
    return n;
  })();

  const workShifts = shifts.filter(s => s.isWork);

  const ModePill = ({ mode, current, onClick, label }: { mode: ListMode; current: ListMode; onClick: () => void; label: string }) => {
    const active = mode === current;
    const tone =
      mode === 'skip'    ? 'bg-slate-600'  :
      mode === 'add'     ? 'bg-emerald-600' :
      mode === 'remove'  ? 'bg-rose-600'    :
                           'bg-blue-600';
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
          active
            ? `${tone} text-white border-transparent shadow-sm`
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500',
        )}
      >
        {label}
      </button>
    );
  };

  // v5.3.1: sticky backdrop — clicking outside the card no longer dismisses.
  // Esc + X + Cancel are the only paths out.
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('bulkEdit.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('bulkEdit.title')}</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                {t('bulkEdit.subtitle', { count: selectedCount })}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">

          {/* GROUPS — usually the bulk control of choice for a roster of N
              people. Listed first so a "give all cashiers the cashier group"
              flow is one section. */}
          {stationGroups.length > 0 && (
            <section className="space-y-3 p-4 bg-emerald-50/40 dark:bg-emerald-500/10 rounded-lg border border-emerald-100 dark:border-emerald-500/30">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('bulkEdit.section.groups')}</p>
                <div className="flex gap-1">
                  {LIST_MODES.map(m => (
                    <ModePill key={m} mode={m} current={patch.groups.mode} onClick={() => setListMode('groups', m)} label={t(`bulkEdit.mode.${m}`)} />
                  ))}
                </div>
              </div>
              {patch.groups.mode !== 'skip' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {stationGroups.map(g => {
                    const active = patch.groups.ids.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggleGroupId(g.id)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase border transition-all',
                          active
                            ? 'border-transparent text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300 dark:hover:border-emerald-500/40',
                        )}
                        style={active && g.color ? { backgroundColor: g.color, borderColor: g.color } : undefined}
                      >
                        <Plus className={cn('w-3 h-3', active && 'rotate-45')} />
                        <span className="truncate">{g.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* STATIONS — per-station picker, same add/remove/replace semantics. */}
          <section className="space-y-3 p-4 bg-blue-50/30 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] font-bold text-blue-500 dark:text-blue-300 uppercase tracking-widest">{t('bulkEdit.section.stations')}</p>
              <div className="flex gap-1">
                {LIST_MODES.map(m => (
                  <ModePill key={m} mode={m} current={patch.stations.mode} onClick={() => setListMode('stations', m)} label={t(`bulkEdit.mode.${m}`)} />
                ))}
              </div>
            </div>
            {patch.stations.mode !== 'skip' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {stations.map(st => {
                  const active = patch.stations.ids.includes(st.id);
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => toggleStationId(st.id)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase border transition-all',
                        active
                          ? 'bg-blue-600 border-blue-700 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-blue-300 dark:hover:border-blue-500/40',
                      )}
                    >
                      <Plus className={cn('w-3 h-3', active && 'rotate-45')} />
                      {st.name}
                    </button>
                  );
                })}
                {stations.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 col-span-3">{t('bulkEdit.stations.empty')}</p>
                )}
              </div>
            )}
          </section>

          {/* SHIFT PREFERENCES — preferred + avoid blocks share styling with
              EmployeeModal so the UI reads consistently. */}
          <section className="space-y-3 p-4 bg-indigo-50/30 dark:bg-indigo-500/10 rounded-lg border border-indigo-100 dark:border-indigo-500/30">
            <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 uppercase tracking-widest">{t('bulkEdit.section.shiftPrefs')}</p>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('bulkEdit.section.preferred')}</p>
                <div className="flex gap-1">
                  {LIST_MODES.map(m => (
                    <ModePill key={m} mode={m} current={patch.preferredShifts.mode} onClick={() => setListMode('preferredShifts', m)} label={t(`bulkEdit.mode.${m}`)} />
                  ))}
                </div>
              </div>
              {patch.preferredShifts.mode !== 'skip' && (
                <div className="flex flex-wrap gap-2">
                  {workShifts.map(s => {
                    const active = patch.preferredShifts.codes.includes(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => togglePreferredCode(s.code)}
                        className={cn(
                          'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
                          active
                            ? 'bg-emerald-600 border-emerald-700 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300 dark:hover:border-emerald-500/40',
                        )}
                      >
                        {s.code} · {s.start}–{s.end}
                      </button>
                    );
                  })}
                  {workShifts.length === 0 && <p className="text-[10px] text-slate-400 dark:text-slate-500">{t('bulkEdit.shifts.empty')}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[9px] font-bold text-rose-700 dark:text-rose-200 uppercase tracking-widest">{t('bulkEdit.section.avoid')}</p>
                <div className="flex gap-1">
                  {LIST_MODES.map(m => (
                    <ModePill key={m} mode={m} current={patch.avoidShifts.mode} onClick={() => setListMode('avoidShifts', m)} label={t(`bulkEdit.mode.${m}`)} />
                  ))}
                </div>
              </div>
              {patch.avoidShifts.mode !== 'skip' && (
                <div className="flex flex-wrap gap-2">
                  {workShifts.map(s => {
                    const active = patch.avoidShifts.codes.includes(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => toggleAvoidCode(s.code)}
                        className={cn(
                          'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
                          active
                            ? 'bg-rose-600 border-rose-700 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-rose-300 dark:hover:border-rose-500/40',
                        )}
                      >
                        {s.code} · {s.start}–{s.end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* SCALAR FIELDS — a "Change" switch gates each input so untouched
              fields stay untouched on the saved employees. */}
          <section className="space-y-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">{t('bulkEdit.section.scalars')}</p>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <ScalarRow
                label={t('modal.employee.field.role')}
                enabled={enabled.role}
                onToggle={v => setEnabled(s => ({ ...s, role: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <SettingField label="" value={draft.role} onChange={v => setDraft(s => ({ ...s, role: v }))} />
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.department')}
                enabled={enabled.department}
                onToggle={v => setEnabled(s => ({ ...s, department: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <SettingField label="" value={draft.department} onChange={v => setDraft(s => ({ ...s, department: v }))} />
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.contract')}
                enabled={enabled.contractType}
                onToggle={v => setEnabled(s => ({ ...s, contractType: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <SettingField label="" type="select" options={['Permanent', 'Fixed-Term', 'Contractor']} value={draft.contractType} onChange={v => setDraft(s => ({ ...s, contractType: v }))} />
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.weeklyHours')}
                enabled={enabled.weeklyHrs}
                onToggle={v => setEnabled(s => ({ ...s, weeklyHrs: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <SettingField label="" type="number" value={draft.weeklyHrs} onChange={v => setDraft(s => ({ ...s, weeklyHrs: parseInt(v) || 0 }))} />
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.restPolicy')}
                enabled={enabled.restDay}
                onToggle={v => setEnabled(s => ({ ...s, restDay: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <select
                  value={draft.restDay}
                  onChange={e => setDraft(s => ({ ...s, restDay: parseInt(e.target.value) || 0 }))}
                  className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                >
                  <option value={0}>{t('modal.employee.rest.rotate')}</option>
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                    <option key={i} value={i + 1}>{t('modal.employee.rest.fixed')} {d}</option>
                  ))}
                </select>
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.category')}
                enabled={enabled.category}
                onToggle={v => setEnabled(s => ({ ...s, category: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <select
                  value={draft.category}
                  onChange={e => setDraft(s => ({ ...s, category: e.target.value as EmployeeCategory }))}
                  className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                >
                  <option value="Standard">{t('modal.employee.cat.standard')}</option>
                  <option value="Driver">{t('modal.employee.cat.driver')}</option>
                </select>
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.gender')}
                enabled={enabled.gender}
                onToggle={v => setEnabled(s => ({ ...s, gender: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <select
                  value={draft.gender}
                  onChange={e => setDraft(s => ({ ...s, gender: e.target.value as '' | 'M' | 'F' }))}
                  className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                >
                  <option value="">{t('modal.employee.gender.unset')}</option>
                  <option value="M">{t('modal.employee.gender.male')}</option>
                  <option value="F">{t('modal.employee.gender.female')}</option>
                </select>
              </ScalarRow>

              <ScalarRow
                label={t('modal.employee.field.annualLeave')}
                enabled={enabled.annualLeaveBalance}
                onToggle={v => setEnabled(s => ({ ...s, annualLeaveBalance: v }))}
                changeLabel={t('bulkEdit.change')}
              >
                <SettingField label="" type="number" value={draft.annualLeaveBalance} onChange={v => setDraft(s => ({ ...s, annualLeaveBalance: parseInt(v) || 0 }))} />
              </ScalarRow>
            </div>
          </section>

          {/* FLAGS — boolean tri-state per flag (skip / on / off). Switch
              component is bound to draft state only when "Change" is on. */}
          <section className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">{t('bulkEdit.section.flags')}</p>
            <div className="grid grid-cols-3 gap-4">
              <FlagRow
                label={t('modal.employee.flag.hazardous')}
                enabled={enabled.hazardous}
                onToggleEnabled={v => setEnabled(s => ({ ...s, hazardous: v }))}
                value={draft.hazardous}
                onChangeValue={v => setDraft(s => ({ ...s, hazardous: v }))}
                tone="rose"
                changeLabel={t('bulkEdit.change')}
              />
              <FlagRow
                label={t('modal.employee.flag.industrial')}
                enabled={enabled.industrial}
                onToggleEnabled={v => setEnabled(s => ({ ...s, industrial: v }))}
                value={draft.industrial}
                onChangeValue={v => setDraft(s => ({ ...s, industrial: v }))}
                tone="amber"
                changeLabel={t('bulkEdit.change')}
              />
              <FlagRow
                label={t('modal.employee.flag.exempt')}
                enabled={enabled.hourExempt}
                onToggleEnabled={v => setEnabled(s => ({ ...s, hourExempt: v }))}
                value={draft.hourExempt}
                onChangeValue={v => setDraft(s => ({ ...s, hourExempt: v }))}
                changeLabel={t('bulkEdit.change')}
              />
            </div>
          </section>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {activeChanges === 0
              ? t('bulkEdit.summary.nothing')
              : t('bulkEdit.summary.ready', { changes: activeChanges, count: selectedCount })}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={applying} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">{t('action.cancel')}</button>
            <button
              onClick={apply}
              disabled={activeChanges === 0 || applying}
              className={cn(
                'px-8 py-2 rounded text-sm font-bold transition-all shadow-lg uppercase tracking-widest inline-flex items-center gap-2',
                activeChanges === 0
                  ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  : applying
                    ? 'bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 cursor-wait'
                    : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white',
              )}
            >
              {applying && (
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
              )}
              {applying
                ? t('bulkEdit.applying', { count: selectedCount })
                : t('bulkEdit.commit', { count: selectedCount })}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ScalarRow({
  label, enabled, onToggle, children, changeLabel,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
  changeLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={enabled} onChange={onToggle} aria-label={`${changeLabel} ${label}`} />
          <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{changeLabel}</span>
        </label>
      </div>
      <div className={cn(!enabled && 'opacity-40 pointer-events-none')}>
        {children}
      </div>
    </div>
  );
}

function FlagRow({
  label, enabled, onToggleEnabled, value, onChangeValue, tone, changeLabel,
}: {
  label: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  value: boolean;
  onChangeValue: (v: boolean) => void;
  tone?: 'rose' | 'amber';
  changeLabel: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{label}</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <Switch checked={enabled} onChange={onToggleEnabled} aria-label={`${changeLabel} ${label}`} />
        <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{changeLabel}</span>
      </label>
      <div className={cn('flex items-center gap-2', !enabled && 'opacity-40 pointer-events-none')}>
        <Switch checked={value} onChange={onChangeValue} tone={tone} aria-label={label} />
        <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">
          {value ? 'ON' : 'OFF'}
        </span>
      </div>
    </div>
  );
}
