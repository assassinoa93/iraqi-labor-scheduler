import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Employee, Schedule, Shift, Config, Violation, Station } from '../types';

export const generatePDFReport = (
  employees: Employee[],
  schedule: Schedule,
  shifts: Shift[],
  config: Config,
  violations: Violation[],
  stations: Station[]
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
  doc.text(`${config.company} - Workforce Compliance Report`, 20, 20);
  
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text(`Period: ${format(new Date(config.year, config.month - 1), 'MMMM yyyy')} | Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 20, 30);

  // --- Schedule Grid Summary ---
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Master Duty Roster', 20, 45);

  const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);
  const head = [['Employee', ...days.map(String)]];
  
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
  doc.text('Compliance & Audit Summary', 15, 20);

  const violationData = violations.map(v => {
    const emp = employees.find(e => e.empId === v.empId);
    return [
      emp?.name || v.empId,
      `Day ${v.day}`,
      v.rule,
      v.article,
      v.message
    ];
  });

  autoTable(doc, {
    head: [['Personnel', 'Occurrence', 'Rule', 'Article', 'Description']],
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
  doc.text('Personnel Performance & Credits', 15, auditY);

  const holidayDates = new Set(config.holidays?.map(h => {
    const d = new Date(h.date);
    return d.getDate();
  }) || []);

  const performanceData = employees.map(emp => {
    const totalHrsCount = Object.values(schedule[emp.empId] || {}).reduce((sum, entry) => {
      const shift = shiftMap.get((entry as any)?.shiftCode || '');
      return sum + (shift?.durationHrs || 0);
    }, 0);
    const basePay = emp.baseMonthlySalary || 1500000;
    const otHours = Math.max(0, totalHrsCount - (48 * 4)); 
    const otPay = otHours * (emp.baseHourlyRate || 7500) * 1.5;
    const isOtEligible = totalHrsCount > (48 * 4);

    return [
      emp.name,
      emp.role,
      `${totalHrsCount.toFixed(1)}h`,
      `${(emp.baseMonthlySalary || 1500000).toLocaleString()}`,
      isOtEligible ? "YES" : "NO",
      `${otPay.toLocaleString()} IQD`,
      `${(basePay + otPay).toLocaleString()} IQD`,
      emp.holidayCredits || 0
    ];
  });

  autoTable(doc, {
    head: [['Personnel', 'Role', 'Hours', 'Salary', 'OT?', 'OT Pay', 'Net Pay', 'Credits']],
    body: performanceData,
    startY: auditY + 5,
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 }
  });

  // --- Operational Statistics ---
  const statsY = (doc as any).lastAutoTable.finalY + 15;
  doc.setFontSize(14);
  doc.text('Resource Allocation', 15, statsY);
  
  const stationAlloc = stations.map(st => {
    const assignedCount = employees.filter(emp => {
      // Logic for total assigned to this station in the month (at least once)
      return Object.values(schedule[emp.empId] || {}).some(entry => {
        const sid = typeof entry === 'string' ? null : entry?.stationId;
        return sid === st.id;
      });
    }).length;

    return [st.name, `${st.minHC} Staff/Hr`, `${assignedCount} Total Personnel`];
  });

  autoTable(doc, {
    head: [['Station/POS', 'Required Min HC', 'Assigned Personnel']],
    body: stationAlloc,
    startY: statsY + 5,
    theme: 'plain',
    headStyles: { fillColor: [51, 65, 85], textColor: 255 }
  });

  doc.save(`${config.company}_Report_${config.year}_${config.month}.pdf`);
};
