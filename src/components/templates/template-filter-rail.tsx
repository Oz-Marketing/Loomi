'use client';

/**
 * The persistent left filter rail shared by every /templates tab: a Categories
 * section (single-select), a Tags section (multi-select, AND-match), and an
 * optional Status section (managers). Presentational — driven by the state from
 * useTemplateFilters. Optional `extraSections` lets a tab add its own facet
 * (e.g. Email's lifecycle/design Type filter).
 */
import { FolderIcon, XMarkIcon, BuildingStorefrontIcon, GlobeAltIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';
import { GLOBAL_SCOPE, type TemplateFilterState, type TemplateFilterFacets, type StatusValue } from './use-template-filters';

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
  accountLabels,
  search,
  onSearch,
}: {
  filters: TemplateFilterState;
  setFilters: (updater: (f: TemplateFilterState) => TemplateFilterState) => void;
  facets: TemplateFilterFacets;
  active: boolean;
  reset: () => void;
  showStatus?: boolean;
  extraSections?: FilterRailExtraSection[];
  /** Maps an account key → display name for the Subaccount section. */
  accountLabels?: Record<string, string>;
  /** Search box lives at the top of the rail (under the Filters label). Omit
   *  onSearch to hide it. */
  search?: string;
  onSearch?: (value: string) => void;
}) {
  const setCategory = (value: string | null) =>
    setFilters((f) => ({ ...f, category: f.category === value ? null : value }));
  const toggleTag = (value: string) =>
    setFilters((f) => ({ ...f, tags: f.tags.includes(value) ? f.tags.filter((t) => t !== value) : [...f.tags, value] }));
  const setStatus = (value: StatusValue) => setFilters((f) => ({ ...f, status: value }));
  const setAccount = (value: string | null) =>
    setFilters((f) => ({ ...f, accountKey: f.accountKey === value ? null : value }));

  // Only worth showing when templates span more than one scope (e.g. Admin sees
  // global + several subaccounts). A single bucket = nothing to filter.
  const showAccounts = facets.accounts.length > 1;
  const nothing =
    facets.categories.length === 0 &&
    facets.tags.length === 0 &&
    extraSections.length === 0 &&
    !showStatus &&
    !showAccounts &&
    !onSearch;
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

      {onSearch && (
        <div className="relative px-0.5">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-1.5 pl-8 pr-2 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
          />
        </div>
      )}

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

      {showAccounts && (
        <Section title="Subaccount">
          {facets.accounts.map((a) => {
            const isGlobal = a.value === GLOBAL_SCOPE;
            const label = isGlobal ? 'All accounts' : accountLabels?.[a.value] ?? a.value;
            const Icon = isGlobal ? GlobeAltIcon : BuildingStorefrontIcon;
            return (
              <Row key={a.value} active={filters.accountKey === a.value} onClick={() => setAccount(a.value)} count={a.count}>
                <span className="inline-flex items-center gap-1">
                  <Icon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
              </Row>
            );
          })}
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
