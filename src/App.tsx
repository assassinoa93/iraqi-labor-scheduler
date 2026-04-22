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
  ChevronUp,
  X,
  Layout,
  MousePointer2,
  Sparkles,
  Printer,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { 
  Employee, 
  Shift, 
  PublicHoliday, 
  Config, 
  Violation, 
  Schedule,
  Station,
  ScheduleEntry 
} from './types';
import { ComplianceEngine } from './lib/compliance';
import { format, startOfMonth, endOfMonth, getDaysInMonth, isWeekend, addMonths, subMonths, parse, addHours, isWithinInterval } from 'date-fns';
import { IRAQI_HOLIDAYS_2026 } from './lib/constants';
import { generatePDFReport } from './lib/pdfReport';

// --- Mock Initial Data ---

const INITIAL_SHIFTS: Shift[] = [
  { code: 'FS', name: 'Full Shift', start: '11:00', end: '19:00', durationHrs: 7, breakMin: 60, isIndustrial: false, isHazardous: false, isWork: true, description: 'Day operation shift' },
  { code: 'MX', name: 'Mixed Shift', start: '15:00', end: '23:00', durationHrs: 7.5, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: 'Evening operation shift' },
  { code: 'OFF', name: 'Day Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Regular weekly rest' },
  { code: 'AL', name: 'Annual Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Approved vacation' },
  { code: 'SL', name: 'Sick Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Medical leave' },
  { code: 'PH', name: 'Public Holiday', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'National holiday' },
];

const INITIAL_EMPLOYEES: Employee[] = Array.from({ length: 60 }, (_, i) => ({
  empId: `EMP-${1000 + i}`,
  name: `Personnel ${i + 1}`,
  role: i % 4 === 0 ? 'Supervisor' : i % 3 === 0 ? 'Cashier' : i % 2 === 0 ? 'Sales Associate' : 'Stock Handler',
  department: i % 5 === 0 ? 'Admin' : i % 3 === 0 ? 'Sales' : 'Logistics',
  contractType: 'Permanent',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'All',
  isHazardous: false,
  isIndustrialRotating: false,
  hourExempt: false,
  fixedRestDay: i % 7 === 0 ? 6 : 6, // Default to Friday for simplicity in sample
  phone: `+964-770-000-${i.toString().padStart(4, '0')}`,
  hireDate: '2022-01-01',
  notes: '',
  eligibleStations: [],
  holidayCredits: Math.floor(Math.random() * 3), // Some initial credits for realism
  baseMonthlySalary: i % 4 === 0 ? 2500000 : 1500000, 
  baseHourlyRate: 7500, // Used for OT calculations
  overtimeHours: 0
}));

const INITIAL_STATIONS: Station[] = [
  { id: 'ST-01', name: 'Main Gate', minHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#2563eb', description: 'Primary security and intake' },
  { id: 'ST-02', name: 'Sales Floor A', minHC: 4, openingTime: '11:00', closingTime: '23:00', color: '#059669', description: 'Zone A customer interaction' },
  { id: 'ST-03', name: 'Sales Floor B', minHC: 4, openingTime: '11:00', closingTime: '23:00', color: '#10b981', description: 'Zone B customer interaction' },
  { id: 'ST-04', name: 'Cash Desk 01', minHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#7c3aed', description: 'Payment processing' },
  { id: 'ST-05', name: 'Cash Desk 02', minHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#8b5cf6', description: 'Payment processing' },
  { id: 'ST-06', name: 'Warehouse Intake', minHC: 2, openingTime: '09:00', closingTime: '18:00', color: '#d97706', description: 'Logistics and delivery' },
  { id: 'ST-07', name: 'Packing Station', minHC: 3, openingTime: '11:00', closingTime: '22:00', color: '#ea580c', description: 'Order fulfillment' },
  { id: 'ST-08', name: 'Technical Support', minHC: 1, openingTime: '11:00', closingTime: '20:00', color: '#0891b2', description: 'IT and machinery' },
  { id: 'ST-09', name: 'Security Main', minHC: 2, openingTime: '00:00', closingTime: '23:59', color: '#475569', description: '24/7 Surveillance' },
  { id: 'ST-10', name: 'Customer Service', minHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#db2777', description: 'Information desk' },
];

const DEFAULT_CONFIG: Config = {
  company: 'Workforce Unit',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  daysInMonth: getDaysInMonth(new Date()),
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
  shopOpeningTime: '11:00',
  shopClosingTime: '23:00',
  holidays: []
};

// --- Components ---

const Card = ({ children, className, key }: { children: React.ReactNode; className?: string; key?: any }) => (
  <div key={key} className={cn("bg-white rounded border border-slate-200 shadow-sm overflow-hidden", className)}>
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

function StationModal({ isOpen, onClose, onSave, station }: { isOpen: boolean; onClose: () => void; onSave: (s: Station) => void; station: Station | null }) {
  const [formData, setFormData] = useState<Station>({
    id: '',
    name: '',
    minHC: 1,
    requiredRoles: [],
    openingTime: '08:00',
    closingTime: '23:00',
    color: '#3B82F6'
  });

  useEffect(() => {
    if (station) setFormData(station);
    else setFormData({ id: '', name: '', minHC: 1, requiredRoles: [], openingTime: '08:00', closingTime: '23:00', color: '#3B82F6' });
  }, [station, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-black text-slate-800 uppercase tracking-tighter">Station Profile</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Station ID / Name</label>
            <div className="flex gap-2">
              <input value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} placeholder="ID" className="w-24 bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
              <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Display Name" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Min Headcount</label>
               <input type="number" value={formData.minHC} onChange={e => setFormData({...formData, minHC: parseInt(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
             </div>
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Theme Color</label>
               <input type="color" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} className="w-full h-9 p-1 bg-slate-50 border border-slate-200 rounded-lg" />
             </div>
          </div>
        </div>
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-xs font-bold text-slate-400 uppercase tracking-widest px-4 py-2 hover:text-slate-600 transition-colors">Cancel</button>
          <button onClick={() => { onSave(formData); onClose(); }} className="bg-slate-900 text-white px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all">Save Station</button>
        </div>
      </motion.div>
    </div>
  );
}

function EmployeeModal({ 
  isOpen, 
  onClose, 
  onSave, 
  employee,
  stations
}: EmployeeModalProps & { stations: Station[] }) {
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
    notes: '',
    eligibleStations: [],
    baseMonthlySalary: 1500000,
    baseHourlyRate: 7500,
    holidayCredits: 0
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
        notes: '',
        eligibleStations: [],
        baseMonthlySalary: 1500000,
        baseHourlyRate: 7500,
        holidayCredits: 0
      });
    }
  }, [employee, isOpen]);

  if (!isOpen) return null;

  const toggleStation = (id: string) => {
    setFormData(prev => ({
      ...prev,
      eligibleStations: prev.eligibleStations.includes(id)
        ? prev.eligibleStations.filter(sid => sid !== id)
        : [...prev.eligibleStations, id]
    }));
  };

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
            <SettingField label="Base Monthly Salary (IQD)" type="number" value={formData.baseMonthlySalary} onChange={v => setFormData({...formData, baseMonthlySalary: parseInt(v)})} />
            <SettingField label="OT Hourly Rate (IQD)" type="number" value={formData.baseHourlyRate} onChange={v => setFormData({...formData, baseHourlyRate: parseInt(v)})} />
            <SettingField label="Holiday Credits (Days)" type="number" value={formData.holidayCredits} onChange={v => setFormData({...formData, holidayCredits: parseInt(v)})} />
          </div>

          <div className="space-y-3 p-4 bg-blue-50/30 rounded-lg border border-blue-100">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Station Eligibility (Layout Assignments)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stations.map(st => (
                <button
                  key={st.id}
                  onClick={() => toggleStation(st.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all border",
                    formData.eligibleStations.includes(st.id)
                      ? "bg-blue-600 border-blue-700 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-400 hover:border-blue-300"
                  )}
                >
                  <Plus className={cn("w-3 h-3", formData.eligibleStations.includes(st.id) && "rotate-45")} />
                  {st.name}
                </button>
              ))}
              {stations.length === 0 && <p className="text-[10px] text-slate-400 font-medium col-span-3">No stations defined in Layout tab yet.</p>}
            </div>
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
  shift,
  config
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (s: Shift) => void; 
  shift: Shift | null;
  config: Config;
}) {
  const [formData, setFormData] = useState<Shift>(shift || {
    code: '',
    name: '',
    start: '11:00',
    end: '19:00',
    durationHrs: 8,
    breakMin: 60,
    isIndustrial: false,
    isHazardous: false,
    isWork: true,
    description: ''
  });

  // Auto-calculate working hours and validate against business hours
  useEffect(() => {
    if (!formData.start || !formData.end) return;
    
    const [sH, sM] = formData.start.split(':').map(Number);
    const [eH, eM] = formData.end.split(':').map(Number);
    
    let diffMin = (eH * 60 + eM) - (sH * 60 + sM);
    if (diffMin < 0) diffMin += 24 * 60; // Crossing midnight
    
    const calculatedHrs = Math.max(0, (diffMin - (formData.breakMin || 0)) / 60);
    if (calculatedHrs !== formData.durationHrs) {
      setFormData(prev => ({ ...prev, durationHrs: Number(calculatedHrs.toFixed(2)) }));
    }
  }, [formData.start, formData.end, formData.breakMin]);

  const shopStart = parseInt((config.shopOpeningTime || '00:00').split(':')[0]);
  const shopEnd = parseInt((config.shopClosingTime || '23:59').split(':')[0]);
  const shiftStart = parseInt((formData.start || '00:00').split(':')[0]);
  const shiftEnd = parseInt((formData.end || '00:00').split(':')[0]);
  
  const isOutside = (shiftStart < shopStart) || (shiftEnd > shopEnd && shiftEnd !== 0) || (shiftEnd === 0 && shopEnd < 23);

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
            <SettingField label="Start Time" type="time" value={formData.start} onChange={v => setFormData({...formData, start: v})} />
            <SettingField label="End Time" type="time" value={formData.end} onChange={v => setFormData({...formData, end: v})} />
            <SettingField label="Work Hours (Auto)" type="number" value={formData.durationHrs} onChange={v => setFormData({...formData, durationHrs: parseFloat(v)})} />
            <SettingField label="Break (Min)" type="number" value={formData.breakMin} onChange={v => setFormData({...formData, breakMin: parseInt(v)})} />
          </div>

          {isOutside && formData.isWork && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[10px] font-bold uppercase tracking-tight">Warning: Shift falls outside business operating hours ({config.shopOpeningTime} - {config.shopClosingTime})</p>
            </div>
          )}
          
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
    return saved ? JSON.parse(saved) : IRAQI_HOLIDAYS_2026;
  });
  const [config, setConfig] = useState<Config>(() => {
    const saved = localStorage.getItem('scheduler_config');
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  });
  const [stations, setStations] = useState<Station[]>(() => {
    const saved = localStorage.getItem('scheduler_stations');
    return saved ? JSON.parse(saved) : [];
  });
  // Multi-month schedule storage: key is 'scheduler_schedule_YYYY_MM'
  const scheduleKey = `scheduler_schedule_${config.year}_${config.month}`;
  const [schedule, setSchedule] = useState<Schedule>(() => {
    const saved = localStorage.getItem(scheduleKey);
    const data = saved ? JSON.parse(saved) : {};
    // Migration: handle if old data was string-based
    Object.keys(data).forEach(empId => {
      Object.keys(data[empId]).forEach(day => {
        if (typeof data[empId][day] === 'string') {
          data[empId][day] = { shiftCode: data[empId][day] };
        }
      });
    });
    return data;
  });

  // Re-load schedule when month/year changes
  useEffect(() => {
    const nextKey = `scheduler_schedule_${config.year}_${config.month}`;
    const saved = localStorage.getItem(nextKey);
    const data = saved ? JSON.parse(saved) : {};
    Object.keys(data).forEach(empId => {
      Object.keys(data[empId]).forEach(day => {
        if (typeof data[empId][day] === 'string') {
          data[empId][day] = { shiftCode: data[empId][day] };
        }
      });
    });
    setSchedule(data);
  }, [config.year, config.month]);

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
    localStorage.setItem('scheduler_stations', JSON.stringify(stations));
  }, [stations]);
  useEffect(() => {
    localStorage.setItem(scheduleKey, JSON.stringify(schedule));
  }, [schedule, scheduleKey]);

  // Operational State
  const [paintMode, setPaintMode] = useState<{ shiftCode: string; stationId?: string } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(false);

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

  const violations = useMemo(() => {
    const rawViolations = ComplianceEngine.check(employees, shifts, holidays, config, schedule);
    // User request: OT calculations clear the "Weekly hours cap" violation
    return rawViolations.filter(v => v.rule !== "Weekly hours cap");
  }, [schedule, employees, shifts, config, holidays]);

  const dailyCoverage = useMemo(() => {
    const coverage: Record<number, number> = {};
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));
    
    for (let day = 1; day <= config.daysInMonth; day++) {
      let count = 0;
      employees.forEach(emp => {
        const entry = schedule[emp.empId]?.[day];
        const code = typeof entry === 'string' ? entry : entry?.shiftCode;
        if (code && shiftMap.get(code)?.isWork) count++;
      });
      coverage[day] = count;
    }
    return coverage;
  }, [employees, schedule, shifts, config.daysInMonth]);

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

  const moveShift = (index: number, direction: 'up' | 'down') => {
    const newShifts = [...shifts];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newShifts.length) return;
    [newShifts[index], newShifts[targetIndex]] = [newShifts[targetIndex], newShifts[index]];
    setShifts(newShifts);
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
        setEmployees([]);
        setStations([]);
        setSchedule({});
        setHolidays(IRAQI_HOLIDAYS_2026);
        alert('All data has been cleared. You can now seed new sample data or import your own.');
        window.location.reload();
      }
    });
  };

  const loadSampleData = () => {
    setStations(INITIAL_STATIONS);
    setEmployees(INITIAL_EMPLOYEES.map((emp, i) => ({
      ...emp,
      eligibleStations: [INITIAL_STATIONS[i % INITIAL_STATIONS.length].id, INITIAL_STATIONS[(i+1) % INITIAL_STATIONS.length].id]
    })));
    alert('Realistic sample data seeded with 60 personnel and 10 operational stations. Base wages and basic holiday credits initialized.');
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

        const [id, name, role, dept, type, hrs, salary] = cols;
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
          notes: 'Imported via CSV',
          eligibleStations: [],
          holidayCredits: 0,
          baseMonthlySalary: parseInt(salary) || 1500000,
          baseHourlyRate: 7500,
          overtimeHours: 0
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
        const entry = schedule[emp.empId]?.[i];
        row.push(typeof entry === 'string' ? entry : entry?.shiftCode || '');
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

  const handleSaveStation = (st: Station) => {
    if (selectedStation) {
      setStations(prev => prev.map(s => s.id === selectedStation.id ? st : s));
    } else {
      setStations(prev => [...prev, st]);
    }
    setIsStationModalOpen(false);
    setSelectedStation(null);
  };

  const nextMonth = () => {
    const next = addMonths(new Date(config.year, config.month - 1, 1), 1);
    setConfig(prev => ({
      ...prev,
      year: next.getFullYear(),
      month: next.getMonth() + 1,
      daysInMonth: getDaysInMonth(next)
    }));
  };

  const prevMonth = () => {
    const prev = subMonths(new Date(config.year, config.month - 1, 1), 1);
    setConfig(last => ({
      ...last,
      year: prev.getFullYear(),
      month: prev.getMonth() + 1,
      daysInMonth: getDaysInMonth(prev)
    }));
  };

  const runAutoScheduler = () => {
    const newSchedule: Schedule = {};
    const workShifts = shifts.filter(s => s.isWork);
    
    if (workShifts.length === 0 || stations.length === 0) {
      alert("Auto-scheduler requires at least one work shift and one station to be defined.");
      return;
    }

    const consecutiveWork = new Map<string, number>();
    const totalHoursWorked = new Map<string, number>();
    const workDaysCount = new Map<string, number>();
    
    employees.forEach(emp => {
      newSchedule[emp.empId] = {};
      consecutiveWork.set(emp.empId, 0);
      totalHoursWorked.set(emp.empId, 0);
      workDaysCount.set(emp.empId, 0);
    });

    const holidayDates = new Set((config.holidays || []).map(h => h.date));
    const targetHoursPerEmployee = (config.standardWeeklyHrsCap * 4); // Target monthly hours

    for (let day = 1; day <= config.daysInMonth; day++) {
      const dateStr = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
      const isHoliday = holidayDates.has(dateStr);

      // Randomize station order each day for variety
      const shuffledStations = [...stations].sort(() => Math.random() - 0.5);

      shuffledStations.forEach(station => {
        const stationOpen = parseInt(station.openingTime.split(':')[0] || '11');
        const stationClose = parseInt(station.closingTime.split(':')[0] || '23');
        const minStaff = station.minHC;

        for (let slot = 0; slot < minStaff; slot++) {
          let currentTime = stationOpen;
          
          while (currentTime < stationClose) {
            const targetShift = workShifts.find(s => {
              const sStart = parseInt(s.start.split(':')[0]);
              const sEnd = parseInt(s.end.split(':')[0]);
              return sStart >= currentTime || (sStart <= currentTime && sEnd > currentTime);
            }) || workShifts[0];

            const pool = [...employees].sort((a, b) => {
              // PRIORITY: Fair workload distribution
              // 1. Give priority to those with least hours
              // 2. Then those with least work days
              const hrsA = totalHoursWorked.get(a.empId) || 0;
              const hrsB = totalHoursWorked.get(b.empId) || 0;
              if (Math.abs(hrsA - hrsB) > 8) return hrsA - hrsB;

              const daysA = workDaysCount.get(a.empId) || 0;
              const daysB = workDaysCount.get(b.empId) || 0;
              return daysA - daysB;
            });

            const candidate = pool.find(emp => {
              const hasAssignmentToday = !!newSchedule[emp.empId][day];
              const isEligible = emp.eligibleStations.length === 0 || emp.eligibleStations.includes(station.id);
              const consec = consecutiveWork.get(emp.empId) || 0;
              
              const withinConsecLimit = consec < config.maxConsecWorkDays;
              const weekStart = Math.max(1, day - (day % 7));
              let weekHrs = 0;
              for(let wd = weekStart; wd <= day; wd++) {
                 const entry = newSchedule[emp.empId][wd];
                 const scode = entry?.shiftCode;
                 const s = shifts.find(sh => sh.code === scode);
                 if(s) weekHrs += s.durationHrs;
              }
              const maxWeekly = emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap;
              const withinWeeklyLimit = (weekHrs + targetShift.durationHrs) <= maxWeekly;

              // Don't assign more if already reached target hours and others haven't
              const myHrs = totalHoursWorked.get(emp.empId) || 0;
              if (myHrs >= targetHoursPerEmployee) {
                const someOneBehind = pool.some(e => (totalHoursWorked.get(e.empId) || 0) < targetHoursPerEmployee);
                if (someOneBehind) return false;
              }

              return !hasAssignmentToday && isEligible && withinConsecLimit && withinWeeklyLimit;
            });

            if (candidate) {
              newSchedule[candidate.empId][day] = {
                shiftCode: targetShift.code,
                stationId: station.id
              };
              consecutiveWork.set(candidate.empId, (consecutiveWork.get(candidate.empId) || 0) + 1);
              totalHoursWorked.set(candidate.empId, (totalHoursWorked.get(candidate.empId) || 0) + targetShift.durationHrs);
              workDaysCount.set(candidate.empId, (workDaysCount.get(candidate.empId) || 0) + 1);
              
              if (isHoliday) {
                setEmployees(prev => prev.map(e => e.empId === candidate.empId ? { ...e, holidayCredits: (e.holidayCredits || 0) + 1 } : e));
              }
            }
            
            currentTime += targetShift.durationHrs || 8;
          }
        }
      });

      employees.forEach(emp => {
        if (!newSchedule[emp.empId][day]) {
          newSchedule[emp.empId][day] = { shiftCode: 'OFF' };
          consecutiveWork.set(emp.empId, 0);
        }
      });
    }

    setSchedule(newSchedule);
    alert("Fair Distribution Scheduler complete. Workload balanced to ensure similar hours and rest periods across the month.");
  };

  const handleExportPDF = () => {
    generatePDFReport(employees, schedule, shifts, { ...config, holidays }, violations, stations);
  };

  const handleSaveHoliday = (holi: PublicHoliday) => {
    setHolidays(prev => {
      const idx = prev.findIndex(h => h.date === holi.date);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = holi;
        return next;
      }
      return [...prev, holi];
    });
    setIsHolidayModalOpen(false);
  };

  // Hourly coverage analysis based on config.shopOpeningTime / shopClosingTime
  const hourlyCoverage = useMemo(() => {
    const startHour = parseInt((config.shopOpeningTime || '11:00').split(':')[0]);
    const endHour = parseInt((config.shopClosingTime || '23:00').split(':')[0]);
    const hours = Array.from({ length: Math.max(0, endHour - startHour) }, (_, i) => startHour + i);
    
    const coverage: Record<number, Record<number, number>> = {}; // day -> hour -> count
    const requirements: Record<number, number> = {}; // hour -> minStaffSum
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));

    // Calculate dynamic requirements based on active stations
    hours.forEach(h => {
      requirements[h] = stations.reduce((sum, st) => {
        const oh = parseInt(st.openingTime.split(':')[0]);
        const ch = parseInt(st.closingTime.split(':')[0]);
        if (h >= oh && h < ch) return sum + st.minHC;
        return sum;
      }, 0);
    });

    for (let d = 1; d <= config.daysInMonth; d++) {
      coverage[d] = {};
      hours.forEach(h => coverage[d][h] = 0);

      employees.forEach(emp => {
        const entry = schedule[emp.empId]?.[d];
        const scode = entry?.shiftCode;
        const shift = shiftMap.get(scode || '') as Shift | undefined;
        if (shift && shift.isWork) {
          const sH = parseInt(shift.start?.split(':')[0] || '0');
          const eH = parseInt(shift.end?.split(':')[0] || '0');
          hours.forEach(h => {
             if (h >= sH && h < eH) coverage[d][h]++;
          });
        }
      });
    }
    return { hours, coverage, requirements };
  }, [employees, schedule, shifts, config, stations]);

  const handleCellClick = (empId: string, day: number) => {
    if (paintMode) {
      setSchedule(prev => ({
        ...prev,
        [empId]: {
          ...(prev[empId] || {}),
          [day]: { shiftCode: paintMode.shiftCode, stationId: paintMode.stationId }
        }
      }));
    } else {
      // Original cycle logic
      const entry = schedule[empId]?.[day];
      const current = typeof entry === 'string' ? entry : entry?.shiftCode || '';
      const idx = shifts.findIndex(s => s.code === current);
      const nextShift = shifts[(idx + 1) % shifts.length];
      setSchedule(prev => ({
        ...prev,
        [empId]: {
          ...(prev[empId] || {}),
          [day]: { shiftCode: nextShift.code }
        }
      }));
    }
  };

  const handleDeleteHoliday = (date: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Remove Legal Holiday',
      message: `Are you sure you want to remove the holiday on ${date}?`,
      onConfirm: () => {
        setHolidays(prev => prev.filter(h => h.date !== date));
      }
    });
  };

  const downloadPythonScript = () => {
    // This function can be used to trigger a download of the scheduler_app.py file
    // In this environment, we just show a message.
    alert("Python script 'scheduler_app.py' has been generated in the project root. You can download it directly from the file explorer.");
  };

  return (
    <>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImportCSV} 
        className="hidden" 
        accept=".csv"
      />
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
            active={activeTab === 'shifts'} 
            label="Shift Setup" 
            index="03"
            icon={Clock} 
            onClick={() => setActiveTab('shifts')} 
          />
          <TabButton 
            active={activeTab === 'payroll'} 
            label="Credits & Payroll" 
            index="04"
            icon={BarChart3} 
            onClick={() => setActiveTab('payroll')} 
          />
          <TabButton 
            active={activeTab === 'holidays'} 
            label="Public Holidays" 
            index="04"
            icon={Flag} 
            onClick={() => setActiveTab('holidays')} 
          />
          <TabButton 
            active={activeTab === 'layout'} 
            label="Shop Layout" 
            index="05"
            icon={Layout} 
            onClick={() => setActiveTab('layout')} 
          />
          <TabButton 
            active={activeTab === 'schedule'} 
            label="Master Schedule" 
            index="06"
            icon={Calendar} 
            onClick={() => setActiveTab('schedule')} 
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
              Export Schedule
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
                  <KpiCard label="Total Workforce" value={employees.length} />
                  <KpiCard label="Violations Found" value={violations.length} trend={violations.length > 0 ? "Critical" : "Perfect"} />
                  <KpiCard label="Active Stations" value={stations.length} />
                  <KpiCard label="Global Compliance" value={`${violations.length === 0 ? 100 : Math.max(0, 100 - violations.length)}%`} trend="Health" />
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <Card className="flex flex-col">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Compliance Audit — Labor Law Analysis</h3>
                      <span className="text-[10px] bg-slate-100 px-2.5 py-1 rounded text-slate-500 font-mono font-bold uppercase">Live Validation</span>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                      {violations.map((v, i) => (
                        <div key={i} className={cn("flex items-center gap-6 px-6 py-4 transition-colors", v.article === "(Art. 67)" ? "bg-red-50/30" : "bg-white hover:bg-slate-50")}>
                          <div className="font-mono text-xs text-slate-500 font-bold shrink-0">{v.empId}</div>
                          <div className="text-sm font-bold text-slate-800 w-40 truncate">
                            {employees.find(e => e.empId === v.empId)?.name}
                          </div>
                          <div className="text-xs font-bold text-slate-400 w-24 shrink-0">{v.article}</div>
                          <div className={cn("text-xs font-medium flex-1", v.article === "(Art. 67)" ? "text-red-600" : "text-slate-500")}>
                            {v.message}
                          </div>
                        </div>
                      ))}
                      {violations.length === 0 && (
                         <div className="p-20 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px]">No compliance issues detected in active schedule.</div>
                      )}
                    </div>
                  </Card>

                  <Card className="p-8">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Hourly Coverage Analysis ({config.shopOpeningTime} - {config.shopClosingTime})</h3>
                      <div className="flex gap-2">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase">
                          <div className="w-2 h-2 rounded-full bg-red-100 border border-red-200"></div> Low
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase">
                          <div className="w-2 h-2 rounded-full bg-emerald-100 border border-emerald-200"></div> Optimal
                        </div>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${hourlyCoverage.hours.length + 1}, minmax(40px, 1fr))` }}>
                        <div className="h-10"></div>
                        {hourlyCoverage.hours.map(h => (
                          <div key={h} className="text-center font-mono text-[9px] font-bold text-slate-400 py-2 border-b border-slate-100">
                            {h}:00
                          </div>
                        ))}

                        {Array.from({ length: 7 }, (_, i) => i + 1).map(day => (
                          <React.Fragment key={day}>
                            <div className="flex flex-col justify-center pr-4 border-r border-slate-100">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Day {day}</span>
                              <span className="text-[8px] text-slate-300 font-bold">{format(new Date(config.year, config.month - 1, day), 'EEE')}</span>
                            </div>
                            {hourlyCoverage.hours.map(h => {
                              const count = hourlyCoverage.coverage[day]?.[h] || 0;
                              const req = hourlyCoverage.requirements[h] || 0;
                              const isLow = count < req;
                              return (
                                <div 
                                  key={h} 
                                  className={cn(
                                    "h-10 rounded flex flex-col items-center justify-center border transition-all relative overflow-hidden",
                                    isLow ? "bg-red-50 border-red-100 text-red-600 shadow-[inset_0_0_10px_rgba(239,68,68,0.05)]" : "bg-emerald-50 border-emerald-100 text-emerald-600 shadow-[inset_0_0_10px_rgba(16,185,129,0.05)]"
                                  )}
                                >
                                  <span className="text-[10px] font-bold">{count}</span>
                                  <span className="text-[7px] font-black uppercase opacity-60">/{req}</span>
                                  {isLow && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-bl-sm"></div>}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    <p className="mt-6 text-[10px] text-slate-400 font-medium italic">Showing first 7 days for visual sampling. Full report available in PDF export.</p>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="p-6 bg-slate-900 text-white border-none shadow-2xl">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                          <Sparkles className="w-5 h-5 text-blue-400" />
                        </div>
                        <h3 className="font-bold uppercase tracking-widest text-xs">Staffing Advisory</h3>
                      </div>
                      <div className="space-y-4">
                        {Object.values(hourlyCoverage.coverage).some(dayCov => Object.entries(dayCov).some(([h, c]) => c < (hourlyCoverage.requirements[parseInt(h)] || 0))) ? (
                          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <p className="text-[10px] font-black text-red-400 uppercase mb-1">Coverage Gaps Detected</p>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              Current headcount is insufficient to meet station minimums during peak hours. 
                              {employees.some(e => (e.holidayCredits || 0) > 0) && " outstanding compensations cannot be granted without further affecting coverage."}
                            </p>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                            <p className="text-[10px] font-black text-emerald-400 uppercase mb-1">Optimal Staffing</p>
                            <p className="text-xs text-slate-300">All station requirements are met. {employees.filter(e => (e.holidayCredits || 0) > 0).length} personnel are eligible for credit-based off-days.</p>
                          </div>
                        )}
                        <div className="pt-2">
                           <p className="text-[9px] text-slate-500 font-bold uppercase">Recommendation:</p>
                           <p className="text-xs text-slate-400 italic">Consider increasing workforce by {Math.ceil(employees.length * 0.1)}% to allow for rotating holiday compensations without service degradation.</p>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-6 border-blue-100 bg-blue-50/30">
                       <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                          <Briefcase className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold uppercase tracking-widest text-xs text-slate-700">Credit Utilization</h3>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-end">
                           <span className="text-[10px] font-bold text-slate-500 uppercase">Total Pending Credits</span>
                           <span className="text-xl font-black text-blue-700 leading-none">
                             {employees.reduce((sum, e) => sum + (e.holidayCredits || 0), 0)} <span className="text-[10px] uppercase">Days</span>
                           </span>
                        </div>
                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                           <div 
                             className="h-full bg-blue-600" 
                             style={{ width: `${Math.min(100, (employees.filter(e => (e.holidayCredits || 0) > 0).length / employees.length) * 100)}%` }}
                           ></div>
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {employees.filter(e => (e.holidayCredits || 0) > 0).length} of {employees.length} personnel have earned extra rest days for holiday coverage.
                        </p>
                      </div>
                    </Card>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'payroll' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">Credits & Compensation</h2>
                    <p className="text-sm text-slate-500">Suggested overtime and holiday credit tracking based on Iraqi Labor Law (Art. 67-73).</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-sm">
                      Export Payroll Draft
                    </button>
                  </div>
                </div>

                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Hours</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest underline decoration-blue-500/30">Holiday Credits (Days)</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Monthly Salary</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">OT Hourly Rate</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">OT Eligibility</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">OT Amount (IQD)</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Net Payable (IQD)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {employees.map(emp => {
                          const empSched = schedule[emp.empId] || {};
                          const totalHours = Object.values(empSched).reduce((sum, entry) => {
                            const shift = shifts.find(s => s.code === (entry as any).shiftCode);
                            return sum + (shift?.durationHrs || 0);
                          }, 0);
                          const basePay = emp.baseMonthlySalary || 1500000;
                          const monthlyCap = 48 * 4;
                          const otHours = Math.max(0, (totalHours as number) - monthlyCap); 
                          const otPay = otHours * (emp.baseHourlyRate || 7500) * 1.5;
                          const isOtEligible = (totalHours as number) > monthlyCap;
                          
                          return (
                            <tr key={emp.empId} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="text-sm font-bold text-slate-800">{emp.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{emp.empId}</div>
                              </td>
                              <td className="px-6 py-4 font-mono text-sm font-bold text-slate-600">{(totalHours as number).toFixed(1)}h</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-black tracking-tight",
                                  emp.holidayCredits > 0 ? "bg-blue-100 text-blue-700 shadow-sm" : "bg-slate-100 text-slate-400"
                                )}>
                                  {emp.holidayCredits} DAYS
                                </span>
                              </td>
                              <td className="px-6 py-4 font-mono text-xs font-bold text-slate-600">{(emp.baseMonthlySalary || 1500000).toLocaleString()} IQD</td>
                              <td className="px-6 py-4 font-mono text-xs text-slate-500">{(emp.baseHourlyRate || 7500).toLocaleString()} IQD</td>
                              <td className="px-6 py-4">
                                <div className={cn(
                                  "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded w-fit",
                                  isOtEligible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                                )}>
                                  {isOtEligible ? "Qualified" : "Standard"}
                                </div>
                                <p className="text-[8px] text-slate-400 mt-1 uppercase font-bold">Cap: {monthlyCap}h/mo</p>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-xs font-bold text-emerald-600">+{otPay.toLocaleString()}</div>
                                <div className="text-[9px] text-slate-400 font-mono truncate">{otHours.toFixed(1)} hrs @ 150%</div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-sm font-black text-slate-900 tracking-tighter">
                                  {(basePay + otPay).toLocaleString()}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
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
                        placeholder="Search personnel by name, role, ID..." 
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-blue-500 outline-none shadow-sm font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    {selectedEmployees.size > 0 && (
                       <button 
                        onClick={() => {
                          setConfirmState({
                            isOpen: true,
                            title: `Delete ${selectedEmployees.size} Records`,
                            message: 'Are you sure you want to permanently remove these employees from the system?',
                            onConfirm: () => {
                              setEmployees(prev => prev.filter(e => !selectedEmployees.has(e.empId)));
                              setSelectedEmployees(new Set());
                            }
                          });
                        }}
                        className="flex items-center gap-2 bg-red-50 text-red-600 px-4 py-2 rounded-lg font-bold text-[10px] uppercase border border-red-100 hover:bg-red-100 transition-all font-mono"
                      >
                         <Trash2 className="w-3.5 h-3.5" />
                         Mass Wipe ({selectedEmployees.size})
                       </button>
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      setEditingEmployee(null);
                      setIsEmployeeModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    New Record
                  </button>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-center">
                          <input 
                            type="checkbox" 
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedEmployees(new Set(employees.map(e => e.empId)));
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
                        <th className="px-6 py-3 tracking-wider">Eligible Stations</th>
                        <th className="px-6 py-3 tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {employees.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-20 text-center">
                             <div className="max-w-xs mx-auto">
                               <Users className="w-10 h-10 text-slate-200 mx-auto mb-4" />
                               <h3 className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">No Personnel Registered</h3>
                               <p className="text-[10px] text-slate-300 font-medium uppercase tracking-tighter mt-1 mb-6">Import your staff via CSV or use the Dashboard to seed 60 personnel sample data.</p>
                               <div className="flex gap-2 justify-center">
                                 <button onClick={() => setIsEmployeeModalOpen(true)} className="px-4 py-2 bg-slate-900 text-white rounded text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all">Add Manually</button>
                                 <button onClick={loadSampleData} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all">Seed Sample</button>
                               </div>
                             </div>
                          </td>
                        </tr>
                      )}
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
                          <td className="px-6 py-4">
                             <div className="flex flex-wrap gap-1">
                               {emp.eligibleStations?.map(sid => {
                                 const st = stations.find(s => s.id === sid);
                                 return (
                                   <span key={sid} className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[8px] font-bold text-slate-500 uppercase border border-slate-200">
                                     {st?.name || sid}
                                   </span>
                                 );
                               })}
                               {(!emp.eligibleStations || emp.eligibleStations.length === 0) && <span className="text-[8px] text-slate-300 uppercase font-black tracking-widest">Unassigned</span>}
                             </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => {
                                  setEditingEmployee(emp);
                                  setIsEmployeeModalOpen(true);
                                }}
                                className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-md text-slate-500 transition-colors border border-slate-200"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteEmployee(emp.empId)}
                                className="p-1.5 bg-red-50 hover:bg-red-100 rounded-md text-red-500 transition-colors border border-red-100"
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

            {activeTab === 'layout' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Shop Floor Stations</h3>
                    <p className="text-xs text-slate-400 font-medium tracking-tight uppercase tracking-widest leading-none">Map personnel requirement points for auto-scheduling.</p>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedStation(null);
                      setIsStationModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    New Station
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {stations.map(st => (
                    <Card key={st.id} className="p-6 relative group overflow-hidden border-slate-200">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rotate-45 translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform -z-10" />
                      <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl shadow-lg border-2 border-white" style={{ backgroundColor: st.color || '#3b82f6' }}>
                          <Layout className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800 text-lg leading-tight">{st.name}</h4>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{st.id}</span>
                        </div>
                      </div>
                      
                      <div className="space-y-3 mb-6">
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="text-slate-400 uppercase tracking-tighter">Min Staffing</span>
                          <span className="text-slate-800">{st.minHC} Persons / Hour</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="text-slate-400 uppercase tracking-tighter">Op Hours</span>
                          <span className="text-blue-600 font-mono tracking-tighter uppercase">{st.openingTime} - {st.closingTime}</span>
                        </div>
                      </div>

                      <div className="flex gap-2 p-4 bg-slate-50 rounded-lg border border-slate-100 mb-6">
                         <div className="flex-1 text-center border-r border-slate-200">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Eligible</p>
                            <p className="text-lg font-light text-slate-800">
                              {employees.filter(e => e.eligibleStations?.includes(st.id)).length}
                            </p>
                         </div>
                         <div className="flex-1 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest py-1.5">Active</p>
                         </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                        <button 
                          onClick={() => {
                            setSelectedStation(st);
                            setIsStationModalOpen(true);
                          }}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-all border border-transparent hover:border-slate-200"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setConfirmState({
                              isOpen: true,
                              title: 'Remove Station',
                              message: `Dismantle station ${st.name}? This will clear employee associations.`,
                              onConfirm: () => setStations(prev => prev.filter(s => s.id !== st.id))
                            });
                          }}
                          className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-all border border-transparent hover:border-red-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                  {stations.length === 0 && (
                    <div className="col-span-1 md:col-span-2 lg:col-span-3 p-20 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white shadow-inner">
                       <Layout className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                       <h3 className="text-slate-400 font-bold uppercase tracking-widest text-xs">No Shop Floor Stations Defined</h3>
                       <p className="text-[11px] text-slate-300 font-medium uppercase tracking-tighter mt-1">Start by adding your POS gateways, service windows or gaming areas.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'schedule' && (
              <div className="space-y-6">
                <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                    <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="text-center px-4 w-40">
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{config.year}</p>
                      <h3 className="font-bold text-slate-800">{format(new Date(config.year, config.month - 1), 'MMMM')}</h3>
                    </div>
                    <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 mr-4 bg-slate-900 border border-slate-700 p-1 rounded-xl shadow-xl">
                      {shifts.map(s => (
                        <button 
                          key={s.code} 
                          onClick={() => setPaintMode(paintMode?.shiftCode === s.code ? null : { shiftCode: s.code })}
                          className={cn(
                            "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                            paintMode?.shiftCode === s.code 
                              ? "bg-blue-600 text-white shadow-inner shadow-blue-800" 
                              : "text-slate-400 hover:text-white"
                          )}
                        >
                          {s.code}
                        </button>
                      ))}
                      <div className="w-px h-6 bg-slate-700 mx-1"></div>
                      <button 
                        onClick={() => setPaintMode(null)}
                        className={cn(
                          "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                          !paintMode ? "bg-white/10 text-white" : "text-slate-400"
                        )}
                      >
                        <MousePointer2 className="w-3 h-3" />
                      </button>
                    </div>

                    <button 
                      onClick={runAutoScheduler}
                      className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
                    >
                      <Sparkles className="w-4 h-4" />
                      Auto-Schedule
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto relative max-h-[calc(100vh-280px)] overflow-y-auto">
                  {paintMode && (
                    <div className="sticky top-0 z-[60] bg-blue-600 text-white px-4 py-1 text-[9px] font-bold uppercase tracking-widest text-center shadow-lg border-b border-blue-700 animate-pulse">
                      Painting: [{paintMode.shiftCode}] mode active — Click cells to assign.
                    </div>
                  )}
                  <table className="w-full text-left text-[10px] border-collapse min-w-[1200px]">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-black border-b border-slate-200">
                      <tr>
                        <th className="sticky left-0 bg-slate-50 z-20 px-4 py-4 border-r border-slate-200 w-56 shadow-[4px_0_10px_rgba(0,0,0,0.05)] tracking-tighter">Personnel Directory</th>
                        {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(d => {
                          const date = new Date(config.year, config.month - 1, d);
                          const isHoli = holidays.some(h => h.date === format(date, 'yyyy-MM-dd'));
                          return (
                            <th key={d} className={cn("px-1 py-4 text-center border-r border-slate-100 min-w-[36px] tracking-tighter", isWeekend(date) && "bg-slate-100/50", isHoli && "bg-red-50/50")}>
                              <div className="flex flex-col items-center">
                                <span className={cn("text-slate-900 font-black", (isWeekend(date) || isHoli) && "text-red-500")}>{d}</span>
                                <span className="text-[7px] text-slate-400 font-bold uppercase shrink-0 leading-none">
                                  {format(date, 'EEE')}
                                </span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {employees.map(emp => (
                        <tr key={emp.empId} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-4 py-2 border-r border-slate-200 shadow-[4px_0_10px_rgba(0,0,0,0.03)]">
                             <div className="flex flex-col max-w-[200px]">
                               <span className="font-bold text-slate-700 text-xs truncate uppercase tracking-tight">{emp.name}</span>
                               <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1 shrink-0 mt-0.5">
                                 <Hash className="w-2 h-2" /> {emp.empId} • {emp.role}
                               </span>
                             </div>
                           </td>
                           {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(day => (
                             <td key={day} className={cn("p-0 border-r border-slate-100")}>
                               <ScheduleCell 
                                 value={schedule[emp.empId]?.[day]?.shiftCode || ''} 
                                 onClick={() => handleCellClick(emp.empId, day)}
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

            {activeTab === 'shifts' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Shift Library Configuration</h3>
                  <button 
                    onClick={() => {
                      setEditingShift(null);
                      setIsShiftModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg text-center font-mono"
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
                        <th className="px-6 py-4 tracking-wider text-center w-24">Order</th>
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
                          <td className="px-6 py-4">
                             <div className="flex flex-col items-center gap-1">
                               <button 
                                 disabled={shifts.indexOf(s) === 0}
                                 onClick={() => moveShift(shifts.indexOf(s), 'up')}
                                 className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30 disabled:cursor-not-allowed"
                               >
                                 <ChevronUp className="w-3 h-3" />
                               </button>
                               <button 
                                 disabled={shifts.indexOf(s) === shifts.length - 1}
                                 onClick={() => moveShift(shifts.indexOf(s), 'down')}
                                 className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30 disabled:cursor-not-allowed"
                               >
                                 <ChevronDown className="w-3 h-3" />
                               </button>
                             </div>
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
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Public Holidays & Non-Working Days</h3>
                    <p className="text-xs text-slate-400 font-medium tracking-tight uppercase tracking-widest font-mono leading-none">Custom calendar overrides for Iraq region.</p>
                  </div>
                  <button 
                    onClick={() => setIsHolidayModalOpen(true)}
                    className="flex items-center gap-2 bg-red-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg font-mono"
                  >
                    <Plus className="w-4 h-4" />
                    New Holiday
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {holidays.map(holi => (
                    <Card key={holi.id} className="p-6 relative group border-slate-200">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600 border border-red-100 shadow-sm">
                           <Calendar className="w-6 h-6" />
                        </div>
                        <div>
                           <h4 className="font-bold text-slate-800 text-sm leading-tight">{holi.name}</h4>
                           <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">{format(new Date(holi.date), 'dd MMMM yyyy')}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center py-3 border-t border-slate-50 mt-4">
                         <span className={cn("text-[9px] font-black uppercase tracking-widest", holi.isFixed ? "text-blue-500" : "text-slate-400")}>
                           {holi.isFixed ? "Fixed Date" : "Lunar Adjustment"}
                         </span>
                         <button 
                          onClick={() => {
                            setConfirmState({
                              isOpen: true,
                              title: 'Erase Holiday',
                              message: `Remove ${holi.name} from calendar?`,
                              onConfirm: () => setHolidays(prev => prev.filter(h => h.id !== holi.id))
                            });
                          }}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6 max-w-4xl">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Reporting & Compliance Center</h3>
                  <p className="text-xs text-slate-400 font-medium tracking-tight uppercase tracking-widest font-mono">Generate official workforce documentation for audit and internal review.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="p-8 space-y-6 border-slate-200">
                    <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
                       <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div className="space-y-2">
                       <h4 className="font-bold text-slate-800 text-lg tracking-tight">Full Compliance PDF Report</h4>
                       <p className="text-xs text-slate-500 leading-relaxed font-medium">
                         Generates a comprehensive PDF document containing the master duty roster, compliance violation audit logs, and resource allocation statistics.
                       </p>
                    </div>
                    <button 
                      onClick={handleExportPDF}
                      className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Generate Official PDF
                    </button>
                  </Card>

                  <Card className="p-8 space-y-6 border-slate-200">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100">
                       <Database className="w-6 h-6" />
                    </div>
                    <div className="space-y-2">
                       <h4 className="font-bold text-slate-800 text-lg tracking-tight">Master Schedule Export (CSV)</h4>
                       <p className="text-xs text-slate-500 leading-relaxed font-medium">
                         Export the current active schedule as a spreadsheet-compatible CSV file. Ideal for importing into Excel or payroll systems.
                       </p>
                    </div>
                    <button 
                      onClick={exportScheduleCSV}
                      className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Download className="w-4 h-4" />
                      Download CSV Data
                    </button>
                  </Card>
                </div>

                <div className="mt-8 space-y-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> Report Preview (Live Data)
                  </h4>
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[300px]">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                      <div>
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{config.company}</p>
                        <h5 className="font-bold text-slate-800">Workforce Audit Record</h5>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">{format(new Date(config.year, config.month - 1), 'MMMM yyyy')}</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                       <div className="grid grid-cols-3 gap-4">
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-1">Total Personnel</p>
                             <p className="text-2xl font-light text-slate-900">{employees.length}</p>
                          </div>
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-1">Compliance Score</p>
                             <p className="text-2xl font-light text-emerald-600">
                               {violations.length === 0 ? "100%" : `${Math.max(0, 100 - violations.length)}%`}
                             </p>
                          </div>
                          <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50">
                             <p className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter mb-1">Coverage Status</p>
                             <p className="text-[10px] font-bold text-emerald-700 uppercase">Authenticated</p>
                          </div>
                       </div>

                       <div className="overflow-hidden border border-slate-100 rounded-lg">
                          <table className="w-full text-left text-[9px]">
                             <thead className="bg-slate-50 font-bold uppercase text-slate-400">
                                <tr>
                                   <th className="px-4 py-2">ID</th>
                                   <th className="px-4 py-2">Name</th>
                                   <th className="px-4 py-2">Total Hours</th>
                                   <th className="px-4 py-2">Violations</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-50">
                                {employees.slice(0, 5).map(emp => {
                                  const empViolations = violations.filter(v => v.empId === emp.empId);
                                  return (
                                    <tr key={emp.empId}>
                                      <td className="px-4 py-2 font-mono">{emp.empId}</td>
                                      <td className="px-4 py-2 font-bold">{emp.name}</td>
                                      <td className="px-4 py-2">
                                        {Object.values(schedule[emp.empId] || {}).reduce((sum, entry) => {
                                           const shift = shifts.find(s => s.code === (typeof entry === 'string' ? entry : (entry as any)?.shiftCode));
                                           return sum + (shift?.durationHrs || 0);
                                        }, 0)}h
                                      </td>
                                      <td className={`px-4 py-2 font-bold ${empViolations.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {empViolations.length}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {employees.length > 5 && (
                                  <tr>
                                    <td colSpan={4} className="px-4 py-2 text-center text-slate-300 italic font-medium tracking-tight">
                                      + {employees.length - 5} more records (truncated in preview)
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
            )}

            {activeTab === 'settings' && (
              <div className="space-y-8 max-w-4xl">
                <div>
                   <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight mb-1">Global Configuration</h3>
                   <p className="text-xs text-slate-400 font-medium uppercase tracking-widest font-mono">System-wide operational parameters.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-4">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Business Operating Hours</label>
                      <div className="flex gap-4">
                         <div className="flex-1 space-y-2">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Opening</span>
                            <input 
                              type="time" 
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono"
                              value={config.shopOpeningTime}
                              onChange={(e) => setConfig(prev => ({ ...prev, shopOpeningTime: e.target.value }))}
                            />
                         </div>
                         <div className="flex-1 space-y-2">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Closing</span>
                            <input 
                              type="time" 
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono"
                              value={config.shopClosingTime}
                              onChange={(e) => setConfig(prev => ({ ...prev, shopClosingTime: e.target.value }))}
                            />
                         </div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Compliance Overview</label>
                      <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                         <p className="text-[10px] text-emerald-700 font-bold uppercase leading-tight">Station-Based Coverage is ACTIVE</p>
                         <p className="text-[9px] text-emerald-600 font-medium">Coverage is now calculated dynamically based on your Shop Layout (Station min Staffing) rather than a global fixed number.</p>
                      </div>
                   </div>
                </div>

                <div className="pt-8 border-t border-slate-100 flex justify-between items-center">
                   <div className="space-y-1">
                      <p className="text-sm font-bold text-slate-800">Database & Security</p>
                      <p className="text-xs text-slate-400 font-medium uppercase tracking-tighter">Instance: Private Local (Browser Core)</p>
                   </div>
                   <button 
                    onClick={() => {
                      localStorage.clear();
                      window.location.reload();
                    }}
                    className="px-6 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all font-mono"
                   >
                     Factory Reset Instance
                   </button>
                </div>
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
        stations={stations}
      />

      <StationModal
        isOpen={isStationModalOpen}
        onClose={() => setIsStationModalOpen(false)}
        onSave={handleSaveStation}
        station={selectedStation}
      />

      <HolidayModal 
        isOpen={isHolidayModalOpen}
        onClose={() => setIsHolidayModalOpen(false)}
        onSave={handleSaveHoliday}
        holiday={editingHoliday}
      />

      <ShiftModal 
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        onSave={handleSaveShift}
        shift={editingShift}
        config={config}
      />

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
    </>
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

function SettingField({ label, value, onChange, type = 'text', options }: { label: string; value: any; onChange: (v: string) => void; type?: 'text' | 'number' | 'select' | 'time'; options?: string[] }) {
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
