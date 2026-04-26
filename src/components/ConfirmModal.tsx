import React from 'react';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';

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
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, extraAction }: ConfirmModalProps) {
  const { t } = useI18n();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-sm rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 text-center">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">{title}</h3>
          <p className="text-sm text-slate-500 mb-6">{message}</p>

          {extraAction && (
            <button
              onClick={extraAction.onClick}
              className="w-full flex items-center justify-center gap-2 mb-4 px-4 py-3 bg-blue-50 text-blue-700 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-all border border-blue-100"
            >
              {extraAction.icon && <extraAction.icon className="w-4 h-4" />}
              {extraAction.label}
            </button>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
            >
              {t('modal.confirm.cancel')}
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-red-700 transition-all shadow-md"
            >
              {t('modal.confirm.confirm')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
