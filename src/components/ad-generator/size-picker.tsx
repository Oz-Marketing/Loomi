'use client';

/**
 * Size picking, once, for every surface that does it.
 *
 * The from-scratch modal and the builder's Sizes panel used to each render their
 * own list from their own idea of what sizes exist — which is how custom sizes
 * could be missing from one and present in the other. Both now render this,
 * fed by `useSizeLibrary`.
 *
 * Tags filter the list rather than partition it: a size can be used for several
 * things, and a picker that files each size under exactly one heading has to
 * invent a "Custom" pile for everything that doesn't fit.
 */
import { useMemo, useState } from 'react';
import { CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';
import { aspectLabel, filterSizes, type LibrarySize } from '@/lib/ad-generator/ad-size-library';

/** A ratio-accurate swatch: `long` px on the long edge, scaled on the short. */
export function RatioSwatch({ width, height, long = 30, fill, className = '' }: { width: number; height: number; long?: number; fill?: string; className?: string }) {
  const w = width >= height ? long : Math.round((long * width) / height);
  const h = height >= width ? long : Math.round((long * height) / width);
  return <span className={`rounded-[2px] border border-[var(--border)] ${className}`} style={{ width: w, height: h, background: fill ?? 'var(--muted)' }} />;
}

/** Filter chips — "All" plus every tag in use, each with its count. */
export function TagFilterChips({
  facets,
  selected,
  onChange,
  className = '',
}: {
  facets: { tag: string; count: number }[];
  selected: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}) {
  if (!facets.length) return null;
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => onChange([])}
        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          selected.length === 0
            ? 'bg-[var(--primary)] text-white'
            : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        All
      </button>
      {facets.map((f) => {
        const on = selected.includes(f.tag);
        const color = getTagColor(f.tag);
        return (
          <button
            key={f.tag}
            type="button"
            onClick={() => toggle(f.tag)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              on ? `${color.className} ring-2` : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {f.tag}
            <span className="tabular-nums opacity-60">{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Multi-select list of library sizes with tag filtering. Selection is by size
 * id and owned by the caller, so the same picker works for "starting sizes" and
 * "add sizes to this design".
 */
export function SizePicker({
  sizes,
  facets,
  loading,
  selectedIds,
  onToggle,
  /** Canvas fill for the ratio swatches, so previews match the design. */
  previewFill,
  /** Tighter tiles for the builder's popover; roomier for a modal. */
  dense = false,
  /** Hide the search box on small surfaces where the tag chips are enough. */
  showSearch = true,
}: {
  sizes: LibrarySize[];
  facets: { tag: string; count: number }[];
  loading?: boolean;
  selectedIds: Set<string>;
  onToggle: (size: LibrarySize) => void;
  previewFill?: string;
  dense?: boolean;
  showSearch?: boolean;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterSizes(sizes, tags, query), [sizes, tags, query]);

  return (
    <div className="space-y-2">
      {showSearch && (
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sizes…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
      )}

      <TagFilterChips facets={facets} selected={tags} onChange={setTags} />

      {loading ? (
        <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">Loading sizes…</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
          {sizes.length === 0 ? 'No sizes in the library yet.' : 'No sizes match that filter.'}
        </p>
      ) : (
        <div className={`grid gap-1.5 ${dense ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {shown.map((s) => {
            const on = selectedIds.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onToggle(s)}
                aria-pressed={on}
                title={`${s.name} · ${s.width}×${s.height}`}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]'
                }`}
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                  <RatioSwatch width={s.width} height={s.height} long={30} fill={previewFill} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-medium ${on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{s.name}</span>
                  <span className="block text-[10px] tabular-nums text-[var(--muted-foreground)]">
                    {s.width}×{s.height} · {aspectLabel(s.width, s.height)}
                  </span>
                  {!dense && s.tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {s.tags.map((t) => (
                        <span key={t} className={`rounded-full px-1.5 py-px text-[9px] ${getTagColor(t).className}`}>
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border ${
                    on ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--muted-foreground)]/50'
                  }`}
                >
                  {on && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
