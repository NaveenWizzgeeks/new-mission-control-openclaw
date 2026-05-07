'use client';

import { useState } from 'react';
import { Paperclip, Image as ImageIcon, FileText, X } from 'lucide-react';
import { attachmentDataUrl, type ParsedAttachment } from './parseMessage';

export function AttachmentChips({ attachments }: { attachments: ParsedAttachment[] }) {
  const [zoom, setZoom] = useState<ParsedAttachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {attachments.map((a, i) => {
          const isImage = a.mime.startsWith('image/');
          if (isImage) {
            return (
              <button
                key={i}
                onClick={() => setZoom(a)}
                title={`${a.name} · ${a.approx_size_kb}KB`}
                className="relative w-24 h-24 rounded-lg overflow-hidden border border-mc-border bg-mc-bg-tertiary hover:border-mc-accent/50 transition-colors group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachmentDataUrl(a)}
                  alt={a.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white truncate text-left">
                  <ImageIcon className="w-2.5 h-2.5 inline mr-1" />
                  {a.name}
                </div>
              </button>
            );
          }
          return (
            <div
              key={i}
              title={`${a.mime} · ${a.approx_size_kb}KB`}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-mc-border bg-mc-bg-tertiary text-xs max-w-[260px]"
            >
              <FileText className="w-3.5 h-3.5 text-mc-text-secondary shrink-0" />
              <span className="truncate text-mc-text">{a.name}</span>
              <span className="text-[10px] text-mc-text-secondary shrink-0">{a.approx_size_kb}KB</span>
            </div>
          );
        })}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentDataUrl(zoom)}
            alt={zoom.name}
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setZoom(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded bg-black/60 text-white text-xs font-mono">
            <Paperclip className="w-3 h-3 inline mr-1" />
            {zoom.name} · {zoom.mime} · {zoom.approx_size_kb}KB
          </div>
        </div>
      )}
    </>
  );
}
