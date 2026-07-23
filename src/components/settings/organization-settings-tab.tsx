'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

/**
 * Organization-tier settings (shown in Org mode). The org profile — name today,
 * brand kit next (Phase 2 inheritance). Its sub-accounts are managed in the
 * Sub-Accounts tab, so this stays focused on the org itself.
 */
export function OrganizationSettingsTab() {
  const { organizationId, organizationData, refreshOrganizations } = useAccount();
  const { markClean } = useUnsavedChanges();

  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [titleActionsEl, setTitleActionsEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTitleActionsEl(document.getElementById('settings-title-actions'));
  }, []);

  useEffect(() => {
    if (organizationData) {
      setName(organizationData.name);
      setSavedName(organizationData.name);
    }
  }, [organizationData]);

  if (!organizationId || !organizationData) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Select an organization to manage its settings.</p>
      </div>
    );
  }

  const dirty = name.trim().length > 0 && name.trim() !== savedName;

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSavedName(name.trim());
      markClean();
      await refreshOrganizations();
      toast.success('Organization saved!');
    } catch {
      toast.error('Failed to save organization');
    }
    setSaving(false);
  };

  const sectionCardClass = 'glass-section-card rounded-xl p-6';
  const sectionHeadingClass = 'text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';

  return (
    <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className={sectionCardClass}>
        <h3 className={sectionHeadingClass}>General</h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Organization Key</label>
            <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] font-mono">
              {organizationData.key}
            </div>
          </div>
          <div>
            <label className={labelClass}>Organization Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Manage this organization&apos;s sub-accounts in the Sub-Accounts tab. Brand kit &amp; org-owned
            templates are coming with inheritance.
          </p>
        </div>
      </section>

      {titleActionsEl && createPortal(
        <PrimaryButton onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving...' : 'Save Settings'}
        </PrimaryButton>,
        titleActionsEl,
      )}
    </div>
  );
}
