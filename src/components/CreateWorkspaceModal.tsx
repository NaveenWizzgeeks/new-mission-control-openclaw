'use client';

import { useState } from 'react';
import { Folder } from 'lucide-react';
import { emitRefresh } from '@/hooks/useDataRefresh';
import { DirectoryPicker } from './DirectoryPicker';

interface CreateWorkspaceModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateWorkspaceModal({ onClose, onCreated }: CreateWorkspaceModalProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [path, setPath] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icons = ['📁', '💼', '🏢', '🚀', '💡', '🎯', '📊', '🔧', '🌟', '🏠'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          icon,
          path: path.trim() || undefined,
        }),
      });

      if (res.ok) {
        emitRefresh('workspaces');
        emitRefresh('agents');
        onCreated();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create workspace');
      }
    } catch {
      setError('Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-md pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="p-6 border-b border-mc-border">
          <h2 className="text-lg font-semibold">Create New Workspace</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Icon</label>
            <div className="flex flex-wrap gap-2">
              {icons.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                    icon === i
                      ? 'bg-mc-accent/20 border-2 border-mc-accent'
                      : 'bg-mc-bg border border-mc-border hover:border-mc-accent/50'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Working directory <span className="text-mc-text-secondary font-normal">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/absolute/path/to/project"
                className="flex-1 min-w-0 bg-mc-bg border border-mc-border rounded-lg px-4 py-2 font-mono text-sm focus:outline-none focus:border-mc-accent"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-mc-border text-sm text-mc-text-secondary hover:text-mc-text hover:border-mc-accent/50"
              >
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
            <p className="mt-1 text-xs text-mc-text-secondary">
              Where agents will work for this workspace. Leave blank to set later.
            </p>
          </div>

          {error && <div className="text-mc-accent-red text-sm">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>

      {showPicker && (
        <DirectoryPicker
          initialPath={path || undefined}
          onCancel={() => setShowPicker(false)}
          onSelect={(picked) => { setPath(picked); setShowPicker(false); }}
        />
      )}
    </div>
  );
}
