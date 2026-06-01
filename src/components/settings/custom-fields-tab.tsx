'use client';

// Sub-account custom fields tab.
//
// Lists the active sub-account's contact custom fields. Each row shows
// the label/key/type/category, a "From blueprint" badge when the
// field is blueprint-derived, and a "Sync" action when the blueprint
// has updates available. Add / Edit / Delete open the shared modal.

import { useCallback, useEffect, useState } from 'react';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ArrowPathIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { CustomFieldEditorModal } from './custom-field-editor-modal';
import type {
  CustomFieldDto,
  CustomFieldType,
} from '@/lib/contacts/custom-field-types';

const TYPE_PILL: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes/No',
  select: 'Select',
  multiselect: 'Multi-select',
};

export function CustomFieldsTab() {
  const { accountKey } = useAccount();
  const { confirm } = useLoomiDialog();
  const [fields, setFields] = useState<CustomFieldDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDto | null>(null);

  const load = useCallback(async () => {
    if (!accountKey) {
      setFields([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/contact-custom-fields?accountKey=${encodeURIComponent(accountKey)}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        fields?: CustomFieldDto[];
      };
      setFields(Array.isArray(data.fields) ? data.fields : []);
    } catch {
      toast.error('Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(field: CustomFieldDto) {
    const ok = await confirm({
      title: `Delete "${field.label}"?`,
      message: field.parentBlueprintId
        ? 'This field was deployed from a blueprint. Deleting it only removes the declaration on this sub-account — the blueprint is unaffected. Existing values on contacts are preserved.'
        : 'Existing values on contacts are preserved, but the field stops appearing in the filter builder and contact UI.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(
      `/api/contact-custom-fields/${encodeURIComponent(field.id)}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      toast.success('Field deleted');
      await load();
    } else {
      toast.error('Failed to delete field');
    }
  }

  async function handleSync(field: CustomFieldDto) {
    const res = await fetch(
      `/api/contact-custom-fields/${encodeURIComponent(field.id)}/sync`,
      { method: 'POST' },
    );
    if (res.ok) {
      toast.success('Synced from blueprint');
      await load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error || 'Failed to sync');
    }
  }

  if (!accountKey) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--muted-foreground)] text-sm">
          Select a sub-account to manage its custom fields.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
          Custom fields extend the standard contact schema with your own
          properties — e.g. <span className="font-mono">last_service_date</span>,{' '}
          <span className="font-mono">lifetime_value</span>. They appear in the
          filter builder, CSV importer, and on contact detail pages.
        </p>
        <PrimaryButton
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <PlusIcon className="w-4 h-4" />
          Add field
        </PrimaryButton>
      </div>

      <div className="glass-section-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">
            Loading…
          </div>
        ) : fields.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-[var(--foreground)] mb-1">
              No custom fields yet
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Click <span className="text-[var(--foreground)] font-medium">Add field</span> to declare one, or have an admin deploy a blueprint.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]/40 border-b border-[var(--border)]">
              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5">Field</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
                      {f.label}
                      {f.isPii && (
                        <LockClosedIcon
                          className="w-3 h-3 text-[var(--muted-foreground)]"
                          title="PII"
                        />
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--muted-foreground)]">
                      {f.key}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {TYPE_PILL[f.type]}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {f.category ?? <span className="opacity-50">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {f.parentBlueprintId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-[var(--primary)]/10 text-[var(--primary)]">
                        Blueprint
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        Local
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {f.hasUpdate && (
                        <button
                          onClick={() => handleSync(f)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                          title="Update available from blueprint"
                        >
                          <ArrowPathIcon className="w-3 h-3" />
                          Sync
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditing(f);
                          setModalOpen(true);
                        }}
                        className="p-1.5 rounded-md hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        title="Edit"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(f)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-400"
                        title="Delete"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CustomFieldEditorModal
        open={modalOpen}
        mode="instance"
        editing={editing}
        accountKey={accountKey}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          load();
        }}
      />
    </div>
  );
}
