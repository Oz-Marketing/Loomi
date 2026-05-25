'use client';

import * as React from 'react';
import {
  AdjustmentsHorizontalIcon,
  PaintBrushIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { useLandingPageEditor } from './EditorContext';
import { BLOCK_SCHEMA_BY_TYPE, type PropSchema } from '../schemas';
import { FormPickerInput } from './FormPickerInput';
import { ItemArrayEditor } from './ItemArrayEditor';
import { SLIDER_CLASS } from './slider-style';
import { SpacingBox } from '@/lib/forms/editor/PropertyControls';
import type { Block } from '../types';

// Padding / margin in the LP editor always renders as the canonical
// SpacingBox (4 inputs in a row + link icon to lock sides). Detected
// by these key sets when bucketing the schema's `spacing` group.
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const SPACING_PROP_KEYS = new Set<string>([...PADDING_KEYS, ...MARGIN_KEYS]);

type PropertyTab = 'general' | 'styling' | 'advanced';

// Each schema's `group` field maps to one of three sidebar tabs.
// Unknown groups fall through to "general" so a typo can't hide
// props from the user — they'll just show up in the default tab.
const GROUP_TO_TAB: Record<string, PropertyTab> = {
  // General — what this block is showing.
  content: 'general',
  cta: 'general',
  media: 'general',
  items: 'general',
  links: 'general',
  // Styling — how it looks.
  layout: 'styling',
  style: 'styling',
  spacing: 'styling',
  typography: 'styling',
  // Advanced — behavior + escape hatches.
  behavior: 'advanced',
};

const TAB_DEFS: {
  key: PropertyTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'general', label: 'General', Icon: AdjustmentsHorizontalIcon },
  { key: 'styling', label: 'Styling', Icon: PaintBrushIcon },
  { key: 'advanced', label: 'Advanced', Icon: WrenchScrewdriverIcon },
];

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
 * block is selected, the sidebar shows the Content / Outline /
 * Settings tabs instead of this view, so this component never has
 * to render an "empty" state.
 *
 * Props are bucketed into General / Styling / Advanced pill tabs to
 * match the forms / email editors. Schemas opt in via their `group`
 * field (see GROUP_TO_TAB at the top of the file); unknown groups
 * fall through to General. Tabs with no props are hidden, and we
 * remember the active tab per-mount only — switching blocks resets
 * to whichever tab has props (preferring General).
 */
export function BlockProperties() {
  const { template, selectedId, updateBlockProps } = useLandingPageEditor();
  const block = selectedId ? findBlockDeep(template.blocks, selectedId) : undefined;
  const [activeTab, setActiveTab] = React.useState<PropertyTab>('general');

  // Reset the active tab when the selection changes so a new block
  // doesn't open onto an empty Advanced tab carried over from the
  // previous selection.
  const blockId = block?.id;
  React.useEffect(() => {
    setActiveTab('general');
  }, [blockId]);

  if (!block) return null;

  const schema = BLOCK_SCHEMA_BY_TYPE[block.type];
  if (!schema) {
    return (
      <p className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
        No schema registered for type <code>{block.type}</code>.
      </p>
    );
  }

  // Bucket every prop into one of the three tabs based on its
  // `group` field. Then group again WITHIN each tab so the in-tab
  // sub-section headers still render.
  const propsByTab = new Map<PropertyTab, PropSchema[]>();
  for (const p of schema.props) {
    const tab = GROUP_TO_TAB[p.group ?? 'content'] ?? 'general';
    const list = propsByTab.get(tab) ?? [];
    list.push(p);
    propsByTab.set(tab, list);
  }

  const visibleTabs = TAB_DEFS.filter((t) => propsByTab.has(t.key));
  // If the currently-active tab has no props for this block (e.g.
  // user was on Advanced, switched to a block with no advanced
  // props), fall back to whichever tab does.
  const effectiveTab = propsByTab.has(activeTab) ? activeTab : visibleTabs[0]?.key ?? 'general';
  const propsForTab = propsByTab.get(effectiveTab) ?? [];

  // Sub-group props inside the tab by their original `group` so the
  // section headers still divide the view (e.g. "media" / "layout"
  // within Styling).
  const subGroups = propsForTab.reduce<Record<string, PropSchema[]>>((acc, p) => {
    const key = p.group ?? 'general';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      {visibleTabs.length > 1 && (
        <PropertyTabsBar
          tabs={visibleTabs}
          active={effectiveTab}
          onChange={setActiveTab}
        />
      )}
      {Object.entries(subGroups).map(([group, props]) => {
        // The `spacing` group always renders as SpacingBoxes — one
        // for Margin (4 sides + link icon) and one for Padding
        // (same). Any spacing props the schema declares OUTSIDE
        // those 8 keys (e.g. Section's `gap`) still render through
        // the generic PropEditor below.
        if (group === 'spacing') {
          const extras = props.filter((p) => !SPACING_PROP_KEYS.has(p.key));
          return (
            <div
              key={group}
              className="px-4 py-3 border-b border-[var(--border)] space-y-4 last:border-b-0"
            >
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                {group}
              </h4>
              <SpacingGroup
                label="Margin"
                values={readSides(block, 'margin')}
                onChange={(sides) =>
                  updateBlockProps(block.id, {
                    marginTop: sides.top,
                    marginRight: sides.right,
                    marginBottom: sides.bottom,
                    marginLeft: sides.left,
                  })
                }
              />
              <SpacingGroup
                label="Padding"
                values={readSides(block, 'padding')}
                onChange={(sides) =>
                  updateBlockProps(block.id, {
                    paddingTop: sides.top,
                    paddingRight: sides.right,
                    paddingBottom: sides.bottom,
                    paddingLeft: sides.left,
                  })
                }
              />
              {extras.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {extras.map((p) => (
                    <div key={p.key} className={p.half ? 'col-span-1' : 'col-span-2'}>
                      <PropEditor
                        prop={p}
                        value={(block.props[p.key] as unknown) ?? p.default}
                        onChange={(value) => updateBlockProps(block.id, { [p.key]: value })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }
        return (
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
        );
      })}
    </div>
  );
}

function readSides(block: Block, prefix: 'padding' | 'margin') {
  const p = block.props as Record<string, unknown>;
  const num = (key: string): number => (typeof p[key] === 'number' ? (p[key] as number) : 0);
  return {
    top: num(`${prefix}Top`),
    right: num(`${prefix}Right`),
    bottom: num(`${prefix}Bottom`),
    left: num(`${prefix}Left`),
  };
}

function SpacingGroup({
  label,
  values,
  onChange,
}: {
  label: string;
  values: { top: number; right: number; bottom: number; left: number };
  onChange: (sides: { top: number; right: number; bottom: number; left: number }) => void;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[var(--foreground)] mb-1.5">{label}</div>
      <SpacingBox values={values} onChange={onChange} />
    </div>
  );
}

function PropertyTabsBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: PropertyTab; label: string; Icon: React.ComponentType<{ className?: string }> }[];
  active: PropertyTab;
  onChange: (next: PropertyTab) => void;
}) {
  return (
    <div className="px-3 pt-3 pb-2 border-b border-[var(--border)]">
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5">
        {tabs.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded transition-colors ${
                isActive
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>
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
