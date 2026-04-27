import { useEffect, useRef } from 'react';

// Wires up Escape-to-close and an initial-focus hook for any modal.
// Pass a ref to the element that should receive focus when the modal opens
// (typically the first input or the close button); leave undefined to skip.
export function useModalKeys(isOpen: boolean, onClose: () => void): React.RefObject<HTMLElement | null> {
  const initialFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [isOpen, onClose]);

  return initialFocusRef;
}
