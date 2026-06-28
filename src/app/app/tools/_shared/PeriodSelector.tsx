'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { shiftPeriod } from '@/lib/ad-pacer/period';

/** Period selector — prev/next chevrons + native month input. */
export function PeriodSelector({
  period,
  onChange,
}: {
  period: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, -1))}
        className="px-2 py-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        aria-label="Previous month"
      >
        <ChevronLeftIcon className="w-4 h-4" />
      </button>
      <input
        type="month"
        value={period}
        onChange={(e) => {
          const v = e.target.value;
          if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) onChange(v);
        }}
        className="bg-transparent text-sm font-semibold text-[var(--foreground)] px-2 py-1.5 focus:outline-none border-x border-[var(--border)] min-w-[140px]"
      />
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(period, 1))}
        className="px-2 py-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        aria-label="Next month"
      >
        <ChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
