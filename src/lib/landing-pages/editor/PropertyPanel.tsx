'use client';

import * as React from 'react';
import { useLandingPageEditor } from './EditorContext';
import { BLOCK_SCHEMA_BY_TYPE, type PropSchema } from '../schemas';
import { PageSettingsPanel } from './PageSettingsPanel';
import { FormPickerInput } from './FormPickerInput';
import { ItemArrayEditor } from './ItemArrayEditor';

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

/**
 * Right-hand panel. Shows the schema-driven property editor for the
 * selected block, or the page-level settings when nothing is selected.
 *
 * Inputs are minimal-but-functional — they cover every prop type the
 * schemas declare (text, textarea, color, url, image, select, toggle,
 * number, range, unit, form-picker). PR3 will polish these with the
 * same slider/stepper UX the forms PropertyControls module ships.
 */
export function PropertyPanel() {
  const { template, selectedId, updateBlockProps } = useLandingPageEditor();

  // Find selected block (top-level only for PR2 — nested editing is
  // a follow-up).
  const block = selectedId
    ? template.blocks.find((b) => b.id === selectedId)
    : null;

  if (!block) {
    return <PageSettingsPanel />;
  }

  const schema = BLOCK_SCHEMA_BY_TYPE[block.type];
  if (!schema) {
    return (
      <Panel title="Unknown block">
        <p className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
          No schema registered for type <code>{block.type}</code>.
        </p>
      </Panel>
    );
  }

  // Group props by `group` field so the panel reads as labelled
  // sections rather than a flat dump.
  const grouped = schema.props.reduce<Record<string, PropSchema[]>>((acc, p) => {
    const key = p.group ?? 'general';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <Panel title={schema.label}>
      {Object.entries(grouped).map(([group, props]) => (
        <div key={group} className="px-4 py-3 border-b border-[var(--border)] space-y-3 last:border-b-0">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            {group}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {props.map((p) => (
              <div key={p.key} className={p.half ? 'col-span-1' : 'col-span-2'}>
                <PropEditor
                  prop={p}
                  value={(block.props[p.key] as unknown) ?? p.default}
                  accountKey={undefined /* PR3 wires this when the picker needs scoping */}
                  onChange={(value) => updateBlockProps(block.id, { [p.key]: value })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--card)] border-l border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--card)] z-10">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

interface PropEditorProps {
  prop: PropSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  accountKey?: string;
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
                className="flex-1"
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
