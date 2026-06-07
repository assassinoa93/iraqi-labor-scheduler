/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Advisory finding card (phase 5).
 *
 * Renders one ```advisory``` block as a severity-tagged, evidence-cited
 * finding card. Three actions: Accept (kept for the export), Dismiss
 * (greys out), Ask more (posts a follow-up user message).
 *
 * Visual language matches the existing compliance-finding cards in
 * Dashboard / Schedule (severity tones, evidence as compact field-path
 * rows). Phase 6 will reuse the accepted-status flag to drive the PDF
 * report export.
 */

import React from 'react';
import {
  AlertTriangle, AlertCircle, Info, Check, X, MessageCircle,
  Building2, User as UserIcon,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { SessionFinding, FindingStatus } from '../../lib/ai/findings';

interface Props {
  finding: SessionFinding;
  onSetStatus: (id: string, status: FindingStatus) => void;
  onAskMore: (finding: SessionFinding) => void;
  disabled: boolean;
}

const SEVERITY_TONES = {
  info:      { bg: 'bg-blue-50/50 dark:bg-blue-500/[0.07]',     border: 'border-blue-200 dark:border-blue-500/30',     text: 'text-blue-800 dark:text-blue-200',     accent: 'text-blue-600 dark:text-blue-300',     icon: Info },
  warning:   { bg: 'bg-amber-50/50 dark:bg-amber-500/[0.07]',   border: 'border-amber-200 dark:border-amber-500/30',   text: 'text-amber-800 dark:text-amber-200',   accent: 'text-amber-600 dark:text-amber-300',   icon: AlertTriangle },
  violation: { bg: 'bg-rose-50/60 dark:bg-rose-500/[0.10]',     border: 'border-rose-200 dark:border-rose-500/40',     text: 'text-rose-800 dark:text-rose-200',     accent: 'text-rose-600 dark:text-rose-300',     icon: AlertCircle },
};

/** i18n key for each severity label (rendered uppercase by CSS). */
const SEVERITY_LABEL_KEY: Record<SessionFinding['severity'], string> = {
  info: 'ai.advisory.severity.info',
  warning: 'ai.advisory.severity.warning',
  violation: 'ai.advisory.severity.violation',
};

/** i18n key for each finding category label. */
const CATEGORY_LABEL_KEY: Record<SessionFinding['category'], string> = {
  liability: 'ai.advisory.category.liability',
  cost: 'ai.advisory.category.cost',
  risk: 'ai.advisory.category.risk',
};

/** Sentinel the findings parser emits when the model omits a title.
 *  Localized at the render site so we don't touch the parser. */
const UNTITLED_SENTINEL = 'Untitled finding';

export function AdvisoryCard({ finding, onSetStatus, onAskMore, disabled }: Props) {
  const { t } = useI18n();
  const tone = SEVERITY_TONES[finding.severity];
  const Icon = tone.icon;
  const isAccepted = finding.status === 'accepted';
  const isDismissed = finding.status === 'dismissed';
  const isPending = finding.status === 'pending';
  const title = finding.title === UNTITLED_SENTINEL ? t('ai.advisory.untitled') : finding.title;

  return (
    <div
      className={[
        'p-4 rounded-2xl border space-y-3',
        tone.bg, tone.border,
        isDismissed && 'opacity-50',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Icon className={`w-4 h-4 ${tone.accent} mt-0.5 shrink-0`} />
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[9px] font-black uppercase tracking-widest ${tone.accent}`}>
                {t(SEVERITY_LABEL_KEY[finding.severity])}
              </span>
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">·</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t(CATEGORY_LABEL_KEY[finding.category])}
              </span>
              {finding.stationId && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-white/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300">
                  <Building2 className="w-2.5 h-2.5" />
                  {finding.stationId}
                </span>
              )}
              {finding.empId && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-white/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300">
                  <UserIcon className="w-2.5 h-2.5" />
                  {finding.empId}
                </span>
              )}
              {isAccepted && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                  <Check className="w-2.5 h-2.5" />
                  {t('ai.advisory.status.accepted')}
                </span>
              )}
            </div>
            <p className={`text-sm font-bold ${tone.text} leading-snug`}>{title}</p>
          </div>
        </div>
      </div>

      {finding.recommendation && (
        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
          {finding.recommendation}
        </p>
      )}

      {finding.evidence.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('ai.advisory.evidence')}</p>
          <div className="space-y-0.5">
            {finding.evidence.map((e, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[10px] font-mono">
                <span className="text-slate-500 dark:text-slate-400 truncate">{e.path}</span>
                <span className="text-slate-500 dark:text-slate-400">=</span>
                <span className="text-slate-700 dark:text-slate-200 font-bold">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isDismissed && (
        <div className="flex flex-wrap gap-2 pt-1">
          {!isAccepted && (
            <button
              onClick={() => onSetStatus(finding.id, 'accepted')}
              disabled={disabled}
              className="apple-press inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {t('ai.advisory.action.accept')}
            </button>
          )}
          {isPending && (
            <button
              onClick={() => onSetStatus(finding.id, 'dismissed')}
              disabled={disabled}
              className="apple-press inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              {t('ai.advisory.action.dismiss')}
            </button>
          )}
          <button
            onClick={() => onAskMore(finding)}
            disabled={disabled}
            className="apple-press inline-flex items-center gap-1 px-3 py-1 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-100 dark:hover:bg-blue-500/25 disabled:opacity-50"
          >
            <MessageCircle className="w-3 h-3" />
            {t('ai.advisory.action.askMore')}
          </button>
        </div>
      )}
      {isDismissed && (
        <button
          onClick={() => onSetStatus(finding.id, 'pending')}
          className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {t('ai.advisory.action.restore')}
        </button>
      )}
    </div>
  );
}
