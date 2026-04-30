import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Station, StationGroup, Config, Shift } from '../types';
import { cn } from '../lib/utils';
import { SettingField } from './Primitives';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHoursDivisor } from '../lib/payroll';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (emp: Employee) => void;
  employee: Employee | null;
  stations: Station[];
  // v2.2.0 — station groups available for group-level eligibility. The
  // auto-scheduler treats a groupId in `eligibleGroups` as "open
  // eligibility for every station in this group" so the supervisor
  // doesn't have to re-tick each station individually after defining a
  // new group.
  stationGroups: StationGroup[];
  shifts: Shift[];
  config: Pick<Config, 'standardWeeklyHrsCap'>;
}

const empty = (config: Pick<Config, 'standardWeeklyHrsCap'>): Employee => {
  const seed: Employee = {
    empId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
    name: '',
    role: '',
    department: '',
    contractType: 'Permanent',
    contractedWeeklyHrs: config.standardWeeklyHrsCap,
    shiftEligibility: 'All',
    isHazardous: false,
    isIndustrialRotating: true,
    hourExempt: false,
    fixedRestDay: 0,
    phone: '',
    hireDate: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
    eligibleStations: [],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: DEFAULT_MONTHLY_SALARY_IQD,
    baseHourlyRate: 0,
    overtimeHours: 0,
    category: 'Standard',
    preferredShiftCodes: [],
    avoidShiftCodes: [],
  };
  seed.baseHourlyRate = Math.round(baseHourlyRate(seed, config));
  return seed;
};

export function EmployeeModal({ isOpen, onClose, onSave, employee, stations, stationGroups, shifts, config }: EmployeeModalProps) {
  const { t } = useI18n();
  // useModalKeys handles Escape; initial focus is wired to the first
  // input below (not the close button) so pressing Enter after open
  // doesn't dismiss the modal. The hook still returns a ref but we
  // park it on a no-op element since `cardRef` drives initial focus.
  useModalKeys(isOpen, onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [formData, setFormData] = useState<Employee>(() => empty(config));

  useEffect(() => {
    if (isOpen) {
      // Backfill `category` for v1.1 records that don't carry it.
      setFormData(employee ? { category: 'Standard', ...employee } : empty(config));
      // Defer focus past the mount tick so it lands on the first form
      // input rather than racing with the document focus.
      const t = window.setTimeout(() => {
        const firstInput = cardRef.current?.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
        firstInput?.focus();
        firstInput?.select?.();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [employee, isOpen, config]);

  if (!isOpen) return null;

  // v2.3.0 — group + station eligibility now share a unified mental model.
  // Toggling a group ON gives the employee blanket coverage of every member
  // station (and any station ADDED to that group later). The supervisor can
  // then click a single station to revoke just that one — internally we
  // "expand" the group into per-station IDs minus the excluded one, so the
  // exclusion is durable. Clicking the group again turns the whole thing
  // off (and any per-station residue is wiped).
  const stationsByGroup = (gid: string) => stations.filter(s => s.groupId === gid).map(s => s.id);

  const toggleGroup = (gid: string) => {
    setFormData(prev => {
      const groups = prev.eligibleGroups || [];
      const memberIds = stationsByGroup(gid);
      if (groups.includes(gid)) {
        // Group is currently providing blanket coverage. Turn it off and
        // clear any per-station residue for its members.
        return {
          ...prev,
          eligibleGroups: groups.filter(g => g !== gid),
          eligibleStations: prev.eligibleStations.filter(sid => !memberIds.includes(sid)),
        };
      }
      // Promote any partial per-station selection up to blanket group
      // coverage. Drop the now-redundant per-station IDs.
      return {
        ...prev,
        eligibleGroups: [...groups, gid],
        eligibleStations: prev.eligibleStations.filter(sid => !memberIds.includes(sid)),
      };
    });
  };

  const toggleStation = (id: string) => {
    setFormData(prev => {
      const station = stations.find(s => s.id === id);
      const groups = prev.eligibleGroups || [];
      const coveredByGroup = !!(station?.groupId && groups.includes(station.groupId));
      if (coveredByGroup) {
        // The clicked station is covered via a group. "Expand" the group
        // into per-station IDs, then drop just this one so the rest of the
        // group stays selected.
        const gid = station!.groupId!;
        const otherMembers = stationsByGroup(gid).filter(sid => sid !== id);
        return {
          ...prev,
          eligibleGroups: groups.filter(g => g !== gid),
          eligibleStations: [
            ...prev.eligibleStations.filter(sid => sid !== id),
            ...otherMembers.filter(sid => !prev.eligibleStations.includes(sid)),
          ],
        };
      }
      return {
        ...prev,
        eligibleStations: prev.eligibleStations.includes(id)
          ? prev.eligibleStations.filter(sid => sid !== id)
          : [...prev.eligibleStations, id],
      };
    });
  };

  // Summary helpers for the eligibility section header — answers
  // "how many stations is this employee actually eligible for right now?"
  const totalStationsCovered = (() => {
    const groups = formData.eligibleGroups || [];
    const ids = new Set(formData.eligibleStations);
    for (const g of groups) for (const sid of stationsByGroup(g)) ids.add(sid);
    return ids.size;
  })();

  const clearAllEligibility = () => {
    setFormData(prev => ({ ...prev, eligibleStations: [], eligibleGroups: [] }));
  };

  const selectAllStations = () => {
    setFormData(prev => ({
      ...prev,
      eligibleGroups: [],
      eligibleStations: stations.map(s => s.id),
    }));
  };

  const togglePreferred = (code: string) => {
    setFormData(prev => {
      const current = prev.preferredShiftCodes || [];
      const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
      // Mutually exclusive with avoid — a preferred shift can't also be avoided.
      const avoid = (prev.avoidShiftCodes || []).filter(c => c !== code);
      return { ...prev, preferredShiftCodes: next, avoidShiftCodes: avoid };
    });
  };

  const toggleAvoid = (code: string) => {
    setFormData(prev => {
      const current = prev.avoidShiftCodes || [];
      const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
      const preferred = (prev.preferredShiftCodes || []).filter(c => c !== code);
      return { ...prev, avoidShiftCodes: next, preferredShiftCodes: preferred };
    });
  };

  const workShifts = shifts.filter(s => s.isWork);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={employee ? t('modal.employee.title.edit') : t('modal.employee.title.new')}>
      <motion.div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {employee ? t('modal.employee.title.edit') : t('modal.employee.title.new')}
          </h3>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-6">
            <SettingField label={t('modal.employee.field.id')} value={formData.empId} onChange={v => setFormData({...formData, empId: v})} />
            <SettingField label={t('modal.employee.field.name')} value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label={t('modal.employee.field.role')} value={formData.role} onChange={v => setFormData({...formData, role: v})} />
            <SettingField label={t('modal.employee.field.department')} value={formData.department} onChange={v => setFormData({...formData, department: v})} />
            <SettingField label={t('modal.employee.field.contract')} type="select" options={['Permanent', 'Fixed-Term', 'Contractor']} value={formData.contractType} onChange={v => setFormData({...formData, contractType: v})} />
            <SettingField label={t('modal.employee.field.weeklyHours')} type="number" value={formData.contractedWeeklyHrs} onChange={v => {
              const weekly = parseInt(v) || 0;
              setFormData(prev => ({
                ...prev,
                contractedWeeklyHrs: weekly,
                baseHourlyRate: Math.round(baseHourlyRate({ ...prev, contractedWeeklyHrs: weekly }, config)),
              }));
            }} />
            <SettingField label={t('modal.employee.field.phone')} value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
            <SettingField label={t('modal.employee.field.hireDate')} value={formData.hireDate} onChange={v => setFormData({...formData, hireDate: v})} />
            <SettingField
              label={t('modal.employee.field.salary')}
              type="number"
              value={formData.baseMonthlySalary}
              onChange={v => {
                const salary = parseInt(v) || 0;
                setFormData(prev => ({
                  ...prev,
                  baseMonthlySalary: salary,
                  baseHourlyRate: Math.round(baseHourlyRate({ ...prev, baseMonthlySalary: salary }, config)),
                }));
              }}
            />
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.employee.field.otHourlyRate')}</label>
              <div className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-500 dark:text-slate-400 shadow-sm flex justify-between items-center">
                 <span>{formData.baseHourlyRate.toLocaleString()} IQD</span>
                 <span className="text-[8px] bg-blue-100 dark:bg-blue-500/25 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded font-black tracking-widest">AUTO: (SALARY / {monthlyHoursDivisor(formData, config)})</span>
              </div>
            </div>
            <SettingField label={t('modal.employee.field.holidayBank')} type="number" value={formData.holidayBank} onChange={v => setFormData({...formData, holidayBank: Math.max(0, parseInt(v) || 0)})} />
            <SettingField label={t('modal.employee.field.annualLeave')} type="number" value={formData.annualLeaveBalance} onChange={v => setFormData({...formData, annualLeaveBalance: Math.max(0, parseInt(v) || 0)})} />
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.employee.field.restPolicy')}</label>
              <select
                value={formData.fixedRestDay}
                onChange={e => setFormData({...formData, fixedRestDay: parseInt(e.target.value) || 0})}
                className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value={0}>{t('modal.employee.rest.rotate')}</option>
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                  <option key={i} value={i + 1}>{t('modal.employee.rest.fixed')} {d}</option>
                ))}
              </select>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
                {formData.fixedRestDay === 0
                  ? t('modal.employee.rest.help.rotate')
                  : t('modal.employee.rest.help.fixed')}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.employee.field.category')}</label>
              <select
                value={formData.category || 'Standard'}
                onChange={e => setFormData({...formData, category: e.target.value as 'Standard' | 'Driver'})}
                className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value="Standard">{t('modal.employee.cat.standard')}</option>
                <option value="Driver">{t('modal.employee.cat.driver')}</option>
              </select>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
                {formData.category === 'Driver'
                  ? t('modal.employee.cat.help.driver')
                  : t('modal.employee.cat.help.standard')}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.employee.field.gender')}</label>
              <select
                value={formData.gender || ''}
                onChange={e => setFormData({...formData, gender: (e.target.value || undefined) as 'M' | 'F' | undefined})}
                className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value="">{t('modal.employee.gender.unset')}</option>
                <option value="M">{t('modal.employee.gender.male')}</option>
                <option value="F">{t('modal.employee.gender.female')}</option>
              </select>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
                {t('modal.employee.gender.note')}
              </p>
            </div>
          </div>

          {/* v2.3.0 — eligibility refactored into a single section with a
              live coverage counter. Group chips fill in every member
              station automatically; clicking a station chip "carves out"
              an exception (turning that one off without losing the rest
              of the group). The two surfaces aren't redundant any more —
              groups are the bulk control, stations are the carve-outs. */}
          {stationGroups.length > 0 && (
            <div className="space-y-3 p-4 bg-emerald-50/40 dark:bg-emerald-500/10 rounded-lg border border-emerald-100 dark:border-emerald-500/30">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('modal.employee.groupEligibility.title')}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">{t('modal.employee.groupEligibility.note')}</p>
                </div>
                <span className="text-[9px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full shrink-0 tracking-widest uppercase">
                  {t('modal.employee.eligibility.coversCount', { count: totalStationsCovered, total: stations.length })}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {stationGroups.map(g => {
                  const memberIds = stationsByGroup(g.id);
                  const active = (formData.eligibleGroups || []).includes(g.id);
                  const carvedMembers = memberIds.filter(id => formData.eligibleStations.includes(id));
                  // "Partial" = group is OFF but some member stations are
                  // individually selected (i.e. carve-outs from a previous
                  // expand). Visually softer than fully-on.
                  const partial = !active && carvedMembers.length > 0;
                  return (
                    <button
                      key={g.id}
                      onClick={() => toggleGroup(g.id)}
                      type="button"
                      title={active
                        ? t('modal.employee.groupEligibility.tooltip.full')
                        : partial
                          ? t('modal.employee.groupEligibility.tooltip.partial', { count: carvedMembers.length, total: memberIds.length })
                          : t('modal.employee.groupEligibility.tooltip.empty')}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all border',
                        active
                          ? 'border-transparent text-white shadow-sm'
                          : partial
                            ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-200'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300 dark:hover:border-emerald-500/40',
                      )}
                      style={active && g.color ? { backgroundColor: g.color, borderColor: g.color } : undefined}
                    >
                      <Plus className={cn('w-3 h-3', active && 'rotate-45')} />
                      <span className="truncate">{g.name}</span>
                      <span className={cn('text-[9px] font-mono', active ? 'opacity-80' : 'text-slate-400 dark:text-slate-500')}>
                        {partial ? `${carvedMembers.length}/${memberIds.length}` : `· ${memberIds.length}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3 p-4 bg-blue-50/30 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] font-bold text-blue-500 dark:text-blue-300 uppercase tracking-widest">{t('modal.employee.stationEligibility')}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={selectAllStations}
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors"
                  title={t('modal.employee.eligibility.selectAll.tooltip')}
                >
                  {t('modal.employee.eligibility.selectAll')}
                </button>
                <button
                  type="button"
                  onClick={clearAllEligibility}
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:border-rose-300 dark:hover:border-rose-500/40 transition-colors"
                  title={t('modal.employee.eligibility.clearAll.tooltip')}
                >
                  {t('modal.employee.eligibility.clearAll')}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stations.map(st => {
                const directlyOn = formData.eligibleStations.includes(st.id);
                const groupCovered = !!(st.groupId && (formData.eligibleGroups || []).includes(st.groupId));
                const active = directlyOn || groupCovered;
                return (
                  <button
                    key={st.id}
                    onClick={() => toggleStation(st.id)}
                    type="button"
                    title={groupCovered
                      ? t('modal.employee.stationEligibility.tooltip.viaGroup')
                      : directlyOn
                        ? t('modal.employee.stationEligibility.tooltip.direct')
                        : t('modal.employee.stationEligibility.tooltip.empty')}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all border",
                      groupCovered
                        ? "bg-emerald-600 border-emerald-700 text-white shadow-sm"
                        : directlyOn
                          ? "bg-blue-600 border-blue-700 text-white shadow-sm"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-blue-300 dark:hover:border-blue-500/40"
                    )}
                  >
                    <Plus className={cn("w-3 h-3", active && "rotate-45")} />
                    {st.name}
                  </button>
                );
              })}
              {stations.length === 0 && <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium col-span-3">{t('modal.employee.stations.empty')}</p>}
            </div>
          </div>

          <div className="space-y-3 p-4 bg-indigo-50/30 dark:bg-indigo-500/10 rounded-lg border border-indigo-100 dark:border-indigo-500/30">
            <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 uppercase tracking-widest">{t('modal.employee.preferences.title')}</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('modal.employee.preferences.note')}</p>
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('modal.employee.preferences.preferred')}</p>
              <div className="flex flex-wrap gap-2">
                {workShifts.map(s => {
                  const active = (formData.preferredShiftCodes || []).includes(s.code);
                  return (
                    <button
                      key={s.code}
                      onClick={() => togglePreferred(s.code)}
                      type="button"
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
                        active
                          ? "bg-emerald-600 border-emerald-700 text-white shadow-sm"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300 dark:hover:border-emerald-500/40"
                      )}
                    >
                      {s.code} · {s.start}–{s.end}
                    </button>
                  );
                })}
                {workShifts.length === 0 && <p className="text-[10px] text-slate-400 dark:text-slate-500">{t('modal.employee.shifts.empty')}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-rose-700 dark:text-rose-200 uppercase tracking-widest">{t('modal.employee.preferences.avoid')}</p>
              <div className="flex flex-wrap gap-2">
                {workShifts.map(s => {
                  const active = (formData.avoidShiftCodes || []).includes(s.code);
                  return (
                    <button
                      key={s.code}
                      onClick={() => toggleAvoid(s.code)}
                      type="button"
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
                        active
                          ? "bg-rose-600 border-rose-700 text-white shadow-sm"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-rose-300 dark:hover:border-rose-500/40"
                      )}
                    >
                      {s.code} · {s.start}–{s.end}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
             <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={formData.isHazardous} onChange={v => setFormData({...formData, isHazardous: v})} tone="rose" aria-label={t('modal.employee.flag.hazardous')} />
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{t('modal.employee.flag.hazardous')}</span>
             </label>
             <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={formData.isIndustrialRotating} onChange={v => setFormData({...formData, isIndustrialRotating: v})} tone="amber" aria-label={t('modal.employee.flag.industrial')} />
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{t('modal.employee.flag.industrial')}</span>
             </label>
             <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={formData.hourExempt} onChange={v => setFormData({...formData, hourExempt: v})} aria-label={t('modal.employee.flag.exempt')} />
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{t('modal.employee.flag.exempt')}</span>
             </label>
          </div>

          {/* Leave windows (sick / annual / maternity) are managed from the
              Credits & Payroll tab, where leaves can span multiple ranges and
              be tracked per request. The single-range fields previously here
              were misleading. */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('modal.employee.leaves.movedNote')}
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.employee.notes')}</label>
            <textarea
              className="w-full p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm min-h-[100px] focus:ring-1 focus:ring-blue-500 outline-none"
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
              placeholder={t('modal.employee.notes.placeholder')}
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-sm font-bold hover:bg-slate-800 dark:hover:bg-white transition-all shadow-lg uppercase tracking-widest"
          >
            {t('modal.employee.commit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
