'use client';
import { RouteError } from '@/components/RouteError';

export default function CronsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} hint="The cron manager couldn't render. Saved jobs aren't affected." />;
}
