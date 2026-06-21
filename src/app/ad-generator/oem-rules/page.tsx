'use client';

/**
 * OEM compliance rule manager (admin) — CRUD over `AdOemOfferRule`. Each rule
 * is a make + the fields that MUST be filled (beyond the intrinsic baseline)
 * per offer type before an ad can be exported. The generator unions the rule
 * for the active account's OEM with the baseline. Flag-gated by the tool
 * layout; admin-only.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftIcon, PlusIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { OFFER_TYPES } from '@/lib/ad-generator/offer-text';
import { FIELD_LABELS } from '@/lib/ad-generator/compliance';

// Offer types that have structured fields (custom has none).
const EDITABLE_TYPES = OFFER_TYPES.filter((t) => t.value !== 'custom');
// Fields an OEM might additionally require (the baseline numbers are always
// required and handled in code, so they're not listed here).
const REQUIREABLE_FIELDS = [
  'vin',
  'stockNumber',
  'msrp',
  'financialInstitution',
  'dueAtSigning',
  'discountSource',
  'disclaimer',
  'expiration',
];

interface Rule {
  id: string;
  make: string;
  requiredFields: Record<string, string[]>;
  notes: string | null;
  isActive: boolean;
}
interface Draft {
  id?: string;
  make: string;
  requiredFields: Record<string, string[]>;
  notes: string;
  isActive: boolean;
}
const EMPTY: Draft = { make: '', requiredFields: {}, notes: '', isActive: true };
const TYPE_LABEL = Object.fromEntries(OFFER_TYPES.map((o) => [o.value, o.label]));

export default function OemRulesPage() {
  const { userRole } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  const [items, setItems] = useState<Rule[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ad-generator/oem-rules?all=1');
      const d = res.ok ? await res.json() : { rules: [] };
      setItems(d.rules ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  function toggleField(type: string, key: string) {
    setDraft((d) => {
      if (!d) return d;
      const cur = d.requiredFields[type] ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...d, requiredFields: { ...d.requiredFields, [type]: next } };
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.make.trim()) {
      toast.error('Make is required');
      return;
    }
    setSaving(true);
    try {
      const requiredFields: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(draft.requiredFields)) if (v.length) requiredFields[k] = v;
      const isEdit = Boolean(draft.id);
      const res = await fetch(
        isEdit ? `/api/ad-generator/oem-rules/${draft.id}` : '/api/ad-generator/oem-rules',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ make: draft.make, requiredFields, notes: draft.notes, isActive: draft.isActive }),
        },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(isEdit ? 'Rule updated' : 'Rule created');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this OEM rule?')) return;
    try {
      const res = await fetch(`/api/ad-generator/oem-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Deleted');
      await load();
    } catch {
      toast.error('Could not delete');
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-[var(--muted-foreground)]">
        OEM rules are managed by admins.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-3 flex items-center gap-3">
        <Link
          href="/ad-generator"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          aria-label="Back to Ad Generator"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">OEM compliance rules</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Fields each make requires (beyond the intrinsic baseline) before an ad can be exported.
          </p>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex gap-1 text-xs">
          <Link href="/ad-generator/templates" className="rounded-md px-2.5 py-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            Disclaimer Templates
          </Link>
          <span className="rounded-md bg-[var(--primary)]/10 px-2.5 py-1 font-medium text-[var(--primary)]">OEM Rules</span>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft({ ...EMPTY })}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" /> New rule
          </button>
        )}
      </div>

      {draft && (
        <div className="glass-card mb-5 rounded-xl border border-[var(--primary)]/30 p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">{draft.id ? 'Edit rule' : 'New rule'}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Make</label>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                value={draft.make}
                placeholder="GM"
                onChange={(e) => setDraft({ ...draft, make: e.target.value })}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                Active
              </label>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-[var(--foreground)]">Required fields per offer type</p>
            {EDITABLE_TYPES.map((t) => {
              const selected = draft.requiredFields[t.value] ?? [];
              return (
                <div key={t.value} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">{t.label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {REQUIREABLE_FIELDS.map((key) => {
                      const on = selected.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleField(t.value, key)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            on
                              ? 'bg-[var(--primary)] text-white'
                              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                          }`}
                        >
                          {FIELD_LABELS[key] ?? key}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Notes <span className="font-normal text-[var(--muted-foreground)]">— admin reference</span></label>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              value={draft.notes}
              placeholder="Per GM co-op audit 2026"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create rule'}
            </button>
          </div>
        </div>
      )}

      {items === null ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No OEM rules yet — only the baseline required fields apply. Add a rule to require extra fields per make.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const summary = EDITABLE_TYPES.filter((t) => (r.requiredFields[t.value]?.length ?? 0) > 0)
              .map((t) => `${TYPE_LABEL[t.value]}: ${r.requiredFields[t.value].map((k) => FIELD_LABELS[k] ?? k).join(', ')}`)
              .join('  ·  ');
            return (
              <div key={r.id} className="glass-card rounded-xl border border-[var(--border)] p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--foreground)]">{r.make}</span>
                    {!r.isActive && (
                      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">Inactive</span>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => setDraft({ id: r.id, make: r.make, requiredFields: r.requiredFields, notes: r.notes ?? '', isActive: r.isActive })}
                      className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      aria-label="Edit"
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-400"
                      aria-label="Delete"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">{summary || 'No extra requirements'}</p>
                {r.notes && <p className="mt-1 text-[11px] italic text-[var(--muted-foreground)]">{r.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
