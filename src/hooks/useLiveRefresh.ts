'use client';

import { useEffect } from 'react';

/**
 * Subscribe to a set of live `mc:*` window events and call `onChange` when
 * any of them fire. Used by dashboard/workspace cards that fetch data from
 * an API and need to re-fetch when something on the server changes.
 *
 * The events come from useSSE.ts which re-emits server SSE events as
 * window CustomEvents under the `mc:` prefix. Centralising the list here
 * keeps every card consistent — when we add a new event type that should
 * cause UI refresh, we add it once and every subscriber benefits.
 */
const DEFAULT_EVENTS = [
  'mc:convoy_progress',
  'mc:convoy_completed',
  'mc:convoy_created',
  'mc:mission_stage_changed',
  'mc:task_updated',
  'mc:task_created',
  'mc:task_deleted',
];

export function useLiveRefresh(onChange: () => void, extraEvents: string[] = []) {
  useEffect(() => {
    const events = [...DEFAULT_EVENTS, ...extraEvents];
    const handler = () => onChange();
    for (const ev of events) window.addEventListener(ev, handler);
    return () => {
      for (const ev of events) window.removeEventListener(ev, handler);
    };
  }, [onChange, extraEvents]);
}
