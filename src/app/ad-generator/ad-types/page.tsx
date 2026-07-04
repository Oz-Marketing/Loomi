'use client';

/**
 * Ad Types manager (admin) — CRUD over `AdType`. An ad type is a taxonomy entry
 * scoped to an INDUSTRY that carries a question set (FieldSpec[]) + a vehicleMode
 * (none/single/dual) toggling the built-in vehicle/offer engine. Templates +
 * from-scratch ads pick a type; an account only sees types for its industry.
 * Flag-gated by the /ad-generator layout; admin-only here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftIcon, PlusIcon, PencilSquareIcon, TrashIcon, TruckIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import type { FieldSpec, FieldType } from '@/lib/ad-generator/types';
import type { AdType, AdTypeVehicleMode } from '@/lib/ad-generator/ad-types';

const FIELD_TYPE_OPTIONS: FontSelectOption[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'color', label: 'Color' },
  { value: 'image', label: 'Image URL' },
];

const VEHICLE_MODES: { value: AdTypeVehicleMode; label: string; help: string }[] = [
  { value: 'none', label: 'No vehicle', help: 'A plain form — just the questions below.' },
  { value: 'single', label: 'Single offer', help: 'Vehicle + one OEM/lease/APR/discount offer (EVOX + OEM tools).' },
  { value: 'dual', label: 'Dual offer', help: 'Two offers (one or two models).' },
];

interface Draft {
  id?: string;
  name: string;
  description: string;
  industry: string;
  category: string;
  vehicleMode: AdTypeVehicleMode;
  fields: FieldSpec[];
  isActive: boolean;
}

const EMPTY: Draft = { name: '', description: '', industry: '', category: '', vehicleMode: 'none', fields: [], isActive: true };

let keySeq = 0;
const nextKey = () => `q_${Date.now().toString(36)}_${keySeq++}`;

export default function AdTypesPage() {
  const { userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  const { confirm } = useLoomiDialog();

  const [items, setItems] = useState<AdType[] | null>(null);
  const [industries, setIndustries] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ad-generator/ad-types?all=1');
      const d = res.ok ? await res.json() : { adTypes: [] };
      setItems(d.adTypes ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    fetch('/api/industries')
      .then((r) => (r.ok ? r.json() : { industries: [] }))
      .then((d: { industries?: string[] }) => setIndustries(d.industries ?? []))
      .catch(() => setIndustries([]));
  }, [isAdmin, load]);

  const grouped = useMemo(() => {
    const m = new Map<string, AdType[]>();
    for (const t of items ?? []) {
      const g = t.industry || 'Other';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(t);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error('Name is required');
    if (!draft.industry.trim()) return toast.error('Pick an industry');
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description,
        industry: draft.industry,
        category: draft.category,
        vehicleMode: draft.vehicleMode,
        fields: draft.fields,
        isActive: draft.isActive,
      };
      const res = await fetch(
        draft.id ? `/api/ad-generator/ad-types/${draft.id}` : '/api/ad-generator/ad-types',
        { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(draft.id ? 'Ad type saved' : 'Ad type created');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: AdType) {
    const ok = await confirm({
      title: 'Delete ad type?',
      message: `“${t.name}” will be removed. Templates/ads already tagged with it keep working (they just lose the tag).`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/ad-types/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Deleted');
      await load();
    } catch {
      toast.error('Could not delete');
    }
  }

  if (!isAdmin) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-[var(--muted-foreground)]">Ad types are managed by admins.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/ad-generator"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            aria-label="Back to Ad Generator"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Ad types</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Reusable ad categories per industry. Each defines the form questions (and whether it uses the vehicle/offer engine); accounts only see types for their industry.
            </p>
          </div>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft({ ...EMPTY, industry: industries[0] ?? '' })}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" /> New ad type
          </button>
        )}
      </div>

      {draft && (
        <AdTypeForm draft={draft} setDraft={setDraft} industries={industries} onSave={save} onCancel={() => setDraft(null)} saving={saving} nextKey={nextKey} />
      )}

      {items === null ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">No ad types yet — add one to give from-scratch ads a question set and to tag templates.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([industry, types]) => (
            <div key={industry}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{industry}</h2>
              <div className="space-y-2">
                {types.map((t) => (
                  <div key={t.id} className="glass-card flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)]">{t.name}</span>
                        {t.category && <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">{t.category}</span>}
                        {t.vehicleMode !== 'none' && (
                          <span className="inline-flex items-center gap-1 rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                            <TruckIcon className="h-3 w-3" /> {t.vehicleMode === 'dual' ? 'Dual offer' : 'Single offer'}
                          </span>
                        )}
                        {!t.isActive && <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">Inactive</span>}
                      </div>
                      {t.description && <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{t.description}</p>}
                      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{t.fields.length} question{t.fields.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => setDraft({ id: t.id, name: t.name, description: t.description ?? '', industry: t.industry, category: t.category ?? '', vehicleMode: t.vehicleMode, fields: t.fields, isActive: t.isActive ?? true })}
                        title="Edit"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(t)} title="Delete" className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdTypeForm({
  draft, setDraft, industries, onSave, onCancel, saving, nextKey,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  industries: string[];
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  nextKey: () => string;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setField = (i: number, patch: Partial<FieldSpec>) => set({ fields: draft.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const addField = () => set({ fields: [...draft.fields, { key: nextKey(), label: 'New question', type: 'text' }] });
  const removeField = (i: number) => set({ fields: draft.fields.filter((_, idx) => idx !== i) });
  const industryOptions: FontSelectOption[] = industries.map((i) => ({ value: i, label: i }));

  const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

  return (
    <div className="glass-card mb-6 rounded-2xl border border-[var(--border)] p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Name</label>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Vehicle Offer" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Industry</label>
          <FontSelect value={draft.industry} onChange={(v) => set({ industry: v })} options={industryOptions} previewFont={false} placeholder="Select industry…" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Category</label>
          <input value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Sales, Service, Event" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Description</label>
          <input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Optional — shown in the New-ad picker" className={inputCls} />
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Vehicle / offer engine</label>
        <div className="flex flex-wrap gap-1.5">
          {VEHICLE_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => set({ vehicleMode: m.value })}
              title={m.help}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                draft.vehicleMode === m.value
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{VEHICLE_MODES.find((m) => m.value === draft.vehicleMode)?.help}</p>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Questions</label>
          <button onClick={addField} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]">
            <PlusIcon className="h-3.5 w-3.5" /> Add question
          </button>
        </div>
        {draft.vehicleMode !== 'none' && (
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">The vehicle + offer questions are added automatically by the engine; add any extra questions below.</p>
        )}
        {draft.fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No custom questions yet.</p>
        ) : (
          <div className="space-y-2">
            {draft.fields.map((f, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Label" className={inputCls} />
                  <FontSelect value={f.type} onChange={(v) => setField(i, { type: v as FieldType })} options={FIELD_TYPE_OPTIONS} previewFont={false} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input value={f.group ?? ''} onChange={(e) => setField(i, { group: e.target.value || undefined })} placeholder="Group (e.g. Offer)" className={inputCls} />
                  <input value={f.placeholder ?? ''} onChange={(e) => setField(i, { placeholder: e.target.value || undefined })} placeholder="Placeholder" className={inputCls} />
                </div>
                {f.type === 'select' && (
                  <input
                    className={`${inputCls} mt-2`}
                    placeholder="Options — comma separated (e.g. Small, Medium, Large)"
                    value={(f.options ?? []).map((o) => o.label).join(', ')}
                    onChange={(e) =>
                      setField(i, {
                        options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((label) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label })),
                      })
                    }
                  />
                )}
                <div className="mt-2 flex justify-end">
                  <button onClick={() => removeField(i)} className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-500">
                    <TrashIcon className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
        <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="accent-[var(--primary)]" />
          Active (available in the New-ad picker)
        </label>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50">Cancel</button>
          <button onClick={onSave} disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save ad type'}</button>
        </div>
      </div>
    </div>
  );
}
