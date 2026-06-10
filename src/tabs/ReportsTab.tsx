import React from 'react';
import { Download, FileSpreadsheet, Database, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Schedule, Shift, Config, Violation } from '../types';
import { Button, Card } from '../components/Primitives';
import { FindingsList } from '../components/FindingsList';
import { complianceScore, countInstances } from '../lib/findings';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface ReportsTabProps {
  employees: Employee[];
  schedule: Schedule;
  shifts: Shift[];
  config: Config;
  violations: Violation[];
  notes: Violation[];
  // v5.27.0 — real station-coverage percentage (required HC actually filled
  // across operating hours) computed in App.tsx. Replaces the old hardcoded
  // "Authenticated" placeholder that conveyed nothing.
  overallCoveragePercent: number;
  hasScheduleData: boolean;
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function ReportsTab({ employees, schedule, shifts, config, violations, notes, overallCoveragePercent, hasScheduleData, onExportPDF, onExportCSV }: ReportsTabProps) {
  const { t, fmt } = useI18n();
  // v5.25 — shared canonical score + count so this matches the Dashboard,
  // preview modal, and approval dialog exactly.
  const score = complianceScore(employees.length, config.daysInMonth, countInstances(violations));
  const scoreColor = score >= 90
    ? 'text-emerald-600 dark:text-emerald-300'
    : score >= 75 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300';
  // v5.27.0 — colour the coverage tile by the same thresholds as the score so
  // a low fill rate reads as a warning, not a green "all good".
  const coverageColor = overallCoveragePercent >= 90
    ? 'text-emerald-600 dark:text-emerald-300'
    : overallCoveragePercent >= 75 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300';
  const empNameById = new Map(employees.map((e) => [e.empId, e.name]));
  // v5.40.0 — export guards. With zero employees both exports would produce
  // an empty/garbage artifact (header-only CSV, contentless PDF), so they
  // disable with a hint instead. CSV stays enabled when a roster exists but
  // no schedule yet — an empty-grid CSV is a legitimate "blank month" export;
  // the PDF is mostly schedule/compliance content, so it gets a hint.
  const noRoster = employees.length === 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight">{t('reports.title')}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-widest font-mono">{t('reports.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-8 space-y-6">
          <div className="w-12 h-12 bg-slate-900 dark:bg-slate-700 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg tracking-tight">{t('reports.pdf.title')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">{t('reports.pdf.body')}</p>
          </div>
          <Button
            onClick={onExportPDF}
            variant="primary"
            size="md"
            press
            fullWidth
            disabled={noRoster}
            className="py-3 shadow-lg"
          >
            <Download className="w-4 h-4" />
            {t('reports.pdf.button')}
          </Button>
          {noRoster ? (
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center -mt-3">{t('reports.export.noRoster')}</p>
          ) : !hasScheduleData ? (
            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest text-center -mt-3">{t('reports.export.noSchedule')}</p>
          ) : null}
        </Card>

        <Card className="p-8 space-y-6">
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-500/15 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30">
            <Database className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg tracking-tight">{t('reports.csv.title')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">{t('reports.csv.body')}</p>
          </div>
          <Button
            onClick={onExportCSV}
            variant="secondary"
            size="md"
            press
            fullWidth
            disabled={noRoster}
            className="py-3"
          >
            <Download className="w-4 h-4" />
            {t('reports.csv.button')}
          </Button>
          {noRoster && (
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center -mt-3">{t('reports.export.noRoster')}</p>
          )}
        </Card>
      </div>

      <div className="mt-8 space-y-4">
        <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Sparkles className="w-3 h-3" /> {t('reports.previewLabel')}
        </h4>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-6 shadow-sm min-h-[300px]">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-slate-700/60">
            <div>
              <p className="text-[10px] font-black text-blue-600 dark:text-blue-300 uppercase tracking-widest">{config.company}</p>
              <h5 className="font-bold text-slate-800 dark:text-slate-100">{t('reports.previewHeader')}</h5>
            </div>
            <div className="text-end">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">{format(new Date(config.year, config.month - 1), 'MMMM yyyy')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-100 dark:border-slate-700/60">
                <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter mb-1">{t('reports.preview.totalPersonnel')}</p>
                <p className="text-2xl font-light text-slate-900 dark:text-slate-50">{fmt.num(employees.length)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-100 dark:border-slate-700/60">
                <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter mb-1">{t('reports.preview.complianceScore')}</p>
                <p className={cn("text-2xl font-light", scoreColor)}>{fmt.num(score)}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-100 dark:border-slate-700/60">
                <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter mb-1">{t('reports.preview.coverageStatus')}</p>
                {hasScheduleData ? (
                  <p className={cn("text-2xl font-light", coverageColor)}>{fmt.num(overallCoveragePercent)}%</p>
                ) : (
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase pt-2">{t('reports.preview.noSchedule')}</p>
                )}
              </div>
            </div>

            <div className="overflow-hidden border border-slate-100 dark:border-slate-700/60 rounded-lg">
              <table className="w-full text-start text-[9px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 font-bold uppercase text-slate-400 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2">{t('roster.col.id')}</th>
                    <th className="px-4 py-2">{t('roster.col.name')}</th>
                    <th className="px-4 py-2">{t('reports.preview.totalHours')}</th>
                    <th className="px-4 py-2">{t('dashboard.kpi.violations')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {employees.slice(0, 5).map(emp => {
                    const empViolations = violations.filter(v => v.empId === emp.empId);
                    const totalHours = Object.values(schedule[emp.empId] || {}).reduce<number>((sum, entry) => {
                      const shift = shifts.find(s => s.code === entry.shiftCode);
                      return sum + (shift?.durationHrs || 0);
                    }, 0);
                    return (
                      <tr key={emp.empId}>
                        <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">{emp.empId}</td>
                        <td className="px-4 py-2 font-bold text-slate-800 dark:text-slate-100">{emp.name}</td>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{fmt.num(totalHours)}h</td>
                        <td className={cn('px-4 py-2 font-bold', empViolations.length > 0 ? 'text-red-500 dark:text-red-300' : 'text-emerald-500 dark:text-emerald-300')}>
                          {fmt.num(countInstances(empViolations))}
                        </td>
                      </tr>
                    );
                  })}
                  {employees.length > 5 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-center text-slate-300 dark:text-slate-600 italic font-medium tracking-tight">
                        + {fmt.num(employees.length - 5)} {t('reports.preview.moreRecords')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">{t('dashboard.complianceAudit')}</h3>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          <FindingsList
            findings={[...violations, ...(notes ?? [])]}
            empNameById={empNameById}
            hasContext={Object.keys(schedule).length > 0}
          />
        </div>
      </Card>
    </div>
  );
}
