'use client';

import * as React from 'react';
import { useEditor } from './EditorContext';
import { ColorInput, NumberInput } from './PropertyControls';
import { ComputerDesktopIcon } from '@heroicons/react/24/outline';

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

const FONT_FAMILY_OPTIONS = [
  { label: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
];

export function FormSettings() {
  const { template, updateSettings, updateTitle } = useEditor();
  const { settings } = template;

  return (
    <div>
      {/* General */}
      <SectionHeader name="General" />
      <div className="px-4 py-3 space-y-3">
        <StackedField label="Form Name">
          <input
            type="text"
            value={template.title || ''}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="Untitled form"
            className={inputClass}
          />
        </StackedField>
      </div>

      {/* Background */}
      <SectionHeader name="Background" />
      <div className="px-4 py-3 space-y-3">
        <StackedField label="Page Background">
          <ColorInput
            value={settings.bodyBg}
            onChange={(v) => updateSettings({ bodyBg: v })}
          />
        </StackedField>
        <StackedField label="Form Background">
          <ColorInput
            value={settings.contentBg}
            onChange={(v) => updateSettings({ contentBg: v })}
          />
        </StackedField>
      </div>

      {/* Layout */}
      <SectionHeader name="Layout" />
      <div className="px-4 py-3 space-y-3">
        <StackedField label="Form Width">
          <NumberInput
            value={settings.contentWidth}
            onChange={(v) => updateSettings({ contentWidth: v })}
            min={320}
            max={1024}
            unit="px"
            slider
            sliderMin={400}
            sliderMax={1024}
          />
        </StackedField>
        <StackedField label="Content Padding">
          <NumberInput
            value={settings.contentPadding ?? 32}
            onChange={(v) => updateSettings({ contentPadding: v })}
            min={0}
            max={96}
            unit="px"
            slider
            sliderMin={0}
            sliderMax={96}
          />
        </StackedField>
        <StackedField label="Form Margin">
          <NumberInput
            value={settings.contentMargin ?? 32}
            onChange={(v) => updateSettings({ contentMargin: v })}
            min={0}
            max={96}
            unit="px"
            slider
            sliderMin={0}
            sliderMax={96}
          />
        </StackedField>
      </div>

      {/* Typography */}
      <SectionHeader name="Typography" />
      <div className="px-4 py-3 space-y-3">
        <InlineField label="Default Font">
          <select
            value={settings.fontFamily}
            onChange={(e) => updateSettings({ fontFamily: e.target.value })}
            className={inputClass}
            style={settings.fontFamily ? { fontFamily: settings.fontFamily } : undefined}
          >
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
                {opt.label}
              </option>
            ))}
          </select>
        </InlineField>
        <StackedField label="Default Text Color">
          <ColorInput
            value={settings.textColor}
            onChange={(v) => updateSettings({ textColor: v })}
          />
        </StackedField>
      </div>
    </div>
  );
}

function SectionHeader({ name }: { name: string }) {
  return (
    <div className="px-4 pt-5 pb-2.5 border-t border-[var(--border)]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
        {name}
      </h4>
    </div>
  );
}

function StackedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label name={label} />
      {children}
    </div>
  );
}

function InlineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <Label name={label} />
      <div className="flex-shrink-0 w-[58%]">{children}</div>
    </div>
  );
}

function Label({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-[var(--foreground)] truncate">{name}</span>
      <span
        title="Editing for Desktop"
        className="inline-flex items-center text-[var(--muted-foreground)]/60 hover:text-[var(--foreground)] transition-colors cursor-default"
      >
        <ComputerDesktopIcon className="w-3.5 h-3.5" />
      </span>
    </div>
  );
}
