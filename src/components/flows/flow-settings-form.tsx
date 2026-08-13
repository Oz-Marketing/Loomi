'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type {
  FlowSettings,
  FlowReEntryPolicy,
  FlowGoalType,
  FlowDndHandling,
} from './builder/types';

// Flow-level settings, in one place.
//
// These live on LoomiFlow.settings and the worker reads them on every
// enrollment tick. They used to be reachable only through the cog in the
// builder canvas, which meant you had to open the editor to answer
// "can this contact enrol twice?" — so the same fields now render on the
// flow overview's Settings tab too. Both hosts share `FlowSettingsFields`
// so the two can't drift.

export interface FlowSettingsFieldsProps {
  draft: FlowSettings;
  onChange: (next: FlowSettings) => void;
  /** 'panel' = the builder's narrow popout (stacked). 'page' = the
   *  overview's Settings tab (two columns on wide screens). */
  layout?: 'panel' | 'page';
}

export function FlowSettingsFields({
  draft,
  onChange,
  layout = 'panel',
}: FlowSettingsFieldsProps) {
  // Constrain `patch` to object-valued keys only. `dndHandling` is a
  // bare string union and must be updated via onChange directly.
  type ObjectKeys = {
    [K in keyof FlowSettings]: FlowSettings[K] extends object ? K : never;
  }[keyof FlowSettings];

  function patch<K extends ObjectKeys>(key: K, next: Partial<FlowSettings[K]>) {
    onChange({
      ...draft,
      [key]: { ...(draft[key] as object), ...next } as FlowSettings[K],
    });
  }

  return (
    <div
      className={
        layout === 'page'
          ? 'grid grid-cols-1 md:grid-cols-2 gap-5'
          : 'space-y-5'
      }
    >
      <Section
        title="Re-entry"
        subtitle="Can a contact who already enrolled enrol again?"
      >
        <Select
          value={draft.reEntry.policy}
          onChange={(v) => patch('reEntry', { policy: v as FlowReEntryPolicy })}
          options={[
            { value: 'never', label: 'Never (default)' },
            { value: 'after-days', label: 'Allow after cooldown' },
            { value: 'always', label: 'Always allow re-entry' },
          ]}
        />
        {draft.reEntry.policy === 'after-days' && (
          <NumberInput
            label="Cooldown (days)"
            value={draft.reEntry.afterDays ?? 7}
            onChange={(v) => patch('reEntry', { afterDays: v })}
            min={1}
            max={365}
          />
        )}
      </Section>

      <Section
        title="Quiet hours"
        subtitle="Hold sends outside this window (account timezone)"
      >
        <Toggle
          checked={draft.quietHours.enabled}
          onChange={(v) => patch('quietHours', { enabled: v })}
          label={draft.quietHours.enabled ? 'On' : 'Off'}
        />
        {draft.quietHours.enabled && (
          <div className="grid grid-cols-2 gap-2">
            <TimeInput
              label="Start"
              value={draft.quietHours.start}
              onChange={(v) => patch('quietHours', { start: v })}
            />
            <TimeInput
              label="End"
              value={draft.quietHours.end}
              onChange={(v) => patch('quietHours', { end: v })}
            />
          </div>
        )}
      </Section>

      <Section
        title="Goal"
        subtitle="Exit a contact early when they hit a condition"
      >
        <Toggle
          checked={draft.goal.enabled}
          onChange={(v) => patch('goal', { enabled: v })}
          label={draft.goal.enabled ? 'On' : 'Off'}
        />
        {draft.goal.enabled && (
          <>
            <Select
              value={draft.goal.type}
              onChange={(v) => patch('goal', { type: v as FlowGoalType })}
              options={[
                { value: 'tag-added', label: 'Tag added' },
                { value: 'field-set', label: 'Field set' },
              ]}
            />
            <Text
              label={draft.goal.type === 'tag-added' ? 'Tag name' : 'Field name=value'}
              value={draft.goal.value}
              onChange={(v) => patch('goal', { value: v })}
              placeholder={
                draft.goal.type === 'tag-added' ? 'e.g. purchased' : 'e.g. status=converted'
              }
            />
          </>
        )}
      </Section>

      <Section
        title="Max duration"
        subtitle="Auto-exit enrollments still active after N days"
      >
        <Toggle
          checked={draft.maxDuration.enabled}
          onChange={(v) => patch('maxDuration', { enabled: v })}
          label={draft.maxDuration.enabled ? 'On' : 'Off'}
        />
        {draft.maxDuration.enabled && (
          <NumberInput
            label="Days"
            value={draft.maxDuration.days}
            onChange={(v) => patch('maxDuration', { days: v })}
            min={1}
            max={365}
          />
        )}
      </Section>

      <Section
        title="DND handling"
        subtitle="What to do when a contact has do-not-disturb set"
      >
        <Select
          value={draft.dndHandling}
          onChange={(v) => onChange({ ...draft, dndHandling: v as FlowDndHandling })}
          options={[
            { value: 'skip', label: 'Skip step, continue (default)' },
            { value: 'pause', label: 'Pause until DND clears' },
            { value: 'exit', label: 'Exit flow' },
          ]}
        />
      </Section>
    </div>
  );
}

/**
 * Card-shaped settings editor for the flow overview's Settings tab.
 * Owns its own draft + save so the page doesn't have to.
 */
export function FlowSettingsForm({
  flowId,
  initial,
  onSaved,
}: {
  flowId: string;
  initial: FlowSettings;
  onSaved?: (next: FlowSettings) => void;
}) {
  const [draft, setDraft] = useState<FlowSettings>(initial);
  const [saving, setSaving] = useState(false);

  // Re-sync when the flow reloads under us (e.g. after a rename mutate).
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

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
      toast.success('Flow settings saved');
      onSaved?.(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold leading-tight">Flow settings</h3>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Defaults the worker applies to every enrollment in this flow. Changes
          take effect on the next tick — contacts already mid-flow pick them up
          too.
        </p>
      </div>

      <FlowSettingsFields draft={draft} onChange={setDraft} layout="page" />

      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[var(--border)]">
        {dirty && (
          <button
            type="button"
            onClick={() => setDraft(initial)}
            className="px-3 h-9 text-sm rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            Discard changes
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="px-3 h-9 text-sm font-semibold rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

// ── Form primitives ──
// Exported so the builder's popout renders identical controls.

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold text-[var(--foreground)]">{title}</h4>
        {subtitle && (
          <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs"
    >
      <span
        className={`relative w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-[var(--muted-foreground)]/30'
        }`}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-150 ease-out"
          style={{ left: checked ? '18px' : '2px' }}
        />
      </span>
      <span className="text-[var(--muted-foreground)]">{label}</span>
    </button>
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-[var(--foreground)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Text({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-medium">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-[var(--foreground)] normal-case tracking-normal"
      />
    </label>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-medium">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-[var(--foreground)] normal-case tracking-normal"
      />
    </label>
  );
}

export function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-medium">
      {label}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs text-[var(--foreground)] normal-case tracking-normal"
      />
    </label>
  );
}
