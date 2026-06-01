'use client';

import * as React from 'react';
import { useEditor } from './EditorContext';
import { ColorInput, NumberInput } from './PropertyControls';
import { ComputerDesktopIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { AiVariantsPopover } from './AiVariantsPopover';
import { extractTemplateText } from './template-text';

const inputClass =
  'w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors';

// Same email-safe stacks the per-block Font Family dropdown uses
const FONT_FAMILY_OPTIONS = [
  { label: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
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

export function EmailSettings() {
  const { template, updateSettings, updateMeta } = useEditor();
  const { settings } = template;

  // Two separate popovers — they can't be open at the same time and
  // each anchors against its own sparkles button. The fetchers close
  // over `template` so they always pull the latest body text + meta.
  const [openPicker, setOpenPicker] = React.useState<'subject' | 'preview' | null>(null);
  const subjectAnchorRef = React.useRef<HTMLButtonElement>(null);
  const previewAnchorRef = React.useRef<HTMLButtonElement>(null);

  const fetchMeta = React.useCallback(
    async (field: 'subject' | 'previewText', brief: string): Promise<string[]> => {
      const bodyText = extractTemplateText(template).join('\n\n');
      const res = await fetch('/api/ai/generate-email-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          emailTextContent: bodyText,
          currentSubject: template.subject || '',
          currentPreviewText: template.preheader || '',
          brief,
          count: 3,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'AI request failed');
      return Array.isArray(data.results) ? data.results : [];
    },
    [template],
  );

  return (
    <div>
      {/* General — subject + preheader */}
      <SectionHeader name="General" />
      <div className="px-4 py-3 space-y-3">
        <StackedField
          label="Subject Line"
          action={
            <SparklesButton
              ref={subjectAnchorRef}
              onClick={() => setOpenPicker(openPicker === 'subject' ? null : 'subject')}
              active={openPicker === 'subject'}
            />
          }
        >
          <input
            type="text"
            value={template.subject || ''}
            onChange={(e) => updateMeta({ subject: e.target.value })}
            placeholder="Welcome…"
            className={inputClass}
          />
        </StackedField>
        <StackedField
          label="Preview Text"
          action={
            <SparklesButton
              ref={previewAnchorRef}
              onClick={() => setOpenPicker(openPicker === 'preview' ? null : 'preview')}
              active={openPicker === 'preview'}
            />
          }
        >
          <input
            type="text"
            value={template.preheader || ''}
            onChange={(e) => updateMeta({ preheader: e.target.value })}
            placeholder="Inbox preview"
            className={inputClass}
          />
        </StackedField>
      </div>

      <AiVariantsPopover
        open={openPicker === 'subject'}
        onClose={() => setOpenPicker(null)}
        anchorRef={subjectAnchorRef}
        title="Subject line ideas"
        enableBrief
        fetcher={(brief) => fetchMeta('subject', brief)}
        onPick={(text) => updateMeta({ subject: text })}
      />
      <AiVariantsPopover
        open={openPicker === 'preview'}
        onClose={() => setOpenPicker(null)}
        anchorRef={previewAnchorRef}
        title="Preview text ideas"
        enableBrief
        fetcher={(brief) => fetchMeta('previewText', brief)}
        onPick={(text) => updateMeta({ preheader: text })}
      />

      {/* Background */}
      <SectionHeader name="Background" />
      <div className="px-4 py-3 space-y-3">
        <StackedField label="Body Background">
          <ColorInput
            value={settings.bodyBg}
            onChange={(v) => updateSettings({ bodyBg: v })}
          />
        </StackedField>
        <StackedField label="Content Background">
          <ColorInput
            value={settings.contentBg}
            onChange={(v) => updateSettings({ contentBg: v })}
          />
        </StackedField>
      </div>

      {/* Layout */}
      <SectionHeader name="Layout" />
      <div className="px-4 py-3 space-y-3">
        <StackedField label="Content Width">
          <NumberInput
            value={settings.contentWidth}
            onChange={(v) => updateSettings({ contentWidth: v })}
            min={320}
            max={800}
            unit="px"
            slider
            sliderMin={400}
            sliderMax={800}
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

// ── Internal components ──

function SectionHeader({ name }: { name: string }) {
  return (
    <div className="px-4 pt-5 pb-2.5 border-t border-[var(--border)]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
        {name}
      </h4>
    </div>
  );
}

function StackedField({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  /** Optional inline-right control rendered next to the label —
   *  primarily for the AI sparkles button. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label name={label} />
        {action}
      </div>
      {children}
    </div>
  );
}

const SparklesButton = React.forwardRef<
  HTMLButtonElement,
  { onClick: () => void; active: boolean }
>(function SparklesButton({ onClick, active }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title="Generate suggestions with AI"
      aria-label="Generate suggestions with AI"
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${
        active
          ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)]'
      }`}
    >
      <SparklesIcon className="w-3.5 h-3.5" />
    </button>
  );
});

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
