'use client';

import * as React from 'react';
import {
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  PaintBrushIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { useLandingPageEditor } from './EditorContext';
import { BLOCK_SCHEMA_BY_TYPE, type PropSchema } from '../schemas';
import { FormPickerInput } from './FormPickerInput';
import { ItemArrayEditor } from './ItemArrayEditor';
import { SLIDER_CLASS } from './slider-style';
import { SpacingBox } from '@/lib/forms/editor/PropertyControls';
import { effectiveProps, type Block, type LandingPageDevice } from '../types';

// Padding / margin in the LP editor always renders as the canonical
// SpacingBox (4 inputs in a row + link icon to lock sides). Detected
// by these key sets when bucketing the schema's `spacing` group.
const PADDING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const SPACING_PROP_KEYS = new Set<string>([...PADDING_KEYS, ...MARGIN_KEYS]);

// Pretty-print group names for the section headers. Mirrors the
// map the forms editor uses so the sidebar reads the same across
// editors (matching the visual cohesion ask).
const GROUP_LABELS: Record<string, string> = {
  content: 'Content',
  cta: 'Buttons',
  media: 'Media',
  items: 'Items',
  links: 'Links',
  background: 'Background',
  border: 'Border',
  style: 'Style',
  typography: 'Typography',
  layout: 'Layout',
  spacing: 'Spacing',
  behavior: 'Behavior',
  general: 'Settings',
};

function prettyGroupName(g: string): string {
  return GROUP_LABELS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
}

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
  const {
    template,
    selectedId,
    updateBlockProps,
    resetMobileOverrides,
    activeDevice,
  } = useLandingPageEditor();
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
        // The `spacing` sub-group splits into its own Padding +
        // Margin sections, each with the canonical SpacingBox.
        // Any non-padding/margin props in the spacing group (e.g.
        // a future `gap` field) render in a Spacing section after.
        if (group === 'spacing') {
          const extras = props.filter((p) => !SPACING_PROP_KEYS.has(p.key));
          return (
            <React.Fragment key={group}>
              <PropertyGroupHeader name="Margin" />
              <div className="px-4 py-3">
                <SpacingBox
                  values={readSides(block, 'margin', activeDevice)}
                  onChange={(sides) =>
                    updateBlockProps(block.id, {
                      marginTop: sides.top,
                      marginRight: sides.right,
                      marginBottom: sides.bottom,
                      marginLeft: sides.left,
                    })
                  }
                />
              </div>
              <PropertyGroupHeader name="Padding" />
              <div className="px-4 py-3">
                <SpacingBox
                  values={readSides(block, 'padding', activeDevice)}
                  onChange={(sides) =>
                    updateBlockProps(block.id, {
                      paddingTop: sides.top,
                      paddingRight: sides.right,
                      paddingBottom: sides.bottom,
                      paddingLeft: sides.left,
                    })
                  }
                />
              </div>
              {extras.length > 0 && (
                <>
                  <PropertyGroupHeader name="Spacing" />
                  <FieldGroup
                    block={block}
                    props={extras}
                    activeDevice={activeDevice}
                    onPropChange={(key, value) =>
                      updateBlockProps(block.id, { [key]: value })
                    }
                    onReset={(keys) => resetMobileOverrides(block.id, keys)}
                  />
                </>
              )}
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={group}>
            <PropertyGroupHeader name={prettyGroupName(group)} />
            <FieldGroup
              block={block}
              props={props}
              activeDevice={activeDevice}
              onPropChange={(key, value) =>
                updateBlockProps(block.id, { [key]: value })
              }
              onReset={(keys) => resetMobileOverrides(block.id, keys)}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * Section header bar matching the forms / email editor styling —
 * uppercase 11px font-semibold, top-border separator, foreground
 * text color. The sidebar feels uniform across editors with this.
 */
function PropertyGroupHeader({ name }: { name: string }) {
  return (
    <div className="px-4 pt-5 pb-2.5 border-t border-[var(--border)]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
        {name}
      </h4>
    </div>
  );
}

/**
 * Stack of property fields inside a section. Reads the effective
 * value for the active device so mobile preview shows mobile
 * overrides cascading over desktop. Labels surface a device icon
 * (monitor on desktop, phone on mobile) and a "reset to desktop"
 * button when a mobile override exists on the prop.
 */
function FieldGroup({
  block,
  props,
  activeDevice,
  onPropChange,
  onReset,
}: {
  block: Block;
  props: PropSchema[];
  activeDevice: LandingPageDevice;
  onPropChange: (key: string, value: unknown) => void;
  onReset: (keys: string[]) => void;
}) {
  const merged = effectiveProps(block, activeDevice);
  const overrides = (block.mobileProps ?? {}) as Record<string, unknown>;
  return (
    <div className="px-4 py-3 space-y-3">
      {props.map((p) => (
        <PropertyField
          key={p.key}
          prop={p}
          value={merged[p.key] ?? p.default}
          activeDevice={activeDevice}
          isOverridden={Object.prototype.hasOwnProperty.call(overrides, p.key)}
          onChange={(value) => onPropChange(p.key, value)}
          onReset={() => onReset([p.key])}
        />
      ))}
    </div>
  );
}

function PropertyField({
  prop,
  value,
  activeDevice,
  isOverridden,
  onChange,
  onReset,
}: {
  prop: PropSchema;
  value: unknown;
  activeDevice: LandingPageDevice;
  isOverridden: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
}) {
  const isSliderProp =
    !!prop.slider &&
    (prop.type === 'number' || prop.type === 'unit' || prop.type === 'range');
  const inline =
    !isSliderProp &&
    (prop.type === 'toggle' ||
      prop.type === 'select' ||
      prop.type === 'number' ||
      prop.type === 'unit' ||
      prop.type === 'range');

  const control = <PropEditor prop={prop} value={value} onChange={onChange} />;
  const label = (
    <PropLabel
      label={prop.label}
      activeDevice={activeDevice}
      isOverridden={isOverridden}
      onReset={onReset}
    />
  );

  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3 py-0.5">
        {label}
        <div className="flex-shrink-0 w-[58%]">{control}</div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {label}
      {control}
    </div>
  );
}

/**
 * Field label with a small device-context icon — monitor on
 * desktop, phone on mobile — and a "reset to desktop" button that
 * appears only when the active device is mobile AND the prop has a
 * mobile override (so resetting actually does something). Hovering
 * the device icon shows which layer the value is coming from.
 */
function PropLabel({
  label,
  activeDevice,
  isOverridden,
  onReset,
}: {
  label: string;
  activeDevice: LandingPageDevice;
  isOverridden: boolean;
  onReset: () => void;
}) {
  const showReset = activeDevice === 'mobile' && isOverridden;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-[var(--foreground)] truncate">
        {label}
      </span>
      <span
        title={
          activeDevice === 'mobile'
            ? isOverridden
              ? 'Mobile override — desktop unaffected'
              : 'Editing mobile (no override yet)'
            : 'Editing desktop'
        }
        className={`inline-flex items-center ${
          isOverridden && activeDevice === 'mobile'
            ? 'text-[var(--primary)]'
            : 'text-[var(--muted-foreground)]/60'
        }`}
      >
        {activeDevice === 'mobile' ? (
          <DevicePhoneMobileIcon className="w-3.5 h-3.5" />
        ) : (
          <ComputerDesktopIcon className="w-3.5 h-3.5" />
        )}
      </span>
      {showReset && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to desktop value"
          aria-label="Reset to desktop value"
          className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
        >
          <ArrowUturnLeftIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function readSides(
  block: Block,
  prefix: 'padding' | 'margin',
  device: LandingPageDevice,
) {
  const p = effectiveProps(block, device);
  const num = (key: string): number => (typeof p[key] === 'number' ? (p[key] as number) : 0);
  return {
    top: num(`${prefix}Top`),
    right: num(`${prefix}Right`),
    bottom: num(`${prefix}Bottom`),
    left: num(`${prefix}Left`),
  };
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

// PropEditor renders ONLY the control. The surrounding PropertyField
// owns the label (with device icon + reset affordance), so duplicating
// labels here would double them in stacked layout.
function PropEditor({ prop, value, onChange }: PropEditorProps) {
  switch (prop.type) {
    case 'text':
    case 'url':
      return (
        <input
          type={prop.type === 'url' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={prop.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      );

    case 'textarea':
      return (
        <textarea
          rows={3}
          value={typeof value === 'string' ? value : ''}
          placeholder={prop.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} resize-y`}
        />
      );

    case 'color':
      return (
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
      );

    case 'image':
      return (
        <input
          type="url"
          value={typeof value === 'string' ? value : ''}
          placeholder="https://…/image.jpg"
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      );

    case 'select':
      return (
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
      );

    case 'toggle':
      // Toggle is a special case — when used inline, the outer label
      // is hidden by PropertyField (toggle pairs are rendered with
      // their own internal "label · switch" layout). Render the
      // switch on the right with no label here.
      return (
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
      );

    case 'number':
    case 'range':
    case 'unit': {
      const numeric = typeof value === 'number' ? value : Number(value ?? prop.default ?? 0) || 0;
      if (prop.slider) {
        return (
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
        );
      }
      return (
        <input
          type="number"
          min={prop.min}
          max={prop.max}
          value={numeric}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className={inputClass}
        />
      );
    }

    case 'form-picker':
      return (
        <FormPickerInput
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );

    case 'item-array':
      return (
        <ItemArrayEditor
          prop={prop}
          value={value}
          onChange={(next) => onChange(next)}
        />
      );

    default:
      return null;
  }
}
