'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ListBulletIcon,
  PlusIcon,
  RectangleStackIcon,
  UserGroupIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import type { Contact } from '@/lib/contacts/types';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { isLikelyDialablePhone, normalizePhoneNumber } from '@/lib/contact-hygiene';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { FilterBuilder } from '@/components/contacts/filter-builder';
import { ContactsPicker } from '@/components/contacts/contacts-picker';

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
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual selection mode. */
  sourceContactIds: string;
}

interface SavedAudience {
  id: string;
  name: string;
  filters: string;
  accountKey?: string | null;
}

interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  accountKey: string;
  memberCount: number;
}

type AudienceTab = 'lists' | 'segments' | 'contacts';

type AudienceSelection =
  | { kind: 'all' }
  | { kind: 'list'; id: string; name: string }
  | { kind: 'segment'; id: string; name: string; filter: FilterDefinition }
  // Manual mode — caller curates an arbitrary set of Contact IDs from
  // the Contacts tab. Persisted as sourceContactIds on the draft.
  | { kind: 'contacts'; ids: string[] };

// SMS deliverability check shared between sendable count + ContactsPicker.
function isSmsDeliverable(c: Contact): boolean {
  return isLikelyDialablePhone(normalizePhoneNumber(String(c.phone || '')));
}

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

export default function SmsRecipientsStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { isAccount, accountKey, accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  // Source sub-account's custom fields — fed into evaluateFilter so
  // saved audiences referencing custom keys filter at count time.
  const { fields: filterableFields } = useFilterableFields(selectedAccountKey || null);
  const [tab, setTab] = useState<AudienceTab>('segments');
  const [selection, setSelection] = useState<AudienceSelection>({ kind: 'all' });

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listMemberIds, setListMemberIds] = useState<Set<string> | null>(null);
  const [listMemberLoading, setListMemberLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);

  // Contacts tab — paginated picker for ad-hoc manual selection. Same
  // shape as the email recipients page; SMS uses phone-deliverability.
  const [contactsSearch, setContactsSearch] = useState('');
  const [contactsPage, setContactsPage] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    fetch(`/api/campaigns/sms/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        const campaign = data.campaign;
        if (!campaign) {
          toast.error('Campaign not found');
          router.push('/messaging/campaigns');
          return;
        }
        setDraft(campaign);
        if (campaign.accountKeys.length > 0) {
          setSelectedAccountKey(campaign.accountKeys[0]);
        }
        // Hydrate whichever selection mode the draft was saved with.
        // Mutually exclusive — sourceContactIds wins, then sourceListId,
        // then sourceAudienceId+sourceFilter.
        if (campaign.sourceContactIds) {
          let ids: string[] = [];
          try {
            const parsed = JSON.parse(campaign.sourceContactIds);
            if (Array.isArray(parsed)) {
              ids = parsed.map((v) => String(v).trim()).filter(Boolean);
            }
          } catch {
            ids = [];
          }
          if (ids.length > 0) {
            setSelection({ kind: 'contacts', ids });
            setTab('contacts');
          }
        } else if (campaign.sourceListId) {
          setSelection({ kind: 'list', id: campaign.sourceListId, name: 'List' });
          setTab('lists');
        } else if (campaign.sourceAudienceId && campaign.sourceFilter) {
          const parsed = parseFilterDefinition(campaign.sourceFilter);
          if (parsed) {
            const preset = LIFECYCLE_PRESETS.find((p) => p.id === campaign.sourceAudienceId);
            setSelection({
              kind: 'segment',
              id: campaign.sourceAudienceId,
              name: preset?.name || 'Saved Segment',
              filter: parsed,
            });
            setTab('segments');
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

  // Reset Contacts-tab state when the selected subaccount *changes*
  // post-mount. The ref guard ensures initial hydration of a saved
  // contacts-mode draft isn't clobbered.
  const prevAccountKeyRef = useRef<string>('');
  useEffect(() => {
    const prev = prevAccountKeyRef.current;
    prevAccountKeyRef.current = selectedAccountKey;
    if (!prev || prev === selectedAccountKey) return;
    setContactsSearch('');
    setContactsPage(0);
    setSelection((current) => (current.kind === 'contacts' ? { kind: 'all' } : current));
  }, [selectedAccountKey]);

  useEffect(() => {
    if (!selectedAccountKey) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    fetch(`/api/contacts?accountKey=${encodeURIComponent(selectedAccountKey)}&all=true`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load contacts');
        return Array.isArray(data?.contacts) ? (data.contacts as Contact[]) : [];
      })
      .then((rows) => {
        if (!cancelled) setContacts(rows);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountKey]);

  const refreshAudiences = async () => {
    try {
      const res = await fetch('/api/audiences');
      const data = (res.ok ? await res.json() : { audiences: [] }) as { audiences?: SavedAudience[] };
      setSavedAudiences(Array.isArray(data.audiences) ? data.audiences : []);
    } catch {
      setSavedAudiences([]);
    }
  };

  useEffect(() => {
    refreshAudiences();
  }, []);

  const refreshLists = async () => {
    try {
      const res = await fetch('/api/contacts/lists');
      const data = (res.ok ? await res.json() : { lists: [] }) as { lists?: ListSummary[] };
      setLists(Array.isArray(data.lists) ? data.lists : []);
    } catch {
      setLists([]);
    }
  };

  useEffect(() => {
    refreshLists();
  }, []);

  const scopedAudiences = useMemo(() => {
    return savedAudiences.filter((a) => !a.accountKey || a.accountKey === selectedAccountKey);
  }, [savedAudiences, selectedAccountKey]);

  const scopedLists = useMemo(
    () => lists.filter((l) => l.accountKey === selectedAccountKey),
    [lists, selectedAccountKey],
  );

  useEffect(() => {
    if (selection.kind !== 'list') return;
    const match = scopedLists.find((l) => l.id === selection.id);
    if (match && match.name !== selection.name) {
      setSelection({ kind: 'list', id: match.id, name: match.name });
    }
  }, [scopedLists, selection]);

  useEffect(() => {
    if (selection.kind !== 'list') {
      setListMemberIds(null);
      return;
    }
    let cancelled = false;
    setListMemberLoading(true);
    fetch(`/api/contacts/lists/${encodeURIComponent(selection.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
        const memberIds: string[] = Array.isArray(data.members)
          ? data.members.map((m: { id: string }) => m.id).filter(Boolean)
          : [];
        if (!cancelled) setListMemberIds(new Set(memberIds));
      })
      .catch(() => {
        if (!cancelled) setListMemberIds(new Set());
      })
      .finally(() => {
        if (!cancelled) setListMemberLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  // Sendable = contacts with a dialable phone (text rail uses phone for
  // hygiene). Intersect with list members or selected IDs as needed.
  const sendableCount = useMemo(() => {
    if (contactsLoading) return 0;
    const sendable = contacts.filter(isSmsDeliverable);
    if (selection.kind === 'all') return sendable.length;
    if (selection.kind === 'list') {
      if (!listMemberIds) return 0;
      return sendable.filter((c) => listMemberIds.has(c.id)).length;
    }
    if (selection.kind === 'contacts') {
      const idSet = new Set(selection.ids);
      return sendable.filter((c) => idSet.has(c.id)).length;
    }
    return evaluateFilter(sendable, selection.filter, filterableFields).length;
  }, [contacts, contactsLoading, selection, listMemberIds, filterableFields]);

  async function persistSelection() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        accountKeys: [selectedAccountKey],
      };
      // Mutually exclusive selection modes — always clear unused fields
      // so stale state from a different mode doesn't linger.
      if (selection.kind === 'all') {
        payload.sourceAudienceId = null;
        payload.sourceFilter = null;
        payload.sourceListId = null;
        payload.sourceContactIds = null;
      } else if (selection.kind === 'list') {
        payload.sourceListId = selection.id;
        payload.sourceAudienceId = null;
        payload.sourceFilter = null;
        payload.sourceContactIds = null;
      } else if (selection.kind === 'contacts') {
        payload.sourceContactIds = JSON.stringify(selection.ids);
        payload.sourceListId = null;
        payload.sourceAudienceId = null;
        payload.sourceFilter = null;
      } else {
        payload.sourceAudienceId = selection.id;
        payload.sourceFilter = JSON.stringify(selection.filter);
        payload.sourceListId = null;
        payload.sourceContactIds = null;
      }
      const res = await fetch(`/api/campaigns/sms/${encodeURIComponent(draft.id)}`, {
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
    if (!draft || !selectedAccountKey) return;
    try {
      await persistSelection();
      router.push(`/messaging/campaigns/sms/${encodeURIComponent(draft.id)}/message`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save selection');
    }
  }

  async function handleBack() {
    if (draft) {
      try {
        await persistSelection();
      } catch {
        // non-fatal
      }
    }
    router.push('/messaging/campaigns');
  }

  // NOTE: this hook MUST stay above the `draftLoading` early return below —
  // a hook declared after a conditional return changes the hook count between
  // renders and throws "Rendered more hooks than during the previous render."
  const tabButton = useCallback(
    (key: AudienceTab, label: string, icon: React.ComponentType<{ className?: string }>) => {
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
    },
    [tab],
  );

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

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
              Recipients
            </p>
            <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
              SMS targets contacts with a dialable phone number.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-4xl sm:text-5xl font-bold tabular-nums leading-none">
              {contactsLoading || listMemberLoading ? (
                <ArrowPathIcon className="w-7 h-7 inline animate-spin text-[var(--muted-foreground)]" />
              ) : (
                sendableCount.toLocaleString()
              )}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1.5">
              Sendable recipients
            </p>
          </div>
        </div>

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
              Send to every contact with a valid phone number in this subaccount.
            </p>
          </div>
          {selection.kind === 'all' && (
            <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
          )}
        </button>

        <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="border-b border-[var(--border)] flex items-center gap-1 px-5">
            {tabButton('lists', 'Lists', ListBulletIcon)}
            {tabButton('segments', 'Segments', RectangleStackIcon)}
            {tabButton('contacts', 'Contacts', UserGroupIcon)}
          </div>
          <div className="p-5">
            {tab === 'lists' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                    {scopedLists.length} {scopedLists.length === 1 ? 'list' : 'lists'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowNewListModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--border)] hover:border-[var(--primary)]/40 text-[var(--foreground)]"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    New list
                  </button>
                </div>

                {scopedLists.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-[var(--border)] rounded-xl">
                    <ListBulletIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No lists for this account yet</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
                      Click <span className="font-medium">New list</span> above to create one, then populate it on the Lists page.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {scopedLists.map((list) => {
                      const active = selection.kind === 'list' && selection.id === list.id;
                      const memberLabel = `${list.memberCount.toLocaleString()} ${list.memberCount === 1 ? 'contact' : 'contacts'}`;
                      return (
                        <AudienceCard
                          key={list.id}
                          title={list.name}
                          subtitle={list.description ? `${memberLabel} · ${list.description}` : memberLabel}
                          icon={ListBulletIcon}
                          active={active}
                          onClick={() =>
                            setSelection({ kind: 'list', id: list.id, name: list.name })
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {tab === 'segments' && (
              <div className="space-y-5">
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowFilterBuilder(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--border)] hover:border-[var(--primary)]/40 text-[var(--foreground)]"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    New segment
                  </button>
                </div>

                {scopedAudiences.length > 0 ? (
                  <div>
                    <div className="space-y-2">
                      {scopedAudiences.map((a) => {
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
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="py-10 text-center border border-dashed border-[var(--border)] rounded-xl">
                    <RectangleStackIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No segments for this account yet</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
                      Click <span className="font-medium">New segment</span> above to build a custom filter (e.g., contacts created in the last 30 days).
                    </p>
                  </div>
                )}
              </div>
            )}

            {tab === 'contacts' && (
              <ContactsPicker
                contacts={contacts}
                loading={contactsLoading}
                search={contactsSearch}
                onSearchChange={(value) => {
                  setContactsSearch(value);
                  setContactsPage(0);
                }}
                page={contactsPage}
                onPageChange={setContactsPage}
                selectedIds={selection.kind === 'contacts' ? selection.ids : []}
                onSelectionChange={(ids) => {
                  if (ids.length === 0) {
                    setSelection({ kind: 'all' });
                  } else {
                    setSelection({ kind: 'contacts', ids });
                  }
                }}
                isDeliverable={isSmsDeliverable}
                emptyNoun="phone-deliverable contacts"
              />
            )}
          </div>
        </div>
      </div>

      {showNewListModal && (
        <NewListInlineModal
          accountKey={selectedAccountKey}
          onCreated={(list) => {
            setLists((prev) => [
              { id: list.id, name: list.name, description: list.description, accountKey: list.accountKey, memberCount: 0 },
              ...prev,
            ]);
            setSelection({ kind: 'list', id: list.id, name: list.name });
            setShowNewListModal(false);
            void refreshLists();
            toast.success(`List "${list.name}" created. Populate it on the Lists page.`);
          }}
          onClose={() => setShowNewListModal(false)}
        />
      )}

      {showFilterBuilder && (
        <FilterBuilder
          fields={filterableFields}
          onApply={(definition) => {
            setSelection({
              kind: 'segment',
              id: `ad-hoc-${Date.now()}`,
              name: 'Custom segment',
              filter: definition,
            });
            setShowFilterBuilder(false);
          }}
          onSave={async (name, definition) => {
            try {
              const res = await fetch('/api/audiences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name,
                  filters: JSON.stringify(definition),
                  accountKey: selectedAccountKey,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save segment');
              }
              setSelection({
                kind: 'segment',
                id: data.audience.id,
                name: data.audience.name,
                filter: definition,
              });
              setShowFilterBuilder(false);
              await refreshAudiences();
              toast.success(`Segment "${name}" saved.`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Failed to save segment');
            }
          }}
          onClose={() => setShowFilterBuilder(false)}
        />
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton
            onClick={handleContinue}
            disabled={!selectedAccountKey || saving || contactsLoading}
          >
            {saving ? 'Saving…' : 'Continue'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function NewListInlineModal({
  accountKey,
  onCreated,
  onClose,
}: {
  accountKey: string;
  onCreated: (list: { id: string; name: string; description: string | null; accountKey: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), accountKey, description: description.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create list');
      }
      onCreated(data.list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">New list</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Create an empty list and populate it from the Lists page (or by bulk-adding from Contacts).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q4 Service Customers"
              autoFocus
              maxLength={120}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
              Description <span className="text-[var(--muted-foreground)] font-normal lowercase">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create list'}
          </button>
        </div>
      </form>
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
      {active && <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />}
    </button>
  );
}
