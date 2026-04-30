'use client';
import { RouteError } from '@/components/RouteError';

export default function ChatError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="The chat surface crashed. Try again, and if it persists check the gateway connection." />;
}
