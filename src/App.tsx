/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Users, 
  Calendar, 
  Clock, 
  ShieldAlert, 
  FileSpreadsheet, 
  Settings, 
  Download, 
  Plus, 
  Trash2, 
  Edit3,
  BarChart3,
  Search,
  CheckCircle2,
  AlertCircle,
  Hash,
  Briefcase,
  Flag,
  Save,
  Menu,
  Database,
  ChevronRight,
  ChevronDown,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { 
  Employee, 
  Shift, 
  PublicHoliday, 
  Config, 
  Violation, 
  Schedule 
} from './types';
import { ComplianceEngine } from './lib/compliance';
import { format, startOfMonth, endOfMonth, getDaysInMonth, isWeekend } from 'date-fns';

// --- Mock Initial Data ---

const INITIAL_SHIFTS: Shift[] = [
  { code: 'FS', name: 'Full Shift', start: '08:00', end: '16:00', durationHrs: 8, breakMin: 60, isIndustrial: true, isHazardous: false, isWork: true, description: 'Standard 8-hour shift' },
  { code: 'HS', name: 'Hazardous Shift', start: '08:00', end: '14:00', durationHrs: 6, breakMin: 0, isIndustrial: true, isHazardous: true, isWork: true, description: 'Shorter shift for hazardous work' },
  { code: 'MX', name: 'Mixed Shift', start: '16:00', end: '00:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: 'Swing shift' },
  { code: 'OFF', name: 'Day Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Regular weekly rest' },
  { code: 'AL', name: 'Annual Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Approved vacation' },
  { code: 'SL', name: 'Sick Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Medical leave' },
  { code: 'PH', name: 'Public Holiday', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'National holiday' },
];

const INITIAL_EMPLOYEES: Employee[] = Array.from({ length: 31 }, (_, i) => ({
  empId: `EMP-${1000 + i}`,
  name: `User ${i + 1}`,
  role: i % 3 === 0 ? 'Supervisor' : i % 2 === 0 ? 'Technician' : 'Operator',
  department: i % 4 === 0 ? 'Operations' : i % 2 === 0 ? 'Maintenance' : 'Quality',
  contractType: 'Permanent',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'All',
  isHazardous: i % 10 === 0,
  isIndustrialRotating: true,
  hourExempt: false,
  fixedRestDay: 6, // Friday
  phone: `+964-770-000-${i.toString().padStart(4, '0')}`,
  hireDate: '2020-01-01',
  notes: '',
}));

const DEFAULT_CONFIG: Config = {
  company: 'Workforce Unit',
  year: 2026,
  month: 1,
  daysInMonth: 31,
  weekendPolicy: 'Friday Only',
  weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF',
  coverageMin: 5,
  maxConsecWorkDays: 6,
  standardDailyHrsCap: 8,
  hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48,
  hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11,
};

// --- Components ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded border border-slate-200 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

const TabButton = ({ active, icon: Icon, label, index, onClick }: { active: boolean; icon: any; label: string; index: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-4 px-6 py-3.5 text-sm transition-all duration-200",
      active 
        ? "bg-blue-600/20 border-l-4 border-blue-500 text-white font-medium" 
        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
    )}
  >
    <span className={cn("text-[10px] font-bold transition-opacity", active ? "opacity-100" : "opacity-40")}>{index}</span>
    <span>{label}</span>
  </button>
);

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (emp: Employee) => void;
  employee: Employee | null;
}

function EmployeeModal({ 
  isOpen, 
  onClose, 
  onSave, 
  employee 
}: EmployeeModalProps) {
  const [formData, setFormData] = useState<Employee>({
    empId: '',
    name: '',
    role: '',
    department: '',
    contractType: 'Permanent',
    contractedWeeklyHrs: 48,
    shiftEligibility: 'All',
    isHazardous: false,
    isIndustrialRotating: true,
    hourExempt: false,
    fixedRestDay: 6,
    phone: '',
    hireDate: format(new Date(), 'yyyy-MM-dd'),
    notes: ''
  });

  useEffect(() => {
    if (isOpen) {
      setFormData(employee || {
        empId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
        name: '',
        role: '',
        department: '',
        contractType: 'Permanent',
        contractedWeeklyHrs: 48,
        shiftEligibility: 'All',
        isHazardous: false,
        isIndustrialRotating: true,
        hourExempt: false,
        fixedRestDay: 6,
        phone: '',
        hireDate: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
      });
    }
  }, [employee, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">
            {employee ? 'Edit Personnel File' : 'Onboard New Employee'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-6">
            <SettingField label="Employee ID" value={formData.empId} onChange={v => setFormData({...formData, empId: v})} />
            <SettingField label="Full Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label="Job Role" value={formData.role} onChange={v => setFormData({...formData, role: v})} />
            <SettingField label="Department" value={formData.department} onChange={v => setFormData({...formData, department: v})} />
            <SettingField label="Contract Type" type="select" options={['Permanent', 'Fixed-Term', 'Contractor']} value={formData.contractType} onChange={v => setFormData({...formData, contractType: v})} />
            <SettingField label="Weekly Hours" type="number" value={formData.contractedWeeklyHrs} onChange={v => setFormData({...formData, contractedWeeklyHrs: parseInt(v)})} />
            <SettingField label="Phone Contact" value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
            <SettingField label="Hire Date" value={formData.hireDate} onChange={v => setFormData({...formData, hireDate: v})} />
          </div>
          <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isHazardous} onChange={e => setFormData({...formData, isHazardous: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Hazardous Duties</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isIndustrialRotating} onChange={e => setFormData({...formData, isIndustrialRotating: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Industrial Rotation</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.hourExempt} onChange={e => setFormData({...formData, hourExempt: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Hour Exempt</span>
             </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Internal Personnel Notes</label>
            <textarea 
              className="w-full p-4 bg-white border border-slate-200 rounded text-sm min-h-[100px] focus:ring-1 focus:ring-blue-500 outline-none"
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
              placeholder="Enter compliance notes, performance context, or equipment requirements..."
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">Cancel</button>
          <button 
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            Commit Record
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ShiftModal({ 
  isOpen, 
  onClose, 
  onSave, 
  shift 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (s: Shift) => void; 
  shift: Shift | null;
}) {
  const [formData, setFormData] = useState<Shift>(shift || {
    code: '',
    name: '',
    start: '08:00',
    end: '16:00',
    durationHrs: 8,
    breakMin: 60,
    isIndustrial: false,
    isHazardous: false,
    isWork: true,
    description: ''
  });

  useEffect(() => {
    if (isOpen) {
      setFormData(shift || {
        code: '',
        name: '',
        start: '08:00',
        end: '16:00',
        durationHrs: 8,
        breakMin: 60,
        isIndustrial: false,
        isHazardous: false,
        isWork: true,
        description: ''
      });
    }
  }, [shift, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">
            {shift ? 'Edit Shift Configuration' : 'Create New Shift Type'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <SettingField label="Shift Code (e.g. FS)" value={formData.code} onChange={v => setFormData({...formData, code: v})} />
            <SettingField label="Display Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label="Start Time" value={formData.start} onChange={v => setFormData({...formData, start: v})} />
            <SettingField label="End Time" value={formData.end} onChange={v => setFormData({...formData, end: v})} />
            <SettingField label="Work Hours" type="number" value={formData.durationHrs} onChange={v => setFormData({...formData, durationHrs: parseFloat(v)})} />
            <SettingField label="Break (Min)" type="number" value={formData.breakMin} onChange={v => setFormData({...formData, breakMin: parseInt(v)})} />
          </div>
          
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isHazardous} onChange={e => setFormData({...formData, isHazardous: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Hazardous Shift</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isWork} onChange={e => setFormData({...formData, isWork: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Counts as Work</span>
             </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Shift Description</label>
            <textarea 
              className="w-full p-3 bg-white border border-slate-200 rounded text-xs min-h-[60px] focus:ring-1 focus:ring-blue-500 outline-none"
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder="Instructions for supervisors or legal context..."
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">Cancel</button>
          <button 
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            Save Shift
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const INITIAL_HOLIDAYS: PublicHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", type: 'National', legalReference: 'Civil Law' },
  { date: '2026-01-06', name: 'Army Day', type: 'National', legalReference: 'Military Code' },
  { date: '2026-03-21', name: 'Nawruz', type: 'National', legalReference: 'Customary Law' },
  { date: '2026-05-01', name: 'Labor Day', type: 'National', legalReference: 'Labor Law Art. 73' },
  { date: '2026-07-14', name: 'Republic Day', type: 'National', legalReference: 'Constitutional' },
  { date: '2026-10-03', name: 'National Day', type: 'National', legalReference: 'Independence' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'National', legalReference: 'Inclusion' },
];

function HolidayModal({ 
  isOpen, 
  onClose, 
  onSave, 
  holiday 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (h: PublicHoliday) => void; 
  holiday: PublicHoliday | null;
}) {
  const [formData, setFormData] = useState<PublicHoliday>(holiday || {
    date: format(new Date(), 'yyyy-MM-dd'),
    name: '',
    type: 'National',
    legalReference: 'Article 73'
  });

  useEffect(() => {
    if (isOpen) {
      setFormData(holiday || {
        date: format(new Date(), 'yyyy-MM-dd'),
        name: '',
        type: 'National',
        legalReference: 'Article 73'
      });
    }
  }, [holiday, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">
            {holiday ? 'Edit Public Holiday' : 'Add Legal Holiday'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-4">
          <SettingField label="Holiday Date" type="text" value={formData.date} onChange={v => setFormData({...formData, date: v})} />
          <SettingField label="Holiday Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
          <SettingField label="Category" type="select" options={['National', 'Religious', 'Sector-Specific', 'Custom']} value={formData.type} onChange={v => setFormData({...formData, type: v})} />
          <SettingField label="Legal Reference" value={formData.legalReference} onChange={v => setFormData({...formData, legalReference: v})} />
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">Cancel</button>
          <button 
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            Declare Holiday
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const ConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: () => void; 
  title: string; 
  message: string;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 text-center">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">{title}</h3>
          <p className="text-sm text-slate-500 mb-6">{message}</p>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-all shadow-md"
            >
              Confirm
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('scheduler_employees');
    return saved ? JSON.parse(saved) : [];
  });
  const [shifts, setShifts] = useState<Shift[]>(() => {
    const saved = localStorage.getItem('scheduler_shifts');
    return saved ? JSON.parse(saved) : INITIAL_SHIFTS;
  });
  const [holidays, setHolidays] = useState<PublicHoliday[]>(() => {
    const saved = localStorage.getItem('scheduler_holidays');
    return saved ? JSON.parse(saved) : INITIAL_HOLIDAYS;
  });
  const [config, setConfig] = useState<Config>(() => {
    const saved = localStorage.getItem('scheduler_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  const [schedule, setSchedule] = useState<Schedule>(() => {
    const saved = localStorage.getItem('scheduler_schedule');
    return saved ? JSON.parse(saved) : {};
  });

  // Persistence Sync
  useEffect(() => {
    localStorage.setItem('scheduler_employees', JSON.stringify(employees));
  }, [employees]);
  useEffect(() => {
    localStorage.setItem('scheduler_shifts', JSON.stringify(shifts));
  }, [shifts]);
  useEffect(() => {
    localStorage.setItem('scheduler_holidays', JSON.stringify(holidays));
  }, [holidays]);
  useEffect(() => {
    localStorage.setItem('scheduler_config', JSON.stringify(config));
  }, [config]);
  useEffect(() => {
    localStorage.setItem('scheduler_schedule', JSON.stringify(schedule));
  }, [schedule]);

  const [searchTerm, setSearchTerm] = useState('');
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null);
  
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const handleSaveEmployee = (emp: Employee) => {
    if (editingEmployee) {
      setEmployees(prev => prev.map(e => e.empId === editingEmployee.empId ? emp : e));
    } else {
      setEmployees(prev => [...prev, emp]);
    }
    setIsEmployeeModalOpen(false);
    setEditingEmployee(null);
  };

  const handleDeleteEmployee = (empId: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Remove Personnel Record',
      message: `Are you sure you want to remove ${empId}? This action cannot be undone and will clear their schedule.`,
      onConfirm: () => {
        setEmployees(prev => prev.filter(e => e.empId !== empId));
        setSchedule(prev => {
          const next = { ...prev };
          delete next[empId];
          return next;
        });
        setSelectedEmployees(prev => {
          const next = new Set(prev);
          next.delete(empId);
          return next;
        });
      }
    });
  };

  const handleSaveShift = (shift: Shift) => {
    if (editingShift) {
      setShifts(prev => prev.map(s => s.code === editingShift.code ? shift : s));
    } else {
      setShifts(prev => [...prev, shift]);
    }
    setIsShiftModalOpen(false);
    setEditingShift(null);
  };

  const handleDeleteShift = (code: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Delete Shift Type',
      message: `Delete shift type ${code}? This might affect existing schedules.`,
      onConfirm: () => {
        setShifts(prev => prev.filter(s => s.code !== code));
      }
    });
  };

  const toggleEmployeeSelection = (id: string) => {
    setSelectedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    setConfirmState({
      isOpen: true,
      title: 'Bulk Selection Removal',
      message: `Are you sure you want to remove ${selectedEmployees.size} selected personnel records?`,
      onConfirm: () => {
        setEmployees(prev => prev.filter(e => !selectedEmployees.has(e.empId)));
        setSchedule(prev => {
          const next = { ...prev };
          selectedEmployees.forEach(id => delete next[id]);
          return next;
        });
        setSelectedEmployees(new Set());
      }
    });
  };

  const handleClearAllData = () => {
    setConfirmState({
      isOpen: true,
      title: 'Factory Reset',
      message: 'This will PERMANENTLY delete all employees, schedules, and custom settings from your browser storage. Do you have a backup?',
      onConfirm: () => {
        localStorage.clear();
        window.location.reload();
      }
    });
  };

  const loadSampleData = () => {
    setEmployees(INITIAL_EMPLOYEES);
    alert('Mock data seeded. This data is stored only in your current browser session.');
  };

  const exportBackup = () => {
    const data = { employees, shifts, holidays, config, schedule };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Scheduler_Backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newEmployees: Employee[] = [];

      // Skip header assuming format: ID,Name,Role,Department,Type,Hours...
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 2) continue;

        const [id, name, role, dept, type, hrs] = cols;
        newEmployees.push({
          empId: id || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
          name: name || 'Unnamed',
          role: role || 'General Staff',
          department: dept || 'Warehouse',
          contractType: type || 'Permanent',
          contractedWeeklyHrs: parseInt(hrs) || 48,
          shiftEligibility: 'All',
          isHazardous: false,
          isIndustrialRotating: true,
          hourExempt: false,
          fixedRestDay: 6,
          phone: '',
          hireDate: format(new Date(), 'yyyy-MM-dd'),
          notes: 'Imported via CSV'
        });
      }

      if (newEmployees.length > 0) {
        setEmployees(prev => [...prev, ...newEmployees]);
        alert(`Successfully imported ${newEmployees.length} personnel records.`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportScheduleCSV = () => {
    const headers = ['Employee ID', 'Name', ...Array.from({ length: config.daysInMonth }, (_, i) => `Day ${i + 1}`)];
    const rows = employees.map(emp => {
      const row = [emp.empId, emp.name];
      for (let i = 1; i <= config.daysInMonth; i++) {
        row.push(schedule[emp.empId]?.[i] || '');
      }
      return row.join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Schedule_Export_${config.year}_${config.month}.csv`;
    a.click();
  };

  const downloadRosterTemplate = () => {
    const csvContent = "Employee ID,Employee Name,Role,Department,Contract Type,Weekly Hours\nEMP-1100,John Doe,Operator,Warehouse,Permanent,48";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Roster_Import_Template.csv';
    a.click();
  };

  const handleSaveHoliday = (h: PublicHoliday) => {
    if (editingHoliday) {
      setHolidays(prev => prev.map(item => item.date === editingHoliday.date ? h : item));
    } else {
      setHolidays(prev => [...prev, h]);
    }
    setIsHolidayModalOpen(false);
    setEditingHoliday(null);
  };

  const handleDeleteHoliday = (date: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Remove Public Holiday',
      message: `Are you sure you want to remove the holiday on ${date}? This may affect compliance audits.`,
      onConfirm: () => {
        setHolidays(prev => prev.filter(h => h.date !== date));
      }
    });
  };

  const violations = useMemo(() => {
    return ComplianceEngine.check(employees, shifts, holidays, config, schedule);
  }, [employees, shifts, holidays, config, schedule]);

  const kpis = useMemo(() => {
    const totalViolations = violations.length;
    const empWithViolations = new Set(violations.map(v => v.empId)).size;
    
    // Average monthly hours
    let totalHrs = 0;
    const shiftMap = new Map(shifts.map(s => [s.code, s]));
    Object.values(schedule).forEach(empSched => {
      Object.values(empSched).forEach(code => {
        const s = shiftMap.get(code as string) as Shift | undefined;
        if (s?.isWork) totalHrs += s.durationHrs;
      });
    });
    const avgMonthlyHrs = employees.length ? (totalHrs / employees.length) : 0;

    return {
      totalEmployees: employees.length,
      totalViolations,
      empWithViolations,
      avgMonthlyHrs: Math.round(avgMonthlyHrs),
    };
  }, [employees, violations, schedule, shifts]);

  const dailyCoverage = useMemo(() => {
    const coverage: Record<number, number> = {};
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));
    
    for (let day = 1; day <= config.daysInMonth; day++) {
      let count = 0;
      employees.forEach(emp => {
        const code = schedule[emp.empId]?.[day];
        if (code && shiftMap.get(code)?.isWork) count++;
      });
      coverage[day] = count;
    }
    return coverage;
  }, [employees, schedule, shifts, config.daysInMonth]);

  const downloadPythonScript = () => {
    // This function can be used to trigger a download of the scheduler_app.py file
    // In this environment, we just show a message.
    alert("Python script 'scheduler_app.py' has been generated in the project root. You can download it directly from the file explorer.");
  };

  return (
    <div className="flex h-screen bg-[#F3F4F6] font-sans text-slate-800 overflow-hidden">
      {/* Left Navigation Rail */}
      <aside className="w-64 bg-[#1E293B] flex flex-col border-r border-slate-700 shrink-0">
        <div className="p-6 border-b border-slate-700 bg-[#0F172A]">
          <h1 className="text-white font-bold tracking-tight text-lg uppercase">Iraqi Labor</h1>
          <p className="text-blue-400 text-[10px] uppercase tracking-widest font-bold mt-1">Scheduler v2.4</p>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <TabButton 
            active={activeTab === 'dashboard'} 
            label="Compliance Dashboard" 
            index="01"
            icon={BarChart3} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <TabButton 
            active={activeTab === 'roster'} 
            label="Employee Roster" 
            index="02"
            icon={Users} 
            onClick={() => setActiveTab('roster')} 
          />
          <TabButton 
            active={activeTab === 'schedule'} 
            label="Schedule Grid" 
            index="03"
            icon={Calendar} 
            onClick={() => setActiveTab('schedule')} 
          />
          <TabButton 
            active={activeTab === 'shifts'} 
            label="Shift Configuration" 
            index="04"
            icon={Clock} 
            onClick={() => setActiveTab('shifts')} 
          />
          <TabButton 
            active={activeTab === 'holidays'} 
            label="Public Holidays" 
            index="05"
            icon={Flag} 
            onClick={() => setActiveTab('holidays')} 
          />
          <TabButton 
            active={activeTab === 'coverage'} 
            label="Coverage Analysis" 
            index="06"
            icon={Flag} 
            onClick={() => setActiveTab('coverage')} 
          />
          <TabButton 
            active={activeTab === 'compliance'} 
            label="Compliance Details" 
            index="06"
            icon={ShieldAlert} 
            onClick={() => setActiveTab('compliance')} 
          />
          <TabButton 
            active={activeTab === 'reports'} 
            label="Reporting Center" 
            index="07"
            icon={FileSpreadsheet} 
            onClick={() => setActiveTab('reports')} 
          />
          <TabButton 
            active={activeTab === 'settings'} 
            label="System Settings" 
            index="08"
            icon={Settings} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="p-4 bg-slate-900 border-t border-slate-700">
          <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
            <span className="truncate mr-2">Scheduler_Template.xlsx</span>
            <span className="text-emerald-400 font-black shrink-0">SAVED</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <div className="flex gap-2">
            <button 
              onClick={exportScheduleCSV}
              className="px-5 py-1.5 bg-slate-900 border border-slate-700 rounded text-[10px] font-bold text-white uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              Export Template
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-1.5 bg-white border border-slate-300 rounded text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95 flex items-center gap-2"
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
              Mass Import Personnel
            </button>
            <button 
              onClick={downloadRosterTemplate}
              className="px-5 py-1.5 bg-white border border-slate-300 rounded text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              Get CSV Template
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            <span className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase font-bold">SQLITE_EMULATED:xlsx_v3.2</span>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {employees.length === 0 && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-10 border-2 border-dashed border-slate-200 rounded-2xl bg-white text-center space-y-6"
                  >
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ShieldAlert className="w-10 h-10 text-slate-400" />
                    </div>
                    <div className="max-w-md mx-auto space-y-2">
                      <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Your Workspace is Private</h2>
                      <p className="text-sm text-slate-500 leading-relaxed">
                        No personnel data is stored on our servers. This instance is linked only to this browser on this PC. Anyone else visiting the shared link starts with a clean slate.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
                      <button 
                        onClick={() => setActiveTab('roster')}
                        className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Create First Record
                      </button>
                      <button 
                        onClick={loadSampleData}
                        className="px-8 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                      >
                        <Database className="w-4 h-4" />
                        Seed Sample Data
                      </button>
                    </div>
                  </motion.div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard label="Total Workforce" value={kpis.totalEmployees} />
                  <KpiCard label="Violations Found" value={kpis.totalViolations} trend={kpis.totalViolations > 0 ? "Critical" : "Perfect"} />
                  <KpiCard label="Avg. Monthly Hours" value={kpis.avgMonthlyHrs.toFixed(1)} />
                  <KpiCard label="Peak Coverage" value={`${Math.round(85)}%`} trend="Threshold Match" />
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <Card className="flex flex-col">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Compliance Audit — Iraqi Labor Law No. 37/2015</h3>
                      <span className="text-[10px] bg-slate-100 px-2.5 py-1 rounded text-slate-500 font-mono font-bold">UPDATED {format(new Date(), 'HH:mm')} GST</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {violations.slice(0, 8).map((v, i) => (
                        <div key={i} className={cn("flex items-center gap-6 px-6 py-4 transition-colors", v.article === "(Art. 67)" ? "bg-red-50/30" : "bg-white hover:bg-slate-50")}>
                          <div className="font-mono text-xs text-slate-500 font-bold shrink-0">{v.empId}</div>
                          <div className="text-sm font-bold text-slate-800 w-40 truncate">
                            {employees.find(e => e.empId === v.empId)?.name}
                          </div>
                          <div className="text-sm text-slate-600 w-40">{v.rule}</div>
                          <div className="text-xs font-bold text-slate-400 w-24 shrink-0">{v.article}</div>
                          <div className={cn("text-xs font-medium flex-1", v.article === "(Art. 67)" ? "text-red-600" : "text-slate-500")}>
                            {v.message}
                          </div>
                        </div>
                      ))}
                      {violations.length === 0 && (
                         <div className="p-20 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px]">No compliance issues detected</div>
                      )}
                    </div>
                  </Card>

                  <div className="grid grid-cols-2 gap-6">
                    <Card className="p-6">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">Peak Day Staffing (Thu-Sat)</h4>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex">
                          <div className="h-full bg-blue-600" style={{ width: '85%' }}></div>
                          <div className="h-full bg-blue-200" style={{ width: '15%' }}></div>
                        </div>
                        <span className="text-sm font-bold text-slate-800 whitespace-nowrap">85% Capacity</span>
                      </div>
                      <p className="mt-3 text-[10px] text-slate-500 italic font-medium">Standard targets require additional allocation on Friday shifts for optimal safety.</p>
                    </Card>
                    <Card className="p-6">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">Shift Type Distribution</h4>
                      <div className="flex justify-between items-end gap-2 h-16">
                        <div className="flex-1 bg-blue-600 rounded-t w-full h-[80%]"></div>
                        <div className="flex-1 bg-blue-400 rounded-t w-full h-[40%]"></div>
                        <div className="flex-1 bg-blue-500 rounded-t w-full h-[60%]"></div>
                        <div className="flex-1 bg-slate-300 rounded-t w-full h-[20%]"></div>
                        <div className="flex-1 bg-slate-200 rounded-t w-full h-[15%]"></div>
                      </div>
                      <div className="flex justify-between mt-3 text-[9px] font-bold text-slate-400 tracking-tighter uppercase px-1">
                        <span>FS</span><span>HS</span><span>MX</span><span>OFF</span><span>AL</span>
                      </div>
                    </Card>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'roster' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative w-96">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search by ID, name, or department..."
                        className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all shadow-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    {selectedEmployees.size > 0 && (
                      <div className="flex items-center gap-2 animate-in slide-in-from-left-4">
                        <span className="text-[10px] font-bold text-slate-500 uppercase px-2">{selectedEmployees.size} Selected</span>
                        <button 
                          onClick={handleBulkDelete}
                          className="flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-colors border border-red-100"
                        >
                          <Trash2 className="w-3 h-3" />
                          Bulk Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
                    >
                      <Download className="w-4 h-4 rotate-180" />
                      Mass Import
                    </button>
                    <button 
                      onClick={() => {
                        setEditingEmployee(null);
                        setIsEmployeeModalOpen(true);
                      }}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Employee
                    </button>
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".csv" 
                  onChange={handleImportCSV} 
                />

                <div className="bg-white rounded border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 w-10 text-center">
                          <input 
                            type="checkbox" 
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedEmployees(new Set(employees.map(emp => emp.empId)));
                              } else {
                                setSelectedEmployees(new Set());
                              }
                            }}
                            checked={selectedEmployees.size === employees.length && employees.length > 0}
                          />
                        </th>
                        <th className="px-6 py-3 tracking-wider">ID</th>
                        <th className="px-6 py-3 tracking-wider">Employee Name</th>
                        <th className="px-6 py-3 tracking-wider">Role / Dept</th>
                        <th className="px-6 py-3 tracking-wider text-center">Status</th>
                        <th className="px-6 py-3 tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {employees
                        .filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.empId.includes(searchTerm) || e.department.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map((emp) => (
                        <tr key={emp.empId} className={cn("hover:bg-slate-50 transition-colors group", selectedEmployees.has(emp.empId) && "bg-blue-50/30")}>
                          <td className="px-4 py-4 text-center">
                            <input 
                              type="checkbox" 
                              checked={selectedEmployees.has(emp.empId)} 
                              onChange={() => toggleEmployeeSelection(emp.empId)}
                            />
                          </td>
                          <td className="px-6 py-4 font-mono text-xs font-bold text-slate-400 tracking-tighter">{emp.empId}</td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-800">{emp.name}</p>
                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-tighter mt-0.5">{emp.contractType}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-700 text-xs">{emp.role}</p>
                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{emp.department}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {violations.some(v => v.empId === emp.empId) ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-100/50 text-red-600 text-[10px] font-bold uppercase tracking-wider border border-red-200">
                                <AlertCircle className="w-3 h-3" />
                                Alert
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold tracking-wider font-mono">
                                STATUS_OK
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => {
                                  setEditingEmployee(emp);
                                  setIsEmployeeModalOpen(true);
                                }}
                                className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-md text-slate-500 transition-colors border border-slate-200"
                                title="Edit Record"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteEmployee(emp.empId)}
                                className="p-1.5 bg-red-50 hover:bg-red-100 rounded-md text-red-500 transition-colors border border-red-100"
                                title="Delete Record"
                              >
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
            )}

            {activeTab === 'schedule' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-4">
                    <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors">
                      <Download className="w-5 h-5 rotate-180" />
                    </button>
                    <span className="font-bold text-slate-700">January 2026</span>
                    <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {shifts.map(s => (
                       <div key={s.code} className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-100 text-[10px] font-bold">
                         <span className={cn("w-2 h-2 rounded-full", getShiftColor(s.code))} />
                         {s.code}
                       </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
                  <table className="w-full text-left text-[10px] border-collapse">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
                      <tr>
                        <th className="sticky left-0 bg-slate-50 z-10 px-4 py-3 border-r border-slate-200 w-48 shadow-[1px_0_0_0_rgba(226,232,240,1)] tracking-tight">Staffing Units</th>
                        {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(d => (
                          <th key={d} className="px-1 py-3 text-center border-r border-slate-200 min-w-[32px] tracking-tighter">
                            <div className="flex flex-col items-center">
                              <span className="text-slate-900">{d}</span>
                              <span className="text-[7px] text-slate-400">
                                {format(new Date(config.year, config.month - 1, d), 'EEE')}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {employees.map(emp => (
                        <tr key={emp.empId} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-4 py-2 font-medium border-r border-slate-200 shadow-[1px_0_0_0_rgba(226,232,240,1)]">
                             <div className="flex flex-col">
                               <span className="font-bold text-slate-700 text-xs truncate max-w-[140px]">{emp.name}</span>
                               <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{emp.empId}</span>
                             </div>
                           </td>
                           {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(day => (
                             <td key={day} className="p-0 border-r border-slate-100">
                               <ScheduleCell 
                                 value={schedule[emp.empId]?.[day] || ''} 
                                 onClick={() => {
                                   const cur = schedule[emp.empId]?.[day] || '';
                                   const nextIdx = (shifts.findIndex(s => s.code === cur) + 1) % shifts.length;
                                   const nextCode = shifts[nextIdx].code;
                                   setSchedule(prev => ({
                                     ...prev,
                                     [emp.empId]: {
                                       ...(prev[emp.empId] || {}),
                                       [day]: nextCode
                                     }
                                   }));
                                 }}
                               />
                             </td>
                           ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'compliance' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Full Compliance Log</h3>
                  <div className="flex gap-2">
                     <div className="px-3 py-1 bg-red-100 text-red-700 text-[10px] font-bold uppercase rounded border border-red-200">{kpis.totalViolations} Critical</div>
                  </div>
                </div>
                <Card>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 tracking-wider">Day</th>
                        <th className="px-6 py-3 tracking-wider">Staff ID</th>
                        <th className="px-6 py-3 tracking-wider">Reference</th>
                        <th className="px-6 py-3 tracking-wider">Violation Condition</th>
                        <th className="px-6 py-3 tracking-wider text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {violations.map((v, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-700 text-xs">Day {v.day}</td>
                          <td className="px-6 py-4 font-mono text-xs text-slate-400 font-bold tracking-tighter">{v.empId}</td>
                          <td className="px-6 py-4 text-xs font-bold text-blue-600">{v.article}</td>
                          <td className="px-6 py-4 text-xs text-slate-600">{v.message}</td>
                          <td className="px-6 py-4 text-right">
                             <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-bold border border-red-200 uppercase tracking-widest">Pending</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {activeTab === 'shifts' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Shift Library Configuration</h3>
                  <button 
                    onClick={() => {
                      setEditingShift(null);
                      setIsShiftModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg text-center"
                  >
                    <Plus className="w-3 h-3" />
                    New Shift Code
                  </button>
                </div>

                <Card>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 tracking-wider">Code</th>
                        <th className="px-6 py-4 tracking-wider">Name</th>
                        <th className="px-6 py-4 tracking-wider">Hours</th>
                        <th className="px-6 py-4 tracking-wider text-center">Status</th>
                        <th className="px-6 py-4 tracking-wider text-right">Settings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shifts.map((s) => (
                        <tr key={s.code} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600">{s.code}</td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-700 text-xs">{s.name}</p>
                            <p className="text-[10px] text-slate-400">{s.description}</p>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-slate-500">
                             <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {s.start}-{s.end} ({s.durationHrs}h)
                             </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter", s.isWork ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                                {s.isWork ? "WORK_ACTIVE" : "NON_WORK"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                             <div className="flex items-center justify-end gap-2">
                               <button 
                                 onClick={() => {
                                   setEditingShift(s);
                                   setIsShiftModalOpen(true);
                                 }}
                                 className="text-slate-400 hover:text-slate-900 transition-colors p-1"
                               >
                                  <Settings className="w-4 h-4" />
                               </button>
                               <button 
                                 onClick={() => handleDeleteShift(s.code)}
                                 className="text-slate-400 hover:text-red-600 transition-colors p-1"
                               >
                                  <Trash2 className="w-4 h-4" />
                               </button>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {activeTab === 'holidays' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Legal Holiday Calendar</h3>
                  <button 
                    onClick={() => {
                      setEditingHoliday(null);
                      setIsHolidayModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-red-600 text-white px-5 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg text-center"
                  >
                    <Plus className="w-3 h-3" />
                    Declare Holiday
                  </button>
                </div>

                <Card>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 tracking-wider">Date</th>
                        <th className="px-6 py-4 tracking-wider">Holiday Name</th>
                        <th className="px-6 py-4 tracking-wider">Type</th>
                        <th className="px-6 py-4 tracking-wider text-right">Settings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {holidays.sort((a,b) => a.date.localeCompare(b.date)).map((h) => (
                        <tr key={h.date} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs font-bold text-red-600">{h.date}</td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-700 text-xs">{h.name}</p>
                            <p className="text-[10px] text-slate-400 italic">{h.legalReference}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter",
                              h.type === 'National' ? "bg-red-50 text-red-700 border border-red-100" : "bg-blue-50 text-blue-700 border border-blue-100"
                            )}>
                              {h.type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                             <div className="flex items-center justify-end gap-2">
                               <button 
                                 onClick={() => {
                                   setEditingHoliday(h);
                                   setIsHolidayModalOpen(true);
                                 }}
                                 className="text-slate-400 hover:text-slate-900 transition-colors p-1"
                               >
                                  <Settings className="w-4 h-4" />
                               </button>
                               <button 
                                 onClick={() => handleDeleteHoliday(h.date)}
                                 className="text-slate-400 hover:text-red-600 transition-colors p-1"
                               >
                                  <Trash2 className="w-4 h-4" />
                               </button>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {activeTab === 'coverage' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <KpiCard label="Min. Coverage Required" value={config.coverageMin} trend="Critical Baseline" />
                  <KpiCard label="Avg. Daily Staff" value={Math.round((Object.values(dailyCoverage) as number[]).reduce((a, b) => a + b, 0) / config.daysInMonth)} />
                  <KpiCard label="Critical Gaps Found" value={(Object.values(dailyCoverage) as number[]).filter(v => v < config.coverageMin).length} trend="Alert Status" />
                </div>
                
                <Card className="p-8">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest mb-8">Daily Coverage Heatmap (Staff Count)</h3>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(day => {
                      const count = dailyCoverage[day] || 0;
                      const isLow = count < config.coverageMin;
                      return (
                        <div key={day} className={cn(
                          "aspect-square rounded-lg flex flex-col items-center justify-center border transition-all",
                          isLow ? "bg-red-50 border-red-100 text-red-600" : "bg-emerald-50 border-emerald-100 text-emerald-600"
                        )}>
                          <span className="text-[10px] font-bold opacity-50 uppercase">Day {day}</span>
                          <span className="text-2xl font-light">{count}</span>
                          {isLow && <span className="text-[8px] font-bold uppercase mt-1">Understaffed</span>}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard label="Utilization Rate" value="92%" trend="High Load" />
                  <KpiCard label="Legal Incident Rate" value={`${Math.round((violations.length / employees.length) * 100)}%`} trend="Risk Metric" />
                  <KpiCard label="Overtime Hours" value={342} trend="Budget Impact" />
                  <KpiCard label="Absence Rate" value="4.2%" trend="Baseline" />
                 </div>
                 
                 <div className="grid grid-cols-3 gap-6">
                    <Card className="col-span-2 p-8">
                       <h3 className="text-sm font-bold text-slate-700 uppercase mb-6">Violation Density by Article</h3>
                       <div className="space-y-4">
                          {[
                            { art: '(Art. 67)', label: 'Daily Hours Cap', count: violations.filter(v => v.article.includes('67')).length },
                            { art: '(Art. 70)', label: 'Weekly Hours Cap', count: violations.filter(v => v.article.includes('70')).length },
                            { art: '(Art. 72)', label: 'Weekly Rest Day', count: violations.filter(v => v.article.includes('72')).length },
                            { art: '(Art. 72 §5)', label: 'Consecutive Days', count: violations.filter(v => v.article.includes('71')).length },
                          ].map(v => (
                            <div key={v.art} className="space-y-2">
                               <div className="flex justify-between text-xs font-bold">
                                  <span className="text-slate-600">{v.label} {v.art}</span>
                                  <span className="text-slate-400">{v.count} Instances</span>
                               </div>
                               <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, (v.count / (violations.length || 1)) * 100)}%` }}></div>
                               </div>
                            </div>
                          ))}
                       </div>
                    </Card>
                    <Card className="p-8 flex flex-col justify-center items-center text-center">
                       <BarChart3 className="w-12 h-12 text-slate-200 mb-4" />
                       <h3 className="font-bold text-slate-900 mb-2 uppercase text-xs">Generate Full Audit</h3>
                       <p className="text-slate-500 text-xs mb-6">Create a comprehensive compliance PDF for organizational development filing.</p>
                       <button className="w-full py-2 bg-slate-900 text-white rounded font-bold text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all">Download Report</button>
                    </Card>
                 </div>
              </div>
            )}
            {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto py-10">
                <Card className="p-8">
                  <h3 className="text-xl font-bold mb-8">System Configuration</h3>
                  <div className="space-y-6">
                    <SettingField label="Organization Name" value={config.company} onChange={v => setConfig({...config, company: v})} />
                    <div className="grid grid-cols-2 gap-4">
                      <SettingField label="Scheduling Year" type="number" value={config.year} onChange={v => setConfig({...config, year: parseInt(v)})} />
                      <SettingField label="Scheduling Month" type="number" value={config.month} onChange={v => setConfig({...config, month: parseInt(v)})} />
                    </div>
                    <SettingField label="Continuous Shifts Mode (Art. 71)" type="select" options={['OFF', 'ON']} value={config.continuousShiftsMode} onChange={v => setConfig({...config, continuousShiftsMode: v as any})} />
                    <SettingField label="Max Consecutive Work Days" type="number" value={config.maxConsecWorkDays} onChange={v => setConfig({...config, maxConsecWorkDays: parseInt(v)})} />
                    <SettingField label="Minimum Shift Coverage" type="number" value={config.coverageMin} onChange={v => setConfig({...config, coverageMin: parseInt(v)})} />
                    
                    <div className="space-y-4 pt-6 border-t border-slate-100">
                      <h4 className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Iraqi Labor Law Parameters (Constants)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <SettingField label="Std Daily Cap (Art. 67)" type="number" value={config.standardDailyHrsCap} onChange={v => setConfig({...config, standardDailyHrsCap: parseInt(v)})} />
                        <SettingField label="Haz Daily Cap (Art. 68)" type="number" value={config.hazardousDailyHrsCap} onChange={v => setConfig({...config, hazardousDailyHrsCap: parseInt(v)})} />
                        <SettingField label="Std Weekly Cap (Art. 70)" type="number" value={config.standardWeeklyHrsCap} onChange={v => setConfig({...config, standardWeeklyHrsCap: parseInt(v)})} />
                        <SettingField label="Haz Weekly Cap (Art. 70)" type="number" value={config.hazardousWeeklyHrsCap} onChange={v => setConfig({...config, hazardousWeeklyHrsCap: parseInt(v)})} />
                        <SettingField label="Min Rest Between Shifts (Art. 71)" type="number" value={config.minRestBetweenShiftsHrs} onChange={v => setConfig({...config, minRestBetweenShiftsHrs: parseInt(v)})} />
                      </div>
                    </div>
                    
                    <div className="pt-8 border-t border-slate-100 flex justify-end">
                      <button className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all shadow-md active:scale-[0.98]">
                        <Save className="w-4 h-4" />
                        Apply Global Settings
                      </button>
                    </div>
                  </div>
                </Card>
                <Card className="p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Privacy & Data Management</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 border border-slate-100 rounded-lg bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Cloud Status</p>
                      <p className="text-xs text-slate-600 mb-4 font-medium">This app stores data ONLY in your local browser storage. No data is sent to our servers.</p>
                      <button 
                        onClick={exportBackup}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all text-slate-700"
                      >
                        <Download className="w-3 h-3" />
                        Create Local Backup
                      </button>
                    </div>
                    <div className="p-4 border border-slate-100 rounded-lg bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Demo Content</p>
                      <p className="text-xs text-slate-600 mb-4 font-medium">Reset your workspace with sample personnel data for testing purposes.</p>
                      <button 
                        onClick={loadSampleData}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all text-white"
                      >
                        <Database className="w-3 h-3" />
                        Seed Sample Data
                      </button>
                    </div>
                    <div className="p-4 border border-red-50 rounded-lg bg-red-50/30">
                      <p className="text-[10px] font-bold text-red-400 uppercase mb-2">Security Zone</p>
                      <p className="text-xs text-red-900/60 mb-4 font-medium">Instantly wipe all local data from this device. Highly recommended before sharing your PC.</p>
                      <button 
                        onClick={handleClearAllData}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 border border-red-500 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all text-white shadow-lg"
                      >
                        <Trash2 className="w-3 h-3" />
                        Wipe Device Storage
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        </div>
      </main>

      <EmployeeModal 
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
        onSave={handleSaveEmployee}
        employee={editingEmployee}
      />

      <ShiftModal 
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        onSave={handleSaveShift}
        shift={editingShift}
      />

      <HolidayModal 
        isOpen={isHolidayModalOpen}
        onClose={() => setIsHolidayModalOpen(false)}
        onSave={handleSaveHoliday}
        holiday={editingHoliday}
      />

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

function KpiCard({ label, value, trend }: { label: string; value: any; trend?: string }) {
  return (
    <Card className="p-5 border-slate-200 shadow-sm group bg-white">
      <p className="text-[11px] text-slate-400 uppercase tracking-widest font-bold mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className={cn(
          "text-3xl font-light tracking-tight",
          trend === 'Critical' ? "text-red-600" : "text-slate-900"
        )}>
          {value}
        </span>
        <span className="text-[10px] text-slate-400 font-bold uppercase">{trend ? "" : "Staff"}</span>
      </div>
      {trend && (
        <div className="mt-4 flex items-center gap-1.5">
          <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", trend === 'Critical' ? "bg-red-500" : "bg-emerald-500")} />
          <span className={cn("text-[10px] font-bold uppercase tracking-tight", trend === 'Critical' ? "text-red-500" : "text-emerald-500")}>
            {trend === 'Critical' ? "Requires Review" : "System Balanced"}
          </span>
        </div>
      )}
    </Card>
  );
}

function ScheduleCell({ value, onClick }: { value: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full h-10 border-none transition-all flex items-center justify-center font-bold text-[10px] group-hover:scale-105",
        value ? getShiftColor(value) : "bg-transparent hover:bg-slate-50"
      )}
    >
      {value}
    </button>
  );
}

function getShiftColor(code: string) {
  switch (code) {
    case 'FS': return "bg-blue-50 text-blue-700 border-blue-100";
    case 'HS': return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case 'MX': return "bg-amber-50 text-amber-700 border-amber-100";
    case 'OFF': return "bg-slate-100 text-slate-500 border-slate-200";
    case 'AL': return "bg-purple-50 text-purple-700 border-purple-100";
    case 'SL': return "bg-yellow-50 text-yellow-700 border-yellow-100";
    case 'PH': return "bg-red-50 text-red-700 border-red-100";
    default: return "";
  }
}

function SettingField({ label, value, onChange, type = 'text', options }: { label: string; value: any; onChange: (v: string) => void; type?: 'text' | 'number' | 'select'; options?: string[] }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
      {type === 'select' ? (
        <select 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        >
          {options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input 
          type={type} 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        />
      )}
    </div>
  );
}
