'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowUp, Folder, Home, RefreshCw, X } from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
}

interface ListResponse {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

interface DirectoryPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function DirectoryPicker({ initialPath, onSelect, onCancel }: DirectoryPickerProps) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = target ? `/api/fs/list?path=${encodeURIComponent(target)}` : '/api/fs/list';
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to read directory');
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(initialPath); }, [load, initialPath]);

  const goHome = () => load();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-mc-border flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Pick a directory</h3>
          <button onClick={onCancel} className="text-mc-text-secondary hover:text-mc-text" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-mc-border flex items-center gap-2">
          <button
            onClick={() => data?.parent && load(data.parent)}
            disabled={!data?.parent || loading}
            className="p-1.5 rounded text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
            title="Parent directory"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={goHome}
            disabled={loading}
            className="p-1.5 rounded text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
            title="Home directory"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={() => data && load(data.current)}
            disabled={loading || !data}
            className="p-1.5 rounded text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex-1 min-w-0 px-3 py-1.5 bg-mc-bg border border-mc-border rounded-lg font-mono text-xs truncate">
            {data?.current ?? (loading ? 'Loading…' : '—')}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-5 text-sm text-mc-accent-red">{error}</div>
          )}
          {!error && loading && (
            <div className="p-5 space-y-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-8 rounded bg-mc-bg-tertiary animate-pulse" />)}
            </div>
          )}
          {!error && !loading && data && data.dirs.length === 0 && (
            <p className="p-5 text-sm text-mc-text-secondary">No subdirectories here. Pick this directory or go up.</p>
          )}
          {!error && !loading && data && data.dirs.length > 0 && (
            <ul className="py-1">
              {data.dirs.map(d => (
                <li key={d.path}>
                  <button
                    onClick={() => load(d.path)}
                    className="w-full flex items-center gap-2 px-5 py-2 text-sm hover:bg-mc-bg-tertiary text-left"
                  >
                    <Folder className="w-4 h-4 text-mc-accent shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t border-mc-border flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!data}
            onClick={() => data && onSelect(data.current)}
            className="px-4 py-2 text-sm bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
          >
            Use this directory
          </button>
        </div>
      </div>
    </div>
  );
}
