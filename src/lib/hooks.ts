import { useEffect, useRef } from 'react';

// Wires up Escape-to-close and an initial-focus hook for any modal.
// Pass a ref to the element that should receive focus when the modal opens
// (typically the first input or the close button); leave undefined to skip.
//
// v5.18.0 — optional `canClose` predicate. When provided, Escape only fires
// `onClose` if the predicate returns true; modals with a dirty form can
// pass `() => !isDirty` to suppress accidental Escape-discards. The same
// surface exposed to the X / Cancel buttons (which call a guarded
// requestClose helper in the modal itself); useModalKeys handles the
// keyboard path. If `canClose` returns false the modal stays open and
// the modal can choose to surface a "discard changes?" confirm flow.
export function useModalKeys(
  isOpen: boolean,
  onClose: () => void,
  canClose?: () => boolean,
): React.RefObject<HTMLElement | null> {
  const initialFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canClose && !canClose()) return;
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    // Defer focus until after the modal mount paints — focusing during the
    // same tick fights with the document's existing focus.
    const t = window.setTimeout(() => {
      initialFocusRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handler);
      window.clearTimeout(t);
    };
  }, [isOpen, onClose, canClose]);

  return initialFocusRef;
}
