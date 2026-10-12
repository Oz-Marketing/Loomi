'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowPathRoundedSquareIcon,
  ChartBarSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { WarmupNotice } from '@/components/campaigns/warmup-notice';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import PrimaryButton from '@/components/primary-button';
import { Select } from '@/components/select';
import { Collapse } from '@/components/ui/collapse';
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
import { parseBlastMetadata } from '@/lib/messaging/blast-metadata';
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
  /** JSON-stringified array of Contact IDs for manual selection mode.
   *  Mutually exclusive with sourceListId and sourceAudienceId+sourceFilter. */
  sourceContactIds: string;
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

interface PreflightIssue {
  severity: 'blocker' | 'warning';
  code: string;
  accountKey: string;
  message: string;
  remedy: string;
}

interface PreflightReport {
  ok: boolean;
  issues: PreflightIssue[];
  /** No account selected yet, so nothing could be checked. */
  pending?: boolean;
}

interface ResendSettings {
  enabled: boolean;
  delayHours: number;
  subject: string;
}

const RESEND_DELAY_OPTIONS = [
  { value: '24', label: '24 hours' },
  { value: '48', label: '2 days' },
  { value: '72', label: '3 days' },
  { value: '120', label: '5 days' },
  { value: '168', label: '7 days' },
];

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

export default function ScheduleStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();
  const subHref = useSubaccountHref();
  const sendingSettingsHref = subHref('/settings/email-texts?section=sending');

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const locked = draft !== null && !isEditableBlastStatus(draft.status);

  // The pickers edit a wall clock in the BROWSER's zone; it's named next to
  // them, and the account's own zone is spelled out when it differs.
  const browserZone = useMemo(() => browserTimeZone(), []);

  const [sendMode, setSendMode] = useState<SendMode>('later');
  // Default to ~30m out so the input isn't pinned to "now" (which would
  // immediately fail the future-only validator on submit).
  const defaultSend = useMemo(
    () => wallClockInZone(new Date(Date.now() + 30 * 60_000), browserZone),
    [browserZone],
  );
  const [sendDate, setSendDate] = useState(defaultSend.date);
  const [sendTime, setSendTime] = useState(defaultSend.time);
  const [submitting, setSubmitting] = useState(false);
  // Set while we wait out a gateway timeout to learn whether the schedule took.
  const [confirming, setConfirming] = useState(false);

  // Inline-edit state for subject + preview text. These persist back to
  // the draft via PATCH on blur so users can tweak copy without bouncing
  // back to the editor.
  const [subjectDraft, setSubjectDraft] = useState('');
  const [previewTextDraft, setPreviewTextDraft] = useState('');

  // UTM + Resend live in the campaign's `metadata` JSON field. Hydrated
  // from the draft once it lands and autosaved as they change (see
  // useScheduleStepAutosave), so stepping back and returning keeps them.
  // The enabled flag also drives section expansion — see ToggleSection.
  const [utm, setUtm] = useState<UtmSettings>(defaultUtm(''));
  const [resend, setResend] = useState<ResendSettings>(defaultResend());

  // Deliverability + compliance report for this draft. Fetched on load so a
  // misconfigured account is visible BEFORE the user picks a send time —
  // the schedule POST runs the same checks and hard-blocks, and discovering
  // that at the final click is a miserable way to find out.
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);

  useEffect(() => {
    setSubjectDraft(draft?.subject || '');
    setPreviewTextDraft(draft?.previewText || '');
  }, [draft?.subject, draft?.previewText]);

  // Restore every setting on this step from the draft — once per blast.
  // Re-running on each `draft` change would let an autosave's echo overwrite
  // whatever the user typed while it was in flight.
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  useEffect(() => {
    if (!draft || hydratedId === draft.id) return;
    const meta = parseBlastMetadata(draft.metadata);
    const baseUtm = defaultUtm(draft.name || '');
    setUtm({ ...baseUtm, ...((meta.utm as Partial<UtmSettings> | undefined) ?? {}) });
    setResend({ ...defaultResend(), ...((meta.resend as Partial<ResendSettings> | undefined) ?? {}) });
    const saved = restoreSchedule(draft.metadata, new Date(), browserZone);
    if (saved) {
      setSendMode(saved.mode);
      if (saved.at) {
        setSendDate(saved.at.slice(0, 10));
        setSendTime(saved.at.slice(11, 16));
      }
    }
    setHydratedId(draft.id);
  }, [draft, hydratedId, browserZone]);

  // The instant the pickers name. Stored as such, so a colleague in another
  // zone reopening the draft sees the same moment, not the same digits.
  const sendInstant = useMemo(
    () => (sendDate && sendTime ? instantFromWallClock(sendDate, sendTime, browserZone) : null),
    [sendDate, sendTime, browserZone],
  );

  const autosave = useScheduleStepAutosave({
    endpoint: `/api/blasts/email/${encodeURIComponent(id)}`,
    settings: {
      schedule: { mode: sendMode, at: scheduleInstantValue(sendDate, sendTime, browserZone) },
      utm,
      resend,
    },
    // A blast that isn't a draft must not change — so nothing autosaves.
    ready: hydratedId !== null && !locked,
    onSaved: (metadata) => setDraft((prev) => (prev ? { ...prev, metadata } : prev)),
  });

  useEffect(() => {
    if (!draft?.id || locked) return;
    let canceled = false;
    const accountKey = draft.accountKeys?.[0] || '';
    const qs = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    (async () => {
      try {
        const res = await fetch(
          `/api/blasts/email/${encodeURIComponent(draft.id)}/preflight${qs}`,
        );
        if (!res.ok || canceled) return;
        const data = (await res.json()) as PreflightReport;
        if (!canceled) setPreflight(data);
      } catch {
        // Advisory only — the send gate is authoritative.
      }
    })();
    return () => {
      canceled = true;
    };
  }, [draft?.id, draft?.accountKeys, locked]);

  async function persistField(patch: { subject?: string; previewText?: string }) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/blasts/email/${encodeURIComponent(draft.id)}`, {
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
    (async () => {
      try {
        const res = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('Failed to load blast');
        const data: { campaign?: DraftCampaign } = await res.json();
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Blast not found');
          router.push(subHref('/messaging/blasts'));
          return;
        }
        // Re-sync the preview from the template's latest content. The editor
        // saves edits to the template record (not the blast), so arriving
        // here straight from the editor's Schedule button would otherwise show
        // the stale snapshot. Drafts only — a scheduled or sent blast keeps
        // the html it was committed with (and this page shows it locked).
        // If the re-sync can't be saved, the STORED html stays on screen:
        // previewing html the send won't use is the failure this prevents.
        const synced = await syncEmailDraftFromTemplate(data.campaign);
        if (cancelled) return;
        if (synced.error) {
          toast.error(
            `Couldn’t refresh this email from its template, so the last saved version is shown. ${synced.error}`,
          );
        }
        setDraft(synced.draft);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load blast');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;
  const audienceChosen = isAudienceConfirmed(draft);

  // How many people this blast would reach, resolved by the same server code
  // the schedule route runs — so this number and the send agree by
  // construction. A count only; no contact rows reach the browser.
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
    fetch(`/api/blasts/email/${encodeURIComponent(draft.id)}/audience`, { cache: 'no-store' })
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

  async function handleSchedule() {
    if (!draft) return;
    if (!audienceChosen) {
      toast.error('Choose who should receive this blast on the Recipients step first.');
      return;
    }
    if (audienceTotal === 0) {
      toast.error(audienceReason || 'No recipients to send to.');
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
      // Finish any pending autosave, then write this step's settings once
      // more so the schedule reads exactly what's on screen. Merged into the
      // stored metadata server-side, so keys other steps own survive.
      await autosave.flush().catch(() => undefined);
      const patchRes = await fetch(`/api/blasts/email/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadataPatch: {
            utm,
            resend,
            schedule: { mode: sendMode, at: scheduleInstantValue(sendDate, sendTime, browserZone) },
          },
        }),
      });
      if (!patchRes.ok) {
        const patchData = await patchRes.json().catch(() => ({}));
        throw new Error(patchData?.error || 'Failed to save tracking settings');
      }

      // No recipient list: the route resolves the audience the draft saved,
      // so an audience of any size never has to round-trip the browser. A
      // large one can outlast the proxy's 60s; submitSchedule then checks
      // whether the blast committed rather than reporting a failure.
      const outcome = await submitSchedule({
        scheduleUrl: `/api/blasts/email/${encodeURIComponent(draft.id)}/schedule`,
        blastUrl: `/api/blasts/email/${encodeURIComponent(draft.id)}`,
        body: { scheduledFor },
        onWaiting: () => setConfirming(true),
      });
      if (!outcome.ok) {
        // The preflight gate returns 422 with the full issue list — refresh
        // the panel so the user sees every blocker, not just the summary.
        if (outcome.status === 422 && Array.isArray(outcome.data?.issues)) {
          setPreflight({ ok: false, issues: outcome.data.issues as PreflightIssue[] });
        }
        throw new Error(outcome.error);
      }
      toast.success(
        sendMode === 'now'
          ? 'Blast queued — will start sending in the next minute.'
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

  // Exactly what the send puts in the From header — see blast-sender.
  const fromLine = formatFromLine(account);
  const fromEmail = account?.senderEmail || '';

  const blockers = (preflight?.issues ?? []).filter((i) => i.severity === 'blocker');
  const warnings = (preflight?.issues ?? []).filter((i) => i.severity === 'warning');
  const preflightBlocked = blockers.length > 0;

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
            <BlastNameField id={id} channel="email" variant="title" initialName={draft?.name ?? ''} />
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Review the email and choose when this blast should send.
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

              {!audienceLoading && audienceTotal > 0 && accountKey && (
                <WarmupNotice accountKey={accountKey} recipientCount={audienceTotal} />
              )}

              <Collapse open={sendMode === 'later'} mountClosed={false} clip={false}>
                <div className="mt-5 pt-5 border-t border-[var(--border)]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                        Send Date
                      </label>
                      <DatePicker
                        value={sendDate || null}
                        onChange={(v) => setSendDate(v ?? '')}
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
                        value={sendTime || null}
                        onChange={setSendTime}
                        className="w-full inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--foreground)] hover:border-[var(--primary)]/40 focus:outline-none focus:border-[var(--primary)] transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                    {sendInstant
                      ? `Will send ${formatDateTime(sendInstant.toISOString())}.`
                      : 'Pick a date and time to schedule the send.'}
                    {accountEquivalent && (
                      <span className="text-[var(--foreground)]">
                        {' '}That’s {accountEquivalent} for this account.
                      </span>
                    )}
                  </p>
                </div>
              </Collapse>
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
                  label="Blast"
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
                  <Select
                    value={String(resend.delayHours)}
                    onChange={(v) => setResend((r) => ({ ...r, delayHours: Number(v) }))}
                    options={
                      RESEND_DELAY_OPTIONS.some((o) => o.value === String(resend.delayHours))
                        ? RESEND_DELAY_OPTIONS
                        : [...RESEND_DELAY_OPTIONS, { value: String(resend.delayHours), label: `${resend.delayHours} hours` }]
                    }
                    ariaLabel="Follow-up delay"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                    Resend subject <span className="font-normal lowercase">(optional override)</span>
                  </label>
                  <input
                    type="text"
                    value={resend.subject}
                    onChange={(e) => setResend((r) => ({ ...r, subject: e.target.value }))}
                    // Left blank, the follow-up goes out under the original
                    // subject — so that's what the placeholder shows. It used
                    // to show "Reminder: …", a subject nothing would send.
                    placeholder={draft?.subject || 'Leave blank to reuse the email’s subject'}
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
                      {!audienceChosen ? (
                        <span className="text-[var(--muted-foreground)] font-normal">No recipients chosen yet</span>
                      ) : audienceLoading ? (
                        <ArrowPathIcon className="w-3.5 h-3.5 inline animate-spin text-[var(--muted-foreground)]" />
                      ) : (
                        `${audienceTotal.toLocaleString()} recipient${audienceTotal === 1 ? '' : 's'}`
                      )}
                    </p>
                    {audienceChosen && !audienceLoading && audienceTotal === 0 && audienceReason && (
                      <p className="text-[11px] text-amber-400 mt-0.5 animate-fade-in-up">{audienceReason}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(subHref(`/messaging/blasts/${encodeURIComponent(id)}/recipients`))}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline whitespace-nowrap"
                >
                  <PencilSquareIcon className="w-3 h-3" />
                  {audienceChosen ? 'Change' : 'Choose'}
                </button>
              </div>
              <div className="flex items-start gap-2.5 mt-2 pt-2 border-t border-[var(--border)] min-w-0">
                <EnvelopeIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] leading-tight">
                    From
                  </p>
                  {fromEmail ? (
                    <p className="text-xs font-medium truncate">{fromLine}</p>
                  ) : (
                    <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                      <Link
                        href={sendingSettingsHref}
                        className="italic text-[var(--primary)] hover:underline"
                      >
                        Configure in Sending settings →
                      </Link>
                    </p>
                  )}
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
                  ok={audienceChosen && audienceTotal > 0}
                  label={
                    audienceChosen
                      ? `${audienceTotal.toLocaleString()} sendable recipient${audienceTotal === 1 ? '' : 's'}`
                      : 'Recipients chosen'
                  }
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

      {/* Deliverability + compliance report */}
      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="max-w-7xl mx-auto px-6 pb-4 animate-fade-in-up">
          <div
            className={`rounded-2xl border p-5 ${
              preflightBlocked
                ? 'border-red-500/40 bg-red-500/[0.06]'
                : 'border-amber-500/40 bg-amber-500/[0.06]'
            }`}
          >
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  preflightBlocked ? 'text-red-400' : 'text-amber-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  {preflightBlocked
                    ? 'This blast can’t send yet'
                    : 'Worth checking before you send'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {preflightBlocked
                    ? 'Each item below would push this email into spam folders or breach CAN-SPAM.'
                    : 'These won’t stop the send, but fixing them improves inbox placement.'}
                </p>

                <ul className="mt-3 space-y-2.5">
                  {[...blockers, ...warnings].map((issue, i) => (
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
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(subHref(`/messaging/blasts/${encodeURIComponent(id)}/template`))}
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
                !draft?.subject?.trim() ||
                !draft?.htmlContent?.trim() ||
                // Deliverability gate. The server enforces this too; disabling
                // the button just means the user isn't told "no" only after
                // committing to a send time.
                preflightBlocked
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
      className={`glass-section-card rounded-2xl border transition-colors ${
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
      {/* Not clipped: the follow-up delay's dropdown has to escape the box. */}
      <Collapse open={enabled} mountClosed={false} clip={false}>
        <div className="px-5 pb-5 pt-4 border-t border-[var(--border)]">
          {children}
        </div>
      </Collapse>
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
