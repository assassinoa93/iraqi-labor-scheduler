import React, { useMemo, useState } from 'react';
import { Search, Trash2, Plus, Users, Edit3, CalendarRange, FileSpreadsheet, Download } from 'lucide-react';
import { Employee, Station, StationGroup } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { SortableHeader, SortDir } from '../components/Primitives';

interface RosterTabProps {
  employees: Employee[];
  stations: Station[];
  // v2.1.2: station groups for rendering eligibleGroups chips. A
  // group-eligible employee with empty `eligibleStations` previously
  // rendered as "Unassigned" even though the auto-scheduler considered
  // them eligible for every station in the group.
  stationGroups?: StationGroup[];
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  selectedEmployees: Set<string>;
  toggleEmployeeSelection: (id: string) => void;
  setSelectedEmployees: React.Dispatch<React.SetStateAction<Set<string>>>;
  onAddNew: () => void;
  onEdit: (emp: Employee) => void;
  onDelete: (empId: string) => void;
  onBulkDelete: () => void;
  onLoadSample: () => void;
  onBulkAssignShift?: () => void;
  // v4.2.1 — moved from the global toolbar so roster operations live with
  // the roster. `onMassImport` opens the OS file picker (the actual file
  // input + parser stays in App.tsx since it uses several App-level
  // helpers); `onDownloadTemplate` saves a CSV template to disk.
  onMassImport?: () => void;
  onDownloadTemplate?: () => void;
}

type SortKey = 'empId' | 'name' | 'role';

export function RosterTab({
  employees, stations, stationGroups = [], searchTerm, setSearchTerm,
  selectedEmployees, toggleEmployeeSelection, setSelectedEmployees,
  onAddNew, onEdit, onDelete, onBulkDelete, onLoadSample, onBulkAssignShift,
  onMassImport, onDownloadTemplate,
}: RosterTabProps) {
  const { t } = useI18n();

  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Roles available in the dropdown — derived from current roster so a new
  // role like "Security Guard" appears as soon as one employee carries it.
  const roles = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    return Array.from(set).sort();
  }, [employees]);

  const handleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k as SortKey); setSortDir('asc'); }
  };

  // Filter (search + role) then sort. Done in a memo so re-renders driven by
  // unrelated state (modal open/close) don't redo this work.
  const visible = useMemo(() => {
    const q = searchTerm.toLowerCase();
    let list = employees.filter(e => {
      if (roleFilter !== 'all' && e.role !== roleFilter) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q)
        || e.empId.toLowerCase().includes(q)
        || e.department.toLowerCase().includes(q);
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const va = (a[sortKey] || '').toString().toLowerCase();
        const vb = (b[sortKey] || '').toString().toLowerCase();
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return list;
  }, [employees, searchTerm, roleFilter, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder={t('roster.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label={t('schedule.allRoles')}
            className="px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
          >
            <option value="all">{t('schedule.allRoles')}</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(searchTerm || roleFilter !== 'all') && (
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {visible.length}/{employees.length}
            </span>
          )}
          {selectedEmployees.size > 0 && onBulkAssignShift && (
            <button
              onClick={onBulkAssignShift}
              className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 px-4 py-2 rounded-lg font-bold text-[10px] uppercase border border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 transition-all font-mono"
            >
              <CalendarRange className="w-3.5 h-3.5" />
              {t('roster.bulkAssign')} ({selectedEmployees.size})
            </button>
          )}
          {selectedEmployees.size > 0 && (
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-2 bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg font-bold text-[10px] uppercase border border-red-100 dark:border-red-500/30 hover:bg-red-100 dark:hover:bg-red-500/25 transition-all font-mono"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('roster.bulkDelete')} ({selectedEmployees.size})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onDownloadTemplate && (
            <button
              onClick={onDownloadTemplate}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {t('toolbar.csvTemplate')}
            </button>
          )}
          {onMassImport && (
            <button
              onClick={onMassImport}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('toolbar.massImport')}
            </button>
          )}
          <button
            onClick={onAddNew}
            className="flex items-center gap-2 bg-slate-900 dark:bg-slate-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600 transition-all shadow-xl active:scale-95 whitespace-nowrap min-w-fit"
          >
            <Plus className="w-4 h-4" />
            {t('roster.addEmployee')}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/40 text-[10px] uppercase text-slate-400 dark:text-slate-500 font-black border-b border-slate-100 dark:border-slate-700/60">
            <tr>
              <th className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedEmployees(new Set(visible.map(emp => emp.empId)));
                    } else {
                      setSelectedEmployees(new Set());
                    }
                  }}
                  checked={visible.length > 0 && visible.every(e => selectedEmployees.has(e.empId))}
                />
              </th>
              <SortableHeader label={t('roster.col.id')} sortKey="empId" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label={t('roster.col.name')} sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label={t('roster.col.role')} sortKey="role" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <th className="px-6 py-3 tracking-wider">{t('roster.col.stations')}</th>
              <th className="px-6 py-3 tracking-wider text-end">{t('roster.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="p-20 text-center">
                  <div className="max-w-xs mx-auto">
                    <Users className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                    <h3 className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-[10px]">{t('roster.emptyTitle')}</h3>
                    <p className="text-[10px] text-slate-300 dark:text-slate-600 font-medium uppercase tracking-tighter mt-1 mb-6">{t('roster.emptyHint')}</p>
                    <div className="flex gap-2 justify-center">
                      <button onClick={onAddNew} className="px-4 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600 transition-all">{t('roster.addManually')}</button>
                      <button onClick={onLoadSample} className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all">{t('roster.seedSample')}</button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {visible.length === 0 && employees.length > 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  {t('schedule.noMatches')}
                </td>
              </tr>
            )}
            {visible.map((emp) => (
              <tr key={emp.empId} className={cn("hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group", selectedEmployees.has(emp.empId) && "bg-blue-50/30 dark:bg-blue-500/10")}>
                <td className="px-4 py-4 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Select ${emp.name}`}
                    checked={selectedEmployees.has(emp.empId)}
                    onChange={() => toggleEmployeeSelection(emp.empId)}
                  />
                </td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-slate-400 dark:text-slate-500 tracking-tighter">{emp.empId}</td>
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-800 dark:text-slate-100">{emp.name}</p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-tighter mt-0.5">{emp.contractType}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-700 dark:text-slate-200 text-xs">{emp.role}</p>
                    {emp.category === 'Driver' && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/25 text-amber-700 dark:text-amber-200 text-[8px] font-black uppercase tracking-widest border border-amber-200 dark:border-amber-500/40">
                        {t('roster.tag.driver')}
                      </span>
                    )}
                    {(!emp.fixedRestDay || emp.fixedRestDay === 0) && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 text-[8px] font-black uppercase tracking-widest border border-blue-100 dark:border-blue-500/30">
                        {t('roster.tag.rotate')}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-tighter">{emp.department}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {/* Group chips first — they cover N stations in one
                        token, so showing them up front explains a
                        "Cashier Group" employee at a glance instead of
                        listing every cashier station. Stations that
                        only fall under the group are not duplicated as
                        per-station chips. */}
                    {(emp.eligibleGroups || []).map(gid => {
                      const grp = stationGroups.find(g => g.id === gid);
                      if (!grp) return null;
                      return (
                        <span
                          key={gid}
                          className="px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase border"
                          style={{ backgroundColor: `${grp.color || '#94a3b8'}20`, borderColor: `${grp.color || '#94a3b8'}55`, color: grp.color || '#475569' }}
                          title={grp.description || grp.name}
                        >
                          {grp.name}
                        </span>
                      );
                    })}
                    {emp.eligibleStations?.map(sid => {
                      const st = stations.find(s => s.id === sid);
                      // Skip stations already covered by a group chip
                      // above to avoid visual duplication.
                      if (st?.groupId && (emp.eligibleGroups || []).includes(st.groupId)) return null;
                      return (
                        <span key={sid} className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase border border-slate-200 dark:border-slate-700">
                          {st?.name || sid}
                        </span>
                      );
                    })}
                    {(!emp.eligibleStations || emp.eligibleStations.length === 0) && (!emp.eligibleGroups || emp.eligibleGroups.length === 0) && (
                      <span className="text-[8px] text-slate-300 dark:text-slate-600 uppercase font-black tracking-widest">{t('roster.unassigned')}</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-end">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => onEdit(emp)} aria-label={t('roster.editEmployee', { name: emp.name })} className="p-1.5 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-500 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-700">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(emp.empId)} aria-label={t('roster.deleteEmployee', { name: emp.name })} className="p-1.5 bg-red-50 dark:bg-red-500/15 hover:bg-red-100 dark:hover:bg-red-500/25 rounded-md text-red-500 dark:text-red-300 transition-colors border border-red-100 dark:border-red-500/30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
