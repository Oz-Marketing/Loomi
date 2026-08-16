'use client';

/**
 * Compact data table for report breakdowns.
 *
 * Long lists collapse to `maxRows` with a "Show all" toggle; expanded, they
 * scroll inside a bounded box with a sticky header, so a 50-keyword list never
 * takes over the page. First column is left-aligned and truncated, the rest are
 * right-aligned tabular numbers.
 *
 * Cells are `ReactNode` so the first column can be a `<Link>` (see the
 * Marketing Overview's channel table). The truncation tooltip only reads plain
 * cells — a node cell must pass its own `title`, since `String(node)` is
 * meaningless.
 *
 * The sticky header paints `--card-strong` rather than `--card`: `--card` is
 * translucent, so rows scrolled beneath a sticky header made of it showed
 * through the header text.
 */

import { useState, type ReactNode } from 'react';
import { DATA, TH } from './scale';

export function ReportTable({
  head,
  rows,
  maxRows = 8,
}: {
  head: string[];
  rows: ReactNode[][];
  maxRows?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflowing = rows.length > maxRows;
  const visible = expanded ? rows : rows.slice(0, maxRows);

  return (
    <div>
      <div className={`overflow-x-auto ${expanded && overflowing ? 'max-h-[24rem] overflow-y-auto' : ''}`}>
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-[var(--card-strong)] backdrop-blur">
            <tr className={`text-left ${TH}`}>
              {head.map((h, i) => (
                <th key={h} className={`py-2 ${i === 0 ? 'pr-3' : 'px-3 text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, ri) => (
              <tr
                key={ri}
                className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/40"
              >
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-2.5 ${DATA} ${ci === 0 ? 'max-w-[280px] truncate pr-3' : 'px-3 text-right'}`}
                    title={
                      ci === 0 && (typeof cell === 'string' || typeof cell === 'number')
                        ? String(cell)
                        : undefined
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overflowing && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-xs font-medium text-[var(--primary)] hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
