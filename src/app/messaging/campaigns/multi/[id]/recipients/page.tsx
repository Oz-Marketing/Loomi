'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ListBulletIcon,
  PhoneIcon,
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

interface CampaignDraftCore {
  id: string;
  name: string;
  accountKeys: string[];
  sourceAudienceId: string;
  sourceFilter: string;
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual selection mode. */
  sourceContactIds: string;
  metadata: string;
}

type EmailDraft = CampaignDraftCore;
type SmsDraft = CampaignDraftCore;

// Channel deliverability checks reused by the picker (selection gating)
// and the sendable count (header math). Email = valid address;
// SMS = dialable phone.
function isEmailDeliverable(c: Contact): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(c.email || '').trim());
}

function isSmsDeliverable(c: Contact): boolean {
  return isLikelyDialablePhone(normalizePhoneNumber(String(c.phone || '')));
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
type Rail = 'email' | 'sms';

type AudienceSelection =
  | { kind: 'all' }
  | { kind: 'list'; id: string; name: string }
  | { kind: 'segment'; id: string; name: string; filter: FilterDefinition }
  // Manual mode — caller curates an arbitrary set of Contact IDs from
  // the Contacts tab. Persisted as sourceContactIds on the draft.
  | { kind: 'contacts'; ids: string[] };

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

function parseLinkedSmsId(rawMetadata: string): string | null {
  if (!rawMetadata) return null;
  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;
    const value = parsed?.linkedSmsCampaignId;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function audienceFromCampaign(c: {
  sourceListId?: string;
  sourceAudienceId?: string;
  sourceFilter?: string;
  sourceContactIds?: string;
}): AudienceSelection {
  // Mutually exclusive — contacts wins, then list, then segment.
  if (c.sourceContactIds) {
    try {
      const parsed = JSON.parse(c.sourceContactIds);
      if (Array.isArray(parsed)) {
        const ids = parsed.map((v) => String(v).trim()).filter(Boolean);
        if (ids.length > 0) return { kind: 'contacts', ids };
      }
    } catch {
      // fall through
    }
  }
  if (c.sourceListId) {
    return { kind: 'list', id: c.sourceListId, name: 'List' };
  }
  if (c.sourceAudienceId && c.sourceFilter) {
    const parsed = parseFilterDefinition(c.sourceFilter);
    if (parsed) {
      const preset = LIFECYCLE_PRESETS.find((p) => p.id === c.sourceAudienceId);
      return {
        kind: 'segment',
        id: c.sourceAudienceId,
        name: preset?.name || 'Saved Segment',
        filter: parsed,
      };
    }
  }
  return { kind: 'all' };
}

function selectionsEqual(a: AudienceSelection, b: AudienceSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'list' && b.kind === 'list') return a.id === b.id;
  if (a.kind === 'segment' && b.kind === 'segment') return a.id === b.id;
  if (a.kind === 'contacts' && b.kind === 'contacts') {
    if (a.ids.length !== b.ids.length) return false;
    const aSet = new Set(a.ids);
    return b.ids.every((id) => aSet.has(id));
  }
  return false;
}

function preferredTab(sel: AudienceSelection): AudienceTab {
  if (sel.kind === 'list') return 'lists';
  if (sel.kind === 'contacts') return 'contacts';
  return 'segments';
}

export default function MultiRecipientsStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { isAccount, accountKey, accounts } = useAccount();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [linkedSmsId, setLinkedSmsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  // Source sub-account's custom fields — both rails share a single
  // source account, so one fetch covers email + SMS evaluateFilter().
  const { fields: filterableFields } = useFilterableFields(selectedAccountKey || null);

  // Split-audience model: each rail tracks its own selection. When
  // splitAudiences is false, smsSelection is ignored for persistence and
  // counts — emailSelection drives both rails. State is preserved across
  // toggles so users can switch back without re-picking.
  const [splitAudiences, setSplitAudiences] = useState(false);
  const [emailSelection, setEmailSelection] = useState<AudienceSelection>({ kind: 'all' });
  const [smsSelection, setSmsSelection] = useState<AudienceSelection>({ kind: 'all' });
  const [emailTab, setEmailTab] = useState<AudienceTab>('segments');
  const [smsTab, setSmsTab] = useState<AudienceTab>('segments');

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [lists, setLists] = useState<ListSummary[]>([]);
  // Shared list-member cache so a list referenced by both rails doesn't
  // double-fetch when split is off (or when both rails happen to point
  // at the same list in split mode).
  const [listMembersById, setListMembersById] = useState<Map<string, Set<string>>>(new Map());
  const [loadingListIds, setLoadingListIds] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [modalRail, setModalRail] = useState<Rail>('email');
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);

  // Per-rail Contacts-tab state. The ContactsPicker is stateless; we
  // own search + page locally so toggling between rails or tabs
  // preserves the user's position.
  const [emailContactsSearch, setEmailContactsSearch] = useState('');
  const [emailContactsPage, setEmailContactsPage] = useState(0);
  const [smsContactsSearch, setSmsContactsSearch] = useState('');
  const [smsContactsPage, setSmsContactsPage] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const emailRes = await fetch(`/api/campaigns/email/${encodeURIComponent(id)}`);
        const emailData = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok || !emailData?.campaign) {
          throw new Error(emailData?.error || 'Multi-channel campaign not found');
        }
        const email = emailData.campaign as EmailDraft;
        const smsId = parseLinkedSmsId(email.metadata || '');
        if (!smsId) {
          toast.error('Linked SMS draft missing — opening the email-only flow.');
          router.push(`/messaging/campaigns/${encodeURIComponent(id)}/recipients`);
          return;
        }
        const smsRes = await fetch(`/api/campaigns/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        const sms = smsData.campaign as SmsDraft;
        if (cancelled) return;

        setEmailDraft(email);
        setLinkedSmsId(smsId);
        if (email.accountKeys.length > 0) {
          setSelectedAccountKey(email.accountKeys[0]);
        }

        const eSel = audienceFromCampaign(email);
        const sSel = audienceFromCampaign(sms);
        setEmailSelection(eSel);
        setSmsSelection(sSel);
        setEmailTab(preferredTab(eSel));
        setSmsTab(preferredTab(sSel));
        setSplitAudiences(!selectionsEqual(eSel, sSel));
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load campaign');
          router.push('/messaging/campaigns');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
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

  // Reset Contacts-tab state on subaccount change (post-mount). Selected
  // IDs belong to a specific account's pool; keeping them across an
  // account switch would silently send to a mismatched audience. The
  // ref guard ensures initial hydration of a saved contacts-mode draft
  // isn't clobbered.
  const prevAccountKeyRef = useRef<string>('');
  useEffect(() => {
    const prev = prevAccountKeyRef.current;
    prevAccountKeyRef.current = selectedAccountKey;
    if (!prev || prev === selectedAccountKey) return;
    setEmailContactsSearch('');
    setEmailContactsPage(0);
    setSmsContactsSearch('');
    setSmsContactsPage(0);
    setEmailSelection((current) => (current.kind === 'contacts' ? { kind: 'all' } : current));
    setSmsSelection((current) => (current.kind === 'contacts' ? { kind: 'all' } : current));
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

  const scopedAudiences = useMemo(
    () => savedAudiences.filter((a) => !a.accountKey || a.accountKey === selectedAccountKey),
    [savedAudiences, selectedAccountKey],
  );

  const scopedLists = useMemo(
    () => lists.filter((l) => l.accountKey === selectedAccountKey),
    [lists, selectedAccountKey],
  );

  // Hydrate the placeholder list name once the lists fetch completes.
  useEffect(() => {
    setEmailSelection((prev) => {
      if (prev.kind !== 'list') return prev;
      const match = scopedLists.find((l) => l.id === prev.id);
      return match && match.name !== prev.name ? { kind: 'list', id: match.id, name: match.name } : prev;
    });
    setSmsSelection((prev) => {
      if (prev.kind !== 'list') return prev;
      const match = scopedLists.find((l) => l.id === prev.id);
      return match && match.name !== prev.name ? { kind: 'list', id: match.id, name: match.name } : prev;
    });
  }, [scopedLists]);

  // Fetch any list IDs we don't yet have cached. One unified effect so a
  // shared list ID across both rails only triggers one network call.
  const emailListId = emailSelection.kind === 'list' ? emailSelection.id : null;
  const effectiveSmsSelection = splitAudiences ? smsSelection : emailSelection;
  const smsListId = effectiveSmsSelection.kind === 'list' ? effectiveSmsSelection.id : null;

  useEffect(() => {
    const candidates = [emailListId, smsListId].filter((x): x is string => Boolean(x));
    const needed = candidates.filter((listId) => !listMembersById.has(listId) && !loadingListIds.has(listId));
    if (needed.length === 0) return;

    setLoadingListIds((prev) => {
      const next = new Set(prev);
      for (const listId of needed) next.add(listId);
      return next;
    });

    let cancelled = false;
    needed.forEach((listId) => {
      fetch(`/api/contacts/lists/${encodeURIComponent(listId)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
          const ids: string[] = Array.isArray(data.members)
            ? data.members.map((m: { id: string }) => m.id).filter(Boolean)
            : [];
          if (cancelled) return;
          setListMembersById((prev) => {
            const next = new Map(prev);
            next.set(listId, new Set(ids));
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setListMembersById((prev) => {
            const next = new Map(prev);
            next.set(listId, new Set());
            return next;
          });
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingListIds((prev) => {
            const next = new Set(prev);
            next.delete(listId);
            return next;
          });
        });
    });

    return () => {
      cancelled = true;
    };
  }, [emailListId, smsListId, listMembersById, loadingListIds]);

  const emailListMembers = emailListId ? listMembersById.get(emailListId) ?? null : null;
  const smsListMembers = smsListId ? listMembersById.get(smsListId) ?? null : null;
  const emailListLoading = emailListId !== null && loadingListIds.has(emailListId);
  const smsListLoading = smsListId !== null && loadingListIds.has(smsListId);

  const { emailSendable, smsSendable } = useMemo(() => {
    if (contactsLoading) return { emailSendable: 0, smsSendable: 0 };
    const emailOk = contacts.filter((c) => Boolean(c.id) && isEmailDeliverable(c));
    const smsOk = contacts.filter((c) => Boolean(c.id) && isSmsDeliverable(c));

    const resolveEmail = () => {
      if (emailSelection.kind === 'all') return emailOk.length;
      if (emailSelection.kind === 'list') {
        if (!emailListMembers) return 0;
        return emailOk.filter((c) => emailListMembers.has(c.id)).length;
      }
      if (emailSelection.kind === 'contacts') {
        const idSet = new Set(emailSelection.ids);
        return emailOk.filter((c) => idSet.has(c.id)).length;
      }
      return evaluateFilter(emailOk, emailSelection.filter, filterableFields).length;
    };

    const resolveSms = () => {
      const sel = effectiveSmsSelection;
      if (sel.kind === 'all') return smsOk.length;
      if (sel.kind === 'list') {
        if (!smsListMembers) return 0;
        return smsOk.filter((c) => smsListMembers.has(c.id)).length;
      }
      if (sel.kind === 'contacts') {
        const idSet = new Set(sel.ids);
        return smsOk.filter((c) => idSet.has(c.id)).length;
      }
      return evaluateFilter(smsOk, sel.filter, filterableFields).length;
    };

    return { emailSendable: resolveEmail(), smsSendable: resolveSms() };
  }, [contacts, contactsLoading, emailSelection, effectiveSmsSelection, emailListMembers, smsListMembers, filterableFields]);

  function buildPayload(sel: AudienceSelection): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      accountKeys: [selectedAccountKey],
    };
    // Mutually exclusive — always clear unused fields so stale state
    // from a previous mode doesn't linger.
    if (sel.kind === 'all') {
      payload.sourceAudienceId = null;
      payload.sourceFilter = null;
      payload.sourceListId = null;
      payload.sourceContactIds = null;
    } else if (sel.kind === 'list') {
      payload.sourceListId = sel.id;
      payload.sourceAudienceId = null;
      payload.sourceFilter = null;
      payload.sourceContactIds = null;
    } else if (sel.kind === 'contacts') {
      payload.sourceContactIds = JSON.stringify(sel.ids);
      payload.sourceListId = null;
      payload.sourceAudienceId = null;
      payload.sourceFilter = null;
    } else {
      payload.sourceAudienceId = sel.id;
      payload.sourceFilter = JSON.stringify(sel.filter);
      payload.sourceListId = null;
      payload.sourceContactIds = null;
    }
    return payload;
  }

  async function persistSelection() {
    if (!emailDraft || !linkedSmsId) return;
    setSaving(true);
    try {
      await Promise.all([
        fetch(`/api/campaigns/email/${encodeURIComponent(emailDraft.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(emailSelection)),
        }),
        fetch(`/api/campaigns/sms/${encodeURIComponent(linkedSmsId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(effectiveSmsSelection)),
        }),
      ]);
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!emailDraft || !selectedAccountKey) return;
    try {
      await persistSelection();
      router.push(`/messaging/campaigns/multi/${encodeURIComponent(emailDraft.id)}/message`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save selection');
    }
  }

  async function handleBack() {
    if (emailDraft && linkedSmsId) {
      try {
        await persistSelection();
      } catch {
        // non-fatal
      }
    }
    router.push('/messaging/campaigns');
  }

  function handleToggleSplit(next: boolean) {
    // Seed smsSelection from emailSelection on first split so the SMS
    // picker doesn't snap to a stale value from earlier in the session.
    if (next && !splitAudiences) {
      setSmsSelection(emailSelection);
      setSmsTab(preferredTab(emailSelection));
    }
    setSplitAudiences(next);
  }

  function applySelection(rail: Rail, next: AudienceSelection) {
    if (rail === 'email') setEmailSelection(next);
    else setSmsSelection(next);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading campaign…
        </p>
      </div>
    );
  }

  const emailCountsLoading = contactsLoading || emailListLoading;
  const smsCountsLoading = contactsLoading || smsListLoading;

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
              Recipients
            </p>
            <h1 className="text-2xl font-bold">{emailDraft?.name || 'Campaign'}</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
              {splitAudiences
                ? 'Email and SMS each get their own audience. Counts shown for each rail.'
                : 'One audience for both channels. Email needs a valid address; SMS needs a dialable phone — counts shown for each.'}
            </p>
          </div>
          <div className="flex items-end gap-6 flex-shrink-0">
            <div className="text-right">
              <p className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">
                {emailCountsLoading ? (
                  <ArrowPathIcon className="w-6 h-6 inline animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  emailSendable.toLocaleString()
                )}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1.5">Email recipients</p>
            </div>
            <div className="text-right">
              <p className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">
                {smsCountsLoading ? (
                  <ArrowPathIcon className="w-6 h-6 inline animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  smsSendable.toLocaleString()
                )}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1.5">SMS recipients</p>
            </div>
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

        <div
          className={`glass-section-card rounded-2xl p-4 border mb-5 flex items-center justify-between gap-4 ${
            splitAudiences ? 'border-[var(--primary)]/40' : 'border-[var(--border)]'
          }`}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">Use a different audience for SMS</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Pick separate lists or segments for email and SMS. Off by default — both rails share
              the same audience.
            </p>
          </div>
          <Switch
            checked={splitAudiences}
            onChange={handleToggleSplit}
            ariaLabel="Use a different audience for SMS"
          />
        </div>

        {!splitAudiences ? (
          <AudiencePicker
            selection={emailSelection}
            onChange={(next) => applySelection('email', next)}
            tab={emailTab}
            onTabChange={setEmailTab}
            scopedLists={scopedLists}
            scopedAudiences={scopedAudiences}
            allLabel="All Contacts"
            allDescription="Send to every deliverable contact in this subaccount. Email and SMS will resolve to their respective sendable subsets at send time."
            onRequestNewList={() => {
              setModalRail('email');
              setShowNewListModal(true);
            }}
            onRequestNewSegment={() => {
              setModalRail('email');
              setShowFilterBuilder(true);
            }}
            contacts={contacts}
            contactsLoading={contactsLoading}
            contactsSearch={emailContactsSearch}
            onContactsSearchChange={setEmailContactsSearch}
            contactsPage={emailContactsPage}
            onContactsPageChange={setEmailContactsPage}
            // Unified mode — a contact is selectable if EITHER channel
            // can reach them. Per-row reach badges show which channels
            // will fire so the user isn't surprised when sendable
            // counts diverge.
            contactsDeliverableCheck={(c) => isEmailDeliverable(c) || isSmsDeliverable(c)}
            contactsEmptyNoun="reachable contacts"
            reachIndicators={[
              { label: 'Email', icon: EnvelopeIcon, check: isEmailDeliverable },
              { label: 'SMS', icon: PhoneIcon, check: isSmsDeliverable },
            ]}
          />
        ) : (
          <div className="space-y-5">
            <RailSection
              icon={EnvelopeIcon}
              title="Email audience"
              countLabel={`${emailSendable.toLocaleString()} email recipient${emailSendable === 1 ? '' : 's'}`}
              countLoading={emailCountsLoading}
            >
              <AudiencePicker
                selection={emailSelection}
                onChange={(next) => applySelection('email', next)}
                tab={emailTab}
                onTabChange={setEmailTab}
                scopedLists={scopedLists}
                scopedAudiences={scopedAudiences}
                allLabel="All Contacts (email)"
                allDescription="Send to every contact with a valid email address in this subaccount."
                onRequestNewList={() => {
                  setModalRail('email');
                  setShowNewListModal(true);
                }}
                onRequestNewSegment={() => {
                  setModalRail('email');
                  setShowFilterBuilder(true);
                }}
                contacts={contacts}
                contactsLoading={contactsLoading}
                contactsSearch={emailContactsSearch}
                onContactsSearchChange={setEmailContactsSearch}
                contactsPage={emailContactsPage}
                onContactsPageChange={setEmailContactsPage}
                contactsDeliverableCheck={isEmailDeliverable}
                contactsEmptyNoun="deliverable email contacts"
              />
            </RailSection>

            <RailSection
              icon={ChatBubbleLeftRightIcon}
              title="SMS audience"
              countLabel={`${smsSendable.toLocaleString()} SMS recipient${smsSendable === 1 ? '' : 's'}`}
              countLoading={smsCountsLoading}
            >
              <AudiencePicker
                selection={smsSelection}
                onChange={(next) => applySelection('sms', next)}
                tab={smsTab}
                onTabChange={setSmsTab}
                scopedLists={scopedLists}
                scopedAudiences={scopedAudiences}
                allLabel="All Contacts (SMS)"
                allDescription="Send to every contact with a dialable phone number in this subaccount."
                onRequestNewList={() => {
                  setModalRail('sms');
                  setShowNewListModal(true);
                }}
                onRequestNewSegment={() => {
                  setModalRail('sms');
                  setShowFilterBuilder(true);
                }}
                contacts={contacts}
                contactsLoading={contactsLoading}
                contactsSearch={smsContactsSearch}
                onContactsSearchChange={setSmsContactsSearch}
                contactsPage={smsContactsPage}
                onContactsPageChange={setSmsContactsPage}
                contactsDeliverableCheck={isSmsDeliverable}
                contactsEmptyNoun="phone-deliverable contacts"
              />
            </RailSection>
          </div>
        )}
      </div>

      {showNewListModal && (
        <NewListInlineModal
          accountKey={selectedAccountKey}
          onCreated={(list) => {
            setLists((prev) => [
              {
                id: list.id,
                name: list.name,
                description: list.description,
                accountKey: list.accountKey,
                memberCount: 0,
              },
              ...prev,
            ]);
            applySelection(modalRail, { kind: 'list', id: list.id, name: list.name });
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
            applySelection(modalRail, {
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
              applySelection(modalRail, {
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

function AudiencePicker({
  selection,
  onChange,
  tab,
  onTabChange,
  scopedLists,
  scopedAudiences,
  allLabel,
  allDescription,
  onRequestNewList,
  onRequestNewSegment,
  // Contacts-tab props. Optional so the component still works in
  // single-channel callers that don't need a manual picker.
  contacts,
  contactsLoading,
  contactsSearch,
  onContactsSearchChange,
  contactsPage,
  onContactsPageChange,
  contactsDeliverableCheck,
  contactsEmptyNoun,
  reachIndicators,
}: {
  selection: AudienceSelection;
  onChange: (next: AudienceSelection) => void;
  tab: AudienceTab;
  onTabChange: (tab: AudienceTab) => void;
  scopedLists: ListSummary[];
  scopedAudiences: SavedAudience[];
  allLabel: string;
  allDescription: string;
  onRequestNewList: () => void;
  onRequestNewSegment: () => void;
  contacts: Contact[];
  contactsLoading: boolean;
  contactsSearch: string;
  onContactsSearchChange: (value: string) => void;
  contactsPage: number;
  onContactsPageChange: (page: number) => void;
  contactsDeliverableCheck: (c: Contact) => boolean;
  contactsEmptyNoun: string;
  reachIndicators?: React.ComponentProps<typeof ContactsPicker>['reachIndicators'];
}) {
  const tabButton = (
    key: AudienceTab,
    label: string,
    icon: React.ComponentType<{ className?: string }>,
  ) => {
    const Icon = icon;
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => onTabChange(key)}
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
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => onChange({ kind: 'all' })}
        className={`w-full text-left rounded-2xl border-2 p-5 flex items-start gap-4 transition-all ${
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
          <p className="text-sm font-semibold text-[var(--foreground)]">{allLabel}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{allDescription}</p>
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
                  onClick={onRequestNewList}
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
                        onClick={() => onChange({ kind: 'list', id: list.id, name: list.name })}
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
                  onClick={onRequestNewSegment}
                  className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--border)] hover:border-[var(--primary)]/40 text-[var(--foreground)]"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  New segment
                </button>
              </div>

              {scopedAudiences.length > 0 ? (
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
                        onClick={() => onChange({ kind: 'segment', id: a.id, name: a.name, filter })}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center border border-dashed border-[var(--border)] rounded-xl">
                  <RectangleStackIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">No segments for this account yet</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
                    Click <span className="font-medium">New segment</span> above to build a custom filter.
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
                onContactsSearchChange(value);
                onContactsPageChange(0);
              }}
              page={contactsPage}
              onPageChange={onContactsPageChange}
              selectedIds={selection.kind === 'contacts' ? selection.ids : []}
              onSelectionChange={(ids) => {
                if (ids.length === 0) {
                  onChange({ kind: 'all' });
                } else {
                  onChange({ kind: 'contacts', ids });
                }
              }}
              isDeliverable={contactsDeliverableCheck}
              emptyNoun={contactsEmptyNoun}
              reachIndicators={reachIndicators}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RailSection({
  icon: Icon,
  title,
  countLabel,
  countLoading,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  countLabel: string;
  countLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <p className="text-base font-semibold">{title}</p>
        </div>
        <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
          {countLoading ? (
            <ArrowPathIcon className="w-3.5 h-3.5 inline animate-spin" />
          ) : (
            countLabel
          )}
        </p>
      </div>
      {children}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30 ${
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
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
