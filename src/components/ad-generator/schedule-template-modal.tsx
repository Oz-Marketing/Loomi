'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * When a published template is offered in the library.
 *
 * The window already existed — the builder writes `doc.schedule`, and the library
 * hides a published template outside it — but you had to open the builder to set a
 * date, which is a lot of ceremony for "this one is for the August push". Same
 * field, reachable from the card.
 *
 * Saves through the schedule-only PATCH, which merges into the stored doc
 * server-side. Sending the whole doc from here would also rewrite the createdBy
 * columns, so setting a date would quietly reassign the template's author.
 */
export function ScheduleTemplateModal({
  templateId,
  name,
  status,
  schedule,
  onClose,
  onSaved,
}: {
  templateId: string;
  name: string;
  status: string;
  schedule?: { start?: string | null; end?: string | null } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [start, setStart] = useState(schedule?.start ?? '');
  const [end, setEnd] = useState(schedule?.end ?? '');
  const [busy, setBusy] = useState(false);

  const invalidRange = !!start && !!end && end < start;
  const changed = start !== (schedule?.start ?? '') || end !== (schedule?.end ?? '');

  const save = async () => {
    if (invalidRange) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: start || end ? { start: start || null, end: end || null } : null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(start || end ? 'Schedule saved' : 'Schedule cleared — live indefinitely');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(`Couldn't save the schedule: ${err instanceof Error ? err.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Schedule template</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              When &ldquo;{name}&rdquo; is offered in the library. Leave both blank to keep it live
              indefinitely.
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* A schedule only bites once the template is published, so say so rather
            than letting someone set dates and wonder why nothing changed. */}
        {status !== 'published' && (
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
            This template is a draft, so it isn&rsquo;t in the library yet. The window applies once
            you publish it.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Starts</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Ends</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
          Both dates are inclusive. A start with no end runs from that day onward.
        </p>
        {invalidRange && (
          <p className="mt-1.5 text-[11px] font-medium text-red-500">The end date is before the start date.</p>
        )}

        <div className="mt-4 flex justify-between gap-2 border-t border-[var(--border)] pt-3">
          <button
            onClick={() => {
              setStart('');
              setEnd('');
            }}
            disabled={busy || (!start && !end)}
            className="rounded-lg px-2 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || invalidRange || !changed}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
