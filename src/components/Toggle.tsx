'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * iOS-style switch. Uses padding-based knob positioning so the knob is
 * physically incapable of overflowing the track regardless of size.
 *
 * Geometry: track has p-[2px] padding, content area = (track - 4px) wide.
 * Knob fills the height (h-full square) and translates by exactly its own
 * width, snapping flush with the right edge in the on state.
 */
export function Toggle({ checked, onChange, size = 'md', disabled, ariaLabel }: ToggleProps) {
  const dims = size === 'sm'
    ? { track: 'w-8 h-[18px]', knob: 'w-[14px]', on: 'translate-x-[14px]' }
    : { track: 'w-10 h-[22px]', knob: 'w-[18px]', on: 'translate-x-[18px]' };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative shrink-0 ${dims.track} rounded-full p-[2px] transition-colors duration-150 ${
        checked ? 'bg-mc-accent' : 'bg-mc-bg-tertiary ring-1 ring-inset ring-mc-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`block ${dims.knob} aspect-square rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
          checked ? dims.on : 'translate-x-0'
        }`}
      />
    </button>
  );
}

interface ToggleRowProps {
  icon?: ReactNode;
  iconAccent?: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  variant?: 'switch' | 'check';
}

export function ToggleRow({
  icon,
  iconAccent = 'text-mc-accent',
  label,
  description,
  checked,
  onChange,
  disabled,
  variant = 'switch',
}: ToggleRowProps) {
  if (variant === 'check') {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`group w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors duration-150 ${
          checked ? 'bg-mc-accent/[0.05]' : 'bg-mc-bg/30 hover:bg-mc-bg/50'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`shrink-0 w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors duration-150 ${
            checked ? 'bg-mc-accent border-mc-accent' : 'bg-transparent border-mc-border group-hover:border-mc-text-secondary'
          }`}
        >
          {checked && <Check className="w-3 h-3 text-mc-bg" strokeWidth={3} />}
        </span>
        {icon && (
          <span className={`shrink-0 ${checked ? iconAccent : 'text-mc-text-secondary'}`}>{icon}</span>
        )}
        <div className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {description && (
            <span className="block text-xs text-mc-text-secondary mt-0.5 leading-relaxed">{description}</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`group w-full text-left flex items-center gap-3 pl-3 pr-3.5 py-2.5 rounded-lg transition-colors duration-150 ${
        checked ? 'bg-mc-accent/[0.05]' : 'bg-mc-bg/30 hover:bg-mc-bg/50'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {icon && (
        <span className={`shrink-0 ${checked ? iconAccent : 'text-mc-text-secondary'}`}>{icon}</span>
      )}
      <div className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-mc-text-secondary mt-0.5 leading-relaxed">{description}</span>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} size="sm" />
    </button>
  );
}
