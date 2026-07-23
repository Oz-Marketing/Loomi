'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useAccount, type OrganizationData } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';

const DETAIL_BASE_PATH = '/settings/organizations';

type SortDirection = 'asc' | 'desc';
type OrgSortField = 'name' | 'key' | 'rooftops';

/** Convert a display name to camelCase key, e.g. "Young Automotive Group" → "youngAutomotiveGroup" */
function toCamelCaseKey(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

export function OrganizationsTab() {
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const { userRole, accounts, refreshOrganizations } = useAccount();
  const canManage = userRole === 'developer' || userRole === 'super_admin';

  const [orgs, setOrgs] = useState<OrganizationData[] | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<OrgSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Create organization state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [creating, setCreating] = useState(false);

  const loadOrgs = async () => {
    try {
      const r = await fetch('/api/organizations');
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as Record<string, OrganizationData>;
      setOrgs(Object.values(data));
    } catch {
      toast.error('Could not load organizations');
      setOrgs([]);
    }
  };

  useEffect(() => {
    loadOrgs();
  }, []);

  const resetCreate = () => {
    setCreateOpen(false);
    setNewName('');
    setNewKey('');
    setCreating(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const key = newKey.trim();
    if (!name || !key || creating) return;
    setCreating(true);
    try {
      const r = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data?.error || 'Failed to create');
        setCreating(false);
        return;
      }
      toast.success('Organization created!');
      resetCreate();
      await refreshOrganizations();
      // Jump straight to the detail page to assign rooftops.
      router.push(`${DETAIL_BASE_PATH}/${data.id}`);
    } catch {
      toast.error('Failed to create organization');
      setCreating(false);
    }
  };

  const handleDelete = async (org: OrganizationData) => {
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
      setOrgs((prev) => (prev ? prev.filter((o) => o.id !== org.id) : prev));
      await refreshOrganizations();
      toast.success('Organization deleted');
    } catch {
      toast.error('Failed to delete organization');
    }
  };

  const filtered = useMemo(() => {
    const list = orgs || [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (o) => o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q),
    );
  }, [orgs, search]);

  const sorted = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      else if (sortField === 'key') cmp = a.key.toLowerCase().localeCompare(b.key.toLowerCase());
      else if (sortField === 'rooftops') cmp = a.accountKeys.length - b.accountKeys.length;
      if (cmp === 0) cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return cmp * direction;
    });
  }, [filtered, sortField, sortDirection]);

  const toggleSort = (field: OrgSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (field: OrgSortField) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  if (!orgs) return <div className="text-[var(--muted-foreground)]">Loading...</div>;

  const titleActionsEl =
    typeof document !== 'undefined' ? document.getElementById('settings-title-actions') : null;

  return (
    <div>
      {/* Portal action button into the settings title bar */}
      {canManage && titleActionsEl && createPortal(
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <PlusIcon className="w-4 h-4" /> New Organization
        </button>,
        titleActionsEl,
      )}

      <div className="mb-4">
        <div className="relative w-52">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* ─── Create Organization Modal ─── */}
      {createOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-overlay-in">
          <div className="glass-modal w-full max-w-lg mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <h3 className="text-lg font-semibold flex-1">Create Organization</h3>
                <button
                  onClick={resetCreate}
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Organization Name *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setNewKey(toCamelCaseKey(e.target.value));
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                    className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. Metro Dealer Group"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Key</label>
                  <input
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--muted-foreground)]"
                    placeholder="auto-generated"
                  />
                </div>
              </div>

              <p className="text-[11px] text-[var(--muted-foreground)] mt-4">
                You&apos;ll be taken to the organization page to assign its sub-accounts.
              </p>

              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newKey.trim() || creating}
                  className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Organizations Table ─── */}
      {sorted.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <p className="text-sm">{search ? 'No organizations match your search.' : 'No organizations yet.'}</p>
          <p className="text-xs mt-1">
            {search ? 'Try a different search term.' : 'Click "New Organization" to get started.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto glass-table">
          <table className="w-full min-w-[600px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                <th className="w-12 px-3 py-2"></th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Organization
                    <span className="text-[10px]">{sortIndicator('name')}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('key')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Key
                    <span className="text-[10px]">{sortIndicator('key')}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                  <button type="button" onClick={() => toggleSort('rooftops')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                    Sub-Accounts
                    <span className="text-[10px]">{sortIndicator('rooftops')}</span>
                  </button>
                </th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((org) => {
                const rooftopNames = org.accountKeys
                  .map((k) => accounts[k]?.dealer || k)
                  .slice(0, 3)
                  .join(', ');
                return (
                  <tr
                    key={org.id}
                    onClick={() => router.push(`${DETAIL_BASE_PATH}/${org.id}`)}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)] cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <div className="w-8 h-8 rounded-md bg-[var(--primary)]/15 flex items-center justify-center">
                        <BuildingOffice2Icon className="w-4 h-4 text-[var(--primary)]" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm font-medium text-[var(--foreground)]">{org.name}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <code className="text-xs text-[var(--muted-foreground)]">{org.key}</code>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm text-[var(--foreground)]">
                        {org.accountKeys.length}
                        {rooftopNames && (
                          <span className="text-[var(--muted-foreground)] text-xs"> · {rooftopNames}{org.accountKeys.length > 3 ? '…' : ''}</span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(org); }}
                          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          aria-label={`Delete ${org.name}`}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
