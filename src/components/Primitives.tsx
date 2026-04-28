import React from 'react';
import { cn } from '../lib/utils';
import { getShiftColor } from '../lib/colors';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("bg-white rounded border border-slate-200 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

// Sidebar section header used to group navigation tabs by purpose
// (Operations / Analytics / Setup / System). Renders a small caps label
// with subtle separators above and below so the navigation reads as a
// hierarchical menu rather than a long flat list.
export const SidebarGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3">
    <div className="px-6 py-2 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{label}</div>
    <div>{children}</div>
  </div>
);

export const TabButton = ({ active, label, index, onClick }: { active: boolean; icon?: any; label: string; index: string; onClick: () => void }) => (
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

export function KpiCard({ label, value, trend }: { label: string; value: any; trend?: string }) {
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

export function ScheduleCell({
  value, onClick, isRecent, onMouseDown, onMouseEnter,
}: {
  value: string;
  onClick: (e: React.MouseEvent) => void;
  isRecent?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className={cn(
        "w-full h-10 border-none transition-all flex items-center justify-center font-bold text-[10px] group-hover:scale-105 relative select-none",
        value ? getShiftColor(value) : "bg-transparent hover:bg-slate-50",
        // The "just-swapped" highlight: a soft pulsing ring drawn via outline
        // so it sits over neighbouring cells without nudging the layout.
        isRecent && "outline outline-2 outline-amber-400 z-10 animate-pulse"
      )}
    >
      {value}
    </button>
  );
}

export function SettingField({ label, value, onChange, type = 'text', options }: { label: string; value: any; onChange: (v: string) => void; type?: 'text' | 'number' | 'select' | 'time'; options?: string[] }) {
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
