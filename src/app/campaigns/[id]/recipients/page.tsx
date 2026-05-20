'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ListBulletIcon,
  RectangleStackIcon,
  SparklesIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { Contact } from '@/components/contacts/contacts-table';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
}

interface SavedAudience {
  id: string;
  name: string;
  filters: string;
  accountKey?: string | null;
}

type AudienceTab = 'lists' | 'segments' | 'smart-lists';

type AudienceSelection =
  | { kind: 'all' }
  | { kind: 'segment'; id: string; name: string; filter: FilterDefinition }
  | { kind: 'smart-list'; id: string; name: string; filter: FilterDefinition };

function parseFilterDefinition(raw: string): FilterDefinition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FilterDefinition;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

export default function RecipientsStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { isAccount, accountKey, accounts } = useAccount();
  const subHref = useSubaccountHref();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [tab, setTab] = useState<AudienceTab>('smart-lists');
  const [selection, setSelection] = useState<AudienceSelection>({ kind: 'all' });

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Hydrate draft on mount.
  // NOTE: router / subHref are intentionally NOT in the dep array.
  // useSubaccountHref() returns a fresh function reference on every render,
  // which would cause this effect to refire after each setState — an
  // infinite fetch loop. We only want this effect to run when the campaign
  // id changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    fetch(`/api/campaigns/email/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        const campaign = data.campaign;
        if (!campaign) {
          toast.error('Campaign not found');
          router.push(subHref('/campaigns'));
          return;
        }
        setDraft(campaign);
        if (campaign.accountKeys.length > 0) {
          setSelectedAccountKey(campaign.accountKeys[0]);
        }
        if (campaign.sourceAudienceId && campaign.sourceFilter) {
          const parsed = parseFilterDefinition(campaign.sourceFilter);
          if (parsed) {
            const preset = LIFECYCLE_PRESETS.find((p) => p.id === campaign.sourceAudienceId);
            if (preset) {
              setSelection({ kind: 'smart-list', id: preset.id, name: preset.name, filter: parsed });
              setTab('smart-lists');
            } else {
              setSelection({
                kind: 'segment',
                id: campaign.sourceAudienceId,
                name: 'Saved Segment',
                filter: parsed,
              });
              setTab('segments');
            }
          }
        }
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Account options to pick from
  const accountOptions = useMemo(() => {
    const keys = isAccount && accountKey ? [accountKey] : Object.keys(accounts);
    return [...new Set(keys.filter(Boolean))]
      .map((k) => ({ key: k, dealer: accounts[k]?.dealer || k }))
      .sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [isAccount, accountKey, accounts]);

  useEffect(() => {
    if (!selectedAccountKey && accountOptions.length > 0) {
      setSelectedAccountKey(accountOptions[0].key);
    }
  }, [accountOptions, selectedAccountKey]);

  // Load contacts for the selected account so we can preview audience sizes
  useEffect(() => {
    if (!selectedAccountKey) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    setContactsError(null);
    fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(selectedAccountKey)}&all=true`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load contacts');
        return Array.isArray(data?.contacts) ? (data.contacts as Contact[]) : [];
      })
      .then((rows) => {
        if (!cancelled) setContacts(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setContacts([]);
          setContactsError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountKey]);

  // Load saved Audience (Segment) rows for the selected account
  useEffect(() => {
    let cancelled = false;
    fetch('/api/audiences')
      .then((res) => (res.ok ? res.json() : { audiences: [] }))
      .then((data: { audiences?: SavedAudience[] }) => {
        if (cancelled) return;
        setSavedAudiences(Array.isArray(data.audiences) ? data.audiences : []);
      })
      .catch(() => {
        if (!cancelled) setSavedAudiences([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scope segments to the selected account (or unscoped global ones)
  const scopedAudiences = useMemo(() => {
    return savedAudiences.filter(
      (a) => !a.accountKey || a.accountKey === selectedAccountKey,
    );
  }, [savedAudiences, selectedAccountKey]);

  const sendableCount = useMemo(() => {
    if (contactsLoading) return 0;
    const sendable = contacts.filter((c) =>
      Boolean(c.id && isValidEmail(String(c.email || '').trim())),
    );
    if (selection.kind === 'all') return sendable.length;
    return evaluateFilter(sendable, selection.filter).length;
  }, [contacts, contactsLoading, selection]);

  async function persistSelection() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        accountKeys: [selectedAccountKey],
      };
      if (selection.kind === 'all') {
        payload.sourceAudienceId = null;
        payload.sourceFilter = null;
      } else {
        payload.sourceAudienceId = selection.id;
        payload.sourceFilter = JSON.stringify(selection.filter);
      }
      const res = await fetch(`/api/campaigns/email/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save selection');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!draft || !selectedAccountKey || sendableCount === 0) return;
    try {
      await persistSelection();
      router.push(`${subHref('/campaigns')}/${encodeURIComponent(draft.id)}/template`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save selection');
    }
  }

  async function handleBack() {
    if (draft) {
      try {
        await persistSelection();
      } catch {
        // non-fatal — drafts are user-editable; user can return
      }
    }
    router.push(subHref('/campaigns'));
  }

  if (draftLoading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading campaign draft…
        </p>
      </div>
    );
  }

  const tabButton = (key: AudienceTab, label: string, icon: React.ComponentType<{ className?: string }>) => {
    const Icon = icon;
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
          active
            ? 'border-[var(--primary)] text-[var(--foreground)]'
            : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </button>
    );
  };

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Step 1 of 4 — Recipients
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Choose who should receive this campaign.
          </p>
        </div>

        {/* Subaccount picker */}
        {accountOptions.length > 1 && !isAccount && (
          <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] mb-5">
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
              Sending Subaccount
            </label>
            <select
              value={selectedAccountKey}
              onChange={(e) => setSelectedAccountKey(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              {accountOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.dealer}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* "All Contacts" option */}
        <button
          type="button"
          onClick={() => setSelection({ kind: 'all' })}
          className={`w-full text-left rounded-2xl border-2 p-5 mb-5 flex items-start gap-4 transition-all ${
            selection.kind === 'all'
              ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
              : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
          }`}
        >
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              selection.kind === 'all'
                ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
            }`}
          >
            <UsersIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">All Contacts</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Send to every deliverable contact in this subaccount.
            </p>
          </div>
          {selection.kind === 'all' && (
            <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
          )}
        </button>

        {/* Tabs */}
        <div className="border-b border-[var(--border)] mb-5 flex items-center gap-1">
          {tabButton('lists', 'Lists', ListBulletIcon)}
          {tabButton('segments', 'Segments', RectangleStackIcon)}
          {tabButton('smart-lists', 'Smart Lists', SparklesIcon)}
        </div>

        {/* Tab content */}
        {tab === 'lists' && (
          <div className="glass-section-card rounded-2xl p-10 border border-dashed border-[var(--border)] text-center">
            <ListBulletIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">Lists are coming with the local contact store</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
              Static, manually-curated contact groups need Loomi to own contact storage
              (not GHL). That work&apos;s next on the roadmap.
            </p>
          </div>
        )}

        {tab === 'segments' && (
          <div className="space-y-2">
            {scopedAudiences.length === 0 ? (
              <div className="glass-section-card rounded-2xl p-10 border border-dashed border-[var(--border)] text-center">
                <RectangleStackIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">No saved segments yet</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
                  Build a dynamic audience filter and save it as a Segment to reuse across
                  campaigns. (Segment builder UI coming with the contact store.)
                </p>
              </div>
            ) : (
              scopedAudiences.map((a) => {
                const filter = parseFilterDefinition(a.filters);
                if (!filter) return null;
                const active = selection.kind === 'segment' && selection.id === a.id;
                return (
                  <AudienceCard
                    key={a.id}
                    title={a.name}
                    subtitle="Custom segment"
                    icon={RectangleStackIcon}
                    active={active}
                    onClick={() =>
                      setSelection({ kind: 'segment', id: a.id, name: a.name, filter })
                    }
                  />
                );
              })
            )}
          </div>
        )}

        {tab === 'smart-lists' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LIFECYCLE_PRESETS.map((preset) => {
              const active = selection.kind === 'smart-list' && selection.id === preset.id;
              return (
                <AudienceCard
                  key={preset.id}
                  title={preset.name}
                  subtitle={preset.description}
                  icon={SparklesIcon}
                  active={active}
                  onClick={() =>
                    setSelection({
                      kind: 'smart-list',
                      id: preset.id,
                      name: preset.name,
                      filter: preset.definition,
                    })
                  }
                />
              );
            })}
          </div>
        )}

        {contactsError && (
          <p className="mt-4 text-xs text-red-300">{contactsError}</p>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--background)]/95 backdrop-blur border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Sendable recipients
              </p>
              <p className="text-base font-semibold tabular-nums">
                {contactsLoading ? (
                  <ArrowPathIcon className="w-4 h-4 inline animate-spin" />
                ) : (
                  sendableCount.toLocaleString()
                )}
              </p>
            </div>
            <PrimaryButton
              onClick={handleContinue}
              disabled={!selectedAccountKey || sendableCount === 0 || saving || contactsLoading}
            >
              {saving ? 'Saving…' : 'Continue'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudienceCard({
  title,
  subtitle,
  icon: Icon,
  active,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 flex items-start gap-3 transition-all ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>
      </div>
      {active && (
        <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
      )}
    </button>
  );
}
