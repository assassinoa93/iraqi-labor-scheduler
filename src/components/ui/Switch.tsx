import React from 'react';
import { cn } from '../../lib/utils';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Accent colour for the ON track. Defaults to indigo so it reads as the
  // primary brand colour. Pass "emerald" / "rose" / "amber" for semantic
  // toggles where the colour itself signals meaning (e.g. "enforce" =
  // emerald, "disabled" = slate).
  tone?: 'indigo' | 'emerald' | 'rose' | 'amber' | 'blue';
  disabled?: boolean;
  size?: 'sm' | 'md';
  // Pass-throughs for accessibility when the toggle isn't paired with a
  // <label htmlFor=>. Either id or aria-label should be supplied.
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

// Apple-style modern toggle. Replaces raw <input type="checkbox"> for
// boolean feature toggles where the binary semantic (on/off) is the point —
// not for multi-select row checkboxes (those should stay as checkboxes).
//
// Visual: pill track (slate when off, accent when on), white circular thumb
// that slides between the two ends with a 220ms ease-out cubic. Both keyboard
// (space/enter) and click work, focus ring matches the accent.
export function Switch({
  checked, onChange, tone = 'indigo', disabled, size = 'md',
  id, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby,
}: Props) {
  const toneOn =
    tone === 'emerald' ? 'bg-emerald-500'
    : tone === 'rose' ? 'bg-rose-500'
    : tone === 'amber' ? 'bg-amber-500'
    : tone === 'blue' ? 'bg-blue-600'
    : 'bg-indigo-600';
  const toneRing =
    tone === 'emerald' ? 'focus-visible:ring-emerald-400'
    : tone === 'rose' ? 'focus-visible:ring-rose-400'
    : tone === 'amber' ? 'focus-visible:ring-amber-400'
    : tone === 'blue' ? 'focus-visible:ring-blue-400'
    : 'focus-visible:ring-indigo-400';

  const sm = size === 'sm';
  const trackW = sm ? 'w-8' : 'w-10';
  const trackH = sm ? 'h-4.5' : 'h-6';
  const thumbSize = sm ? 'w-3.5 h-3.5' : 'w-5 h-5';
  // RTL: the thumb travel must mirror, so the ON state lands the thumb on
  // the inline-end of the track (visual left in RTL). Tailwind's
  // translate-x-* is physical, so we pair with rtl: variants to negate.
  const thumbOff = 'translate-x-0.5 rtl:-translate-x-0.5';
  const thumbOn = sm ? 'translate-x-3.5 rtl:-translate-x-3.5' : 'translate-x-4 rtl:-translate-x-4';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        trackW, trackH,
        checked ? toneOn : "bg-slate-300 dark:bg-slate-600",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled && "cursor-pointer",
        toneRing,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          thumbSize,
          checked ? thumbOn : thumbOff,
        )}
        style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)' }}
      />
    </button>
  );
}
