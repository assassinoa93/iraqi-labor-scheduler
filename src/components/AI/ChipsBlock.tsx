/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Question-chip set (phase 5).
 *
 * Renders one fenced ```chips``` block from an assistant message.
 * Once the user clicks an option, the chip set re-renders as inert
 * with a checkmark on the chosen label — clicking again is a no-op
 * (the parent reads `selected` from session state).
 *
 * Click semantics:
 *   - A non-null value → write to the station profile (parent does this
 *     via the dual-mode profile store) AND post a user message that
 *     names the choice so the model can follow up.
 *   - A null value → do not mutate; just post the label as a freeform
 *     reply prompt ("Other (I will type)" → user types in the input
 *     box). This lets the model offer a "I will type" escape hatch.
 */

import React from 'react';
import { Sparkles, Check, MessageSquare } from 'lucide-react';
import type { ChipSet } from '../../lib/ai/findings';

interface Props {
  chipSet: ChipSet;
  selected: string | null;
  disabled: boolean;
  onPick: (option: { label: string; value: string | null }) => void;
}

export function ChipsBlock({ chipSet, selected, disabled, onPick }: Props) {
  return (
    <div className="p-3 bg-amber-50/40 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-500/30 rounded-xl space-y-2">
      <div className="flex items-start gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-200 leading-relaxed">{chipSet.question}</p>
          {chipSet.stationId && (
            <p className="text-[10px] font-mono text-amber-700/70 dark:text-amber-300/70 mt-0.5">
              station: {chipSet.stationId}{chipSet.field ? ` · field: ${chipSet.field}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chipSet.options.map((opt, i) => {
          const isSelected = selected === opt.label;
          const isFreeform = opt.value === null;
          return (
            <button
              key={`${opt.label}-${i}`}
              onClick={() => onPick(opt)}
              disabled={disabled || selected !== null}
              className={[
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors duration-150',
                isSelected
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-500/25'
                  : selected !== null
                    ? 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : disabled
                      ? 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                      : isFreeform
                        ? 'bg-white dark:bg-slate-800/60 border-dashed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-amber-400 dark:hover:border-amber-500/60'
                        : 'bg-white dark:bg-slate-800/60 border-amber-200 dark:border-amber-500/30 text-slate-800 dark:text-slate-200 hover:border-amber-400 dark:hover:border-amber-500/60',
              ].join(' ')}
            >
              {isSelected && <Check className="w-3 h-3" />}
              {!isSelected && isFreeform && <Sparkles className="w-3 h-3 opacity-60" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
