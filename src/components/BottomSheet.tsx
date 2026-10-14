import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Mobile bottom sheet — the phone replacement for inline settings panels and
// rows of small action buttons. Portalled to <body> so no scrolling ancestor
// can clip it. Hidden from md (768px) up; desktop keeps its inline layout.
export default function BottomSheet({ open, onClose, title, subtitle, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[88dvh] flex flex-col bg-slate-900 border-t border-slate-700 rounded-t-3xl px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-slate-100"
      >
        <div aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-600 self-center mb-3" />
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate">{title}</h2>
            {subtitle && <p className="text-sm text-slate-400 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 flex-none grid place-items-center rounded-xl bg-slate-800 text-slate-300"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto -mx-1 px-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// One full-width row in a sheet: icon, label, optional hint on the right.
export function SheetAction({ icon, label, hint, onClick, danger, disabled }: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3.5 w-full min-h-[50px] px-2.5 rounded-xl text-left text-base font-medium active:bg-slate-800 disabled:opacity-40 ${
        danger ? 'text-red-300' : 'text-slate-100'
      }`}
    >
      <span className="w-6 flex-none grid place-items-center" aria-hidden="true">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-sm text-slate-400">{hint}</span>}
    </button>
  );
}
