'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowPathIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  FunnelIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import type { Contact } from '@/lib/contacts/types';
import { toast } from '@/lib/toast';

interface SavedSegment {
  id: string;
  name: string;
  description?: string | null;
  filters: string;
  accountKey?: string | null;
  color?: string | null;
  updatedAt?: string;
}

interface SavedSegmentResponse {
  audiences: SavedSegment[];
}

function parseDefinition(raw: string): FilterDefinition | null {
  try {
    const parsed = JSON.parse(raw) as FilterDefinition;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function describeFilter(definition: FilterDefinition | null): string {
  if (!definition) return 'Invalid filter';
  const conditionCount = definition.groups.reduce(
    (acc, group) => acc + group.conditions.length,
    0,
  );
  if (conditionCount === 0) return 'No conditions';
  const groupSuffix = definition.groups.length > 1 ? ` in ${definition.groups.length} groups` : '';
  return `${conditionCount} condition${conditionCount === 1 ? '' : 's'}${groupSuffix}`;
}

export default function SegmentsPage() {
  const router = useRouter();
  const { isAccount, accountKey, accounts, accountData } = useAccount();
  const subHref = useSubaccountHref();
  // Match SegmentEditor: pull custom fields when scoped to a single
  // sub-account; the org-wide / aggregate view falls back to built-ins.
  const { fields } = useFilterableFields(isAccount ? accountKey : null);

  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // ── Close action menu on outside click ───────────────────────────
  useEffect(() => {
    if (!openMenuId) return;
    function handler() {
      setOpenMenuId(null);
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Fetch saved segments (with lazy lifecycle seed for autos) ────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function loadAudiences() {
      // Auto-bootstrap lifecycle audiences for automotive accounts on
      // first visit. Idempotent — the endpoint short-circuits if the
      // account has already been seeded or is not automotive.
      const isAutomotive =
        (accountData?.category ?? '').trim().toLowerCase() === 'automotive';
      if (isAccount && accountKey && isAutomotive) {
        try {
          await fetch('/api/audiences/seed-lifecycle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountKey }),
          });
        } catch {
          // Non-fatal — fall through and just list what's there.
        }
      }

      try {
        const res = await fetch('/api/audiences');
        const data: SavedSegmentResponse = res.ok ? await res.json() : { audiences: [] };
        if (!cancelled) {
          setSavedSegments(Array.isArray(data.audiences) ? data.audiences : []);
        }
      } catch {
        if (!cancelled) setSavedSegments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAudiences();
    return () => {
      cancelled = true;
    };
  }, [isAccount, accountKey, accountData?.category]);

  // ── Fetch contacts (used for member counts) ──────────────────────
  useEffect(() => {
    let cancelled = false;
    setContactsLoading(true);
    const url =
      isAccount && accountKey
        ? `/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true&includeMessaging=true`
        : '/api/contacts/aggregate?includeMessaging=true&limitPerAccount=250';
    fetch(url)
      .then((res) => (res.ok ? res.json() : { contacts: [] }))
      .then((data) => {
        if (cancelled) return;
        setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAccount, accountKey]);

  // ── Member-count map ─────────────────────────────────────────────
  const memberCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (contactsLoading || !contacts.length) return map;
    for (const segment of savedSegments) {
      const def = parseDefinition(segment.filters);
      if (def) map.set(segment.id, evaluateFilter(contacts, def, fields).length);
    }
    return map;
  }, [contacts, contactsLoading, savedSegments, fields]);

  // ── Search filtering ─────────────────────────────────────────────
  const visibleSavedSegments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return savedSegments;
    return savedSegments.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q),
    );
  }, [savedSegments, search]);

  // ── Actions ──────────────────────────────────────────────────────
  async function handleDelete(segment: SavedSegment) {
    if (!confirm(`Delete segment "${segment.name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/audiences/${encodeURIComponent(segment.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to delete segment');
      }
      setSavedSegments((prev) => prev.filter((s) => s.id !== segment.id));
      toast.success(`Segment "${segment.name}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete segment');
    }
  }

  function handleDuplicate(segment: SavedSegment) {
    router.push(`${subHref('/contacts/segments/new')}?from=${encodeURIComponent(segment.id)}`);
  }

  function handleUsePreview(segmentId: string) {
    router.push(`${subHref('/contacts')}?segment=${encodeURIComponent(segmentId)}`);
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <FunnelIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Segments</h2>
              <p className="text-[var(--muted-foreground)] mt-1 text-sm">
                Dynamic audiences defined by filter conditions. Auto-updates as your contacts
                change.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search segments…"
                className="pl-9 pr-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-transparent focus:outline-none focus:border-[var(--primary)] transition-colors w-56"
              />
            </div>
            <Link
              href={subHref('/contacts/segments/new')}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              New segment
            </Link>
          </div>
        </div>
      </div>

      {/* Saved segments */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
            Saved segments
            {!loading && savedSegments.length > 0 && (
              <span className="ml-2 text-[var(--muted-foreground)]/60">
                ({savedSegments.length})
              </span>
            )}
          </p>
          {contactsLoading && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
              <ArrowPathIcon className="w-3 h-3 animate-spin" />
              Calculating member counts…
            </span>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
            Loading saved segments…
          </div>
        )}

        {!loading && savedSegments.length === 0 && (
          <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
            <FunnelIcon className="w-9 h-9 mx-auto text-[var(--muted-foreground)] mb-2 opacity-60" />
            <p className="text-sm font-medium">No saved segments yet</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-md mx-auto">
              Click <span className="font-medium">New segment</span> to build a filter-driven
              audience, or customize one of the presets above.
            </p>
          </div>
        )}

        {!loading && savedSegments.length > 0 && visibleSavedSegments.length === 0 && (
          <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-xl">
            <p className="text-sm">No segments match your search.</p>
          </div>
        )}

        {!loading && visibleSavedSegments.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleSavedSegments.map((segment) => {
              const definition = parseDefinition(segment.filters);
              const count = memberCounts.get(segment.id);
              const dealer = segment.accountKey
                ? accounts[segment.accountKey]?.dealer ?? segment.accountKey
                : null;
              const isMenuOpen = openMenuId === segment.id;
              return (
                <div
                  key={segment.id}
                  className="glass-card rounded-xl border border-[var(--border)]/70 p-4 hover:border-[var(--primary)]/40 transition-colors flex flex-col gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-${segment.color || 'blue'}-500/10 text-${segment.color || 'blue'}-400`}
                    >
                      <FunnelIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`${subHref('/contacts/segments')}/${encodeURIComponent(segment.id)}`}
                        className="block"
                      >
                        <p className="text-sm font-semibold truncate hover:text-[var(--primary)] transition-colors">
                          {segment.name}
                        </p>
                      </Link>
                      <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 truncate">
                        {segment.description || describeFilter(definition)}
                      </p>
                    </div>
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(isMenuOpen ? null : segment.id);
                        }}
                        title="Actions"
                        className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
                      >
                        <EllipsisHorizontalIcon className="w-4 h-4" />
                      </button>
                      {isMenuOpen && (
                        <div
                          className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg py-1 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            href={`${subHref('/contacts/segments')}/${encodeURIComponent(segment.id)}`}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sidebar-muted)]"
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              handleDuplicate(segment);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sidebar-muted)] text-left"
                          >
                            <DocumentDuplicateIcon className="w-3.5 h-3.5" />
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              handleUsePreview(segment.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sidebar-muted)] text-left"
                          >
                            <UsersIcon className="w-3.5 h-3.5" />
                            View contacts
                          </button>
                          <div className="my-1 border-t border-[var(--border)]/60" />
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              handleDelete(segment);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-500/10 text-red-400 text-left"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                    <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                      {contactsLoading
                        ? '…'
                        : count !== undefined
                          ? `${count.toLocaleString()} member${count === 1 ? '' : 's'}`
                          : '—'}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] px-1.5 py-0.5 rounded border border-[var(--border)]/60"
                      title={dealer ? `Visible only to ${dealer}` : 'Visible to all accounts'}
                    >
                      {dealer ? (
                        <UsersIcon className="w-2.5 h-2.5" />
                      ) : (
                        <GlobeAltIcon className="w-2.5 h-2.5" />
                      )}
                      {dealer ?? 'Org-wide'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
