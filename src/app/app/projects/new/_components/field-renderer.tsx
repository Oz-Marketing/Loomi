'use client';

import { MultiSelect } from '@/components/ui/multi-select';
import { DatePicker } from '@/components/ui/date-picker';
import type { FieldDef } from '@/lib/projects/ui';

// Renders a single config-driven intake field (per-type field or billing). A
// <div> wrapper, NOT <label>, so clicks don't forward to the first control
// (same trap as the main Field component).

const INPUT = '!bg-[var(--background)] !rounded-lg !px-3 !py-2 !text-sm';

// Trigger class so the DatePicker matches the form's `.loomi-input` fields
// (page background, rounded-lg, py-2 px-3, text-sm). Shared with the form's
// run-range + due-date pickers.
export const DATE_TRIGGER =
  'group w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--primary)] focus:outline-none focus:border-[var(--primary)] transition-colors';

export type FieldValue = string | string[] | boolean | undefined;

export function FieldRenderer({
  field,
  value,
  onChange,
  accentColor,
}: {
  field: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  accentColor?: string;
}) {
  let control: React.ReactNode;

  switch (field.input) {
    case 'multiselect':
      control = (
        <MultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder="Select…"
          accentColor={accentColor}
          className={INPUT}
        />
      );
      break;
    case 'longtext':
      control = (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="loomi-input resize-y"
        />
      );
      break;
    case 'number':
      control = (
        <input
          type="number"
          inputMode="decimal"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            // Accept only empty or a plain number — rejects "1e5", "--", etc.
            const v = e.target.value;
            if (v === '' || /^-?\d*\.?\d*$/.test(v)) onChange(v);
          }}
          className="loomi-input"
        />
      );
      break;
    case 'date':
      control = (
        <DatePicker
          mode="single"
          value={typeof value === 'string' && value ? value : null}
          onChange={(v) => onChange(v ?? '')}
          placeholder="Select date"
          className={DATE_TRIGGER}
        />
      );
      break;
    case 'toggle':
      control = (
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
            value ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
              value ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      );
      break;
    default:
      control = (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="loomi-input"
        />
      );
  }

  return (
    <div className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
        {field.label}
        {field.required && <span className="text-[var(--primary)]">*</span>}
        {field.hint && (
          <span className="font-normal text-[11px] text-[var(--muted-foreground)]">— {field.hint}</span>
        )}
      </span>
      {control}
    </div>
  );
}
