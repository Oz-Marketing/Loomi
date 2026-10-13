'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpTip } from '@/components/ui/help-tip';
import { AccountAccessPicker } from '@/components/ad-generator/account-access-picker';

export interface LinkedCopy {
  id: string;
  accountKey: string | null;
  upToDate: boolean;
  canPush: boolean;
}

/**
 * Every way a segment reaches other accounts, in one place.
 *
 * There are two, and they behave differently, which is exactly why they sit
 * side by side here rather than as separate controls in the header:
 *
 *  - GROUP: one segment, shown read-only to the accounts beneath its group.
 *    Edits reach them the moment they are saved.
 *  - COPIES: separate segments in other accounts, made by "Also create in…".
 *    Each account can change its own; the original's edits reach them only
 *    when pushed.
 */
export function SegmentSharingModal({
  segmentName,
  focus,
  group,
  create,
  copies,
  source,
  accountLabel,
  onClose,
}: {
  segmentName: string;
  /** 'after-save' opens straight after a save to offer the push, so only
   *  the copies are shown and dismissing reads "Not now". */
  focus: 'all' | 'after-save';
  /** Present when the owning account is a group. */
  group: {
    ownerName: string;
    childCount: number;
    shared: boolean;
    onChange: (shared: boolean) => void;
    /** Why sharing down is unavailable right now, if it is. */
    disabledReason?: string;
  } | null;
  /** Present on a new segment: accounts to also create it in. */
  create: {
    ownerKey: string | null;
    selected: string[];
    onChange: (keys: string[]) => void;
  } | null;
  /** Present on an existing original. */
  copies: {
    list: LinkedCopy[];
    /** Only the SAVED segment is pushed. */
    hasUnsavedChanges: boolean;
    /** Resolves true when the push landed. */
    onPush: (copyIds: string[]) => Promise<boolean>;
  } | null;
  /** Present when this segment is itself a copy. */
  source: { name: string | null; accountName: string | null } | null;
  accountLabel: (accountKey: string | null) => string;
  onClose: () => void;
}) {
  const afterSave = focus === 'after-save';

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="animate-modal-in flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">
              {afterSave ? 'Saved. Update the copies too?' : 'Sharing'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
              &ldquo;{segmentName}&rdquo;
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {group && !afterSave && (
            <Section
              title="Group"
              help={
                <>
                  Shared with the group, every account under {group.ownerName} sees this one
                  segment, read-only, and your saved edits reach them straight away. It
                  resolves to each account&apos;s own contacts. They can duplicate it to make a
                  version they can change.
                </>
              }
            >
              <Checkbox
                size="sm"
                checked={group.shared && !group.disabledReason}
                onChange={group.onChange}
                disabled={!!group.disabledReason}
                label={`Share with the ${group.childCount} account${group.childCount === 1 ? '' : 's'} under ${group.ownerName}`}
                className="text-xs text-[var(--foreground)]"
              />
              {group.disabledReason && (
                <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">{group.disabledReason}</p>
              )}
            </Section>
          )}

          {source && !afterSave && (
            <Section title="Copied from">
              <p className="text-xs text-[var(--foreground)]">
                {source.name ? <>&ldquo;{source.name}&rdquo; in </> : 'A segment in '}
                {source.accountName ?? 'another account'}
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                You can change it here, but changes pushed from the original replace its name,
                description and filter.
              </p>
            </Section>
          )}

          {create && (
            <Section
              title="Also create in other accounts"
              help={
                <>
                  Makes a separate copy in each account you pick, so each one can change
                  theirs. The copies stay linked to this one, and when you change it you can
                  push the changes to them.
                </>
              }
            >
              <AccountAccessPicker
                ownerKey={create.ownerKey}
                selected={create.selected}
                onChange={create.onChange}
              />
            </Section>
          )}

          {copies && (copies.list.length > 0 || !afterSave) && (
            <CopiesSection
              copies={copies}
              accountLabel={accountLabel}
              afterSave={afterSave}
              onPushed={afterSave ? onClose : undefined}
            />
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className={
              afterSave
                ? 'rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition-colors hover:bg-[var(--sidebar-muted)]'
                : 'rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90'
            }
          >
            {afterSave ? 'Not now' : 'Done'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
        </h3>
        {help && (
          <HelpTip title={title} iconClassName="w-3 h-3">
            {help}
          </HelpTip>
        )}
      </div>
      {children}
    </section>
  );
}

function CopiesSection({
  copies,
  accountLabel,
  afterSave,
  onPushed,
}: {
  copies: NonNullable<Parameters<typeof SegmentSharingModal>[0]['copies']>;
  accountLabel: (accountKey: string | null) => string;
  afterSave: boolean;
  onPushed?: () => void;
}) {
  const { list, hasUnsavedChanges, onPush } = copies;
  // Pre-ticked on what needs it, so "I just changed it, update the others"
  // is one click. Up-to-date copies stay listed to show the whole spread.
  const [selected, setSelected] = useState<string[]>(() =>
    list.filter((c) => c.canPush && !c.upToDate).map((c) => c.id),
  );
  const [pushing, setPushing] = useState(false);
  const blocked = hasUnsavedChanges && !afterSave;

  async function handlePush() {
    setPushing(true);
    try {
      if (await onPush(selected)) {
        setSelected([]);
        onPushed?.();
      }
    } finally {
      setPushing(false);
    }
  }

  return (
    <Section
      title="Copies in other accounts"
      help={
        <>
          Separate segments made when this one was created in several accounts at once. Each
          account can change its own. Your edits reach them only when you push, which replaces
          their name, description and filter, including edits made there.
        </>
      }
    >
      {list.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          No copies. Copies are made when a new segment is also created in other accounts.
        </p>
      ) : (
        <>
          {blocked && (
            <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
              You have unsaved changes. Only the saved segment is pushed, so save first.
            </p>
          )}
          <ul className="-mx-1 space-y-0.5">
            {list.map((copy) => (
              <li
                key={copy.id}
                className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--muted)]/50"
              >
                <Checkbox
                  size="sm"
                  checked={selected.includes(copy.id)}
                  onChange={(on) =>
                    setSelected((prev) => (on ? [...prev, copy.id] : prev.filter((x) => x !== copy.id)))
                  }
                  disabled={!copy.canPush || blocked}
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
          <div className="mt-2 flex justify-end">
            <button
              onClick={handlePush}
              disabled={pushing || selected.length === 0 || blocked}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushing
                ? 'Pushing…'
                : `Push changes to ${selected.length} account${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
