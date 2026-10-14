'use client';

import { use, useEffect, useMemo, useState } from 'react';
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
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useFilterableFields } from '@/hooks/use-filterable-fields';
import type { Contact } from '@/lib/contacts/types';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  isLikelyDeliverableEmail,
  isLikelyDialablePhone,
  normalizePhoneNumber,
} from '@/lib/contact-hygiene';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { Select } from '@/components/select';
import { FilterBuilder } from '@/components/contacts/filter-builder';
import { ContactsPicker } from '@/components/contacts/contacts-picker';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { BlastLockedNotice } from '@/components/campaigns/blast-locked-notice';
import {
  AUDIENCE_CONFIRMED_KEY,
  isEditableBlastStatus,
} from '@/lib/messaging/blast-builder-steps';
import { parseBlastMetadata, readLinkedSmsId } from '@/lib/messaging/blast-metadata';
import {
  announceDraftSaved,
  patchJson,
  useDraftAutosave,
} from '@/lib/messaging/builder-autosave';
import {
  EMPTY_AUDIENCE_MESSAGE,
  NOBODY,
  audienceAfterAccountChange,
  audienceFromDraft,
  audiencePatch,
  audienceTab,
  isAudienceEmpty,
  refreshSegmentSelection,
  sameAudience,
  toServerSelection,
  type AudienceTab,
  type BuilderAudience,
} from '@/lib/messaging/recipients-step';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface CampaignDraftCore {
  id: string;
  name: string;
  status: string;
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

// Channel deliverability checks reused by the picker (selection gating) —
// the same predicates the sender and the server-side counts use.
function isEmailDeliverable(c: Contact): boolean {
  return isLikelyDeliverableEmail(String(c.email || '').trim());
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

type Rail = 'email' | 'sms';
type AudienceSelection = BuilderAudience;

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

/** Why the pair can't continue, or null when both rails have someone. */
function emptyRailMessage(
  email: AudienceSelection,
  sms: AudienceSelection,
  split: boolean,
): string | null {
  if (!split) return isAudienceEmpty(email) ? EMPTY_AUDIENCE_MESSAGE : null;
  // The pair is scheduled as one, and the server refuses a pair with an empty
  // side — so each rail needs someone.
  if (isAudienceEmpty(email)) return `Email: ${EMPTY_AUDIENCE_MESSAGE}`;
  if (isAudienceEmpty(sms)) return `SMS: ${EMPTY_AUDIENCE_MESSAGE}`;
  return null;
}

export default function MultiRecipientsStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { isAccount, accountKey, accounts } = useAccount();
  const subHref = useSubaccountHref();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  // True once both halves' saved audiences are in state; nothing autosaves
  // before then, so defaults never overwrite a saved choice.
  const [hydrated, setHydrated] = useState(false);

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  // Source account's custom fields — still needed by the inline
  // filter builder's field dropdown. Counting itself resolves
  // server-side, where the same catalogue is rebuilt per request.
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
  // Whether someone has chosen on this step — see AUDIENCE_CONFIRMED_KEY.
  // One flag for the pair, written to both halves.
  const [confirmed, setConfirmed] = useState(false);

  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [lists, setLists] = useState<ListSummary[]>([]);

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

  // Either half past draft locks the pair: they're scheduled as one.
  const lockedDraft =
    emailDraft && !isEditableBlastStatus(emailDraft.status)
      ? emailDraft
      : smsDraft && !isEditableBlastStatus(smsDraft.status)
        ? smsDraft
        : null;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const emailRes = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`);
        const emailData = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok || !emailData?.campaign) {
          throw new Error(emailData?.error || 'Blast not found');
        }
        const email = emailData.campaign as EmailDraft;
        const smsId = readLinkedSmsId(email.metadata || '');
        if (!smsId) {
          toast.error('Linked SMS draft missing — opening the email-only flow.');
          router.push(subHref(`/messaging/blasts/${encodeURIComponent(id)}/recipients`));
          return;
        }
        const smsRes = await fetch(`/api/blasts/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        const sms = smsData.campaign as SmsDraft;
        if (cancelled) return;

        setEmailDraft(email);
        setSmsDraft(sms);
        // The draft's own account, set together with its audiences — never
        // after a default, which made the account-change reset fire on load
        // and flip hand-picked audiences to "All Contacts".
        setSelectedAccountKey(email.accountKeys[0] || '');

        // Read through the same function the send uses, so what's shown is
        // what would go out — a saved-but-empty selection stays empty.
        const eSel = audienceFromDraft(email);
        const sSel = audienceFromDraft(sms);
        setEmailSelection(eSel);
        setSmsSelection(sSel);
        setEmailTab(audienceTab(eSel));
        setSmsTab(audienceTab(sSel));
        setSplitAudiences(!sameAudience(eSel, sSel));
        setConfirmed(parseBlastMetadata(email.metadata)[AUDIENCE_CONFIRMED_KEY] === true);
        setHydrated(true);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load blast');
          router.push(subHref('/messaging/blasts'));
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

  // Only a draft with no account of its own takes a default, and only once
  // it has loaded.
  useEffect(() => {
    if (!hydrated || selectedAccountKey || accountOptions.length === 0) return;
    setSelectedAccountKey(accountOptions[0].key);
  }, [hydrated, selectedAccountKey, accountOptions]);

  /**
   * The user moved the pair to another account. Hand-picked contacts and
   * lists belong to the old one, so they reset to nobody — never to "All
   * Contacts". In the handler, not an effect, so loading can't trip it.
   */
  function changeAccount(next: string) {
    if (!next || next === selectedAccountKey) return;
    setSelectedAccountKey(next);
    setEmailContactsSearch('');
    setEmailContactsPage(0);
    setSmsContactsSearch('');
    setSmsContactsPage(0);
    setEmailSelection((current) => audienceAfterAccountChange(current));
    setSmsSelection((current) => audienceAfterAccountChange(current));
  }

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

  // Hydrate the placeholder list name once the lists fetch completes. Names
  // aren't saved, so this never triggers an autosave.
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

  // A picked segment follows the segment — see refreshSegmentSelection.
  // Changes what's saved, so the autosave writes it back.
  useEffect(() => {
    // After hydration: the segments can arrive before the drafts do.
    if (!hydrated || lockedDraft) return;
    setEmailSelection((prev) => refreshSegmentSelection(prev, scopedAudiences) ?? prev);
    setSmsSelection((prev) => refreshSegmentSelection(prev, scopedAudiences) ?? prev);
  }, [scopedAudiences, lockedDraft, hydrated]);

  // When the rails aren't split, SMS follows the email selection.
  const effectiveSmsSelection = splitAudiences ? smsSelection : emailSelection;

  // ── Autosave ──
  // Both halves saved together shortly after any change; the header's step
  // links wait for it. The pair used to be saved only by Continue and Back,
  // which also never checked whether either save worked and moved on
  // regardless — leaving one half, or both, on an audience nobody chose.
  const autosaveKey = useMemo(
    () =>
      JSON.stringify({
        email: audiencePatch(emailSelection, selectedAccountKey, confirmed),
        sms: audiencePatch(effectiveSmsSelection, selectedAccountKey, confirmed),
      }),
    [emailSelection, effectiveSmsSelection, selectedAccountKey, confirmed],
  );
  const smsId = smsDraft?.id ?? null;
  const autosave = useDraftAutosave({
    key: autosaveKey,
    ready: hydrated && !lockedDraft && Boolean(selectedAccountKey) && Boolean(smsId),
    save: async (key, { keepalive }) => {
      if (!smsId) throw new Error('The linked text draft is missing.');
      const body = JSON.parse(key) as { email: Record<string, unknown>; sms: Record<string, unknown> };
      // Both checked: one half failing must not read as saved.
      const [email, sms] = await Promise.allSettled([
        patchJson(`/api/blasts/email/${encodeURIComponent(id)}`, body.email, { keepalive }),
        patchJson(`/api/blasts/sms/${encodeURIComponent(smsId)}`, body.sms, { keepalive }),
      ]);
      const failures = [
        email.status === 'rejected' ? `email: ${(email.reason as Error)?.message || 'failed'}` : '',
        sms.status === 'rejected' ? `text: ${(sms.reason as Error)?.message || 'failed'}` : '',
      ].filter(Boolean);
      if (failures.length > 0) {
        throw new Error(`Couldn’t save the audience (${failures.join('; ')}).`);
      }
      announceDraftSaved(id);
    },
    onError: (err) => toast.error(err.message),
  });

  // Both rails' sendable counts resolved SERVER-side, over the whole
  // roster. Counting `contacts` meant counting inside the 5,000
  // most-recently-added rows, which under-reports any segment that isn't
  // correlated with recency — and this is the number the audience choice
  // is made on.
  const [emailSendable, setEmailSendable] = useState(0);
  const [smsSendable, setSmsSendable] = useState(0);
  const [sendableLoading, setSendableLoading] = useState(false);

  const sendableKey = useMemo(
    () =>
      JSON.stringify([
        toServerSelection(emailSelection),
        toServerSelection(effectiveSmsSelection),
      ]),
    [emailSelection, effectiveSmsSelection],
  );

  useEffect(() => {
    if (!selectedAccountKey) {
      setEmailSendable(0);
      setSmsSendable(0);
      return;
    }
    let cancelled = false;
    setSendableLoading(true);

    const [emailSel, smsSel] = JSON.parse(sendableKey) as [
      ReturnType<typeof toServerSelection>,
      ReturnType<typeof toServerSelection>,
    ];

    const count = async (selection: ReturnType<typeof toServerSelection>, channel: 'email' | 'sms') => {
      // Nobody selected is zero by definition — no need to ask.
      if (selection.kind === 'contacts' && selection.ids.length === 0) return 0;
      const res = await fetch('/api/segments/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: selectedAccountKey, selection, channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return Number(data.total) || 0;
    };

    const timer = setTimeout(() => {
      Promise.all([count(emailSel, 'email'), count(smsSel, 'sms')])
        .then(([email, sms]) => {
          if (cancelled) return;
          setEmailSendable(email);
          setSmsSendable(sms);
        })
        .catch(() => {
          if (cancelled) return;
          setEmailSendable(0);
          setSmsSendable(0);
        })
        .finally(() => {
          if (!cancelled) setSendableLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sendableKey, selectedAccountKey]);

  const emptyMessage = emptyRailMessage(emailSelection, effectiveSmsSelection, splitAudiences);

  async function handleContinue() {
    if (!emailDraft || !selectedAccountKey) return;
    if (emptyMessage) {
      toast.error(emptyMessage);
      return;
    }
    setSaving(true);
    try {
      // Continue IS the choice — saved explicitly, after any autosave still in
      // flight. A failure on either half keeps the user here.
      setConfirmed(true);
      await autosave.saveNow(
        JSON.stringify({
          email: audiencePatch(emailSelection, selectedAccountKey, true),
          sms: audiencePatch(effectiveSmsSelection, selectedAccountKey, true),
        }),
      );
      router.push(subHref(`/messaging/blasts/multi/${encodeURIComponent(emailDraft.id)}/message`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the audience');
      setSaving(false);
    }
  }

  async function handleBack() {
    try {
      // Only what changed — Back is not a choice.
      await autosave.flush();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the audience');
      return;
    }
    router.push(subHref('/messaging/blasts'));
  }

  function handleToggleSplit(next: boolean) {
    // Seed smsSelection from emailSelection on first split so the SMS
    // picker doesn't snap to a stale value from earlier in the session.
    if (next && !splitAudiences) {
      setSmsSelection(emailSelection);
      setSmsTab(audienceTab(emailSelection));
    }
    setSplitAudiences(next);
  }

  /** A user's pick on one rail: the selection AND a choice. */
  function applySelection(rail: Rail, next: AudienceSelection) {
    if (rail === 'email') setEmailSelection(next);
    else setSmsSelection(next);
    setConfirmed(true);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading blast…
        </p>
      </div>
    );
  }

  if (lockedDraft) {
    return <BlastLockedNotice status={lockedDraft.status} name={emailDraft?.name} />;
  }

  const emailCountsLoading = sendableLoading;
  const smsCountsLoading = sendableLoading;

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
              Recipients
            </p>
            <h1>
              <BlastNameField id={id} channel="multi" variant="title" initialName={emailDraft?.name ?? ''} />
            </h1>
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
              Sending account
            </label>
            <Select
              value={selectedAccountKey}
              onChange={changeAccount}
              options={accountOptions.map((opt) => ({ value: opt.key, label: opt.dealer }))}
              ariaLabel="Sending account"
            />
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
            allDescription="Send to every deliverable contact in this account. Email and SMS will resolve to their respective sendable subsets at send time."
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
                allDescription="Send to every contact with a valid email address in this account."
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
                allDescription="Send to every contact with a dialable phone number in this account."
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
          // Offer to persist the segment from the primary button. Without
          // this the only way out of the builder was Apply, which produced
          // an unnamed ad-hoc selection the send consumed and discarded.
          offerSave
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
          <div className="flex items-center gap-4 min-w-0">
            {emptyMessage && (
              <p className="text-xs text-[var(--muted-foreground)] animate-fade-in-up">{emptyMessage}</p>
            )}
            <PrimaryButton
              onClick={handleContinue}
              disabled={!selectedAccountKey || saving || Boolean(emptyMessage)}
            >
              {saving ? 'Saving…' : 'Continue'}
            </PrimaryButton>
          </div>
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
                // Unchecking everyone leaves NOBODY selected. It used to
                // fall back to "All Contacts", which turned an empty pick
                // into the whole account.
                onChange(ids.length === 0 ? NOBODY : { kind: 'contacts', ids });
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
            className="px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
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
