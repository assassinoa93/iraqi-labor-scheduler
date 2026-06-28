import React, { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { EASE_OUT } from '../lib/motion';

// v5.41.0 (04.3 / F3) — tiny inline sparkline. A line (optionally with a soft
// area fill) that draws on via stroke `pathLength` when it first appears. Pure
// presentation: no text, direction-agnostic, so it's safe in RTL. The line
// uses a fixed 100×30 viewBox stretched to the container via
// `preserveAspectRatio="none"`, with a non-scaling stroke so the line weight
// stays crisp at any width. Under reduced-motion the full path renders
// immediately (no draw-on), matching the rest of the motion layer.

export type SparkTone = 'accent' | 'emerald' | 'rose' | 'amber' | 'slate' | 'up' | 'down' | 'flat';

const TONE_STROKE: Record<SparkTone, string> = {
  accent: '#2563eb',
  up: '#059669',
  emerald: '#059669',
  down: '#e11d48',
  rose: '#e11d48',
  amber: '#d97706',
  flat: '#94a3b8',
  slate: '#94a3b8',
};

export function Sparkline({
  data,
  tone = 'accent',
  height = 28,
  strokeWidth = 1.5,
  area = true,
  animateDraw = true,
  className,
}: {
  data: number[];
  tone?: SparkTone;
  height?: number;
  strokeWidth?: number;
  area?: boolean;
  animateDraw?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // Per-instance gradient id (colons stripped so it's safe inside url(#…)).
  // useId guarantees uniqueness even if two sparklines share identical data.
  const gradId = 'spark' + useId().replace(/:/g, '');
  // A single point can't draw a line; render nothing rather than a dot.
  if (!data || data.length < 2) return null;

  const W = 100;
  const H = 30;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    // Invert y: higher value sits nearer the top. Pad 2px so the peak/trough
    // don't clip against the viewBox edge.
    const y = 2 + (H - 4) - ((v - min) / range) * (H - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L${W},${H} L0,${H} Z`;
  const stroke = TONE_STROKE[tone] ?? TONE_STROKE.accent;
  const draw = animateDraw && !reduce;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={cn('block w-full', className)}
      aria-hidden="true"
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={areaPath}
            fill={`url(#${gradId})`}
            stroke="none"
            initial={draw ? { opacity: 0 } : false}
            animate={draw ? { opacity: 1 } : undefined}
            transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.15 }}
          />
        </>
      )}
      <motion.path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={draw ? { pathLength: 0 } : false}
        animate={draw ? { pathLength: 1 } : undefined}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      />
    </svg>
  );
}
