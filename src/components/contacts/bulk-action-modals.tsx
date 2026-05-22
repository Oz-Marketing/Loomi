'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ListBulletIcon,
  NoSymbolIcon,
  PlusIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Modals invoked from the contacts bulk-action dock. Each handles its
// own local state + validation and surfaces a single async `onApply`
// that the parent uses to fire the bulk API call. The parent owns
// loading state + toasts so the modals stay dumb / re-usable.

interface ModalShellProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

function ModalShell({ title, description, onClose, children, footer }: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            {description && (
              <p className="text-xs text-[var(--muted-foreground)] mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 pt-2">{footer}</div>
      </div>
    </div>
  );
}

// ── Add to list ──

interface ListSummary {
  id: string;
  name: string;
  accountKey: string;
  memberCount: number;
}

export function AddToListModal({
  accountKey,
  selectedCount,
  onApply,
  onClose,
}: {
  accountKey: string;
  selectedCount: number;
  onApply: (listId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/contacts/lists')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load lists');
        return data as { lists: ListSummary[] };
      })
      .then((data) => {
        if (cancelled) return;
        const filtered = (data.lists ?? []).filter((l) => l.accountKey === accountKey);
        setLists(filtered);
        if (filtered.length > 0) setSelectedListId(filtered[0].id);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load lists');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  async function handleApply() {
    if (!selectedListId) return;
    setSubmitting(true);
    try {
      await onApply(selectedListId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateAndApply() {
    const name = newListName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/contacts/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create list');
      }
      await onApply(data.list.id);
    } catch (err) {
      // Surface the error inline rather than throwing — keeps the modal
      // open so the user can retry with a different name.
      setLoadError(err instanceof Error ? err.message : 'Failed to create list');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="Add to list"
      description={`Pick a list to add ${selectedCount.toLocaleString()} ${selectedCount === 1 ? 'contact' : 'contacts'} to.`}
      onClose={onClose}
      footer={
        creating ? (
          <>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewListName('');
                setLoadError(null);
              }}
              disabled={submitting}
              className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleCreateAndApply}
              disabled={!newListName.trim() || submitting}
              className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating…' : 'Create + Add'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!selectedListId || submitting}
              className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Adding…' : 'Add to list'}
            </button>
          </>
        )
      }
    >
      {creating ? (
        <div>
          <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            New list name
          </label>
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="e.g. Q4 Service Customers"
            autoFocus
            maxLength={120}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
          />
          {loadError && (
            <p className="text-xs text-red-400 mt-2">{loadError}</p>
          )}
        </div>
      ) : loading ? (
        <p className="text-xs text-[var(--muted-foreground)] py-4 text-center">Loading lists…</p>
      ) : loadError ? (
        <p className="text-xs text-red-400 py-2">{loadError}</p>
      ) : lists.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-[var(--border)] rounded-xl">
          <ListBulletIcon className="w-7 h-7 mx-auto text-[var(--muted-foreground)] mb-2 opacity-60" />
          <p className="text-xs text-[var(--muted-foreground)]">No lists exist for this account yet.</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 h-9 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Create the first list
          </button>
        </div>
      ) : (
        <div>
          <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            List
          </label>
          <select
            value={selectedListId}
            onChange={(e) => setSelectedListId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.memberCount.toLocaleString()})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Create a new list instead
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// ── Tags (add / remove) ──

export function TagsModal({
  mode,
  selectedCount,
  onApply,
  onClose,
}: {
  mode: 'add' | 'remove';
  selectedCount: number;
  onApply: (tags: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function commitInput() {
    const value = input.trim();
    if (!value) return;
    // Allow comma-or-newline separated bulk entry in a single shot.
    const next = value
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setTags((prev) => Array.from(new Set([...prev, ...next])));
    setInput('');
  }

  async function handleApply() {
    if (tags.length === 0) return;
    setSubmitting(true);
    try {
      await onApply(tags);
    } finally {
      setSubmitting(false);
    }
  }

  const verb = mode === 'add' ? 'Add' : 'Remove';
  const past = mode === 'add' ? 'added to' : 'removed from';

  return (
    <ModalShell
      title={`${verb} tags`}
      description={`${verb} these tags ${past} ${selectedCount.toLocaleString()} ${selectedCount === 1 ? 'contact' : 'contacts'}.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={tags.length === 0 || submitting}
            className={`px-3 h-10 text-sm rounded-lg border text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'add'
                ? 'border-[var(--primary)] bg-[var(--primary)] hover:bg-[var(--primary)]/90'
                : 'border-red-500/70 bg-red-500/80 hover:bg-red-500/90'
            }`}
          >
            {submitting ? 'Working…' : `${verb} ${tags.length} tag${tags.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div>
        <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
          Tag{tags.length === 1 ? '' : 's'}
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commitInput();
            }
          }}
          onBlur={commitInput}
          placeholder="Type a tag and press Enter…"
          autoFocus
          maxLength={120}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--primary)]/10 text-[var(--primary)]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="opacity-60 hover:opacity-100"
                  aria-label={`Remove ${tag}`}
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ── DND ──

type DndState = 'on' | 'off' | 'leave';

export function DndModal({
  selectedCount,
  onApply,
  onClose,
}: {
  selectedCount: number;
  onApply: (patch: { email?: boolean; sms?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<DndState>('leave');
  const [sms, setSms] = useState<DndState>('leave');
  const [submitting, setSubmitting] = useState(false);

  const patch = useMemo(() => {
    const out: { email?: boolean; sms?: boolean } = {};
    if (email !== 'leave') out.email = email === 'on';
    if (sms !== 'leave') out.sms = sms === 'on';
    return out;
  }, [email, sms]);

  const canApply = Object.keys(patch).length > 0;

  async function handleApply() {
    if (!canApply) return;
    setSubmitting(true);
    try {
      await onApply(patch);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="Set Do Not Disturb"
      description={`Apply to ${selectedCount.toLocaleString()} ${selectedCount === 1 ? 'contact' : 'contacts'}. Leave a channel on "Keep as-is" to skip it.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply || submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DndChannelRow label="Email" icon={<NoSymbolIcon className="w-4 h-4" />} value={email} onChange={setEmail} />
        <DndChannelRow label="SMS" icon={<NoSymbolIcon className="w-4 h-4" />} value={sms} onChange={setSms} />
      </div>
    </ModalShell>
  );
}

function DndChannelRow({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: DndState;
  onChange: (v: DndState) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--muted-foreground)]">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
        {(['leave', 'on', 'off'] as DndState[]).map((option) => {
          const labelMap = { leave: 'Keep as-is', on: 'DND on', off: 'DND off' } as const;
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`px-2.5 py-1.5 transition-colors ${
                active
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {labelMap[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// re-export a barrel icon for the toolbar's tag actions so the dock
// doesn't have to import its own heroicons.
export { TagIcon };
