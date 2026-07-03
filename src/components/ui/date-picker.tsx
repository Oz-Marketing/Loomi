'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// ─── Date helpers (ISO yyyy-MM-dd, local-time safe) ────────────────────────

export type IsoDate = string; // 'YYYY-MM-DD'

export interface DateRange {
  start: IsoDate | null;
  end: IsoDate | null;
}

export function toIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function fromIso(s: IsoDate | null): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmtDisplay(s: IsoDate | null): string {
  const d = fromIso(s);
  if (!d) return '';
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtShort(s: IsoDate | null): string {
  const d = fromIso(s);
  if (!d) return '';
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isInRange(
  day: Date,
  start: IsoDate | null,
  end: IsoDate | null,
): boolean {
  const s = fromIso(start);
  const e = fromIso(end);
  if (!s || !e) return false;
  const t = day.getTime();
  return t >= s.getTime() && t <= e.getTime();
}

// ─── Preset definition ─────────────────────────────────────────────────────

export interface DatePreset {
  label: string;
  /** For single mode — returns the date to select. */
  single?: () => IsoDate;
  /** For range mode — returns the start/end pair. */
  range?: () => { start: IsoDate; end: IsoDate };
}

export const COMMON_SINGLE_PRESETS: DatePreset[] = [
  { label: 'Today', single: () => toIso(new Date()) },
  {
    label: 'Tomorrow',
    single: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return toIso(d);
    },
  },
  {
    label: 'In a week',
    single: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return toIso(d);
    },
  },
];

export const COMMON_RANGE_PRESETS: DatePreset[] = [
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return {
        start: toIso(startOfMonth(now)),
        end: toIso(endOfMonth(now)),
      };
    },
  },
  {
    label: 'Next 30 days',
    range: () => {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 30);
      return { start: toIso(start), end: toIso(end) };
    },
  },
  {
    label: 'Next month',
    range: () => {
      const now = new Date();
      const next = addMonths(now, 1);
      return {
        start: toIso(startOfMonth(next)),
        end: toIso(endOfMonth(next)),
      };
    },
  },
];

// ─── Calendar grid (12-week range across 2 stacked months optional) ────────

interface CalendarMonthProps {
  cursor: Date; // first day of displayed month
  selectedStart: IsoDate | null;
  selectedEnd: IsoDate | null;
  hoverEnd: IsoDate | null;
  focusedIso: IsoDate | null;
  isRange: boolean;
  onDayClick: (iso: IsoDate) => void;
  onDayMouseEnter: (iso: IsoDate) => void;
}

function CalendarMonth({
  cursor,
  selectedStart,
  selectedEnd,
  hoverEnd,
  focusedIso,
  isRange,
  onDayClick,
  onDayMouseEnter,
}: CalendarMonthProps) {
  const monthStart = startOfMonth(cursor);
  const firstDow = monthStart.getDay(); // 0 = Sunday
  const daysInMonth = endOfMonth(cursor).getDate();

  // Build a 6-row grid (42 cells) so the height is consistent month-to-month
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  // Leading days from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(monthStart);
    d.setDate(-i);
    cells.push({ date: d, inMonth: false });
  }
  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      date: new Date(cursor.getFullYear(), cursor.getMonth(), day),
      inMonth: true,
    });
  }
  // Trailing days
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(last.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }

  const today = new Date();
  const startDate = fromIso(selectedStart);
  const endDate = fromIso(selectedEnd);
  const hoverDate = fromIso(hoverEnd);
  // Range preview: if start is set but end isn't, use hover as the end
  const previewEnd = isRange && startDate && !endDate ? hoverDate : null;

  return (
    <div>
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] py-1"
          >
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          const iso = toIso(cell.date);
          const isStart = startDate ? isSameDay(cell.date, startDate) : false;
          const isEnd = endDate ? isSameDay(cell.date, endDate) : false;
          const isToday = isSameDay(cell.date, today);

          let inSelected = false;
          if (isRange) {
            if (selectedStart && selectedEnd) {
              inSelected = isInRange(cell.date, selectedStart, selectedEnd);
            } else if (startDate && previewEnd) {
              const a = startDate.getTime();
              const b = previewEnd.getTime();
              const lo = Math.min(a, b);
              const hi = Math.max(a, b);
              const t = cell.date.getTime();
              inSelected = t >= lo && t <= hi;
            }
          }

          const isSelectedSingle = !isRange && selectedStart === iso;
          const highlighted = isStart || isEnd || isSelectedSingle;
          const isFocused = focusedIso === iso;

          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.preventDefault();
                onDayClick(iso);
              }}
              onMouseEnter={() => onDayMouseEnter(iso)}
              className={`relative h-8 rounded text-xs transition-colors select-none ${
                isFocused
                  ? 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]'
                  : ''
              } ${
                cell.inMonth
                  ? 'text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)]/50'
              } ${highlighted ? '' : 'hover:bg-[var(--muted)]'}`}
              style={{
                background: highlighted
                  ? 'var(--primary)'
                  : inSelected
                    ? 'rgba(59,130,246,0.18)'
                    : undefined,
                color: highlighted
                  ? 'white'
                  : isToday
                    ? 'var(--primary)'
                    : undefined,
                fontWeight: highlighted || isToday ? 700 : undefined,
              }}
            >
              {cell.date.getDate()}
              {isToday && !highlighted && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{ background: 'var(--primary)' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Public DatePicker component ───────────────────────────────────────────

interface BaseProps {
  /** Optional label rendered above the trigger. */
  label?: string;
  /** Disable interaction. */
  disabled?: boolean;
  /** Custom CSS class for the trigger. */
  className?: string;
  /** Optional preset chips shown above the calendar. */
  presets?: DatePreset[];
  /** Placeholder shown when no value. */
  placeholder?: string;
  /** Optional ReactNode rendered inside the trigger before the value. */
  leadingIcon?: ReactNode;
  /** Pin the trigger to a specific min width. */
  minWidth?: number | string;
}

interface SingleProps extends BaseProps {
  mode?: 'single';
  value: IsoDate | null;
  onChange: (v: IsoDate | null) => void;
}

interface RangeProps extends BaseProps {
  mode: 'range';
  value: DateRange;
  onChange: (v: DateRange) => void;
}

export type DatePickerProps = SingleProps | RangeProps;

export function DatePicker(props: DatePickerProps) {
  const isRange = props.mode === 'range';
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Initial cursor month: anchor on whatever is selected, else today
  const initialCursor = useMemo(() => {
    if (isRange) {
      const r = (props as RangeProps).value;
      const anchor = fromIso(r.start) ?? fromIso(r.end) ?? new Date();
      return startOfMonth(anchor);
    }
    const v = (props as SingleProps).value;
    return startOfMonth(fromIso(v) ?? new Date());
    // intentionally only runs on mount of the popover open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [cursor, setCursor] = useState<Date>(initialCursor);
  useEffect(() => setCursor(initialCursor), [initialCursor]);

  // Range selection state (two-click pattern):
  //   null         = not yet picked anything in this cycle
  //   <IsoDate>    = picked the start, waiting for the end click
  const [pendingStart, setPendingStart] = useState<IsoDate | null>(null);
  const [hoverIso, setHoverIso] = useState<IsoDate | null>(null);
  // Keyboard focus inside the calendar grid. Initialized from the current
  // selection (or today) when the popover opens, then moved by the arrow
  // keys. Distinct from `pendingStart` / committed value.
  const [focusedIso, setFocusedIso] = useState<IsoDate | null>(null);

  // Derived "what is the picker showing right now" for range mode
  const rangeView: DateRange = isRange
    ? pendingStart != null
      ? { start: pendingStart, end: null }
      : (props as RangeProps).value
    : { start: null, end: null };

  // ─── Positioning ──
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 360;
    const margin = 8;

    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popoverWidth - margin);
    }
    let top = rect.bottom + 4;
    if (top + popoverHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - popoverHeight - 4);
    }
    setPopoverPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  // Initialize keyboard focus when the popover opens — selected date if we
  // have one, otherwise today.
  useEffect(() => {
    if (!open) {
      setFocusedIso(null);
      return;
    }
    if (isRange) {
      const r = (props as RangeProps).value;
      setFocusedIso(r.start ?? toIso(new Date()));
    } else {
      const v = (props as SingleProps).value;
      setFocusedIso(v ?? toIso(new Date()));
    }
    // Only run on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Outside click + Esc ──
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
      setPendingStart(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ─── Selection handlers ──
  const commitSingle = (iso: IsoDate | null) => {
    (props as SingleProps).onChange(iso);
    setOpen(false);
  };
  const commitRange = (next: DateRange) => {
    (props as RangeProps).onChange(next);
  };

  /**
   * Range mode is two-click: first click sets the start, second click sets
   * the end. Clicking the same day twice picks a single-day range. If the
   * second click is earlier than the first, we swap so start ≤ end.
   */
  const handleDayClick = (iso: IsoDate) => {
    if (!isRange) {
      commitSingle(iso);
      return;
    }
    if (pendingStart == null) {
      setPendingStart(iso);
      setHoverIso(iso);
      commitRange({ start: iso, end: null });
      return;
    }
    if (iso === pendingStart) {
      commitRange({ start: iso, end: iso });
      setPendingStart(null);
      setOpen(false);
      return;
    }
    const [start, end] =
      pendingStart < iso ? [pendingStart, iso] : [iso, pendingStart];
    commitRange({ start, end });
    setPendingStart(null);
    setOpen(false);
  };

  const handleDayMouseEnter = (iso: IsoDate) => {
    if (!isRange) return;
    setHoverIso(iso);
  };

  /**
   * Move the keyboard focus cursor by the given day delta and pull the
   * displayed month into view if the new focus crosses month boundaries.
   */
  const moveFocus = (deltaDays: number) => {
    const base = fromIso(focusedIso) ?? new Date();
    const next = new Date(base);
    next.setDate(base.getDate() + deltaDays);
    const nextIso = toIso(next);
    setFocusedIso(nextIso);
    if (
      next.getFullYear() !== cursor.getFullYear() ||
      next.getMonth() !== cursor.getMonth()
    ) {
      setCursor(startOfMonth(next));
    }
    if (isRange && pendingStart) setHoverIso(nextIso);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        break;
      case 'PageUp':
        e.preventDefault();
        setCursor((c) => addMonths(c, -1));
        break;
      case 'PageDown':
        e.preventDefault();
        setCursor((c) => addMonths(c, 1));
        break;
      case 'Home': {
        e.preventDefault();
        const base = fromIso(focusedIso) ?? new Date();
        const monday = new Date(base);
        monday.setDate(base.getDate() - base.getDay());
        setFocusedIso(toIso(monday));
        break;
      }
      case 'End': {
        e.preventDefault();
        const base = fromIso(focusedIso) ?? new Date();
        const sunday = new Date(base);
        sunday.setDate(base.getDate() + (6 - base.getDay()));
        setFocusedIso(toIso(sunday));
        break;
      }
      case 'Enter':
      case ' ':
        if (focusedIso) {
          e.preventDefault();
          handleDayClick(focusedIso);
        }
        break;
    }
  };

  // ─── Keyboard input field (manual entry fallback) ──
  const [singleText, setSingleText] = useState<string>('');
  const [rangeStartText, setRangeStartText] = useState<string>('');
  const [rangeEndText, setRangeEndText] = useState<string>('');

  useEffect(() => {
    if (isRange) {
      const r = (props as RangeProps).value;
      setRangeStartText(r.start ?? '');
      setRangeEndText(r.end ?? '');
    } else {
      setSingleText((props as SingleProps).value ?? '');
    }
  }, [open, isRange, props]);

  const tryCommitText = (text: string): IsoDate | null => {
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const d = fromIso(text);
    if (!d || isNaN(d.getTime())) return null;
    return text;
  };

  // ─── Trigger button display ──
  const triggerLabel = (() => {
    if (isRange) {
      const { start, end } = (props as RangeProps).value;
      // A single selected date (only start, or start === end) shows as one date.
      if (start && end && start !== end) return `${fmtShort(start)} – ${fmtShort(end)}`;
      if (start) return fmtShort(start);
      return props.placeholder ?? 'Select date range';
    }
    const v = (props as SingleProps).value;
    return v ? fmtDisplay(v) : (props.placeholder ?? 'Select date');
  })();

  const hasValue = isRange
    ? !!((props as RangeProps).value.start || (props as RangeProps).value.end)
    : !!(props as SingleProps).value;

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRange) {
      commitRange({ start: null, end: null });
      setPendingStart(null);
    } else {
      (props as SingleProps).onChange(null);
    }
  };

  return (
    <div className={props.label ? 'space-y-1.5' : undefined}>
      {props.label && (
        <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          {props.label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((o) => !o)}
        className={
          props.className ??
          'group w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] hover:border-[var(--primary)]/40 focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
        }
        style={props.minWidth ? { minWidth: props.minWidth } : undefined}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {props.leadingIcon ?? (
            <CalendarIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
          )}
          <span
            className={`truncate ${
              hasValue ? '' : 'text-[var(--muted-foreground)]'
            }`}
          >
            {triggerLabel}
          </span>
        </span>
        {hasValue && !props.disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onClick={handleClear}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </span>
        ) : null}
      </button>

      {open && popoverPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Date picker"
              data-datepicker-popover=""
              className="fixed z-[200] w-[320px] rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl p-3"
              style={{ top: popoverPos.top, left: popoverPos.left }}
            >
              {/* Presets */}
              {props.presets && props.presets.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {props.presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        if (isRange && preset.range) {
                          const r = preset.range();
                          commitRange(r);
                          setPendingStart(null);
                          setOpen(false);
                        } else if (!isRange && preset.single) {
                          commitSingle(preset.single());
                        }
                      }}
                      className="px-2 py-1 text-[11px] font-medium rounded-md border border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)]/10 hover:border-[var(--primary)]/40 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Month nav */}
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => setCursor((c) => addMonths(c, -1))}
                  className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <select
                    value={cursor.getMonth()}
                    onChange={(e) =>
                      setCursor(
                        new Date(cursor.getFullYear(), Number(e.target.value), 1),
                      )
                    }
                    className="text-sm font-bold bg-transparent border-none focus:outline-none cursor-pointer hover:text-[var(--primary)]"
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={cursor.getFullYear()}
                    onChange={(e) =>
                      setCursor(
                        new Date(Number(e.target.value), cursor.getMonth(), 1),
                      )
                    }
                    className="text-sm font-bold bg-transparent border-none focus:outline-none cursor-pointer hover:text-[var(--primary)]"
                  >
                    {Array.from({ length: 11 }, (_, i) => {
                      const yr = new Date().getFullYear() - 5 + i;
                      return (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setCursor((c) => addMonths(c, 1))}
                  className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Calendar */}
              <div
                onMouseLeave={() => setHoverIso(null)}
                onKeyDown={handleGridKeyDown}
                tabIndex={0}
                role="grid"
                aria-label="Calendar"
                className="focus:outline-none"
              >
                <CalendarMonth
                  cursor={cursor}
                  selectedStart={
                    isRange ? rangeView.start : (props as SingleProps).value
                  }
                  selectedEnd={isRange ? (props as RangeProps).value.end : null}
                  hoverEnd={hoverIso}
                  focusedIso={focusedIso}
                  isRange={isRange}
                  onDayClick={handleDayClick}
                  onDayMouseEnter={handleDayMouseEnter}
                />
              </div>

              {/* Manual entry + actions */}
              <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
                {isRange ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={rangeStartText}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRangeStartText(v);
                        const start = tryCommitText(v);
                        const cur = (props as RangeProps).value;
                        commitRange({ start, end: cur.end });
                      }}
                      className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--input)]"
                      aria-label="Start date"
                    />
                    <input
                      type="date"
                      value={rangeEndText}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRangeEndText(v);
                        const end = tryCommitText(v);
                        const cur = (props as RangeProps).value;
                        commitRange({ start: cur.start, end });
                      }}
                      className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--input)]"
                      aria-label="End date"
                    />
                  </div>
                ) : (
                  <input
                    type="date"
                    value={singleText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSingleText(v);
                      const iso = tryCommitText(v);
                      (props as SingleProps).onChange(iso);
                    }}
                    className="w-full px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--input)]"
                    aria-label="Date"
                  />
                )}
                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      if (isRange) {
                        commitRange({ start: null, end: null });
                        setPendingStart(null);
                      } else {
                        commitSingle(null);
                      }
                    }}
                    className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setPendingStart(null);
                    }}
                    className="text-[11px] font-semibold text-[var(--primary)] hover:underline"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
