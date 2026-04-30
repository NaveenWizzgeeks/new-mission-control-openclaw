'use client';
import { RouteError } from '@/components/RouteError';

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="This workspace page crashed. Mission data is intact in the DB." />;
}
