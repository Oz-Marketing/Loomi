'use client';

// Sent-campaign detail drawer. Slides in from the right when a sent
// row on the campaigns list is clicked. Renders campaign-scoped KPIs
// (sent / delivered / opens / clicks / bounces / unsubs) plus an
// email or SMS preview alongside. Sent campaigns are read-only —
// there's no edit affordance here.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  XMarkIcon,
  EnvelopeOpenIcon,
  CursorArrowRaysIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

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

interface EmailCampaignDetail {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  htmlContent: string;
}

interface SmsCampaignDetail {
  id: string;
  name: string;
  message: string;
}

interface SentCampaignDrawerProps {
  open: boolean;
  campaign: CampaignSummary | null;
  onClose: () => void;
}

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

export function SentCampaignDrawer({ open, campaign, onClose }: SentCampaignDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [engagement, setEngagement] = useState<EngagementRow | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementError, setEngagementError] = useState<string | null>(null);

  const [emailDetail, setEmailDetail] = useState<EmailCampaignDetail | null>(null);
  const [smsDetail, setSmsDetail] = useState<SmsCampaignDetail | null>(null);
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
    fetch(`/api/campaigns/loomi/engagement/${encodeURIComponent(campaignId)}`)
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
  }, [open, campaignId, channel]);

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
        ? `/api/campaigns/sms/${encodeURIComponent(campaignId)}`
        : `/api/campaigns/email/${encodeURIComponent(campaignId)}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: { campaign?: EmailCampaignDetail & SmsCampaignDetail }) => {
        if (cancelled) return;
        if (!data.campaign) {
          setPreviewError('Campaign not found.');
          return;
        }
        if (channel === 'sms') {
          setSmsDetail({
            id: data.campaign.id,
            name: data.campaign.name,
            message: data.campaign.message || '',
          });
        } else {
          setEmailDetail({
            id: data.campaign.id,
            name: data.campaign.name,
            subject: data.campaign.subject || '',
            previewText: data.campaign.previewText || '',
            htmlContent: data.campaign.htmlContent || '',
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

  if (!mounted && !open) return null;

  const channelLabel =
    channel === 'sms' ? 'SMS' : channel === 'multi' ? 'Email + SMS' : 'Email';

  return (
    <div
      className={`fixed inset-0 z-[140] flex justify-end transition-[background-color] duration-300 ${
        open ? 'bg-black/40 backdrop-blur-[2px]' : 'pointer-events-none bg-black/0'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sent campaign details"
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
              <span>{channelLabel} Campaign</span>
              <span>·</span>
              <span className="text-green-400">Sent</span>
            </div>
            <h2 className="text-base font-semibold mt-1 truncate">
              {campaign?.name || '(Untitled campaign)'}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Sent {formatDateTime(campaign?.sentAt || campaign?.updatedAt)}
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
          {/* KPI block */}
          <section>
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Performance
            </h3>
            {channel === 'sms' ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
                SMS engagement analytics aren&apos;t available yet.
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
                  primary={num(engagement.sent)}
                  tone="primary"
                />
                <KpiTile
                  icon={CheckCircleIcon}
                  label="Delivered"
                  primary={num(engagement.delivered)}
                  secondary={pct(engagement.deliveryRate)}
                  tone="emerald"
                />
                <KpiTile
                  icon={EnvelopeOpenIcon}
                  label="Open rate"
                  primary={pct(engagement.openRate)}
                  secondary={`${num(engagement.uniqueOpens)} unique`}
                  tone="sky"
                />
                <KpiTile
                  icon={CursorArrowRaysIcon}
                  label="Click rate"
                  primary={pct(engagement.clickRate)}
                  secondary={`${num(engagement.uniqueClicks)} unique`}
                  tone="violet"
                />
                <KpiTile
                  icon={ExclamationTriangleIcon}
                  label="Bounce rate"
                  primary={pct(engagement.bounceRate)}
                  secondary={num(engagement.bounces)}
                  tone="amber"
                />
                <KpiTile
                  icon={NoSymbolIcon}
                  label="Unsubscribes"
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
  primary,
  secondary,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
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
        No rendered HTML stored for this campaign.
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
        title="Campaign email preview"
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
        No message body stored for this campaign.
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
