'use client';

/**
 * OEM compliance rule manager (admin) — CRUD over `AdOemOfferRule`. Each rule
 * is a make + the fields that MUST be filled (beyond the intrinsic baseline)
 * per offer type before an ad can be exported. The generator unions the rule
 * for the active account's OEM with the baseline.
 *
 * A STUDIO settings tab (Settings → OEM Rules), next to Disclaimers — the pair
 * is read together, and both are sector-wide compliance config rather than
 * anything a single ad owns. The old /ad-generator/oem-rules route redirects
 * here. Admin-only; the registry gates the tab, and the guard below covers a
 * deep link that outruns the rail.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { OFFER_TYPES } from '@/lib/ad-generator/offer-text';
import { FIELD_LABELS } from '@/lib/ad-generator/compliance';
import { vehicleOffer } from '@/lib/ad-generator/templates/vehicle-offer';
import { isFieldVisible } from '@/lib/ad-generator/types';

// All offer types are editable — including custom. Its on-ad copy is free text,
// but an OEM can still require fields on a custom offer (e.g. ODT's Mazda custom
// rule requires the financial institution), so it needs a section here too.
const EDITABLE_TYPES = OFFER_TYPES;
// Fields an OEM might additionally require (the baseline numbers are always
// required and handled in code, so they're not listed here).
// Every field an OEM rule may require, beyond the code baseline. Superset of
// what the ODT-ported rules use — keep in sync with FIELD_LABELS so each chip
// gets a human label.
const REQUIREABLE_FIELDS = [
  'vin',
  'stockNumber',
  'vehicleName',
  'msrp',
  'monthlyPayment',
  'leaseTerm',
  'dueAtSigning',
  'securityDeposit',
  'aprRate',
  'aprTerm',
  'financialInstitution',
  'costPerThousand',
  'discountAmount',
  'discountSource',
  'salePrice',
  'disclaimer',
  'expiration',
];

// Whether a field actually appears on the client form for a given offer type
// (via the field's visibleWhen). Fields that don't are still selectable in the
// editor but de-emphasized, so the eye goes to what usually applies there.
const FIELD_SPECS = Object.fromEntries(vehicleOffer.fields.map((f) => [f.key, f]));
function isTypical(key: string, offerType: string): boolean {
  const spec = FIELD_SPECS[key];
  return spec ? isFieldVisible(spec, { offerType }) : true;
}

function PillToggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-[var(--primary)]' : 'border border-[var(--border)] bg-[var(--muted)]'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

interface Rule {
  id: string;
  make: string;
  requiredFields: Record<string, string[]>;
  defaultValues?: Record<string, Record<string, string>>;
  notes: string | null;
  isActive: boolean;
}
interface Draft {
  id?: string;
  make: string;
  requiredFields: Record<string, string[]>;
  /** offer type → { field: standing value }. See `AdOemOfferRule.defaultValues`. */
  defaultValues: Record<string, Record<string, string>>;
  notes: string;
  isActive: boolean;
}
const EMPTY: Draft = { make: '', requiredFields: {}, defaultValues: {}, notes: '', isActive: true };
const TYPE_LABEL = Object.fromEntries(OFFER_TYPES.map((o) => [o.value, o.label]));

export function AdOemRulesTab() {
  const { userRole, account, accountData } = useAccount();
  const isAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  // When viewing a specific subaccount, scope to that account's OEM; admin sees all.
  const scopedOem = account.mode === 'account' ? (accountData?.oem || accountData?.oems?.[0] || '').trim() : '';

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

  // Scoped to a subaccount's OEM → only that make's rule; admin sees every make.
  const visible = items && scopedOem ? items.filter((r) => r.make.toLowerCase() === scopedOem.toLowerCase()) : items;

  /** Set (or clear) a standing value for one field of one offer type. */
  function setDefault(type: string, key: string, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const forType = { ...(d.defaultValues[type] ?? {}) };
      if (value.trim()) forType[key] = value;
      else delete forType[key];
      const next = { ...d.defaultValues };
      if (Object.keys(forType).length) next[type] = forType;
      else delete next[type];
      return { ...d, defaultValues: next };
    });
  }

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
          body: JSON.stringify({
            make: draft.make,
            requiredFields,
            defaultValues: draft.defaultValues,
            notes: draft.notes,
            isActive: draft.isActive,
          }),
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
      <p className="py-8 text-sm text-[var(--muted-foreground)]">
        OEM rules are managed by admins.
      </p>
    );
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">
          Fields each make requires (beyond the intrinsic baseline) before an ad can be exported.
        </p>
        {!draft && (
          <button
            onClick={() => setDraft({ ...EMPTY, make: scopedOem })}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-3.5 w-3.5" /> New rule
          </button>
        )}
      </header>

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
            <div className="flex items-end pb-1.5">
              <PillToggle checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} label="Active" />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-[var(--foreground)]">Required fields per offer type</p>
            {EDITABLE_TYPES.map((t) => {
              const selected = draft.requiredFields[t.value] ?? [];
              return (
                <div key={t.value} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--foreground)]">{t.label}</span>
                      <span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                        {selected.length} required
                      </span>
                    </div>
                    {selected.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDraft((d) => (d ? { ...d, requiredFields: { ...d.requiredFields, [t.value]: [] } } : d))}
                        className="text-[10px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {REQUIREABLE_FIELDS.map((key) => {
                      const on = selected.includes(key);
                      const typical = isTypical(key, t.value);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleField(t.value, key)}
                          title={!typical ? `Not shown on the ${t.label} form — usually not required here` : undefined}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            on
                              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                              : typical
                                ? 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                                : 'border border-dashed border-[var(--border)] text-[var(--muted-foreground)]/45 hover:border-[var(--primary)] hover:text-[var(--muted-foreground)]'
                          }`}
                        >
                          {FIELD_LABELS[key] ?? key}
                        </button>
                      );
                    })}
                  </div>

                  {/* Standing values.
                      Some required disclosures belong to the PROGRAMME rather than
                      the offer, so the feed never carries them and generation is
                      blocked forever without somewhere to assert them. Subaru §6x is
                      the case in hand: the ad must state whether a security deposit
                      is required, and "none required" satisfies it.

                      Only offered for fields already marked required, and only for
                      this offer type — a value here is applied to every generated ad
                      of that type, and each draft records that it came from here. */}
                  {selected.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        Standing values — used only when the offer doesn&rsquo;t carry the field. Leave blank to
                        require it from the offer, which skips ads that lack it.
                      </p>
                      {selected.map((key) => (
                        <div key={`def-${key}`} className="flex items-center gap-2">
                          <span className="w-40 flex-shrink-0 truncate text-[11px] text-[var(--muted-foreground)]">
                            {FIELD_LABELS[key] ?? key}
                          </span>
                          <input
                            value={draft.defaultValues[t.value]?.[key] ?? ''}
                            onChange={(e) => setDefault(t.value, key, e.target.value)}
                            placeholder="from the offer"
                            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                          />
                        </div>
                      ))}
                    </div>
                  )}
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
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create rule'}
            </button>
          </div>
        </div>
      )}

      {visible === null ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {scopedOem
            ? `No OEM rule for ${scopedOem} yet — only the baseline required fields apply. Add one to require extra fields.`
            : 'No OEM rules yet — only the baseline required fields apply. Add a rule to require extra fields per make.'}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => {
            const activeTypes = EDITABLE_TYPES.filter((t) => (r.requiredFields[t.value]?.length ?? 0) > 0);
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
                      onClick={() => setDraft({ id: r.id, make: r.make, requiredFields: r.requiredFields, defaultValues: r.defaultValues ?? {}, notes: r.notes ?? '', isActive: r.isActive })}
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
                {activeTypes.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">No extra requirements — baseline fields only.</p>
                ) : (
                  <div className="space-y-1.5">
                    {activeTypes.map((t) => (
                      <div key={t.value} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="w-36 shrink-0 text-[11px] font-semibold text-[var(--foreground)]">{TYPE_LABEL[t.value]}</span>
                        <div className="flex flex-1 flex-wrap gap-1">
                          {r.requiredFields[t.value].map((k) => (
                            <span key={k} className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                              {FIELD_LABELS[k] ?? k}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {r.notes && <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] italic text-[var(--muted-foreground)]">{r.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
