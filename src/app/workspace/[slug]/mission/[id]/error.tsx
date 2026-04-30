'use client';
import { RouteError } from '@/components/RouteError';

export default function MissionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="The mission detail page crashed. Other missions in this workspace are unaffected." />;
}
