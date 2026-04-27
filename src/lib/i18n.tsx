import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Locale = 'en' | 'ar';

export type Dict = Record<string, string>;

const STORAGE_KEY = 'iraqi-scheduler-locale';

// English is the source dictionary — every key the app uses must appear here.
// Keys are domain-prefixed (sidebar.*, tab.*, action.*, modal.*) so a missing
// translation in `ar` can fall back to the English value cleanly.
export const en: Dict = {
  // Sidebar
  'sidebar.brand.line1': 'Iraqi Labor',
  'sidebar.brand.line2': 'Scheduler',
  'sidebar.factoryReset': 'Factory Reset',
  'sidebar.quitApp': 'Quit Application',
  'sidebar.locale.switch': 'العربية',
  'sidebar.locale.tooltip': 'Switch language',

  // Tabs
  'tab.dashboard': 'Compliance Dashboard',
  'tab.roster': 'Employee Roster',
  'tab.shifts': 'Shift Setup',
  'tab.payroll': 'Credits & Payroll',
  'tab.holidays': 'Public Holidays',
  'tab.layout': 'Stations / Assets',
  'tab.schedule': 'Master Schedule',
  'tab.reports': 'Reporting Center',
  'tab.variables': 'Legal Variables',
  'tab.audit': 'Audit Log',
  'tab.settings': 'System Settings',

  // Common actions
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.confirm': 'Confirm',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.add': 'Add',
  'action.export': 'Export',
  'action.import': 'Import',
  'action.refresh': 'Refresh',
  'action.apply': 'Apply',
  'action.runAutoSchedule': 'Auto-Schedule',
  'action.runAutoSchedulePreserve': 'Optimal (Keep Absences)',
  'action.runAutoSchedulePreserve.tooltip': 'Auto-fills the rest of the month around your manually-entered absences and shift overrides. Locks every cell that already has a value.',
  'action.undoLast': 'Undo Last Apply',

  // Roster
  'roster.title': 'Personnel Roster',
  'roster.subtitle': 'Manage employees, contracts, and station eligibility.',
  'roster.addEmployee': 'Add Employee',
  'roster.importCsv': 'Import CSV',
  'roster.exportCsv': 'Export CSV',
  'roster.bulkDelete': 'Remove Selected',
  'roster.col.id': 'ID',
  'roster.col.name': 'Employee Name',
  'roster.col.role': 'Role / Dept',
  'roster.col.stations': 'Eligible Stations',
  'roster.col.actions': 'Actions',
  'roster.searchPlaceholder': 'Search by name, ID, or department…',
  'roster.emptyTitle': 'No Personnel Registered',
  'roster.emptyHint': 'Import staff via CSV or use the dashboard to seed sample data.',
  'roster.addManually': 'Add Manually',
  'roster.seedSample': 'Seed Sample',
  'roster.tag.driver': 'Driver · Art.88',
  'roster.tag.rotate': 'Rotate',
  'roster.unassigned': 'Unassigned',
  'roster.editEmployee': 'Edit {name}',
  'roster.deleteEmployee': 'Delete {name}',

  // Employee modal
  'modal.employee.title.new': 'Onboard New Employee',
  'modal.employee.title.edit': 'Edit Personnel File',
  'modal.employee.commit': 'Commit Record',
  'modal.employee.field.id': 'Employee ID',
  'modal.employee.field.name': 'Full Name',
  'modal.employee.field.role': 'Job Role',
  'modal.employee.field.department': 'Department',
  'modal.employee.field.contract': 'Contract Type',
  'modal.employee.field.weeklyHours': 'Weekly Hours',
  'modal.employee.field.phone': 'Phone Contact',
  'modal.employee.field.hireDate': 'Hire Date',
  'modal.employee.field.salary': 'Base Monthly Salary (IQD)',
  'modal.employee.field.holidayBank': 'Holiday Bank (Earned)',
  'modal.employee.field.annualLeave': 'Annual Leave Balance',
  'modal.employee.field.restPolicy': 'Rest Day Policy',
  'modal.employee.field.category': 'Personnel Category',
  'modal.employee.rest.rotate': 'No Fixed Rest Day (Auto-Rotate)',
  'modal.employee.rest.fixed': 'Fixed:',
  'modal.employee.cat.standard': 'Standard (Art. 67-74)',
  'modal.employee.cat.driver': 'Driver / Transport (Art. 88)',
  'modal.employee.stationEligibility': 'Station Eligibility (Layout Assignments)',
  'modal.employee.flag.hazardous': 'Hazardous Duties',
  'modal.employee.flag.industrial': 'Industrial Rotation',
  'modal.employee.flag.exempt': 'Hour Exempt',
  'modal.employee.notes': 'Internal Personnel Notes',
  'modal.employee.maternity.title': 'Maternity Leave (Art. 87)',
  'modal.employee.maternity.note': 'Set both dates to mark the employee as on protected maternity leave (14 weeks paid). The auto-scheduler will keep these days as MAT. Leave both empty to clear.',
  'modal.employee.maternity.start': 'Leave Start (YYYY-MM-DD)',
  'modal.employee.maternity.end': 'Leave End (YYYY-MM-DD)',
  'modal.employee.sick.title': 'Sick Leave (Art. 84)',
  'modal.employee.sick.note': 'Set both dates to mark the employee as on protected sick leave. The auto-scheduler stamps SL on these days; any manual work assignment surfaces as a violation.',
  'modal.employee.sick.start': 'Leave Start (YYYY-MM-DD)',
  'modal.employee.sick.end': 'Leave End (YYYY-MM-DD)',

  // Shift modal
  'modal.shift.title.new': 'Create New Shift Type',
  'modal.shift.title.edit': 'Edit Shift Configuration',
  'modal.shift.save': 'Save Shift',

  // Station modal
  'modal.station.title': 'Station Profile',
  'modal.station.save': 'Save Station',
  'modal.station.field.id': 'Station ID / Name',
  'modal.station.field.normalHC': 'Normal Min HC',
  'modal.station.field.peakHC': 'Peak Min HC',
  'modal.station.field.openTime': 'Opening Time',
  'modal.station.field.closeTime': 'Closing Time',
  'modal.station.field.role': 'Required Role',
  'modal.station.field.color': 'Theme Color',
  'modal.station.role.any': 'Any (Standard staff)',
  'modal.station.role.driver': 'Driver / Vehicle Asset (Art. 88)',

  // Holiday modal
  'modal.holiday.title.new': 'Add Legal Holiday',
  'modal.holiday.title.edit': 'Edit Public Holiday',
  'modal.holiday.declare': 'Declare Holiday',

  // Confirm modal
  'modal.confirm.cancel': 'Cancel',
  'modal.confirm.confirm': 'Confirm',

  // Schedule preview
  'modal.preview.title': 'Auto-Scheduler Preview',
  'modal.preview.subtitle': 'review before applying',
  'modal.preview.assignments': 'Assignments',
  'modal.preview.totalHours': 'Total Hours',
  'modal.preview.unfilled': 'Unfilled Days',
  'modal.preview.violations': 'Violations',
  'modal.preview.hoursByRole': 'Hours by Role',
  'modal.preview.violationsHeader': 'Violations Detected',
  'modal.preview.cleanRun': 'Clean schedule — no violations and every station covered.',
  'modal.preview.applyNote': 'Applying replaces the current schedule. The previous month\'s schedule will be saved for one-step undo.',
  'modal.preview.applyButton': 'Apply Schedule',
  'modal.preview.applyAnyway': 'Apply Anyway',

  // Settings
  'settings.title': 'Global Configuration',
  'settings.subtitle': 'System-wide operational parameters.',
  'settings.peakDays': 'Operation Peak Days',
  'settings.complianceOverview': 'Compliance Overview',
  'settings.dbSecurity': 'Database & Security',
  'settings.exportBackup': 'Export Full Backup (JSON)',
  'settings.importBackup': 'Import Migration Backup',
  'settings.factoryReset': 'Factory Reset Instance',

  // Variables tab
  'variables.title': 'Legal Variables & Compliance Caps',
  'variables.subtitle': 'All thresholds enforced by the compliance engine. Each value cites the governing article of Iraqi Labor Law No. 37 of 2015.',
  'variables.standard': 'Standard Personnel',
  'variables.hazardous': 'Hazardous & Industrial Work',
  'variables.drivers': 'Drivers / Transport Workers',
  'variables.payRates': 'Overtime & Holiday Pay',
  'variables.operatingWindow': 'Operating Window',
  'variables.ramadan.title': 'Ramadan Mode',
  'variables.ramadan.subtitle': 'Reduced daily-hour cap during Ramadan (Iraqi customary practice).',
  'variables.ramadan.start': 'Ramadan Start (YYYY-MM-DD)',
  'variables.ramadan.end': 'Ramadan End (YYYY-MM-DD)',
  'variables.ramadan.dailyCap': 'Reduced Daily Cap (hrs)',
  'variables.ramadan.note': 'Leave both dates empty to disable. When active, the auto-scheduler refuses to assign shifts longer than the reduced cap to non-driver, non-hazardous staff during the window. Drivers continue to follow Art. 88 caps.',

  // Audit log
  'audit.title': 'Audit Log',
  'audit.subtitle': 'Append-only record of every save: who/what/when. Stored locally.',
  'audit.empty': 'No audit entries',
  'audit.emptyHint': 'Edit an employee, schedule, or config to start the log.',
  'audit.filter': 'Filter:',
  'audit.exportCsv': 'Export CSV',

  // Stations / Assets
  'layout.title': 'Stations & Assets Configuration',
  'layout.subtitle': 'Stations, vehicles, and other assets staffed by the auto-scheduler. Set required roles to gate vehicles to drivers only.',
  'layout.empty': 'No Stations or Assets Defined',
  'layout.emptyHint': 'Start by adding your POS gateways, service windows, or gaming areas.',
  'layout.new': 'New Station',
  'layout.normalStaffing': 'Normal Staffing',
  'layout.peakStaffing': 'Peak Staffing',
  'layout.opHours': 'Op Hours',
  'layout.persons': 'Persons',
  'layout.eligible': 'Eligible',
  'layout.status': 'Status',
  'layout.active': 'Active',

  // Schedule tab
  'schedule.title': 'Master Schedule',
  'schedule.personnelDirectory': 'Personnel Directory',
  'schedule.searchPlaceholder': 'Filter by name, ID, dept…',
  'schedule.allRoles': 'All Roles',
  'schedule.noMatches': 'No personnel match the current filters.',
  'schedule.paintBanner': 'Painting: [{code}] mode active — Click cells to assign.',
  'schedule.prevMonth': 'Previous month',
  'schedule.nextMonth': 'Next month',
  'schedule.cursorMode': 'Cursor mode (clear paint)',
  'schedule.warningHeader': 'Compliance warnings for {name}',
  'schedule.warningFooter': 'The assignment was applied — undo or repaint if this was unintended.',

  // Staffing Advisory
  'advisory.title': 'Staffing Advisory',
  'advisory.gaps': 'Coverage Gaps Detected',
  'advisory.optimal': 'Optimal Staffing',
  'advisory.hireToClose': 'Hire to Close Gaps',
  'advisory.toHire': 'to hire',
  'advisory.totalNote': 'additional headcount needed across all stations at peak. Hiring this much would resolve every shortfall without leaning on overtime or rest-day waivers.',
  'advisory.roleHint': 'Role required',
  'advisory.roleUnset': 'No role pinned — open to any eligible employee.',

  // Payroll tab
  'payroll.title': 'Credits & Compensation',
  'payroll.subtitle': 'Suggested overtime and holiday credit tracking based on Iraqi Labor Law (Art. 67-73).',
  'payroll.exportDraft': 'Export Payroll Draft',
  'payroll.col.employee': 'Employee',
  'payroll.col.hours': 'Hours',
  'payroll.col.holidayBank': 'Holiday Bank',
  'payroll.col.annualLeave': 'Annual Leave',
  'payroll.col.baseSalary': 'Base Salary',
  'payroll.col.hourlyRate': 'OT Hourly Rate',
  'payroll.col.otEligibility': 'OT Eligibility',
  'payroll.col.otAmount': 'OT Amount (IQD)',
  'payroll.col.netPayable': 'Net Payable (IQD)',
  'payroll.qualified': 'Qualified',
  'payroll.standard': 'Standard',
  'payroll.days': 'days',

  // Toolbar (top of every page)
  'toolbar.exportSchedule': 'Export Schedule',
  'toolbar.massImport': 'Mass Import Personnel',
  'toolbar.csvTemplate': 'Get CSV Template',
  'toolbar.statusLabel': 'Local · 127.0.0.1',
  'toolbar.saving': 'Saving…',
  'toolbar.savePending': 'Pending save',
  'toolbar.savedAt': 'Saved {time}',
  'toolbar.saveError': 'Save failed — will retry',

  // Section headers used across multiple tabs
  'shifts.title': 'Shift Library Configuration',
  'shifts.col.code': 'Code',
  'shifts.col.name': 'Name',
  'shifts.col.hours': 'Hours',
  'shifts.col.status': 'Status',
  'shifts.col.order': 'Order',
  'shifts.col.actions': 'Settings',
  'shifts.status.work': 'Work shift',
  'shifts.status.nonwork': 'Non-work',
  'shifts.new': 'New Shift Code',
  'shifts.moveUp': 'Move up',
  'shifts.moveDown': 'Move down',
  'holidays.title': 'Public Holidays & Non-Working Days',
  'holidays.subtitle': 'Custom calendar overrides for the Iraq region.',
  'holidays.new': 'New Holiday',
  'holidays.fixed': 'Fixed Date',
  'holidays.movable': 'Lunar / Movable',
  'reports.title': 'Reporting & Compliance Center',
  'reports.subtitle': 'Generate workforce documentation for audit and internal review.',
  'reports.pdf.title': 'Full Compliance PDF Report',
  'reports.pdf.body': 'A multi-page PDF: master roster, compliance violations, and resource allocation.',
  'reports.pdf.button': 'Generate PDF',
  'reports.csv.title': 'Master Schedule Export (CSV)',
  'reports.csv.body': 'Spreadsheet-ready export of the active month for Excel or payroll import.',
  'reports.csv.button': 'Download CSV',
  'reports.previewLabel': 'Report Preview (Live Data)',
  'reports.previewHeader': 'Workforce Audit Record',
  'reports.preview.totalPersonnel': 'Total Personnel',
  'reports.preview.complianceScore': 'Compliance Score',
  'reports.preview.coverageStatus': 'Coverage Status',
  'reports.preview.authenticated': 'Authenticated',
  'reports.preview.totalHours': 'Total Hours',
  'reports.preview.moreRecords': 'more records (truncated in preview)',
  'settings.coverageActive': 'Station-Based Coverage is ACTIVE',
  'settings.coverageNote': "Coverage is calculated from each station's min staffing. Hour caps, driver rules, OT multipliers, and operating window all live in the Legal Variables tab.",
  'settings.instance': 'Instance: Private Local · 127.0.0.1',

  // Dashboard
  'dashboard.kpi.workforce': 'Total Workforce',
  'dashboard.kpi.violations': 'Violations Found',
  'dashboard.kpi.stations': 'Active Stations',
  'dashboard.kpi.compliance': 'Global Compliance',
  'dashboard.complianceAudit': 'Compliance Audit — Labor Law Analysis',
  'dashboard.liveValidation': 'Live Validation',
  'dashboard.noViolations': 'No compliance issues detected in active schedule.',
  'dashboard.coverageTitle': 'Hourly Coverage Analysis',
  'dashboard.coverage.low': 'Low',
  'dashboard.coverage.optimal': 'Optimal',
  'dashboard.coverage.note': 'Scroll horizontally to see every day of the month. Each cell shows actual headcount over the per-station minimum.',
  'dashboard.holidayBank.title': 'Holiday Bank Balance',
  'dashboard.holidayBank.total': 'Total Pending Credits',
  'dashboard.holidayBank.days': 'Days',
  'dashboard.holidayBank.summary': '{with} of {total} personnel have earned extra rest days for holiday coverage.',
  'dashboard.showStats': 'Show Monthly Stats',
  'dashboard.peakStability': 'Peak Stability',
  'dashboard.peakCaption': 'Coverage on weekends/holidays',
  'dashboard.continuity': 'Business Continuity',
  'dashboard.stationCoverage': 'Current Station Coverage',
  'dashboard.coverageNote': '"Coverage takes priority over rest hours to ensure no operational downtime."',
  'dashboard.day': 'Day',
  'dashboard.times': 'times',
  'dashboard.stats.title': 'Operational Stats',
  'dashboard.stats.period': 'Audit Period',
  'dashboard.stats.complianceHealth': 'Compliance Health',
  'dashboard.stats.basedOn': 'Based on {count} personnel audited',
  'dashboard.stats.totalIncidents': 'Total Incidents',
  'dashboard.stats.acrossRules': 'Across {count} unique rules',
  'dashboard.stats.byCategory': 'Breakdown by Law Category',
  'dashboard.stats.cat.workHours': 'Work Hours (Art 67/68)',
  'dashboard.stats.cat.restPeriods': 'Rest Periods (Art 71/72)',
  'dashboard.stats.cat.wagesOT': 'Wages & OT (Art 70)',
  'dashboard.stats.footer': 'Confidential Audit — Generated internally by Iraqi Labor Scheduler',
  'dashboard.stats.close': 'Close Report',
  'dashboard.optim.eyebrow': 'Optimization & Continuity Advice',
  'dashboard.optim.title': 'Strategic Growth Path',
  'dashboard.optim.scheduledOT': 'Total Scheduled OT',
  'dashboard.optim.otPremium': 'Monthly OT Premium',
  'dashboard.optim.staffDeficit': 'Staff Deficit',
  'dashboard.optim.savings': 'Est. Monthly Saving',
  'dashboard.optim.personnel': 'Personnel',
  'dashboard.optim.body': 'The current schedule relies on {hours} hours of overtime to maintain continuity. Hiring {hires} additional staff would stabilize coverage and potentially save ≈{savings} IQD per month in premium wages.',
  'dashboard.optim.byStation': 'Where the gap actually is',
  'dashboard.optim.byStation.role': 'Role required: {role}',
  'dashboard.optim.byStation.anyEligible': 'Any eligible employee',
  'dashboard.optim.byStation.toHire': 'to hire',
  'dashboard.optim.byStation.moreFooter': '+{extra} more stations with smaller gaps — see the Staffing Advisory for the full list.',
  'dashboard.recruitment.title': 'Recruitment Plan',
  'dashboard.recruitment.body': 'You have {current} personnel. Expansion to {target} is recommended for optimal peak-load management.',
  'dashboard.recruitment.cta': 'Go to Recruitment',
  'dashboard.empty.title': 'Your Workspace is Private',
  'dashboard.empty.body': 'No personnel data is stored on remote servers. This instance is local to this PC. Anyone else opening the app starts with a clean slate.',
  'dashboard.empty.create': 'Create First Record',
  'dashboard.empty.sample': 'Seed Sample Data',
  'advisory.gapsBody': 'Current headcount is insufficient to meet station minimums during peak hours.',
  'advisory.bankNote': 'Outstanding compensations cannot be granted without further affecting coverage.',
  'advisory.optimalBody': 'All station requirements are met. {count} personnel are eligible for credit-based off-days.',

  // Confirm dialogs (titles + messages — accept name interpolation via {name})
  'confirm.removeEmp.title': 'Remove Personnel Record',
  'confirm.removeEmp.body': 'Remove {id}? This action cannot be undone and will clear their schedule.',
  'confirm.bulkRemove.title': 'Bulk Selection Removal',
  'confirm.bulkRemove.body': 'Remove {count} selected personnel records?',
  'confirm.factoryReset.title': 'Factory Reset',
  'confirm.factoryReset.body': 'This will PERMANENTLY delete all employees, schedules, and custom settings on this machine. Do you have a backup?',
  'confirm.factoryReset.backupFirst': 'Download Backup First',
  'confirm.shutdown.title': 'Shut Down Application',
  'confirm.shutdown.body': 'Save all data and shut down the background services? You will need to re-launch the app to start again.',
  'confirm.removeHoliday.title': 'Remove Legal Holiday',
  'confirm.removeHoliday.body': 'Remove the holiday on {date}?',
  'confirm.eraseHoliday.title': 'Erase Holiday',
  'confirm.eraseHoliday.body': 'Remove {name} from the calendar?',
  'confirm.removeStation.title': 'Remove Station',
  'confirm.removeStation.body': 'Dismantle station {name}? This will clear employee associations.',
  'confirm.deleteShift.title': 'Delete Shift Type',
  'confirm.deleteShift.body': 'Delete shift type {code}? This may affect existing schedules.',
  'confirm.importBackup.title': 'Import Migration',
  'confirm.importBackup.body': 'Overwrite all current data with this backup? This will sync to the local server.',

  // PDF report (printable, so kept short)
  'pdf.title': 'Workforce Compliance Report',
  'pdf.period': 'Period',
  'pdf.generated': 'Generated',
  'pdf.section.roster': 'Master Duty Roster',
  'pdf.section.compliance': 'Compliance & Audit Summary',
  'pdf.section.performance': 'Personnel Performance & Credits',
  'pdf.section.allocation': 'Resource Allocation',
  'pdf.col.personnel': 'Personnel',
  'pdf.col.occurrence': 'Occurrence',
  'pdf.col.rule': 'Rule',
  'pdf.col.article': 'Article',
  'pdf.col.description': 'Description',
  'pdf.col.role': 'Role',
  'pdf.col.hours': 'Hours',
  'pdf.col.salary': 'Salary',
  'pdf.col.otFlag': 'OT?',
  'pdf.col.otPay': 'OT Pay',
  'pdf.col.netPay': 'Net Pay',
  'pdf.col.bank': 'Holiday Bank',
  'pdf.col.al': 'Annual Leave',
  'pdf.col.station': 'Station / Asset',
  'pdf.col.minHC': 'Required Min HC',
  'pdf.col.assigned': 'Assigned Personnel',

  // App-shell
  'app.loadingTab': 'Loading…',

  // Misc
  'common.affects': 'Affects:',
  'common.more': 'more',
  'common.yes': 'Yes',
  'common.no': 'No',

  // Employee modal — gender, preferences, annual leave
  'modal.employee.field.gender': 'Gender',
  'modal.employee.gender.unset': 'Not specified',
  'modal.employee.gender.male': 'Male',
  'modal.employee.gender.female': 'Female',
  'modal.employee.gender.note': 'Optional. When set to Female, the maternity panel below appears and Art. 86 night-work checks (if enabled in Variables) apply to industrial shifts.',
  'modal.employee.preferences.title': 'Shift Preferences (Auto-Scheduler Bias)',
  'modal.employee.preferences.note': 'Soft preference: the auto-scheduler tries to honor it at the legal-strictness level but never sacrifices coverage. Avoided shifts are skipped when alternatives exist.',
  'modal.employee.preferences.preferred': 'Preferred',
  'modal.employee.preferences.avoid': 'Avoid',
  'modal.employee.annual.title': 'Annual / Approved Leave',
  'modal.employee.annual.note': 'Set both dates to mark an approved vacation window. The auto-scheduler stamps AL on those days and skips the employee for assignments. The numeric balance above is tracked separately.',
  'modal.employee.annual.start': 'Leave Start (YYYY-MM-DD)',
  'modal.employee.annual.end': 'Leave End (YYYY-MM-DD)',

  // Variables tab — operating window + Art. 86
  'variables.operatingWindow.note': 'Default opening / closing hours used when no per-day override is set.',
  'variables.operatingWindow.defaultOpen': 'Default Opening Time',
  'variables.operatingWindow.defaultClose': 'Default Closing Time',
  'variables.operatingWindow.perDayHeader': 'Per-Day Override (optional)',
  'variables.operatingWindow.perDayNote': 'Tick a day to override the default. Useful when peak days run later than weekdays — e.g. Friday closes at 02:00 instead of 23:00.',
  'variables.art86.title': "Art. 86 — Women's Night Work",
  'variables.art86.subtitle': 'Industrial undertakings: women may not work between the configured night hours.',
  'variables.art86.enable': 'Enforce Art. 86 night-work cap',
  'variables.art86.start': 'Night Window Start',
  'variables.art86.end': 'Night Window End',
  'variables.art86.note': 'When enabled, any shift flagged as industrial that overlaps the configured window and is assigned to a female employee surfaces as an Art. 86 violation. The auto-scheduler treats it as a hard rule at legal / continuity levels.',

  // Company switcher
  'company.header': 'Companies / Branches',
  'company.add': 'Add Company',
  'company.rename': 'Rename',
  'company.delete': 'Delete',
  'company.newPlaceholder': 'Company name…',
  'company.renamePlaceholder': 'New name…',
  'company.cannotDelete.title': 'Cannot remove last company',
  'company.cannotDelete.body': 'At least one company must remain. Add another company first, then remove this one.',
  'company.confirmDelete.title': 'Remove Company',
  'company.confirmDelete.body': 'Permanently delete {name} and all of its employees, schedules, stations, and config? This cannot be undone unless you have a backup.',

  // Simulation mode
  'sim.toolbar.enter': 'Simulation',
  'sim.toolbar.exit': 'Exit Simulation',
  'sim.toolbar.statusLabel': 'Sandbox · not saving',
  'sim.banner.eyebrow': 'Sim Mode',
  'sim.banner.title': 'Sandbox — changes are not persisted',
  'sim.metric.workforce': 'Workforce',
  'sim.metric.coverage': 'Coverage %',
  'sim.metric.otHours': 'OT Hours',
  'sim.metric.otPay': 'OT Pay (IQD)',
  'sim.metric.violations': 'Violations',
  'sim.delta.unchanged': 'unchanged',
  'sim.action.reset': 'Reset',
  'sim.action.apply': 'Apply',
  'sim.action.exit': 'Discard',
  'sim.locked.companyChange': 'Exit simulation mode before switching companies — the sandbox only covers the company you started with.',

  // Coverage-gap hint toast
  'hint.coverage.eyebrow': 'Coverage Hint',
  'hint.coverage.title': 'Day {day} · {station} now has a gap',
  'hint.coverage.body': 'Pick a replacement to absorb the open slot, or keep the gap if intentional.',
  'hint.coverage.tag.off': 'Off-day',
  'hint.coverage.tag.recommended': 'Recommended',
  'hint.coverage.noCandidates': 'No eligible candidates available.',
  'hint.coverage.override': "Click 'Keep gap' to leave it open.",
  'hint.coverage.keepGap': 'Keep gap',

  // Schedule staleness banner
  'schedule.stale.header': 'Schedule contains broken references',
  'schedule.stale.body': '{emps} employees, {shifts} shift codes, and {stations} stations referenced in this month\'s schedule no longer exist.',
  'schedule.stale.rerun': 'Re-run Auto-Scheduler',

  // Info / replacement-for-alert dialogs
  'info.notice.title': 'Notice',
  'info.error.title': 'Action failed',
  'info.factoryReset.body': 'All data has been cleared on the server and in the browser. The page will reload now.',
  'info.factoryReset.failed': 'Reset failed. Please try again or check the server logs.',
  'info.shutdown.body': 'Server is shutting down. You can now close this window.',
  'info.seed.title': 'Sample Data Loaded',
  'info.seed.body': '35 Operators and 12 Cashiers seeded. Use Auto-Scheduler to populate the month.',
  'info.csvImport.title': 'CSV Import Complete',
  'info.csvImport.body': 'Successfully imported {count} personnel records.',
  'info.backup.invalidFile': 'Please select a valid .json backup file.',
  'info.backup.parseFailed': 'Error parsing backup file: {msg}',

  // Dashboard FTE forecast
  'dashboard.kpi.fteForecast': 'Recommended Hires',

  // Post-update toast
  'info.updated.title': 'Updated to v{version}',
  'info.updated.body': 'Iraqi Labor Scheduler was updated from v{from} to v{to}.\n\nA snapshot of your data was saved here before the new version started:\n{snapshot}\n\nYou can delete the snapshot later if everything looks fine. The five most recent snapshots are kept automatically.',
  'info.updated.snapshotMissing': '(no snapshot — the data folder was empty)',
};

// Arabic translations of every key. Strings the app doesn't yet translate
// will fall back to the English value via the `t()` helper.
export const ar: Dict = {
  // Sidebar
  'sidebar.brand.line1': 'العمل العراقي',
  'sidebar.brand.line2': 'مُجدوِل',
  'sidebar.factoryReset': 'إعادة ضبط المصنع',
  'sidebar.quitApp': 'إنهاء التطبيق',
  'sidebar.locale.switch': 'English',
  'sidebar.locale.tooltip': 'تبديل اللغة',

  // Tabs
  'tab.dashboard': 'لوحة الامتثال',
  'tab.roster': 'سجل الموظفين',
  'tab.shifts': 'إعداد الورديات',
  'tab.payroll': 'الأرصدة والأجور',
  'tab.holidays': 'العطلات الرسمية',
  'tab.layout': 'المحطات / الأصول',
  'tab.schedule': 'الجدول الرئيسي',
  'tab.reports': 'مركز التقارير',
  'tab.variables': 'المتغيرات القانونية',
  'tab.audit': 'سجل التدقيق',
  'tab.settings': 'إعدادات النظام',

  // Common actions
  'action.save': 'حفظ',
  'action.cancel': 'إلغاء',
  'action.confirm': 'تأكيد',
  'action.delete': 'حذف',
  'action.edit': 'تعديل',
  'action.add': 'إضافة',
  'action.export': 'تصدير',
  'action.import': 'استيراد',
  'action.refresh': 'تحديث',
  'action.apply': 'تطبيق',
  'action.runAutoSchedule': 'جدولة تلقائية',
  'action.runAutoSchedulePreserve': 'الجدول الأمثل (مع الحفاظ على الإجازات)',
  'action.runAutoSchedulePreserve.tooltip': 'يملأ بقية الشهر تلقائيًا حول الإجازات والتعديلات اليدوية التي أدخلتها. كل خلية تحتوي قيمة تبقى مقفلة.',
  'action.undoLast': 'تراجع عن آخر تطبيق',

  // Roster
  'roster.title': 'سجل الموظفين',
  'roster.subtitle': 'إدارة الموظفين والعقود وأهلية المحطات.',
  'roster.addEmployee': 'إضافة موظف',
  'roster.importCsv': 'استيراد CSV',
  'roster.exportCsv': 'تصدير CSV',
  'roster.bulkDelete': 'إزالة المحدد',
  'roster.col.id': 'المعرف',
  'roster.col.name': 'اسم الموظف',
  'roster.col.role': 'الدور / القسم',
  'roster.col.stations': 'المحطات المؤهلة',
  'roster.col.actions': 'الإجراءات',
  'roster.searchPlaceholder': 'ابحث بالاسم أو المعرف أو القسم…',
  'roster.emptyTitle': 'لا يوجد موظفون مسجلون',
  'roster.emptyHint': 'استورد الموظفين عبر CSV أو استخدم اللوحة لزرع بيانات نموذجية.',
  'roster.addManually': 'إضافة يدوية',
  'roster.seedSample': 'بيانات نموذجية',
  'roster.tag.driver': 'سائق · م.٨٨',
  'roster.tag.rotate': 'تدوير',
  'roster.unassigned': 'غير معين',
  'roster.editEmployee': 'تعديل {name}',
  'roster.deleteEmployee': 'حذف {name}',

  // Employee modal
  'modal.employee.title.new': 'تسجيل موظف جديد',
  'modal.employee.title.edit': 'تعديل ملف الموظف',
  'modal.employee.commit': 'حفظ السجل',
  'modal.employee.field.id': 'معرف الموظف',
  'modal.employee.field.name': 'الاسم الكامل',
  'modal.employee.field.role': 'الدور الوظيفي',
  'modal.employee.field.department': 'القسم',
  'modal.employee.field.contract': 'نوع العقد',
  'modal.employee.field.weeklyHours': 'الساعات الأسبوعية',
  'modal.employee.field.phone': 'رقم الهاتف',
  'modal.employee.field.hireDate': 'تاريخ التعيين',
  'modal.employee.field.salary': 'الراتب الشهري الأساسي (دينار)',
  'modal.employee.field.holidayBank': 'رصيد العطلات (المكتسب)',
  'modal.employee.field.annualLeave': 'رصيد الإجازة السنوية',
  'modal.employee.field.restPolicy': 'سياسة يوم الراحة',
  'modal.employee.field.category': 'فئة الموظف',
  'modal.employee.rest.rotate': 'بدون يوم راحة ثابت (تدوير تلقائي)',
  'modal.employee.rest.fixed': 'ثابت:',
  'modal.employee.cat.standard': 'قياسي (المواد ٦٧-٧٤)',
  'modal.employee.cat.driver': 'سائق / نقل (المادة ٨٨)',
  'modal.employee.stationEligibility': 'أهلية المحطات (تخصيصات التخطيط)',
  'modal.employee.flag.hazardous': 'مهام خطرة',
  'modal.employee.flag.industrial': 'تدوير صناعي',
  'modal.employee.flag.exempt': 'معفى من الساعات',
  'modal.employee.notes': 'ملاحظات داخلية للموظف',
  'modal.employee.maternity.title': 'إجازة أمومة (المادة ٨٧)',
  'modal.employee.maternity.note': 'حدد التاريخين لتعيين الموظفة في إجازة أمومة محمية (١٤ أسبوعًا مدفوعة الأجر). سيُبقي المُجدوِل التلقائي هذه الأيام كـ MAT. اترك الحقلين فارغين للإلغاء.',
  'modal.employee.maternity.start': 'بداية الإجازة (YYYY-MM-DD)',
  'modal.employee.maternity.end': 'نهاية الإجازة (YYYY-MM-DD)',
  'modal.employee.sick.title': 'إجازة مرضية (المادة ٨٤)',
  'modal.employee.sick.note': 'حدد التاريخين لتعيين الموظف في إجازة مرضية محمية. سيضع المُجدوِل التلقائي SL في هذه الأيام؛ أي تعيين عمل يدوي يظهر كمخالفة.',
  'modal.employee.sick.start': 'بداية الإجازة (YYYY-MM-DD)',
  'modal.employee.sick.end': 'نهاية الإجازة (YYYY-MM-DD)',

  // Shift modal
  'modal.shift.title.new': 'إنشاء نوع وردية جديد',
  'modal.shift.title.edit': 'تعديل إعداد الوردية',
  'modal.shift.save': 'حفظ الوردية',

  // Station modal
  'modal.station.title': 'ملف المحطة',
  'modal.station.save': 'حفظ المحطة',
  'modal.station.field.id': 'معرف / اسم المحطة',
  'modal.station.field.normalHC': 'الحد الأدنى الطبيعي',
  'modal.station.field.peakHC': 'الحد الأدنى للذروة',
  'modal.station.field.openTime': 'وقت الفتح',
  'modal.station.field.closeTime': 'وقت الإغلاق',
  'modal.station.field.role': 'الدور المطلوب',
  'modal.station.field.color': 'لون الواجهة',
  'modal.station.role.any': 'أي شخص (موظف قياسي)',
  'modal.station.role.driver': 'سائق / أصل مركبة (المادة ٨٨)',

  // Holiday modal
  'modal.holiday.title.new': 'إضافة عطلة قانونية',
  'modal.holiday.title.edit': 'تعديل عطلة رسمية',
  'modal.holiday.declare': 'إعلان العطلة',

  // Confirm modal
  'modal.confirm.cancel': 'إلغاء',
  'modal.confirm.confirm': 'تأكيد',

  // Schedule preview
  'modal.preview.title': 'معاينة الجدولة التلقائية',
  'modal.preview.subtitle': 'راجع قبل التطبيق',
  'modal.preview.assignments': 'التعيينات',
  'modal.preview.totalHours': 'إجمالي الساعات',
  'modal.preview.unfilled': 'أيام غير مغطاة',
  'modal.preview.violations': 'مخالفات',
  'modal.preview.hoursByRole': 'الساعات حسب الدور',
  'modal.preview.violationsHeader': 'تم رصد مخالفات',
  'modal.preview.cleanRun': 'جدول نظيف — لا مخالفات وكل المحطات مغطاة.',
  'modal.preview.applyNote': 'يحل التطبيق محل الجدول الحالي. سيتم حفظ الجدول السابق للتراجع بخطوة واحدة.',
  'modal.preview.applyButton': 'تطبيق الجدول',
  'modal.preview.applyAnyway': 'تطبيق على أي حال',

  // Settings
  'settings.title': 'الإعداد العام',
  'settings.subtitle': 'المعلمات التشغيلية على مستوى النظام.',
  'settings.peakDays': 'أيام ذروة العمل',
  'settings.complianceOverview': 'نظرة عامة على الامتثال',
  'settings.dbSecurity': 'قاعدة البيانات والأمان',
  'settings.exportBackup': 'تصدير نسخة احتياطية كاملة (JSON)',
  'settings.importBackup': 'استيراد نسخة احتياطية',
  'settings.factoryReset': 'إعادة ضبط المثيل',

  // Variables tab
  'variables.title': 'المتغيرات القانونية وحدود الامتثال',
  'variables.subtitle': 'كل العتبات التي يطبّقها محرك الامتثال. كل قيمة تُشير إلى المادة الحاكمة من قانون العمل العراقي رقم ٣٧ لسنة ٢٠١٥.',
  'variables.standard': 'الموظفون القياسيون',
  'variables.hazardous': 'العمل الخطر والصناعي',
  'variables.drivers': 'السائقون / عمال النقل',
  'variables.payRates': 'الأجر الإضافي وأجر العطلات',
  'variables.operatingWindow': 'نافذة التشغيل',
  'variables.ramadan.title': 'وضع رمضان',
  'variables.ramadan.subtitle': 'تخفيض الحد الأقصى للساعات اليومية خلال شهر رمضان (الممارسة العرفية في العراق).',
  'variables.ramadan.start': 'بداية رمضان (YYYY-MM-DD)',
  'variables.ramadan.end': 'نهاية رمضان (YYYY-MM-DD)',
  'variables.ramadan.dailyCap': 'الحد المخفض للساعات اليومية',
  'variables.ramadan.note': 'اترك التاريخين فارغين للتعطيل. عند التفعيل يرفض المُجدوِل التلقائي تعيين الورديات الأطول من الحد المخفض للموظفين غير السائقين وغير الخطرين خلال هذه الفترة. السائقون يستمرون باتباع المادة ٨٨.',

  // Audit log
  'audit.title': 'سجل التدقيق',
  'audit.subtitle': 'سجل لا يقبل الحذف لكل عملية حفظ: من / ماذا / متى. مخزّن محليًا.',
  'audit.empty': 'لا توجد إدخالات تدقيق',
  'audit.emptyHint': 'عدِّل موظفًا أو جدولًا أو إعدادًا لبدء السجل.',
  'audit.filter': 'تصفية:',
  'audit.exportCsv': 'تصدير CSV',

  // Stations / Assets
  'layout.title': 'إعداد المحطات والأصول',
  'layout.subtitle': 'المحطات والمركبات والأصول الأخرى التي يتولى المُجدوِل التلقائي تعيين موظفين لها. حدِّد الأدوار المطلوبة لقصر المركبات على السائقين فقط.',
  'layout.empty': 'لا محطات أو أصول مُعرَّفة',
  'layout.emptyHint': 'ابدأ بإضافة نقاط البيع أو نوافذ الخدمة أو مناطق الألعاب.',
  'layout.new': 'محطة جديدة',
  'layout.normalStaffing': 'الطاقم الطبيعي',
  'layout.peakStaffing': 'الطاقم في الذروة',
  'layout.opHours': 'ساعات التشغيل',
  'layout.persons': 'أشخاص',
  'layout.eligible': 'المؤهلون',
  'layout.status': 'الحالة',
  'layout.active': 'نشط',

  // Schedule tab
  'schedule.title': 'الجدول الرئيسي',
  'schedule.personnelDirectory': 'دليل الموظفين',
  'schedule.searchPlaceholder': 'تصفية بالاسم أو المعرف أو القسم…',
  'schedule.allRoles': 'كل الأدوار',
  'schedule.noMatches': 'لا يوجد موظفون يطابقون عوامل التصفية الحالية.',
  'schedule.paintBanner': 'وضع الرسم: [{code}] نشط — انقر على الخلايا للتعيين.',
  'schedule.prevMonth': 'الشهر السابق',
  'schedule.nextMonth': 'الشهر التالي',
  'schedule.cursorMode': 'وضع المؤشر (إلغاء الرسم)',
  'schedule.warningHeader': 'تحذيرات الامتثال لـ {name}',
  'schedule.warningFooter': 'تم تطبيق التعيين — تراجع أو أعد الرسم إذا لم يكن هذا مقصودًا.',

  // Staffing Advisory
  'advisory.title': 'استشارة التوظيف',
  'advisory.gaps': 'تم رصد فجوات تغطية',
  'advisory.optimal': 'توظيف مثالي',
  'advisory.hireToClose': 'وظِّف لسد الفجوات',
  'advisory.toHire': 'للتوظيف',
  'advisory.totalNote': 'موظفون إضافيون مطلوبون لجميع المحطات في الذروة. توظيف هذا العدد سيحل كل نقص دون اللجوء للعمل الإضافي أو إلغاء أيام الراحة.',
  'advisory.roleHint': 'الدور المطلوب',
  'advisory.roleUnset': 'لا دور محدد — مفتوح لأي موظف مؤهل.',

  // Payroll tab
  'payroll.title': 'الأرصدة والتعويضات',
  'payroll.subtitle': 'تتبع مقترح للعمل الإضافي وأرصدة العطلات وفقًا لقانون العمل العراقي (المواد ٦٧-٧٣).',
  'payroll.exportDraft': 'تصدير مسودة الأجور',
  'payroll.col.employee': 'الموظف',
  'payroll.col.hours': 'الساعات',
  'payroll.col.holidayBank': 'رصيد العطلات',
  'payroll.col.annualLeave': 'الإجازة السنوية',
  'payroll.col.baseSalary': 'الراتب الأساسي',
  'payroll.col.hourlyRate': 'أجر الساعة الإضافية',
  'payroll.col.otEligibility': 'أهلية الإضافي',
  'payroll.col.otAmount': 'مبلغ الإضافي (دينار)',
  'payroll.col.netPayable': 'الصافي المستحق (دينار)',
  'payroll.qualified': 'مؤهل',
  'payroll.standard': 'قياسي',
  'payroll.days': 'أيام',

  // Toolbar
  'toolbar.exportSchedule': 'تصدير الجدول',
  'toolbar.massImport': 'استيراد جماعي للموظفين',
  'toolbar.csvTemplate': 'تنزيل قالب CSV',
  'toolbar.statusLabel': 'محلي · 127.0.0.1',
  'toolbar.saving': 'جارٍ الحفظ…',
  'toolbar.savePending': 'في انتظار الحفظ',
  'toolbar.savedAt': 'حُفظ في {time}',
  'toolbar.saveError': 'فشل الحفظ — ستتم إعادة المحاولة',

  // Section headers
  'shifts.title': 'إعداد مكتبة الورديات',
  'shifts.col.code': 'الرمز',
  'shifts.col.name': 'الاسم',
  'shifts.col.hours': 'الساعات',
  'shifts.col.status': 'الحالة',
  'shifts.col.order': 'الترتيب',
  'shifts.col.actions': 'الإعدادات',
  'shifts.status.work': 'وردية عمل',
  'shifts.status.nonwork': 'غير عمل',
  'shifts.new': 'رمز وردية جديد',
  'shifts.moveUp': 'تحريك للأعلى',
  'shifts.moveDown': 'تحريك للأسفل',
  'holidays.title': 'العطلات الرسمية وأيام العطل',
  'holidays.subtitle': 'تخصيصات تقويم لمنطقة العراق.',
  'holidays.new': 'عطلة جديدة',
  'holidays.fixed': 'تاريخ ثابت',
  'holidays.movable': 'قمري / متحرك',
  'reports.title': 'مركز التقارير والامتثال',
  'reports.subtitle': 'إنشاء وثائق القوى العاملة للتدقيق والمراجعة الداخلية.',
  'reports.pdf.title': 'تقرير امتثال PDF شامل',
  'reports.pdf.body': 'تقرير PDF متعدد الصفحات: الجدول الرئيسي ومخالفات الامتثال وتوزيع الموارد.',
  'reports.pdf.button': 'إنشاء PDF',
  'reports.csv.title': 'تصدير الجدول الرئيسي (CSV)',
  'reports.csv.body': 'تصدير جاهز لجداول البيانات للشهر الفعّال للاستيراد إلى Excel أو الرواتب.',
  'reports.csv.button': 'تنزيل CSV',
  'reports.previewLabel': 'معاينة التقرير (بيانات حية)',
  'reports.previewHeader': 'سجل تدقيق القوى العاملة',
  'reports.preview.totalPersonnel': 'إجمالي الموظفين',
  'reports.preview.complianceScore': 'درجة الامتثال',
  'reports.preview.coverageStatus': 'حالة التغطية',
  'reports.preview.authenticated': 'مُوثَّق',
  'reports.preview.totalHours': 'إجمالي الساعات',
  'reports.preview.moreRecords': 'سجلات إضافية (مقتطعة في المعاينة)',
  'settings.coverageActive': 'التغطية على أساس المحطات نشطة',
  'settings.coverageNote': 'تُحسب التغطية من الحد الأدنى لطاقم كل محطة. حدود الساعات وقواعد السائقين ومضاعفات الإضافي ونافذة التشغيل كلها في تبويب المتغيرات القانونية.',
  'settings.instance': 'المثيل: محلي خاص · 127.0.0.1',

  // Dashboard
  'dashboard.kpi.workforce': 'إجمالي الموظفين',
  'dashboard.kpi.violations': 'المخالفات المكتشفة',
  'dashboard.kpi.stations': 'المحطات النشطة',
  'dashboard.kpi.compliance': 'الامتثال العام',
  'dashboard.complianceAudit': 'تدقيق الامتثال — تحليل قانون العمل',
  'dashboard.liveValidation': 'تحقق فوري',
  'dashboard.noViolations': 'لا توجد مشاكل امتثال في الجدول الفعّال.',
  'dashboard.coverageTitle': 'تحليل التغطية بالساعة',
  'dashboard.coverage.low': 'منخفضة',
  'dashboard.coverage.optimal': 'مثالية',
  'dashboard.coverage.note': 'مرّر أفقيًا لرؤية كل أيام الشهر. كل خلية تعرض العدد الفعلي مقابل الحد الأدنى للمحطة.',
  'dashboard.holidayBank.title': 'رصيد العطلات',
  'dashboard.holidayBank.total': 'إجمالي الأرصدة المعلقة',
  'dashboard.holidayBank.days': 'أيام',
  'dashboard.holidayBank.summary': '{with} من {total} موظفين كسبوا أيام راحة إضافية مقابل تغطية العطلات.',
  'dashboard.showStats': 'عرض الإحصائيات الشهرية',
  'dashboard.peakStability': 'استقرار الذروة',
  'dashboard.peakCaption': 'التغطية في عطلات نهاية الأسبوع والأعياد',
  'dashboard.continuity': 'استمرارية الأعمال',
  'dashboard.stationCoverage': 'التغطية الحالية للمحطات',
  'dashboard.coverageNote': '"التغطية لها الأولوية على ساعات الراحة لضمان عدم توقف العمليات."',
  'dashboard.day': 'يوم',
  'dashboard.times': 'مرات',
  'dashboard.stats.title': 'إحصائيات تشغيلية',
  'dashboard.stats.period': 'فترة التدقيق',
  'dashboard.stats.complianceHealth': 'صحة الامتثال',
  'dashboard.stats.basedOn': 'بناءً على تدقيق {count} موظفين',
  'dashboard.stats.totalIncidents': 'إجمالي الحوادث',
  'dashboard.stats.acrossRules': 'عبر {count} قواعد فريدة',
  'dashboard.stats.byCategory': 'التوزيع حسب فئة القانون',
  'dashboard.stats.cat.workHours': 'ساعات العمل (المواد ٦٧/٦٨)',
  'dashboard.stats.cat.restPeriods': 'فترات الراحة (المواد ٧١/٧٢)',
  'dashboard.stats.cat.wagesOT': 'الأجور والإضافي (المادة ٧٠)',
  'dashboard.stats.footer': 'تدقيق سري — أُنشئ داخليًا بواسطة مُجدوِل العمل العراقي',
  'dashboard.stats.close': 'إغلاق التقرير',
  'dashboard.optim.eyebrow': 'نصائح التحسين والاستمرارية',
  'dashboard.optim.title': 'مسار النمو الاستراتيجي',
  'dashboard.optim.scheduledOT': 'إجمالي الإضافي المجدول',
  'dashboard.optim.otPremium': 'علاوة الإضافي الشهرية',
  'dashboard.optim.staffDeficit': 'العجز في الموظفين',
  'dashboard.optim.savings': 'الوفر الشهري المقدر',
  'dashboard.optim.personnel': 'موظفون',
  'dashboard.optim.body': 'يعتمد الجدول الحالي على {hours} ساعة من العمل الإضافي للحفاظ على الاستمرارية. توظيف {hires} موظفين إضافيين سيستقر التغطية ويوفر ≈{savings} دينار شهريًا.',
  'dashboard.optim.byStation': 'أين تقع الفجوة فعليًا',
  'dashboard.optim.byStation.role': 'الدور المطلوب: {role}',
  'dashboard.optim.byStation.anyEligible': 'أي موظف مؤهل',
  'dashboard.optim.byStation.toHire': 'للتوظيف',
  'dashboard.optim.byStation.moreFooter': '+{extra} محطات إضافية بفجوات أصغر — راجع استشارة التوظيف للقائمة الكاملة.',
  'dashboard.recruitment.title': 'خطة التوظيف',
  'dashboard.recruitment.body': 'لديك {current} موظفًا. التوسع إلى {target} مُوصى به لإدارة ذروة الحمل الأمثل.',
  'dashboard.recruitment.cta': 'انتقل إلى التوظيف',
  'dashboard.empty.title': 'مساحة عملك خاصة',
  'dashboard.empty.body': 'لا تُخزَّن أي بيانات موظفين على خوادم بعيدة. هذه النسخة محلية لهذا الجهاز.',
  'dashboard.empty.create': 'إنشاء أول سجل',
  'dashboard.empty.sample': 'بيانات نموذجية',
  'advisory.gapsBody': 'العدد الحالي للموظفين غير كافٍ لتلبية الحد الأدنى للمحطات خلال ساعات الذروة.',
  'advisory.bankNote': 'لا يمكن منح التعويضات المستحقة دون التأثير على التغطية.',
  'advisory.optimalBody': 'تتم تلبية متطلبات جميع المحطات. {count} موظفين مؤهلون لأيام راحة على أساس الرصيد.',

  // Confirm dialogs
  'confirm.removeEmp.title': 'إزالة سجل موظف',
  'confirm.removeEmp.body': 'إزالة {id}؟ لا يمكن التراجع عن هذا الإجراء وسيؤدي إلى مسح جدوله.',
  'confirm.bulkRemove.title': 'إزالة جماعية للمحدد',
  'confirm.bulkRemove.body': 'إزالة {count} سجلات موظفين محددة؟',
  'confirm.factoryReset.title': 'إعادة ضبط المصنع',
  'confirm.factoryReset.body': 'سيؤدي هذا إلى حذف جميع الموظفين والجداول والإعدادات نهائيًا على هذا الجهاز. هل لديك نسخة احتياطية؟',
  'confirm.factoryReset.backupFirst': 'تنزيل نسخة احتياطية أولاً',
  'confirm.shutdown.title': 'إيقاف تشغيل التطبيق',
  'confirm.shutdown.body': 'حفظ جميع البيانات وإيقاف تشغيل الخدمات الخلفية؟ ستحتاج إلى إعادة تشغيل التطبيق للبدء من جديد.',
  'confirm.removeHoliday.title': 'إزالة عطلة قانونية',
  'confirm.removeHoliday.body': 'إزالة العطلة بتاريخ {date}؟',
  'confirm.eraseHoliday.title': 'مسح عطلة',
  'confirm.eraseHoliday.body': 'إزالة {name} من التقويم؟',
  'confirm.removeStation.title': 'إزالة محطة',
  'confirm.removeStation.body': 'تفكيك المحطة {name}؟ سيؤدي هذا إلى مسح ارتباطات الموظفين.',
  'confirm.deleteShift.title': 'حذف نوع وردية',
  'confirm.deleteShift.body': 'حذف نوع الوردية {code}؟ قد يؤثر هذا على الجداول الحالية.',
  'confirm.importBackup.title': 'استيراد ترحيل',
  'confirm.importBackup.body': 'استبدال جميع البيانات الحالية بهذه النسخة الاحتياطية؟ سيتم المزامنة مع الخادم المحلي.',

  // PDF report
  'pdf.title': 'تقرير امتثال القوى العاملة',
  'pdf.period': 'الفترة',
  'pdf.generated': 'أُنشئ في',
  'pdf.section.roster': 'الجدول الرئيسي للواجبات',
  'pdf.section.compliance': 'ملخص الامتثال والتدقيق',
  'pdf.section.performance': 'أداء الموظفين والأرصدة',
  'pdf.section.allocation': 'توزيع الموارد',
  'pdf.col.personnel': 'الموظف',
  'pdf.col.occurrence': 'الحدث',
  'pdf.col.rule': 'القاعدة',
  'pdf.col.article': 'المادة',
  'pdf.col.description': 'الوصف',
  'pdf.col.role': 'الدور',
  'pdf.col.hours': 'الساعات',
  'pdf.col.salary': 'الراتب',
  'pdf.col.otFlag': 'إضافي؟',
  'pdf.col.otPay': 'أجر إضافي',
  'pdf.col.netPay': 'الصافي',
  'pdf.col.bank': 'رصيد العطلات',
  'pdf.col.al': 'الإجازة السنوية',
  'pdf.col.station': 'المحطة / الأصل',
  'pdf.col.minHC': 'الحد الأدنى المطلوب',
  'pdf.col.assigned': 'الموظفون المعينون',

  // App-shell
  'app.loadingTab': 'جارٍ التحميل…',

  // Misc
  'common.affects': 'يؤثر على:',
  'common.more': 'المزيد',
  'common.yes': 'نعم',
  'common.no': 'لا',

  // Employee modal — gender, preferences, annual leave
  'modal.employee.field.gender': 'الجنس',
  'modal.employee.gender.unset': 'غير محدد',
  'modal.employee.gender.male': 'ذكر',
  'modal.employee.gender.female': 'أنثى',
  'modal.employee.gender.note': 'اختياري. عند تحديد "أنثى" تظهر لوحة الأمومة أدناه، وتُطبَّق فحوصات المادة ٨٦ (إن كانت مفعّلة في المتغيرات) على ورديات العمل الصناعي.',
  'modal.employee.preferences.title': 'تفضيلات الورديات (انحياز المُجدوِل التلقائي)',
  'modal.employee.preferences.note': 'تفضيل مرن: يحاول المُجدوِل احترامه عند مستوى الالتزام القانوني لكنه لا يُضحّي بالتغطية. الورديات في قائمة "تجنّب" تُستثنى عند توفر بدائل.',
  'modal.employee.preferences.preferred': 'مفضّلة',
  'modal.employee.preferences.avoid': 'تجنّب',
  'modal.employee.annual.title': 'إجازة سنوية / معتمدة',
  'modal.employee.annual.note': 'حدد التاريخين لتعيين فترة إجازة معتمدة. سيضع المُجدوِل التلقائي AL في تلك الأيام ويتخطى الموظف. الرصيد الرقمي أعلاه يُتتَبَّع بشكل منفصل.',
  'modal.employee.annual.start': 'بداية الإجازة (YYYY-MM-DD)',
  'modal.employee.annual.end': 'نهاية الإجازة (YYYY-MM-DD)',

  // Variables tab — operating window + Art. 86
  'variables.operatingWindow.note': 'ساعات الافتتاح / الإغلاق الافتراضية المستخدمة عند عدم وجود تجاوز يومي.',
  'variables.operatingWindow.defaultOpen': 'وقت الافتتاح الافتراضي',
  'variables.operatingWindow.defaultClose': 'وقت الإغلاق الافتراضي',
  'variables.operatingWindow.perDayHeader': 'تجاوز يومي (اختياري)',
  'variables.operatingWindow.perDayNote': 'فعّل أي يوم لتجاوز الإعداد الافتراضي. مفيد عندما تمتد ساعات العمل في أيام الذروة — مثلاً إغلاق يوم الجمعة في الساعة ٢:٠٠ بدل ١١:٠٠.',
  'variables.art86.title': 'المادة ٨٦ — العمل الليلي للنساء',
  'variables.art86.subtitle': 'في المنشآت الصناعية: لا يجوز تشغيل النساء بين ساعات الليل المحددة.',
  'variables.art86.enable': 'تطبيق سقف العمل الليلي بحسب المادة ٨٦',
  'variables.art86.start': 'بداية النافذة الليلية',
  'variables.art86.end': 'نهاية النافذة الليلية',
  'variables.art86.note': 'عند التفعيل، أي وردية صناعية تتداخل مع النافذة المضبوطة وتُسنَد لموظفة تظهر كمخالفة للمادة ٨٦. يعتبرها المُجدوِل التلقائي قاعدة صارمة عند مستويي الالتزام والاستمرارية.',

  // Company switcher
  'company.header': 'الشركات / الفروع',
  'company.add': 'إضافة شركة',
  'company.rename': 'إعادة تسمية',
  'company.delete': 'حذف',
  'company.newPlaceholder': 'اسم الشركة…',
  'company.renamePlaceholder': 'الاسم الجديد…',
  'company.cannotDelete.title': 'لا يمكن إزالة آخر شركة',
  'company.cannotDelete.body': 'يجب أن تبقى شركة واحدة على الأقل. أضف شركة أخرى أولاً، ثم احذف هذه.',
  'company.confirmDelete.title': 'إزالة شركة',
  'company.confirmDelete.body': 'حذف {name} نهائيًا مع كل موظفيها وجداولها ومحطاتها وإعداداتها؟ لا يمكن التراجع إلا إذا كانت لديك نسخة احتياطية.',

  // Simulation mode
  'sim.toolbar.enter': 'محاكاة',
  'sim.toolbar.exit': 'إنهاء المحاكاة',
  'sim.toolbar.statusLabel': 'وضع تجريبي · لا حفظ',
  'sim.banner.eyebrow': 'وضع المحاكاة',
  'sim.banner.title': 'بيئة تجريبية — التغييرات لا تُحفظ',
  'sim.metric.workforce': 'القوى العاملة',
  'sim.metric.coverage': '٪ التغطية',
  'sim.metric.otHours': 'ساعات إضافية',
  'sim.metric.otPay': 'أجر الإضافي (دينار)',
  'sim.metric.violations': 'المخالفات',
  'sim.delta.unchanged': 'بدون تغيير',
  'sim.action.reset': 'استعادة',
  'sim.action.apply': 'تطبيق',
  'sim.action.exit': 'تجاهل',
  'sim.locked.companyChange': 'أنهِ وضع المحاكاة قبل تبديل الشركات — البيئة التجريبية تغطي فقط الشركة التي بدأت معها.',

  // Coverage-gap hint toast
  'hint.coverage.eyebrow': 'تنبيه تغطية',
  'hint.coverage.title': 'اليوم {day} · {station} بات يعاني فجوة',
  'hint.coverage.body': 'اختر بديلاً لسد الفراغ، أو أبقِ الفجوة إن كان ذلك مقصودًا.',
  'hint.coverage.tag.off': 'يوم راحة',
  'hint.coverage.tag.recommended': 'موصى به',
  'hint.coverage.noCandidates': 'لا يوجد مرشحون مؤهلون.',
  'hint.coverage.override': 'انقر "إبقاء الفجوة" لتركها مفتوحة.',
  'hint.coverage.keepGap': 'إبقاء الفجوة',

  // Schedule staleness banner
  'schedule.stale.header': 'الجدول يحتوي مراجع غير صالحة',
  'schedule.stale.body': '{emps} موظفين و{shifts} رموز ورديات و{stations} محطات مُشار إليها في جدول هذا الشهر لم تعد موجودة.',
  'schedule.stale.rerun': 'إعادة تشغيل المُجدوِل التلقائي',

  // Info dialogs
  'info.notice.title': 'إشعار',
  'info.error.title': 'تعذّر تنفيذ الإجراء',
  'info.factoryReset.body': 'تم مسح كل البيانات على الخادم وفي المتصفح. ستتم إعادة تحميل الصفحة الآن.',
  'info.factoryReset.failed': 'فشل إعادة الضبط. حاول مرة أخرى أو تحقق من سجلات الخادم.',
  'info.shutdown.body': 'يجري إيقاف تشغيل الخادم. يمكنك إغلاق النافذة الآن.',
  'info.seed.title': 'تم تحميل بيانات نموذجية',
  'info.seed.body': 'تم بذر ٣٥ مشغّلاً و١٢ صرّافاً. استخدم الجدولة التلقائية لملء الشهر.',
  'info.csvImport.title': 'اكتمل استيراد CSV',
  'info.csvImport.body': 'تم استيراد {count} سجل موظف بنجاح.',
  'info.backup.invalidFile': 'يرجى اختيار ملف نسخة احتياطية بصيغة .json.',
  'info.backup.parseFailed': 'خطأ في قراءة ملف النسخة الاحتياطية: {msg}',

  // Dashboard FTE forecast
  'dashboard.kpi.fteForecast': 'التوظيف الموصى به',

  // Post-update toast
  'info.updated.title': 'تم التحديث إلى الإصدار {version}',
  'info.updated.body': 'تم تحديث مُجدوِل العمل العراقي من الإصدار {from} إلى {to}.\n\nتم حفظ نسخة احتياطية لبياناتك قبل بدء الإصدار الجديد في:\n{snapshot}\n\nيمكنك حذف هذه النسخة لاحقًا إن سار كل شيء على ما يرام. يحتفظ النظام تلقائيًا بأحدث خمس نسخ.',
  'info.updated.snapshotMissing': '(لا توجد نسخة — مجلد البيانات كان فارغًا)',
};

const DICTS: Record<Locale, Dict> = { en, ar };

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  // `t('confirm.removeEmp.body', { id: 'EMP-1000' })` substitutes "{id}" with
  // the corresponding value. Missing placeholders are left in-place so they're
  // visibly broken rather than silently dropped.
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] != null ? String(vars[key]) : match;
  });
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'ar' ? 'ar' : 'en';
  });

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  // Sync the dir attribute and lang attribute on the document so any third-party
  // CSS or components that key off the document direction work correctly.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }, [dir, locale]);

  const setLocale = useCallback((loc: Locale) => {
    setLocaleState(loc);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, loc);
    }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const dict = DICTS[locale];
    const template = key in dict ? dict[key] : (key in en ? en[key] : key);
    return interpolate(template, vars);
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dir }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive default: outside the provider just echo English.
    return {
      locale: 'en',
      setLocale: () => {},
      t: (k: string, vars?: Record<string, string | number>) => interpolate(en[k] ?? k, vars),
      dir: 'ltr',
    };
  }
  return ctx;
}
