import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit3, Trash2, Layout, FolderPlus, ChevronDown, X, Layers, GripVertical, CheckSquare, Square } from 'lucide-react';
import { Employee, Station, StationGroup } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { GROUP_ICON_PALETTE, DEFAULT_GROUP_ICON, getGroupIcon } from '../lib/groupIcons';

// v5.4.0 — drag-and-drop payload format. Plain JSON in dataTransfer 'text/plain'
// because most browsers strip arbitrary mime types when crossing security
// boundaries. Carries the IDs of every station being dragged at once so the
// drop handler can apply a single bulk move.
const DND_MIME = 'application/x-station-ids';
const DND_FALLBACK_MIME = 'text/plain';

interface LayoutTabProps {
  stations: Station[];
  employees: Employee[];
  stationGroups: StationGroup[];
  onAddNew: () => void;
  onEdit: (st: Station) => void;
  onDelete: (st: Station) => void;
  onUpdateStation: (st: Station) => void;
  onSaveGroups: (groups: StationGroup[]) => void;
  // v5.3.0 — opens the bulk-add modal that creates N stations at once
  // sharing one set of defaults (group, HC, opening / closing time, role,
  // colour). Counterpart to onAddNew which is the single-station path.
  onBulkAdd?: () => void;
  // v5.4.0 — single-pass move for any number of stations. Drag-drop and
  // the bulk-toolbar "Move to..." path both call this so the kanban only
  // re-renders once and Firestore syncStations only diffs the affected docs.
  onBulkMoveStations?: (stationIds: string[], newGroupId: string | undefined) => void;
  // v5.4.0 — bulk delete used by the selection toolbar. App.tsx wires this
  // through a single confirm dialog showing the count.
  onBulkDeleteStations?: (stationIds: string[]) => void;
  // v5.13.0 — fired when one or more stations were dropped into a group
  // whose eligibleRoles gate rejects them. App.tsx surfaces a toast
  // explaining why those stations landed in ungrouped instead.
  onRoleMismatchDrop?: (targetGroupName: string, rejected: Array<{ id: string; name: string; required: string[] }>) => void;
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
  stations, employees, stationGroups, onAddNew, onEdit, onDelete, onUpdateStation, onSaveGroups, onBulkAdd, onBulkMoveStations, onBulkDeleteStations, onRoleMismatchDrop,
}: LayoutTabProps) {
  const { t } = useI18n();
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // v5.4.0 — multi-select state. `selectedIds` is the set of stations whose
  // checkbox is on. `dropTargetId` is the group being hovered over during a
  // drag (use '__ungrouped__' for the ungrouped column). `draggingIds` lets
  // the dragged cards visually fade so the user can see what's moving.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [draggingIds, setDraggingIds] = useState<Set<string>>(() => new Set());
  // dragenter/dragleave fire on every child element which causes flicker.
  // Track a counter per column so we only clear the highlight when the
  // counter reaches 0 (i.e. cursor truly left the column boundary).
  const dragEnterCount = useRef<Record<string, number>>({});

  const toggleSelect = (id: string, force?: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const shouldBeOn = force === undefined ? !next.has(id) : force;
      if (shouldBeOn) next.add(id); else next.delete(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  // Drop the selection state for any station that no longer exists (deleted
  // either by this tab or by a Firestore subscription update from another
  // user). Otherwise stale IDs in the set inflate the toolbar count and
  // would silently no-op on bulk operations.
  useEffect(() => {
    const live = new Set(stations.map(s => s.id));
    setSelectedIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [stations]);

  const handleDragStartCard = (e: React.DragEvent<HTMLDivElement>, stationId: string) => {
    // If the dragged card is in the current selection, drag the whole batch.
    // Otherwise drag just this one (and don't mutate selection).
    const ids = selectedIds.has(stationId) ? Array.from(selectedIds) : [stationId];
    const payload = JSON.stringify(ids);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData(DND_MIME, payload); } catch { /* Some browsers (older Safari) reject custom mime types — fall back below. */ }
    e.dataTransfer.setData(DND_FALLBACK_MIME, payload);
    setDraggingIds(new Set(ids));
  };
  const handleDragEndCard = () => {
    setDraggingIds(new Set());
    setDropTargetId(null);
    dragEnterCount.current = {};
  };
  const readDragIds = (e: React.DragEvent<HTMLDivElement>): string[] | null => {
    const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData(DND_FALLBACK_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) return parsed;
    } catch { /* malformed payload — ignore */ }
    return null;
  };
  const handleDragOverColumn = (e: React.DragEvent<HTMLDivElement>) => {
    // preventDefault is REQUIRED to mark the column as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDragEnterColumn = (columnKey: string) => {
    dragEnterCount.current[columnKey] = (dragEnterCount.current[columnKey] || 0) + 1;
    setDropTargetId(columnKey);
  };
  const handleDragLeaveColumn = (columnKey: string) => {
    const next = (dragEnterCount.current[columnKey] || 1) - 1;
    dragEnterCount.current[columnKey] = next;
    if (next <= 0) {
      dragEnterCount.current[columnKey] = 0;
      setDropTargetId(prev => prev === columnKey ? null : prev);
    }
  };
  const handleDropOnColumn = (e: React.DragEvent<HTMLDivElement>, targetGroupId: string | undefined) => {
    e.preventDefault();
    const ids = readDragIds(e);
    setDraggingIds(new Set());
    setDropTargetId(null);
    dragEnterCount.current = {};
    if (!ids || ids.length === 0) return;

    // v5.13.0 — partition the drop set into "compatible" + "rejected"
    // based on the target group's eligibleRoles gate.
    //   * Target is ungrouped (undefined groupId) → no gate, all pass.
    //   * Target group has no eligibleRoles set → no gate, all pass.
    //   * Target has eligibleRoles → station passes only when its
    //     requiredRoles intersect (or station has no requiredRoles set,
    //     meaning "any role" is fine and the station inherits the gate
    //     when the move lands).
    // Rejected stations get routed to ungrouped instead so they're still
    // visible (and can be re-dragged after the supervisor adjusts roles).
    // Heads-up: a rejected mover is NOT silently dropped — it lands in
    // ungrouped with a toast explaining why.
    const targetGroup = targetGroupId
      ? stationGroups.find(g => g.id === targetGroupId)
      : undefined;
    const gate = targetGroup?.eligibleRoles;
    const compatible: string[] = [];
    const rejected: { id: string; name: string; required: string[] }[] = [];
    for (const id of ids) {
      const st = stations.find(s => s.id === id);
      if (!st) continue;
      if (st.groupId === targetGroupId) continue; // No-op; skip.
      if (!gate || gate.length === 0) {
        compatible.push(id);
        continue;
      }
      const required = st.requiredRoles || [];
      const overlaps = required.length === 0 || required.some(r => gate.includes(r));
      if (overlaps) {
        compatible.push(id);
      } else {
        rejected.push({ id, name: st.name, required });
      }
    }
    if (compatible.length === 0 && rejected.length === 0) return;

    // Apply moves. Compatible go to the target; rejected get routed to
    // ungrouped so they remain visible (and the supervisor can adjust).
    const apply = (idsToMove: string[], groupId: string | undefined) => {
      if (idsToMove.length === 0) return;
      if (onBulkMoveStations) {
        onBulkMoveStations(idsToMove, groupId);
      } else {
        for (const id of idsToMove) {
          const st = stations.find(s => s.id === id);
          if (st) onUpdateStation({ ...st, groupId });
        }
      }
    };
    apply(compatible, targetGroupId);
    apply(rejected.map(r => r.id), undefined);

    if (rejected.length > 0 && onRoleMismatchDrop) {
      onRoleMismatchDrop(targetGroup?.name || '—', rejected);
    }
  };
  const requestBulkDelete = () => {
    if (selectedIds.size === 0 || !onBulkDeleteStations) return;
    onBulkDeleteStations(Array.from(selectedIds));
  };

  // v5.11.0 — master select-all + per-group select. The master toggle
  // adds every visible station to the selection set; clicking it again
  // when everything is already selected clears the set. Per-group
  // toggle picks all stations in one kanban column at once. Both feed
  // into the same selectedIds state so the existing bulk-move /
  // bulk-delete toolbar works without modification.
  const allStationsSelected = stations.length > 0 && selectedIds.size === stations.length;
  const selectAllStations = () => {
    if (allStationsSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(stations.map(s => s.id)));
    }
  };
  const toggleSelectGroup = (memberIds: string[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allInGroup = memberIds.length > 0 && memberIds.every(id => next.has(id));
      if (allInGroup) {
        // Deselect every member.
        for (const id of memberIds) next.delete(id);
      } else {
        // Select every member (additive — preserves out-of-group selection).
        for (const id of memberIds) next.add(id);
      }
      return next;
    });
  };

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

  // v5.13.0 — when a group's eligibleRoles change, propagate any newly-
  // added roles into each station inside the group. Append-only: existing
  // station.requiredRoles entries are preserved (nothing is silently
  // removed). Stations whose requiredRoles is empty inherit the group's
  // full set so they match the gate without manual touch-up. Removed
  // roles fall to drag-drop validation: stations requiring a now-disallowed
  // role won't fall out automatically (they keep their requiredRoles)
  // but future drops respect the new gate. Caller is the in-header roles
  // editor.
  const handleUpdateGroupEligibleRoles = (groupId: string, nextRoles: string[]) => {
    const prevGroup = stationGroups.find(g => g.id === groupId);
    const prevRoles = new Set(prevGroup?.eligibleRoles || []);
    const newlyAdded = nextRoles.filter(r => !prevRoles.has(r));
    onSaveGroups(stationGroups.map(g => g.id === groupId ? { ...g, eligibleRoles: nextRoles } : g));
    if (newlyAdded.length === 0 && nextRoles.length > 0) return;
    for (const st of stations) {
      if (st.groupId !== groupId) continue;
      const current = st.requiredRoles || [];
      if (current.length === 0) {
        // Empty station inherits the new full set so the role gate has
        // something to match against.
        if (nextRoles.length > 0) onUpdateStation({ ...st, requiredRoles: [...nextRoles] });
        continue;
      }
      // Append-only merge — keep what the supervisor already set.
      const merged = Array.from(new Set([...current, ...newlyAdded]));
      if (merged.length !== current.length) {
        onUpdateStation({ ...st, requiredRoles: merged });
      }
    }
  };

  // Roles available across the active roster, used to populate the
  // group-level role picker. Pulled from live employees so a freshly
  // added role appears immediately.
  const availableRoles = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    return Array.from(set).sort();
  }, [employees]);

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
          {onBulkAdd && (
            <button
              onClick={onBulkAdd}
              className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all shadow-sm"
            >
              <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
              {t('layout.bulkAdd')}
            </button>
          )}
          {/* v5.11.0 — master Select-all toggle. Pre-v5.11 the only way
              to select every station was clicking each card individually,
              which the user flagged as too slow for "I want to delete all
              stations" / "I want to bulk-move every station". Click once
              to add every station to the selection set; click again to
              clear. Selection state is shared with the per-card checkbox
              (drag-and-drop) and per-column checkbox (group-level
              select). */}
          {stations.length > 0 && (
            <button
              onClick={selectAllStations}
              title={allStationsSelected ? t('layout.selectAll.deselectTooltip') : t('layout.selectAll.tooltip')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-sm border',
                allStationsSelected
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60',
              )}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {allStationsSelected ? t('layout.selectAll.deselect') : t('layout.selectAll')}
            </button>
          )}
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

      {/* v5.4.0 — selection toolbar. Renders only when at least one card
          is checked. Drag-drop is the primary "move" path; this toolbar
          adds a "Move to..." for keyboard / touch users + a count + bulk
          delete + clear. */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap p-3 rounded-xl bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30">
          <p className="text-[10px] font-black text-blue-700 dark:text-blue-200 uppercase tracking-widest">
            {t('layout.selection.count', { count: selectedIds.size })}
          </p>
          {onBulkMoveStations && stationGroups.length > 0 && (
            <select
              value=""
              onChange={e => {
                const target = e.target.value;
                if (!target) return;
                const ids = Array.from(selectedIds);
                onBulkMoveStations(ids, target === '__ungrouped__' ? undefined : target);
                clearSelection();
              }}
              className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('layout.selection.moveTo')}</option>
              {stationGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
              <option value="__ungrouped__">{t('layout.group.ungrouped')}</option>
            </select>
          )}
          {onBulkDeleteStations && (
            <button
              onClick={requestBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-200 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-500/25 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t('layout.selection.deleteSelected')}
            </button>
          )}
          <button
            onClick={clearSelection}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ms-auto"
          >
            {t('layout.selection.clear')}
          </button>
        </div>
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
          const isDropTarget = dropTargetId === id;
          return (
            <div
              key={id}
              onDragOver={handleDragOverColumn}
              onDragEnter={() => handleDragEnterColumn(id)}
              onDragLeave={() => handleDragLeaveColumn(id)}
              onDrop={(e) => handleDropOnColumn(e, isUngrouped ? undefined : entry.group.id)}
              className={cn(
                'rounded-2xl border overflow-hidden flex flex-col transition-all',
                isDropTarget
                  ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-400 dark:border-blue-500/60 ring-2 ring-blue-400 dark:ring-blue-500/40'
                  : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700',
              )}
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
                      onBlur={e => { handleUpdateGroup(entry.group.id, { name: e.target.value.trim() || entry.group.name }); }}
                      // v5.13.0 — Enter just commits the rename without
                      // closing the editor, so the supervisor can move
                      // straight into the eligible-roles picker below.
                      // Esc still bails out entirely.
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
                    {/* v5.13.0 — passive eligible-roles indicator. Renders
                        in the header sub-line whenever the group has a role
                        gate set, so the supervisor can see the policy at a
                        glance even when not editing. */}
                    {!isUngrouped && (entry.group.eligibleRoles?.length ?? 0) > 0 && (
                      <span className="ms-2 normal-case text-[9px] font-medium text-slate-500 dark:text-slate-400 lowercase">
                        · {t('layout.group.eligibleRoles.summary', { roles: entry.group.eligibleRoles!.join(', ') })}
                      </span>
                    )}
                  </p>
                </div>
                {/* v5.11.0 — per-group select toggle. Picks all stations
                    in this column at once (additive — preserves selection
                    in other columns). Click again when all are selected
                    to deselect just this column's members. */}
                {items.length > 0 && (() => {
                  const memberIds = items.map(s => s.id);
                  const allSelected = memberIds.every(id => selectedIds.has(id));
                  const Icon = allSelected ? CheckSquare : Square;
                  return (
                    <button
                      onClick={() => toggleSelectGroup(memberIds)}
                      title={allSelected
                        ? t('layout.group.deselectAll', { name: groupName })
                        : t('layout.group.selectAll', { name: groupName })}
                      className={cn(
                        'p-1.5 rounded transition-colors shrink-0',
                        allSelected
                          ? 'text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15'
                          : 'text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-white/60 dark:hover:bg-slate-700/60',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  );
                })()}
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

              {/* v5.13.0 — eligible-roles editor panel. Renders as a row
                  below the column header when the group is in edit mode.
                  Multi-select chips backed by the live roster. Clicking
                  Done propagates any newly-added roles into every
                  station inside the group (append-only — existing
                  station.requiredRoles stay), then closes the editor. */}
              {editing && !isUngrouped && (
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/20">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                    {t('layout.group.eligibleRoles.label')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableRoles.length === 0 ? (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                        {t('layout.group.eligibleRoles.empty')}
                      </p>
                    ) : (
                      availableRoles.map(role => {
                        const active = (entry.group.eligibleRoles || []).includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => {
                              const cur = entry.group.eligibleRoles || [];
                              const next = active
                                ? cur.filter(r => r !== role)
                                : [...cur, role];
                              handleUpdateGroupEligibleRoles(entry.group.id, next);
                            }}
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
                              active
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500/40',
                            )}
                          >
                            {role}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2.5">
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {t('layout.group.eligibleRoles.help')}
                    </p>
                    <button
                      onClick={() => setEditingGroupId(null)}
                      className="px-3 py-1 rounded text-[9px] font-bold uppercase tracking-widest bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white shrink-0"
                    >
                      {t('layout.group.eligibleRoles.done')}
                    </button>
                  </div>
                </div>
              )}

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
                    selected={selectedIds.has(st.id)}
                    onToggleSelect={() => toggleSelect(st.id)}
                    onDragStart={(e) => handleDragStartCard(e, st.id)}
                    onDragEnd={handleDragEndCard}
                    isDragging={draggingIds.has(st.id)}
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
  selected, onToggleSelect, onDragStart, onDragEnd, isDragging,
}: {
  station: Station;
  employees: Employee[];
  groups: StationGroup[];
  onEdit: () => void;
  onDelete: () => void;
  onMoveToGroup: (groupId: string | undefined) => void;
  // v5.4.0 — selection + drag-drop. The card is the drag source; columns
  // are the drop zones (handled in LayoutTab). When `selected` is true the
  // card carries a blue ring; when `isDragging` is true it fades so the
  // user can see what's currently being moved.
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
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
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'p-3 bg-white dark:bg-slate-900 rounded-xl border hover:shadow-sm transition-all group cursor-grab active:cursor-grabbing',
        selected
          ? 'border-blue-400 dark:border-blue-500/60 ring-2 ring-blue-300 dark:ring-blue-500/30 bg-blue-50/40 dark:bg-blue-500/10'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          // Stop the drag from kicking in when the user clicks the
          // checkbox; without this the click sometimes initiates a drag
          // because the parent has `draggable=true`.
          onMouseDown={e => e.stopPropagation()}
          aria-label={t('layout.station.select', { name: station.name })}
          className="mt-1 shrink-0 cursor-pointer"
        />
        <span title={t('layout.station.dragHint')} className="shrink-0">
          <GripVertical
            className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mt-1.5"
            aria-hidden
          />
        </span>
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
