'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import type { InitiativeDTO } from '@/lib/services/projects';
import { useProjectOptions } from './use-project-options';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { AccountAvatar } from '@/components/account-avatar';
import { UserAvatar } from '@/components/user-avatar';
import { PRIORITY_META, type PriorityKey } from '@/lib/projects/ui';

const INIT_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: '#22c55e' },
  on_hold: { label: 'On hold', color: '#f59e0b' },
  completed: { label: 'Completed', color: '#3b82f6' },
  canceled: { label: 'Canceled', color: '#ef4444' },
  archived: { label: 'Archived', color: '#94a3b8' },
};
const PRIORITIES: PriorityKey[] = ['low', 'medium', 'high', 'urgent'];
const TRIGGER = '!bg-[var(--background)] !rounded-lg !px-2.5 !py-1.5 !text-sm';

function dot(color: string) {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />;
}

export function InitiativeHeader({
  initiative,
  taskCount,
  doneCount,
}: {
  initiative: InitiativeDTO;
  taskCount: number;
  doneCount: number;
}) {
  const options = useProjectOptions();
  const router = useRouter();
  const dialog = useLoomiDialog();
  const [it, setIt] = useState(initiative);
  const [name, setName] = useState(initiative.name);
  const [description, setDescription] = useState(initiative.description ?? '');
  const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  async function patch(body: Record<string, unknown>) {
    const prev = it;
    setIt({ ...it, ...body } as typeof it);
    try {
      const res = await fetch(`/api/projects/initiatives/${it.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const { initiative: updated } = (await res.json()) as { initiative: typeof it };
      if (updated) setIt(updated);
    } catch {
      setIt(prev);
      toast.error('Could not save change');
    }
  }

  async function changeStatus(v: string) {
    if (v === it.status) return;
    if (v === 'canceled') {
      const ok = await dialog.confirm({
        title: 'Cancel this initiative?',
        message: 'This marks every task in the initiative as Canceled.',
        confirmLabel: 'Cancel initiative',
        destructive: true,
      });
      if (!ok) return;
      await patch({ status: v });
      router.refresh(); // re-render the board with the now-canceled tasks
      return;
    }
    patch({ status: v });
  }

  const status = INIT_STATUS[it.status] ?? INIT_STATUS.active;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      {/* Hero */}
      <div className="flex items-start gap-3.5">
        <AccountAvatar
          name={it.accountDealer}
          accountKey={it.accountKey}
          size={44}
          className="mt-0.5 flex-shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (v && v !== it.name) patch({ name: v });
              else setName(it.name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="-ml-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-2xl font-semibold leading-tight text-[var(--foreground)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--background)]"
            aria-label="Initiative name"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 px-1.5">
            <span className="text-sm text-[var(--muted-foreground)]">{it.accountDealer ?? '—'}</span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                color: status.color,
                backgroundColor: `color-mix(in srgb, ${status.color} 14%, transparent)`,
              }}
            >
              {dot(status.color)}
              {status.label}
            </span>
          </div>
        </div>
      </div>

      {/* Meta controls — labeled, Loomi components */}
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <MetaField label="Status">
          <SearchableSelect
            value={it.status}
            onChange={changeStatus}
            searchable={false}
            options={Object.entries(INIT_STATUS).map(([key, s]) => ({
              value: key,
              label: s.label,
              icon: dot(s.color),
            }))}
            className={TRIGGER}
          />
        </MetaField>
        <MetaField label="Priority">
          <SearchableSelect
            value={it.priority}
            onChange={(v) => patch({ priority: v })}
            searchable={false}
            options={PRIORITIES.map((p) => ({
              value: p,
              label: PRIORITY_META[p].label,
              icon: dot(PRIORITY_META[p].color),
            }))}
            className={TRIGGER}
          />
        </MetaField>
        <MetaField label="Owner">
          <SearchableSelect
            value={it.ownerUserId ?? ''}
            onChange={(v) => patch({ ownerUserId: v || null })}
            options={[
              { value: '', label: 'No owner' },
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
            placeholder="No owner"
            className={TRIGGER}
          />
        </MetaField>
        <MetaField label="Due date">
          <DatePicker
            mode="single"
            value={it.dueDate ? it.dueDate.slice(0, 10) : null}
            onChange={(v) => patch({ dueDate: v || null })}
            placeholder="Set a due date"
            className="group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm text-[var(--foreground)] transition hover:border-[var(--primary)] focus:outline-none"
          />
        </MetaField>
      </div>

      {/* Description */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== (it.description ?? '')) patch({ description: description.trim() || null });
        }}
        rows={2}
        placeholder="Add a description…"
        className="loomi-input mt-4 resize-y text-sm"
      />

      {/* Progress */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">
            {doneCount}/{taskCount} tasks done
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      {children}
    </div>
  );
}
