'use client';
import { RouteError } from '@/components/RouteError';

export default function SessionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="The Sessions dashboard couldn't load. The OpenClaw gateway may be offline." />;
}
