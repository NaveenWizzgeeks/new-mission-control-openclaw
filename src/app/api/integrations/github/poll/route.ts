import { NextResponse } from 'next/server';
import { pollGitHubForUpdates } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

/** Inbound poll. Set up a cron with action='custom' pointing here for periodic sync. */
export async function POST() {
  const result = await pollGitHubForUpdates();
  return NextResponse.json(result);
}
