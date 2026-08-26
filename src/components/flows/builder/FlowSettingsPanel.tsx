'use client';

import { useEffect, useState } from 'react';
import { XMarkIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import type { FlowSettings } from './types';
import { FlowSettingsFields } from '../flow-settings-form';

// Floating flow-level settings panel. Rendered inside BuilderPopout
// when the cog button in the top-right of the canvas is clicked.
// Mutates a local draft state on every change; commits via PATCH on
// blur of the panel (Save button) or when the user closes the panel.

interface FlowSettingsPanelProps {
  flowId: string;
  initial: FlowSettings;
  onSaved: (next: FlowSettings) => void;
  onClose: () => void;
}

export function FlowSettingsPanel({
  flowId,
  initial,
  onSaved,
  onClose,
}: FlowSettingsPanelProps) {
  const [draft, setDraft] = useState<FlowSettings>(initial);
  const [saving, setSaving] = useState(false);

  // Sync draft if the upstream prop changes (rare — flow reload, etc).
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Settings save failed');
        return;
      }
      onSaved(draft);
      toast.success('Flow settings saved');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[var(--muted)] flex items-center justify-center flex-shrink-0">
            <Cog6ToothIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
              Flow settings
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate">
              Defaults applied to every enrollment in this flow
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex items-center justify-center flex-shrink-0 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </header>

      {/* Body — scrollable. Fields are shared with the flow overview's
          Settings tab so the two surfaces can never disagree. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <FlowSettingsFields draft={draft} onChange={setDraft} layout="panel" />
      </div>

      {/* Footer — Save */}
      <footer className="border-t border-[var(--border)] px-4 py-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </footer>
    </div>
  );
}
