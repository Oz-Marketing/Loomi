'use client';

/**
 * Ad Size Library — a shared, named set of ad sizes the template builder draws
 * from. Anyone signed in can add one (name + W×H); each row shows who created
 * it and when. Behind AD_GENERATOR_ENABLED (the route layout 404s when off).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftIcon, PlusIcon, TrashIcon, RectangleGroupIcon } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';

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
  const [sizes, setSizes] = useState<AdSize[] | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/ad-generator/sizes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSizes((s) => (s ?? []).filter((x) => x.id !== id));
      toast.success('Removed');
    } catch (err) {
      toast.error(`Couldn't remove: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <RectangleGroupIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Ad Size Library</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Named ad sizes the template builder picks from. Anyone can add one.</p>
          </div>
        </div>
        <Link
          href="/ad-generator/builder"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Builder
        </Link>
      </div>

      {/* Create */}
      <div className="glass-card mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] p-4">
        <label className="flex-1">
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
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add size
        </button>
      </div>

      {/* List */}
      {sizes === null ? (
        <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : sizes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No sizes yet. Add the ones your team designs against (Square, Story, Landscape…).
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sizes.map((s) => {
            const ratio = s.width / s.height;
            const boxW = ratio >= 1 ? 44 : 44 * ratio;
            const boxH = ratio >= 1 ? 44 / ratio : 44;
            return (
              <div key={s.id} className="glass-card flex items-center gap-3 rounded-2xl border border-[var(--border)] p-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/40">
                  <div className="rounded-[2px] bg-[var(--primary)]/30 ring-1 ring-[var(--primary)]/50" style={{ width: boxW, height: boxH }} />
                </div>
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
                <button
                  onClick={() => remove(s.id)}
                  title="Remove"
                  className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
