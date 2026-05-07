'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { Send, Paperclip, Loader2, X, AlertCircle, Image as ImageIcon, FileText, Upload } from 'lucide-react';

interface SlashCommandInfo {
  command: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommandInfo[] = [
  { command: '/new', description: 'Start a fresh session with the current agent' },
  { command: '/agent <name>', description: 'Switch to a different agent' },
  { command: '/task "<title>"', description: 'Create a task assigned to the current agent' },
  { command: '/mission <id>', description: 'Inject mission context into the next send' },
];

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const MAX_MESSAGE_CHARS = 32_000;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

interface PendingAttachment {
  name: string;
  mimeType: string;
  data: string; // base64 (no prefix)
  sizeBytes: number;
  /** Synthetic preview URL for image thumbs. Only set in the browser. */
  previewUrl?: string;
}

export interface ParsedCommand {
  kind: 'send' | 'new' | 'agent' | 'task' | 'mission';
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
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea up to 8 lines.
  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.style.height = 'auto';
    textRef.current.style.height = Math.min(textRef.current.scrollHeight, 200) + 'px';
  }, [text]);

  // Cleanup preview URLs when attachments change/unmount.
  useEffect(() => {
    return () => {
      attachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileToAttachment = useCallback(async (file: File): Promise<PendingAttachment | null> => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`"${file.name}" exceeds 5MB`);
      return null;
    }
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(',');
        const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        resolve({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data,
          sizeBytes: file.size,
          previewUrl,
        });
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
    if (out.length > 0) {
      setAttachments(prev => {
        const room = MAX_ATTACHMENTS - prev.length;
        if (room <= 0) {
          setError(`Up to ${MAX_ATTACHMENTS} attachments per message`);
          return prev;
        }
        return [...prev, ...out.slice(0, room)];
      });
    }
  }, [fileToAttachment]);

  const removeAttachment = (i: number) => {
    setAttachments(prev => {
      const next = prev.slice();
      const [removed] = next.splice(i, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the composer itself (not entering a child).
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const onPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
  }, [addFiles]);

  const send = useCallback(async () => {
    if (busy || disabled) return;
    if (!text.trim() && attachments.length === 0) return;
    if (text.length > MAX_MESSAGE_CHARS) {
      setError(`Message exceeds ${MAX_MESSAGE_CHARS.toLocaleString()} characters`);
      return;
    }
    const parsed = parseCommand(text);
    setBusy(true);
    setError(null);
    try {
      await onCommand(parsed, attachments);
      setText('');
      attachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, text, attachments, onCommand]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const charCount = text.length;
  const overLimit = charCount > MAX_MESSAGE_CHARS;

  return (
    <div
      className={`relative border-t border-mc-border bg-mc-bg-secondary/50 px-4 py-3 transition-colors ${dragOver ? 'bg-mc-accent/5' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-mc-accent/10 border-2 border-dashed border-mc-accent rounded pointer-events-none z-10">
          <div className="flex items-center gap-2 text-mc-accent text-sm font-medium">
            <Upload className="w-5 h-5" />
            Drop files to attach
          </div>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => {
            const isImage = a.mimeType.startsWith('image/');
            return (
              <div
                key={i}
                className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg border border-mc-border bg-mc-bg group"
              >
                {isImage && a.previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={a.previewUrl}
                    alt={a.name}
                    className="w-10 h-10 rounded object-cover border border-mc-border"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-mc-bg-tertiary border border-mc-border flex items-center justify-center">
                    {isImage ? <ImageIcon className="w-4 h-4 text-mc-text-secondary" /> : <FileText className="w-4 h-4 text-mc-text-secondary" />}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] truncate max-w-[160px] text-mc-text" title={a.name}>{a.name}</span>
                  <span className="text-[10px] text-mc-text-secondary tabular-nums">{(a.sizeBytes / 1024).toFixed(0)}KB</span>
                </div>
                <button
                  onClick={() => removeAttachment(i)}
                  className="p-1 rounded text-mc-text-secondary hover:text-mc-accent-red hover:bg-mc-accent-red/10"
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mb-2 flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-mc-text-secondary hover:text-mc-text"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy || attachments.length >= MAX_ATTACHMENTS}
          className="p-2 rounded-lg text-mc-text-secondary hover:text-mc-accent hover:bg-mc-bg-tertiary disabled:opacity-40 transition-colors shrink-0"
          title={attachments.length >= MAX_ATTACHMENTS ? `Max ${MAX_ATTACHMENTS} attachments` : 'Attach file (image/PDF, ≤5MB, max 4)'}
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
            ref={textRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setShowHelp(e.target.value.startsWith('/')); }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={disabled || busy}
            placeholder={disabled ? 'Pick an agent to start chatting…' : `Message ${agentName ?? 'agent'}…  (Enter to send · Shift+Enter newline · / for commands · paste images)`}
            rows={1}
            className={`w-full bg-mc-bg border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none disabled:opacity-50 ${overLimit ? 'border-mc-accent-red focus:border-mc-accent-red' : 'border-mc-border focus:border-mc-accent'}`}
            style={{ minHeight: '40px' }}
          />
          {showHelp && (
            <div className="absolute bottom-full left-0 mb-1 w-full bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg p-2 space-y-0.5 z-10">
              {SLASH_COMMANDS.map(c => (
                <button
                  key={c.command}
                  onClick={() => { setText(c.command + ' '); setShowHelp(false); textRef.current?.focus(); }}
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-mc-bg-tertiary flex items-center gap-3"
                >
                  <span className="font-mono text-mc-accent shrink-0">{c.command}</span>
                  <span className="text-mc-text-secondary truncate">{c.description}</span>
                </button>
              ))}
            </div>
          )}
          {/* Char counter (only shows when nontrivial) */}
          {charCount > MAX_MESSAGE_CHARS * 0.5 && (
            <span className={`absolute -top-5 right-1 text-[10px] tabular-nums ${overLimit ? 'text-mc-accent-red' : 'text-mc-text-secondary'}`}>
              {charCount.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
            </span>
          )}
        </div>

        <button
          onClick={send}
          disabled={disabled || busy || overLimit || (!text.trim() && attachments.length === 0)}
          className="flex items-center gap-1.5 px-4 min-h-10 rounded-lg bg-mc-accent text-mc-bg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </button>
      </div>
    </div>
  );
}

export type { PendingAttachment };
