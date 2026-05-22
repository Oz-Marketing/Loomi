'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  CalendarDaysIcon,
  ChartBarSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { Contact } from '@/lib/contacts/types';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import PrimaryButton from '@/components/primary-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  subject: string;
  previewText: string;
  htmlContent: string;
  sourceAudienceId: string;
  sourceFilter: string;
  sourceListId: string;
  metadata: string;
}

type SendMode = 'now' | 'later';

interface UtmSettings {
  enabled: boolean;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

interface ResendSettings {
  enabled: boolean;
  delayHours: number;
  subject: string;
}

interface CampaignMetadata {
  utm?: Partial<UtmSettings>;
  resend?: Partial<ResendSettings>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultUtm(campaignName: string): UtmSettings {
  return {
    enabled: false,
    source: 'loomi',
    medium: 'email',
    campaign: slugify(campaignName) || 'campaign',
    term: '',
    content: '',
  };
}

function defaultResend(): ResendSettings {
  return {
    enabled: false,
    delayHours: 72,
    subject: '',
  };
}

function parseMetadata(raw: string): CampaignMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CampaignMetadata)
      : {};
  } catch {
    return {};
  }
}

// Split-input date/time. We keep them as separate strings (YYYY-MM-DD,
// HH:MM) and combine on submit so each input gets its own native picker
// — `datetime-local` is one widget on Chrome but two on Safari etc.,
// and the split form makes the keyboard flow obvious on every browser.

function toLocalDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toLocalTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(11, 16);
}

function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

export default function ScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();
  const subHref = useSubaccountHref();
  const sendingSettingsHref = subHref('/messaging/settings/sending');

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  // When the draft has a sourceListId, we resolve recipients by
  // intersecting the deliverable contact set with this list's members.
  const [listMemberIds, setListMemberIds] = useState<Set<string> | null>(null);
  const [listMembersLoading, setListMembersLoading] = useState(false);

  const [sendMode, setSendMode] = useState<SendMode>('later');
  // Default to ~30m out so the input isn't pinned to "now" (which would
  // immediately fail the future-only validator on submit).
  const defaultSend = useMemo(() => new Date(Date.now() + 30 * 60_000), []);
  const [sendDate, setSendDate] = useState(toLocalDateInputValue(defaultSend));
  const [sendTime, setSendTime] = useState(toLocalTimeInputValue(defaultSend));
  const [submitting, setSubmitting] = useState(false);

  // Inline-edit state for subject + preview text. These persist back to
  // the draft via PATCH on blur so users can tweak copy without bouncing
  // back to the editor.
  const [subjectDraft, setSubjectDraft] = useState('');
  const [previewTextDraft, setPreviewTextDraft] = useState('');

  // UTM + Resend live in the campaign's `metadata` JSON field. Hydrated
  // from the draft once it lands; persisted in handleSchedule alongside
  // the schedule POST (so we don't fire a PATCH per keystroke). The
  // enabled flag also drives section expansion — see ToggleSection.
  const [utm, setUtm] = useState<UtmSettings>(defaultUtm(''));
  const [resend, setResend] = useState<ResendSettings>(defaultResend());

  useEffect(() => {
    setSubjectDraft(draft?.subject || '');
    setPreviewTextDraft(draft?.previewText || '');
  }, [draft?.subject, draft?.previewText]);

  useEffect(() => {
    if (!draft) return;
    const meta = parseMetadata(draft.metadata);
    const baseUtm = defaultUtm(draft.name || '');
    setUtm({ ...baseUtm, ...(meta.utm ?? {}) });
    setResend({ ...defaultResend(), ...(meta.resend ?? {}) });
  }, [draft]);

  async function persistField(patch: { subject?: string; previewText?: string }) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/campaigns/email/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      if (data?.campaign) setDraft(data.campaign as DraftCampaign);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/email/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Campaign not found');
          router.push('/messaging/campaigns');
          return;
        }
        setDraft(data.campaign);
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

  // Load contacts for this account so we can resolve the audience to a
  // concrete recipient list at submit time.
  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    setContactsLoading(true);
    fetch(`/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true`)
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
  }, [accountKey]);

  // Fetch list members when the draft references a static list. Resolution
  // happens client-side (matching the segment branch) so the recipient
  // shape is built the same way on either path.
  useEffect(() => {
    const listId = draft?.sourceListId;
    if (!listId) {
      setListMemberIds(null);
      return;
    }
    let cancelled = false;
    setListMembersLoading(true);
    fetch(`/api/contacts/lists/${encodeURIComponent(listId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
        const ids: string[] = Array.isArray(data.members)
          ? data.members.map((m: { id: string }) => m.id).filter(Boolean)
          : [];
        if (!cancelled) setListMemberIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setListMemberIds(new Set());
      })
      .finally(() => {
        if (!cancelled) setListMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.sourceListId]);

  // Resolve audience → list of sendable recipients. List takes precedence
  // over filter — they're mutually exclusive on the draft, but we still
  // gate explicitly so an old filter on a list-mode draft can't leak in.
  const recipients = useMemo(() => {
    if (!draft) return [] as { contactId: string; accountKey: string; email: string; fullName: string }[];
    const sendable = contacts.filter((c) =>
      Boolean(c.id && isValidEmail(String(c.email || '').trim())),
    );
    let matched: Contact[];
    if (draft.sourceListId) {
      if (!listMemberIds) return [];
      matched = sendable.filter((c) => listMemberIds.has(c.id));
    } else {
      const filter = draft.sourceFilter ? parseFilterDefinition(draft.sourceFilter) : null;
      matched = filter ? evaluateFilter(sendable, filter) : sendable;
    }
    return matched.map((c) => ({
      contactId: String(c.id).trim(),
      accountKey,
      email: String(c.email || '').trim(),
      fullName: String(c.fullName || '').trim(),
    }));
  }, [draft, contacts, accountKey, listMemberIds]);

  async function handleSchedule() {
    if (!draft) return;
    if (recipients.length === 0) {
      toast.error('No recipients to send to.');
      return;
    }

    let scheduledFor: string | null = null;
    if (sendMode === 'later') {
      const date = combineDateAndTime(sendDate, sendTime);
      if (!date) {
        toast.error('Pick a valid send date and time.');
        return;
      }
      if (date.getTime() <= Date.now() + 30_000) {
        toast.error('Send time must be in the future.');
        return;
      }
      scheduledFor = date.toISOString();
    }

    // Build the metadata blob from the UTM + Resend state. We keep the
    // existing metadata fields the schedule step doesn't own (in case
    // earlier steps store anything alongside).
    const existingMeta = parseMetadata(draft.metadata);
    const nextMeta: CampaignMetadata = { ...existingMeta, utm, resend };
    const metadataJson = JSON.stringify(nextMeta);

    setSubmitting(true);
    try {
      // Persist metadata first so the schedule POST sees a finalized
      // campaign. Done as a PATCH because the schedule endpoint only
      // accepts the recipient list + scheduledFor.
      if (metadataJson !== (draft.metadata || '')) {
        const patchRes = await fetch(`/api/campaigns/email/${encodeURIComponent(draft.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: metadataJson }),
        });
        if (!patchRes.ok) {
          const patchData = await patchRes.json().catch(() => ({}));
          throw new Error(patchData?.error || 'Failed to save tracking settings');
        }
      }

      const res = await fetch(
        `/api/campaigns/email/${encodeURIComponent(draft.id)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients, scheduledFor }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to schedule campaign');
      }
      toast.success(
        sendMode === 'now'
          ? 'Campaign queued — will start sending in the next minute.'
          : `Campaign scheduled for ${formatDateTime(scheduledFor!)}`,
      );
      router.push('/messaging/campaigns');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule campaign');
    } finally {
      setSubmitting(false);
    }
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

  const fromName = account?.senderName || account?.dealer || '';
  const fromEmail = account?.senderEmail || '';

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Schedule
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Review the email and choose when this campaign should send.
          </p>
        </div>

        {/* Two-column layout:
            - Left:  When-to-send (top), Summary (bottom, inline-editable
              subject + preview text, plus a Change audience shortcut).
            - Right (sticky): Pre-flight checklist (top), Email preview
              (bottom) — so the user can sanity-check while scheduling. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] gap-6 items-start">
          <div className="space-y-5 min-w-0">
            {/* When should this send? */}
            <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
              <h3 className="text-base font-semibold mb-4">When should this send?</h3>
              <div className="space-y-3">
                <SendModeOption
                  active={sendMode === 'now'}
                  onClick={() => setSendMode('now')}
                  icon={PaperAirplaneIcon}
                  title="Send now"
                  description="Queue immediately. Sending starts within ~1 minute."
                />
                <SendModeOption
                  active={sendMode === 'later'}
                  onClick={() => setSendMode('later')}
                  icon={ClockIcon}
                  title="Schedule for later"
                  description="Pick a specific date and time. Loomi fires it then."
                />
              </div>

              {sendMode === 'later' && (
                <div className="mt-5 pt-5 border-t border-[var(--border)]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                        Send Date
                      </label>
                      <div className="relative">
                        <CalendarDaysIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                        <input
                          type="date"
                          value={sendDate}
                          min={toLocalDateInputValue(new Date())}
                          onChange={(e) => setSendDate(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                        Send Time
                      </label>
                      <div className="relative">
                        <ClockIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                        <input
                          type="time"
                          value={sendTime}
                          onChange={(e) => setSendTime(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                    {(() => {
                      const combined = combineDateAndTime(sendDate, sendTime);
                      return combined
                        ? `Will send ${formatDateTime(combined.toISOString())}`
                        : 'Pick a date and time to schedule the send.';
                    })()}
                  </p>
                </div>
              )}
            </div>

            {/* UTM tracking. Header toggle drives both enabled + expanded
                state. When enabled, links in the rendered email get utm_*
                query params appended. Stored under metadata.utm. */}
            <ToggleSection
              icon={ChartBarSquareIcon}
              title="UTM tracking"
              subtitle={
                utm.enabled
                  ? `Tagging links with ${utm.source}/${utm.medium}`
                  : 'Append utm_* params to links in this email'
              }
              enabled={utm.enabled}
              onToggle={(checked) => setUtm((u) => ({ ...u, enabled: checked }))}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <UtmField
                  label="Source"
                  value={utm.source}
                  placeholder="loomi"
                  onChange={(v) => setUtm((u) => ({ ...u, source: v }))}
                />
                <UtmField
                  label="Medium"
                  value={utm.medium}
                  placeholder="email"
                  onChange={(v) => setUtm((u) => ({ ...u, medium: v }))}
                />
                <UtmField
                  label="Campaign"
                  value={utm.campaign}
                  placeholder="spring-launch"
                  onChange={(v) => setUtm((u) => ({ ...u, campaign: v }))}
                />
                <UtmField
                  label="Term"
                  value={utm.term}
                  placeholder="(optional)"
                  onChange={(v) => setUtm((u) => ({ ...u, term: v }))}
                />
                <UtmField
                  label="Content"
                  value={utm.content}
                  placeholder="(optional)"
                  onChange={(v) => setUtm((u) => ({ ...u, content: v }))}
                />
              </div>
            </ToggleSection>

            {/* Resend to non-engaged. Fires a follow-up after a delay to
                recipients who haven't opened/clicked. Stored under
                metadata.resend; the worker schedules + filters at send. */}
            <ToggleSection
              icon={ArrowPathRoundedSquareIcon}
              title="Resend to non-engaged"
              subtitle={
                resend.enabled
                  ? `Follow-up after ${resend.delayHours}h to anyone who didn't open or click`
                  : 'Send a second email to recipients who didn’t engage'
              }
              enabled={resend.enabled}
              onToggle={(checked) => setResend((r) => ({ ...r, enabled: checked }))}
            >
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                    Delay
                  </label>
                  <select
                    value={resend.delayHours}
                    onChange={(e) => setResend((r) => ({ ...r, delayHours: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
                  >
                    <option value={24}>24 hours</option>
                    <option value={48}>2 days</option>
                    <option value={72}>3 days</option>
                    <option value={120}>5 days</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                    Resend subject <span className="font-normal lowercase">(optional override)</span>
                  </label>
                  <input
                    type="text"
                    value={resend.subject}
                    onChange={(e) => setResend((r) => ({ ...r, subject: e.target.value }))}
                    placeholder={draft?.subject ? `Reminder: ${draft.subject}` : 'Leave blank to reuse the original subject'}
                    maxLength={200}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            </ToggleSection>
          </div>

          {/* Right (sticky): compact summary → checklist → subject/preview
              → email preview, top to bottom. */}
          <div className="lg:sticky lg:top-20 space-y-4">
            {/* Compact summary — replaces the old Summary card. Two rows:
                recipients (with Change shortcut) and From identity. */}
            <div className="glass-section-card rounded-xl border border-[var(--border)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <UsersIcon className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums leading-tight">
                      {contactsLoading || listMembersLoading ? (
                        <ArrowPathIcon className="w-3.5 h-3.5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        `${recipients.length.toLocaleString()} recipient${recipients.length === 1 ? '' : 's'}`
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/messaging/campaigns/${encodeURIComponent(id)}/recipients`)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline whitespace-nowrap"
                >
                  <PencilSquareIcon className="w-3 h-3" />
                  Change
                </button>
              </div>
              <div className="flex items-start gap-2.5 mt-2 pt-2 border-t border-[var(--border)] min-w-0">
                <EnvelopeIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] leading-tight">
                    From
                  </p>
                  <p className="text-xs font-medium truncate">
                    {fromName || <span className="text-[var(--muted-foreground)] italic">Not set</span>}
                  </p>
                  <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                    {fromEmail || (
                      <Link
                        href={sendingSettingsHref}
                        className="italic text-[var(--primary)] hover:underline"
                      >
                        Configure in Sending settings →
                      </Link>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <h3 className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Pre-flight checklist
              </h3>
              <ul className="space-y-2 text-sm">
                <ChecklistItem
                  ok={Boolean(draft?.subject?.trim())}
                  label="Subject line is set"
                />
                <ChecklistItem
                  ok={Boolean(draft?.htmlContent?.trim())}
                  label="Template content is loaded"
                />
                <ChecklistItem
                  ok={Boolean(fromEmail)}
                  label={
                    <>
                      Sender email configured in{' '}
                      <Link
                        href={sendingSettingsHref}
                        className="text-[var(--primary)] hover:underline"
                      >
                        Sending settings
                      </Link>
                    </>
                  }
                />
                <ChecklistItem
                  ok={recipients.length > 0}
                  label={`${recipients.length.toLocaleString()} sendable recipient${recipients.length === 1 ? '' : 's'}`}
                />
              </ul>
            </div>

            {/* Inline subject + preview text editors. Persist on blur so
                tweaks don't require bouncing back to the message step. */}
            <div className="glass-section-card rounded-2xl p-4 border border-[var(--border)] space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  value={subjectDraft}
                  onChange={(e) => setSubjectDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = subjectDraft.trim();
                    if (trimmed !== (draft?.subject || '')) {
                      void persistField({ subject: trimmed });
                    }
                  }}
                  placeholder="Subject line"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
                  Preview text
                </label>
                <input
                  type="text"
                  value={previewTextDraft}
                  onChange={(e) => setPreviewTextDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = previewTextDraft.trim();
                    if (trimmed !== (draft?.previewText || '')) {
                      void persistField({ previewText: trimmed });
                    }
                  }}
                  placeholder="Optional inbox preview snippet"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
              </div>
            </div>

            <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Email preview
                </p>
              </div>
              <div className="bg-[var(--muted)]/30 p-4">
                {draft?.htmlContent ? (
                  <div className="bg-white rounded-lg border border-[var(--border)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-700">
                      <div className="truncate">
                        <span className="font-medium">Subject:</span>{' '}
                        {draft.subject || (
                          <span className="text-gray-400 italic">No subject set</span>
                        )}
                      </div>
                      {draft.previewText && (
                        <div className="truncate text-gray-500 mt-0.5">{draft.previewText}</div>
                      )}
                    </div>
                    <iframe
                      title="Email preview"
                      srcDoc={draft.htmlContent}
                      sandbox=""
                      className="w-full bg-white border-0"
                      style={{ height: 480 }}
                    />
                  </div>
                ) : (
                  <div className="py-16 text-center text-[var(--muted-foreground)]">
                    <EnvelopeIcon className="w-10 h-10 mx-auto opacity-40 mb-2" />
                    <p className="text-sm">No email template loaded yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/campaigns/${encodeURIComponent(id)}/template`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>

          <PrimaryButton
            onClick={handleSchedule}
            disabled={
              submitting ||
              contactsLoading ||
              listMembersLoading ||
              recipients.length === 0 ||
              !draft?.subject?.trim() ||
              !draft?.htmlContent?.trim()
            }
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            {submitting
              ? 'Scheduling…'
              : sendMode === 'now'
                ? 'Send now'
                : 'Schedule send'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SendModeOption({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 flex items-start gap-3 text-left transition-all ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/[0.05]'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
      </div>
      {active && (
        <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
      )}
    </button>
  );
}

function ToggleSection({
  icon: Icon,
  title,
  subtitle,
  enabled,
  onToggle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
}) {
  // Single source of truth: `enabled` drives both persistence (the
  // metadata.utm/resend.enabled flag) and visibility of the fields.
  // There's no "open but disabled" intermediate state — the toggle
  // decides everything.
  return (
    <div
      className={`glass-section-card rounded-2xl border ${
        enabled ? 'border-[var(--primary)]/40' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            enabled
              ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
              : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{subtitle}</p>
        </div>
        <Switch checked={enabled} onChange={onToggle} ariaLabel={`Enable ${title.toLowerCase()}`} />
      </div>
      {enabled && (
        <div className="px-5 pb-5 pt-4 border-t border-[var(--border)]">
          {children}
        </div>
      )}
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

function UtmField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={120}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)]"
      />
    </div>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircleIcon
        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
          ok ? 'text-emerald-300' : 'text-[var(--muted-foreground)] opacity-40'
        }`}
      />
      <span
        className={`text-sm ${ok ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}
      >
        {label}
      </span>
    </li>
  );
}
