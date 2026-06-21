'use client';

/**
 * Ad Size Library — a shared, named set of ad sizes the template builder draws
 * from. Anyone signed in can add, rename, resize, or remove one; each row shows
 * who created it and when. Styled to match the Ad Generator gallery + Templates
 * chrome. Behind AD_GENERATOR_ENABLED (the route layout 404s when off).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  RectangleGroupIcon,
  SparklesIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { UserAvatar } from '@/components/user-avatar';
import { catalogByCategory, aspectLabel } from '@/lib/ad-generator/ad-size-catalog';

type AdSize = {
  id: string;
  name: string;
  width: number;
  height: number;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
  createdAt: string;
};

export default function AdSizesPage() {
  const { accountKey } = useAccount();
  const { confirm } = useLoomiDialog();
  const [sizes, setSizes] = useState<AdSize[] | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [busy, setBusy] = useState(false);

  // Inline edit state (one row at a time).
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editWidth, setEditWidth] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Sizes are global, but preserve the active sub-account across the back-links
  // (the generator is an admin-level route that reads ?account=).
  const acctQuery = accountKey ? `?account=${encodeURIComponent(accountKey)}` : '';

  async function load() {
    try {
      const res = await fetch('/api/ad-generator/sizes');
      const json = res.ok ? await res.json() : { sizes: [] };
      setSizes(json.sizes ?? []);
    } catch {
      setSizes([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    const w = Number(width);
    const h = Number(height);
    if (!name.trim() || !(w > 0) || !(h > 0)) {
      toast.error('Name, width, and height are required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), width: w, height: h }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setName('');
      setWidth('');
      setHeight('');
      toast.success('Size added');
      void load();
    } catch (err) {
      toast.error(`Couldn't add: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: AdSize) {
    setEditId(s.id);
    setEditName(s.name);
    setEditWidth(String(s.width));
    setEditHeight(String(s.height));
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit(id: string) {
    const w = Number(editWidth);
    const h = Number(editHeight);
    if (!editName.trim() || !(w > 0) || !(h > 0)) {
      toast.error('Name, width, and height are required');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/ad-generator/sizes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), width: w, height: h }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSizes((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, ...json.size } : x)));
      setEditId(null);
      toast.success('Size updated');
    } catch (err) {
      toast.error(`Couldn't update: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(s: AdSize) {
    const ok = await confirm({
      title: 'Remove size?',
      message: `"${s.name}" (${s.width}×${s.height}) will be removed from the library. Existing ads keep their layouts — this only affects new "add size" picks.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/sizes/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSizes((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      toast.success('Removed');
    } catch (err) {
      toast.error(`Couldn't remove: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  const count = useMemo(() => sizes?.length ?? 0, [sizes]);

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <RectangleGroupIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Ad Sizes</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Named ad sizes the template builder picks from. Anyone can add, edit, or remove one.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href={`/ad-generator${acctQuery}`}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <SparklesIcon className="w-4 h-4" />
              Ad Generator
            </Link>
            <Link
              href={`/ad-generator/builder${acctQuery}`}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Squares2X2Icon className="w-4 h-4" />
              Template Builder
            </Link>
          </div>
        </div>
      </div>

      {/* Create */}
      <div className="glass-card mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] p-4">
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Square 1080"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Width</span>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="1080"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <span className="pb-2 text-[var(--muted-foreground)]">×</span>
        <label className="w-24">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Height</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="1080"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <button
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 h-10 text-sm font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add size
        </button>
      </div>

      {/* Standard catalog — built-in platform sizes, always available */}
      <div className="mb-8">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Standard sizes</h2>
          <span className="text-xs text-[var(--muted-foreground)]">Built-in platform presets — always available in the builder.</span>
        </div>
        <div className="space-y-4">
          {catalogByCategory().map((grp) => (
            <div key={grp.category}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{grp.label}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grp.sizes.map((s) => {
                  const ratio = s.width / s.height;
                  const boxW = ratio >= 1 ? 44 : 44 * ratio;
                  const boxH = ratio >= 1 ? 44 / ratio : 44;
                  return (
                    <div key={s.name} className="glass-card flex items-center gap-3 rounded-2xl border border-[var(--border)] p-4">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/40">
                        <div className="rounded-[2px] bg-[var(--primary)]/30 ring-1 ring-[var(--primary)]/50" style={{ width: boxW, height: boxH }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--foreground)]">{s.name}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {s.width}×{s.height} · {aspectLabel(s.width, s.height)}
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{s.platform}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom sizes — team-added presets from the DB */}
      <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Custom sizes</h2>
      {sizes === null ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : count === 0 ? (
        <div className="glass-card rounded-2xl px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
          No custom sizes yet. The standard sizes above cover the common platforms — add one here for anything bespoke.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sizes!.map((s) => {
            const ratio = s.width / s.height;
            const boxW = ratio >= 1 ? 44 : 44 * ratio;
            const boxH = ratio >= 1 ? 44 / ratio : 44;
            const editing = editId === s.id;
            return (
              <div key={s.id} className="glass-card flex items-center gap-3 rounded-2xl border border-[var(--border)] p-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/40">
                  <div className="rounded-[2px] bg-[var(--primary)]/30 ring-1 ring-[var(--primary)]/50" style={{ width: boxW, height: boxH }} />
                </div>

                {editing ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Name"
                      className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <input
                      type="number"
                      value={editWidth}
                      onChange={(e) => setEditWidth(e.target.value)}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <span className="text-[var(--muted-foreground)]">×</span>
                    <input
                      type="number"
                      value={editHeight}
                      onChange={(e) => setEditHeight(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(s.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">{s.name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {s.width}×{s.height}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <UserAvatar name={s.createdByName} email={s.createdByEmail} avatarUrl={s.createdByImage} size={18} />
                      <span className="truncate text-[11px] text-[var(--muted-foreground)]">
                        {s.createdByName || 'Someone'} · {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-shrink-0 items-center gap-1">
                  {editing ? (
                    <>
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={savingEdit}
                        title="Save"
                        className="rounded-md p-1.5 text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/10 disabled:opacity-50"
                      >
                        <CheckIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        title="Cancel"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(s)}
                        title="Edit"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(s)}
                        title="Remove"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
