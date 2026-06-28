// v5.41.0 — shared motion layer (UI & Motion Review, section 04).
//
// Centralises the app's animation vocabulary so the "data arriving" moments
// (count-ups, sparkline draw-on, grid-fill) all speak the same easing/spring
// and all honour reduced-motion the same way. motion/react's
// <MotionConfig reducedMotion="user"> (main.tsx) covers transform/opacity
// animations declaratively; the imperative `animate()` used below is NOT
// auto-gated, so this hook checks `useReducedMotion()` explicitly.

import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

// Apple-flavour ease-out — the same cubic baked into .apple-press and the tab
// transition in index.css, so JS-driven motion matches the CSS layer.
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

// The spring already used by CoverageHintToast — reused for toasts and other
// "springs in, then settles" entrances so they feel like one family.
export const SPRING = { type: 'spring' as const, stiffness: 280, damping: 26 };

// Animate a number from its previous displayed value up to `target` — from 0
// on first mount, then smoothly between values on later changes. Returns the
// live (fractional) value; format at the call site (e.g. Math.round). Under
// reduced-motion (or when disabled / non-finite) the target is returned
// verbatim with no tween, so motion-sensitive users and screen readers just
// see the final number land instantly.
export function useCountUp(
  target: number,
  opts: { duration?: number; enabled?: boolean } = {},
): number {
  const { duration = 0.9, enabled = true } = opts;
  const reduce = useReducedMotion();
  const active = enabled && !reduce && Number.isFinite(target);
  const [display, setDisplay] = useState<number>(active ? 0 : target);
  const fromRef = useRef<number>(active ? 0 : target);

  useEffect(() => {
    if (!active) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const controls = animate(fromRef.current, target, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    fromRef.current = target;
    return () => controls.stop();
  }, [target, active, duration]);

  return active ? display : target;
}
