'use client';

// Minimal "Add contact" modal — same fields the CSV importer asks
// for, just one row at a time. Goes through POST /api/contacts so
// validation (at-least-one-of email/phone, dedup) is centralised.

import { useMemo, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import type {
  CustomFieldDto,
  CustomFieldType,
} from '@/lib/contacts/custom-field-types';

interface AddContactModalProps {
  accountKey: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AddContactModal({ accountKey, onClose, onCreated }: AddContactModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Declared custom fields for this account → rendered as type-aware
  // inputs at the bottom of the form. State lives in a single record
  // keyed by the field's `key` so we can post `customFields` as-is.
  const { customFields: declaredCustomFields } = useFilterableFields(accountKey);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});

  function setCustomValue(key: string, value: unknown) {
    setCustomValues((prev) => ({ ...prev, [key]: value }));
  }

  // Build the customFields payload, dropping empty entries so a blank
  // input doesn't shadow an existing value on subsequent edits.
  const customFieldsPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(customValues)) {
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    return out;
  }, [customValues]);

  const canSubmit = email.trim().length > 0 || phone.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      setError('Provide at least an email or phone.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          source: source.trim() || null,
          customFields:
            Object.keys(customFieldsPayload).length > 0 ? customFieldsPayload : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create contact');
      }
      toast.success('Contact added.');
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-2xl border border-[var(--border)] w-full max-w-md mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold">Add Contact</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/40"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </Field>
            <Field label="Last name">
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </Field>
          </div>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </Field>

          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </Field>

          <Field label="Source">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Website, walk-in, referral, …"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </Field>

          {declaredCustomFields.length > 0 && (
            <div className="pt-2 border-t border-[var(--border)]/70">
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
                Custom fields
              </p>
              <div className="space-y-3">
                {declaredCustomFields.map((cf) => (
                  <Field key={cf.id} label={cf.label}>
                    <CustomFieldInput
                      field={cf}
                      value={customValues[cf.key]}
                      onChange={(v) => setCustomValue(cf.key, v)}
                    />
                    {cf.description && (
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                        {cf.description}
                      </p>
                    )}
                  </Field>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[var(--muted-foreground)]">
            At minimum, provide email or phone. The contact will be deduped against existing rows on those keys.
          </p>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 h-9 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : 'Add Contact'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Type-aware custom field input ───────────────────────────────

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]';

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDto;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const t: CustomFieldType = field.type;

  if (t === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <label className="inline-flex items-center gap-2 h-9 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        <span className="text-xs text-[var(--muted-foreground)]">
          {checked ? 'Yes' : 'No'}
        </span>
      </label>
    );
  }

  if (t === 'date') {
    return (
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={INPUT_CLASS}
      />
    );
  }

  if (t === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={INPUT_CLASS}
      />
    );
  }

  if (t === 'select' && field.options && field.options.length > 0) {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={INPUT_CLASS}
      >
        <option value="">Select…</option>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (t === 'multiselect' && field.options && field.options.length > 0) {
    // Treat the stored value as an array of option values. Toggle in
    // place on checkbox click; persist as an array so the contact API
    // round-trips it as JSON instead of a comma-separated string.
    const current = Array.isArray(value)
      ? (value as string[]).map(String)
      : typeof value === 'string' && value
        ? value.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    return (
      <div className="space-y-1.5">
        {field.options.map((opt) => {
          const checked = current.includes(opt.value);
          return (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? Array.from(new Set([...current, opt.value]))
                    : current.filter((v) => v !== opt.value);
                  onChange(next);
                }}
                className="rounded border-[var(--border)]"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  }

  // text (default) + any unknown type fallback.
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT_CLASS}
    />
  );
}
