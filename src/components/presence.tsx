'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { uiAuthHeaders } from '@/lib/client-auth';
import type { Light, Lights } from '@/lib/presence';

const empty: Lights = { sessions: {}, tasks: {} };
const Presence = createContext(empty);

/** One lightweight poll per page, independent of task drafts and the transcript. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [lights, setLights] = useState(empty);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const res = await fetch('/api/v1/presence', {
          headers: uiAuthHeaders(),
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw Error('Unavailable');
        const data: Lights = await res.json();
        if (active) {
          setLights(data);
          setUnavailable(false);
        }
      } catch {
        if (active) {
          setLights(empty);
          setUnavailable(true);
        }
      } finally {
        if (active) timer = setTimeout(refresh, 10_000);
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <Presence.Provider value={lights}>
      {unavailable && (
        <p role="status" className="text-center text-xs text-amber-700">
          Live sync status unavailable
        </p>
      )}
      {children}
    </Presence.Provider>
  );
}

export function useLights() {
  return useContext(Presence);
}
export function PresenceLight({ state, task = false }: { state?: Light; task?: boolean }) {
  if (!state) return null;
  const label =
    state === 'mixed'
      ? 'Live sessions and sync problems'
      : state === 'problem'
        ? 'Out of sync or heartbeat lost'
        : 'Live and in sync';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`pcp-light ${state === 'problem' ? 'pcp-problem' : task ? 'pcp-task-live' : 'pcp-session-live'}`}
    />
  );
}
