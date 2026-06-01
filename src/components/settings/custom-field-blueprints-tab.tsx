'use client';

// Admin: contact custom field blueprints.
//
// Blueprints live outside any sub-account (accountKey=null). Each one
// can be deployed to N sub-accounts, optionally tagged with an
// industry so a one-click "Apply Automotive to every Automotive
// sub-account" bulk action works. Deployed instances track lineage
// back to the blueprint and surface "Update available" when the
// blueprint changes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  PaperAirplaneIcon,
  BoltIcon,
  CheckIcon,
  XMarkIcon,
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

interface BlueprintRow extends CustomFieldDto {
  adoption: { total: number; stale: number };
}

interface AccountSummary {
  key: string;
  dealer: string;
  category: string | null;
}

const TYPE_PILL: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes/No',
  select: 'Select',
  multiselect: 'Multi-select',
};

export function CustomFieldBlueprintsTab() {
  const { confirm } = useLoomiDialog();
  const { userRole } = useAccount();
  // Portfolio-wide industry sweep is gated to elevated roles to mirror
  // the API; plain admins use per-blueprint deploy instead.
  const canApplyIndustryRole =
    userRole === 'developer' || userRole === 'super_admin';
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDto | null>(null);
  const [deployOpen, setDeployOpen] = useState<BlueprintRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bpRes, acctRes] = await Promise.all([
        fetch('/api/contact-custom-fields?blueprints=true'),
        fetch('/api/accounts'),
      ]);
      const bpData = (await bpRes.json().catch(() => ({}))) as {
        blueprints?: BlueprintRow[];
      };
      const acctData = (await acctRes.json().catch(() => ({}))) as Record<
        string,
        { dealer?: string; category?: string | null }
      >;
      setBlueprints(Array.isArray(bpData.blueprints) ? bpData.blueprints : []);
      // /api/accounts returns Record<key, AccountData>. Flatten for picker.
      const flat: AccountSummary[] = Object.entries(acctData)
        .filter(([k]) => !k.startsWith('_'))
        .map(([key, val]) => ({
          key,
          dealer: val?.dealer ?? key,
          category: val?.category ?? null,
        }))
        .sort((a, b) => a.dealer.localeCompare(b.dealer));
      setAccounts(flat);
    } catch {
      toast.error('Failed to load blueprints');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Group blueprints by industryTag for display. Null tag → "Other".
  const grouped = useMemo(() => {
    const map = new Map<string, BlueprintRow[]>();
    for (const b of blueprints) {
      const tag = b.industryTag ?? 'Other';
      const arr = map.get(tag) ?? [];
      arr.push(b);
      map.set(tag, arr);
    }
    // Stable order: industries A→Z, "Other" last.
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [blueprints]);

  async function handleDelete(bp: BlueprintRow) {
    const adoptionText =
      bp.adoption.total > 0
        ? ` ${bp.adoption.total} sub-account(s) currently use this blueprint — their instances will become standalone fields (existing values preserved).`
        : '';
    const ok = await confirm({
      title: `Delete blueprint "${bp.label}"?`,
      message: `Deleting a blueprint doesn't remove deployed instances on sub-accounts; it just breaks the lineage.${adoptionText}`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(
      `/api/contact-custom-fields/${encodeURIComponent(bp.id)}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      toast.success('Blueprint deleted');
      await load();
    } else {
      toast.error('Failed to delete blueprint');
    }
  }

  async function handleApplyIndustry(industryTag: string) {
    const ok = await confirm({
      title: `Apply all ${industryTag} blueprints?`,
      message: `Deploy every ${industryTag}-tagged blueprint to every sub-account whose Industry is "${industryTag}". Already-deployed pairs are skipped.`,
      confirmLabel: 'Apply',
    });
    if (!ok) return;
    const res = await fetch(`/api/contact-custom-fields/apply-industry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industryTag }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      deployed?: number;
      skipped?: number;
      blueprintCount?: number;
      accountCount?: number;
      errors?: unknown[];
    };
    if (res.ok) {
      toast.success(
        `Deployed ${data.deployed ?? 0} field(s) across ${data.accountCount ?? 0} sub-account(s). Skipped ${data.skipped ?? 0} already-deployed.`,
      );
      await load();
    } else {
      toast.error('Failed to apply industry blueprints');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-[var(--muted-foreground)] max-w-2xl">
          Blueprints are reusable custom field definitions managed at the admin level. Tag them with an industry (e.g. <span className="font-mono">Automotive</span>) and use <span className="text-[var(--foreground)] font-medium">Apply industry</span> to push every blueprint to every matching sub-account in one click. Updates to a blueprint surface as a sync prompt on every deployed instance.
        </p>
        <PrimaryButton
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <PlusIcon className="w-4 h-4" />
          New blueprint
        </PrimaryButton>
      </div>

      {loading ? (
        <div className="glass-section-card rounded-xl p-8 text-center text-sm text-[var(--muted-foreground)]">
          Loading…
        </div>
      ) : blueprints.length === 0 ? (
        <div className="glass-section-card rounded-xl p-12 text-center">
          <p className="text-sm text-[var(--foreground)] mb-1">
            No blueprints yet
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Create your first blueprint to make a custom field available across sub-accounts.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([tag, rows]) => {
            const matchingAccountCount = accounts.filter(
              (a) => a.category === tag,
            ).length;
            const canApplyIndustry =
              canApplyIndustryRole && tag !== 'Other' && matchingAccountCount > 0;

            return (
              <section key={tag} className="glass-section-card rounded-xl overflow-hidden">
                <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">
                      {tag}
                    </h3>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {rows.length} blueprint{rows.length === 1 ? '' : 's'}
                      {tag !== 'Other' && (
                        <>
                          {' · '}
                          {matchingAccountCount} matching sub-account
                          {matchingAccountCount === 1 ? '' : 's'}
                        </>
                      )}
                    </p>
                  </div>
                  {canApplyIndustry && (
                    <button
                      onClick={() => handleApplyIndustry(tag)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)]"
                      title="Deploy every blueprint in this industry to every matching sub-account"
                    >
                      <BoltIcon className="w-3.5 h-3.5" />
                      Apply industry
                    </button>
                  )}
                </header>

                <table className="w-full text-sm">
                  <thead className="bg-[var(--muted)]/20 border-b border-[var(--border)]">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      <th className="px-4 py-2.5">Field</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Adoption</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((bp) => (
                      <tr
                        key={bp.id}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
                            {bp.label}
                            {bp.isPii && (
                              <LockClosedIcon
                                className="w-3 h-3 text-[var(--muted-foreground)]"
                                title="PII"
                              />
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--muted-foreground)]">
                            {bp.key}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">
                          {TYPE_PILL[bp.type]}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[var(--foreground)]">
                            {bp.adoption.total}
                          </span>
                          <span className="text-[var(--muted-foreground)]">
                            {' '}
                            sub-account{bp.adoption.total === 1 ? '' : 's'}
                          </span>
                          {bp.adoption.stale > 0 && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-500">
                              {bp.adoption.stale} stale
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDeployOpen(bp)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)]"
                              title="Deploy to sub-accounts"
                            >
                              <PaperAirplaneIcon className="w-3 h-3" />
                              Deploy
                            </button>
                            <button
                              onClick={() => {
                                setEditing(bp);
                                setModalOpen(true);
                              }}
                              className="p-1.5 rounded-md hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              title="Edit"
                            >
                              <PencilIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(bp)}
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
              </section>
            );
          })}
        </div>
      )}

      <CustomFieldEditorModal
        open={modalOpen}
        mode="blueprint"
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          load();
        }}
      />

      <DeployModal
        blueprint={deployOpen}
        accounts={accounts}
        onClose={() => setDeployOpen(null)}
        onDeployed={() => {
          setDeployOpen(null);
          load();
        }}
      />
    </div>
  );
}

// ── Deploy modal ────────────────────────────────────────────────

function DeployModal({
  blueprint,
  accounts,
  onClose,
  onDeployed,
}: {
  blueprint: BlueprintRow | null;
  accounts: AccountSummary[];
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    if (blueprint) {
      // Pre-select sub-accounts whose category matches the blueprint's
      // industry tag, to give the user the most common intent on open.
      if (blueprint.industryTag) {
        const matching = accounts
          .filter((a) => a.category === blueprint.industryTag)
          .map((a) => a.key);
        setSelected(new Set(matching));
      } else {
        setSelected(new Set());
      }
      setFilter('');
    }
  }, [blueprint, accounts]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return accounts;
    const q = filter.toLowerCase();
    return accounts.filter(
      (a) =>
        a.dealer.toLowerCase().includes(q) ||
        a.key.toLowerCase().includes(q) ||
        (a.category ?? '').toLowerCase().includes(q),
    );
  }, [accounts, filter]);

  async function handleDeploy() {
    if (!blueprint || selected.size === 0) return;
    setDeploying(true);
    try {
      const res = await fetch(
        `/api/contact-custom-fields/${encodeURIComponent(blueprint.id)}/deploy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountKeys: Array.from(selected) }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        deployed?: number;
        skipped?: number;
        errors?: { accountKey: string; reason: string }[];
      };
      if (res.ok) {
        toast.success(
          `Deployed to ${data.deployed ?? 0} sub-account(s)${
            data.skipped ? ` (${data.skipped} already had it)` : ''
          }`,
        );
        onDeployed();
      } else {
        toast.error('Deploy failed');
      }
    } finally {
      setDeploying(false);
    }
  }

  if (!blueprint) return null;
  // Portal to document.body for the same reason as
  // CustomFieldEditorModal: LayoutShell's <main> is a scroll container,
  // and Chrome will contain `fixed inset-0` to that ancestor unless
  // we hoist the modal out to document root.
  if (typeof document === 'undefined') return null;

  return createPortal(
    // Same z-index + backdrop tuning as the field editor modal — they
    // share a stacking layer and visual weight so the experience is
    // consistent when admins jump between them.
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] flex flex-col frost-heavy rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Deploy "{blueprint.label}"
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Pick sub-accounts to deploy this blueprint to. Already-deployed sub-accounts are skipped.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[var(--border)]">
          <input
            type="text"
            placeholder="Filter sub-accounts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
          />
          <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--muted-foreground)]">
            <span>
              {selected.size} of {filtered.length} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelected(new Set(filtered.map((a) => a.key)))
                }
                className="text-[var(--primary)] hover:underline"
              >
                Select all visible
              </button>
              <span>·</span>
              <button
                onClick={() => setSelected(new Set())}
                className="hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-[var(--muted-foreground)] py-8">
              No sub-accounts match.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filtered.map((a) => {
                const isSelected = selected.has(a.key);
                return (
                  <li key={a.key}>
                    <button
                      onClick={() => {
                        setSelected((curr) => {
                          const next = new Set(curr);
                          if (next.has(a.key)) next.delete(a.key);
                          else next.add(a.key);
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between py-2.5 hover:bg-[var(--accent)]/40 rounded-md px-2 text-left"
                    >
                      <div>
                        <div className="text-sm text-[var(--foreground)]">
                          {a.dealer}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-1">
                          <span className="font-mono">{a.key}</span>
                          {a.category && (
                            <>
                              <span>·</span>
                              <span>{a.category}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                          isSelected
                            ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        {isSelected && <CheckIcon className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 h-10 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
          <PrimaryButton
            onClick={handleDeploy}
            disabled={selected.size === 0 || deploying}
          >
            {deploying
              ? 'Deploying…'
              : `Deploy to ${selected.size} sub-account${selected.size === 1 ? '' : 's'}`}
          </PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
