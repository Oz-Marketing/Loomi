'use client';

import * as React from 'react';
import {
  Bars3BottomLeftIcon,
  Bars3Icon,
  Bars3BottomRightIcon,
  Bars3CenterLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  LinkIcon as LinkChainIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// ── Number with stepper + optional slider ──────────────────────────

export interface NumberInputProps {
  value: number | string;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Show a range slider above the input (Elementor pattern) */
  slider?: boolean;
  /** Slider track range (overrides min/max defaults of 0-200 when slider is on) */
  sliderMin?: number;
  sliderMax?: number;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = 'px',
  slider = false,
  sliderMin,
  sliderMax,
}: NumberInputProps) {
  const numeric = typeof value === 'number' ? value : Number(value) || 0;
  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  const trackMin = sliderMin ?? min ?? 0;
  const trackMax = sliderMax ?? max ?? 200;
  const sliderValue = Math.min(trackMax, Math.max(trackMin, numeric));

  const sliderClass =
    'h-1 cursor-pointer appearance-none rounded-full bg-[var(--border)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--card)] [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--primary)] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--card)] [&::-moz-range-thumb]:cursor-grab';

  if (slider) {
    // Inline: slider takes most of the row, compact number input on the right (Elementor pattern)
    return (
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          value={sliderValue}
          onChange={(e) => onChange(Number(e.target.value))}
          min={trackMin}
          max={trackMax}
          step={step}
          className={`flex-1 ${sliderClass}`}
        />
        <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-transparent focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)] transition-colors flex-shrink-0 w-[80px]">
          <input
            type="number"
            value={numeric}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === '' ? 0 : Number(v));
            }}
            min={min}
            max={max}
            step={step}
            className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-transparent text-[var(--foreground)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-[var(--muted-foreground)] pointer-events-none pr-2">{unit}</span>
        </div>
      </div>
    );
  }

  // Non-slider: full-width input with unit + stepper buttons on the right
  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-transparent focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)] transition-colors">
      <input
        type="number"
        value={numeric}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? 0 : Number(v));
        }}
        min={min}
        max={max}
        step={step}
        className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent text-[var(--foreground)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-xs text-[var(--muted-foreground)] pointer-events-none">{unit}</span>
      <div className="flex flex-col border-l border-[var(--border)]">
        <button
          type="button"
          onClick={() => onChange(clamp(numeric + step))}
          className="px-1.5 py-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          tabIndex={-1}
        >
          <ChevronUpIcon className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => onChange(clamp(numeric - step))}
          className="px-1.5 py-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          tabIndex={-1}
        >
          <ChevronDownIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Switch toggle (Elementor-style) ────────────────────────────────

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-1 ${
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-150 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}

// ── Toggle group (button row) ──────────────────────────────────────

export interface ToggleGroupProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ label: React.ReactNode; value: T; title?: string }>;
  size?: 'sm' | 'md';
}

export function ToggleGroup<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
}: ToggleGroupProps<T>) {
  const cellClass =
    size === 'sm'
      ? 'flex-1 inline-flex items-center justify-center h-8 text-xs font-medium transition-colors'
      : 'flex-1 inline-flex items-center justify-center h-9 text-sm font-medium transition-colors';

  return (
    <div className="flex rounded-md border border-[var(--border)] overflow-hidden bg-transparent">
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.title}
            className={`${cellClass} ${
              active
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            } ${i > 0 ? 'border-l border-[var(--border)]' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Alignment control (icon buttons) ───────────────────────────────

export interface AlignmentProps {
  value?: 'left' | 'center' | 'right';
  onChange: (value: 'left' | 'center' | 'right') => void;
}

export function AlignmentControl({ value = 'left', onChange }: AlignmentProps) {
  return (
    <ToggleGroup
      value={value}
      onChange={onChange}
      options={[
        { value: 'left', label: <Bars3BottomLeftIcon className="w-4 h-4" />, title: 'Align left' },
        { value: 'center', label: <Bars3Icon className="w-4 h-4" />, title: 'Align center' },
        { value: 'right', label: <Bars3BottomRightIcon className="w-4 h-4" />, title: 'Align right' },
      ]}
    />
  );
}

// ── Color input with swatches ──────────────────────────────────────

const DEFAULT_SWATCHES = [
  '#000000', '#1a1a1a', '#404040', '#737373',
  '#a3a3a3', '#d4d4d4', '#f5f5f5', '#ffffff',
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4',
];

export interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
  swatches?: string[];
}

export function ColorInput({ value, onChange, swatches = DEFAULT_SWATCHES }: ColorInputProps) {
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
    <div ref={ref} className="relative">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-10 h-9 rounded-md border border-[var(--border)] cursor-pointer flex-shrink-0"
          style={{ background: value || 'transparent' }}
          title="Pick color"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] font-mono transition-colors"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Clear"
            className="px-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-20 w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          <div className="grid grid-cols-8 gap-1.5 mb-3">
            {swatches.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="aspect-square rounded border border-[var(--border)] hover:scale-110 transition-transform"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <input
            type="color"
            value={value || '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-9 rounded-md cursor-pointer border border-[var(--border)]"
          />
        </div>
      )}
    </div>
  );
}

// ── Spacing box (4-corner padding/margin) ──────────────────────────

export interface SpacingBoxProps {
  values: { top?: number; right?: number; bottom?: number; left?: number };
  onChange: (values: { top: number; right: number; bottom: number; left: number }) => void;
  /** Sides that should be displayed (others render but disabled). Defaults to all 4. */
  sides?: ('top' | 'right' | 'bottom' | 'left')[];
}

export function SpacingBox({ values, onChange, sides = ['top', 'right', 'bottom', 'left'] }: SpacingBoxProps) {
  const top = values.top ?? 0;
  const right = values.right ?? 0;
  const bottom = values.bottom ?? 0;
  const left = values.left ?? 0;

  const allEqual = top === right && right === bottom && bottom === left;
  const [linked, setLinked] = React.useState(allEqual);

  const setSide = (side: keyof typeof values, n: number) => {
    if (linked) {
      onChange({ top: n, right: n, bottom: n, left: n });
    } else {
      onChange({
        top: side === 'top' ? n : top,
        right: side === 'right' ? n : right,
        bottom: side === 'bottom' ? n : bottom,
        left: side === 'left' ? n : left,
      });
    }
  };

  const cellInput = (side: 'top' | 'right' | 'bottom' | 'left', n: number) => {
    const enabled = sides.includes(side);
    return (
      <input
        type="number"
        value={n}
        onChange={(e) => setSide(side, Number(e.target.value) || 0)}
        disabled={!enabled}
        min={0}
        className="w-full h-8 text-sm text-center bg-transparent border border-[var(--border)] rounded text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    );
  };

  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
        {cellInput('top', top)}
        {cellInput('right', right)}
        {cellInput('bottom', bottom)}
        {cellInput('left', left)}
        <button
          type="button"
          onClick={() => setLinked((l) => !l)}
          title={linked ? 'Unlink sides' : 'Link sides'}
          className={`w-8 h-8 inline-flex items-center justify-center rounded transition-colors ${
            linked
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
          }`}
        >
          <LinkChainIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 mt-1.5 px-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">Top</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">Right</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">Bottom</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">Left</span>
        <span className="w-8" />
      </div>
    </div>
  );
}

// ── Corner box (4-corner border-radius) ────────────────────────────

export interface CornerBoxProps {
  values: { tl?: number; tr?: number; br?: number; bl?: number };
  onChange: (values: { tl: number; tr: number; br: number; bl: number }) => void;
}

export function CornerBox({ values, onChange }: CornerBoxProps) {
  const tl = values.tl ?? 0;
  const tr = values.tr ?? 0;
  const br = values.br ?? 0;
  const bl = values.bl ?? 0;

  const allEqual = tl === tr && tr === br && br === bl;
  const [linked, setLinked] = React.useState(allEqual);

  const setCorner = (corner: 'tl' | 'tr' | 'br' | 'bl', n: number) => {
    if (linked) {
      onChange({ tl: n, tr: n, br: n, bl: n });
    } else {
      onChange({
        tl: corner === 'tl' ? n : tl,
        tr: corner === 'tr' ? n : tr,
        br: corner === 'br' ? n : br,
        bl: corner === 'bl' ? n : bl,
      });
    }
  };

  const cellInput = (corner: 'tl' | 'tr' | 'br' | 'bl', n: number) => (
    <input
      type="number"
      value={n}
      onChange={(e) => setCorner(corner, Number(e.target.value) || 0)}
      min={0}
      className="w-full h-8 text-sm text-center bg-transparent border border-[var(--border)] rounded text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );

  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
        {cellInput('tl', tl)}
        {cellInput('tr', tr)}
        {cellInput('br', br)}
        {cellInput('bl', bl)}
        <button
          type="button"
          onClick={() => setLinked((l) => !l)}
          title={linked ? 'Unlink corners' : 'Link corners'}
          className={`w-8 h-8 inline-flex items-center justify-center rounded transition-colors ${
            linked
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)]'
          }`}
        >
          <LinkChainIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 mt-1.5 px-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">TL</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">TR</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">BR</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] text-center">BL</span>
        <span className="w-8" />
      </div>
    </div>
  );
}
