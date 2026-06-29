'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import {
  kindOptionsForTeams,
  isCreativeKind,
  kindLabel,
  fieldsForKind,
  BILLING_FIELDS,
  TEAM_KINDS,
} from '@/lib/projects/ui';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { MultiSelect } from '@/components/ui/multi-select';
import { AccountAvatar } from '@/components/account-avatar';
import { DatePicker } from '@/components/ui/date-picker';
import { FieldRenderer, DATE_TRIGGER, type FieldValue } from './field-renderer';
import { MediaUpload, type UploadedFile } from '../../_components/media-upload';

// Per-(department,type) field values, keyed `${teamKey}:${kind}` → { fieldKey: value }.
type TypeDetails = Record<string, Record<string, FieldValue>>;

type Logos = { light?: string; dark?: string; white?: string; black?: string } | null;
type Account = { key: string; dealer: string; slug: string | null; logos: Logos };
type Team = { key: string; name: string; color: string | null };
type User = { id: string; name: string; email: string; avatarUrl: string | null; department: string | null };

type Options = { accounts: Account[]; teams: Team[]; users: User[] };

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// Sizes the SearchableSelect/MultiSelect triggers to match the form's
// `.loomi-input` fields (rounded-lg, py-2 px-3, text-sm, page background).
const SELECT_TRIGGER = '!bg-[var(--background)] !rounded-lg !px-3 !py-2 !text-sm';

// Project templates — pre-select the standard department set for common
// engagements. Team keys are matched against the live team list, so a
// renamed/removed team is simply skipped.
const TEMPLATES: { key: string; label: string; teamKeys: string[]; titleHint?: string }[] = [
  {
    key: 'new-client-onboarding',
    label: 'New client onboarding',
    teamKeys: [
      'development',
      'digital-ads',
      'organic-social',
      'pr-mass-media',
      'video-production',
      'graphic-design',
    ],
    titleHint: 'Onboard {account} — get all channels live',
  },
  {
    key: 'campaign-launch',
    label: 'Campaign launch',
    teamKeys: ['digital-ads', 'graphic-design', 'organic-social'],
    titleHint: 'Campaign launch',
  },
  { key: 'custom', label: 'Custom', teamKeys: [] },
];

/** Default Type for a freshly-added department = its signature kind. */
function defaultKindForTeam(teamKey: string): string {
  return TEAM_KINDS[teamKey]?.[0] ?? 'generic';
}

/** Type options a single department can produce (Flow excluded — AI-recommended). */
function deptTypeOptions(teamKey: string) {
  return kindOptionsForTeams([teamKey]).filter((o) => o.key !== 'flow');
}

export function IntakeForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [template, setTemplate] = useState<string>('custom');
  const [accountKeys, setAccountKeys] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Selected departments (in click order) + each department's chosen Types.
  // A department can deliver more than one thing (e.g. a landing page + a form),
  // so each maps to an array of kinds — one task per kind.
  const [teamKeys, setTeamKeys] = useState<string[]>([]);
  const [deptKinds, setDeptKinds] = useState<Record<string, string[]>>({});
  // Which department cards are expanded (default true). Cards collapse so a
  // many-department ticket reads as an overview/checklist instead of a long scroll.
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});
  // Same idea for the inner per-type field groups, keyed `${teamKey}:${kind}`.
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({});
  const [creativeMode, setCreativeMode] = useState<'shared' | 'unique'>('unique');
  // Per-type intake fields, keyed `${teamKey}:${kind}`.
  const [typeDetails, setTypeDetails] = useState<TypeDetails>({});
  const [priority, setPriority] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  // Ticket-level timing. Event can be a single day or a range (eventEnd set).
  const [eventDate, setEventDate] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [runStart, setRunStart] = useState('');
  const [runEnd, setRunEnd] = useState('');
  const [recurring, setRecurring] = useState(false);
  // Ticket-level reference media.
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  // Collapsible billing block.
  const [billingOpen, setBillingOpen] = useState(false);
  const [billing, setBilling] = useState<Record<string, FieldValue>>({});
  const [submitting, setSubmitting] = useState(false);

  const setDetail = (tk: string, kind: string, fieldKey: string, value: FieldValue) =>
    setTypeDetails((prev) => ({
      ...prev,
      [`${tk}:${kind}`]: { ...(prev[`${tk}:${kind}`] ?? {}), [fieldKey]: value },
    }));

  const isDeptExpanded = (tk: string) => expandedDepts[tk] ?? true;
  const toggleDept = (tk: string) =>
    setExpandedDepts((p) => ({ ...p, [tk]: !(p[tk] ?? true) }));
  const setAllDepts = (open: boolean) =>
    setExpandedDepts(Object.fromEntries(teamKeys.map((k) => [k, open])));

  const isTypeExpanded = (tk: string, kind: string) => expandedTypes[`${tk}:${kind}`] ?? true;
  const toggleType = (tk: string, kind: string) =>
    setExpandedTypes((p) => {
      const k = `${tk}:${kind}`;
      return { ...p, [k]: !(p[k] ?? true) };
    });

  const fieldFilled = (v: FieldValue) =>
    !(v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0));

  // Filled / total field counts for one type (a "2/5" hint in its header).
  const typeFieldStats = (tk: string, kind: string) => {
    const fields = fieldsForKind(kind);
    let filled = 0;
    for (const f of fields) if (fieldFilled(typeDetails[`${tk}:${kind}`]?.[f.key])) filled++;
    return { total: fields.length, filled };
  };

  // Filled / total across a department's selected types.
  const deptFieldStats = (tk: string) => {
    let total = 0;
    let filled = 0;
    for (const kind of deptKinds[tk] ?? []) {
      const s = typeFieldStats(tk, kind);
      total += s.total;
      filled += s.filled;
    }
    return { total, filled };
  };

  const primaryAccountKey = accountKeys[0] ?? '';
  const multiAccount = accountKeys.length > 1;

  useEffect(() => {
    let active = true;
    fetch('/api/projects/options')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Options) => {
        if (active) setOptions(data);
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  const accountName = useMemo(
    () => options?.accounts.find((a) => a.key === primaryAccountKey)?.dealer ?? '',
    [options, primaryAccountKey],
  );

  // The same-vs-unique creative choice only matters when multiple accounts share
  // a creative deliverable.
  const hasCreativeDept = teamKeys.some((tk) => (deptKinds[tk] ?? []).some(isCreativeKind));
  const showCreativeToggle = multiAccount && hasCreativeDept;

  function applyTemplate(key: string) {
    setTemplate(key);
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const liveKeys = new Set((options?.teams ?? []).map((t) => t.key));
    const tk = tpl.teamKeys.filter((k) => liveKeys.has(k));
    setTeamKeys(tk);
    setDeptKinds(Object.fromEntries(tk.map((k) => [k, [defaultKindForTeam(k)]])));
    if (tpl.titleHint && !title) {
      setTitle(tpl.titleHint.replace('{account}', accountName || 'new client'));
    }
  }

  function toggleTeam(key: string) {
    if (teamKeys.includes(key)) {
      setTeamKeys(teamKeys.filter((k) => k !== key));
      setDeptKinds((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setExpandedDepts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const next = [...teamKeys, key];
    setTeamKeys(next);
    setDeptKinds((prev) => ({ ...prev, [key]: [defaultKindForTeam(key)] }));
    // The new department expands; once it's getting busy (>2), collapse the
    // others so the rep focuses on one section with the rest as an overview.
    setExpandedDepts((prev) => {
      const np = { ...prev };
      if (next.length > 2) for (const k of teamKeys) np[k] = false;
      np[key] = true;
      return np;
    });
  }

  async function submit() {
    if (accountKeys.length === 0 || !title.trim()) {
      toast.error('Pick at least one account and add a title');
      return;
    }
    setSubmitting(true);
    try {
      // One entry per (department, type) — a department with multiple types
      // produces multiple tasks. Each carries its own per-type field values.
      const departments = teamKeys.flatMap((tk) => {
        const kinds = deptKinds[tk]?.length ? deptKinds[tk] : ['generic'];
        return kinds.map((kind) => ({
          teamKey: tk,
          kind,
          details: typeDetails[`${tk}:${kind}`] ?? {},
        }));
      });
      const billingFilled = Object.values(billing).some(
        (v) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
      );
      const res = await fetch('/api/projects/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountKeys,
          title: title.trim(),
          description: description.trim() || null,
          departments,
          creativeMode: showCreativeToggle ? creativeMode : 'unique',
          priority,
          dueDate: dueDate || null,
          // Ticket-level timing + billing (stored on the initiative if one is
          // auto-created, else on the task).
          meta: {
            eventDate: eventDate || null,
            eventEnd: eventEnd || null,
            runStart: runStart || null,
            runEnd: runEnd || null,
            recurring,
            attachments: attachments.length ? attachments : null,
          },
          billing: billingFilled ? billing : null,
          // Auto-grouping: the backend creates an initiative on its own when the
          // ticket spans multiple departments/accounts, comes from a template, or
          // has billing; a simple one-off stays standalone. The rep makes no choice.
          templateKey: template !== 'custom' ? template : null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { initiativeId: string | null; tasks: { id: string }[] };
      toast.success(`Submitted ${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'}`);
      if (data.initiativeId) router.push(`/projects/initiatives/${data.initiativeId}`);
      else if (data.tasks.length === 1) router.push(`/projects/tasks/${data.tasks[0].id}`);
      else router.push('/projects');
    } catch {
      toast.error('Could not submit the ticket');
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Could not load form options.</p>;
  }
  if (!options) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Loading…</p>;
  }

  const teamName = (key: string) => options.teams.find((t) => t.key === key)?.name ?? key;
  const teamColor = (key: string) => options.teams.find((t) => t.key === key)?.color ?? 'var(--primary)';

  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">Submit a ticket</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Spin up work for one or more accounts. Pick a template to fan out across departments, or
        build a custom ticket.
      </p>

      {/* Templates */}
      <div className="mt-6 flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => applyTemplate(t.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              template === t.key
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-5">
        <Field label="Accounts" required hint="One account, or several for a joint effort.">
          <MultiSelect
            value={accountKeys}
            onChange={setAccountKeys}
            options={options.accounts.map((a) => ({
              value: a.key,
              label: a.dealer,
              icon: (
                <AccountAvatar
                  name={a.dealer}
                  accountKey={a.key}
                  logos={a.logos}
                  size={20}
                  className="rounded flex-shrink-0"
                />
              ),
            }))}
            placeholder="Select one or more accounts…"
            className={SELECT_TRIGGER}
          />
        </Field>

        <Field label="Title" required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to happen?"
            className="loomi-input"
          />
        </Field>

        <Field label="Brief">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Context, goals, links, assets…"
            className="loomi-input resize-y"
          />
        </Field>

        <Field label="Timing" hint="Optional — event, run window, recurrence.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
                Event date(s)
              </span>
              <DatePicker
                mode="range"
                value={{ start: eventDate || null, end: eventEnd || null }}
                onChange={(r) => {
                  setEventDate(r.start ?? '');
                  setEventEnd(r.end ?? '');
                }}
                placeholder="Single day or a range"
                className={DATE_TRIGGER}
              />
            </div>
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
                Advertising run dates
              </span>
              <DatePicker
                mode="range"
                value={{ start: runStart || null, end: runEnd || null }}
                onChange={(r) => {
                  setRunStart(r.start ?? '');
                  setRunEnd(r.end ?? '');
                }}
                placeholder="Select run window"
                className={DATE_TRIGGER}
              />
            </div>
          </div>
          <div className="mt-3">
            <FieldRenderer
              field={{ key: 'recurring', label: 'Recurring advertising?', input: 'toggle' }}
              value={recurring}
              onChange={(v) => setRecurring(!!v)}
            />
          </div>
        </Field>

        <Field label="Departments" hint="Each one gets its own task — pick the Type per department.">
          <div className="flex flex-wrap gap-2">
            {options.teams.map((t) => {
              const on = teamKeys.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleTeam(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? 'border-transparent text-white'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                  }`}
                  style={on ? { backgroundColor: t.color ?? 'var(--primary)' } : undefined}
                >
                  {on && <CheckIcon className="h-3.5 w-3.5" />}
                  {t.name}
                </button>
              );
            })}
            {options.teams.length === 0 && (
              <span className="text-xs text-[var(--muted-foreground)]">
                No teams yet — add some in Teams settings.
              </span>
            )}
          </div>

          {/* Per-department cards — collapsible; each is its own mini-form. The
              number of sections = the departments chosen, so it stays tiny for a
              one-off and reads as a checklist for a big multi-department launch. */}
          {teamKeys.length > 0 && (
            <div className="mt-3 space-y-2">
              {teamKeys.length > 1 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAllDepts(!teamKeys.every(isDeptExpanded))}
                    className="text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                  >
                    {teamKeys.every(isDeptExpanded) ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>
              )}
              {teamKeys.map((tk) => {
                const kindsWithFields = (deptKinds[tk] ?? []).filter((k) => fieldsForKind(k).length > 0);
                const expanded = isDeptExpanded(tk);
                const stats = deptFieldStats(tk);
                const typeLabels = (deptKinds[tk] ?? []).map(kindLabel);
                return (
                  <div key={tk} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40">
                    {/* Header — click to expand/collapse. */}
                    <button
                      type="button"
                      onClick={() => toggleDept(tk)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: teamColor(tk) }}
                      />
                      <span className="text-sm font-medium text-[var(--foreground)] flex-shrink-0">
                        {teamName(tk)}
                      </span>
                      {!expanded && (
                        <span className="truncate text-xs text-[var(--muted-foreground)]">
                          {typeLabels.length ? typeLabels.join(', ') : 'No types'}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                        {stats.total > 0 && (
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            {stats.filled}/{stats.total}
                          </span>
                        )}
                        {expanded ? (
                          <ChevronDownIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                        )}
                      </span>
                    </button>

                    {expanded && (
                      <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
                        <MultiSelect
                          value={deptKinds[tk] ?? []}
                          onChange={(v) => setDeptKinds((prev) => ({ ...prev, [tk]: v }))}
                          options={deptTypeOptions(tk).map((o) => ({ value: o.key, label: o.label }))}
                          placeholder="Select one or more types…"
                          accentColor={teamColor(tk)}
                          className={SELECT_TRIGGER}
                        />

                        {/* Per-type fields — each a collapsible sub-card. */}
                        {kindsWithFields.map((kind) => {
                          const tExpanded = isTypeExpanded(tk, kind);
                          const ts = typeFieldStats(tk, kind);
                          return (
                            <div
                              key={kind}
                              className="rounded-md border border-[var(--border)] bg-[var(--background)]"
                            >
                              <button
                                type="button"
                                onClick={() => toggleType(tk, kind)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                              >
                                <span
                                  className="text-xs font-semibold"
                                  style={{ color: teamColor(tk) }}
                                >
                                  {kindLabel(kind)}
                                </span>
                                <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                                  {ts.total > 0 && (
                                    <span className="text-[11px] text-[var(--muted-foreground)]">
                                      {ts.filled}/{ts.total}
                                    </span>
                                  )}
                                  {tExpanded ? (
                                    <ChevronDownIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                                  ) : (
                                    <ChevronRightIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                                  )}
                                </span>
                              </button>
                              {tExpanded && (
                                <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] p-3 sm:grid-cols-2">
                                  {fieldsForKind(kind).map((f) => (
                                    <FieldRenderer
                                      key={f.key}
                                      field={f}
                                      value={typeDetails[`${tk}:${kind}`]?.[f.key]}
                                      onChange={(v) => setDetail(tk, kind, f.key, v)}
                                      accentColor={teamColor(tk)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Field>

        {/* Creative approach — only when multiple accounts share a creative deliverable. */}
        {showCreativeToggle && (
          <Field
            label="Creative approach"
            hint={`Across ${accountKeys.length} accounts, for design/creative work.`}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  { key: 'unique', title: 'Unique per account', desc: 'A separate creative for each account.' },
                  { key: 'shared', title: 'Same for all', desc: 'One creative reused across all accounts.' },
                ] as const
              ).map((opt) => {
                const active = creativeMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setCreativeMode(opt.key)}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                        : 'border-[var(--border)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    <span className="block text-sm font-medium text-[var(--foreground)]">
                      {opt.title}
                    </span>
                    <span className="block text-xs text-[var(--muted-foreground)]">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Priority">
            <SearchableSelect
              value={priority}
              onChange={setPriority}
              searchable={false}
              options={PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
              className={SELECT_TRIGGER}
            />
          </Field>
          <Field label="Due date">
            <DatePicker
              mode="single"
              value={dueDate || null}
              onChange={(v) => setDueDate(v ?? '')}
              placeholder="Select date"
              className={DATE_TRIGGER}
            />
          </Field>
        </div>

        {/* Billing — collapsed by default; deeper accounting handled internally. */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setBillingOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-[var(--foreground)]"
          >
            <span>
              Billing{' '}
              <span className="font-normal text-xs text-[var(--muted-foreground)]">— optional</span>
            </span>
            {billingOpen ? (
              <ChevronDownIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </button>
          {billingOpen && (
            <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] p-3 sm:grid-cols-3">
              {BILLING_FIELDS.map((f) => (
                <FieldRenderer
                  key={f.key}
                  field={f}
                  value={billing[f.key]}
                  onChange={(v) => setBilling((prev) => ({ ...prev, [f.key]: v }))}
                />
              ))}
            </div>
          )}
        </div>

        <Field label="Attachments" hint="Reference assets, examples, briefs (account-scoped).">
          <MediaUpload
            accountKey={primaryAccountKey || null}
            value={attachments}
            onChange={setAttachments}
          />
        </Field>
      </div>

      {/* Summary of what will be created. */}
      {accountKeys.length > 0 && (
        <p className="mt-6 text-xs text-[var(--muted-foreground)]">
          {summarize({
            accounts: accountKeys.length,
            teamKeys,
            deptKinds,
            creativeMode: showCreativeToggle ? creativeMode : 'unique',
          })}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/projects')}
          className="rounded-xl px-4 py-2 text-sm text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit ticket'}
        </button>
      </div>
    </div>
  );
}

/** Plain-language preview of the task fan-out, so the rep sees what they get. */
function summarize({
  accounts,
  teamKeys,
  deptKinds,
  creativeMode,
}: {
  accounts: number;
  teamKeys: string[];
  deptKinds: Record<string, string[]>;
  creativeMode: 'shared' | 'unique';
}): string {
  const depts = teamKeys.length || 1;
  let total = 0;
  if (teamKeys.length === 0) {
    total = accounts;
  } else {
    for (const tk of teamKeys) {
      const kinds = deptKinds[tk]?.length ? deptKinds[tk] : ['generic'];
      for (const kind of kinds) {
        const shared = creativeMode === 'shared' && isCreativeKind(kind);
        total += shared ? 1 : accounts;
      }
    }
  }
  const taskWord = total === 1 ? 'task' : 'tasks';
  const acctWord = accounts === 1 ? 'account' : 'accounts';
  const deptWord = depts === 1 ? 'department' : 'departments';
  return `Creates ${total} ${taskWord} across ${accounts} ${acctWord} × ${depts} ${deptWord}.`;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  // A plain <div>, NOT a <label>: a <label> forwards clicks anywhere in its box
  // to the first labelable control inside it (a <button> qualifies), which made
  // the whole field area clickable and let stray clicks toggle the first pill.
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
        {label}
        {required && <span className="text-[var(--primary)]">*</span>}
        {hint && <span className="font-normal text-xs text-[var(--muted-foreground)]">— {hint}</span>}
      </span>
      {children}
    </div>
  );
}
