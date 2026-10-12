'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { WarmupNotice } from '@/components/campaigns/warmup-notice';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import PrimaryButton from '@/components/primary-button';
import { Collapse } from '@/components/ui/collapse';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { BlastLockedNotice } from '@/components/campaigns/blast-locked-notice';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import {
  restoreSchedule,
  scheduleInstantValue,
  useScheduleStepAutosave,
} from '@/lib/messaging/schedule-step-autosave';
import { isAudienceConfirmed, isEditableBlastStatus } from '@/lib/messaging/blast-builder-steps';
import { readLinkedSmsId } from '@/lib/messaging/blast-metadata';
import { formatFromLine } from '@/lib/messaging/blast-sender';
import { syncEmailDraftFromTemplate } from '@/lib/messaging/blast-template';
import { submitSchedule } from '@/lib/messaging/schedule-submit';
import {
  accountLocalEquivalent,
  browserTimeZone,
  instantFromWallClock,
  timeZoneLabel,
  wallClockInZone,
} from '@/lib/messaging/send-time';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface EmailDraft {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  subject: string;
  previewText: string;
  htmlContent: string;
  sourceFilter: string;
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual selection mode. */
  sourceContactIds: string;
  metadata: string;
}

interface SmsDraft {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  message: string;
  sourceFilter: string;
  sourceListId: string;
  /** JSON-stringified array of Contact IDs for manual selection mode. */
  sourceContactIds: string;
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

/** "Tue, Oct 14, 2026, 9:00 AM MDT" — with the zone, so nobody has to guess. */
function formatDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value
    .toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
    .replace(/ /g, ' ');
}

/** `{ total, reason }` from a blast's audience endpoint. */
async function fetchAudienceTotal(url: string): Promise<{ total: number; reason: string | null }> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { total?: number; reason?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return {
    total: Number(data.total) || 0,
    reason: typeof data.reason === 'string' && data.reason ? data.reason : null,
  };
}

export default function MultiScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();
  const subHref = useSubaccountHref();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [loading, setLoading] = useState(true);

  // Either half past draft locks the pair — they're scheduled as one.
  const lockedDraft =
    emailDraft && !isEditableBlastStatus(emailDraft.status)
      ? emailDraft
      : smsDraft && !isEditableBlastStatus(smsDraft.status)
        ? smsDraft
        : null;

  // The pickers edit a wall clock in the BROWSER's zone; it's named next to
  // them, and the account's own zone is spelled out when it differs.
  const browserZone = useMemo(() => browserTimeZone(), []);
  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [previewTab, setPreviewTab] = useState<'email' | 'sms'>('email');
  const [sendAtLocal, setSendAtLocal] = useState(() => {
    const wall = wallClockInZone(new Date(Date.now() + 30 * 60_000), browserTimeZone());
    return `${wall.date}T${wall.time}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Restore "When should this send?" once per blast, then autosave it so
  // stepping back to Recipients or Message and returning keeps it.
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  useEffect(() => {
    if (!emailDraft || hydratedId === emailDraft.id) return;
    const saved = restoreSchedule(emailDraft.metadata, new Date(), browserZone);
    if (saved) {
      setSendMode(saved.mode);
      if (saved.at) setSendAtLocal(saved.at);
    }
    setHydratedId(emailDraft.id);
  }, [emailDraft, hydratedId, browserZone]);

  const sendInstant = useMemo(
    () => instantFromWallClock(sendAtLocal.slice(0, 10), sendAtLocal.slice(11, 16), browserZone),
    [sendAtLocal, browserZone],
  );

  const autosave = useScheduleStepAutosave({
    endpoint: `/api/blasts/email/${encodeURIComponent(id)}`,
    settings: {
      schedule: {
        mode: sendMode,
        at: scheduleInstantValue(sendAtLocal.slice(0, 10), sendAtLocal.slice(11, 16), browserZone),
      },
    },
    // A pair that isn't a draft must not change — so nothing autosaves.
    ready: hydratedId !== null && !lockedDraft,
    onSaved: (metadata) => setEmailDraft((prev) => (prev ? { ...prev, metadata } : prev)),
  });

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
        let email = emailData.campaign as EmailDraft;
        const smsId = readLinkedSmsId(email.metadata || '');
        if (!smsId) throw new Error('Linked SMS draft missing');
        const smsRes = await fetch(`/api/blasts/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        const sms = smsData.campaign as SmsDraft;

        // Re-sync the email from its template — arriving from the editor's
        // Done, the stored html is otherwise a stale snapshot, and this pair
        // never re-synced at all. Drafts only; a failed save keeps the stored
        // html on screen rather than previewing one the send won't use.
        if (isEditableBlastStatus(email.status) && isEditableBlastStatus(sms.status)) {
          const synced = await syncEmailDraftFromTemplate(email);
          if (synced.error) {
            toast.error(
              `Couldn’t refresh the email from its template, so the last saved version is shown. ${synced.error}`,
            );
          }
          email = synced.draft;
        }
        if (cancelled) return;
        setEmailDraft(email);
        setSmsDraft(sms);
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

  const accountKey = emailDraft?.accountKeys[0] || smsDraft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;
  // The Recipients step confirms the pair on both halves; the header reads the
  // email half, so that's the one this step trusts too.
  const audienceChosen = isAudienceConfirmed(emailDraft) && isAudienceConfirmed(smsDraft);

  // Both halves counted by the same server code the schedule route runs, so
  // these numbers and the send agree by construction. Counts only.
  const [emailTotal, setEmailTotal] = useState(0);
  const [smsTotal, setSmsTotal] = useState(0);
  const [audienceReason, setAudienceReason] = useState<string | null>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(true);

  useEffect(() => {
    if (!emailDraft?.id || !smsDraft?.id || lockedDraft) return;
    if (!audienceChosen) {
      setEmailTotal(0);
      setSmsTotal(0);
      setRecipientsLoading(false);
      return;
    }
    let cancelled = false;
    setRecipientsLoading(true);
    Promise.all([
      fetchAudienceTotal(`/api/blasts/email/${encodeURIComponent(emailDraft.id)}/audience`),
      fetchAudienceTotal(`/api/blasts/sms/${encodeURIComponent(smsDraft.id)}/audience`),
    ])
      .then(([email, sms]) => {
        if (cancelled) return;
        setEmailTotal(email.total);
        setSmsTotal(sms.total);
        setAudienceReason(email.reason || sms.reason);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setEmailTotal(0);
        setSmsTotal(0);
        setAudienceReason(`Couldn’t count recipients: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setRecipientsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [emailDraft?.id, smsDraft?.id, audienceChosen, lockedDraft]);

  async function handleSchedule() {
    if (!emailDraft || !smsDraft) return;
    if (!audienceChosen) {
      toast.error('Choose who should receive this blast on the Recipients step first.');
      return;
    }
    if (emailTotal === 0 || smsTotal === 0) {
      toast.error(
        audienceReason ||
          (emailTotal === 0
            ? 'No one in this audience has an email address.'
            : 'No one in this audience has a textable phone number.'),
      );
      return;
    }
    let scheduledFor: string | null = null;
    if (sendMode === 'later') {
      if (!sendInstant) {
        toast.error('Pick a valid send date and time.');
        return;
      }
      if (sendInstant.getTime() <= Date.now() + 30_000) {
        toast.error('Send time must be in the future.');
        return;
      }
      scheduledFor = sendInstant.toISOString();
    }

    setSubmitting(true);
    try {
      await autosave.flush().catch(() => undefined);
      // One request schedules both halves together — the route runs both
      // gates and commits the pair in a single transaction, so it is either
      // fully scheduled or still two drafts. Each half's audience is the one
      // its draft saved, resolved on the server. A gateway timeout is checked
      // against the email half (committed in the same transaction).
      const outcome = await submitSchedule({
        scheduleUrl: `/api/blasts/multi/${encodeURIComponent(emailDraft.id)}/schedule`,
        blastUrl: `/api/blasts/email/${encodeURIComponent(emailDraft.id)}`,
        body: { scheduledFor },
        onWaiting: () => setConfirming(true),
      });
      if (!outcome.ok) throw new Error(outcome.error);
      toast.success(
        sendMode === 'now'
          ? 'Both channels queued — sending starts within ~1 minute.'
          : `Scheduled both channels for ${formatDateTime(scheduledFor!)}`,
      );
      router.push(subHref('/messaging/blasts'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule blast');
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
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

  // Exactly what the send puts in the From header — see blast-sender.
  const fromLine = formatFromLine(account);
  const fromEmail = account?.senderEmail || '';
  const zoneLabel = timeZoneLabel(browserZone, sendInstant ?? new Date());
  const accountEquivalent = sendInstant
    ? accountLocalEquivalent(sendInstant, account?.timezone, browserZone)
    : null;

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Schedule
          </p>
          <h1>
            <BlastNameField id={id} channel="multi" variant="title" initialName={emailDraft?.name ?? ''} />
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Both the email and SMS fire at the same time once you schedule.
          </p>
        </div>

        {/* Two-column layout:
            - Left:  When-to-send (top), Summary (bottom).
            - Right (sticky): Pre-flight checklist (top), tabbed
              Email / SMS preview (bottom). */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] gap-6 items-start">
          <div className="space-y-5 min-w-0">
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

              {!recipientsLoading && emailTotal > 0 && accountKey && (
                <WarmupNotice accountKey={accountKey} recipientCount={emailTotal} />
              )}

              <Collapse open={sendMode === 'later'} mountClosed={false} clip={false}>
                <div className="mt-5 pt-5 border-t border-[var(--border)]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                        Send Date
                      </label>
                      <DatePicker
                        value={sendAtLocal.slice(0, 10) || null}
                        onChange={(v) =>
                          setSendAtLocal(v ? `${v}T${sendAtLocal.slice(11, 16) || '09:00'}` : '')
                        }
                        minDate={wallClockInZone(new Date(), browserZone).date}
                        placeholder="Select date"
                        className="w-full inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--foreground)] hover:border-[var(--primary)]/40 focus:outline-none focus:border-[var(--primary)] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                        Send Time{' '}
                        <span className="normal-case tracking-normal font-normal">({zoneLabel})</span>
                      </label>
                      <TimePicker
                        value={sendAtLocal.slice(11, 16) || null}
                        onChange={(t) =>
                          setSendAtLocal(
                            `${sendAtLocal.slice(0, 10) || wallClockInZone(new Date(), browserZone).date}T${t}`,
                          )
                        }
                        className="w-full inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--foreground)] hover:border-[var(--primary)]/40 focus:outline-none focus:border-[var(--primary)] transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                    {sendInstant ? `Will send ${formatDateTime(sendInstant.toISOString())}.` : 'Pick a date and time.'}
                    {accountEquivalent && (
                      <span className="text-[var(--foreground)]">
                        {' '}That’s {accountEquivalent} for this account.
                      </span>
                    )}
                  </p>
                </div>
              </Collapse>
            </div>

            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">
                Summary
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <ChannelStat
                    icon={EnvelopeIcon}
                    label="Email"
                    count={emailTotal}
                    loading={recipientsLoading}
                  />
                  <ChannelStat
                    icon={ChatBubbleLeftRightIcon}
                    label="SMS"
                    count={smsTotal}
                    loading={recipientsLoading}
                  />
                </div>
                {!audienceChosen ? (
                  <p className="text-[11px] text-amber-400 animate-fade-in-up">
                    No recipients chosen yet —{' '}
                    <button
                      type="button"
                      onClick={() => router.push(subHref(`/messaging/blasts/multi/${encodeURIComponent(id)}/recipients`))}
                      className="underline hover:no-underline"
                    >
                      choose them on the Recipients step
                    </button>
                    .
                  </p>
                ) : (
                  !recipientsLoading &&
                  (emailTotal === 0 || smsTotal === 0) &&
                  audienceReason && (
                    <p className="text-[11px] text-amber-400 animate-fade-in-up">{audienceReason}</p>
                  )
                )}

                <div className="flex items-start gap-3 pt-3 border-t border-[var(--border)]">
                  <div className="w-9 h-9 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center flex-shrink-0">
                    <UsersIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Account
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

          {/* Right (sticky): pre-flight checklist (top), tabbed preview (bottom). */}
          <div className="lg:sticky lg:top-20 space-y-5">
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
                  ok={audienceChosen && emailTotal > 0 && smsTotal > 0}
                  label={
                    audienceChosen
                      ? `Both channels have recipients (${emailTotal.toLocaleString()} email · ${smsTotal.toLocaleString()} SMS)`
                      : 'Recipients chosen'
                  }
                />
              </ul>
              {fromEmail && (
                <p className="text-[11px] text-[var(--muted-foreground)] mt-3 border-t border-[var(--border)] pt-3">
                  Email sends from <strong className="text-[var(--foreground)]">{fromLine}</strong>.
                  SMS routes through this account&apos;s Twilio connection.
                </p>
              )}
            </div>

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
              <div key={previewTab} className="bg-[var(--muted)]/30 p-4 animate-fade-in-up">
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
            onClick={() => router.push(subHref(`/messaging/blasts/multi/${encodeURIComponent(id)}/message`))}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-4 min-w-0">
            {confirming && (
              <p className="text-xs text-[var(--muted-foreground)] animate-fade-in-up">
                Still working — checking whether the schedule went through…
              </p>
            )}
            <PrimaryButton
              onClick={handleSchedule}
              disabled={
                submitting ||
                recipientsLoading ||
                !audienceChosen ||
                // The pair goes out together or not at all — see the route.
                emailTotal === 0 ||
                smsTotal === 0 ||
                // The same content the server's gates require; disabling here
                // just means the user isn't refused only after clicking.
                !emailDraft?.subject?.trim() ||
                !emailDraft?.htmlContent?.trim() ||
                !smsDraft?.message?.trim()
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
        className={`w-4 h-4 mt-0.5 flex-shrink-0 transition-colors ${
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
