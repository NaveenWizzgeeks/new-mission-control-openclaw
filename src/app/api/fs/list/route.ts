import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

interface DirEntry {
  name: string;
  path: string;
}

interface ListResponse {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('path');
  let target = requested && requested.length > 0 ? requested : os.homedir();

  try {
    target = path.resolve(target);
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a directory' }, { status: 400 });
    }

    const entries = await fs.readdir(target, { withFileTypes: true });
    const dirs: DirEntry[] = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(target);
    const response: ListResponse = {
      current: target,
      parent: parent === target ? null : parent,
      dirs,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list directory';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
