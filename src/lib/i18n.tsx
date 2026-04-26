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

  // Schedule tab
  'schedule.title': 'Master Schedule',

  // Staffing Advisory
  'advisory.title': 'Staffing Advisory',
  'advisory.gaps': 'Coverage Gaps Detected',
  'advisory.optimal': 'Optimal Staffing',
  'advisory.hireToClose': 'Hire to Close Gaps',
  'advisory.toHire': 'to hire',
  'advisory.totalNote': 'additional personnel needed at peak. Hiring this mix would resolve every station shortfall without leaning on overtime or rest-day waivers.',

  // Misc
  'common.affects': 'Affects:',
  'common.more': 'more',
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

  // Schedule tab
  'schedule.title': 'الجدول الرئيسي',

  // Staffing Advisory
  'advisory.title': 'استشارة التوظيف',
  'advisory.gaps': 'تم رصد فجوات تغطية',
  'advisory.optimal': 'توظيف مثالي',
  'advisory.hireToClose': 'وظِّف لسد الفجوات',
  'advisory.toHire': 'للتوظيف',
  'advisory.totalNote': 'موظفون إضافيون مطلوبون في الذروة. توظيف هذا المزيج سيحل كل نقص في المحطات دون اللجوء للعمل الإضافي أو إلغاء أيام الراحة.',

  // Misc
  'common.affects': 'يؤثر على:',
  'common.more': 'المزيد',
};

const DICTS: Record<Locale, Dict> = { en, ar };

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
}

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

  const t = useCallback((key: string) => {
    const dict = DICTS[locale];
    if (key in dict) return dict[key];
    if (key in en) return en[key]; // English fallback for any missing translation
    return key;
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
      t: (k: string) => en[k] ?? k,
      dir: 'ltr',
    };
  }
  return ctx;
}
