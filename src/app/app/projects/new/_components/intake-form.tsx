'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { KIND_OPTIONS } from '@/lib/projects/ui';

type Account = { key: string; dealer: string; slug: string | null };
type Team = { key: string; name: string; color: string | null };
type User = { id: string; name: string; email: string; avatarUrl: string | null; department: string | null };

type Options = { accounts: Account[]; teams: Team[]; users: User[] };

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// Project templates — pre-select the standard team set for common engagements.
// Team keys are matched against the live team list, so a renamed/removed team
// is simply skipped.
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

export function IntakeForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [template, setTemplate] = useState<string>('custom');
  const [accountKey, setAccountKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamKeys, setTeamKeys] = useState<string[]>([]);
  const [priority, setPriority] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [kind, setKind] = useState('generic');
  const [initiativeMode, setInitiativeMode] = useState<'new' | 'existing'>('new');
  const [initiativeId, setInitiativeId] = useState('');
  const [initiativeName, setInitiativeName] = useState('');
  const [initiatives, setInitiatives] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  // Load the chosen account's initiatives so the ticket can be filed into one.
  useEffect(() => {
    setInitiativeId('');
    setInitiativeMode('new');
    if (!accountKey) {
      setInitiatives([]);
      return;
    }
    let active = true;
    fetch(`/api/projects/initiatives?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { initiatives: { id: string; name: string }[] }) => {
        if (active) setInitiatives(d.initiatives ?? []);
      })
      .catch(() => active && setInitiatives([]));
    return () => {
      active = false;
    };
  }, [accountKey]);

  const accountDealer = useMemo(
    () => options?.accounts.find((a) => a.key === accountKey)?.dealer ?? '',
    [options, accountKey],
  );

  function applyTemplate(key: string) {
    setTemplate(key);
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const liveKeys = new Set((options?.teams ?? []).map((t) => t.key));
    setTeamKeys(tpl.teamKeys.filter((k) => liveKeys.has(k)));
    if (tpl.titleHint && !title) {
      setTitle(tpl.titleHint.replace('{account}', accountDealer || 'new client'));
    }
  }

  function toggleTeam(key: string) {
    setTeamKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function submit() {
    if (!accountKey || !title.trim()) {
      toast.error('Pick an account and add a title');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/projects/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          title: title.trim(),
          description: description.trim() || null,
          teamKeys,
          priority,
          kind,
          dueDate: dueDate || null,
          assigneeUserId: assigneeUserId || null,
          templateKey: template !== 'custom' ? template : null,
          initiativeId: initiativeMode === 'existing' && initiativeId ? initiativeId : null,
          initiativeName: initiativeMode === 'new' ? initiativeName.trim() || null : null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { initiativeId: string; tasks: unknown[] };
      toast.success(`Filed ${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'}`);
      router.push(`/projects/initiatives/${data.initiativeId}`);
    } catch {
      toast.error('Could not file the ticket');
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Could not load form options.</p>;
  }
  if (!options) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">File a ticket</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Spin up work for an account. Pick a template to fan out across teams, or build a custom ticket.
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
        <Field label="Account" required>
          <select
            value={accountKey}
            onChange={(e) => setAccountKey(e.target.value)}
            className="loomi-input"
          >
            <option value="">Select an account…</option>
            {options.accounts.map((a) => (
              <option key={a.key} value={a.key}>
                {a.dealer}
              </option>
            ))}
          </select>
        </Field>

        {accountKey && (
          <Field label="Initiative" hint="Group this ticket under a body of work.">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
                <button
                  type="button"
                  onClick={() => setInitiativeMode('new')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    initiativeMode === 'new'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  New
                </button>
                <button
                  type="button"
                  onClick={() => setInitiativeMode('existing')}
                  disabled={initiatives.length === 0}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
                    initiativeMode === 'existing'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  Existing
                </button>
              </div>
              {initiativeMode === 'new' ? (
                <input
                  value={initiativeName}
                  onChange={(e) => setInitiativeName(e.target.value)}
                  placeholder="Initiative name (defaults to ticket title)"
                  className="loomi-input min-w-[14rem] flex-1"
                />
              ) : (
                <select
                  value={initiativeId}
                  onChange={(e) => setInitiativeId(e.target.value)}
                  className="loomi-input min-w-[14rem] flex-1"
                >
                  <option value="">Select an initiative…</option>
                  {initiatives.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Field>
        )}

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

        <Field label="Teams" hint="One task is created per team.">
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
        </Field>

        <Field label="Type" hint="Drives the in-tool launch later (Phase 2).">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="loomi-input">
            {KIND_OPTIONS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="loomi-input">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="loomi-input"
            />
          </Field>
        </div>

        <Field label="Assignee" hint="Optional — leave blank to let the team triage.">
          <select
            value={assigneeUserId}
            onChange={(e) => setAssigneeUserId(e.target.value)}
            className="loomi-input"
          >
            <option value="">Unassigned</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.department ? ` · ${u.department}` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-8 flex items-center justify-end gap-3">
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
          {submitting ? 'Filing…' : 'File ticket'}
        </button>
      </div>
    </div>
  );
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
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
        {label}
        {required && <span className="text-[var(--primary)]">*</span>}
        {hint && <span className="font-normal text-xs text-[var(--muted-foreground)]">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
