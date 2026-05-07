import { NextResponse } from 'next/server';
import { listLinks } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ items: listLinks() });
}
