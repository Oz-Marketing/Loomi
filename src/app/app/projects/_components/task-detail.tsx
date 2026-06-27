'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import { toast } from '@/lib/toast';
import { getStudioUrl } from '@/lib/cross-site';
import type { getTaskWithThread } from '@/lib/services/projects';
import {
  STATUSES,
  PRIORITY_META,
  KIND_META,
  KIND_OPTIONS,
  kindLabel,
  formatShortDate,
} from '@/lib/projects/ui';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { useProjectOptions } from './use-project-options';
import { TaskExtraDetails } from './details-view';
import { MentionTextarea, MentionText, extractMentions } from './mention-textarea';
import { MediaUpload, type UploadedFile } from './media-upload';

const PROP_TRIGGER = '!bg-[var(--background)] !rounded-lg !px-2.5 !py-1.5 !text-sm';
const propDot = (color: string) => (
  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
);

type Thread = NonNullable<Awaited<ReturnType<typeof getTaskWithThread>>>;

const CAMPAIGN_KINDS = new Set(['email', 'sms', 'landing_page', 'form']);

const CAMPAIGN_STATUS_BADGE: Record<string, string> = {
  draft: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  building: 'bg-blue-500/10 text-blue-500',
  ready: 'bg-green-500/10 text-green-600',
  partial: 'bg-amber-500/10 text-amber-600',
  archived: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
};

export function TaskDetail({ initial }: { initial: Thread }) {
  const options = useProjectOptions();
  const [task, setTask] = useState(initial.task);
  const [comments, setComments] = useState(initial.comments);
  const [activity] = useState(initial.activity);
  const [subtasks, setSubtasks] = useState(initial.subtasks);
  const [newSubtask, setNewSubtask] = useState('');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [linkedCampaign] = useState(initial.linkedCampaign);
  const [launching, setLaunching] = useState(false);

  async function launch() {
    setLaunching(true);
    try {
      const res = await fetch(`/api/projects/tasks/${task.id}/launch`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const { url } = (await res.json()) as { url: string };
      const dest = getStudioUrl(url);
      if (dest) window.location.href = dest;
      else throw new Error();
    } catch {
      toast.error('Could not open the tool');
      setLaunching(false);
    }
  }

  async function toggleSubtask(id: string, done: boolean) {
    setSubtasks((list) => list.map((s) => (s.id === id ? { ...s, status: done ? 'done' : 'todo' } : s)));
    try {
      const res = await fetch(`/api/projects/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: done ? 'done' : 'todo' }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSubtasks((list) => list.map((s) => (s.id === id ? { ...s, status: done ? 'todo' : 'done' } : s)));
      toast.error('Could not update subtask');
    }
  }

  async function addSubtask() {
    const title = newSubtask.trim();
    if (!title) return;
    try {
      const res = await fetch('/api/projects/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountKey: task.accountKey,
          initiativeId: task.initiativeId,
          parentTaskId: task.id,
          teamKey: task.teamKey,
          title,
        }),
      });
      if (!res.ok) throw new Error();
      const { task: created } = (await res.json()) as { task: { id: string; title: string; status: string } };
      setSubtasks((list) => [...list, { id: created.id, title: created.title, status: created.status }]);
      setNewSubtask('');
    } catch {
      toast.error('Could not add subtask');
    }
  }

  async function patch(body: Record<string, unknown>) {
    const prev = task;
    setTask({ ...task, ...body } as typeof task);
    try {
      const res = await fetch(`/api/projects/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const { task: updated } = (await res.json()) as { task: typeof task };
      if (updated) setTask(updated);
    } catch {
      setTask(prev);
      toast.error('Could not save change');
    }
  }

  const attachments = (((task.details as Record<string, unknown> | null)?._attachments as
    | UploadedFile[]
    | undefined) ?? []);

  async function saveAttachments(files: UploadedFile[]) {
    const prevDetails = (task.details as Record<string, unknown> | null) ?? {};
    setTask({ ...task, details: { ...prevDetails, _attachments: files } });
    try {
      const res = await fetch(`/api/projects/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ details: { _attachments: files } }),
      });
      if (!res.ok) throw new Error();
      const { task: updated } = (await res.json()) as { task: typeof task };
      if (updated) setTask(updated);
    } catch {
      setTask({ ...task, details: prevDetails });
      toast.error('Could not save attachments');
    }
  }

  async function postComment() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, mentions: extractMentions(body, options?.users ?? []) }),
      });
      if (!res.ok) throw new Error();
      const { comment } = await res.json();
      setComments((c) => [...c, comment]);
      setDraft('');
    } catch {
      toast.error('Could not post comment');
    } finally {
      setPosting(false);
    }
  }

  const dueValue = task.dueDate ? task.dueDate.slice(0, 10) : '';
  const launchable = KIND_META[task.kind]?.launch;
  const isCampaignKind = CAMPAIGN_KINDS.has(task.kind);
  const launchCopy = isCampaignKind
    ? {
        title: `Spin up the ${kindLabel(task.kind).toLowerCase()} in Studio`,
        desc: 'Creates a campaign pre-filled with this account & brief, linked back here.',
        btn: 'Build it',
      }
    : task.kind === 'ads'
      ? { title: 'Open the Meta Ads Pacer', desc: "Plan and track this account's ads in Studio.", btn: 'Open pacer' }
      : { title: 'Open the Flow Builder', desc: 'Build an automation sequence in Studio.', btn: 'Open flows' };

  return (
    <div className="py-6">
      <Link
        href="/projects/board"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to board
      </Link>

      <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        {/* Main column */}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--foreground)]">{task.title}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {task.accountDealer ?? '—'}
            {task.initiativeId && task.initiativeName ? (
              <>
                {' · '}
                <Link
                  href={`/projects/initiatives/${task.initiativeId}`}
                  className="text-[var(--primary)] hover:underline"
                >
                  {task.initiativeName}
                </Link>
              </>
            ) : null}
          </p>

          {task.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--foreground)]">{task.description}</p>
          )}

          <div className="mt-4">
            <TaskExtraDetails kind={task.kind} details={task.details} />
          </div>

          {launchable && (
            <div className="mt-4 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3">
              {linkedCampaign ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <SparklesIcon className="h-4 w-4 flex-shrink-0 text-[var(--primary)]" />
                      <span className="font-medium text-[var(--foreground)]">{linkedCampaign.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CAMPAIGN_STATUS_BADGE[linkedCampaign.status] ?? CAMPAIGN_STATUS_BADGE.draft}`}
                      >
                        {linkedCampaign.status}
                      </span>
                    </div>
                    <a
                      href={getStudioUrl(`/campaign-builder/${linkedCampaign.id}`) ?? '#'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                    >
                      Open in Studio
                      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                  </div>
                  {(linkedCampaign.status === 'partial' || linkedCampaign.status === 'ready') &&
                    task.status !== 'done' && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--primary)]/20 pt-2 text-xs">
                        <span className="text-[var(--muted-foreground)]">
                          Campaign assets have shipped from Studio.
                        </span>
                        <button
                          type="button"
                          onClick={() => patch({ status: 'done' })}
                          className="flex-shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                        >
                          Mark done
                        </button>
                      </div>
                    )}
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <SparklesIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--primary)]" />
                    <div className="text-xs text-[var(--foreground)]">
                      <p className="font-medium">{launchCopy.title}</p>
                      <p className="mt-0.5 text-[var(--muted-foreground)]">{launchCopy.desc}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={launch}
                    disabled={launching}
                    className="flex-shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {launching ? 'Opening…' : launchCopy.btn}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          <div className="mt-8">
            <h2 className="mb-2 text-sm font-medium text-[var(--foreground)]">Attachments</h2>
            <MediaUpload accountKey={task.accountKey} value={attachments} onChange={saveAttachments} />
          </div>

          {/* Subtasks */}
          <div className="mt-8">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-[var(--foreground)]">Subtasks</h2>
              {subtasks.length > 0 && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length}
                </span>
              )}
            </div>
            <div className="mt-2 space-y-0.5">
              {subtasks.map((s) => {
                const done = s.status === 'done';
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--muted)]/40"
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={(e) => toggleSubtask(s.id, e.target.checked)}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    <span className={`text-sm ${done ? 'text-[var(--muted-foreground)] line-through' : 'text-[var(--foreground)]'}`}>
                      {s.title}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSubtask();
                }}
                placeholder="Add a subtask…"
                className="loomi-input !py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={addSubtask}
                disabled={!newSubtask.trim()}
                className="flex-shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Comments */}
          <div className="mt-8">
            <h2 className="text-sm font-medium text-[var(--foreground)]">Comments</h2>
            <div className="mt-3 space-y-4">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <UserAvatar
                    name={c.author?.name ?? 'User'}
                    email={c.author?.email ?? ''}
                    avatarUrl={c.author?.avatarUrl ?? null}
                    size={28}
                    className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-medium text-[var(--foreground)]">{c.author?.name ?? 'User'}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">{formatShortDate(c.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      <MentionText text={c.body} users={options?.users ?? []} />
                    </p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">No comments yet.</p>
              )}
            </div>

            <div className="mt-4">
              <MentionTextarea
                value={draft}
                onChange={setDraft}
                users={options?.users ?? []}
                rows={3}
                placeholder="Add a comment… use @ to mention"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={posting || !draft.trim()}
                  onClick={postComment}
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {posting ? 'Posting…' : 'Comment'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Properties sidebar */}
        <aside className="space-y-4">
          <Prop label="Status">
            <SearchableSelect
              value={task.status}
              onChange={(v) => patch({ status: v })}
              searchable={false}
              options={STATUSES.map((s) => ({ value: s.key, label: s.label, icon: propDot(s.dot) }))}
              className={PROP_TRIGGER}
            />
          </Prop>

          <Prop label="Assignee">
            <SearchableSelect
              value={task.assignee?.id ?? ''}
              onChange={(v) => patch({ assigneeUserId: v || null })}
              options={[
                { value: '', label: 'Unassigned' },
                ...(options?.users ?? []).map((u) => ({
                  value: u.id,
                  label: u.name,
                  icon: (
                    <UserAvatar
                      name={u.name}
                      email={u.email}
                      avatarUrl={u.avatarUrl}
                      size={16}
                      className="rounded-full flex-shrink-0"
                    />
                  ),
                })),
              ]}
              placeholder="Unassigned"
              className={PROP_TRIGGER}
            />
          </Prop>

          <Prop label="Team">
            <SearchableSelect
              value={task.teamKey ?? ''}
              onChange={(v) => patch({ teamKey: v || null })}
              options={[
                { value: '', label: 'No team' },
                ...(options?.teams ?? []).map((t) => ({
                  value: t.key,
                  label: t.name,
                  icon: propDot(t.color ?? 'var(--primary)'),
                })),
              ]}
              placeholder="No team"
              className={PROP_TRIGGER}
            />
          </Prop>

          <Prop label="Type">
            <SearchableSelect
              value={task.kind}
              onChange={(v) => patch({ kind: v })}
              options={KIND_OPTIONS.map((k) => ({ value: k.key, label: k.label }))}
              className={PROP_TRIGGER}
            />
          </Prop>

          <Prop label="Priority">
            <SearchableSelect
              value={task.priority}
              onChange={(v) => patch({ priority: v })}
              searchable={false}
              options={(['low', 'medium', 'high', 'urgent'] as const).map((p) => ({
                value: p,
                label: PRIORITY_META[p].label,
                icon: propDot(PRIORITY_META[p].color),
              }))}
              className={PROP_TRIGGER}
            />
          </Prop>

          <Prop label="Due date">
            <DatePicker
              mode="single"
              value={dueValue || null}
              onChange={(v) => patch({ dueDate: v || null })}
              placeholder="Set a due date"
              className="group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] transition hover:border-[var(--primary)] focus:outline-none"
            />
          </Prop>

          {task.requester && (
            <Prop label="Requested by">
              <p className="text-sm text-[var(--foreground)]">{task.requester.name}</p>
            </Prop>
          )}

          {/* Activity */}
          <div className="pt-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Activity
            </p>
            <ul className="space-y-2">
              {activity.map((a) => (
                <li key={a.id} className="text-xs text-[var(--muted-foreground)]">
                  <span className="text-[var(--foreground)]">{a.summary}</span>
                  {a.authorName ? ` · ${a.authorName}` : ''} · {formatShortDate(a.createdAt)}
                </li>
              ))}
              {activity.length === 0 && <li className="text-xs text-[var(--muted-foreground)]">No activity yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      {children}
    </div>
  );
}
