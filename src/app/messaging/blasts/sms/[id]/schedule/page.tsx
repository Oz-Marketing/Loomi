'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
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
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import PrimaryButton from '@/components/primary-button';
import { Collapse } from '@/components/ui/collapse';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { BlastLockedNotice } from '@/components/campaigns/blast-locked-notice';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import {
  parseMetadataObject,
  restoreSchedule,
  scheduleInstantValue,
  useScheduleStepAutosave,
} from '@/lib/messaging/schedule-step-autosave';
import { isAudienceConfirmed, isEditableBlastStatus } from '@/lib/messaging/blast-builder-steps';
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

export default function SmsScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();
  const subHref = useSubaccountHref();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const locked = draft !== null && !isEditableBlastStatus(draft.status);

  const [messageDraft, setMessageDraft] = useState('');

  // The pickers edit a wall clock in the BROWSER's zone; it's named next to
  // them, and the account's own zone is spelled out when it differs.
  const browserZone = useMemo(() => browserTimeZone(), []);
  const [sendMode, setSendMode] = useState<SendMode>('later');
  const [sendAtLocal, setSendAtLocal] = useState(() => {
    const wall = wallClockInZone(new Date(Date.now() + 30 * 60_000), browserTimeZone());
    return `${wall.date}T${wall.time}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Compliance + deliverability report. Fetched whenever the audience or
  // send time changes, so a TCPA problem surfaces while the user is still
  // choosing a time rather than at the final click. The POST /schedule gate
  // runs the same checks and is authoritative.
  const [preflight, setPreflight] = useState<SmsPreflightReport | null>(null);
  // When true, recipients inside their local quiet period are HELD and go out
  // as each window opens, instead of the send being refused outright.
  const [deferQuietHours, setDeferQuietHours] = useState(false);

  // Restore "When should this send?" once per blast, then autosave it so
  // stepping back to Recipients or Message and returning keeps it.
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  useEffect(() => {
    if (!draft || hydratedId === draft.id) return;
    const saved = restoreSchedule(draft.metadata, new Date(), browserZone);
    if (saved) {
      setSendMode(saved.mode);
      if (saved.at) setSendAtLocal(saved.at);
    }
    setDeferQuietHours(parseMetadataObject(draft.metadata).deferOutsideQuietHours === true);
    setHydratedId(draft.id);
  }, [draft, hydratedId, browserZone]);

  // The instant the pickers name — stored as such (ISO), so a colleague in
  // another zone reopening the draft sees the same moment.
  const sendInstant = useMemo(
    () => instantFromWallClock(sendAtLocal.slice(0, 10), sendAtLocal.slice(11, 16), browserZone),
    [sendAtLocal, browserZone],
  );

  const autosave = useScheduleStepAutosave({
    endpoint: `/api/blasts/sms/${encodeURIComponent(id)}`,
    settings: {
      schedule: {
        mode: sendMode,
        at: scheduleInstantValue(sendAtLocal.slice(0, 10), sendAtLocal.slice(11, 16), browserZone),
      },
    },
    // A blast that isn't a draft must not change — so nothing autosaves.
    ready: hydratedId !== null && !locked,
    onSaved: (metadata) => setDraft((prev) => (prev ? { ...prev, metadata } : prev)),
  });

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
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load blast'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Blast not found');
          router.push(subHref('/messaging/blasts'));
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
  const audienceChosen = isAudienceConfirmed(draft);

  // How many people this blast would reach, resolved by the same server code
  // the schedule route runs. A count only; no phone numbers reach the page.
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [audienceReason, setAudienceReason] = useState<string | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(true);

  useEffect(() => {
    if (!draft?.id || locked) return;
    if (!audienceChosen) {
      setAudienceTotal(0);
      setAudienceLoading(false);
      return;
    }
    let cancelled = false;
    setAudienceLoading(true);
    fetch(`/api/blasts/sms/${encodeURIComponent(draft.id)}/audience`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return data as { total?: number; reason?: string };
      })
      .then((data) => {
        if (cancelled) return;
        setAudienceTotal(Number(data.total) || 0);
        setAudienceReason(typeof data.reason === 'string' && data.reason ? data.reason : null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAudienceTotal(0);
        setAudienceReason(`Couldn’t count recipients: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setAudienceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.id, audienceChosen, locked]);

  // The instant the send would actually happen, as the preflight sees it.
  const intendedSendAt = useMemo(() => {
    if (sendMode === 'now') return null;
    return sendInstant ? sendInstant.toISOString() : null;
  }, [sendMode, sendInstant]);

  useEffect(() => {
    if (!draft?.id || locked || audienceLoading || audienceTotal === 0) return;
    let canceled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/blasts/sms/${encodeURIComponent(draft.id)}/preflight`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // The route resolves the draft's saved audience itself — posting
            // the phone list would put a size limit on the audience.
            body: JSON.stringify({
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
  }, [draft?.id, locked, audienceTotal, audienceLoading, intendedSendAt, deferQuietHours]);

  /**
   * Persist the deferral choice onto the blast, then re-run the gate.
   *
   * The flag has to live on the campaign rather than in component state: the
   * POST /schedule gate reads it from metadata, and the worker holds recipients
   * based on the same record long after this page is closed. Sent as a merge,
   * so it can't overwrite metadata other steps keep.
   */
  async function enableQuietHoursDeferral() {
    if (!draft) return;
    setDeferQuietHours(true);
    try {
      const res = await fetch(`/api/blasts/sms/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadataPatch: { deferOutsideQuietHours: true } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      if (typeof data?.campaign?.metadata === 'string') {
        const metadata = data.campaign.metadata as string;
        setDraft((prev) => (prev ? { ...prev, metadata } : prev));
      }
    } catch {
      setDeferQuietHours(false);
      toast.error('Could not save the send-window preference.');
    }
  }

  async function handleSchedule() {
    if (!draft) return;
    if (!audienceChosen) {
      toast.error('Choose who should receive this blast on the Recipients step first.');
      return;
    }
    if (audienceTotal === 0) {
      toast.error(audienceReason || 'No recipients with valid phone numbers.');
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
      // No recipient list: the route resolves the audience the draft saved,
      // so an audience of any size never has to round-trip the browser. A
      // gateway timeout is checked against the blast rather than reported.
      const outcome = await submitSchedule({
        scheduleUrl: `/api/blasts/sms/${encodeURIComponent(draft.id)}/schedule`,
        blastUrl: `/api/blasts/sms/${encodeURIComponent(draft.id)}`,
        body: { scheduledFor },
        onWaiting: () => setConfirming(true),
      });
      if (!outcome.ok) {
        // The gate returns 422 with the full issue list — refresh the panel so
        // every blocker is visible, not just the summary in the toast.
        if (outcome.status === 422 && Array.isArray(outcome.data?.issues)) {
          setPreflight({
            ok: false,
            issues: outcome.data.issues as SmsPreflightIssue[],
            suggestedSendAt: (outcome.data.suggestedSendAt as string | null | undefined) ?? null,
            heldByQuietHours: Number(outcome.data.heldByQuietHours) || 0,
          });
        }
        throw new Error(outcome.error);
      }
      toast.success(
        sendMode === 'now'
          ? 'Blast queued — sending starts within ~1 minute.'
          : `Blast scheduled for ${formatDateTime(scheduledFor!)}`,
      );
      router.push(subHref('/messaging/blasts'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule blast');
    } finally {
      setSubmitting(false);
      setConfirming(false);
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
          Loading blast…
        </p>
      </div>
    );
  }

  if (draft && locked) {
    return <BlastLockedNotice status={draft.status} name={draft.name} />;
  }

  const smsMediaUrls = draft ? parseSmsMediaUrls(draft.metadata || '') : [];
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
            <BlastNameField id={id} channel="sms" variant="title" initialName={draft?.name ?? ''} />
          </h1>
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
                        onClick={() => router.push(subHref(`/messaging/blasts/sms/${encodeURIComponent(id)}/recipients`))}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                      >
                        <PencilSquareIcon className="w-3 h-3" />
                        {audienceChosen ? 'Change' : 'Choose'}
                      </button>
                    </div>
                    <p className="text-2xl font-bold tabular-nums mt-0.5">
                      {!audienceChosen ? (
                        <span className="text-sm font-normal text-[var(--muted-foreground)]">No recipients chosen yet</span>
                      ) : audienceLoading ? (
                        <ArrowPathIcon className="w-5 h-5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        audienceTotal.toLocaleString()
                      )}
                    </p>
                    {audienceChosen && !audienceLoading && audienceTotal === 0 && audienceReason && (
                      <p className="text-[11px] text-amber-400 mt-0.5 animate-fade-in-up">{audienceReason}</p>
                    )}
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
                    Routes through this account&apos;s Twilio connection.
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
                  ok={audienceChosen && audienceTotal > 0}
                  label={
                    audienceChosen
                      ? `${audienceTotal.toLocaleString()} sendable recipient${audienceTotal === 1 ? '' : 's'}`
                      : 'Recipients chosen'
                  }
                />
                <ChecklistItem
                  ok={Boolean(account)}
                  label="Account selected (SMS routes through its Twilio connection)"
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
        <div className="max-w-5xl mx-auto px-6 pb-4 animate-fade-in-up">
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
                    ? 'This blast can’t send yet'
                    : 'Worth checking before you send'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {/* The TCPA line is specific to a quiet-hours block — it read
                      as a non-sequitur when the actual blocker was a missing
                      Twilio credential. */}
                  {!smsPreflightBlocked
                    ? 'These won’t stop the send, but they affect cost or deliverability.'
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
                          const wall = wallClockInZone(new Date(preflight.suggestedSendAt!), browserZone);
                          setSendAtLocal(`${wall.date}T${wall.time}`);
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
            onClick={() => router.push(subHref(`/messaging/blasts/sms/${encodeURIComponent(id)}/message`))}
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
                audienceLoading ||
                !audienceChosen ||
                audienceTotal === 0 ||
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
