'use client';
import { RouteError } from '@/components/RouteError';

export default function AgentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="Couldn't render the Agents area. The agent or skills API may be unavailable." />;
}
