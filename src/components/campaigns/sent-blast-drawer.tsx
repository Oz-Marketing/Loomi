'use client';

// Sent-campaign detail drawer. Slides in from the right when a row that
// has already gone out is clicked — sent or 'failed'. Renders
// campaign-scoped KPIs (sent / delivered / opens / clicks / bounces /
// unsubs) plus an email or SMS preview alongside, and — only for a blast
// that sent nothing at all — the error the send worker recorded. A blast
// that reached anyone is simply sent: undeliverable addresses are counted
// as bounces and suppressed, never raised as an error. Sent campaigns are
// read-only — there's no edit affordance here.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  XMarkIcon,
  EnvelopeOpenIcon,
  CursorArrowRaysIcon,
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';

// ── Types ──

interface CampaignSummary {
  id: string;
  campaignId?: string;
  name: string;
  status: string;
  provider?: string;
  channel?: 'email' | 'sms' | 'multi';
  sentAt?: string;
  scheduledAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface EngagementRow {
  campaignId: string;
  campaignName: string | null;
  sentAt: string | null;
  sent: number;
  delivered: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  bounces: number;
  dropped: number;
  spamReports: number;
  unsubscribes: number;
  skipped: number;
  failed: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}

interface EmailBlastDetail {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  htmlContent: string;
  /** Recipients the worker hard-failed on. */
  failedCount: number;
  totalRecipients: number;
  /** First recipient error the worker recorded, if any. */
  error: string;
}

interface SmsBlastDetail {
  id: string;
  name: string;
  message: string;
  failedCount: number;
  /** Twilio took it, a carrier refused it. Not a send failure. */
  undeliveredCount: number;
  sentCount: number;
  totalRecipients: number;
  error: string;
}

/**
 * What a terminal blast status means in the header, in plain words. `verb`
 * prefixes the timestamp line — a failed blast was never "Sent <date>".
 */
function describeStatus(status: string): { label: string; tone: string; verb: string } {
  const s = (status || '').toLowerCase().trim();
  if (s === 'failed') return { label: 'Failed', tone: 'text-red-400', verb: 'Attempted' };
  if (s === 'canceled' || s === 'cancelled') {
    return { label: 'Canceled', tone: 'text-red-400', verb: 'Canceled' };
  }
  return { label: 'Sent', tone: 'text-green-400', verb: 'Sent' };
}

interface SentBlastDrawerProps {
  open: boolean;
  campaign: CampaignSummary | null;
  onClose: () => void;
  /**
   * The account the list is showing, when it is showing one. A blast can span
   * several accounts; passing the same key the list row was counted with keeps
   * the drawer's numbers equal to the row's. Omitted, the server scopes to the
   * viewer's own accounts (or the whole blast for unscoped staff).
   */
  accountKey?: string | null;
}

/**
 * What each email tile counts, shown in a tooltip by its label. The same
 * definitions as lib/services/email-analytics.ts, in plain words.
 */
const EMAIL_KPI_HINTS = {
  sent: 'Messages SendGrid accepted for delivery, including any that bounced afterwards. Skipped and failed recipients are not included.',
  delivered: "Confirmed by the recipient's mail server, as a share of sent. A message that bounced after delivery counts as bounced, not delivered.",
  openRate: 'People who opened, as a share of delivered. Each person counts once, and automatic opens by mail privacy features are not counted.',
  clickRate: 'People who clicked a link, as a share of delivered. Each person counts once.',
  bounced: "Refused by the recipient's mail server, or dropped by SendGrid before sending, as a share of sent. Each bounced address is suppressed automatically.",
  unsubscribes: 'People who unsubscribed, as a share of delivered.',
} as const;

// ── Helpers ──

function pct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function num(value: number): string {
  return value.toLocaleString();
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function getChannel(c: CampaignSummary): 'email' | 'sms' | 'multi' {
  if (c.channel) return c.channel;
  const provider = (c.provider || '').toLowerCase();
  if (provider === 'loomi-sms') return 'sms';
  return 'email';
}

// ── Component ──

export function SentBlastDrawer({ open, campaign, onClose, accountKey }: SentBlastDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [engagement, setEngagement] = useState<EngagementRow | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementError, setEngagementError] = useState<string | null>(null);

  const [emailDetail, setEmailDetail] = useState<EmailBlastDetail | null>(null);
  const [smsDetail, setSmsDetail] = useState<SmsBlastDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previousFocusRef = useRef<HTMLElement | null>(null);

  const channel = campaign ? getChannel(campaign) : 'email';
  const campaignId = campaign?.campaignId || campaign?.id || '';

  // Drawer slide-in/out: mount slightly before to allow the transition,
  // unmount on a delay after close so the slide-out animation runs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      previousFocusRef.current = (document.activeElement as HTMLElement) || null;
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Restore focus when the drawer closes so keyboard users land back on
  // the row they activated.
  useEffect(() => {
    if (!open && previousFocusRef.current) {
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      window.setTimeout(() => target.focus({ preventScroll: true }), 0);
    }
  }, [open]);

  // Fetch engagement metrics. Only email campaigns currently emit
  // engagement events (SMS engagement isn't wired up yet), so we skip
  // the call for SMS / multi-channel rows and surface a friendlier
  // empty state in the KPI block.
  useEffect(() => {
    if (!open || !campaignId) return;
    if (channel === 'sms') {
      setEngagement(null);
      setEngagementError(null);
      setEngagementLoading(false);
      return;
    }
    let cancelled = false;
    setEngagementLoading(true);
    setEngagementError(null);
    const scopeQuery = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    fetch(`/api/blasts/loomi/engagement/${encodeURIComponent(campaignId)}${scopeQuery}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ campaign: EngagementRow | null }>;
      })
      .then((data) => {
        if (!cancelled) setEngagement(data.campaign);
      })
      .catch((err) => {
        if (!cancelled) {
          setEngagementError(err instanceof Error ? err.message : 'Failed to load metrics');
        }
      })
      .finally(() => {
        if (!cancelled) setEngagementLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, campaignId, channel, accountKey]);

  // Fetch the preview payload. Email -> HTML for iframe; SMS -> raw
  // message text. Multi-channel campaigns are anchored on the email
  // half, so we treat them as email here.
  useEffect(() => {
    if (!open || !campaignId) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setEmailDetail(null);
    setSmsDetail(null);

    const url =
      channel === 'sms'
        ? `/api/blasts/sms/${encodeURIComponent(campaignId)}`
        : `/api/blasts/email/${encodeURIComponent(campaignId)}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: { campaign?: Partial<EmailBlastDetail & SmsBlastDetail> }) => {
        if (cancelled) return;
        if (!data.campaign) {
          setPreviewError('Blast not found.');
          return;
        }
        if (channel === 'sms') {
          setSmsDetail({
            id: data.campaign.id || campaignId,
            name: data.campaign.name || '',
            message: data.campaign.message || '',
            failedCount: data.campaign.failedCount ?? 0,
            undeliveredCount: data.campaign.undeliveredCount ?? 0,
            sentCount: data.campaign.sentCount ?? 0,
            totalRecipients: data.campaign.totalRecipients ?? 0,
            error: data.campaign.error || '',
          });
        } else {
          setEmailDetail({
            id: data.campaign.id || campaignId,
            name: data.campaign.name || '',
            subject: data.campaign.subject || '',
            previewText: data.campaign.previewText || '',
            htmlContent: data.campaign.htmlContent || '',
            failedCount: data.campaign.failedCount ?? 0,
            totalRecipients: data.campaign.totalRecipients ?? 0,
            error: data.campaign.error || '',
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Failed to load preview');
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, campaignId, channel]);

  const previewHtml = useMemo(() => {
    if (!emailDetail) return '';
    const preview = emailDetail.previewText?.trim();
    if (!preview) return emailDetail.htmlContent;
    // Inject preview text once so the iframe matches inbox rendering.
    const previewBlock = `<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${preview}</div>`;
    if (/<body[\s>]/i.test(emailDetail.htmlContent)) {
      return emailDetail.htmlContent.replace(/<body([^>]*)>/i, `<body$1>${previewBlock}`);
    }
    return previewBlock + emailDetail.htmlContent;
  }, [emailDetail]);

  // Failure summary — ONLY for a blast that sent nothing at all. A blast
  // that reached anyone was sent; recipients it could not reach are bad
  // addresses, counted with the bounces and suppressed, and there is nothing
  // for the reader to do about them.
  const detail = channel === 'sms' ? smsDetail : emailDetail;
  const failureSummary = useMemo(() => {
    const status = (campaign?.status || '').toLowerCase().trim();
    if (status !== 'failed') return null;
    return { headline: 'This blast failed to send.', detail: detail?.error?.trim() || null };
  }, [campaign?.status, detail]);

  if (!mounted && !open) return null;

  const channelLabel =
    channel === 'sms' ? 'SMS' : channel === 'multi' ? 'Email + SMS' : 'Email';
  const statusInfo = describeStatus(campaign?.status || '');

  return (
    <div
      className={`fixed inset-0 z-[140] flex justify-end transition-[background-color] duration-300 ${
        open ? 'bg-black/40 backdrop-blur-[2px]' : 'pointer-events-none bg-black/0'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Campaign details"
    >
      <div
        className={`glass-modal w-[920px] max-w-[96vw] h-full flex flex-col overflow-hidden transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {channel === 'sms' ? (
                <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
              ) : (
                <EnvelopeIcon className="w-3.5 h-3.5" />
              )}
              <span>{channelLabel} Blast</span>
              <span>·</span>
              <span className={statusInfo.tone}>{statusInfo.label}</span>
            </div>
            <h2 className="text-base font-semibold mt-1 truncate">
              {campaign?.name || '(Untitled campaign)'}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {statusInfo.verb} {formatDateTime(campaign?.sentAt || campaign?.updatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Failure banner — only for a blast that sent nothing. */}
          {failureSummary && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-300">
                    {failureSummary.headline}
                  </p>
                  {failureSummary.detail && (
                    <p className="text-xs text-amber-200/80 mt-1 break-words">
                      {failureSummary.detail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* KPI block */}
          <section>
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Performance
            </h3>
            {channel === 'sms' ? (
              <div className="space-y-3">
                {/* Opens and clicks don't exist for SMS, but delivery does —
                    and it's the half that used to be reported only as an
                    error banner. */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <KpiTile
                    icon={PaperAirplaneIcon}
                    label="Sent"
                    primary={num(smsDetail?.sentCount ?? 0)}
                    tone="primary"
                  />
                  <KpiTile
                    icon={ArrowUturnLeftIcon}
                    label="Undelivered"
                    primary={num(smsDetail?.undeliveredCount ?? 0)}
                    secondary="Carrier refused — number auto-suppressed"
                    tone="zinc"
                  />
                </div>
                <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  SMS open and click analytics aren&apos;t available yet.
                </div>
              </div>
            ) : engagementLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-[var(--muted)] animate-pulse" />
                ))}
              </div>
            ) : engagementError ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {engagementError}
              </div>
            ) : engagement ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <KpiTile
                  icon={PaperAirplaneIcon}
                  label="Sent"
                  hint={EMAIL_KPI_HINTS.sent}
                  primary={num(engagement.sent)}
                  tone="primary"
                />
                <KpiTile
                  icon={CheckCircleIcon}
                  label="Delivered"
                  hint={EMAIL_KPI_HINTS.delivered}
                  primary={num(engagement.delivered)}
                  secondary={pct(engagement.deliveryRate)}
                  tone="emerald"
                />
                <KpiTile
                  icon={EnvelopeOpenIcon}
                  label="Open rate"
                  hint={EMAIL_KPI_HINTS.openRate}
                  primary={pct(engagement.openRate)}
                  secondary={`${num(engagement.uniqueOpens)} unique`}
                  tone="sky"
                />
                <KpiTile
                  icon={CursorArrowRaysIcon}
                  label="Click rate"
                  hint={EMAIL_KPI_HINTS.clickRate}
                  primary={pct(engagement.clickRate)}
                  secondary={`${num(engagement.uniqueClicks)} unique`}
                  tone="violet"
                />
                {/* Neutral on purpose. A bounce means an address on the list
                    has gone dead — routine on any list with age, and every one
                    of them is auto-suppressed so the next blast skips it. In
                    amber, under a warning triangle, it read as an incident. */}
                <KpiTile
                  icon={ArrowUturnLeftIcon}
                  label="Bounced"
                  hint={EMAIL_KPI_HINTS.bounced}
                  primary={num(engagement.bounces)}
                  secondary={pct(engagement.bounceRate)}
                  tone="zinc"
                />
                <KpiTile
                  icon={NoSymbolIcon}
                  label="Unsubscribes"
                  hint={EMAIL_KPI_HINTS.unsubscribes}
                  primary={num(engagement.unsubscribes)}
                  secondary={pct(engagement.unsubscribeRate)}
                  tone="zinc"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
                No engagement data yet. Opens and clicks will appear here as recipients
                interact with the email.
              </div>
            )}
          </section>

          {/* Preview block */}
          <section>
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              {channel === 'sms' ? 'Message Preview' : 'Email Preview'}
            </h3>
            {previewLoading ? (
              <div className="h-[420px] rounded-xl border border-[var(--border)] bg-[var(--muted)] animate-pulse" />
            ) : previewError ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {previewError}
              </div>
            ) : channel === 'sms' ? (
              <SmsPreview message={smsDetail?.message || ''} />
            ) : (
              <EmailPreview
                subject={emailDetail?.subject || ''}
                previewText={emailDetail?.previewText || ''}
                html={previewHtml}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──

const TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'bg-[var(--primary)]/10', text: 'text-[var(--primary)]' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  zinc: { bg: 'bg-zinc-500/10', text: 'text-zinc-400' },
};

function KpiTile({
  icon: Icon,
  label,
  hint,
  primary,
  secondary,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  /** What the number counts — shown in a tooltip by the label. */
  hint?: string;
  primary: string;
  secondary?: string;
  tone: keyof typeof TONE_CLASSES;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="rounded-xl border border-[var(--border)] px-3 py-3 bg-[var(--card)]">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${t.bg} ${t.text}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </span>
        {hint && (
          <Tooltip label={hint}>
            <span
              tabIndex={0}
              aria-label={hint}
              className="inline-flex text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-help"
            >
              <InformationCircleIcon className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-[var(--foreground)]">
        {primary}
      </p>
      {secondary && (
        <p className="text-[11px] text-[var(--muted-foreground)] tabular-nums mt-0.5">
          {secondary}
        </p>
      )}
    </div>
  );
}

function EmailPreview({
  subject,
  previewText,
  html,
}: {
  subject: string;
  previewText: string;
  html: string;
}) {
  if (!html.trim()) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
        No rendered HTML stored for this blast.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-white">
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--muted)]">
        <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Subject
        </p>
        <p className="text-sm font-medium text-[var(--foreground)] mt-0.5 truncate">
          {subject || '(no subject)'}
        </p>
        {previewText && (
          <p className="text-[11px] text-[var(--muted-foreground)] mt-1 truncate">
            {previewText}
          </p>
        )}
      </div>
      <iframe
        title="Blast email preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="w-full h-[520px] bg-white"
      />
    </div>
  );
}

function SmsPreview({ message }: { message: string }) {
  if (!message.trim()) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
        No message body stored for this blast.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--border)] p-4 bg-[var(--card)]">
      <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
        Message
      </p>
      <p className="text-sm whitespace-pre-wrap text-[var(--foreground)] leading-relaxed">
        {message}
      </p>
    </div>
  );
}
