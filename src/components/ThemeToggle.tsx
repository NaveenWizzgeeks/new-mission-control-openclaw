'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

const STORAGE_KEY = 'mc-theme';

type Theme = 'dark' | 'light';

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') root.classList.add('theme-light');
  else root.classList.remove('theme-light');
}

interface ThemeToggleProps { collapsed?: boolean }

export function ThemeToggle({ collapsed }: ThemeToggleProps) {
  // Initial state mirrors the no-flash bootstrap in app/layout.tsx so we
  // don't flicker between server-rendered and client states.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'light') setTheme('light');
      else setTheme('dark');
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`flex items-center gap-2 rounded text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors text-xs ${
        collapsed ? 'justify-center p-2' : 'w-full px-2 py-2'
      }`}
    >
      <Icon className="w-4 h-4" />
      {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
