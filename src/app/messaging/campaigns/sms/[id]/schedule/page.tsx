'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import type { Contact } from '@/lib/contacts/types';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { isLikelyDialablePhone, normalizePhoneNumber } from '@/lib/contact-hygiene';
import PrimaryButton from '@/components/primary-button';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  message: string;
  sourceAudienceId: string;
  sourceFilter: string;
  sourceListId: string;
  metadata: string;
}

function parseSmsMediaUrls(rawMetadata: string): string[] {
  if (!rawMetadata) return [];
  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;
    const urls = parsed?.mediaUrls;
    return Array.isArray(urls)
      ? urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
  } catch {
    return [];
  }
}

type SendMode = 'now' | 'later';

function toLocalDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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

export default function SmsScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  // When the draft has a sourceListId, resolve recipients by intersecting
  // the dialable contact set with this list's members.
  const [listMemberIds, setListMemberIds] = useState<Set<string> | null>(null);
  const [listMembersLoading, setListMembersLoading] = useState(false);

  const [messageDraft, setMessageDraft] = useState('');

  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [sendAtLocal, setSendAtLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [submitting, setSubmitting] = useState(false);

  // Keep the inline-editable message text in sync with the loaded draft.
  useEffect(() => {
    setMessageDraft(draft?.message || '');
  }, [draft?.message]);

  async function persistMessage(next: string) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/campaigns/sms/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: next }),
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
    fetch(`/api/campaigns/sms/${encodeURIComponent(id)}`)
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

  // Fetch list members when the draft references a static list. Mirrors
  // the segment-filter branch so the recipient shape is uniform.
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

  // List takes precedence over filter — exclusive on the draft, but
  // gated explicitly so stale filter state on a list-mode draft can't leak.
  const recipients = useMemo(() => {
    if (!draft) return [] as { contactId: string; accountKey: string; phone: string; fullName: string }[];
    const sendable = contacts.filter((c) =>
      isLikelyDialablePhone(normalizePhoneNumber(String(c.phone || ''))),
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
      phone: normalizePhoneNumber(String(c.phone || '')),
      fullName: String(c.fullName || '').trim(),
    }));
  }, [draft, contacts, accountKey, listMemberIds]);

  async function handleSchedule() {
    if (!draft) return;
    if (recipients.length === 0) {
      toast.error('No recipients with valid phone numbers.');
      return;
    }

    let scheduledFor: string | null = null;
    if (sendMode === 'later') {
      const date = new Date(sendAtLocal);
      if (Number.isNaN(date.getTime())) {
        toast.error('Pick a valid send date and time.');
        return;
      }
      if (date.getTime() <= Date.now() + 30_000) {
        toast.error('Send time must be in the future.');
        return;
      }
      scheduledFor = date.toISOString();
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/campaigns/sms/${encodeURIComponent(draft.id)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients, scheduledFor }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to schedule campaign');
      toast.success(
        sendMode === 'now'
          ? 'Campaign queued — sending starts within ~1 minute.'
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

  const smsMediaUrls = draft ? parseSmsMediaUrls(draft.metadata || '') : [];

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Schedule
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Review the message and choose when this campaign should send.
          </p>
        </div>

        {/* Two-column layout:
            - Left: When-to-send (top), Summary with inline-editable
              message + Change audience shortcut (bottom).
            - Right (sticky): Pre-flight checklist (top), iPhone-style
              preview (bottom). */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <div className="space-y-5 min-w-0">
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
                  <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                    Send Date &amp; Time
                  </label>
                  <div className="relative">
                    <CalendarDaysIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                    <input
                      type="datetime-local"
                      value={sendAtLocal}
                      min={toLocalDateTimeInputValue(new Date())}
                      onChange={(e) => setSendAtLocal(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                    Will send {sendAtLocal ? formatDateTime(new Date(sendAtLocal).toISOString()) : '—'}
                  </p>
                </div>
              )}
            </div>

            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
                Summary
              </p>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                    <UsersIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                        Recipients
                      </p>
                      <button
                        type="button"
                        onClick={() => router.push(`/messaging/campaigns/sms/${encodeURIComponent(id)}/recipients`)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                      >
                        <PencilSquareIcon className="w-3 h-3" />
                        Change
                      </button>
                    </div>
                    <p className="text-2xl font-bold tabular-nums mt-0.5">
                      {contactsLoading || listMembersLoading ? (
                        <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        recipients.length.toLocaleString()
                      )}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border)] space-y-2">
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Message
                  </label>
                  <textarea
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    onBlur={() => {
                      const next = messageDraft;
                      if (next !== (draft?.message || '')) {
                        void persistMessage(next);
                      }
                    }}
                    rows={4}
                    placeholder="Message text"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 resize-y"
                  />
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {messageDraft.length} character{messageDraft.length === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="pt-3 border-t border-[var(--border)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
                    From
                  </p>
                  <p className="text-sm font-medium">
                    {account?.dealer || (
                      <span className="text-[var(--muted-foreground)] italic">Not set</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Routes through this subaccount&apos;s Twilio connection.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right (sticky): pre-flight checklist on top, iPhone preview
              below. */}
          <div className="lg:sticky lg:top-20 space-y-5">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <h3 className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Pre-flight checklist
              </h3>
              <ul className="space-y-2 text-sm">
                <ChecklistItem ok={Boolean(draft?.message?.trim())} label="Message text is written" />
                <ChecklistItem
                  ok={recipients.length > 0}
                  label={`${recipients.length.toLocaleString()} sendable recipient${recipients.length === 1 ? '' : 's'}`}
                />
                <ChecklistItem
                  ok={Boolean(account)}
                  label="Subaccount selected (SMS routes through its Twilio connection)"
                />
              </ul>
            </div>

            <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  {smsMediaUrls.length > 0 ? 'MMS' : 'SMS'} preview
                </p>
              </div>
              <div className="bg-[var(--muted)]/30 p-4 py-6 flex justify-center">
                <IphoneSmsPreview
                  dealerName={account?.dealer || 'Your dealership'}
                  message={messageDraft}
                  mediaUrls={smsMediaUrls}
                  isMms={smsMediaUrls.length > 0}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/campaigns/sms/${encodeURIComponent(id)}/message`)}
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
              !draft?.message?.trim()
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
      {active && <CheckCircleIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />}
    </button>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
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
