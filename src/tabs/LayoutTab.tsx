import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit3, Trash2, Layout, FolderPlus, ChevronDown, X } from 'lucide-react';
import { Employee, Station, StationGroup } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { GROUP_ICON_PALETTE, DEFAULT_GROUP_ICON, getGroupIcon } from '../lib/groupIcons';

interface LayoutTabProps {
  stations: Station[];
  employees: Employee[];
  stationGroups: StationGroup[];
  onAddNew: () => void;
  onEdit: (st: Station) => void;
  onDelete: (st: Station) => void;
  onUpdateStation: (st: Station) => void;
  onSaveGroups: (groups: StationGroup[]) => void;
}

const GROUP_COLOR_PALETTE = ['#0f766e', '#7c3aed', '#dc2626', '#0e7490', '#059669', '#d97706', '#1d4ed8', '#9333ea', '#be123c', '#475569'];

// v1.16: Stations / Assets tab redesigned around station GROUPS — kanban-
// style containers where each column is a group (Cashier Counters, Game
// Machines, Vehicles, …) and stations are cards inside. Stations not yet
// assigned to a group land in the "Ungrouped" column at the end. Click a
// station card's "Move" dropdown to reassign it. Click a group's edit
// pencil to rename / re-colour it. Click X to delete a group (its
// stations fall back to Ungrouped automatically).
//
// The auto-scheduler still operates at station granularity; groups are
// purely metadata that drive (a) one-click employee eligibility and
// (b) the workforce planner's group-level rollup.
export function LayoutTab({
  stations, employees, stationGroups, onAddNew, onEdit, onDelete, onUpdateStation, onSaveGroups,
}: LayoutTabProps) {
  const { t } = useI18n();
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Bucket stations by group. The "ungrouped" pseudo-column gets all
  // stations whose groupId is missing or points to a group that no
  // longer exists (e.g. a deleted group).
  const grouped = useMemo(() => {
    const groupIds = new Set(stationGroups.map(g => g.id));
    const map = new Map<string, Station[]>();
    for (const g of stationGroups) map.set(g.id, []);
    map.set('__ungrouped__', []);
    for (const st of stations) {
      const key = st.groupId && groupIds.has(st.groupId) ? st.groupId : '__ungrouped__';
      map.get(key)!.push(st);
    }
    return map;
  }, [stations, stationGroups]);

  const handleAddGroup = (name: string, color: string, icon: string) => {
    if (!name.trim()) return;
    const id = `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    onSaveGroups([...stationGroups, { id, name: name.trim(), color, icon }]);
    setCreatingGroup(false);
  };

  const handleUpdateGroup = (id: string, patch: Partial<StationGroup>) => {
    onSaveGroups(stationGroups.map(g => g.id === id ? { ...g, ...patch } : g));
  };

  const handleDeleteGroup = (id: string) => {
    // Drop the group; stations that referenced it fall through to
    // ungrouped because the bucketing logic above falls back when the
    // station's groupId points to a vanished id.
    onSaveGroups(stationGroups.filter(g => g.id !== id));
    // Also clear groupId on stations that pointed to the deleted group
    // so the data stays clean (otherwise the station carries a dangling
    // reference until the user re-saves it).
    for (const st of stations) {
      if (st.groupId === id) onUpdateStation({ ...st, groupId: undefined });
    }
  };

  const moveStationToGroup = (stationId: string, groupId: string | undefined) => {
    const st = stations.find(s => s.id === stationId);
    if (!st) return;
    onUpdateStation({ ...st, groupId });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">{t('layout.title')}</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium tracking-widest leading-none">{t('layout.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreatingGroup(true)}
            className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all shadow-sm"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />
            {t('layout.group.new')}
          </button>
          <button
            onClick={onAddNew}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg active:scale-95 whitespace-nowrap min-w-fit"
          >
            <Plus className="w-4 h-4" />
            {t('layout.new')}
          </button>
        </div>
      </div>

      {creatingGroup && (
        <NewGroupForm
          onCancel={() => setCreatingGroup(false)}
          onSave={handleAddGroup}
        />
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...stationGroups.map(g => ({ kind: 'group' as const, group: g })), { kind: 'ungrouped' as const }].map((entry, i) => {
          const isUngrouped = entry.kind === 'ungrouped';
          const id = isUngrouped ? '__ungrouped__' : entry.group.id;
          const items = grouped.get(id) || [];
          if (isUngrouped && items.length === 0 && stationGroups.length > 0) return null;
          const groupColor = isUngrouped ? '#94a3b8' : (entry.group.color || GROUP_COLOR_PALETTE[i % GROUP_COLOR_PALETTE.length]);
          const groupName = isUngrouped ? t('layout.group.ungrouped') : entry.group.name;
          const editing = !isUngrouped && editingGroupId === entry.group.id;
          const eligibleEmps = isUngrouped ? 0 : employees.filter(e =>
            (e.eligibleGroups || []).includes(entry.group.id)
            || items.some(s => e.eligibleStations.includes(s.id))
          ).length;
          return (
            <div
              key={id}
              className="bg-slate-50/60 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col"
            >
              <div
                className="px-4 py-3 flex items-center gap-3 border-b border-slate-200 dark:border-slate-700"
                style={{ backgroundColor: `${groupColor}15`, borderTopColor: groupColor, borderTopWidth: 3 }}
              >
                {!isUngrouped ? (
                  <GroupIconButton
                    icon={entry.group.icon}
                    color={groupColor}
                    onPick={(iconName) => handleUpdateGroup(entry.group.id, { icon: iconName })}
                  />
                ) : (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: groupColor }}>
                    {(() => { const Ic = getGroupIcon(undefined); return <Ic className="w-3.5 h-3.5" />; })()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {editing && !isUngrouped ? (
                    <input
                      autoFocus
                      type="text"
                      defaultValue={entry.group.name}
                      onBlur={e => { handleUpdateGroup(entry.group.id, { name: e.target.value.trim() || entry.group.name }); setEditingGroupId(null); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                        if (e.key === 'Escape') setEditingGroupId(null);
                      }}
                      className="w-full px-2 py-0.5 text-sm font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                    />
                  ) : (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{groupName}</p>
                  )}
                  <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    {items.length} {t('layout.group.stations')} · {eligibleEmps} {t('layout.group.eligible')}
                  </p>
                </div>
                {!isUngrouped && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingGroupId(editing ? null : entry.group.id)}
                      title={t('action.edit')}
                      className="p-1.5 rounded hover:bg-white/60 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(entry.group.id)}
                      title={t('action.delete')}
                      className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="p-3 space-y-2 min-h-[120px]">
                {items.length === 0 && (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 italic text-center py-6">
                    {isUngrouped ? t('layout.group.ungroupedEmpty') : t('layout.group.empty')}
                  </div>
                )}
                {items.map(st => (
                  <StationCard
                    key={st.id}
                    station={st}
                    employees={employees}
                    groups={stationGroups}
                    onEdit={() => onEdit(st)}
                    onDelete={() => onDelete(st)}
                    onMoveToGroup={(groupId) => moveStationToGroup(st.id, groupId)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {stations.length === 0 && (
        <div className="p-20 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-900 shadow-inner">
          <Layout className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
          <h3 className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">{t('layout.empty')}</h3>
          <p className="text-[11px] text-slate-300 dark:text-slate-600 font-medium uppercase tracking-tighter mt-1">{t('layout.emptyHint')}</p>
        </div>
      )}
    </div>
  );
}

function StationCard({
  station, employees, groups, onEdit, onDelete, onMoveToGroup,
}: {
  station: Station;
  employees: Employee[];
  groups: StationGroup[];
  onEdit: () => void;
  onDelete: () => void;
  onMoveToGroup: (groupId: string | undefined) => void;
}) {
  const { t, dir } = useI18n();
  const [moveOpen, setMoveOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Computed in viewport coordinates so the menu floats free of the
  // kanban column's `overflow-hidden` clip and the surrounding card
  // borders. Re-measured on open + on scroll/resize.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; placement: 'down' | 'up' } | null>(null);
  const MENU_HEIGHT = 220;
  const MENU_WIDTH = 200;
  const eligibleCount = employees.filter(e =>
    e.eligibleStations.includes(station.id)
    || (station.groupId && (e.eligibleGroups || []).includes(station.groupId))
  ).length;

  useLayoutEffect(() => {
    if (!moveOpen || !triggerRef.current) return;
    const recompute = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const spaceBelow = vh - r.bottom;
      const placement: 'down' | 'up' = spaceBelow < MENU_HEIGHT ? 'up' : 'down';
      const top = placement === 'down' ? r.bottom + 4 : Math.max(8, r.top - MENU_HEIGHT - 4);
      // Anchor the menu to the start side of the trigger; clamp to the
      // viewport so it never escapes off-screen on either axis.
      const rawLeft = dir === 'rtl' ? r.right - MENU_WIDTH : r.left;
      const left = Math.min(Math.max(8, rawLeft), vw - MENU_WIDTH - 8);
      setMenuPos({ top, left, placement });
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [moveOpen, dir]);

  // Click-outside to close. Listen on document with a tick delay so the
  // toggle click that opened the menu doesn't immediately re-close it.
  useEffect(() => {
    if (!moveOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      const portalEl = document.getElementById('station-move-menu-portal');
      if (portalEl?.contains(target)) return;
      setMoveOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [moveOpen]);

  const menu = moveOpen && menuPos ? createPortal(
    <div
      id="station-move-menu-portal"
      role="menu"
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: MENU_WIDTH,
        maxHeight: MENU_HEIGHT,
        overflowY: 'auto',
        zIndex: 70,
      }}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1"
    >
      {groups.map(g => (
        <button
          key={g.id}
          onClick={() => { onMoveToGroup(g.id); setMoveOpen(false); }}
          className={cn(
            "w-full text-start px-3 py-1.5 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2 text-slate-700 dark:text-slate-200",
            station.groupId === g.id && "bg-slate-50 dark:bg-slate-800/60 font-bold",
          )}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color || '#94a3b8' }} />
          <span className="truncate">{g.name}</span>
        </button>
      ))}
      {(station.groupId || groups.length === 0) && (
        <button
          onClick={() => { onMoveToGroup(undefined); setMoveOpen(false); }}
          className="w-full text-start px-3 py-1.5 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 italic border-t border-slate-100 dark:border-slate-700/60"
        >
          {t('layout.station.unassign')}
        </button>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group">
      <div className="flex items-start gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-white dark:border-slate-700"
          style={{ backgroundColor: station.color || '#3b82f6' }}
        >
          <Layout className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{station.name}</p>
          <p className="text-[9px] font-mono font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{station.id}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[9px] font-bold text-slate-500 dark:text-slate-400">
        <div>
          <p className="text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('layout.normalStaffing')}</p>
          <p className="text-slate-800 dark:text-slate-100 font-mono">{station.normalMinHC}</p>
        </div>
        <div>
          <p className="text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('layout.peakStaffing')}</p>
          <p className="text-blue-700 dark:text-blue-200 font-mono">{station.peakMinHC}</p>
        </div>
        <div>
          <p className="text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('layout.eligible')}</p>
          <p className="text-emerald-700 dark:text-emerald-200 font-mono">{eligibleCount}</p>
        </div>
      </div>

      <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono mt-2">{station.openingTime} → {station.closingTime}</p>

      <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <div className="relative">
          <button
            ref={triggerRef}
            onClick={() => setMoveOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={moveOpen}
            className="text-[9px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 uppercase tracking-widest flex items-center gap-1"
          >
            {t('layout.station.moveTo')} <ChevronDown className="w-3 h-3" />
          </button>
          {menu}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} title={t('action.edit')} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-300">
            <Edit3 className="w-3 h-3" />
          </button>
          <button onClick={onDelete} title={t('action.delete')} className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-300">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NewGroupForm({ onSave, onCancel }: { onSave: (name: string, color: string, icon: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLOR_PALETTE[0]);
  const [icon, setIcon] = useState(DEFAULT_GROUP_ICON);
  return (
    <Card className="p-4 bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/40 space-y-3">
      <div className="flex items-center gap-3">
        <FolderPlus className="w-4 h-4 text-indigo-700 dark:text-indigo-200 shrink-0" />
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(name, color, icon); if (e.key === 'Escape') onCancel(); }}
          placeholder={t('layout.group.namePlaceholder')}
          className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-lg text-sm font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="flex items-center gap-1 shrink-0">
          {GROUP_COLOR_PALETTE.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "w-6 h-6 rounded-full transition-all",
                color === c ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100 dark:ring-offset-slate-900" : "hover:scale-110",
              )}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
        <button
          onClick={() => onSave(name, color, icon)}
          disabled={!name.trim()}
          className={cn(
            "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shrink-0",
            name.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed",
          )}
        >
          {t('action.save')}
        </button>
        <button onClick={onCancel} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* v2.2.0 — preset icon picker. Choosing one helps the supervisor
          tell groups apart at a glance in the kanban + workforce-planning
          rollups. Defaults to `boxes` so existing one-click flows keep
          working without forcing a pick. */}
      <div className="flex items-start gap-3">
        <p className="text-[10px] font-black text-indigo-700 dark:text-indigo-200 uppercase tracking-widest mt-2 shrink-0 w-12">{t('layout.group.icon')}</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(GROUP_ICON_PALETTE).map(([key, Ic]) => (
            <button
              key={key}
              onClick={() => setIcon(key)}
              type="button"
              title={key}
              className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center transition-all',
                icon === key ? 'text-white shadow-md' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
              style={icon === key ? { backgroundColor: color } : undefined}
              aria-label={key}
              aria-pressed={icon === key}
            >
              <Ic className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

// v2.2.0 — clickable group-header icon. Renders the chosen lucide
// component as a coloured tile; clicking opens a popover with the full
// preset palette so the supervisor can change the icon inline without
// digging into a separate edit modal.
function GroupIconButton({
  icon, color, onPick,
}: { icon: string | undefined; color: string; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const Icon = getGroupIcon(icon);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        title="Change icon"
        aria-label="Change group icon"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-white hover:opacity-90 transition-opacity"
        style={{ backgroundColor: color }}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 start-0 z-40 w-56 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl p-2">
          <div className="grid grid-cols-5 gap-1">
            {Object.entries(GROUP_ICON_PALETTE).map(([key, Ic]) => (
              <button
                key={key}
                onClick={() => { onPick(key); setOpen(false); }}
                type="button"
                title={key}
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                  (icon || 'boxes') === key ? 'text-white shadow-md' : 'bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
                style={(icon || 'boxes') === key ? { backgroundColor: color } : undefined}
                aria-label={key}
              >
                <Ic className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
