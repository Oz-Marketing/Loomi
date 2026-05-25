'use client';

import { useLandingPageEditor } from './EditorContext';
import { BLOCK_SCHEMA_BY_TYPE, type PropSchema } from '../schemas';
import { FormPickerInput } from './FormPickerInput';
import { ItemArrayEditor } from './ItemArrayEditor';
import { SLIDER_CLASS } from './slider-style';
import type { Block } from '../types';

/** Walk the block tree to find a block by id. Nested blocks (inside
 *  Section / column slots) are valid selections. */
function findBlockDeep(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const inner = findBlockDeep(b.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

/**
 * Block-properties view. Lives inside the left sidebar — the Sidebar
 * component owns the outer chrome (border, header, scroll). When no
 * block is selected, the sidebar shows the Content / Settings tabs
 * instead of this view, so this component never has to render an
 * "empty" state.
 */
export function BlockProperties() {
  const { template, selectedId, updateBlockProps } = useLandingPageEditor();
  const block = selectedId ? findBlockDeep(template.blocks, selectedId) : undefined;
  if (!block) return null;

  const schema = BLOCK_SCHEMA_BY_TYPE[block.type];
  if (!schema) {
    return (
      <p className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
        No schema registered for type <code>{block.type}</code>.
      </p>
    );
  }

  const grouped = schema.props.reduce<Record<string, PropSchema[]>>((acc, p) => {
    const key = p.group ?? 'general';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      {Object.entries(grouped).map(([group, props]) => (
        <div
          key={group}
          className="px-4 py-3 border-b border-[var(--border)] space-y-3 last:border-b-0"
        >
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            {group}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {props.map((p) => (
              <div key={p.key} className={p.half ? 'col-span-1' : 'col-span-2'}>
                <PropEditor
                  prop={p}
                  value={(block.props[p.key] as unknown) ?? p.default}
                  onChange={(value) => updateBlockProps(block.id, { [p.key]: value })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PropEditorProps {
  prop: PropSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}

function PropEditor({ prop, value, onChange }: PropEditorProps) {
  const label = (
    <label className="block text-[11px] font-medium text-[var(--foreground)] mb-1">
      {prop.label}
    </label>
  );

  switch (prop.type) {
    case 'text':
    case 'url':
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
            rows={3}
            value={typeof value === 'string' ? value : ''}
            placeholder={prop.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </div>
      );

    case 'color':
      return (
        <div>
          {label}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={typeof value === 'string' && value ? value : '#000000'}
              onChange={(e) => onChange(e.target.value)}
              className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer"
            />
            <input
              type="text"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#000000 or transparent"
              className={inputClass}
            />
          </div>
        </div>
      );

    case 'image':
      return (
        <div>
          {label}
          <input
            type="url"
            value={typeof value === 'string' ? value : ''}
            placeholder="https://…/image.jpg"
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      );

    case 'select':
      return (
        <div>
          {label}
          <select
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            onChange={(e) => {
              const opt = prop.options?.find((o) => String(o.value) === e.target.value);
              onChange(opt ? opt.value : e.target.value);
            }}
            className={inputClass}
          >
            {prop.options?.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'toggle':
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-[var(--foreground)]">
            {prop.label}
          </span>
          <button
            type="button"
            onClick={() => onChange(!value)}
            role="switch"
            aria-checked={Boolean(value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-[var(--primary)]' : 'bg-[var(--muted)] border border-[var(--border)]'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                value ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      );

    case 'number':
    case 'range':
    case 'unit': {
      const numeric = typeof value === 'number' ? value : Number(value ?? prop.default ?? 0) || 0;
      return (
        <div>
          {label}
          {prop.slider ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={prop.sliderMin ?? prop.min ?? 0}
                max={prop.sliderMax ?? prop.max ?? 200}
                value={numeric}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`flex-1 ${SLIDER_CLASS}`}
              />
              <input
                type="number"
                value={numeric}
                onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                className={`${inputClass} w-16 text-center`}
              />
            </div>
          ) : (
            <input
              type="number"
              min={prop.min}
              max={prop.max}
              value={numeric}
              onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
              className={inputClass}
            />
          )}
        </div>
      );
    }

    case 'form-picker':
      return (
        <div>
          {label}
          <FormPickerInput
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
          />
        </div>
      );

    case 'item-array':
      return (
        <div>
          {label}
          <ItemArrayEditor
            prop={prop}
            value={value}
            onChange={(next) => onChange(next)}
          />
        </div>
      );

    default:
      return null;
  }
}
