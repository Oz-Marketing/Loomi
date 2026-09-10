'use client';

/**
 * The blast's name, in the builder's header, renameable in place.
 *
 * WHERE THE NAME WENT. Once you leave the create modal there is no way back to
 * it, and the builder's three steps never offered the field — so a blast
 * created as "Blast Sep 9, 2026, 10:58 PM" kept that name through send unless
 * you abandoned the flow and renamed it from the list. The name is also the
 * only thing on screen identifying WHICH blast you are editing, which makes the
 * header the right home for it.
 *
 * WHY THE LOGO CAME OUT. The header had exactly one job — say where you are —
 * and it was spending it on a logo, on a full-screen surface the user reached
 * by clicking into their own blast. There is no ambiguity about whose app this
 * is; there was real ambiguity about which blast.
 *
 * Two ways in, because people reach for both: the text is a button, and a
 * pencil appears on hover. Same edit either way.
 */
import { useEffect, useRef, useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import type { BuilderChannel } from '@/lib/messaging/blast-builder-steps';

export function BlastNameField({ id, channel }: { id: string; channel: BuilderChannel }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Blur fires when Enter moves focus away, so without this the same rename
  // goes out twice.
  const committed = useRef(false);

  // Multi-channel drafts carry an email id and hydrate from the email
  // endpoint; SMS-only drafts have their own. Same split as the step gating.
  const endpoint =
    channel === 'sms'
      ? `/api/blasts/sms/${encodeURIComponent(id)}`
      : `/api/blasts/email/${encodeURIComponent(id)}`;

  useEffect(() => {
    if (!id) return;
    let canceled = false;
    (async () => {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const data = await res.json();
        if (!canceled && typeof data?.campaign?.name === 'string') setName(data.campaign.name);
      } catch {
        // Leave it blank rather than guessing — the steps still work.
      }
    })();
    return () => {
      canceled = true;
    };
  }, [endpoint, id]);

  const commit = async () => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    // Empty or unchanged is a cancel, not a failed save. A blast with no name
    // is unfindable in the list, so blank never commits.
    if (!trimmed || trimmed === name) return;

    const previous = name;
    setName(trimmed); // optimistic: the header is the only place this shows
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
    } catch (err) {
      setName(previous);
      toast.error(`Couldn't rename: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const start = () => {
    committed.current = false;
    setDraft(name);
    setEditing(true);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          else if (e.key === 'Escape') {
            // Mark committed so the blur this causes does not save anyway.
            committed.current = true;
            setEditing(false);
          }
        }}
        aria-label="Blast name"
        className="min-w-0 flex-1 rounded-md border border-[var(--primary)] bg-[var(--background)] px-2 py-1 text-sm font-semibold text-[var(--foreground)] outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Click to rename"
      className="group/name flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--muted)]"
    >
      <span className="truncate text-sm font-semibold text-[var(--foreground)]">
        {name || 'Untitled blast'}
      </span>
      <PencilSquareIcon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover/name:opacity-100" />
    </button>
  );
}
