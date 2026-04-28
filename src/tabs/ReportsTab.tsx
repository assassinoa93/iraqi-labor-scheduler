import React from 'react';
import { Download, FileSpreadsheet, Database, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Schedule, Shift, Config, Violation } from '../types';
import { Card } from '../components/Primitives';
import { useI18n } from '../lib/i18n';

interface ReportsTabProps {
  employees: Employee[];
  schedule: Schedule;
  shifts: Shift[];
  config: Config;
  violations: Violation[];
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function ReportsTab({ employees, schedule, shifts, config, violations, onExportPDF, onExportCSV }: ReportsTabProps) {
  const { t } = useI18n();
  const totalChecks = employees.length * config.daysInMonth * 3;
  const totalViolationInstances = violations.reduce((s, v) => s + (v.count || 1), 0);
  const compliancePct = totalChecks === 0
    ? '100%'
    : `${Math.max(0, Math.round(100 - (totalViolationInstances / Math.max(totalChecks, 1)) * 100))}%`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('reports.title')}</h3>
        <p className="text-xs text-slate-400 font-medium tracking-widest font-mono">{t('reports.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-8 space-y-6 border-slate-200">
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-slate-800 text-lg tracking-tight">{t('reports.pdf.title')}</h4>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">{t('reports.pdf.body')}</p>
          </div>
          <button
            onClick={onExportPDF}
            className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            {t('reports.pdf.button')}
          </button>
        </Card>

        <Card className="p-8 space-y-6 border-slate-200">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100">
            <Database className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-slate-800 text-lg tracking-tight">{t('reports.csv.title')}</h4>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">{t('reports.csv.body')}</p>
          </div>
          <button
            onClick={onExportCSV}
            className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" />
            {t('reports.csv.button')}
          </button>
        </Card>
      </div>

      <div className="mt-8 space-y-4">
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Sparkles className="w-3 h-3" /> {t('reports.previewLabel')}
        </h4>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[300px]">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
            <div>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{config.company}</p>
              <h5 className="font-bold text-slate-800">{t('reports.previewHeader')}</h5>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{format(new Date(config.year, config.month - 1), 'MMMM yyyy')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-1">{t('reports.preview.totalPersonnel')}</p>
                <p className="text-2xl font-light text-slate-900">{employees.length}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-1">{t('reports.preview.complianceScore')}</p>
                <p className="text-2xl font-light text-emerald-600">{compliancePct}</p>
              </div>
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50">
                <p className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter mb-1">{t('reports.preview.coverageStatus')}</p>
                <p className="text-[10px] font-bold text-emerald-700 uppercase">{t('reports.preview.authenticated')}</p>
              </div>
            </div>

            <div className="overflow-hidden border border-slate-100 rounded-lg">
              <table className="w-full text-start text-[9px]">
                <thead className="bg-slate-50 font-bold uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-2">{t('roster.col.id')}</th>
                    <th className="px-4 py-2">{t('roster.col.name')}</th>
                    <th className="px-4 py-2">{t('reports.preview.totalHours')}</th>
                    <th className="px-4 py-2">{t('dashboard.kpi.violations')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {employees.slice(0, 5).map(emp => {
                    const empViolations = violations.filter(v => v.empId === emp.empId);
                    const totalHours = Object.values(schedule[emp.empId] || {}).reduce<number>((sum, entry) => {
                      const shift = shifts.find(s => s.code === entry.shiftCode);
                      return sum + (shift?.durationHrs || 0);
                    }, 0);
                    return (
                      <tr key={emp.empId}>
                        <td className="px-4 py-2 font-mono">{emp.empId}</td>
                        <td className="px-4 py-2 font-bold">{emp.name}</td>
                        <td className="px-4 py-2">{totalHours}h</td>
                        <td className={`px-4 py-2 font-bold ${empViolations.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                          {empViolations.length}
                        </td>
                      </tr>
                    );
                  })}
                  {employees.length > 5 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-center text-slate-300 italic font-medium tracking-tight">
                        + {employees.length - 5} {t('reports.preview.moreRecords')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
