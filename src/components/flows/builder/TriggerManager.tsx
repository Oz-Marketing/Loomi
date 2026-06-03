'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PlusIcon,
  TrashIcon,
  ListBulletIcon,
  TagIcon,
  UsersIcon,
  HandRaisedIcon,
  BoltIcon,
  DocumentTextIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
  CakeIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import type { FlowApiTrigger } from './types';

// ── Trigger type catalog ──
//
// Mirrors the GHL "Add Trigger" picker: each entry is a selectable card
// in the picker view, grouped by category. `executable` flags whether
// the worker can actually run flows that use this trigger today;
// non-executable types render in the picker but with a "Coming soon"
// chip and are blocked from creation.

type TriggerType = FlowApiTrigger['type'];

interface TriggerTypeMeta {
  label: string;
  description: string;
  category: 'contact' | 'manual' | 'event' | 'date';
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  executable: boolean;
}

const TRIGGER_TYPE_META: Record<TriggerType, TriggerTypeMeta> = {
  list: {
    label: 'Added to List',
    description: 'Fires when a contact is added to a chosen static list.',
    category: 'contact',
    Icon: ListBulletIcon,
    color: 'text-sky-300',
    bg: 'bg-sky-500/15',
    executable: true,
  },
  audience: {
    label: 'Matches Audience',
    description: 'Fires when a contact matches a saved audience filter.',
    category: 'contact',
    Icon: UsersIcon,
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/15',
    executable: true,
  },
  tag_added: {
    label: 'Has Tag',
    description: 'Fires when a contact carries a given tag (e.g. loomi-yag-purchased).',
    category: 'contact',
    Icon: TagIcon,
    color: 'text-teal-300',
    bg: 'bg-teal-500/15',
    executable: true,
  },
  manual: {
    label: 'Manual Enrollment',
    description: 'You enroll contacts on demand via the API or a UI action.',
    category: 'manual',
    Icon: HandRaisedIcon,
    color: 'text-amber-300',
    bg: 'bg-amber-500/15',
    executable: true,
  },
  event: {
    label: 'Event-Based',
    description: 'Webhook / event-driven enrollment (Contact Tag Added, etc.).',
    category: 'event',
    Icon: BoltIcon,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/15',
    executable: false,
  },
  form_submission: {
    label: 'Form Submitted',
    description: 'Fires when a Loomi form receives a submission.',
    category: 'event',
    Icon: DocumentTextIcon,
    color: 'text-violet-300',
    bg: 'bg-violet-500/15',
    executable: true,
  },
  date_reminder: {
    label: 'Date Reminder',
    description:
      'Fires when a contact date field (e.g. Last Purchase Date) reaches a chosen offset — anniversary, lease end, service due, warranty.',
    category: 'date',
    Icon: CalendarDaysIcon,
    color: 'text-rose-300',
    bg: 'bg-rose-500/15',
    executable: true,
  },
  birthday: {
    label: 'Birthday',
    description: 'Fires a chosen number of days before a contact’s birthday, every year.',
    category: 'date',
    Icon: CakeIcon,
    color: 'text-pink-300',
    bg: 'bg-pink-500/15',
    executable: true,
  },
};

const PICKER_SECTIONS: { category: TriggerTypeMeta['category']; label: string }[] = [
  { category: 'contact', label: 'Contact' },
  { category: 'date', label: 'Date-based' },
  { category: 'manual', label: 'Manual' },
  { category: 'event', label: 'Event' },
];

interface TriggerManagerProps {
  flowId: string;
  accountKey: string | null;
  triggers: FlowApiTrigger[];
  onTriggersChanged: (next: FlowApiTrigger[]) => void;
}

// Trigger management UI embedded inside the BuilderInspector when the
// trigger node is selected. Two views: a list of attached triggers,
// and a picker for adding a new one. Replaces the standalone drawer
// — keeping everything inside the inspector matches the GHL pattern
// of editing things in context rather than from a separate top-bar
// button.
export function TriggerManager({
  flowId,
  accountKey,
  triggers,
  onTriggersChanged,
}: TriggerManagerProps) {
  const [view, setView] = useState<'list' | 'picker'>('list');

  async function addTrigger(type: TriggerType) {
    if (!TRIGGER_TYPE_META[type].executable) {
      toast.error(`${TRIGGER_TYPE_META[type].label} isn't available yet.`);
      return;
    }
    const res = await fetch(`/api/flows/${flowId}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, config: {}, enabled: false }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Failed to add trigger');
      return;
    }
    const payload = await res.json();
    onTriggersChanged([...triggers, payload.trigger]);
    setView('list');
    toast.success('Trigger added — configure and enable it.');
  }

  return (
    <div className="space-y-3">
      {view === 'picker' && (
        <button
          type="button"
          onClick={() => setView('list')}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back to triggers
        </button>
      )}

      {view === 'list' ? (
        <ListView
          flowId={flowId}
          accountKey={accountKey}
          triggers={triggers}
          onTriggersChanged={onTriggersChanged}
          onOpenPicker={() => setView('picker')}
        />
      ) : (
        <PickerView onPick={addTrigger} />
      )}
    </div>
  );
}

// ── List view: attached triggers ──

function ListView({
  flowId,
  accountKey,
  triggers,
  onTriggersChanged,
  onOpenPicker,
}: {
  flowId: string;
  accountKey: string | null;
  triggers: FlowApiTrigger[];
  onTriggersChanged: (next: FlowApiTrigger[]) => void;
  onOpenPicker: () => void;
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {triggers.length === 0 && (
          <div className="text-center py-8 px-4 rounded-lg border border-dashed border-[var(--border)]">
            <BoltIcon className="w-6 h-6 text-[var(--muted-foreground)] mx-auto mb-2" />
            <p className="text-xs text-[var(--muted-foreground)]">
              No triggers yet — add one to start enrolling contacts.
            </p>
          </div>
        )}
        {triggers.map((trigger) => (
          <TriggerCard
            key={trigger.id}
            flowId={flowId}
            accountKey={accountKey}
            trigger={trigger}
            onUpdated={(next) =>
              onTriggersChanged(
                triggers.map((t) => (t.id === next.id ? next : t)),
              )
            }
            onDeleted={() =>
              onTriggersChanged(triggers.filter((t) => t.id !== trigger.id))
            }
          />
        ))}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <button
          type="button"
          onClick={onOpenPicker}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add Trigger
        </button>
      </div>
    </>
  );
}

// ── Picker view: search + categorized type list ──

function PickerView({ onPick }: { onPick: (type: TriggerType) => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();

  const sections = useMemo(() => {
    return PICKER_SECTIONS.map((section) => {
      const types = (Object.keys(TRIGGER_TYPE_META) as TriggerType[])
        .filter((t) => TRIGGER_TYPE_META[t].category === section.category)
        .filter((t) => {
          if (!query) return true;
          const meta = TRIGGER_TYPE_META[t];
          return (
            meta.label.toLowerCase().includes(query) ||
            meta.description.toLowerCase().includes(query)
          );
        });
      return { ...section, types };
    }).filter((s) => s.types.length > 0);
  }, [query]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search triggers"
            className="w-full pl-7 pr-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sections.length === 0 ? (
          <p className="text-[11px] text-[var(--muted-foreground)] text-center py-6">
            No triggers match “{search}”.
          </p>
        ) : (
          sections.map((section) => (
            <div
              key={section.category}
              className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--card)]/40"
            >
              <div className="px-3 py-2 border-b border-[var(--border)] text-xs font-semibold text-[var(--foreground)]">
                {section.label}
              </div>
              <ul className="px-1.5 py-1.5 space-y-0.5">
                {section.types.map((type) => {
                  const meta = TRIGGER_TYPE_META[type];
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        onClick={() => onPick(type)}
                        disabled={!meta.executable}
                        className="group w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-[var(--muted)]/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                        title={meta.description}
                      >
                        <span
                          className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${meta.bg}`}
                        >
                          <meta.Icon className={`w-4 h-4 ${meta.color}`} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-[var(--foreground)] block truncate">
                            {meta.label}
                          </span>
                          {!meta.executable && (
                            <span className="text-[9px] uppercase tracking-wider text-amber-400">
                              Coming soon
                            </span>
                          )}
                        </span>
                        {meta.executable && (
                          <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Per-trigger card (list view) ──

function TriggerCard({
  flowId,
  accountKey,
  trigger,
  onUpdated,
  onDeleted,
}: {
  flowId: string;
  accountKey: string | null;
  trigger: FlowApiTrigger;
  onUpdated: (next: FlowApiTrigger) => void;
  onDeleted: () => void;
}) {
  const meta = TRIGGER_TYPE_META[trigger.type];

  async function setEnabled(enabled: boolean) {
    const res = await fetch(`/api/flows/${flowId}/triggers/${trigger.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      const payload = await res.json();
      onUpdated(payload.trigger);
    } else {
      toast.error('Failed to update trigger');
    }
  }

  async function updateConfig(config: Record<string, unknown>) {
    const res = await fetch(`/api/flows/${flowId}/triggers/${trigger.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    if (res.ok) {
      const payload = await res.json();
      onUpdated(payload.trigger);
    } else {
      toast.error('Failed to update trigger');
    }
  }

  async function remove() {
    const res = await fetch(`/api/flows/${flowId}/triggers/${trigger.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      onDeleted();
    } else {
      toast.error('Failed to delete trigger');
    }
  }

  return (
    <div className="border border-[var(--border)] rounded-xl p-3 bg-[var(--card)]">
      <div className="flex items-start gap-2">
        <span
          className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${meta.bg}`}
        >
          <meta.Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{meta.label}</div>
          <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
            {meta.description}
          </div>
        </div>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={trigger.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {trigger.enabled ? 'on' : 'off'}
          </span>
        </label>
        <button
          type="button"
          onClick={remove}
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-2">
        {trigger.type === 'list' && (
          <ListConfig
            accountKey={accountKey}
            value={typeof trigger.config.listId === 'string' ? trigger.config.listId : ''}
            onChange={(listId) => updateConfig({ listId })}
          />
        )}
        {trigger.type === 'audience' && (
          <AudienceConfig
            accountKey={accountKey}
            value={
              typeof trigger.config.audienceId === 'string' ? trigger.config.audienceId : ''
            }
            onChange={(audienceId) => updateConfig({ audienceId })}
          />
        )}
        {trigger.type === 'manual' && (
          <p className="text-[11px] text-[var(--muted-foreground)] italic">
            Use POST /api/flows/{flowId}/enroll with contactIds or listId.
          </p>
        )}
        {trigger.type === 'event' && (
          <p className="text-[11px] text-[var(--muted-foreground)] italic">
            Event triggers are not active yet.
          </p>
        )}
        {trigger.type === 'form_submission' && (
          <FormConfig
            accountKey={accountKey}
            value={typeof trigger.config.formId === 'string' ? trigger.config.formId : ''}
            onChange={(formId) => updateConfig({ formId })}
          />
        )}
        {trigger.type === 'date_reminder' && (
          <DateReminderConfig
            accountKey={accountKey}
            value={trigger.config}
            onChange={updateConfig}
          />
        )}
        {trigger.type === 'birthday' && (
          <BirthdayConfig value={trigger.config} onChange={updateConfig} />
        )}
        {trigger.type === 'tag_added' && (
          <TagAddedConfig value={trigger.config} onChange={updateConfig} />
        )}
      </div>
    </div>
  );
}

function ListConfig({
  accountKey,
  value,
  onChange,
}: {
  accountKey: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const [lists, setLists] = useState<{ id: string; name: string; memberCount: number }[]>([]);

  useEffect(() => {
    const url = accountKey
      ? `/api/contacts/lists?accountKey=${encodeURIComponent(accountKey)}`
      : '/api/contacts/lists';
    fetch(url)
      .then((r) => (r.ok ? r.json() : { lists: [] }))
      .then((data) => {
        const rows = Array.isArray(data?.lists) ? data.lists : [];
        setLists(rows);
      })
      .catch(() => {});
  }, [accountKey]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
    >
      <option value="">— Select a list —</option>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name} ({l.memberCount})
        </option>
      ))}
    </select>
  );
}

function AudienceConfig({
  accountKey,
  value,
  onChange,
}: {
  accountKey: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const [audiences, setAudiences] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const url = accountKey
      ? `/api/audiences?accountKey=${encodeURIComponent(accountKey)}`
      : '/api/audiences';
    fetch(url)
      .then((r) => (r.ok ? r.json() : { audiences: [] }))
      .then((data) => {
        const rows = Array.isArray(data?.audiences) ? data.audiences : [];
        setAudiences(rows);
      })
      .catch(() => {});
  }, [accountKey]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
    >
      <option value="">— Select an audience —</option>
      {audiences.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

// ── Date-based trigger config forms ──

function DateReminderConfig({
  accountKey,
  value,
  onChange,
}: {
  accountKey: string | null;
  value: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const { fields } = useFilterableFields(accountKey);
  const dateFields = fields.filter((f) => f.type === 'date');

  const field = typeof value.field === 'string' ? value.field : '';
  const recurAnnually = value.recurAnnually === true;
  const initialOffset =
    typeof value.offsetDays === 'number' ? value.offsetDays : 0;
  const [offset, setOffset] = useState(String(initialOffset));

  const commit = (patch: Record<string, unknown>) =>
    onChange({
      field,
      offsetDays: Number(offset) || 0,
      recurAnnually,
      ...patch,
    });

  return (
    <div className="space-y-2">
      <select
        value={field}
        onChange={(e) => commit({ field: e.target.value })}
        className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
      >
        <option value="">— Select a date field —</option>
        {dateFields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          onBlur={() => commit({ offsetDays: Number(offset) || 0 })}
          className="w-20 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
        <span className="text-[10px] text-[var(--muted-foreground)]">
          offset in days (negative = before the date, positive = after)
        </span>
      </div>
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={recurAnnually}
          onChange={(e) => commit({ recurAnnually: e.target.checked })}
          className="accent-[var(--primary)]"
        />
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Recurs annually (match month/day, ignore year)
        </span>
      </label>
      {!field && (
        <p className="text-[10px] text-amber-400">
          Pick a date field to enable this trigger.
        </p>
      )}
    </div>
  );
}

function TagAddedConfig({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [tag, setTag] = useState(typeof value.tag === 'string' ? value.tag : '');
  return (
    <div className="space-y-1">
      <input
        type="text"
        value={tag}
        placeholder="e.g. loomi-yag-purchased"
        onChange={(e) => setTag(e.target.value)}
        onBlur={() => onChange({ tag: tag.trim() })}
        className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
      />
      <p className="text-[10px] text-[var(--muted-foreground)]">
        Fires for contacts carrying this tag. Remove the tag at the end of the
        flow if it should re-fire when re-applied.
      </p>
      {!tag.trim() && (
        <p className="text-[10px] text-amber-400">Enter a tag to enable this trigger.</p>
      )}
    </div>
  );
}

function BirthdayConfig({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const initial = typeof value.daysBefore === 'number' ? value.daysBefore : 0;
  const [daysBefore, setDaysBefore] = useState(String(initial));

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={daysBefore}
          onChange={(e) => setDaysBefore(e.target.value)}
          onBlur={() => onChange({ daysBefore: Math.max(0, Number(daysBefore) || 0) })}
          className="w-20 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
        />
        <span className="text-[10px] text-[var(--muted-foreground)]">
          days before the birthday (0 = on the day)
        </span>
      </div>
      <p className="text-[10px] text-[var(--muted-foreground)]">
        Requires a Date of Birth on the contact.
      </p>
    </div>
  );
}

function FormConfig({
  accountKey,
  value,
  onChange,
}: {
  accountKey: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  type FormOption = { id: string; name: string; slug: string; status: string };
  const [forms, setForms] = useState<FormOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // /api/forms is already account-scoped by the caller's session.
    // For developer / super_admin users without an accountKey filter,
    // we pass through the flow's accountKey so we only see forms in
    // the same account the flow lives in.
    const url = accountKey
      ? `/api/forms?accountKey=${encodeURIComponent(accountKey)}`
      : '/api/forms';
    fetch(url)
      .then((r) => (r.ok ? r.json() : { forms: [] }))
      .then((data) => {
        const rows = Array.isArray(data?.forms) ? data.forms : [];
        setForms(rows);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [accountKey]);

  if (loading) {
    return (
      <p className="text-[11px] text-[var(--muted-foreground)] italic">
        Loading forms…
      </p>
    );
  }

  if (forms.length === 0) {
    return (
      <p className="text-[11px] text-[var(--muted-foreground)] italic">
        No forms in this account yet. Create one under Websites → Forms.
      </p>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] text-xs"
    >
      <option value="">— Select a form —</option>
      {forms.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name || f.slug}
          {f.status === 'draft' ? ' (draft — won’t fire)' : ''}
        </option>
      ))}
    </select>
  );
}
