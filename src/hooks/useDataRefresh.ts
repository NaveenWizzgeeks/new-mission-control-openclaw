'use client';

import { useEffect } from 'react';

const EVENT_NAME = 'mc:data-refresh';

export type RefreshTopic = 'workspaces' | 'agents' | 'tasks';

export function emitRefresh(topic: RefreshTopic) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { topic } }));
}

export function useDataRefresh(topics: RefreshTopic[], onRefresh: () => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ topic: RefreshTopic }>;
      if (topics.includes(custom.detail.topic)) onRefresh();
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [topics, onRefresh]);
}
