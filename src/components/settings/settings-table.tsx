'use client';

import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';

/**
 * Shared settings data-table: the glass frame, horizontal scroll, a "Show"
 * page-size selector (default 20), and pagination — so Users, Teams, and any
 * future settings table look and behave identically. Sorting/filtering stays in
 * the parent (pass already-sorted `items`); columns render the cells.
 */
export type SettingsColumn<T> = {
  key: string;
  /** Header content (include a sort button here if the column is sortable). */
  header: React.ReactNode;
  cell: (item: T) => React.ReactNode;
  thClassName?: string;
  tdClassName?: string;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function visiblePages(current: number, total: number): number[] {
  const out: number[] = [];
  const from = Math.max(1, current - 2);
  const to = Math.min(total, current + 2);
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

export function SettingsTable<T>({
  items,
  columns,
  getRowKey,
  onRowClick,
  minWidth = 720,
  loading = false,
  emptyMessage = 'Nothing here',
  defaultPageSize = 20,
}: {
  items: T[];
  columns: SettingsColumn<T>[];
  getRowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  minWidth?: number;
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  defaultPageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keep the page in range when items shrink or page size grows.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const paged = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  const showingStart = total === 0 ? 0 : start + 1;
  const showingEnd = Math.min(start + pageSize, total);

  const sizeOptions = PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }));

  return (
    <div>
      <div className="glass-table">
        <div className="users-table-scroll">
          <table className="w-full" style={{ minWidth }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={
                      c.thClassName ??
                      'text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider'
                    }
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    Loading…
                  </td>
                </tr>
              ) : total === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paged.map((item) => (
                  <tr
                    key={getRowKey(item)}
                    onClick={onRowClick ? () => onRowClick(item) : undefined}
                    className={`border-b border-[var(--border)] last:border-b-0 transition-colors ${
                      onRowClick ? 'cursor-pointer hover:bg-[var(--muted)]/50' : ''
                    }`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.tdClassName ?? 'px-3 py-2 align-middle'}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">Show</span>
            <div className="w-20">
              <SearchableSelect
                value={String(pageSize)}
                onChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
                options={sizeOptions}
                searchable={false}
              />
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              · {showingStart}–{showingEnd} of {total}
            </span>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <PageBtn onClick={() => setPage(1)} disabled={page === 1}>First</PageBtn>
              <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Prev</PageBtn>
              {visiblePages(page, totalPages).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                    p === page
                      ? 'bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--primary)] font-medium'
                      : 'border-[var(--border)] hover:bg-[var(--muted)]'
                  }`}
                >
                  {p}
                </button>
              ))}
              <PageBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</PageBtn>
              <PageBtn onClick={() => setPage(totalPages)} disabled={page === totalPages}>Last</PageBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 text-xs rounded-md border border-[var(--border)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
