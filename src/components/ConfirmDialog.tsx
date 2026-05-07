'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button is red (destructive) instead of accent-colored. */
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Drop-in replacement for window.confirm with a themed modal. */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Graceful fallback so an out-of-tree caller doesn't crash; logs once.
    if (typeof window !== 'undefined' && !(window as Window & { __mcConfirmWarned?: boolean }).__mcConfirmWarned) {
      console.warn('[useConfirm] No <ConfirmProvider> in tree — falling back to window.confirm');
      (window as Window & { __mcConfirmWarned?: boolean }).__mcConfirmWarned = true;
    }
    return (opts: ConfirmOptions) => Promise.resolve(window.confirm(opts.title || opts.body || 'Confirm?'));
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setOpts(next);
      setOpen(true);
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  // ESC = cancel, Enter = confirm.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-mc-bg border border-mc-border shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 py-4 border-b border-mc-border">
              <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                opts.danger
                  ? 'bg-mc-accent-red/15 text-mc-accent-red'
                  : 'bg-mc-accent/15 text-mc-accent'
              }`}>
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-mc-text">
                  {opts.title ?? 'Are you sure?'}
                </h3>
                {opts.body && (
                  <p className="text-xs text-mc-text-secondary mt-1 leading-relaxed">{opts.body}</p>
                )}
              </div>
              <button
                onClick={() => close(false)}
                className="shrink-0 p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-mc-bg-secondary/40">
              <button
                onClick={() => close(false)}
                className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
              >
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className={`min-h-9 px-4 rounded-lg text-xs font-medium ${
                  opts.danger
                    ? 'bg-mc-accent-red text-white hover:bg-mc-accent-red/90'
                    : 'bg-mc-accent text-mc-bg hover:bg-mc-accent/90'
                }`}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
