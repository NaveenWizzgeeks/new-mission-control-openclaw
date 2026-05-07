'use client';

import { useState, useCallback, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface MessageMarkdownProps {
  text: string;
}

/**
 * Renders chat messages as Markdown with GitHub-flavored extensions
 * (tables, task lists, autolinks) and syntax-highlighted code blocks.
 *
 * Code blocks get a header bar with the detected language + copy button.
 * Inline code is rendered inline. Links open in a new tab with a small icon.
 */
export function MessageMarkdown({ text }: MessageMarkdownProps) {
  if (!text || !text.trim()) return null;

  return (
    <div className="markdown-body text-sm text-mc-text leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // Headings
          h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-2 text-mc-text">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5 text-mc-text">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mt-2.5 mb-1 text-mc-text">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-mc-text">{children}</h4>,
          // Paragraphs + lists
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-mc-accent/40 pl-3 my-2 text-mc-text-secondary italic">
              {children}
            </blockquote>
          ),
          // Tables
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-mc-border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-mc-bg-tertiary">{children}</thead>,
          th: ({ children }) => <th className="text-left px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-mc-text-secondary border-b border-mc-border">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1.5 border-t border-mc-border align-top">{children}</td>,
          // Links
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-mc-accent hover:underline inline-flex items-center gap-0.5"
            >
              {children}
              <ExternalLink className="w-2.5 h-2.5 inline-block" />
            </a>
          ),
          // Inline + block code
          code: ({ inline, className, children, ...props }: CodeProps) => {
            const lang = /language-(\w+)/.exec(className || '')?.[1];
            if (inline || !lang) {
              return (
                <code className="px-1 py-0.5 rounded bg-mc-bg-tertiary text-mc-accent-yellow font-mono text-[12px]" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock lang={lang} className={className}>{children}</CodeBlock>;
          },
          pre: ({ children }) => <>{children}</>, // We handle pre inside CodeBlock
          // Horizontal rule
          hr: () => <hr className="my-3 border-mc-border" />,
          // Bold / italic
          strong: ({ children }) => <strong className="font-semibold text-mc-text">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

interface CodeProps extends ComponentPropsWithoutRef<'code'> {
  inline?: boolean;
  children?: ReactNode;
}

function CodeBlock({ lang, className, children }: { lang: string; className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = childrenToText(children);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <div className="my-2 rounded-lg border border-mc-border overflow-hidden bg-mc-bg-tertiary">
      <div className="flex items-center justify-between px-3 py-1 bg-mc-bg-secondary border-b border-mc-border">
        <span className="text-[10px] uppercase tracking-wider text-mc-text-secondary font-mono">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-mc-text-secondary hover:text-mc-text transition-colors"
          aria-label="Copy code"
        >
          {copied
            ? <><Check className="w-3 h-3 text-mc-accent-green" /> Copied</>
            : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-snug font-mono">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function childrenToText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return childrenToText(props?.children);
  }
  return '';
}
