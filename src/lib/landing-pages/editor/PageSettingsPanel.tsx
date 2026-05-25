'use client';

import * as React from 'react';
import { useLandingPageEditor } from './EditorContext';
import { SLIDER_CLASS } from './slider-style';

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

const FONT_FAMILY_OPTIONS = [
  { label: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
];

/**
 * Page-level settings rendered inside the left sidebar's Settings
 * tab. Mirrors the forms editor's FormSettings panel structure —
 * stacked sections, schema-driven inputs, no outer chrome (the
 * Sidebar wraps everything in the same glass-card frame the rest of
 * the editor uses).
 */
export function PageSettingsPanel() {
  const { template, updateSettings } = useLandingPageEditor();
  const { settings } = template;

  return (
    <div>
      <Section name="Background">
        <Stacked label="Page Background">
          <ColorRow
            value={settings.bodyBg}
            onChange={(v) => updateSettings({ bodyBg: v })}
          />
        </Stacked>
        <Stacked label="Content Background">
          <ColorRow
            value={settings.contentBg}
            onChange={(v) => updateSettings({ contentBg: v })}
          />
        </Stacked>
      </Section>

      <Section name="Layout">
        <Stacked label="Content Width">
          <NumberRow
            value={settings.contentWidth}
            onChange={(v) => updateSettings({ contentWidth: v })}
            min={400}
            max={1440}
            unit="px"
          />
        </Stacked>
        <Stacked label="Border Radius">
          <NumberRow
            value={settings.contentBorderRadius ?? 0}
            onChange={(v) => updateSettings({ contentBorderRadius: v })}
            min={0}
            max={64}
            unit="px"
          />
        </Stacked>
      </Section>

      <Section name="Brand">
        <Stacked label="Primary Color">
          <ColorRow
            value={settings.primaryColor}
            onChange={(v) => updateSettings({ primaryColor: v })}
          />
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            Drives Hero/CTA buttons, accent dots, etc.
          </p>
        </Stacked>
      </Section>

      <Section name="Typography">
        <Stacked label="Default Font">
          <select
            value={settings.fontFamily}
            onChange={(e) => updateSettings({ fontFamily: e.target.value })}
            className={inputClass}
            style={{ fontFamily: settings.fontFamily }}
          >
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                {opt.label}
              </option>
            ))}
          </select>
        </Stacked>
        <Stacked label="Default Text Color">
          <ColorRow
            value={settings.textColor}
            onChange={(v) => updateSettings({ textColor: v })}
          />
        </Stacked>
      </Section>
    </div>
  );
}

function Section({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-[var(--border)] space-y-3 last:border-b-0">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
        {name}
      </h4>
      {children}
    </div>
  );
}

function Stacked({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[var(--foreground)] mb-1">{label}</label>
      {children}
    </div>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function NumberRow({
  value,
  onChange,
  min,
  max,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`flex-1 ${SLIDER_CLASS}`}
      />
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className={`${inputClass} w-16 text-center`}
        />
        <span className="text-[11px] text-[var(--muted-foreground)]">{unit}</span>
      </div>
    </div>
  );
}
