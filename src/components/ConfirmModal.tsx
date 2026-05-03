import React from 'react';
import { motion } from 'motion/react';
import { Trash2, Info } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

// Promise-wrapper around ConfirmModal so callers don't have to manage their
// own isOpen / pending-action state. Replaces native window.confirm() with
// the branded modal (RTL, dark mode, motion). Pattern:
//
//   const { confirm, slot } = useConfirm();
//   // …somewhere in the render: {slot}
//   const ok = await confirm({ title: '…', message: '…' });
//   if (!ok) return;

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  extraAction?: {
    label: string;
    onClick: () => void;
    icon?: any;
  };
  // When true, renders as a single-button informational dialog (no destructive
  // styling, no "Cancel" path). Used as the polished replacement for native
  // `alert()` so messages respect RTL layout and the app's visual language.
  infoOnly?: boolean;
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, extraAction, infoOnly }: ConfirmModalProps) {
  const { t } = useI18n();
  const cancelRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  if (!isOpen) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 text-center">
          <div className={infoOnly
            ? "w-12 h-12 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 rounded-full flex items-center justify-center mx-auto mb-4"
            : "w-12 h-12 bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 rounded-full flex items-center justify-center mx-auto mb-4"}>
            {infoOnly ? <Info className="w-6 h-6" /> : <Trash2 className="w-6 h-6" />}
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">{title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 whitespace-pre-line">{message}</p>

          {extraAction && (
            <button
              onClick={extraAction.onClick}
              className="w-full flex items-center justify-center gap-2 mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-blue-100 dark:hover:bg-blue-500/25 transition-all border border-blue-100 dark:border-blue-500/30"
            >
              {extraAction.icon && <extraAction.icon className="w-4 h-4" />}
              {extraAction.label}
            </button>
          )}

          {infoOnly ? (
            <button
              ref={cancelRef}
              onClick={() => { onConfirm(); onClose(); }}
              className="apple-press w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25"
            >
              {t('action.confirm')}
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                ref={cancelRef}
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                {t('modal.confirm.cancel')}
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className="apple-press flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-red-700 shadow-md shadow-red-500/25"
              >
                {t('modal.confirm.confirm')}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: string;
  infoOnly?: boolean;
}

export function useConfirm() {
  const [state, setState] = React.useState<{
    isOpen: boolean;
    title: string;
    message: string;
    infoOnly: boolean;
    resolve: ((ok: boolean) => void) | null;
  }>({ isOpen: false, title: '', message: '', infoOnly: false, resolve: null });

  // useCallback so call-site refs stay stable across renders.
  const confirm = React.useCallback((opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setState({
        isOpen: true,
        title: opts.title,
        message: opts.message,
        infoOnly: opts.infoOnly ?? false,
        resolve,
      });
    }), []);

  // Resolve the pending Promise then collapse state. Reading state.resolve
  // from the closure of the latest render is safe because the modal's
  // onClose / onConfirm props are bound fresh each render — there's no
  // stale closure here.
  const handleClose = () => {
    state.resolve?.(false);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  };
  const handleConfirm = () => {
    state.resolve?.(true);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  };

  const slot = (
    <ConfirmModal
      isOpen={state.isOpen}
      title={state.title}
      message={state.message}
      infoOnly={state.infoOnly}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  );

  return { confirm, slot };
}
