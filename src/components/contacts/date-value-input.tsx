'use client';

import { CalendarDaysIcon, ClockIcon } from '@heroicons/react/24/outline';
import {
  MAX_RELATIVE_DATE_AMOUNT,
  RELATIVE_DATE_UNITS,
  formatRelativeDate,
  parseRelativeDate,
  type RelativeDateUnit,
  type RelativeDateValue,
} from '@/lib/smart-list-types';
import { resolveFilterDateBound } from '@/lib/smart-list-engine';
import { DatePicker } from '@/components/ui/date-picker';
import { LoomiSelect } from './loomi-select';

// One bound of a date condition, as either a fixed calendar date or a
// relative one ("6 months ago").
//
// WHY BOTH: a segment built on fixed dates is a segment that silently
// stops meaning what it meant. "Purchase Date between 01/01/2024 and
// 12/31/2024" describes a cohort that ages out of relevance while the
// filter keeps returning the same people, and the only way to keep it
// current is for someone to remember to come back and retype the dates
// — which nobody does. A relative bound re-resolves every time the
// segment is evaluated, so "bought more than 3 years ago" stays true.
//
// The mode isn't stored anywhere: it's read back off the value, because
// `rel:` tokens are unambiguous (see smart-list-types). That keeps
// FilterCondition's shape untouched, so nothing downstream — the flow
// builder, the blast recipients screen, saved segments — has to learn
// about a mode field it would then have to keep in sync.

export interface DateValueInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Which end of a range this is. An upper bound covers the whole of
   *  its day; see resolveFilterDateBound. */
  edge?: 'start' | 'end';
  size?: 'sm' | 'md';
  invalid?: boolean;
}

/** Unit + direction in one dropdown — two controls read better in a
 *  condition row than three, and nobody picks a direction without also
 *  having a unit in mind. */
const UNIT_OPTIONS = [
  ...RELATIVE_DATE_UNITS.map((unit) => ({ value: `-${unit}`, label: `${unit}s ago` })),
  ...RELATIVE_DATE_UNITS.map((unit) => ({ value: `+${unit}`, label: `${unit}s from now` })),
];

/** What "switch to relative" lands on. 30 days back is the commonest
 *  window in the seeded presets, and it's obviously editable. */
const DEFAULT_RELATIVE: RelativeDateValue = { amount: -30, unit: 'day' };

export function DateValueInput({
  value,
  onChange,
  edge = 'start',
  size = 'md',
  invalid = false,
}: DateValueInputProps) {
  const relative = parseRelativeDate(value);
  const compact = size === 'sm';
  const height = compact ? 'py-1.5 text-xs' : 'h-9 text-sm';
  const borderClass = invalid
    ? 'border-amber-500/50 focus:border-amber-500'
    : 'border-[var(--border)] focus:border-[var(--primary)]';

  function switchToRelative() {
    onChange(formatRelativeDate(DEFAULT_RELATIVE));
  }

  function switchToExact() {
    // Carry the relative bound over as the date it resolves to today,
    // so switching modes shows the user what they already had rather
    // than blanking the condition out from under them.
    const resolved = resolveFilterDateBound(value, 'start');
    onChange(resolved ? toDateInputValue(resolved) : '');
  }

  return (
    // Never wraps internally: a mode toggle stranded on the line above
    // its own input reads as two separate controls. The condition row
    // wraps around WHOLE bounds instead.
    //
    // basis, not flex-1. Flexbox breaks lines on the flex BASE size, and
    // flex-1 sets that to 0 — so a row of these never wrapped, it just
    // pushed past its container to honour min-w. The basis has to state
    // the real minimum for the wrap to fire.
    <div className="flex items-stretch gap-1.5 grow basis-[236px] min-w-0 w-full">
      <ModeToggle
        relative={!!relative}
        compact={compact}
        onExact={switchToExact}
        onRelative={switchToRelative}
      />

      {relative ? (
        <>
          <input
            type="number"
            min={0}
            max={MAX_RELATIVE_DATE_AMOUNT}
            value={Math.abs(relative.amount)}
            onChange={(e) => {
              const next = clampAmount(e.target.value);
              onChange(
                formatRelativeDate({
                  amount: relative.amount < 0 ? -next : next,
                  unit: relative.unit,
                }),
              );
            }}
            aria-label="Amount"
            className={`w-16 px-2 rounded-lg border bg-transparent focus:outline-none transition-colors ${height} ${borderClass}`}
          />
          <LoomiSelect
            value={`${relative.amount > 0 ? '+' : '-'}${relative.unit}`}
            onChange={(next) => {
              const magnitude = Math.abs(relative.amount);
              const forward = next.startsWith('+');
              onChange(
                formatRelativeDate({
                  amount: forward ? magnitude : -magnitude,
                  unit: next.slice(1) as RelativeDateUnit,
                }),
              );
            }}
            options={UNIT_OPTIONS}
            searchable={false}
            size={size}
            className="flex-1 min-w-[96px]"
          />
        </>
      ) : (
        <div className="flex-1 min-w-0">
          <DatePicker
            mode="single"
            value={toDateInputValue(value) || null}
            onChange={(next) => onChange(next ?? '')}
            placeholder={edge === 'end' ? 'End date' : 'Start date'}
            className={`group w-full inline-flex items-center justify-between gap-2 px-3 text-left rounded-lg border bg-transparent focus:outline-none transition-colors ${height} ${borderClass}`}
          />
        </div>
      )}
    </div>
  );
}

function ModeToggle({
  relative,
  compact,
  onExact,
  onRelative,
}: {
  relative: boolean;
  compact: boolean;
  onExact: () => void;
  onRelative: () => void;
}) {
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const base = `flex items-center justify-center px-1.5 transition-colors ${
    compact ? 'py-1.5' : 'h-9'
  }`;
  const on = 'bg-[var(--primary)]/15 text-[var(--primary)]';
  const off = 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]';

  return (
    <div className="flex items-stretch rounded-lg border border-[var(--border)] overflow-hidden flex-shrink-0">
      <button
        type="button"
        onClick={onExact}
        title="A fixed calendar date"
        aria-pressed={!relative}
        className={`${base} ${relative ? off : on}`}
      >
        <CalendarDaysIcon className={iconSize} />
      </button>
      <button
        type="button"
        onClick={onRelative}
        title="A date relative to today, re-checked every time the segment runs"
        aria-pressed={relative}
        className={`${base} border-l border-[var(--border)] ${relative ? on : off}`}
      >
        <ClockIcon className={iconSize} />
      </button>
    </div>
  );
}

/**
 * `<input type="date">` only renders a bare `yyyy-mm-dd`. Segments
 * written by the API, the flow builder or an older build of this screen
 * hold full ISO timestamps, and binding one straight to the input paints
 * an EMPTY box over a condition that does in fact have a date — which
 * reads as "this filter is broken" and invites someone to retype it.
 */
function toDateInputValue(value: string | Date): string {
  if (value instanceof Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return toDateInputValue(parsed);
}

function clampAmount(raw: string): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_RELATIVE_DATE_AMOUNT);
}
