import { useEffect, useRef } from 'react';

// Wires up Escape-to-close, an initial-focus hook, a Tab focus-trap, and
// focus-restore for any modal. Pass a ref to the element that should receive
// focus when the modal opens (typically the close button); leave undefined to
// skip the initial focus.
//
// v5.18.0 — optional `canClose` predicate. When provided, Escape only fires
// `onClose` if the predicate returns true; modals with a dirty form can
// pass `() => !isDirty` to suppress accidental Escape-discards.
//
// v5.32 — focus management (a11y). On open we capture the previously-focused
// element and restore it on close, and Tab / Shift+Tab now cycle WITHIN the
// modal's `[role="dialog"]` container instead of walking into the background.
// The trap finds the dialog via the initial-focus element's closest dialog
// ancestor, so it works for every modal already using this hook with no API
// change. If no dialog ancestor exists it degrades to a no-op.
export function useModalKeys(
  isOpen: boolean,
  onClose: () => void,
  canClose?: () => boolean,
): React.RefObject<HTMLElement | null> {
  const initialFocusRef = useRef<HTMLElement | null>(null);

  // Initial focus + focus restore — keyed on `isOpen` ONLY, so an unmemoized
  // onClose (common: `onClose={() => setX(false)}`) re-rendering the host does
  // not re-capture the restore target (which would by then be inside the modal)
  // or re-yank focus on every render.
  useEffect(() => {
    if (!isOpen) return;
    const restore = (document.activeElement as HTMLElement | null) ?? null;
    const t = window.setTimeout(() => initialFocusRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        restore.focus();
      }
    };
  }, [isOpen]);

  // Escape-to-close + Tab focus-trap.
  useEffect(() => {
    if (!isOpen) return;
    const dialog = (): HTMLElement | null =>
      (initialFocusRef.current?.closest('[role="dialog"]') as HTMLElement | null) ?? null;
    const focusable = (container: HTMLElement): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canClose && !canClose()) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = dialog();
      if (!container) return;
      const items = focusable(container);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Focus escaped the dialog — pull it back to the first control.
      if (!active || !container.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, canClose]);

  return initialFocusRef;
}
