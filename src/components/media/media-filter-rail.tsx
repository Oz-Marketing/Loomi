'use client';

/**
 * The persistent left filter rail for the media library.
 *
 * Deliberately the same shape as `templates/template-filter-rail.tsx` — section
 * headings, count rows, a Clear affordance in the header — because the two
 * libraries sit one nav click apart and a person filtering assets shouldn't have
 * to learn a second set of controls. This replaced a dropdown panel: with four
 * facets plus ownership, a popover hid the taxonomy behind a click at exactly
 * the moment the whole point of Phase 2 is to make it visible.
 */
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  MEDIA_FACET_KEYS,
  MEDIA_FACET_LABELS,
  UNSET,
  countMediaFacetsSelected,
  type MediaFacetKey,
  type MediaFacetOption,
  type MediaFacetSelection,
} from '@/lib/media-facets';

/** Which assets to show, by where they live relative to the current account. */
export type OwnershipFilter = 'all' | 'mine' | 'shared';

function Row({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {typeof count === 'number' && (
        <span className={`text-[10px] tabular-nums ${active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export interface MediaFilterRailProps {
  options: Record<MediaFacetKey, MediaFacetOption[]>;
  /**
   * Which facet sections exist at all — decided from the WHOLE visible list, so
   * the rail keeps a stable shape while you filter. A facet with one value
   * across every asset can't narrow anything and stays hidden: a single-brand
   * rooftop shouldn't carry a Brand section listing only its own marque.
   */
  visibleFacets: MediaFacetKey[];
  selection: MediaFacetSelection;
  onSelectionChange: (next: MediaFacetSelection) => void;

  ownership: OwnershipFilter;
  onOwnershipChange: (next: OwnershipFilter) => void;
  /** Hide the ownership section when nothing is inherited — it'd be a no-op. */
  showOwnership: boolean;
  /** Per-ownership counts for the section rows. */
  ownershipCounts?: { all: number; mine: number; shared: number };
}

export function MediaFilterRail({
  options,
  visibleFacets,
  selection,
  onSelectionChange,
  ownership,
  onOwnershipChange,
  showOwnership,
  ownershipCounts,
}: MediaFilterRailProps) {
  // Anything selected stays rendered regardless, so a filter can always be undone.
  const sections = MEDIA_FACET_KEYS.filter(
    (k) => visibleFacets.includes(k) || (selection[k]?.length ?? 0) > 0,
  );

  // 'mine' is the default view, not a filter someone applied.
  const active = countMediaFacetsSelected(selection) + (ownership !== 'mine' ? 1 : 0);

  if (!showOwnership && sections.length === 0) return null;

  function toggle(key: MediaFacetKey, value: string) {
    const current = selection[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onSelectionChange({ ...selection, [key]: next });
  }

  return (
    // min-w-0 so a long facet label truncates instead of widening the rail.
    <aside className="w-full min-w-0 shrink-0 space-y-4 lg:w-52">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold text-[var(--foreground)]">Filters</span>
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              onSelectionChange({});
              onOwnershipChange('mine');
            }}
            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {showOwnership && (
        <Section title="Ownership">
          {([
            { v: 'mine', label: 'This account', count: ownershipCounts?.mine },
            { v: 'shared', label: 'Shared with this account', count: ownershipCounts?.shared },
            { v: 'all', label: 'Everything available', count: ownershipCounts?.all },
          ] as { v: OwnershipFilter; label: string; count?: number }[]).map((o) => (
            <Row key={o.v} active={ownership === o.v} onClick={() => onOwnershipChange(o.v)} count={o.count}>
              {o.label}
            </Row>
          ))}
        </Section>
      )}

      {sections.map((key) => (
        <Section key={key} title={MEDIA_FACET_LABELS[key]}>
          {options[key].map((o) => (
            <Row
              key={o.value}
              active={(selection[key] ?? []).includes(o.value)}
              onClick={() => toggle(key, o.value)}
              count={o.count}
            >
              <span className={o.value === UNSET ? 'italic text-[var(--muted-foreground)]' : undefined}>
                {o.label}
              </span>
            </Row>
          ))}
        </Section>
      ))}
    </aside>
  );
}
