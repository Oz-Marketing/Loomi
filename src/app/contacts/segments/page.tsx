'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FunnelIcon,
  PlusIcon,
  RectangleStackIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useAccount } from '@/contexts/account-context';
import { FilterBuilder } from '@/components/contacts/filter-builder';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { toast } from '@/lib/toast';

// Segments live here as first-class objects: pre-built lifecycle filters
// (auto/service due / lease ending / etc.) on top, user-saved custom
// segments below. The FilterBuilder modal handles creation; we POST
// to /api/audiences which is the same store the campaign builder reads
// from on the Recipients step.

interface SavedSegment {
  id: string;
  name: string;
  description?: string | null;
  filters: string;
  accountKey?: string | null;
  color?: string | null;
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
  const groupCount = definition.groups.length;
  const conditionCount = definition.groups.reduce(
    (acc, group) => acc + group.conditions.length,
    0,
  );
  if (conditionCount === 0) return 'No conditions';
  return `${conditionCount} condition${conditionCount === 1 ? '' : 's'} across ${groupCount} group${groupCount === 1 ? '' : 's'}`;
}

export default function SegmentsPage() {
  const { isAccount, accountKey } = useAccount();
  const subHref = useSubaccountHref();

  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data: SavedSegmentResponse) => {
        if (cancelled) return;
        setSavedSegments(Array.isArray(data.audiences) ? data.audiences : []);
      })
      .catch(() => {
        if (!cancelled) setSavedSegments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(name: string, definition: FilterDefinition) {
    try {
      const res = await fetch('/api/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          filters: JSON.stringify(definition),
          accountKey: isAccount && accountKey ? accountKey : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save segment');
      }
      const data = await res.json();
      setSavedSegments((prev) => [...prev, data.audience]);
      setShowBuilder(false);
      toast.success(`Segment "${name}" saved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save segment');
    }
  }

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

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <FunnelIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Segments</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Dynamic audiences defined by filter conditions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setShowBuilder(true)}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PlusIcon className="w-4 h-4" />
              New Segment
            </button>
          </div>
        </div>
      </div>

      {/* Pre-built lifecycle segments */}
      <section className="mb-6">
        <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-3">
          Built-in
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {LIFECYCLE_PRESETS.map((preset) => (
            <Link
              key={preset.id}
              href={`${subHref('/contacts')}?segment=${encodeURIComponent(preset.id)}`}
              className="glass-card rounded-xl border border-[var(--border)]/70 p-4 hover:border-[var(--primary)]/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-${preset.color}-500/10 text-${preset.color}-400`}>
                  <RectangleStackIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{preset.name}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-2">
                    {preset.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Saved segments */}
      <section>
        <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-3">
          Saved
        </p>

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
              Click <span className="font-medium">New Segment</span> to build a filter-driven audience you can reuse across campaigns.
            </p>
          </div>
        )}

        {!loading && savedSegments.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedSegments.map((segment) => {
              const definition = parseDefinition(segment.filters);
              return (
                <div
                  key={segment.id}
                  className="glass-card rounded-xl border border-[var(--border)]/70 p-4 group"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-${segment.color || 'blue'}-500/10 text-${segment.color || 'blue'}-400`}>
                      <FunnelIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{segment.name}</p>
                      <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                        {describeFilter(definition)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(segment)}
                      title="Delete segment"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showBuilder && (
        <FilterBuilder
          onApply={() => setShowBuilder(false)}
          onSave={handleSave}
          onClose={() => setShowBuilder(false)}
        />
      )}
    </div>
  );
}
