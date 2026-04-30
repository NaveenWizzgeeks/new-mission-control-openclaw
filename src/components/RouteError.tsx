'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  hint?: string;
}

/**
 * Shared error boundary used by route-segment error.tsx files. Renders a
 * compact card with a Try again button that calls Next's reset(). The error
 * stack is logged to the console (and shown in dev) for debugging.
 */
export function RouteError({ error, reset, hint }: RouteErrorProps) {
  useEffect(() => {
    console.error('[RouteError]', error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-mc-bg-secondary border border-mc-accent-red/40 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-mc-accent-red shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-mc-text">Something went wrong</h3>
            {hint && <p className="text-xs text-mc-text-secondary mt-1">{hint}</p>}
          </div>
        </div>

        <pre className="text-xs font-mono text-mc-accent-red/90 bg-mc-accent-red/5 border border-mc-accent-red/20 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words mb-4">
          {error.message || 'Unknown error'}
          {error.digest ? `\n[digest: ${error.digest}]` : ''}
        </pre>

        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-sm font-medium hover:bg-mc-accent/90"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      </div>
    </div>
  );
}
