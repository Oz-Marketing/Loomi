'use client';

import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { usePacerReadOnly } from './pacer-read-only';
import { Tooltip } from './Tooltip';

// ─── Shared input chrome ───────────────────────────────────────────────────
export const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)] text-[var(--foreground)]';
// Drop-in for places where we render a value inside a Field but the field
// is read-only (computed totals, "N/A" placeholders, etc.). Borderless +
// transparent bg + muted text + no horizontal padding so the value sits
// flush with the Field's label, not indented like an editable input.
export const readonlyClass =
  'w-full py-2 text-sm bg-transparent text-[var(--muted-foreground)] cursor-default';
export const labelClass =
  'block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5';

export function DollarInput({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const readOnly = usePacerReadOnly();
  const hasValue = value != null && value !== '';
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)] pointer-events-none">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ''}
        disabled={readOnly}
        onChange={(e) => {
          const v = e.target.value;
          // Accept only digits + a single decimal point. Reject anything else
          // so the field stays numeric without using <input type="number">
          // (which adds the spinner arrows we want gone).
          if (v === '' || /^\d*\.?\d*$/.test(v)) onChange(v);
        }}
        placeholder={placeholder ?? '0.00'}
        className={`${inputClass} pl-6 ${hasValue && !readOnly ? 'pr-8' : ''} ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
      {hasValue && !readOnly && (
        <Tooltip
          label="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2"
        >
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear amount"
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function Field({
  label,
  color,
  children,
}: {
  label: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={labelClass} style={color ? { color } : undefined}>
        {label}
      </label>
      {children}
    </div>
  );
}
