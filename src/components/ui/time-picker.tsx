'use client';

/**
 * Time-of-day picker — the DatePicker's sibling. Same trigger, same portal
 * popover, so a date and a time sitting side by side read as one control.
 *
 * Value is 24-hour `HH:mm` (what `<input type="time">` produced), so it drops
 * into code that used the native input without touching the parsing. The
 * popover shows it as hour / minute / AM-PM columns because that is how people
 * say a send time.
 *
 * Minutes step by `minuteStep` (default 5). A value off that grid — the
 * schedule step defaults to "now + a bit" — keeps its exact minute in the list
 * rather than being silently rounded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon } from '@heroicons/react/24/outline';

export type TimeValue = string; // 'HH:mm', 24-hour

function parse(v: TimeValue | null): { h24: number; m: number } | null {
  if (!v) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!match) return null;
  const h24 = Number(match[1]);
  const m = Number(match[2]);
  if (h24 > 23 || m > 59) return null;
  return { h24, m };
}

function format(h24: number, m: number): TimeValue {
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTimeLabel(v: TimeValue | null): string {
  const p = parse(v);
  if (!p) return '';
  const h12 = p.h24 % 12 === 0 ? 12 : p.h24 % 12;
  return `${h12}:${String(p.m).padStart(2, '0')} ${p.h24 < 12 ? 'AM' : 'PM'}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

interface TimePickerProps {
  value: TimeValue | null;
  onChange: (v: TimeValue) => void;
  minuteStep?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Replaces the trigger's default classes. */
  className?: string;
}

export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  placeholder = 'Select time',
  disabled,
  className,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const parsed = parse(value);
  const h24 = parsed?.h24 ?? 9;
  const minute = parsed?.m ?? 0;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const isPm = h24 >= 12;

  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  if (!minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort((a, b) => a - b);
  }

  const set = (next: { h12?: number; m?: number; pm?: boolean }) => {
    const nh12 = next.h12 ?? h12;
    const pm = next.pm ?? isPm;
    const nh24 = (nh12 % 12) + (pm ? 12 : 0);
    onChange(format(nh24, next.m ?? minute));
  };

  // ─── Positioning (mirrors DatePicker) ──
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 240);
    const height = 280;
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - 4);
    }
    setPos({ top, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  // ─── Outside click + Esc ──
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Bring the selected hour and minute into view when the popover opens.
  useEffect(() => {
    if (!open || !pos) return;
    popoverRef.current
      ?.querySelectorAll<HTMLElement>('[data-selected="true"]')
      .forEach((el) => el.scrollIntoView({ block: 'center' }));
    // Only on open; scrolling on every change would yank the column away
    // from the pointer mid-pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos !== null]);

  const cell = (selected: boolean) =>
    `w-full h-8 shrink-0 rounded text-xs tabular-nums transition-colors ${
      selected ? 'font-bold' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
    }`;
  const selectedStyle = { background: 'var(--primary)', color: 'var(--primary-foreground)' };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          className ??
          'w-full inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] hover:border-[var(--primary)]/40 focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        <ClockIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
        <span className={`truncate ${parsed ? '' : 'text-[var(--muted-foreground)]'}`}>
          {parsed ? formatTimeLabel(value) : placeholder}
        </span>
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Time picker"
              className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl p-2 animate-dropdown-in"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto pr-0.5" aria-label="Hour">
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      data-selected={h === h12}
                      onClick={() => set({ h12: h })}
                      className={cell(h === h12)}
                      style={h === h12 ? selectedStyle : undefined}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto pr-0.5" aria-label="Minute">
                  {minutes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-selected={m === minute}
                      onClick={() => set({ m })}
                      className={cell(m === minute)}
                      style={m === minute ? selectedStyle : undefined}
                    >
                      {String(m).padStart(2, '0')}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-0.5 w-12" aria-label="AM or PM">
                  {(['AM', 'PM'] as const).map((label) => {
                    const selected = (label === 'PM') === isPm;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => set({ pm: label === 'PM' })}
                        className={cell(selected)}
                        style={selected ? selectedStyle : undefined}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)] flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-[11px] font-semibold text-[var(--primary)] hover:underline"
                >
                  Done
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
