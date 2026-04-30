'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface SidebarSectionProps {
  title: string;
  storageKey: string;
  icon: React.ReactNode;
  count?: number | string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarSection({
  title,
  storageKey,
  icon,
  count,
  defaultOpen = false,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === '1') setOpen(true);
    else if (stored === '0') setOpen(false);
  }, [storageKey]);

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      window.localStorage.setItem(storageKey, next ? '1' : '0');
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 px-2 py-1.5 rounded text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors text-xs uppercase tracking-wider"
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] font-mono normal-case tracking-normal text-mc-text-secondary">
            {count}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="mt-1 mb-2">{children}</div>}
    </div>
  );
}
