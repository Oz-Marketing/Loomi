'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { HelpTip } from '@/components/ui/help-tip';
import { filterSizes } from '@/lib/ad-generator/ad-size-library';
import { useSizeLibrary } from '@/lib/ad-generator/use-size-library';
import { TagFilterChips } from '@/components/ad-generator/size-picker';
import { formatBytes } from '@/lib/media-limits';

/**
 * Platform sizes generated from one master — Phase 4 of docs/asset-management.md.
 *
 * The sizes come from the ad builder's own size library — including sizes a team
 * added themselves — so a rendition and the ad it ends up in share dimensions by
 * construction. Renditions are disposable: the master is the source of truth,
 * deleting one costs nothing, and regenerating replaces in place.
 */

interface Rendition {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  url: string;
  size: number;
  fit: string;
}

export function RenditionPanel({
  assetId,
  /** False for anything that isn't a raster image — zips, PDFs, video. */
  canGenerate,
  /** Inherited assets are read-only, so generation is hidden. */
  readOnly = false,
}: {
  assetId: string;
  canGenerate: boolean;
  readOnly?: boolean;
}) {
  const [renditions, setRenditions] = useState<Rendition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Sizes to offer, and the tag chips that narrow them.
  const { sizes: library, facets, loading: libLoading } = useSizeLibrary();
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const offered = useMemo(() => filterSizes(library, tagFilter), [library, tagFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/renditions`);
      const data = await res.json();
      if (res.ok) setRenditions(data.renditions || []);
    } catch {
      /* the panel is supplementary — a failure here shouldn't break the modal */
    }
    setLoading(false);
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const existing = new Set(renditions.map((r) => r.name));

  async function generate() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/renditions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizes: [...selected].map((name) => ({ name })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Could not generate sizes');
      } else {
        const made = data.created?.length ?? 0;
        if (made > 0) toast.success(`Generated ${made} size${made > 1 ? 's' : ''}`);
        // Report per-size failures individually — "3 of 5 worked" is actionable,
        // a generic error is not.
        for (const f of data.failed ?? []) toast.error(`${f.name}: ${f.error}`);
        setSelected(new Set());
        setPicking(false);
        await load();
      }
    } catch {
      toast.error('Could not generate sizes');
    }
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/media/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (res.ok) setRenditions((prev) => prev.filter((r) => r.id !== id));
      else toast.error('Could not delete that size');
    } catch {
      toast.error('Could not delete that size');
    }
    setBusy(false);
  }

  if (!canGenerate && renditions.length === 0) {
    return (
      <div className="pt-3 border-t border-[var(--border)]">
        <h4 className="text-sm font-semibold mb-1.5">Sizes</h4>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Platform sizes can only be generated from a photo or raster image. This
          file is stored as-is.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-3 border-t border-[var(--border)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          Sizes
          <HelpTip title="Platform sizes">
            <p>
              Crops of this master at standard ad dimensions, generated once and
              reused — rather than someone re-cropping the same photo for each
              placement.
            </p>
            <p className="mt-2">
              They&apos;re disposable: the master is the source of truth, and
              regenerating a size replaces it.
            </p>
          </HelpTip>
        </h4>
        {canGenerate && !readOnly && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="text-xs font-medium text-[var(--primary)] hover:opacity-80 transition-opacity"
          >
            {picking ? 'Cancel' : 'Generate sizes'}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">Loading…</p>
      ) : (
        <>
          {renditions.length === 0 && !picking && (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              No sizes generated yet.
            </p>
          )}

          {renditions.length > 0 && (
            <div className="space-y-1 mb-3">
              {renditions.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-lg bg-[var(--muted)]/40 px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--foreground)]">{r.name}</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      {r.width}×{r.height} · {formatBytes(r.size)}
                      {r.fit === 'contain' ? ' · letterboxed' : ''}
                    </p>
                  </div>
                  <a
                    href={r.url}
                    download={`${r.name}.jpg`}
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    title={`Download ${r.name}`}
                  >
                    <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                  </a>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      title={`Delete ${r.name}`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {picking && (
            <div className="rounded-lg border border-[var(--border)] p-2.5">
              <TagFilterChips facets={facets} selected={tagFilter} onChange={setTagFilter} className="mb-2" />
              <div className="max-h-56 overflow-y-auto space-y-3">
                {libLoading && (
                  <p className="px-1.5 py-2 text-[11px] text-[var(--muted-foreground)]">Loading sizes…</p>
                )}
                {!libLoading && offered.length === 0 && (
                  <p className="px-1.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                    {library.length === 0 ? 'No sizes in the library yet.' : 'No sizes match that filter.'}
                  </p>
                )}
                <div>
                    <div className="space-y-0.5">
                      {offered.map((size) => {
                        const checked = selected.has(size.name);
                        const already = existing.has(size.name);
                        return (
                          <button
                            key={size.name}
                            type="button"
                            onClick={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(size.name)) next.delete(size.name);
                                else next.add(size.name);
                                return next;
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-[var(--muted)]"
                          >
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-[var(--primary)] bg-[var(--primary)]'
                                  : 'border-[var(--border)]'
                              }`}
                            >
                              {checked && (
                                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
                                  <path
                                    d="M2.5 6.5l2.5 2.5 4.5-5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                              {size.name}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                              {size.width}×{size.height}
                            </span>
                            {/* Not disabled — regenerating is a legitimate thing
                                to want after the master has been replaced. */}
                            {already && (
                              <span className="shrink-0 text-[10px] text-[var(--primary)]">redo</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                </div>
              </div>

              <button
                type="button"
                onClick={generate}
                disabled={busy || selected.size === 0}
                className="mt-2.5 w-full rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? 'Generating…'
                  : `Generate ${selected.size || ''} size${selected.size === 1 ? '' : 's'}`.trim()}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
