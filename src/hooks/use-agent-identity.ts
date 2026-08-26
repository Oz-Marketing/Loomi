'use client';

/**
 * A specialist's display identity, refined by whatever a manager has saved.
 *
 * Starts from the identity compiled into the registry and overlays the stored
 * name, face and accent once the roster loads. That order matters: the panel
 * header renders before any request completes, and an agent whose name pops in a
 * beat late looks broken. The code identity is a correct answer immediately; the
 * stored one is a better answer shortly after.
 *
 * Fetched once per mount and shared through a module-level cache, because the
 * bubble, the teaser and the in-page CTA all ask the same question on the same
 * page and there is no reason to answer it three times.
 */

import { useEffect, useState } from 'react';
import { agentIdentity, type AgentIdentity, type AgentKey } from '@/lib/ai/specialists/identity';

interface RosterEntry {
  key: string;
  name: string;
  portraitUrl: string | null;
  accent: string;
}

let cache: Map<string, RosterEntry> | null = null;
let inFlight: Promise<Map<string, RosterEntry>> | null = null;

async function loadRoster(): Promise<Map<string, RosterEntry>> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((data: { agents?: RosterEntry[] }) => {
        cache = new Map((data.agents ?? []).map((a) => [a.key, a]));
        return cache;
      })
      .catch(() => new Map<string, RosterEntry>())
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Call after saving a profile so open panels pick up the new name or face. */
export function invalidateAgentIdentities(): void {
  cache = null;
}

export function useAgentIdentity(key: AgentKey): AgentIdentity {
  const base = agentIdentity(key);
  const [identity, setIdentity] = useState<AgentIdentity>(base);

  useEffect(() => {
    let live = true;
    setIdentity(agentIdentity(key));
    void loadRoster().then((roster) => {
      const stored = roster.get(key);
      if (!live || !stored) return;
      setIdentity({
        ...agentIdentity(key),
        name: stored.name,
        portraitUrl: stored.portraitUrl ?? undefined,
        accent: stored.accent,
      });
    });
    return () => {
      live = false;
    };
  }, [key]);

  return identity;
}
