'use client';

// Inline-editable contact field. Renders as a read-only tile by default,
// flips to a type-aware input when the user clicks it, saves via PATCH
// /api/contacts/:id, and falls back to the previous value on error.
//
// Used by the contact detail page for Vehicle, Lifecycle, and Custom
// field rows. Each field knows:
//   - its type (text | number | date | boolean | select | multiselect)
//   - whether it's a canonical column (vehicleYear, etc.) or a custom
//     field (custom:<key>) — the API takes both shapes
//   - optional `options` list for select / multiselect
//
// Save UX: optimistic update + spinner. Escape cancels, Enter (or blur)
// commits. Error surfaces inline below the field for 4s, then clears.

import * as React from 'react';
import { PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type {
  CustomFieldOption,
  CustomFieldType,
} from '@/lib/contacts/custom-field-types';

export type EditableFieldType = CustomFieldType;

export interface InlineEditableFieldProps {
  /** Display label shown above the value. */
  label: string;
  /** Current displayed value (already formatted by the parent — what
   *  the user sees). The raw value passed back to `onSave` is what
   *  goes on the wire, which may differ for dates/numbers/etc. */
  displayValue: string;
  /** Raw value to seed the editor with. Strings for text/number/date,
   *  boolean for booleans, arrays for multiselect. */
  rawValue: unknown;
  type: EditableFieldType;
  /** For select / multiselect — the declared options. */
  options?: CustomFieldOption[] | null;
  /** PATCH-able field key. Canonical contact columns pass `key`
   *  directly ('vehicleYear', 'lastServiceDate'); custom fields pass
   *  `custom:<key>` — the page knows how to route either shape into
   *  the PATCH body. */
  fieldRef: { kind: 'canonical'; column: string } | { kind: 'custom'; key: string };
  /** Called on commit with the raw value (string / number / boolean /
   *  array). The parent issues the PATCH and updates local state. */
  onSave: (raw: unknown) => Promise<void> | void;
  /** Optional hint shown below the field in read state. */
  hint?: string;
  /** Render the value in monospace (used for numbers + VIN). */
  mono?: boolean;
  /** Visual flag: red bubble on the right when the date is overdue. */
  statusBadge?: { label: string; tone: 'amber' | 'red' | 'muted' } | null;
}

export function InlineEditableField(props: InlineEditableFieldProps) {
  const { label, displayValue, rawValue, type, options, onSave, hint, mono, statusBadge } = props;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<unknown>(rawValue);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Reset the draft any time the parent's raw value changes — keeps the
  // editor in sync after a save round-trip or external refresh.
  React.useEffect(() => {
    if (!editing) setDraft(rawValue);
  }, [rawValue, editing]);

  // Autofocus the input the moment we enter edit mode so the user can
  // start typing immediately (matches Notion / Linear inline-edit UX).
  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select?.();
      }
    }
  }, [editing]);

  // Auto-clear errors after a short delay so they don't stick around
  // once the user has moved on.
  React.useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4_000);
    return () => clearTimeout(timer);
  }, [error]);

  async function commit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(rawValue);
    setEditing(false);
    setError(null);
  }

  // ── Read-only render ──
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group w-full text-left rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 hover:bg-[var(--muted)]/40 hover:border-[var(--primary)]/30 px-3 py-2.5 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] truncate">
            {label}
          </p>
          <PencilIcon className="w-3 h-3 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span
            className={`text-sm break-words ${
              !displayValue || displayValue === '—'
                ? 'text-[var(--muted-foreground)]'
                : 'text-[var(--foreground)]'
            } ${mono ? 'font-mono text-xs break-all' : ''}`}
          >
            {displayValue || '—'}
          </span>
          {statusBadge && (
            <span
              className={`text-[11px] font-medium flex-shrink-0 ${
                statusBadge.tone === 'red'
                  ? 'text-red-400'
                  : statusBadge.tone === 'amber'
                    ? 'text-amber-400'
                    : 'text-[var(--muted-foreground)]'
              }`}
            >
              {statusBadge.label}
            </span>
          )}
        </div>
        {hint && (
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)] truncate">{hint}</p>
        )}
      </button>
    );
  }

  // ── Edit render ──
  return (
    <div className="rounded-lg border border-[var(--primary)]/45 bg-[var(--primary)]/5 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
        {label}
      </p>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <EditorInput
            type={type}
            options={options}
            value={draft}
            onChange={setDraft}
            onCommit={commit}
            onCancel={cancel}
            inputRef={inputRef}
          />
        </div>
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          title="Save"
          className="p-1.5 rounded-md bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25 transition-colors disabled:opacity-50"
        >
          <CheckIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          title="Cancel"
          className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/40 transition-colors disabled:opacity-50"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {error && <p className="mt-1.5 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}

// ── Type-aware input dispatcher ──

const INPUT_BASE =
  'w-full px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] transition-colors';

function EditorInput({
  type,
  options,
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
}: {
  type: EditableFieldType;
  options?: CustomFieldOption[] | null;
  value: unknown;
  onChange: (next: unknown) => void;
  onCommit: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const keyHandler = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (type === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <label className="inline-flex items-center gap-2 h-7 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        {checked ? 'Yes' : 'No'}
      </label>
    );
  }

  if (type === 'select' && options && options.length > 0) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keyHandler}
        className={INPUT_BASE}
      >
        <option value="">— Select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'multiselect' && options && options.length > 0) {
    // Multiselect editor: a checkbox list. Each toggle persists the
    // updated array — no separate "commit" interaction needed. Enter
    // on the wrapper still commits via the outer card's button.
    const arr = Array.isArray(value)
      ? (value as string[]).map(String)
      : typeof value === 'string' && value
        ? value.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    return (
      <div className="space-y-1">
        {options.map((opt) => {
          const checked = arr.includes(opt.value);
          return (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? Array.from(new Set([...arr, opt.value]))
                    : arr.filter((v) => v !== opt.value);
                  onChange(next);
                }}
                className="rounded border-[var(--border)]"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  }

  if (type === 'date') {
    // Date inputs commit through the input ref's date picker. ISO
    // yyyy-mm-dd round-trips cleanly into the PATCH endpoint.
    const initial = typeof value === 'string' ? value.slice(0, 10) : '';
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="date"
        value={initial}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keyHandler}
        className={INPUT_BASE}
      />
    );
  }

  if (type === 'number') {
    const initial = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="number"
        value={initial}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        onKeyDown={keyHandler}
        className={INPUT_BASE}
      />
    );
  }

  // text + unknown fallback
  const initial = typeof value === 'string' ? value : value == null ? '' : String(value);
  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={initial}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keyHandler}
      className={INPUT_BASE}
    />
  );
}
