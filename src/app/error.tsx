'use client';
import { RouteError } from '@/components/RouteError';

// Global root error boundary — catches anything not handled by a more
// specific segment-level error.tsx.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
