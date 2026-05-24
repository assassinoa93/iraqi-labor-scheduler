import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Edit3, Trash2, Check, X, Clock } from 'lucide-react';
import { Company } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

// localStorage key for the most-recently-switched-to companies list.
// Capped at 5 entries, ordered most-recent-first. Persists per-device
// (not synced) — surfaces only when the org has ≥6 companies so smaller
// rosters don't get a redundant "recent" section pinned above the full
// list. Filtered against the live companies array at render time so a
// deleted entry drops out automatically.
const RECENT_COMPANIES_KEY = 'ils.recentCompanies.v1';
const RECENT_CAP = 5;
const RECENT_MIN_COMPANIES = 6;

function readRecentCompanies(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMPANIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecentCompany(id: string) {
  try {
    const current = readRecentCompanies();
    const next = [id, ...current.filter(x => x !== id)].slice(0, RECENT_CAP);
    localStorage.setItem(RECENT_COMPANIES_KEY, JSON.stringify(next));
  } catch {
    // localStorage might be unavailable (Electron secure context edge cases) —
    // failing silently is correct; the recent list is a nice-to-have.
  }
}

interface Props {
  companies: Company[];
  activeCompanyId: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  // Disable add / delete while sim mode is active to keep the data layer stable.
  locked?: boolean;
}

// Compact roster of companies / branches displayed in the sidebar header. The
// active company is shown with a stronger background; clicking another row
// switches the entire app to that company's data slice. Rename / delete are
// gated behind an inline edit affordance so a misclick can't wipe an entry.
export function CompanySwitcher({ companies, activeCompanyId, onSwitch, onAdd, onRename, onDelete, locked }: Props) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Recent-list state. Re-read from localStorage when activeCompanyId
  // changes so the list updates immediately after the user switches.
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCompanies());

  useEffect(() => {
    pushRecentCompany(activeCompanyId);
    setRecentIds(readRecentCompanies());
  }, [activeCompanyId]);

  const showRecents = companies.length >= RECENT_MIN_COMPANIES;
  const recents = useMemo(() => {
    if (!showRecents) return [];
    const live = new Map(companies.map(c => [c.id, c] as const));
    return recentIds
      .filter(id => id !== activeCompanyId && live.has(id))
      .slice(0, 3)
      .map(id => live.get(id)!);
  }, [recentIds, companies, activeCompanyId, showRecents]);

  const commitAdd = () => {
    const name = newName.trim();
    if (!name) { setAdding(false); return; }
    onAdd(name);
    setNewName('');
    setAdding(false);
  };

  const commitRename = (id: string) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    onRename(id, name);
    setEditingId(null);
  };

  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black text-blue-300 uppercase tracking-widest ps-1 mb-1">{t('company.header')}</p>
      {recents.length > 0 && (
        <div className="space-y-1 pb-2 mb-2 border-b border-slate-700/50">
          <p className="flex items-center gap-1.5 text-[8px] font-bold text-slate-500 uppercase tracking-widest ps-1">
            <Clock className="w-2.5 h-2.5" />
            {t('company.recent')}
          </p>
          {recents.map(c => (
            <div
              key={`recent-${c.id}`}
              onClick={() => onSwitch(c.id)}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all hover:bg-slate-800 border border-transparent"
            >
              <Building2 className="w-3 h-3 shrink-0 text-slate-500" />
              <span className="flex-1 text-[11px] font-bold truncate text-slate-300">{c.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {companies.map(c => {
          const active = c.id === activeCompanyId;
          if (editingId === c.id) {
            return (
              <div key={c.id} className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-800">
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 bg-slate-900 text-white px-2 py-1 rounded text-[11px] font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
                  placeholder={t('company.renamePlaceholder')}
                />
                <button onClick={() => commitRename(c.id)} aria-label={t('action.confirm')} className="p-1 text-emerald-400 hover:bg-slate-700 rounded">
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => setEditingId(null)} aria-label={t('action.cancel')} className="p-1 text-slate-400 hover:bg-slate-700 rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          }
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all group",
                active ? "bg-blue-600/30 border border-blue-500/40" : "hover:bg-slate-800 border border-transparent"
              )}
              onClick={() => !active && onSwitch(c.id)}
            >
              <Building2 className={cn("w-3 h-3 shrink-0", active ? "text-blue-300" : "text-slate-500")} />
              <span className={cn("flex-1 text-[11px] font-bold truncate", active ? "text-white" : "text-slate-300")}>{c.name}</span>
              <button
                onClick={e => { e.stopPropagation(); setEditName(c.name); setEditingId(c.id); }}
                aria-label={t('company.rename')}
                className="p-1 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Edit3 className="w-3 h-3" />
              </button>
              {companies.length > 1 && !locked && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(c.id); }}
                  aria-label={t('company.delete')}
                  className="p-1 text-rose-400 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-800">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
            placeholder={t('company.newPlaceholder')}
            className="flex-1 bg-slate-900 text-white px-2 py-1 rounded text-[11px] font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
          />
          <button onClick={commitAdd} aria-label={t('action.confirm')} className="p-1 text-emerald-400 hover:bg-slate-700 rounded">
            <Check className="w-3 h-3" />
          </button>
          <button onClick={() => { setAdding(false); setNewName(''); }} aria-label={t('action.cancel')} className="p-1 text-slate-400 hover:bg-slate-700 rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        !locked && (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-black text-slate-400 hover:text-white hover:bg-slate-800 uppercase tracking-widest transition-all"
          >
            <Plus className="w-3 h-3" />
            {t('company.add')}
          </button>
        )
      )}
    </div>
  );
}
