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
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import {
  audienceSelectionFromDraft,
  type RecipientRow,
} from '@/lib/segments/selection';
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
  /** JSON-stringified array of Contact IDs for manual selection mode. */
  sourceContactIds: string;
  metadata: string;
}

interface SmsPreflightIssue {
  severity: 'blocker' | 'warning';
  code: string;
  accountKey: string;
  message: string;
  remedy: string;
}

interface SmsPreflightReport {
  ok: boolean;
  issues: SmsPreflightIssue[];
  /** Earliest compliant instant, when quiet hours are the problem. */
  suggestedSendAt: string | null;
  heldByQuietHours: number;
  pending?: boolean;
}

/** Format an instant for a datetime-local input in the browser's timezone. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

export default function SmsScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);

  const [messageDraft, setMessageDraft] = useState('');

  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [sendAtLocal, setSendAtLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [submitting, setSubmitting] = useState(false);

  // Compliance + deliverability report. Fetched whenever the recipient list or
  // send time changes, so a TCPA problem surfaces while the user is still
  // choosing a time rather than at the final click. The POST /schedule gate
  // runs the same checks and is authoritative.
  const [preflight, setPreflight] = useState<SmsPreflightReport | null>(null);
  // When true, recipients inside their local quiet period are HELD and go out
  // as each window opens, instead of the send being refused outright.
  const [deferQuietHours, setDeferQuietHours] = useState(false);

  // Keep the inline-editable message text in sync with the loaded draft.
  useEffect(() => {
    setMessageDraft(draft?.message || '');
  }, [draft?.message]);

  async function persistMessage(next: string) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/blasts/sms/${encodeURIComponent(draft.id)}`, {
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
    fetch(`/api/blasts/sms/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Blast not found');
          router.push('/messaging/blasts');
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
  // Resolved SERVER-side, over the whole contact roster.
  //
  // Previously this filtered `contacts` — the 5,000 most-recently-added
  // rows — which applied the per-campaign ceiling BEFORE the segment
  // filter rather than after it. A segment uncorrelated with recency
  // reached only the fraction of its members that happened to be recent,
  // with nothing in the UI indicating anyone was left out.
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [audienceTruncated, setAudienceTruncated] = useState(false);

  const selection = useMemo(() => audienceSelectionFromDraft(draft), [draft]);
  const selectionKey = useMemo(() => JSON.stringify(selection), [selection]);

  useEffect(() => {
    if (!draft || !accountKey || !selection) {
      setRecipients([]);
      setRecipientsLoading(false);
      return;
    }
    let cancelled = false;
    setRecipientsLoading(true);

    fetch('/api/segments/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountKey, selection, channel: 'sms' }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setRecipients(Array.isArray(data.recipients) ? data.recipients : []);
        setAudienceTotal(Number(data.total) || 0);
        setAudienceTruncated(Boolean(data.truncated));
      })
      .catch(() => {
        if (cancelled) return;
        setRecipients([]);
        setAudienceTotal(0);
        setAudienceTruncated(false);
      })
      .finally(() => {
        if (!cancelled) setRecipientsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `selectionKey` stands in for `selection` (fresh object each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, accountKey, draft?.id]);

  // The instant the send would actually happen, as the preflight sees it.
  const intendedSendAt = useMemo(() => {
    if (sendMode === 'now') return null;
    const d = new Date(sendAtLocal);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [sendMode, sendAtLocal]);

  useEffect(() => {
    if (!draft?.id || recipientsLoading || recipients.length === 0) return;
    let canceled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/blasts/sms/${encodeURIComponent(draft.id)}/preflight`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients,
              scheduledFor: intendedSendAt,
              deferOutsideQuietHours: deferQuietHours,
            }),
          },
        );
        if (!res.ok || canceled) return;
        const data = (await res.json()) as SmsPreflightReport;
        if (!canceled) setPreflight(data);
      } catch {
        // Advisory only — the send gate is authoritative.
      }
    })();
    return () => {
      canceled = true;
    };
  }, [draft?.id, recipients, recipientsLoading, intendedSendAt, deferQuietHours]);

  /**
   * Persist the deferral choice onto the blast, then re-run the gate.
   *
   * The flag has to live on the campaign rather than in component state: the
   * POST /schedule gate reads it from metadata, and the worker holds recipients
   * based on the same record long after this page is closed.
   */
  async function enableQuietHoursDeferral() {
    if (!draft) return;
    setDeferQuietHours(true);
    try {
      const existing = draft.metadata ? JSON.parse(draft.metadata) : {};
      const metadata = JSON.stringify({
        ...existing,
        deferOutsideQuietHours: true,
      });
      const res = await fetch(`/api/blasts/sms/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata }),
      });
      if (res.ok) setDraft((prev) => (prev ? { ...prev, metadata } : prev));
    } catch {
      toast.error('Could not save the send-window preference.');
    }
  }

  async function handleSchedule() {
    if (!draft) return;
    if (recipients.length === 0) {
      toast.error('No recipients with valid phone numbers.');
      return;
    }
    if (audienceTruncated) {
      toast.error(
        `This audience has ${audienceTotal.toLocaleString()} contacts, over the ${recipients.length.toLocaleString()} per-campaign limit. Narrow the segment and try again.`,
      );
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
        `/api/blasts/sms/${encodeURIComponent(draft.id)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients, scheduledFor }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The gate returns 422 with the full issue list — refresh the panel so
        // every blocker is visible, not just the summary in the toast.
        if (res.status === 422 && Array.isArray(data?.issues)) {
          setPreflight({
            ok: false,
            issues: data.issues,
            suggestedSendAt: data.suggestedSendAt ?? null,
            heldByQuietHours: data.heldByQuietHours ?? 0,
          });
        }
        throw new Error(data?.error || 'Failed to schedule campaign');
      }
      toast.success(
        sendMode === 'now'
          ? 'Blast queued — sending starts within ~1 minute.'
          : `Blast scheduled for ${formatDateTime(scheduledFor!)}`,
      );
      router.push('/messaging/blasts');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule campaign');
    } finally {
      setSubmitting(false);
    }
  }

  const smsBlockers = (preflight?.issues ?? []).filter((i) => i.severity === 'blocker');
  const smsWarnings = (preflight?.issues ?? []).filter((i) => i.severity === 'warning');
  const smsPreflightBlocked = smsBlockers.length > 0;
  // Only quiet hours has a one-click remedy; everything else needs a settings
  // or copy change, so the deferral buttons stay hidden for those.
  const quietHoursBlocking = smsBlockers.some((i) => i.code === 'quiet_hours');

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
          <h1 className="text-2xl font-bold">{draft?.name || 'Blast'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Review the message and choose when this blast should send.
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
                        onClick={() => router.push(`/messaging/blasts/sms/${encodeURIComponent(id)}/recipients`)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                      >
                        <PencilSquareIcon className="w-3 h-3" />
                        Change
                      </button>
                    </div>
                    <p className="text-2xl font-bold tabular-nums mt-0.5">
                      {recipientsLoading ? (
                        <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : audienceTruncated ? (
                        audienceTotal.toLocaleString()
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

      {/* Compliance + deliverability report */}
      {(smsBlockers.length > 0 || smsWarnings.length > 0) && (
        <div className="max-w-5xl mx-auto px-6 pb-4">
          <div
            className={`rounded-2xl border p-5 ${
              smsPreflightBlocked
                ? 'border-red-500/40 bg-red-500/[0.06]'
                : 'border-amber-500/40 bg-amber-500/[0.06]'
            }`}
          >
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  smsPreflightBlocked ? 'text-red-400' : 'text-amber-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  {smsPreflightBlocked
                    ? 'This blast can\u2019t send yet'
                    : 'Worth checking before you send'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {/* The TCPA line is specific to a quiet-hours block — it read
                      as a non-sequitur when the actual blocker was a missing
                      Twilio credential. */}
                  {!smsPreflightBlocked
                    ? 'These won\u2019t stop the send, but they affect cost or deliverability.'
                    : quietHoursBlocking
                      ? 'Texting outside the legal window carries statutory damages per message, so this has to be resolved first.'
                      : 'Each item below would stop this blast from reaching anyone, or get the sending number filtered by carriers.'}
                </p>

                <ul className="mt-3 space-y-2.5">
                  {[...smsBlockers, ...smsWarnings].map((issue, i) => (
                    <li key={`${issue.code}-${issue.accountKey}-${i}`} className="text-xs">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${
                          issue.severity === 'blocker' ? 'bg-red-400' : 'bg-amber-400'
                        }`}
                      />
                      <span className="text-[var(--foreground)]">{issue.message}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">{issue.remedy}</span>
                    </li>
                  ))}
                </ul>

                {/* The one-click way out of a quiet-hours block. Only offered
                    when quiet hours is actually what's blocking — the other
                    blockers need a settings or copy change instead. */}
                {quietHoursBlocking && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {preflight?.suggestedSendAt && (
                      <button
                        type="button"
                        onClick={() => {
                          setSendMode('later');
                          setSendAtLocal(toLocalInputValue(preflight.suggestedSendAt!));
                        }}
                        className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
                      >
                        <ClockIcon className="w-3.5 h-3.5" />
                        Move send to {formatDateTime(preflight.suggestedSendAt)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={enableQuietHoursDeferral}
                      className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/15"
                    >
                      <PaperAirplaneIcon className="w-3.5 h-3.5" />
                      Send each recipient at 8am their local time
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/blasts/sms/${encodeURIComponent(id)}/message`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton
            onClick={handleSchedule}
            disabled={
              submitting ||
              recipientsLoading ||
              // Never send an arbitrary prefix of an over-limit audience.
              audienceTruncated ||
              recipients.length === 0 ||
              !draft?.message?.trim() ||
              // Compliance gate. The server enforces this too; disabling the
              // button just avoids telling the user "no" only after they've
              // committed to a send time.
              smsPreflightBlocked
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
