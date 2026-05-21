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
  EnvelopeIcon,
  PaperAirplaneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import type { Contact } from '@/components/contacts/contacts-table';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { isLikelyDialablePhone, normalizePhoneNumber } from '@/lib/contact-hygiene';
import PrimaryButton from '@/components/primary-button';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface EmailDraft {
  id: string;
  name: string;
  accountKeys: string[];
  subject: string;
  previewText: string;
  htmlContent: string;
  sourceFilter: string;
  metadata: string;
}

interface SmsDraft {
  id: string;
  name: string;
  accountKeys: string[];
  message: string;
  sourceFilter: string;
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

export default function MultiScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [previewTab, setPreviewTab] = useState<'email' | 'sms'>('email');
  const [sendAtLocal, setSendAtLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [submitting, setSubmitting] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const emailRes = await fetch(`/api/campaigns/email/${encodeURIComponent(id)}`);
        const emailData = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok || !emailData?.campaign) {
          throw new Error(emailData?.error || 'Campaign not found');
        }
        const email = emailData.campaign as EmailDraft;
        const smsId = parseLinkedSmsId(email.metadata || '');
        if (!smsId) throw new Error('Linked SMS draft missing');
        const smsRes = await fetch(`/api/campaigns/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        if (cancelled) return;
        setEmailDraft(email);
        setSmsDraft(smsData.campaign);
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

  const accountKey = emailDraft?.accountKeys[0] || smsDraft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

  useEffect(() => {
    if (!accountKey) return;
    let cancelled = false;
    setContactsLoading(true);
    fetch(`/api/esp/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true`)
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

  // Resolve each channel's recipient list against its own validity gate.
  const emailRecipients = useMemo(() => {
    if (!emailDraft) return [] as Array<{ contactId: string; accountKey: string; email: string; fullName: string }>;
    const filter = emailDraft.sourceFilter ? parseFilterDefinition(emailDraft.sourceFilter) : null;
    const sendable = contacts.filter((c) =>
      Boolean(c.id && isValidEmail(String(c.email || '').trim())),
    );
    const matched = filter ? evaluateFilter(sendable, filter) : sendable;
    return matched.map((c) => ({
      contactId: String(c.id).trim(),
      accountKey,
      email: String(c.email || '').trim(),
      fullName: String(c.fullName || '').trim(),
    }));
  }, [emailDraft, contacts, accountKey]);

  const smsRecipients = useMemo(() => {
    if (!smsDraft) return [] as Array<{ contactId: string; accountKey: string; phone: string; fullName: string }>;
    const filter = smsDraft.sourceFilter ? parseFilterDefinition(smsDraft.sourceFilter) : null;
    const sendable = contacts.filter((c) =>
      isLikelyDialablePhone(normalizePhoneNumber(String(c.phone || ''))),
    );
    const matched = filter ? evaluateFilter(sendable, filter) : sendable;
    return matched.map((c) => ({
      contactId: String(c.id).trim(),
      accountKey,
      phone: normalizePhoneNumber(String(c.phone || '')),
      fullName: String(c.fullName || '').trim(),
    }));
  }, [smsDraft, contacts, accountKey]);

  async function handleSchedule() {
    if (!emailDraft || !smsDraft) return;
    if (emailRecipients.length === 0 && smsRecipients.length === 0) {
      toast.error('No deliverable recipients on either channel.');
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
      // Schedule both channels with the same send time. Empty-recipient
      // sides are skipped so a missing email or phone audience doesn't
      // block the other channel.
      const tasks: Promise<Response>[] = [];
      if (emailRecipients.length > 0) {
        tasks.push(
          fetch(`/api/campaigns/email/${encodeURIComponent(emailDraft.id)}/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipients: emailRecipients, scheduledFor }),
          }),
        );
      }
      if (smsRecipients.length > 0) {
        tasks.push(
          fetch(`/api/campaigns/sms/${encodeURIComponent(smsDraft.id)}/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipients: smsRecipients, scheduledFor }),
          }),
        );
      }
      const results = await Promise.all(tasks);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const errData = await failed.json().catch(() => ({}));
        throw new Error(errData?.error || 'One channel failed to schedule');
      }
      toast.success(
        sendMode === 'now'
          ? 'Both channels queued — sending starts within ~1 minute.'
          : `Scheduled both channels for ${formatDateTime(scheduledFor!)}`,
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
          <h1 className="text-2xl font-bold">{emailDraft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Both the email and SMS fire at the same time once you schedule.
          </p>
        </div>

        {/* Two-column: scheduling details on the left, sticky tabbed
            preview on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] gap-6 items-start">
          <div className="space-y-5 min-w-0">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
                Summary
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <ChannelStat
                    icon={EnvelopeIcon}
                    label="Email"
                    count={emailRecipients.length}
                    loading={contactsLoading}
                  />
                  <ChannelStat
                    icon={ChatBubbleLeftRightIcon}
                    label="SMS"
                    count={smsRecipients.length}
                    loading={contactsLoading}
                  />
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-[var(--border)]">
                  <div className="w-9 h-9 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center flex-shrink-0">
                    <UsersIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Subaccount
                    </p>
                    <p className="text-sm font-medium mt-0.5">
                      {account?.dealer || (
                        <span className="text-[var(--muted-foreground)] italic">Not set</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border)] space-y-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Email subject
                    </p>
                    <p className="text-sm truncate">
                      {emailDraft?.subject || (
                        <span className="text-[var(--muted-foreground)] italic">Not set</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      SMS preview
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)] line-clamp-2 whitespace-pre-wrap">
                      {smsDraft?.message || (
                        <span className="italic">Not set</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)]">
              <h3 className="text-base font-semibold mb-4">When should this send?</h3>
              <div className="space-y-3">
                <SendModeOption
                  active={sendMode === 'now'}
                  onClick={() => setSendMode('now')}
                  icon={PaperAirplaneIcon}
                  title="Send now"
                  description="Queue both channels immediately. Sending starts within ~1 minute."
                />
                <SendModeOption
                  active={sendMode === 'later'}
                  onClick={() => setSendMode('later')}
                  icon={ClockIcon}
                  title="Schedule for later"
                  description="Pick a specific date and time. Both channels fire together."
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
              <h3 className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Pre-flight checklist
              </h3>
              <ul className="space-y-2 text-sm">
                <ChecklistItem
                  ok={Boolean(emailDraft?.subject?.trim() && emailDraft?.htmlContent?.trim())}
                  label="Email subject + template ready"
                />
                <ChecklistItem
                  ok={Boolean(smsDraft?.message?.trim())}
                  label="SMS message written"
                />
                <ChecklistItem
                  ok={Boolean(fromEmail)}
                  label="Sender email configured (Sending settings)"
                />
                <ChecklistItem
                  ok={emailRecipients.length > 0 || smsRecipients.length > 0}
                  label={`At least one channel has recipients (${emailRecipients.length.toLocaleString()} email · ${smsRecipients.length.toLocaleString()} SMS)`}
                />
              </ul>
              {fromName && (
                <p className="text-[11px] text-[var(--muted-foreground)] mt-3 border-t border-[var(--border)] pt-3">
                  Email sends as <strong className="text-[var(--foreground)]">{fromName}</strong>{' '}
                  {fromEmail ? `(${fromEmail})` : ''}. SMS routes through this subaccount&apos;s
                  GHL connection.
                </p>
              )}
            </div>
          </div>

          {/* Sticky preview column with tabbed Email / SMS — pinned next
              to the scheduling details so the user can switch channels
              and sanity-check both before committing. */}
          <div className="lg:sticky lg:top-20">
            <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="border-b border-[var(--border)] flex items-center gap-1 px-4">
                <button
                  type="button"
                  onClick={() => setPreviewTab('email')}
                  className={`inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    previewTab === 'email'
                      ? 'border-[var(--primary)] text-[var(--foreground)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('sms')}
                  className={`inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    previewTab === 'sms'
                      ? 'border-[var(--primary)] text-[var(--foreground)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <ChatBubbleLeftRightIcon className="w-4 h-4" />
                  SMS
                </button>
              </div>
              <div className="bg-[var(--muted)]/30 p-4">
                {previewTab === 'email' ? (
                  emailDraft?.htmlContent ? (
                    <div className="bg-white rounded-lg border border-[var(--border)] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-700">
                        <div className="truncate">
                          <span className="font-medium">Subject:</span>{' '}
                          {emailDraft.subject || (
                            <span className="text-gray-400 italic">No subject set</span>
                          )}
                        </div>
                        {emailDraft.previewText && (
                          <div className="truncate text-gray-500 mt-0.5">{emailDraft.previewText}</div>
                        )}
                      </div>
                      <iframe
                        title="Email preview"
                        srcDoc={emailDraft.htmlContent}
                        sandbox=""
                        className="w-full bg-white border-0"
                        style={{ height: 540 }}
                      />
                    </div>
                  ) : (
                    <div className="py-16 text-center text-[var(--muted-foreground)]">
                      <EnvelopeIcon className="w-10 h-10 mx-auto opacity-40 mb-2" />
                      <p className="text-sm">No email template loaded yet.</p>
                    </div>
                  )
                ) : (
                  <div className="py-6 flex justify-center">
                    <IphoneSmsPreview
                      dealerName={account?.dealer || 'Your dealership'}
                      message={smsDraft?.message || ''}
                      mediaUrls={smsDraft ? parseSmsMediaUrls(smsDraft.metadata || '') : []}
                      isMms={Boolean(smsDraft && parseSmsMediaUrls(smsDraft.metadata || '').length > 0)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/campaigns/multi/${encodeURIComponent(id)}/message`)}
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
              (emailRecipients.length === 0 && smsRecipients.length === 0)
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

function ChannelStat({
  icon: Icon,
  label,
  count,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="text-2xl font-bold tabular-nums mt-1">
        {loading ? (
          <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
        ) : (
          count.toLocaleString()
        )}
      </p>
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
