'use client';

import * as React from 'react';
import { useEditor, findBlock } from './EditorContext';
import { BLOCK_SCHEMAS as componentSchemas, type PropSchema } from '../schemas';
import { FieldOptionsEditor } from './FieldOptionsEditor';
import {
  ChevronLeftIcon,
  AdjustmentsHorizontalIcon,
  PaintBrushIcon,
  PhotoIcon,
  Squares2X2Icon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';
import { MediaPickerModal } from '@/components/media-picker-modal';
import {
  AlignmentControl,
  ColorInput,
  CornerBox,
  NumberInput,
  SpacingBox,
  Switch,
  ToggleGroup,
} from './PropertyControls';
import { FORMATTING_PROP_KEYS, TOOLBAR_BLOCK_TYPES } from './FormattingToolbar';

type TabKey = 'content' | 'style' | 'layout';

const TAB_DEFS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'content', label: 'Content', icon: AdjustmentsHorizontalIcon },
  { key: 'style', label: 'Style', icon: PaintBrushIcon },
  { key: 'layout', label: 'Layout', icon: Squares2X2Icon },
];

const GROUP_TO_TAB: Record<string, TabKey> = {
  content: 'content',
  advanced: 'content',
  links: 'content',
  buttons: 'content',
  background: 'style',
  typography: 'style',
  style: 'style',
  border: 'style',
  'label-style': 'style',
  'input-style': 'style',
  layout: 'layout',
  spacing: 'layout',
};

export function BlockProperties() {
  const { template, selectedId, selectBlock, updateBlockProps } = useEditor();
  const selectedBlock = selectedId ? findBlock(template.blocks, selectedId) : null;
  const [activeTab, setActiveTab] = React.useState<TabKey>('content');

  if (!selectedBlock) return null;

  const schema = componentSchemas[selectedBlock.type];
  if (!schema) {
    return (
      <div className="p-4 text-xs text-[var(--muted-foreground)]">
        No schema for block type "{selectedBlock.type}".
      </div>
    );
  }

  // For block types that have a floating formatting toolbar, drop those props
  // from the sidebar (they're edited up there instead).
  const usesFormattingToolbar = TOOLBAR_BLOCK_TYPES.has(selectedBlock.type);
  const sidebarProps = usesFormattingToolbar
    ? schema.props.filter((p) => !FORMATTING_PROP_KEYS.has(p.key))
    : schema.props;

  // Group props by tab, then by sub-group within the tab
  const propsByTab = new Map<TabKey, PropSchema[]>();
  for (const prop of sidebarProps) {
    const tab = GROUP_TO_TAB[prop.group || 'content'] || 'content';
    if (!propsByTab.has(tab)) propsByTab.set(tab, []);
    propsByTab.get(tab)!.push(prop);
  }

  // Hide tabs that have no props
  const visibleTabs = TAB_DEFS.filter((t) => propsByTab.has(t.key));
  // If the active tab has no props, fall back to the first visible tab
  const effectiveTab = propsByTab.has(activeTab) ? activeTab : visibleTabs[0]?.key || 'content';
  const propsForTab = propsByTab.get(effectiveTab) || [];

  const handleChange = (key: string, value: unknown) => {
    updateBlockProps(selectedBlock.id, { [key]: value });
  };

  const handleSpacingChange = (
    prefix: 'padding' | 'margin',
    sides: { top: number; right: number; bottom: number; left: number },
  ) => {
    updateBlockProps(selectedBlock.id, {
      [`${prefix}Top`]: sides.top,
      [`${prefix}Right`]: sides.right,
      [`${prefix}Bottom`]: sides.bottom,
      [`${prefix}Left`]: sides.left,
    });
  };

  const handleCornerChange = (corners: { tl: number; tr: number; br: number; bl: number }) => {
    updateBlockProps(selectedBlock.id, {
      borderRadiusTopLeft: corners.tl,
      borderRadiusTopRight: corners.tr,
      borderRadiusBottomRight: corners.br,
      borderRadiusBottomLeft: corners.bl,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => selectBlock(null)}
          title="Back to components"
          className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-base font-semibold text-[var(--foreground)] capitalize">
          {schema.label}
        </span>
      </div>

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="flex border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 ${
                effectiveTab === key
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <PropertyList
          props={propsForTab}
          block={selectedBlock}
          schema={schema}
          onChange={handleChange}
          onSpacingChange={handleSpacingChange}
          onCornerChange={handleCornerChange}
        />

        {/* Choice fields (select/radio/checkbox) carry an `options` array
            that's edited via a dedicated repeater instead of a generic prop
            field. Show it only on the Content tab so it lives next to label
            + placeholder rather than under styling. */}
        {effectiveTab === 'content' && OPTIONS_FIELD_TYPES.has(selectedBlock.type) && (
          <div>
            <PropertyGroupHeader name="Options" />
            <div className="px-4 py-3">
              <FieldOptionsEditor
                options={
                  (Array.isArray(selectedBlock.props.options)
                    ? (selectedBlock.props.options as { label: string; value: string }[])
                    : [])
                }
                onChange={(options) => updateBlockProps(selectedBlock.id, { options })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const OPTIONS_FIELD_TYPES = new Set(['field_select', 'field_radio', 'field_checkbox']);

// ── Property group rendering — Elementor-style with section header bars ─

function PropertyGroupHeader({ name }: { name: string }) {
  return (
    <div className="px-4 pt-5 pb-2.5 border-t border-[var(--border)]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
        {name}
      </h4>
    </div>
  );
}

// ── Property list with smart-control selection ───────────────────────

interface PropertyListProps {
  props: PropSchema[];
  block: { id: string; type: string; props: Record<string, unknown> };
  schema: { props: PropSchema[] };
  onChange: (key: string, value: unknown) => void;
  onSpacingChange: (
    prefix: 'padding' | 'margin',
    sides: { top: number; right: number; bottom: number; left: number },
  ) => void;
  onCornerChange: (corners: { tl: number; tr: number; br: number; bl: number }) => void;
}

const CORNER_KEYS = [
  'borderRadiusTopLeft',
  'borderRadiusTopRight',
  'borderRadiusBottomRight',
  'borderRadiusBottomLeft',
];

function PropertyList({ props, block, schema, onChange, onSpacingChange, onCornerChange }: PropertyListProps) {
  const spacingPrefixes = detectSpacingGroups(schema.props);
  const hasCornerGroup = CORNER_KEYS.every((k) => schema.props.some((p) => p.key === k));

  const consumedKeys = new Set<string>();
  spacingPrefixes.forEach((prefix) => {
    ['Top', 'Right', 'Bottom', 'Left'].forEach((s) => consumedKeys.add(`${prefix}${s}`));
  });
  if (hasCornerGroup) {
    CORNER_KEYS.forEach((k) => consumedKeys.add(k));
  }

  // Group remaining props by their `group` field so we can render section headers between them
  const visibleProps = props.filter((p) => !consumedKeys.has(p.key));
  const grouped = new Map<string, PropSchema[]>();
  for (const p of visibleProps) {
    const g = p.group || 'general';
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(p);
  }

  const cornerInThisTab = props.some((p) => CORNER_KEYS.includes(p.key));
  const spacingInTab = Array.from(spacingPrefixes).filter((prefix) =>
    props.some((p) => getSpacingPrefix(p.key) === prefix),
  );

  return (
    <>
      {Array.from(grouped.entries()).map(([groupName, groupProps]) => (
        <div key={groupName}>
          <PropertyGroupHeader name={prettyGroupName(groupName)} />
          <div className="px-4 py-3 space-y-3">
            {groupProps.map((prop) => (
              <PropertyField
                key={prop.key}
                prop={prop}
                value={block.props[prop.key]}
                onChange={(v) => onChange(prop.key, v)}
              />
            ))}
          </div>
        </div>
      ))}

      {hasCornerGroup && cornerInThisTab && (
        <div>
          <PropertyGroupHeader name="Border Radius" />
          <div className="px-4 py-3">
            <CornerBox
              values={{
                tl: Number(block.props.borderRadiusTopLeft ?? block.props.borderRadius) || 0,
                tr: Number(block.props.borderRadiusTopRight ?? block.props.borderRadius) || 0,
                br: Number(block.props.borderRadiusBottomRight ?? block.props.borderRadius) || 0,
                bl: Number(block.props.borderRadiusBottomLeft ?? block.props.borderRadius) || 0,
              }}
              onChange={onCornerChange}
            />
          </div>
        </div>
      )}

      {spacingInTab.map((prefix) => (
        <div key={prefix}>
          <PropertyGroupHeader name={prefix === 'padding' ? 'Padding' : 'Margin'} />
          <div className="px-4 py-3">
            <SpacingBox
              values={{
                top: Number(block.props[`${prefix}Top`]) || 0,
                right: Number(block.props[`${prefix}Right`]) || 0,
                bottom: Number(block.props[`${prefix}Bottom`]) || 0,
                left: Number(block.props[`${prefix}Left`]) || 0,
              }}
              sides={detectSpacingSides(schema.props, prefix)}
              onChange={(sides) => onSpacingChange(prefix as 'padding' | 'margin', sides)}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function prettyGroupName(g: string): string {
  const map: Record<string, string> = {
    content: 'Content',
    advanced: 'Advanced',
    links: 'Links',
    buttons: 'Button',
    background: 'Background',
    border: 'Border',
    style: 'Style',
    typography: 'Typography',
    'label-style': 'Label',
    'input-style': 'Input',
    layout: 'Layout',
    spacing: 'Spacing',
    general: 'Settings',
  };
  return map[g] || g.charAt(0).toUpperCase() + g.slice(1);
}

function detectSpacingGroups(allProps: PropSchema[]): Set<string> {
  const groups = new Set<string>();
  const candidates = ['padding', 'margin'];
  for (const prefix of candidates) {
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const present = sides.filter((s) => allProps.some((p) => p.key === `${prefix}${s}`));
    // Merge into a SpacingBox if at least 2 sides exist (handles padding-4-side AND margin-2-side cases)
    if (present.length >= 2) groups.add(prefix);
  }
  return groups;
}

function detectSpacingSides(allProps: PropSchema[], prefix: string): ('top' | 'right' | 'bottom' | 'left')[] {
  const out: ('top' | 'right' | 'bottom' | 'left')[] = [];
  const map: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
    Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left',
  };
  for (const [suffix, side] of Object.entries(map)) {
    if (allProps.some((p) => p.key === `${prefix}${suffix}`)) out.push(side);
  }
  return out;
}

function getSpacingPrefix(key: string): string | null {
  const match = key.match(/^(padding|margin)(Top|Right|Bottom|Left)$/);
  return match ? match[1] : null;
}

// ── Single property field — picks the smart control based on prop shape ─

function PropertyField({
  prop,
  value,
  onChange,
}: {
  prop: PropSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const stringValue = value == null ? '' : String(value);

  const isAlignProp =
    prop.type === 'select' &&
    prop.options?.length === 3 &&
    prop.options.every((o) => ['left', 'center', 'right'].includes(String(o.value)));
  const isFontWeightProp = prop.key === 'fontWeight' && prop.type === 'select';
  const isToggle = prop.type === 'toggle';

  // Inline control types render label + control on the same row (Elementor pattern).
  // Wide inputs (text, textarea, color, url, image, sliders) stay stacked since they need full width.
  const isSliderProp =
    !!prop.slider && (prop.type === 'number' || prop.type === 'unit' || prop.type === 'range');
  const inline =
    !isSliderProp &&
    (isToggle ||
      isAlignProp ||
      isFontWeightProp ||
      prop.type === 'select' ||
      prop.type === 'number' ||
      prop.type === 'unit' ||
      prop.type === 'range');

  const control = (
    <PropertyInput
      prop={prop}
      stringValue={stringValue}
      value={value}
      onChange={onChange}
      isAlignProp={!!isAlignProp}
      isFontWeightProp={isFontWeightProp}
    />
  );

  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3 py-0.5">
        <Label prop={prop} />
        <div className="flex-shrink-0 w-[58%]">{control}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label prop={prop} />
      {control}
    </div>
  );
}

function Label({ prop }: { prop: PropSchema }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-[var(--foreground)] truncate">{prop.label}</span>
      <DeviceIndicator />
    </div>
  );
}

function PropertyInput({
  prop,
  stringValue,
  value,
  onChange,
  isAlignProp,
  isFontWeightProp,
}: {
  prop: PropSchema;
  stringValue: string;
  value: unknown;
  onChange: (v: unknown) => void;
  isAlignProp: boolean;
  isFontWeightProp: boolean;
}) {
  if (prop.type === 'toggle') {
    const checked = value === true || value === 'true';
    return <Switch checked={checked} onChange={(v) => onChange(v)} label={prop.label} />;
  }
  if (isAlignProp) {
    return (
      <AlignmentControl
        value={(stringValue || 'left') as 'left' | 'center' | 'right'}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (isFontWeightProp) {
    return (
      <ToggleGroup
        value={stringValue || '400'}
        onChange={(v) => onChange(v)}
        options={[
          { value: '400', label: 'Reg' },
          { value: '500', label: 'Med' },
          { value: '600', label: 'Semi' },
          { value: '700', label: 'Bold' },
        ]}
        size="sm"
      />
    );
  }
  if (prop.type === 'color') {
    return <ColorInput value={stringValue} onChange={(v) => onChange(v)} />;
  }
  if (prop.type === 'textarea') {
    return (
      <textarea
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={inputClass + ' resize-y font-[inherit]'}
        placeholder={prop.placeholder}
      />
    );
  }
  if (prop.type === 'select') {
    const isFontFamily = prop.key === 'fontFamily';
    return (
      <select
        value={stringValue}
        onChange={(e) => onChange(coerceSelectValue(e.target.value, prop.options))}
        className={inputClass}
        style={isFontFamily && stringValue ? { fontFamily: stringValue } : undefined}
      >
        <option value=""></option>
        {prop.options?.map((opt) => (
          <option
            key={String(opt.value)}
            value={String(opt.value)}
            style={isFontFamily ? { fontFamily: String(opt.value) } : undefined}
          >
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === 'number' || prop.type === 'unit' || prop.type === 'range') {
    return (
      <NumberInput
        value={stringValue}
        onChange={(v) => onChange(v)}
        min={prop.min}
        max={prop.max}
        unit={prop.type === 'unit' ? 'px' : ''}
        slider={prop.slider || prop.type === 'range'}
        sliderMax={prop.sliderMax}
      />
    );
  }
  if (prop.type === 'image') {
    return (
      <ImageProp
        value={stringValue}
        onChange={onChange}
        placeholder={prop.placeholder || 'https://...image.png'}
      />
    );
  }
  if (prop.type === 'url') {
    return (
      <input
        type="url"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={prop.placeholder || 'https://...'}
        className={inputClass}
      />
    );
  }
  return (
    <input
      type="text"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      placeholder={prop.placeholder}
      className={inputClass}
    />
  );
}

/**
 * Small computer-monitor icon next to property labels — Elementor pattern.
 * Currently visual-only (indicates "this prop applies to Desktop view"); future
 * iterations will wire it up to switch the prop into per-device override mode.
 */
function DeviceIndicator() {
  return (
    <span
      title="Editing for Desktop"
      className="inline-flex items-center text-[var(--muted-foreground)]/60 hover:text-[var(--foreground)] transition-colors cursor-default"
    >
      <ComputerDesktopIcon className="w-3.5 h-3.5" />
    </span>
  );
}

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

function coerceSelectValue(raw: string, options?: PropSchema['options']) {
  if (!options) return raw;
  const match = options.find((o) => String(o.value) === raw);
  return match ? match.value : raw;
}

/**
 * Image-prop control: URL text input + media library picker button.
 * Clicking the button opens the account-scoped MediaPickerModal;
 * picking a file writes its URL back via `onChange`. Account scope is
 * pulled from the editor context.
 */
function ImageProp({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const { accountKey } = useEditor();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  return (
    <>
      <div className="flex gap-1.5">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClass} flex-1 min-w-0`}
        />
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          title="Select from media library"
          aria-label="Select from media library"
          className="inline-flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-md border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-colors"
        >
          <PhotoIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
        </button>
      </div>
      {pickerOpen && (
        <MediaPickerModal
          accountKey={accountKey ?? undefined}
          onSelect={(url) => {
            onChange(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
