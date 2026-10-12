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
 * pencil sits beside it. Same edit either way. The pencil used to appear only
 * on hover, and nobody found it — renaming read as "only possible in the
 * create modal".
 *
 * TWO PLACEMENTS, ONE NAME. The same field renders in the header and as each
 * step's page title (`variant="title"`). A rename in either broadcasts
 * BLAST_RENAMED_EVENT so the other updates without a refetch.
 */
import { useEffect, useRef, useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import type { BuilderChannel } from '@/lib/messaging/blast-builder-steps';
import { renameBlast } from '@/lib/messaging/blast-list-actions';

export const BLAST_RENAMED_EVENT = 'loomi:blast-renamed';

type BlastRenamedDetail = { id: string; name: string };

export function BlastNameField({
  id,
  channel,
  variant = 'header',
  initialName,
}: {
  id: string;
  channel: BuilderChannel;
  variant?: 'header' | 'title';
  /** The step page already holds the draft; pass its name to skip a fetch. */
  initialName?: string;
}) {
  const [name, setName] = useState(initialName ?? '');
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
    if (initialName !== undefined) setName(initialName);
  }, [initialName]);

  useEffect(() => {
    const onRenamed = (e: Event) => {
      const detail = (e as CustomEvent<BlastRenamedDetail>).detail;
      if (detail?.id === id) setName(detail.name);
    };
    window.addEventListener(BLAST_RENAMED_EVENT, onRenamed);
    return () => window.removeEventListener(BLAST_RENAMED_EVENT, onRenamed);
  }, [id]);

  const announce = (next: string) => {
    window.dispatchEvent(
      new CustomEvent<BlastRenamedDetail>(BLAST_RENAMED_EVENT, { detail: { id, name: next } }),
    );
  };

  useEffect(() => {
    if (!id || initialName !== undefined) return;
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
    // initialName is only checked to skip the fetch, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setName(trimmed);
    announce(trimmed);
    try {
      // An Email + Text blast is two rows; both take the new name (the server
      // doesn't cascade names), or the text keeps the old one wherever it shows.
      const { partnerError } = await renameBlast(channel, id, trimmed);
      if (partnerError) toast.error(partnerError);
    } catch (err) {
      setName(previous);
      announce(previous);
      toast.error(`Couldn't rename: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const start = () => {
    committed.current = false;
    setDraft(name);
    setEditing(true);
  };

  const isTitle = variant === 'title';
  const textSize = isTitle ? 'text-2xl font-bold' : 'text-sm font-semibold';

  if (editing) {
    return (
      <input
        autoFocus
        // Renaming usually means replacing, so start with it all selected.
        onFocus={(e) => e.currentTarget.select()}
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
        className={`min-w-0 rounded-md border border-[var(--primary)] bg-[var(--background)] px-2 py-1 ${textSize} text-[var(--foreground)] outline-none ${
          isTitle ? '-mx-2 w-full max-w-xl' : 'flex-1'
        }`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Click to rename"
      aria-label={`Rename blast${name ? ` "${name}"` : ''}`}
      className={`group/name flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--muted)] ${
        isTitle ? '-mx-2 max-w-full' : ''
      }`}
    >
      <span className={`truncate ${textSize} text-[var(--foreground)]`}>
        {name || (isTitle ? 'Blast' : 'Untitled blast')}
      </span>
      <PencilSquareIcon
        className={`flex-shrink-0 text-[var(--muted-foreground)] opacity-60 transition-opacity group-hover/name:opacity-100 ${
          isTitle ? 'h-4.5 w-4.5' : 'h-3.5 w-3.5'
        }`}
      />
    </button>
  );
}
