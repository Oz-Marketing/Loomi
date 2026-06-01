'use client';

// Create / edit modal for a contact custom field.
//
// Used by both the Custom Fields tab (sub-account) and the Custom
// Field Blueprints tab (admin). The two modes differ in:
//   - mode='blueprint' shows the Industry Tag + CSV Aliases inputs
//   - mode='instance'  hides those (they cascade from the blueprint)
//
// The form auto-derives `key` from `label` until the user manually
// edits the key field, so 99% of the time the user just types a label.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDto,
  type CustomFieldOption,
  type CustomFieldType,
} from '@/lib/contacts/custom-field-types';

const INDUSTRY_OPTIONS = [
  'Automotive',
  'Powersports',
  'Ecommerce',
  'Healthcare',
  'Real Estate',
  'Hospitality',
  'Retail',
  'General',
];

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  select: 'Select (one of)',
  multiselect: 'Multi-select',
};

export interface CustomFieldEditorModalProps {
  open: boolean;
  mode: 'blueprint' | 'instance';
  /** When set, the modal opens in edit mode pre-filled from this row. */
  editing?: CustomFieldDto | null;
  /** Required for instance-mode create. Ignored in edit mode (key is
   *  read from `editing`). */
  accountKey?: string | null;
  onClose: () => void;
  onSaved: (field: CustomFieldDto) => void;
}

export function CustomFieldEditorModal({
  open,
  mode,
  editing,
  accountKey,
  onClose,
  onSaved,
}: CustomFieldEditorModalProps) {
  const isEdit = !!editing;

  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  // Tracks whether the user has manually edited `key`. When false, we
  // auto-derive it from `label`. Switches to true the moment they touch
  // the key field directly.
  const [keyDirty, setKeyDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [category, setCategory] = useState('');
  const [isPii, setIsPii] = useState(false);
  const [industryTag, setIndustryTag] = useState('');
  const [csvAliases, setCsvAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset / hydrate when the modal opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setLabel(editing.label);
      setKey(editing.key);
      setKeyDirty(true);
      setDescription(editing.description ?? '');
      setType(editing.type);
      setOptions(editing.options ?? []);
      setCategory(editing.category ?? '');
      setIsPii(editing.isPii);
      setIndustryTag(editing.industryTag ?? '');
      setCsvAliases(editing.csvAliases ?? []);
    } else {
      setLabel('');
      setKey('');
      setKeyDirty(false);
      setDescription('');
      setType('text');
      setOptions([]);
      setCategory('');
      setIsPii(false);
      setIndustryTag('');
      setCsvAliases([]);
    }
    setAliasInput('');
  }, [open, editing]);

  // Auto-derive key from label until the user manually touches the key.
  useEffect(() => {
    if (keyDirty) return;
    setKey(deriveKey(label));
  }, [label, keyDirty]);

  const isSelectish = type === 'select' || type === 'multiselect';
  const keyLocked = isEdit && !!editing?.parentBlueprintId;

  const canSubmit = useMemo(() => {
    if (!label.trim()) return false;
    if (!key.trim()) return false;
    if (isSelectish && options.length === 0) return false;
    return true;
  }, [label, key, isSelectish, options.length]);

  async function handleSave() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        label: label.trim(),
        description: description.trim() || null,
        type,
        options: isSelectish ? options : null,
        category: category.trim() || null,
        isPii,
      };
      if (mode === 'blueprint') {
        body.industryTag = industryTag.trim() || null;
        body.csvAliases = csvAliases;
      }

      let res: Response;
      if (isEdit && editing) {
        res = await fetch(
          `/api/contact-custom-fields/${encodeURIComponent(editing.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
      } else {
        body.key = key.trim();
        body.accountKey = mode === 'blueprint' ? null : accountKey ?? null;
        res = await fetch(`/api/contact-custom-fields`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      const data = (await res.json().catch(() => ({}))) as {
        field?: CustomFieldDto;
        error?: string;
      };

      if (!res.ok || !data.field) {
        toast.error(data.error || 'Failed to save custom field');
        return;
      }
      onSaved(data.field);
      onClose();
      toast.success(isEdit ? 'Field updated' : 'Field created');
    } finally {
      setSaving(false);
    }
  }

  function addOption() {
    setOptions((curr) => [
      ...curr,
      { value: `option_${curr.length + 1}`, label: `Option ${curr.length + 1}` },
    ]);
  }

  function updateOption(idx: number, patch: Partial<CustomFieldOption>) {
    setOptions((curr) =>
      curr.map((opt, i) => (i === idx ? { ...opt, ...patch } : opt)),
    );
  }

  function removeOption(idx: number) {
    setOptions((curr) => curr.filter((_, i) => i !== idx));
  }

  function commitAlias() {
    const trimmed = aliasInput.trim();
    if (!trimmed) return;
    setCsvAliases((curr) =>
      curr.includes(trimmed) ? curr : [...curr, trimmed],
    );
    setAliasInput('');
  }

  function removeAlias(alias: string) {
    setCsvAliases((curr) => curr.filter((a) => a !== alias));
  }

  if (!open) return null;

  // Portal to document.body so the modal escapes LayoutShell's
  // scrolling <main> container — without this, `fixed inset-0`
  // gets contained by the scrolling ancestor in Chrome and the
  // backdrop fails to cover the sidebar / header. Same pattern
  // the flow builder's InsertStepMenu uses for the same reason.
  if (typeof document === 'undefined') return null;

  return createPortal(
    // z-[260] matches the LoomiDialog stacking layer so we sit above
    // the sidebar (which is z-50) and any dropdowns inside the page.
    // bg-black/70 + backdrop-blur-md gives enough contrast on dark
    // themes that the editor reads as modal, not as an overlay wash.
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      {/* frost-heavy is the project's "read strongly over busy page
          content" surface (rgba(28,28,36,0.98) in dark mode). The
          inner card needs near-opaque so form labels + inputs stay
          legible against any underlying page bg.

          Three-row flex column so header + footer stay pinned and only
          the body scrolls — long blueprint forms (industry tag + CSV
          aliases) push past 90vh otherwise. */}
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col frost-heavy rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {isEdit ? 'Edit' : 'New'} {mode === 'blueprint' ? 'blueprint' : 'custom field'}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <Field label="Label" hint="Shown wherever a human sees the field.">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Last service date"
              className={inputClass}
              autoFocus
            />
          </Field>

          <Field
            label="Key"
            hint="Lowercase identifier used internally. Auto-derived from the label — you usually don't need to edit it."
          >
            <input
              type="text"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyDirty(true);
              }}
              placeholder="last_service_date"
              disabled={keyLocked}
              className={`${inputClass} font-mono ${keyLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {keyLocked && (
              <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                Key is locked because this field was deployed from a blueprint.
              </p>
            )}
          </Field>

          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              className={inputClass}
              disabled={keyLocked}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {keyLocked && (
              <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                Type is locked for blueprint-derived fields. Edit the blueprint and re-sync.
              </p>
            )}
          </Field>

          {isSelectish && (
            <Field
              label="Options"
              hint="Each option is { value, label }. Value is what's stored on the contact; label is what's shown."
            >
              <div className="space-y-2">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt.value}
                      onChange={(e) =>
                        updateOption(idx, { value: e.target.value })
                      }
                      placeholder="value"
                      className={`${inputClass} font-mono flex-1`}
                    />
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) =>
                        updateOption(idx, { label: e.target.value })
                      }
                      placeholder="Label"
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      onClick={() => removeOption(idx)}
                      className="text-[var(--muted-foreground)] hover:text-red-400"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addOption}
                  className="text-xs flex items-center gap-1 text-[var(--primary)] hover:opacity-80"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Add option
                </button>
              </div>
            </Field>
          )}

          <Field label="Description (optional)" hint="Helper text shown beneath the input on contact forms.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Category (optional)" hint="Groups this field in the filter dropdown. e.g. &ldquo;Service&rdquo;.">
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Custom"
                className={inputClass}
              />
            </Field>

            <Field label="PII / sensitive">
              <label className="flex items-center gap-2 h-10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPii}
                  onChange={(e) => setIsPii(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <span className="text-xs text-[var(--muted-foreground)]">
                  Treat values as personally identifiable
                </span>
              </label>
            </Field>
          </div>

          {mode === 'blueprint' && (
            <>
              <div className="border-t border-[var(--border)] pt-4">
                <h3 className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
                  Blueprint settings
                </h3>

                <Field
                  label="Industry tag (optional)"
                  hint="Lets you bulk-apply &ldquo;all Automotive blueprints&rdquo; to every Automotive sub-account."
                >
                  <select
                    value={industryTag}
                    onChange={(e) => setIndustryTag(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">No tag</option>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="CSV header aliases (optional)"
                  hint="When importing a CSV, headers matching any of these will auto-map to this custom field."
                >
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                    {csvAliases.map((alias) => (
                      <span
                        key={alias}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-[var(--muted)] text-[var(--foreground)]"
                      >
                        <span className="font-mono">{alias}</span>
                        <button
                          onClick={() => removeAlias(alias)}
                          className="text-[var(--muted-foreground)] hover:text-red-400"
                        >
                          <XMarkIcon className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          commitAlias();
                        }
                      }}
                      placeholder="last_purchase, soldon, ..."
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      onClick={commitAlias}
                      className="px-3 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--accent)]"
                    >
                      Add
                    </button>
                  </div>
                </Field>
              </div>
            </>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 h-10 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
          <PrimaryButton onClick={handleSave} disabled={!canSubmit || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create field'}
          </PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── helpers ─────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] text-[var(--muted-foreground)] mt-1">{hint}</p>
      )}
    </div>
  );
}

function deriveKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, 50);
}
