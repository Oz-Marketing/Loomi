'use client';

import {
  MAX_RELATIVE_DATE_AMOUNT,
  RELATIVE_DATE_UNITS,
  formatDuration,
  parseDuration,
  type RelativeDateUnit,
} from '@/lib/smart-list-types';
import { LoomiSelect } from './loomi-select';

// The value of a day-count date operator — "is within the last 6 months".
//
// WHY A UNIT: these operators took a bare number of DAYS, so "lapsed more
// than 3 years ago" had to be written as 1095 — and 1095 days is not three
// years across a leap year, so the segment was quietly wrong at the edges.
// A dealer thinks in months and years; making them do the multiplication
// was both friction and a correctness trap.
//
// The unit is NOT stored as a separate field. parseDuration reads it back
// off the value, so FilterCondition keeps its shape and every segment
// saved before this — all of which hold a bare integer — still parses, and
// still means days.

export interface DurationValueInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Rendered after the unit, for operators that read "... ago". */
  suffix?: string;
  size?: 'sm' | 'md';
  invalid?: boolean;
}

const UNIT_OPTIONS = RELATIVE_DATE_UNITS.map((unit) => ({
  value: unit,
  label: `${unit}s`,
}));

export function DurationValueInput({
  value,
  onChange,
  suffix,
  size = 'md',
  invalid = false,
}: DurationValueInputProps) {
  // An unparseable value still has to render something editable, or a
  // legacy row nobody can fix locks the condition. Fall back to an empty
  // amount on days rather than swallowing the row.
  const parsed = parseDuration(value);
  const amount = parsed?.amount;
  const unit: RelativeDateUnit = parsed?.unit ?? 'day';

  const compact = size === 'sm';
  const height = compact ? 'py-1.5 text-xs' : 'h-9 text-sm';
  const borderClass = invalid
    ? 'border-amber-500/50 focus:border-amber-500'
    : 'border-[var(--border)] focus:border-[var(--primary)]';

  return (
    <div className="flex items-stretch gap-1.5 grow basis-[200px] min-w-0 w-full">
      <input
        type="number"
        min={0}
        max={MAX_RELATIVE_DATE_AMOUNT}
        value={amount ?? ''}
        onChange={(e) => {
          const next = clampAmount(e.target.value);
          onChange(next === null ? '' : formatDuration({ amount: next, unit }));
        }}
        aria-label="Amount"
        placeholder="0"
        className={`w-16 flex-shrink-0 px-2 rounded-lg border bg-transparent focus:outline-none transition-colors ${height} ${borderClass}`}
      />
      <LoomiSelect
        value={unit}
        onChange={(next) =>
          onChange(
            formatDuration({ amount: amount ?? 0, unit: next as RelativeDateUnit }),
          )
        }
        options={UNIT_OPTIONS}
        searchable={false}
        size={size}
        className="flex-1 min-w-[88px]"
      />
      {suffix && (
        <span className="self-center flex-shrink-0 text-[11px] text-[var(--muted-foreground)]">
          {suffix}
        </span>
      )}
    </div>
  );
}

function clampAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_RELATIVE_DATE_AMOUNT);
}
