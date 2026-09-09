'use client';

/**
 * "Save as custom block" — the email twin of the ad builder's save-as-block
 * dialog, deliberately the same shape so a designer who has saved an ad lockup
 * already knows this one.
 *
 * WHY IN PLACE AND NOT A SEPARATE BLOCK EDITOR. Connor's call: a designer
 * authors the card in a real template, sees it in context beside the masthead
 * and footer it has to sit between, and saves the selection. A dedicated block
 * canvas would mean designing a card against a blank page and discovering the
 * spacing was wrong only after inserting it somewhere.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import type { Block } from '../types';

export function SaveBlockModal({
  block,
  accountKey,
  onSaved,
  onCancel,
}: {
  /** The selected block and its children — what gets saved. */
  block: Block;
  accountKey: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [repeatPerOffer, setRepeatPerOffer] = useState(false);
  const [scope, setScope] = useState<'global' | 'account'>(accountKey ? 'account' : 'global');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const childCount = 1 + countDescendants(block);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give the block a name');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/email-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          doc: { blocks: [block] },
          repeatOver: repeatPerOffer ? 'offer' : null,
          accountKeys: scope === 'account' && accountKey ? [accountKey] : [],
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success('Saved as a custom block');
      onSaved();
    } catch (err) {
      toast.error(`Couldn't save block: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  // PORTALED TO THE BODY, deliberately. This renders from inside `EditableBlock`,
  // which sits within the canvas — a scaled, transformed container. `position:
  // fixed` inside a transformed ancestor is positioned against THAT ancestor,
  // not the viewport, so the dialog was trapped inside the email body and
  // scrolled with it. A portal is the only thing that escapes a transform.
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4 animate-modal-in" onPointerDown={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-2xl backdrop-blur-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
          <Squares2X2Icon className="h-4 w-4" />
          Save as custom block
        </h3>
        <p className="mb-4 text-xs leading-snug text-[var(--muted-foreground)]">
          Save this {block.type} and its {childCount === 1 ? 'contents' : `${childCount - 1} nested block${childCount === 2 ? '' : 's'}`} as a
          reusable block you can insert from the Custom blocks palette.
        </p>

        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. OEM offer card"
          className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />

        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Available to</label>
        <div className="mb-4 flex gap-2">
          {([
            { key: 'global' as const, label: 'All accounts' },
            { key: 'account' as const, label: 'This account' },
          ]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              disabled={opt.key === 'account' && !accountKey}
              onClick={() => setScope(opt.key)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                scope === opt.key
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* The whole reason this exists. A per-offer block is authored ONCE and
            rendered once per offer the month produced — the count is unknowable
            when the block is designed, which is why it is a repeat rather than a
            fixed number of cards. */}
        <label className="mb-5 flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] p-3 transition-colors hover:border-[var(--primary)]">
          <input
            type="checkbox"
            checked={repeatPerOffer}
            onChange={(e) => setRepeatPerOffer(e.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span className="min-w-0">
            {/* Same words as the Section panel's switch, because it is the
                same flag — two labels for one setting is how a designer ends
                up believing there are two. */}
            <span className="block text-xs font-medium text-[var(--foreground)]">Repeats for each OEM offer</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted-foreground)]">
              Blocks inside can be bound to offer data, and the block is drawn once for every offer.
              Leave off for a static block.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save block'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function countDescendants(block: Block): number {
  return (block.children ?? []).reduce((n, c) => n + 1 + countDescendants(c), 0);
}
