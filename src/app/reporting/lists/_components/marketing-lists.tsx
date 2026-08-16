'use client';

/**
 * Marketing Lists — port of Oz Dealer Tools' `reports/marketing-lists`.
 *
 * ── THESE ARE STUDIO'S SEGMENTS, NOT A COPY OF THEM ─────────────────────────
 * The whole point of this page is that it is the SAME thing Studio calls a
 * segment: the same `Audience` rows, read through the same `/api/audiences`,
 * sized with the same `evaluateFilter` against the same field set, and edited
 * with the same `FilterBuilder`. A list created here appears in Studio and vice
 * versa, immediately, because there is nothing to synchronise — there is one
 * record.
 *
 * Building a Reporting-specific list model would have been faster and would
 * have been wrong: two definitions of "customers due for service" drift within
 * a month, and the first symptom is a mail file that doesn't match the count
 * the rep quoted.
 *
 * ── WHY SIZES ARE COMPUTED IN THE BROWSER ───────────────────────────────────
 * `evaluateFilter` is an in-memory engine — it filters an array of contacts and
 * has no SQL translation. Sizing server-side would mean writing that
 * translation, which is a second implementation of every operator, and its
 * first bug would be a size here disagreeing with the same segment in Studio.
 * So this fetches the account's contacts once and evaluates every list against
 * that one array, exactly as Studio's segments page does.
 *
 * The cost is a full contact fetch. That is the same cost Studio already pays
 * on its segments page, so this introduces no new load pattern — but it is the
 * reason the page asks for one account rather than a group.
 *
 * ── CLIENTS CAN CREATE LISTS ────────────────────────────────────────────────
 * This is the first writable surface in Reporting. `POST /api/audiences`
 * already scope-checks (a non-developer may only write to an account they are
 * assigned), so a client can create a list for their own store and cannot
 * create one for anyone else's. Editing is deliberately limited to lists
 * belonging to a single account — the shared, account-less lists Oz maintains
 * across the book are read-only here, because a client editing one would
 * silently change every other dealer's list too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FunnelIcon,
  PlusIcon,
  UsersIcon,
  PencilSquareIcon,
  LockClosedIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import type { Contact } from '@/lib/contacts/types';
import { FilterBuilder } from '@/components/contacts/filter-builder';
import { Section, Muted, EmptyState, LoadingState, num } from '../../ads/_components/shared';

interface SavedList {
  id: string;
  name: string;
  description?: string | null;
  filters: string;
  accountKey?: string | null;
}

function parseDefinition(raw: string): FilterDefinition | null {
  try {
    const parsed = JSON.parse(raw) as FilterDefinition;
    if (parsed.version !== 1 || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function MarketingLists({ accountKey }: { accountKey: string }) {
  const { accountData } = useAccount();
  const { fields } = useFilterableFields(accountKey);

  const [lists, setLists] = useState<SavedList[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SavedList | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    const res = await fetch('/api/audiences');
    if (!res.ok) return [] as SavedList[];
    const data = await res.json();
    return Array.isArray(data?.audiences) ? (data.audiences as SavedList[]) : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Seed the lifecycle presets the same way Studio's segments page does —
      // idempotent server-side, and it's what makes ODT's fixed service buckets
      // (Early Reminder, FLF, Lost Souls…) exist as real, editable lists rather
      // than hardcoded SQL nobody can adjust.
      if ((accountData?.category ?? '').trim().toLowerCase() === 'automotive') {
        await fetch('/api/audiences/seed-lifecycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountKey }),
        }).catch(() => undefined);
      }

      const [all, contactRes] = await Promise.all([
        loadLists(),
        fetch(`/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true`)
          .then((r) => (r.ok ? r.json() : { contacts: [] }))
          .catch(() => ({ contacts: [] })),
      ]);

      if (cancelled) return;
      // `/api/audiences` returns everything the USER may see, which is not the
      // same as the selected account — scope it, or a multi-account rep sees
      // another store's lists sized against this store's contacts.
      setLists(all.filter((l) => !l.accountKey || l.accountKey === accountKey));
      setContacts(Array.isArray(contactRes?.contacts) ? contactRes.contacts : []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountKey, accountData?.category, loadLists]);

  /** Same records, same engine, same fields — so this equals Studio's count. */
  const sizes = useMemo(() => {
    const map = new Map<string, number>();
    if (!contacts.length) return map;
    for (const list of lists) {
      const def = parseDefinition(list.filters);
      if (def) map.set(list.id, evaluateFilter(contacts, def, fields).length);
    }
    return map;
  }, [lists, contacts, fields]);

  async function save(name: string, definition: FilterDefinition) {
    setError(null);
    const isNew = editing === 'new';
    const body = JSON.stringify({
      name,
      accountKey,
      filters: JSON.stringify(definition),
    });
    const res = await fetch(
      isNew ? '/api/audiences' : `/api/audiences/${(editing as SavedList).id}`,
      {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
    );
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b?.error || 'Could not save the list.');
      return;
    }
    setEditing(null);
    setLists(await loadLists().then((all) =>
      all.filter((l) => !l.accountKey || l.accountKey === accountKey),
    ));
  }

  if (loading) return <LoadingState />;

  if (editing) {
    const current = editing === 'new' ? null : editing;
    const def = current ? parseDefinition(current.filters) : null;
    return (
      <div className="mt-8 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {current ? `Edit “${current.name}”` : 'New list'}
          </h2>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--primary)]/40"
          >
            Cancel
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
            <Muted>{error}</Muted>
          </div>
        )}

        {/* The same builder Studio uses — same operators, same field set, so a
            list built here behaves identically wherever it is read. */}
        <FilterBuilder
          initialDefinition={def ?? undefined}
          fields={fields}
          onApply={() => undefined}
          onSave={(name, definition) => save(name || current?.name || 'Untitled list', definition)}
          onClose={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Muted>
          {lists.length} list{lists.length === 1 ? '' : 's'} · sized against{' '}
          {num(contacts.length)} contacts
        </Muted>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New list
        </button>
      </div>

      {!contacts.length && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <Muted>
              No contacts loaded for this account, so every list shows as empty. That is a missing
              contact sync, not empty lists.
            </Muted>
          </div>
        </div>
      )}

      {!lists.length ? (
        <EmptyState
          icon={FunnelIcon}
          title="No lists yet"
          body="A list is a saved set of rules — customers due for service, recent buyers, anyone in a ZIP. Build one and it's available here and in Studio, and can be used to send."
          action={{ label: 'Build your first list', onClick: () => setEditing('new') }}
        />
      ) : (
        <Section title="Lists" subtitle="Shared with Studio" icon={FunnelIcon}>
          <ul className="divide-y divide-[var(--border)]">
            {lists.map((list) => {
              const size = sizes.get(list.id);
              // An account-less list is shared across the book; editing it here
              // would change it for every other dealer too.
              const shared = !list.accountKey;
              return (
                <li key={list.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{list.name}</span>
                      {shared && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                          <LockClosedIcon className="h-3 w-3" />
                          Shared
                        </span>
                      )}
                    </div>
                    {list.description && <Muted>{list.description}</Muted>}
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <span className="flex items-center gap-1.5 text-sm tabular-nums">
                      <UsersIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                      {size === undefined ? (
                        <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        num(size)
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(list)}
                      disabled={shared}
                      title={shared ? 'Shared lists are managed by your account team' : 'Edit list'}
                      className="rounded-lg border border-[var(--border)] p-1.5 transition-colors hover:border-[var(--primary)]/40 disabled:opacity-30"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
