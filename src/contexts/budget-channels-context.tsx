'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createChannelRegistry,
  EMPTY_CHANNEL_REGISTRY,
  type ChannelRecord,
  type ChannelRegistry,
} from '@/lib/budget/channel-registry';

/**
 * The budget channel list, for client components.
 *
 * The list used to be a module constant every component could import, which is
 * why it was un-editable. It's now a table, so the client has to fetch it — and
 * this context is the one place that happens, so eight components don't each
 * hold their own copy in a different state of staleness.
 *
 * LAZY. Most of the app never mentions a budget channel, and a client user
 * never sees one at all, so the provider fetches nothing until a consumer
 * actually mounts: `useBudgetChannels` asks for the list on mount, the first
 * ask triggers a single fetch, and everyone shares the result. That keeps this
 * out of the critical path for every other page while still sitting high enough
 * in the tree that any budget screen can reach it.
 *
 * Before the fetch resolves the registry is EMPTY, not the seed. A seeded
 * fallback would render confidently wrong labels for any channel someone had
 * renamed — worse than the brief "Unassigned" an empty registry gives, which is
 * the same thing these screens already show for an unplaced line. Components
 * that need to tell "loading" from "genuinely empty" read `loaded`, the way
 * they already do for `accountsLoaded`.
 */
type BudgetChannelsValue = {
  channels: ChannelRegistry;
  loaded: boolean;
  /** Re-fetch after an edit in Agency Settings. */
  refresh: () => Promise<void>;
};

const BudgetChannelsContext = createContext<
  (BudgetChannelsValue & { ensureLoaded: () => void }) | null
>(null);

export function BudgetChannelsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<ChannelRecord[] | null>(null);
  const [wanted, setWanted] = useState(false);
  // Guards against a second fetch when several consumers mount in the same
  // tick — `wanted` hasn't re-rendered yet at that point.
  const fetching = useRef(false);

  const load = useCallback(async () => {
    fetching.current = true;
    try {
      const res = await fetch('/api/budget-channels');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRecords(data.channels as ChannelRecord[]);
    } catch {
      // Deliberately quiet: a failed taxonomy fetch shows "Unassigned" labels,
      // and the screens that matter already surface their own load errors. A
      // toast here would fire on every budget page for a signed-out poll.
      setRecords([]);
    } finally {
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    if (!wanted || records != null || fetching.current) return;
    void load();
  }, [wanted, records, load]);

  const value = useMemo(
    () => ({
      channels: records ? createChannelRegistry(records) : EMPTY_CHANNEL_REGISTRY,
      loaded: records != null,
      refresh: load,
      ensureLoaded: () => setWanted(true),
    }),
    [records, load],
  );

  return (
    <BudgetChannelsContext.Provider value={value}>{children}</BudgetChannelsContext.Provider>
  );
}

/**
 * The channel registry, fetched on first use.
 *
 * Returns lookups that are safe to call immediately — an unknown key answers
 * "Unassigned" rather than throwing, exactly as it did when the list was a
 * constant. Check `loaded` before concluding that a list is empty.
 */
export function useBudgetChannels(): BudgetChannelsValue {
  const ctx = useContext(BudgetChannelsContext);
  if (!ctx) {
    throw new Error('useBudgetChannels must be used within a BudgetChannelsProvider');
  }

  const { ensureLoaded } = ctx;
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return ctx;
}
