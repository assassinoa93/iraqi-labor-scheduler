import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Station } from '../types';
import { cn } from '../lib/utils';
import { SettingField } from './Primitives';
import { useI18n } from '../lib/i18n';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (emp: Employee) => void;
  employee: Employee | null;
  stations: Station[];
}

const empty = (): Employee => ({
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
  fixedRestDay: 0,
  phone: '',
  hireDate: format(new Date(), 'yyyy-MM-dd'),
  notes: '',
  eligibleStations: [],
  holidayBank: 0,
  annualLeaveBalance: 21,
  baseMonthlySalary: 1500000,
  baseHourlyRate: Math.round(1500000 / 192),
  overtimeHours: 0,
  category: 'Standard'
});

export function EmployeeModal({ isOpen, onClose, onSave, employee, stations }: EmployeeModalProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState<Employee>(empty);

  useEffect(() => {
    if (isOpen) {
      // Backfill `category` for v1.1 records that don't carry it.
      setFormData(employee ? { category: 'Standard', ...employee } : empty());
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
            {employee ? t('modal.employee.title.edit') : t('modal.employee.title.new')}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-6">
            <SettingField label={t('modal.employee.field.id')} value={formData.empId} onChange={v => setFormData({...formData, empId: v})} />
            <SettingField label={t('modal.employee.field.name')} value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label={t('modal.employee.field.role')} value={formData.role} onChange={v => setFormData({...formData, role: v})} />
            <SettingField label={t('modal.employee.field.department')} value={formData.department} onChange={v => setFormData({...formData, department: v})} />
            <SettingField label={t('modal.employee.field.contract')} type="select" options={['Permanent', 'Fixed-Term', 'Contractor']} value={formData.contractType} onChange={v => setFormData({...formData, contractType: v})} />
            <SettingField label={t('modal.employee.field.weeklyHours')} type="number" value={formData.contractedWeeklyHrs} onChange={v => setFormData({...formData, contractedWeeklyHrs: parseInt(v)})} />
            <SettingField label={t('modal.employee.field.phone')} value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
            <SettingField label={t('modal.employee.field.hireDate')} value={formData.hireDate} onChange={v => setFormData({...formData, hireDate: v})} />
            <SettingField
              label={t('modal.employee.field.salary')}
              type="number"
              value={formData.baseMonthlySalary}
              onChange={v => {
                const salary = parseInt(v) || 0;
                setFormData({
                  ...formData,
                  baseMonthlySalary: salary,
                  baseHourlyRate: Math.round(salary / 192)
                });
              }}
            />
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OT Hourly Rate (Derived)</label>
              <div className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded text-sm font-mono text-slate-500 shadow-sm flex justify-between items-center">
                 <span>{formData.baseHourlyRate.toLocaleString()} IQD</span>
                 <span className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-black tracking-widest">AUTO: (SALARY / 192)</span>
              </div>
            </div>
            <SettingField label={t('modal.employee.field.holidayBank')} type="number" value={formData.holidayBank} onChange={v => setFormData({...formData, holidayBank: parseInt(v)})} />
            <SettingField label={t('modal.employee.field.annualLeave')} type="number" value={formData.annualLeaveBalance} onChange={v => setFormData({...formData, annualLeaveBalance: parseInt(v)})} />
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('modal.employee.field.restPolicy')}</label>
              <select
                value={formData.fixedRestDay}
                onChange={e => setFormData({...formData, fixedRestDay: parseInt(e.target.value)})}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value={0}>{t('modal.employee.rest.rotate')}</option>
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                  <option key={i} value={i + 1}>{t('modal.employee.rest.fixed')} {d}</option>
                ))}
              </select>
              <p className="text-[9px] text-slate-400 font-medium leading-relaxed">
                {formData.fixedRestDay === 0
                  ? 'Auto-scheduler will rotate this person\'s rest day across the week to cover weekends and peak days.'
                  : 'This person is always off on the selected day. Use Auto-Rotate to free up weekend coverage.'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('modal.employee.field.category')}</label>
              <select
                value={formData.category || 'Standard'}
                onChange={e => setFormData({...formData, category: e.target.value as 'Standard' | 'Driver'})}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value="Standard">{t('modal.employee.cat.standard')}</option>
                <option value="Driver">{t('modal.employee.cat.driver')}</option>
              </select>
              <p className="text-[9px] text-slate-400 font-medium leading-relaxed">
                {formData.category === 'Driver'
                  ? 'Drivers follow the transport-worker provisions: 9h daily / 56h weekly cap, 4.5h continuous-driving cap, 11h min daily rest.'
                  : 'Standard staff follow Art. 67-74: 8h daily / 48h weekly cap, 11h min rest between shifts.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 p-4 bg-blue-50/30 rounded-lg border border-blue-100">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">{t('modal.employee.stationEligibility')}</p>
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
                <span className="text-[10px] font-bold text-slate-600 uppercase">{t('modal.employee.flag.hazardous')}</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isIndustrialRotating} onChange={e => setFormData({...formData, isIndustrialRotating: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">{t('modal.employee.flag.industrial')}</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.hourExempt} onChange={e => setFormData({...formData, hourExempt: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">{t('modal.employee.flag.exempt')}</span>
             </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('modal.employee.notes')}</label>
            <textarea
              className="w-full p-4 bg-white border border-slate-200 rounded text-sm min-h-[100px] focus:ring-1 focus:ring-blue-500 outline-none"
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
              placeholder="Enter compliance notes, performance context, or equipment requirements..."
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            {t('modal.employee.commit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
