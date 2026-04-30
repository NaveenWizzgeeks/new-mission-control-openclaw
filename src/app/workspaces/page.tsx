'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { HomeSidebar } from '@/components/HomeSidebar';
import { CreateWorkspaceModal } from '@/components/CreateWorkspaceModal';
import { WorkspaceManager } from '@/components/workspaces/WorkspaceManager';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import type { Workspace, WorkspaceStats } from '@/lib/types';

interface WorkspaceRow extends WorkspaceStats {
  path: string | null;
  description: string | null;
  created_at: string;
}

export default function WorkspacesPage() {
  const [rows, setRows] = useState<WorkspaceRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statsRes, rawRes] = await Promise.all([
        fetch('/api/workspaces?stats=true'),
        fetch('/api/workspaces'),
      ]);
      if (!statsRes.ok || !rawRes.ok) {
        setRows([]);
        return;
      }
      const stats: WorkspaceStats[] = await statsRes.json();
      const raws: Workspace[] = await rawRes.json();
      const rawById = new Map(raws.map(r => [r.id, r]));
      const merged: WorkspaceRow[] = stats.map(s => {
        const raw = rawById.get(s.id);
        return {
          ...s,
          path: raw?.path ?? null,
          description: raw?.description ?? null,
          created_at: raw?.created_at ?? '',
        };
      });
      setRows(merged);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['workspaces', 'agents'], load);

  return (
    <div className="h-screen bg-mc-bg flex overflow-hidden">
      <HomeSidebar />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-1">Workspaces</h2>
              <p className="text-mc-text-secondary text-sm">
                {rows === null ? 'Loading…' : `${rows.length} workspace${rows.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              New Workspace
            </button>
          </div>

          <WorkspaceManager rows={rows} onChanged={load} />
        </div>
      </main>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
