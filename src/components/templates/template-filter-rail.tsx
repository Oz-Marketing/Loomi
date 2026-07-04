'use client';

/**
 * The persistent left filter rail shared by every /templates tab: a Categories
 * section (single-select), a Tags section (multi-select, AND-match), and an
 * optional Status section (managers). Presentational — driven by the state from
 * useTemplateFilters. Optional `extraSections` lets a tab add its own facet
 * (e.g. Email's lifecycle/design Type filter).
 */
import { FolderIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';
import type { TemplateFilterState, TemplateFilterFacets, StatusValue } from './use-template-filters';

export interface FilterRailExtraSection {
  key: string;
  title: string;
  options: { value: string; label: string; count?: number }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}

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
        active ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {typeof count === 'number' && (
        <span className={`text-[10px] tabular-nums ${active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>{count}</span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function TemplateFilterRail({
  filters,
  setFilters,
  facets,
  active,
  reset,
  showStatus = false,
  extraSections = [],
}: {
  filters: TemplateFilterState;
  setFilters: (updater: (f: TemplateFilterState) => TemplateFilterState) => void;
  facets: TemplateFilterFacets;
  active: boolean;
  reset: () => void;
  showStatus?: boolean;
  extraSections?: FilterRailExtraSection[];
}) {
  const setCategory = (value: string | null) =>
    setFilters((f) => ({ ...f, category: f.category === value ? null : value }));
  const toggleTag = (value: string) =>
    setFilters((f) => ({ ...f, tags: f.tags.includes(value) ? f.tags.filter((t) => t !== value) : [...f.tags, value] }));
  const setStatus = (value: StatusValue) => setFilters((f) => ({ ...f, status: value }));

  const nothing = facets.categories.length === 0 && facets.tags.length === 0 && extraSections.length === 0 && !showStatus;
  if (nothing) return null;

  return (
    <aside className="w-full shrink-0 space-y-4 lg:w-52">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold text-[var(--foreground)]">Filters</span>
        {active && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {showStatus && (
        <Section title="Status">
          {([
            { v: 'all', label: 'All', count: facets.statuses.published + facets.statuses.draft },
            { v: 'published', label: 'Published', count: facets.statuses.published },
            { v: 'draft', label: 'Draft', count: facets.statuses.draft },
          ] as { v: StatusValue; label: string; count: number }[]).map((s) => (
            <Row key={s.v} active={filters.status === s.v} onClick={() => setStatus(s.v)} count={s.count}>
              {s.label}
            </Row>
          ))}
        </Section>
      )}

      {extraSections.map((sec) => (
        <Section key={sec.key} title={sec.title}>
          {sec.options.map((o) => (
            <Row
              key={o.value}
              active={sec.selected === o.value}
              onClick={() => sec.onSelect(sec.selected === o.value ? null : o.value)}
              count={o.count}
            >
              {o.label}
            </Row>
          ))}
        </Section>
      ))}

      {facets.categories.length > 0 && (
        <Section title="Categories">
          {facets.categories.map((c) => (
            <Row key={c.value} active={filters.category === c.value} onClick={() => setCategory(c.value)} count={c.count}>
              <span className="inline-flex items-center gap-1">
                <FolderIcon className="h-3 w-3 flex-shrink-0" />
                <span className="capitalize">{c.value.replace(/-/g, ' ')}</span>
              </span>
            </Row>
          ))}
        </Section>
      )}

      {facets.tags.length > 0 && (
        <Section title="Tags">
          {facets.tags.map((t) => {
            const color = getTagColor(t.value);
            return (
              <Row key={t.value} active={filters.tags.includes(t.value)} onClick={() => toggleTag(t.value)} count={t.count}>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${color.className.split(' ')[0]}`} />
                  {t.value}
                </span>
              </Row>
            );
          })}
        </Section>
      )}
    </aside>
  );
}
