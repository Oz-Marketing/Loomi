'use client';

// Paginated contact-selection picker used by the campaign-recipients
// "Contacts" tabs (email, SMS, and multi-channel). Caller owns the
// selection + pagination state so toggling between tabs preserves
// selection; the component is a pure render + interaction surface.
//
// Channel-specific behaviour is driven by the `isDeliverable` predicate:
//   - email campaigns pass a valid-email check
//   - SMS campaigns pass a dialable-phone check
//   - multi-channel (unified) passes "has either"; per-row badges show
//     which channels will actually fire for each contact
//
// Contacts that fail isDeliverable are excluded from selection — they
// don't appear in the table at all — so the count in the header stays
// truthful and the user can't accidentally "select" recipients the send
// pipeline will silently drop.

import { useMemo } from 'react';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import type { Contact } from '@/lib/contacts/types';

export const CONTACTS_PICKER_PAGE_SIZE = 50;

/** Per-channel reach badge displayed next to each contact row. */
export interface ContactReachIndicator {
  /** Short label shown in the header above the column. */
  label: string;
  /** Icon — keep to outline heroicons for visual consistency. */
  icon: React.ComponentType<{ className?: string }>;
  /** Predicate returning true when this channel can reach the contact. */
  check: (contact: Contact) => boolean;
}

export interface ContactsPickerProps {
  contacts: Contact[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /**
   * Predicate determining whether a contact is selectable. Failing
   * contacts are filtered out of the picker entirely.
   */
  isDeliverable: (contact: Contact) => boolean;
  /**
   * Optional per-row reach badges. Multi-channel passes [email, sms]
   * so the user can see which channels will fire for each contact.
   * Single-channel pages typically omit this.
   */
  reachIndicators?: ContactReachIndicator[];
  /**
   * Copy shown in the empty state when zero contacts pass the
   * deliverability filter. Defaults to "deliverable contacts".
   */
  emptyNoun?: string;
}

export function ContactsPicker({
  contacts,
  loading,
  search,
  onSearchChange,
  page,
  onPageChange,
  selectedIds,
  onSelectionChange,
  isDeliverable,
  reachIndicators,
  emptyNoun = 'deliverable contacts',
}: ContactsPickerProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const deliverable = useMemo(
    () => contacts.filter((c) => Boolean(c.id) && isDeliverable(c)),
    [contacts, isDeliverable],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return deliverable;
    return deliverable.filter((c) => {
      const hay = `${c.fullName || ''} ${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [deliverable, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CONTACTS_PICKER_PAGE_SIZE));
  // Clamp the page to bounds. Filter changes can leave `page` past the
  // end of the array; we compute the visible window from the clamped
  // value so we never slice past the end.
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * CONTACTS_PICKER_PAGE_SIZE;
  const visible = filtered.slice(start, start + CONTACTS_PICKER_PAGE_SIZE);

  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  function toggleOne(id: string) {
    if (selectedSet.has(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }

  function togglePage() {
    if (allVisibleSelected) {
      const drop = new Set(visibleIds);
      onSelectionChange(selectedIds.filter((id) => !drop.has(id)));
    } else {
      const next = new Set(selectedIds);
      for (const id of visibleIds) next.add(id);
      onSelectionChange(Array.from(next));
    }
  }

  function selectAllMatching() {
    const next = new Set(selectedIds);
    for (const c of filtered) next.add(c.id);
    onSelectionChange(Array.from(next));
  }

  function clearSelection() {
    onSelectionChange([]);
  }

  if (loading) {
    return (
      <div className="py-10 text-center">
        <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
        <p className="text-xs text-[var(--muted-foreground)] mt-2">Loading contacts…</p>
      </div>
    );
  }

  if (deliverable.length === 0) {
    return (
      <div className="py-10 text-center border border-dashed border-[var(--border)] rounded-xl">
        <UserGroupIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
        <p className="text-sm font-medium">No {emptyNoun} in this account</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
          Import contacts on the Contacts page, then come back to pick recipients here.
        </p>
      </div>
    );
  }

  // Grid template builds: checkbox | name | email | (reach badges...).
  // We compose dynamically so reach-less consumers don't pay for empty
  // columns and multi-channel can show both badges side by side.
  const gridTemplate = reachIndicators && reachIndicators.length > 0
    ? `36px minmax(0, 1fr) minmax(0, 1.4fr) repeat(${reachIndicators.length}, 60px)`
    : '36px minmax(0, 1fr) minmax(0, 1.4fr)';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          />
        </div>
        <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          {selectedIds.length.toLocaleString()} selected · {filtered.length.toLocaleString()} {filtered.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {(selectedIds.length > 0 || filtered.length > visibleIds.length) && (
        <div className="flex items-center gap-2 text-xs">
          {filtered.length > visibleIds.length && (
            <button
              type="button"
              onClick={selectAllMatching}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/40"
            >
              Select all {filtered.length.toLocaleString()}{search.trim() ? ' matching' : ''}
            </button>
          )}
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="px-2.5 py-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      <div className="border border-[var(--border)] rounded-xl overflow-hidden">
        <div
          className="grid items-center px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <label className="flex items-center justify-center cursor-pointer">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={togglePage}
              aria-label="Select all on this page"
              className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]/30"
            />
          </label>
          <span>Name</span>
          <span>Email</span>
          {reachIndicators?.map((ind) => (
            <span key={ind.label} className="text-center">{ind.label}</span>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">
            No contacts match this search.
          </div>
        ) : (
          <ul>
            {visible.map((c) => {
              const checked = selectedSet.has(c.id);
              const displayName =
                c.fullName?.trim() ||
                [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
                '—';
              return (
                <li
                  key={c.id}
                  className={`grid items-center px-3 py-2 border-b border-[var(--border)] last:border-b-0 text-sm transition-colors ${
                    checked ? 'bg-[var(--primary)]/[0.04]' : 'hover:bg-[var(--muted)]/30'
                  }`}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <label className="flex items-center justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(c.id)}
                      aria-label={`Select ${displayName || c.email}`}
                      className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]/30"
                    />
                  </label>
                  <span className="truncate">{displayName}</span>
                  <span className="truncate text-[var(--muted-foreground)]">{c.email || '—'}</span>
                  {reachIndicators?.map((ind) => {
                    const reachable = ind.check(c);
                    const Icon = ind.icon;
                    return (
                      <span key={ind.label} className="flex justify-center">
                        <Icon
                          className={`w-4 h-4 ${reachable ? 'text-emerald-400' : 'text-[var(--muted-foreground)]/30'}`}
                          aria-label={`${ind.label}: ${reachable ? 'reachable' : 'not reachable'}`}
                        />
                      </span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--muted-foreground)]">
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--border)] hover:border-[var(--primary)]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--border)] hover:border-[var(--primary)]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Convenience reach indicators for the multi-channel picker — both icons
// pre-bound to their check functions. Single-channel callers don't need
// these; the email/SMS picker just hides the column entirely.
export const EMAIL_REACH_INDICATOR: Omit<ContactReachIndicator, 'check'> = {
  label: 'Email',
  icon: EnvelopeIcon,
};

export const SMS_REACH_INDICATOR: Omit<ContactReachIndicator, 'check'> = {
  label: 'SMS',
  icon: PhoneIcon,
};
