'use client';

/**
 * A person's saved threads with one agent — the list, rename and delete.
 *
 * Overlays the conversation rather than sitting beside it: the panel is 24rem
 * wide, and a permanent sidebar inside it would leave neither the list nor the
 * conversation enough room to be readable.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

/** "3m", "2h", "5d" — enough to order them, short enough for a 24rem panel. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function AgentConversations({
  agentKey,
  activeId,
  onOpen,
  onNew,
  onClose,
  /** Told when the ACTIVE thread is deleted, so the panel can clear itself. */
  onActiveDeleted,
  variant = 'overlay',
}: {
  agentKey: string;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onActiveDeleted: () => void;
  /**
   * 'overlay' covers the thread — the only option at 24rem. 'inline' is a real
   * column beside it, which is what full-screen has room for.
   */
  variant?: 'overlay' | 'inline';
}) {
  /**
   * Renaming and deleting live in the EXPANDED view only.
   *
   * Docked, this is a 24rem overlay you flick open to switch threads — putting
   * destructive controls a few pixels from the row you meant to tap is how people
   * lose a conversation they wanted. Expanded, the list is a proper rail with room
   * for the affordances and the deliberation to match.
   */
  const manageable = variant === 'inline';

  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentKey}/conversations`);
      if (!res.ok) throw new Error('Could not load conversations');
      const data = await res.json();
      setItems(data.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversations');
      setItems([]);
    }
  }, [agentKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rename(id: string) {
    const title = draftTitle.trim();
    setEditingId(null);
    if (!title) return;
    // Optimistic: the rename is the user's own words and near-certain to succeed;
    // reloading afterwards would make a one-character fix feel like a round trip.
    setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, title } : c)) ?? prev);
    try {
      await fetch(`/api/agents/${agentKey}/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      void load();
    }
  }

  async function remove(id: string) {
    setItems((prev) => prev?.filter((c) => c.id !== id) ?? prev);
    try {
      await fetch(`/api/agents/${agentKey}/conversations/${id}`, { method: 'DELETE' });
      if (id === activeId) onActiveDeleted();
    } catch {
      void load();
    }
  }

  return (
    <div
      className={
        variant === 'inline'
          ? // A floating card inside the modal rather than a flush column: it
            // matches the page card and the thread beside it, so the modal reads
            // as Loomi chrome instead of a split pane with a divider down it.
            'my-3 ml-3 flex w-64 flex-shrink-0 flex-col overflow-hidden rounded-2xl ' +
            'ai-assist-chrome border border-[var(--border)]'
          : // z-[1], not z-10: the panel's rainbow ring is a ::before at z-index 2,
            // and anything above that clips the ring down the sides. Above the
            // thread content (which has no z-index) is all this needs to be.
            'absolute inset-0 z-[1] flex flex-col bg-[var(--ai-assist-thread-bg)]'
      }
    >
      {/* Only the inline rail carries a header. As an overlay this sits directly
          under the panel's OWN header, which already has New and the History
          toggle that opened it — a second "Conversations / New / ✕" bar two rows
          below the first was pure duplication in a 24rem column. */}
      {variant === 'inline' && (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <span className="text-xs font-semibold text-[var(--foreground)]">Conversations</span>
          <button
            type="button"
            onClick={onNew}
            title="New conversation"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3.5 w-3.5" /> New
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {items === null && (
          <p className="px-2 py-4 text-center text-[10px] text-[var(--muted-foreground)]">
            Loading…
          </p>
        )}
        {items?.length === 0 && (
          <p className="px-2 py-6 text-center text-[10px] text-[var(--muted-foreground)]">
            {error || 'No saved conversations yet. Ask something and it will appear here.'}
          </p>
        )}
        {items?.map((c) => (
          <div
            key={c.id}
            className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
              c.id === activeId ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]'
            }`}
          >
            {manageable && editingId === c.id ? (
              <>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename(c.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-0.5 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={() => void rename(c.id)}
                  aria-label="Save name"
                  className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <CheckIcon className="h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[11px] text-[var(--foreground)]">
                    {c.title}
                  </span>
                  <span className="block text-[9px] text-[var(--muted-foreground)]">
                    {c.messageCount} message{c.messageCount === 1 ? '' : 's'} · {ago(c.updatedAt)}
                  </span>
                </button>
                {manageable && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setDraftTitle(c.title);
                  }}
                  aria-label={`Rename ${c.title}`}
                  className="rounded p-1 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--foreground)] group-hover:opacity-100 focus:opacity-100"
                >
                  <PencilIcon className="h-3 w-3" />
                </button>
                )}
                {manageable && (
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label={`Delete ${c.title}`}
                  className="rounded p-1 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--destructive)] group-hover:opacity-100 focus:opacity-100"
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
