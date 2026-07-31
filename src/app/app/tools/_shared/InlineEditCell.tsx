'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePacerReadOnly } from './pacer-read-only';

// Same hover/focus chrome as the CellEditor triggers so an editable cell reads
// the same whether it opens a dropdown or turns into a field.
const triggerClass =
  'block w-[calc(100%+0.75rem)] -mx-1.5 -my-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/50';
// The field replaces the cell content in place, so it stays borderless and
// keeps the row height — only the ring marks it as active.
const fieldClass =
  'block w-[calc(100%+0.75rem)] -mx-1.5 -my-1 rounded-md bg-[var(--input)] px-1.5 py-1 text-[var(--foreground)] ring-1 ring-[var(--primary)] focus:outline-none';

/**
 * Text cell edited in place: click it and the text becomes an input right
 * there. Enter or blur commits, Escape reverts.
 *
 * Rows are HTML5-draggable, and a drag beginning on an input steals the
 * text selection — so the cell reports its editing state up to the row, which
 * drops its drag handlers while a field is open.
 */
export function InlineTextCell({
  value,
  placeholder,
  ariaLabel,
  display,
  disabled,
  inputClassName,
  onCommit,
  onEditingChange,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  /** Read-mode rendering of `value`. */
  display: ReactNode;
  disabled?: boolean;
  inputClassName?: string;
  onCommit: (next: string) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const readOnly = usePacerReadOnly();
  const locked = disabled || readOnly;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    onEditingChange?.(editing);
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // onEditingChange is a stable-enough callback from the row; re-running on
    // identity changes would spam the parent's state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (locked) return <div className="min-w-0">{display}</div>;

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
        className={`${fieldClass} ${inputClassName ?? 'text-sm font-semibold'}`}
      />
    );
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      aria-label={ariaLabel}
      className={triggerClass}
    >
      {display}
    </button>
  );
}

/**
 * Money cell edited in place — same interaction as {@link InlineTextCell} with
 * a `$` prefix and digits-only entry. Commits the raw string (or null when
 * cleared) so it lands on the ad exactly like the editor modal's DollarInput.
 */
export function InlineMoneyCell({
  value,
  ariaLabel,
  display,
  disabled,
  onCommit,
  onEditingChange,
}: {
  value: string | null;
  ariaLabel: string;
  display: ReactNode;
  disabled?: boolean;
  onCommit: (next: string | null) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const readOnly = usePacerReadOnly();
  const locked = disabled || readOnly;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    onEditingChange?.(editing);
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next !== (value ?? null)) onCommit(next);
  };
  const cancel = () => {
    setDraft(value ?? '');
    setEditing(false);
  };

  if (locked) return <div className="min-w-0">{display}</div>;

  if (editing) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
          $
        </span>
        <input
          ref={inputRef}
          value={draft}
          inputMode="decimal"
          aria-label={ariaLabel}
          placeholder="0.00"
          onChange={(e) => {
            const v = e.target.value;
            // Digits + one decimal point only — same rule as DollarInput.
            if (v === '' || /^\d*\.?\d*$/.test(v)) setDraft(v);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              cancel();
            }
          }}
          className={`${fieldClass} pl-4 text-xs font-semibold tabular-nums`}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      aria-label={ariaLabel}
      className={triggerClass}
    >
      {display}
    </button>
  );
}
