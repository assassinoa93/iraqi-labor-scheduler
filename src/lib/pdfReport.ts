import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Employee, Schedule, Shift, Config, Violation, Station } from '../types';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap } from './payroll';

// jsPDF cannot render right-to-left Arabic glyphs without a custom font, so the
// PDF is always generated in English (matching the convention used by Iraqi
// regulators who accept English-language submissions). The `t` translator is
// passed in so the *labels* track the user's locale where rendering allows.
type Translator = (key: string, vars?: Record<string, string | number>) => string;

export const generatePDFReport = (
  employees: Employee[],
  schedule: Schedule,
  shifts: Shift[],
  config: Config,
  violations: Violation[],
  stations: Station[],
  t: Translator = (k) => k,
) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3'
  });

  const shiftMap = new Map(shifts.map(s => [s.code, s]));
  const stationMap = new Map(stations.map(s => [s.id, s]));

  // --- Title ---
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(`${config.company} - ${t('pdf.title')}`, 20, 20);

  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text(`${t('pdf.period')}: ${format(new Date(config.year, config.month - 1), 'MMMM yyyy')} | ${t('pdf.generated')}: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 20, 30);

  // --- Schedule Grid Summary ---
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(t('pdf.section.roster'), 20, 45);

  const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);
  const head = [[t('pdf.col.personnel'), ...days.map(String)]];
  
  const body = employees.map(emp => {
    const row = [emp.name];
    days.forEach(day => {
      const entry = schedule[emp.empId]?.[day];
      const code = typeof entry === 'string' ? entry : entry?.shiftCode;
      row.push(code || '-');
    });
    return row;
  });

  autoTable(doc, {
    head,
    body,
    startY: 50,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold', minCellWidth: 40 } },
    margin: { left: 15, right: 15 }
  });

  // --- Compliance Summary ---
  doc.addPage('a4', 'portrait');
  doc.setFontSize(18);
  doc.text(t('pdf.section.compliance'), 15, 20);

  const violationData = violations.map(v => {
    const emp = employees.find(e => e.empId === v.empId);
    return [
      emp?.name || v.empId,
      v.count && v.count > 1 ? `Multiple / x${v.count}` : `Day ${v.day}`,
      v.rule,
      v.article,
      v.count && v.count > 1 ? `${v.message} (${v.count} occurrences)` : v.message
    ];
  });

  autoTable(doc, {
    head: [[
      t('pdf.col.personnel'),
      t('pdf.col.occurrence'),
      t('pdf.col.rule'),
      t('pdf.col.article'),
      t('pdf.col.description'),
    ]],
    body: violationData,
    startY: 30,
    theme: 'striped',
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 9 }
  });

  // --- Employee Performance & Credits ---
  const auditY = (doc as any).lastAutoTable.finalY + 15;
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(t('pdf.section.performance'), 15, auditY);

  const holidayDates = new Set(config.holidays?.map(h => h.date) || []);

  const performanceData = employees.map(emp => {
    const empSched = schedule[emp.empId] || {};
    let totalHrsCount = 0;
    let holidayOTHours = 0;
    
    Object.entries(empSched).forEach(([day, entry]) => {
      const dateStr = format(new Date(config.year, config.month - 1, parseInt(day)), 'yyyy-MM-dd');
      const isHoli = !!config.holidays?.find(h => h.date === dateStr);
      const shift = shiftMap.get(entry?.shiftCode ?? '');
      if (shift?.isWork) {
        totalHrsCount += shift.durationHrs;
        if (isHoli) holidayOTHours += shift.durationHrs;
      }
    });

    const baseMonthly = emp.baseMonthlySalary || DEFAULT_MONTHLY_SALARY_IQD;
    const baseHourRate = baseHourlyRate(emp, config);
    const cap = monthlyHourCap(config);
    const stdOTHours = Math.max(0, totalHrsCount - cap - holidayOTHours);

    const stdOTPay = stdOTHours * baseHourRate * (config.otRateDay ?? 1.5);
    const holiOTPay = holidayOTHours * baseHourRate * (config.otRateNight ?? 2.0);
    const totalOTPay = stdOTPay + holiOTPay;
    const netPay = baseMonthly + totalOTPay;

    return [
      emp.name,
      emp.role,
      `${totalHrsCount.toFixed(1)}h`,
      `${baseMonthly.toLocaleString()}`,
      totalHrsCount > cap ? t('common.yes') : t('common.no'),
      `${Math.round(totalOTPay).toLocaleString()} IQD`,
      `${Math.round(netPay).toLocaleString()} IQD`,
      emp.holidayBank || 0,
      emp.annualLeaveBalance || 0
    ];
  });

  autoTable(doc, {
    head: [[
      t('pdf.col.personnel'),
      t('pdf.col.role'),
      t('pdf.col.hours'),
      t('pdf.col.salary'),
      t('pdf.col.otFlag'),
      t('pdf.col.otPay'),
      t('pdf.col.netPay'),
      t('pdf.col.bank'),
      t('pdf.col.al'),
    ]],
    body: performanceData,
    startY: auditY + 5,
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 }
  });

  // --- Operational Statistics ---
  const statsY = (doc as any).lastAutoTable.finalY + 15;
  doc.setFontSize(14);
  doc.text(t('pdf.section.allocation'), 15, statsY);
  
  const stationAlloc = stations.map(st => {
    const assignedCount = employees.filter(emp => {
      // Logic for total assigned to this station in the month (at least once)
      return Object.values(schedule[emp.empId] || {}).some(entry => {
        const sid = typeof entry === 'string' ? null : entry?.stationId;
        return sid === st.id;
      });
    }).length;

    return [st.name, `Normal: ${st.normalMinHC} / Peak: ${st.peakMinHC}`, `${assignedCount} Total Personnel`];
  });

  autoTable(doc, {
    head: [[t('pdf.col.station'), t('pdf.col.minHC'), t('pdf.col.assigned')]],
    body: stationAlloc,
    startY: statsY + 5,
    theme: 'plain',
    headStyles: { fillColor: [51, 65, 85], textColor: 255 }
  });

  doc.save(`${config.company}_Report_${config.year}_${config.month}.pdf`);
};
