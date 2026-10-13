'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Checkbox } from '@/components/ui/checkbox';

export interface LinkedCopy {
  id: string;
  accountKey: string | null;
  upToDate: boolean;
  canPush: boolean;
}

/**
 * Push an original segment's saved changes to the copies "Also create in…"
 * made in other accounts.
 *
 * Opens pre-ticked on the copies that are out of date and pushable, so the
 * common case — "I just changed it, update the others" — is one click.
 * Up-to-date copies stay listed so the user can see the whole spread.
 */
export function PushCopiesModal({
  segmentName,
  copies,
  accountLabel,
  hasUnsavedChanges,
  justSaved,
  onPush,
  onClose,
}: {
  segmentName: string;
  copies: LinkedCopy[];
  accountLabel: (accountKey: string | null) => string;
  /** The editor holds edits that aren't saved. Only the SAVED segment is
   *  pushed, so pushing now would send the old version. */
  hasUnsavedChanges: boolean;
  /** Opened straight after a save, so the dismiss button reads "Not now". */
  justSaved: boolean;
  /** Resolves true when the push landed. */
  onPush: (copyIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    copies.filter((c) => c.canPush && !c.upToDate).map((c) => c.id),
  );
  const [pushing, setPushing] = useState(false);

  const outOfDate = copies.filter((c) => !c.upToDate).length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  async function handlePush() {
    setPushing(true);
    try {
      if (await onPush(selected)) onClose();
    } finally {
      setPushing(false);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="animate-modal-in flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">
              {justSaved ? 'Saved. Update the copies too?' : 'Push changes to copies'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {outOfDate === 0
                ? <>Every copy of &ldquo;{segmentName}&rdquo; already matches this one.</>
                : <>
                    {outOfDate} of {copies.length} cop{copies.length === 1 ? 'y' : 'ies'} of
                    &ldquo;{segmentName}&rdquo; {outOfDate === 1 ? 'differs' : 'differ'} from this
                    one. Pushing replaces their name, description and filter with this
                    segment&apos;s, including any edits made in those accounts.
                  </>}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {hasUnsavedChanges && (
          <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
            You have unsaved changes. Only the saved segment is pushed, so save first.
          </p>
        )}

        <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {copies.map((copy) => (
            <li
              key={copy.id}
              className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--muted)]/50"
            >
              <Checkbox
                size="sm"
                checked={selected.includes(copy.id)}
                onChange={(on) => toggle(copy.id, on)}
                disabled={!copy.canPush || hasUnsavedChanges}
                label={accountLabel(copy.accountKey)}
                className="min-w-0 text-xs text-[var(--foreground)]"
              />
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  !copy.canPush
                    ? 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                    : copy.upToDate
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-amber-500/10 text-amber-500'
                }`}
              >
                {!copy.canPush ? 'No access' : copy.upToDate ? 'Up to date' : 'Out of date'}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition-colors hover:bg-[var(--sidebar-muted)]"
          >
            {justSaved ? 'Not now' : 'Cancel'}
          </button>
          <button
            onClick={handlePush}
            disabled={pushing || selected.length === 0 || hasUnsavedChanges}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pushing
              ? 'Pushing…'
              : `Push to ${selected.length} account${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
