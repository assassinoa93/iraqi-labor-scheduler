import React from 'react';
import { format } from 'date-fns';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../types';
import { useI18n } from '../lib/i18n';
import { getShiftColor } from '../lib/colors';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
}

// Print-only static rendering of the master schedule. Hidden in normal view
// (display: none from the .print-only utility class in index.css); shown when
// the browser switches to print media. Renders the full roster (no react-window
// virtualisation) so the printed page contains every row, not just whatever
// happened to be on screen.
export function PrintScheduleView({ employees, shifts, holidays, config, schedule }: Props) {
  const { t } = useI18n();
  const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);
  const holidayDates = new Set(holidays.map(h => h.date));
  const monthLabel = format(new Date(config.year, config.month - 1, 1), 'MMMM yyyy');

  // v5.18.0 — only render shift codes that actually appear in this month's
  // schedule, so the legend stays focused. Skip the falsy/empty placeholder
  // (unstaffed cells produce no code).
  const usedCodes = new Set<string>();
  for (const empSched of Object.values(schedule || {})) {
    for (const entry of Object.values(empSched || {})) {
      if (entry?.shiftCode) usedCodes.add(entry.shiftCode);
    }
  }
  const legendShifts = shifts
    .filter(s => usedCodes.has(s.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="print-only">
      <header className="print-header">
        <h1>{config.company || t('print.defaultCompany')}</h1>
        <p>{t('schedule.title')} — {monthLabel}</p>
        <p className="print-meta">{t('pdf.generated')}: {format(new Date(), 'yyyy-MM-dd HH:mm')} · {employees.length} {t('payroll.col.employee').toLowerCase()}</p>
      </header>
      <table className="print-schedule">
        <thead>
          <tr>
            <th className="print-name-col">{t('schedule.personnelDirectory')}</th>
            {days.map(d => {
              const date = new Date(config.year, config.month - 1, d);
              const dow = date.getDay();
              const isWeekend = dow === 5 || dow === 6; // Iraqi weekend Fri/Sat
              const dateStr = format(date, 'yyyy-MM-dd');
              const isHoli = holidayDates.has(dateStr);
              return (
                <th
                  key={d}
                  className={
                    'print-day-col' +
                    (isHoli ? ' print-holiday' : '') +
                    (isWeekend ? ' print-weekend' : '')
                  }
                >
                  <div>{d}</div>
                  <div className="print-dow">{format(date, 'EEEEE')}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.empId}>
              <td className="print-name-col">
                <strong>{emp.name}</strong>
                <span className="print-meta-inline">{emp.empId} · {emp.role}</span>
              </td>
              {days.map(d => {
                const entry = schedule[emp.empId]?.[d];
                const code = entry?.shiftCode || '';
                return (
                  <td
                    key={d}
                    className={'print-cell ' + (code ? getShiftColor(code).split(' ')[0] : '')}
                  >
                    {code}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {legendShifts.length > 0 && (
        <section className="print-legend">
          <h2 className="print-legend-title">{t('print.legend.title')}</h2>
          <table className="print-legend-table">
            <thead>
              <tr>
                <th>{t('print.legend.col.code')}</th>
                <th>{t('print.legend.col.name')}</th>
                <th>{t('print.legend.col.hours')}</th>
                <th>{t('print.legend.col.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {legendShifts.map(s => (
                <tr key={s.code}>
                  <td className={'print-legend-code ' + getShiftColor(s.code).split(' ')[0]}>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.start}–{s.end}</td>
                  <td>{s.durationHrs}h{s.breakMin ? ` · ${s.breakMin}m ${t('print.legend.break')}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer className="print-footer">
        <p>{t('reports.previewHeader')} · {monthLabel}</p>
      </footer>
    </div>
  );
}
