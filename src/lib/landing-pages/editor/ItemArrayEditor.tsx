'use client';

import * as React from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { PropSchema } from '../schemas';

interface ItemArrayEditorProps {
  /** Schema entry for the surrounding `item-array` prop. */
  prop: PropSchema;
  /** Current value of the array. May be undefined / non-array — we
   *  coerce defensively. */
  value: unknown;
  onChange: (next: Array<Record<string, unknown>>) => void;
}

/**
 * Generic editor for an array of objects — drives FAQ items,
 * FeatureGrid items, and LogoStrip logos from a single schema-driven
 * component. Each row collapses to its `itemLabelKey` field; clicking
 * the header expands the per-item field editor.
 *
 * No fancy drag-and-drop here yet — up/down arrows reorder, which is
 * enough for the common case of fewer than ~10 items.
 */
export function ItemArrayEditor({ prop, value, onChange }: ItemArrayEditorProps) {
  const items: Array<Record<string, unknown>> = Array.isArray(value)
    ? (value as Array<Record<string, unknown>>)
    : [];
  const labelKey = prop.itemLabelKey ?? 'heading';
  const noun = prop.itemNoun ?? 'item';
  const itemSchema = prop.itemSchema ?? [];

  const add = () => {
    onChange([...items, { ...(prop.itemDefault ?? {}) }]);
  };

  const update = (idx: number, patch: Record<string, unknown>) => {
    const next = items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    onChange(next);
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const move = (idx: number, direction: 'up' | 'down') => {
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= items.length) return;
    const next = [...items];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--muted-foreground)] py-2">
          No {noun}s yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <ItemRow
              key={idx}
              index={idx}
              total={items.length}
              item={item}
              labelKey={labelKey}
              itemSchema={itemSchema}
              onPatch={(patch) => update(idx, patch)}
              onMove={(dir) => move(idx, dir)}
              onRemove={() => remove(idx)}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={add}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Add {noun}
      </button>
    </div>
  );
}

function ItemRow({
  index,
  total,
  item,
  labelKey,
  itemSchema,
  onPatch,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  item: Record<string, unknown>;
  labelKey: string;
  itemSchema: PropSchema[];
  onPatch: (patch: Record<string, unknown>) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const labelValue = item[labelKey];
  const label =
    typeof labelValue === 'string' && labelValue.trim()
      ? labelValue
      : `Item ${index + 1}`;

  return (
    <li className="rounded-md border border-[var(--border)] bg-[var(--background)] overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left text-xs text-[var(--foreground)] truncate hover:text-[var(--primary)]"
          aria-expanded={open}
        >
          {label}
        </button>
        <IconButton
          label="Move up"
          disabled={index === 0}
          onClick={() => onMove('up')}
          icon={<ChevronUpIcon className="w-3 h-3" />}
        />
        <IconButton
          label="Move down"
          disabled={index === total - 1}
          onClick={() => onMove('down')}
          icon={<ChevronDownIcon className="w-3 h-3" />}
        />
        <IconButton
          label="Remove"
          onClick={onRemove}
          icon={<TrashIcon className="w-3 h-3 text-rose-400" />}
        />
      </div>

      {open && (
        <div className="px-2 py-2 border-t border-[var(--border)] space-y-2">
          {itemSchema.map((fieldProp) => (
            <ItemField
              key={fieldProp.key}
              prop={fieldProp}
              value={item[fieldProp.key]}
              onChange={(v) => onPatch({ [fieldProp.key]: v })}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
  );
}

const inputClass =
  'w-full px-2 py-1.5 text-xs bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

/**
 * Mini field editor for a single field inside an item. A subset of
 * what PropertyPanel renders for top-level props — keeps things
 * compact since item rows are nested inside the right panel.
 */
function ItemField({
  prop,
  value,
  onChange,
}: {
  prop: PropSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-0.5 uppercase tracking-wide">
      {prop.label}
    </label>
  );
  switch (prop.type) {
    case 'text':
    case 'url':
    case 'image':
      return (
        <div>
          {label}
          <input
            type={prop.type === 'url' ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
            placeholder={prop.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      );
    case 'textarea':
      return (
        <div>
          {label}
          <textarea
            rows={2}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </div>
      );
    default:
      return (
        <div>
          {label}
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      );
  }
}
