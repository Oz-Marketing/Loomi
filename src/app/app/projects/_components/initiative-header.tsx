'use client';

import { useState } from 'react';
import { toast } from '@/lib/toast';
import type { InitiativeDTO } from '@/lib/services/projects';
import { useProjectOptions } from './use-project-options';

const INIT_STATUSES = [
  { key: 'active', label: 'Active' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

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

  const dueValue = it.dueDate ? it.dueDate.slice(0, 10) : '';

  return (
    <div>
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
        className="-ml-1 w-full rounded-md border border-transparent bg-transparent px-1 text-xl font-semibold text-[var(--foreground)] outline-none focus:border-[var(--border)] focus:bg-[var(--background)]"
        aria-label="Initiative name"
      />
      <p className="mt-1 px-1 text-sm text-[var(--muted-foreground)]">{it.accountDealer ?? '—'}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
        <select
          value={it.status}
          onChange={(e) => patch({ status: e.target.value })}
          className="loomi-input !w-auto !py-1.5 text-xs"
          aria-label="Status"
        >
          {INIT_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={it.priority}
          onChange={(e) => patch({ priority: e.target.value })}
          className="loomi-input !w-auto !py-1.5 text-xs"
          aria-label="Priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={it.ownerUserId ?? ''}
          onChange={(e) => patch({ ownerUserId: e.target.value || null })}
          className="loomi-input !w-auto !py-1.5 text-xs"
          aria-label="Owner"
        >
          <option value="">No owner</option>
          {options?.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueValue}
          onChange={(e) => patch({ dueDate: e.target.value || null })}
          className="loomi-input !w-auto !py-1.5 text-xs"
          aria-label="Due date"
        />
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== (it.description ?? '')) patch({ description: description.trim() || null });
        }}
        rows={2}
        placeholder="Add a description…"
        className="loomi-input mt-3 resize-y text-sm"
      />

      <div className="mt-3 max-w-md px-1">
        <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
          <span>
            {doneCount}/{taskCount} done
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
