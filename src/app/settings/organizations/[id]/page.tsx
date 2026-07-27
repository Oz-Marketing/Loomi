'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { useAccount, type OrganizationData } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';

/** Stable key for comparing a rooftop selection set regardless of order. */
function keysSignature(keys: Iterable<string>): string {
  return Array.from(keys).sort().join('|');
}

const LIST_PATH = '/settings/organizations';

export default function OrganizationDetailPage() {
  const params = useParams();
  const id = (params?.id as string) || '';
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const { userRole, accounts, accountsLoaded, refreshOrganizations, refreshAccounts } = useAccount();
  const { markDirty, markClean } = useUnsavedChanges();
  const canManage = userRole === 'developer' || userRole === 'super_admin';

  const [org, setOrg] = useState<OrganizationData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Last-saved snapshot as reactive state (not refs) so the Save button's
  // dirty check and the unsaved-changes guard both react to it.
  const [savedName, setSavedName] = useState('');
  const [savedKeysSig, setSavedKeysSig] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/organizations/${id}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as OrganizationData;
        if (!active) return;
        setOrg(data);
        setName(data.name);
        setSelected(new Set(data.accountKeys));
        setSavedName(data.name);
        setSavedKeysSig(keysSignature(data.accountKeys));
      } catch {
        if (active) toast.error('Could not load organization');
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [id]);

  const allKeys = useMemo(
    () =>
      Object.keys(accounts).sort((a, b) =>
        (accounts[a].dealer || a).localeCompare(accounts[b].dealer || b),
      ),
    [accounts],
  );

  const filteredKeys = useMemo(() => {
    if (!search) return allKeys;
    const q = search.toLowerCase();
    return allKeys.filter(
      (k) => (accounts[k]?.dealer || k).toLowerCase().includes(q) || k.toLowerCase().includes(q),
    );
  }, [allKeys, accounts, search]);

  const dirty = useMemo(() => {
    if (name.trim() !== savedName) return true;
    return keysSignature(selected) !== savedKeysSig;
  }, [name, selected, savedName, savedKeysSig]);

  // Drive the app-wide unsaved-changes guard off our own computed dirty state
  // (same pattern as the Knowledge Base tab), so navigating away prompts only
  // when there are real pending edits and clears cleanly after a save.
  useEffect(() => {
    if (dirty) markDirty();
    else markClean();
  }, [dirty, markDirty, markClean]);

  // Clear the guard when leaving the page.
  useEffect(() => () => markClean(), [markClean]);

  const toggle = (key: string) => {
    if (!canManage) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!org || !dirty) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/organizations/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), accountKeys: Array.from(selected) }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSavedName(name.trim());
      setSavedKeysSig(keysSignature(selected));
      setOrg({ ...org, name: name.trim(), accountKeys: Array.from(selected) });
      markClean();
      await refreshOrganizations();
      await refreshAccounts();
      toast.success('Organization saved!');
    } catch {
      toast.error('Failed to save organization');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!org) return;
    const confirmed = await confirm({
      title: 'Delete Organization',
      message: `Delete "${org.name}"? Its ${org.accountKeys.length} sub-account${org.accountKeys.length === 1 ? '' : 's'} will be detached (not deleted).`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const r = await fetch(`/api/organizations/${org.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
      await refreshOrganizations();
      await refreshAccounts();
      toast.success('Organization deleted');
      router.push(LIST_PATH);
    } catch {
      toast.error('Failed to delete organization');
    }
  };

  if (loaded && !org) {
    return (
      <div className="animate-fade-in-up pt-4">
        <Link href={LIST_PATH} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeftIcon className="w-4 h-4" /> Back to Organizations
        </Link>
        <p className="text-center py-16 text-sm text-[var(--muted-foreground)]">Organization not found.</p>
      </div>
    );
  }

  const sectionCardClass = 'glass-section-card rounded-xl p-6';
  const sectionHeadingClass = 'text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';

  return (
    <div className="animate-fade-in-up pt-4">
      <Link
        href={LIST_PATH}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" /> Back to Organizations
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[var(--primary)]/15 flex items-center justify-center flex-shrink-0">
            <BuildingOffice2Icon className="w-6 h-6 text-[var(--primary)]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-[var(--foreground)]">
              {org?.name || 'Organization'}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {org?.key} · {selected.size} sub-account{selected.size === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <TrashIcon className="w-4 h-4" /> Delete
              </button>
              <PrimaryButton onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'Saving...' : 'Save Changes'}
              </PrimaryButton>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-[var(--border)] mb-6" />

      {!loaded ? (
        <p className="text-center py-16 text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : (
        <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className={sectionCardClass}>
            <h3 className={sectionHeadingClass}>General</h3>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Organization Key</label>
                <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] font-mono">
                  {org?.key}
                </div>
              </div>
              <div>
                <label className={labelClass}>Organization Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canManage}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className={sectionCardClass}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={sectionHeadingClass + ' mb-0'}>Sub-Accounts</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{selected.size} selected</span>
            </div>

            <div className="relative mb-3">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sub-accounts..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            {!accountsLoaded ? (
              <p className="text-sm text-[var(--muted-foreground)] py-6 text-center">Loading sub-accounts...</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-80 overflow-y-auto">
                {filteredKeys.map((key) => {
                  const acct = accounts[key];
                  const inThisOrg = selected.has(key);
                  const ownedElsewhere =
                    !inThisOrg && acct?.organizationId && acct.organizationId !== org?.id;
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${canManage ? 'hover:bg-[var(--muted)]' : 'cursor-default opacity-80'}`}
                    >
                      <input
                        type="checkbox"
                        checked={inThisOrg}
                        onChange={() => toggle(key)}
                        disabled={!canManage}
                        className="accent-[var(--primary)]"
                      />
                      <span className="text-xs text-[var(--foreground)] truncate">
                        {acct?.dealer || key}
                      </span>
                      {ownedElsewhere && (
                        <span className="text-[9px] text-amber-500 flex-shrink-0 ml-auto">in another org</span>
                      )}
                    </label>
                  );
                })}
                {filteredKeys.length === 0 && (
                  <p className="text-xs text-[var(--muted-foreground)] py-4 text-center col-span-full">
                    No sub-accounts match your search.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
