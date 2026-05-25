'use client';

import * as React from 'react';
import {
  Bars3BottomLeftIcon,
  Bars3Icon,
  Bars3BottomRightIcon,
} from '@heroicons/react/24/outline';
import { useEditor, findBlock } from './EditorContext';
import { ColorInput } from './PropertyControls';

const FONT_FAMILY_OPTIONS = [
  { label: 'System', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Lucida Sans', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Palatino', value: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { label: 'Garamond', value: 'Garamond, "Apple Garamond", serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", "Courier New", monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
];

const FONT_WEIGHT_OPTIONS = [
  { label: 'Thin', value: '100' },
  { label: 'Light', value: '300' },
  { label: 'Normal', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold', value: '700' },
  { label: 'Extra Bold', value: '800' },
  { label: 'Black', value: '900' },
];

const TEXT_TRANSFORM_OPTIONS: Array<{ value: string; label: string; title: string }> = [
  { value: 'none', label: 'Aa', title: 'No transform' },
  { value: 'uppercase', label: 'AA', title: 'Uppercase' },
  { value: 'lowercase', label: 'aa', title: 'Lowercase' },
  { value: 'capitalize', label: 'Aa', title: 'Capitalize' },
];

/** Property keys that move from the sidebar into this floating toolbar. */
export const FORMATTING_PROP_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'color',
  'textTransform',
  'letterSpacing',
  'lineHeight',
  'align',
]);

export const TOOLBAR_BLOCK_TYPES = new Set(['text', 'heading']);

export function FormattingToolbar() {
  const { template, selectedId, updateBlockProps } = useEditor();
  const block = selectedId ? findBlock(template.blocks, selectedId) : null;

  if (!block || !TOOLBAR_BLOCK_TYPES.has(block.type)) return null;

  const props = block.props as Record<string, unknown>;
  const set = (key: string, value: unknown) => updateBlockProps(block.id, { [key]: value });

  const fontFamily = String(props.fontFamily ?? '');
  const fontSize = Number(props.fontSize ?? 16);
  const fontWeight = String(props.fontWeight ?? '400');
  const color = String(props.color ?? '#1a1a1a');
  const align = String(props.align ?? 'left');
  const textTransform = String(props.textTransform ?? 'none');
  const lineHeight = String(props.lineHeight ?? '');
  const letterSpacing = props.letterSpacing == null ? '' : String(props.letterSpacing);

  return (
    // Outer wrapper: absolute, centered, doesn't block canvas pointer events
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      {/* Inner pill — uses the page bg variable at high opacity for solid contrast
          (so bright emails don't bleed through in dark mode) plus heavy backdrop-blur
          for the slight pass-through that remains. NOTE: do NOT add overflow-hidden
          here — child popovers (color picker) need to escape the pill bounds. */}
      <div
        className="pointer-events-auto flex items-stretch gap-0 bg-[var(--background)]/92 backdrop-blur-2xl backdrop-saturate-150 border border-[var(--border)] rounded-full shadow-xl max-w-[calc(100vw-2rem)]"
        // Stop drag/click events bubbling so they don't affect the canvas selection
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Font family */}
        <ToolbarSection>
          <select
            value={fontFamily}
            onChange={(e) => set('fontFamily', e.target.value)}
            className="h-9 pl-3 pr-2 text-xs bg-transparent text-[var(--foreground)] outline-none cursor-pointer min-w-[110px] max-w-[160px]"
            style={fontFamily ? { fontFamily } : undefined}
            title="Font family"
          >
            <option value="">Default font</option>
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                {opt.label}
              </option>
            ))}
          </select>
        </ToolbarSection>

        <Divider />

        {/* Font size */}
        <ToolbarSection>
          <div className="flex items-center px-2 h-9" title="Font size">
            <input
              type="number"
              value={fontSize}
              onChange={(e) => set('fontSize', Number(e.target.value) || 0)}
              className="w-10 text-sm bg-transparent text-[var(--foreground)] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={0}
            />
            <span className="text-[10px] text-[var(--muted-foreground)] ml-0.5">px</span>
          </div>
        </ToolbarSection>

        <Divider />

        {/* Font weight — dropdown */}
        <ToolbarSection>
          <select
            value={fontWeight}
            onChange={(e) => set('fontWeight', e.target.value)}
            className="h-9 pl-3 pr-2 text-xs bg-transparent text-[var(--foreground)] outline-none cursor-pointer min-w-[90px]"
            style={fontWeight ? { fontWeight: Number(fontWeight) } : undefined}
            title="Font weight"
          >
            {FONT_WEIGHT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ fontWeight: Number(opt.value) }}>
                {opt.label}
              </option>
            ))}
          </select>
        </ToolbarSection>

        <Divider />

        {/* Color */}
        <ColorButton value={color} onChange={(v) => set('color', v)} />

        <Divider />

        {/* Alignment */}
        <ToolbarButtonGroup
          value={align}
          onChange={(v) => set('align', v)}
          options={[
            { value: 'left', label: <Bars3BottomLeftIcon className="w-4 h-4" />, title: 'Align left' },
            { value: 'center', label: <Bars3Icon className="w-4 h-4" />, title: 'Align center' },
            { value: 'right', label: <Bars3BottomRightIcon className="w-4 h-4" />, title: 'Align right' },
          ]}
        />

        <Divider />

        {/* Text transform */}
        <ToolbarButtonGroup
          value={textTransform}
          onChange={(v) => set('textTransform', v)}
          options={TEXT_TRANSFORM_OPTIONS.map((opt) => ({
            value: opt.value,
            label: <span className="text-xs">{opt.label}</span>,
            title: opt.title,
          }))}
        />

        <Divider />

        {/* Line height */}
        <ToolbarSection>
          <div className="flex items-center px-2 h-9" title="Line height">
            <span className="text-[10px] text-[var(--muted-foreground)] mr-1">LH</span>
            <input
              type="text"
              value={lineHeight}
              onChange={(e) => set('lineHeight', e.target.value)}
              className="w-9 text-sm bg-transparent text-[var(--foreground)] outline-none text-center"
              placeholder="1.5"
            />
          </div>
        </ToolbarSection>

        <Divider />

        {/* Letter spacing */}
        <ToolbarSection>
          <div className="flex items-center px-2 h-9" title="Letter spacing">
            <span className="text-[10px] text-[var(--muted-foreground)] mr-1">LS</span>
            <input
              type="number"
              value={letterSpacing}
              onChange={(e) => set('letterSpacing', Number(e.target.value) || 0)}
              className="w-9 text-sm bg-transparent text-[var(--foreground)] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder="0"
            />
            <span className="text-[10px] text-[var(--muted-foreground)] ml-0.5">px</span>
          </div>
        </ToolbarSection>
      </div>
    </div>
  );
}

// ── Internal building blocks ──────────────────────────────────────

function Divider() {
  return <span className="w-px self-stretch bg-[var(--border)]" />;
}

function ToolbarSection({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center">{children}</div>;
}

function ToolbarButtonGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
}) {
  return (
    <div className="flex items-stretch">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.title}
            className={`h-9 w-9 inline-flex items-center justify-center transition-colors ${
              active
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-9 w-9 inline-flex items-center justify-center hover:bg-[var(--muted)] transition-colors"
        title="Text color"
      >
        <span
          className="w-5 h-5 rounded-full border border-[var(--border)]"
          style={{ background: value || 'transparent' }}
        />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-40 w-[260px] rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl p-2">
          <ColorInput value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
