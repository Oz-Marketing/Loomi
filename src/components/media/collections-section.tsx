'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookmarkIcon, FunnelIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';

/**
 * Collections in the filter rail — the replacement for folders.
 *
 * Two kinds, visually distinguished because they behave differently: a static
 * collection is a list someone curated, a smart one is a saved search that keeps
 * up on its own. Conflating them would make the second look like it had gone
 * stale whenever the library moved.
 *
 * Selecting one takes over the grid, so it reads as "I'm looking at this set"
 * rather than as another filter stacked on the current view.
 */

export interface CollectionSummary {
  id: string;
  accountKey: string | null;
  name: string;
  description: string | null;
  kind: string;
  count: number;
  createdByName: string | null;
  updatedAt: string;
}

export function CollectionsSection({
  accountKey,
  selectedId,
  onSelect,
  /** Bumped by the parent when membership changes. */
  refreshKey = 0,
}: {
  accountKey: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  refreshKey?: number;
}) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (accountKey) params.set('accountKey', accountKey);
      const res = await fetch(`/api/media/collections?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections || []);
      }
    } catch {
      /* the rest of the rail still works without collections */
    }
    setLoaded(true);
  }, [accountKey]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function remove(id: string, name: string) {
    try {
      const res = await fetch(`/api/media/collections/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Worth saying explicitly: people expect deleting a container to delete
      // what's inside it, and here it doesn't.
      toast.success(`Deleted “${name}” — the assets are still in the library`);
      if (selectedId === id) onSelect(null);
      load();
    } catch {
      toast.error('Could not delete that collection');
    }
  }

  // Nothing to show and nothing saved yet — stay out of the way rather than
  // occupying rail space with an empty heading.
  if (loaded && collections.length === 0) return null;

  return (
    <div>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Collections
      </div>
      <div className="space-y-0.5">
        {collections.map((c) => {
          const active = selectedId === c.id;
          return (
            <div key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(active ? null : c.id)}
                title={c.description || undefined}
                className={`flex w-full items-start gap-2 rounded-md py-1.5 pl-2 pr-7 text-left text-xs transition-colors ${
                  active
                    ? 'bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
                    : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                {c.kind === 'smart' ? (
                  <FunnelIcon className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                ) : (
                  <BookmarkIcon className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span
                  className={`mt-0.5 shrink-0 text-[10px] tabular-nums ${
                    active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'
                  }`}
                >
                  {c.count}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(c.id, c.name)}
                title={`Delete ${c.name}`}
                className="absolute right-1 top-1.5 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
