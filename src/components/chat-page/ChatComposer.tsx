'use client';

import { useCallback, useRef, useState } from 'react';
import { Send, Paperclip, Loader2, X, AlertCircle } from 'lucide-react';

interface SlashCommandInfo {
  command: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommandInfo[] = [
  { command: '/new', description: 'Start a fresh session with the current agent' },
  { command: '/agent <name>', description: 'Switch to a different agent' },
  { command: '/model <name>', description: 'Switch model for upcoming sends' },
  { command: '/task "<title>"', description: 'Create a task assigned to the current agent' },
  { command: '/mission <id>', description: 'Inject mission context into the next send' },
];

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

interface PendingAttachment {
  name: string;
  mimeType: string;
  data: string; // base64 (no prefix)
  sizeBytes: number;
}

export interface ParsedCommand {
  kind: 'send' | 'new' | 'agent' | 'model' | 'task' | 'mission';
  message?: string;
  arg?: string;
}

function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { kind: 'send', message: input };

  const space = trimmed.indexOf(' ');
  const head = space < 0 ? trimmed : trimmed.slice(0, space);
  const tail = space < 0 ? '' : trimmed.slice(space + 1).trim();

  switch (head) {
    case '/new':     return { kind: 'new' };
    case '/agent':   return { kind: 'agent', arg: tail };
    case '/model':   return { kind: 'model', arg: tail };
    case '/task':    return { kind: 'task', arg: tail };
    case '/mission': return { kind: 'mission', arg: tail };
    default:         return { kind: 'send', message: input };
  }
}

interface ChatComposerProps {
  disabled?: boolean;
  agentName?: string;
  onCommand: (cmd: ParsedCommand, attachments: PendingAttachment[]) => Promise<void> | void;
}

export function ChatComposer({ disabled, agentName, onCommand }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fileToAttachment = useCallback(async (file: File): Promise<PendingAttachment | null> => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`"${file.name}" exceeds 5MB`);
      return null;
    }
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result is "data:<mime>;base64,<data>" — strip the prefix
        const commaIdx = result.indexOf(',');
        const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
        resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data, sizeBytes: file.size });
      };
      reader.onerror = () => { setError(`Could not read "${file.name}"`); resolve(null); };
      reader.readAsDataURL(file);
    });
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const out: PendingAttachment[] = [];
    for (const f of list) {
      const a = await fileToAttachment(f);
      if (a) out.push(a);
    }
    if (out.length > 0) setAttachments(prev => [...prev, ...out].slice(0, 4));
  }, [fileToAttachment]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const send = useCallback(async () => {
    if (busy || disabled) return;
    if (!text.trim() && attachments.length === 0) return;
    const parsed = parseCommand(text);
    setBusy(true);
    setError(null);
    try {
      await onCommand(parsed, attachments);
      setText('');
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, text, attachments, onCommand]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends; Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className="border-t border-mc-border bg-mc-bg-secondary/50 px-4 py-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-mc-border bg-mc-bg text-[11px]">
              <Paperclip className="w-3 h-3 text-mc-text-secondary" />
              <span className="truncate max-w-[180px]" title={a.name}>{a.name}</span>
              <span className="text-mc-text-secondary tabular-nums">({(a.sizeBytes / 1024).toFixed(0)}KB)</span>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                className="text-mc-text-secondary hover:text-mc-accent-red"
                aria-label={`Remove ${a.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-2 flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-mc-text-secondary hover:text-mc-text"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          className="p-2 rounded-lg text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary disabled:opacity-40"
          title="Attach file (image/PDF, ≤5MB, max 4)"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />

        <div className="flex-1 relative">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setShowHelp(e.target.value.startsWith('/')); }}
            onKeyDown={onKeyDown}
            disabled={disabled || busy}
            placeholder={disabled ? 'Pick an agent to start chatting…' : `Message ${agentName ?? 'agent'}…  (Enter to send · Shift+Enter newline · / for commands)`}
            rows={2}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none disabled:opacity-50"
          />
          {showHelp && (
            <div className="absolute bottom-full left-0 mb-1 w-full bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg p-2 space-y-0.5 z-10">
              {SLASH_COMMANDS.map(c => (
                <button
                  key={c.command}
                  onClick={() => { setText(c.command + ' '); setShowHelp(false); }}
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-mc-bg-tertiary flex items-center gap-3"
                >
                  <span className="font-mono text-mc-accent">{c.command}</span>
                  <span className="text-mc-text-secondary truncate">{c.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={send}
          disabled={disabled || busy || (!text.trim() && attachments.length === 0)}
          className="flex items-center gap-1.5 px-4 min-h-10 rounded-lg bg-mc-accent text-mc-bg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </button>
      </div>
    </div>
  );
}

export type { PendingAttachment };
