import { Calendar } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

// v5.16.0 — empty-state shown when employees=0 OR stations=0. The grid
// can't render anything useful in those states; pre-v5.16 the user just
// saw an empty grid with a busy toolbar and no breadcrumb. This block
// names exactly what's missing and provides a one-click jump to the
// setup tab. Mirrors the DashboardTab empty-state pattern. Extracted
// from ScheduleTab in v5.23.0.
export function ScheduleEmptyState({
  kind, onGoToRoster, onGoToLayout,
}: {
  kind: 'noEmployees' | 'noStations' | 'both';
  onGoToRoster?: () => void;
  onGoToLayout?: () => void;
}) {
  const { t } = useI18n();
  const titleKey =
    kind === 'noEmployees' ? 'schedule.empty.noEmployees.title'
    : kind === 'noStations' ? 'schedule.empty.noStations.title'
    : 'schedule.empty.both.title';
  const bodyKey =
    kind === 'noEmployees' ? 'schedule.empty.noEmployees.body'
    : kind === 'noStations' ? 'schedule.empty.noStations.body'
    : 'schedule.empty.both.body';
  // For the 'both' case, show the Roster CTA (employees first, stations
  // come after — that's the natural setup order).
  const showRosterCta = (kind === 'noEmployees' || kind === 'both') && !!onGoToRoster;
  const showLayoutCta = kind === 'noStations' && !!onGoToLayout;
  return (
    <div className="space-y-6">
      <div className="p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-900 shadow-inner">
        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-8 h-8 text-slate-500 dark:text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-2">{t(titleKey)}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed mb-6">{t(bodyKey)}</p>
        <div className="flex flex-wrap gap-3 justify-center">
          {showRosterCta && (
            <button
              onClick={onGoToRoster}
              className="apple-press flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md"
            >
              {t('schedule.empty.noEmployees.cta')}
            </button>
          )}
          {showLayoutCta && (
            <button
              onClick={onGoToLayout}
              className="apple-press flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md"
            >
              {t('schedule.empty.noStations.cta')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
