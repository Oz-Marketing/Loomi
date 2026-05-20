'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import PrimaryButton from '@/components/primary-button';

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
  metadata: string;
}

interface SmsDraft {
  id: string;
  name: string;
  accountKeys: string[];
  message: string;
}

type Tab = 'email' | 'sms';

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

function parseTemplateSlug(rawMetadata: string): string {
  if (!rawMetadata) return '';
  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;
    return typeof parsed?.templateSlug === 'string' ? parsed.templateSlug : '';
  } catch {
    return '';
  }
}

export default function MultiMessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>('email');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [smsMessage, setSmsMessage] = useState('');
  const [saving, setSaving] = useState(false);

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
        if (!smsId) {
          throw new Error('Linked SMS draft missing');
        }
        const smsRes = await fetch(`/api/campaigns/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        if (cancelled) return;
        setEmailDraft(email);
        setSmsDraft(smsData.campaign);
        setSubject(email.subject || '');
        setPreviewText(email.previewText || '');
        setSmsMessage(smsData.campaign.message || '');
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load campaign');
          router.push('/campaigns');
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

  async function patchEmail(patch: Record<string, unknown>): Promise<EmailDraft | null> {
    const res = await fetch(`/api/campaigns/email/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save');
    return data?.campaign || null;
  }

  async function patchSms(patch: Record<string, unknown>): Promise<SmsDraft | null> {
    if (!smsDraft) return null;
    const res = await fetch(`/api/campaigns/sms/${encodeURIComponent(smsDraft.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save');
    return data?.campaign || null;
  }

  async function handleSubjectBlur() {
    if (!emailDraft || subject === emailDraft.subject) return;
    try {
      const updated = await patchEmail({ subject });
      if (updated) setEmailDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save subject');
    }
  }

  async function handlePreviewTextBlur() {
    if (!emailDraft || previewText === emailDraft.previewText) return;
    try {
      const updated = await patchEmail({ previewText });
      if (updated) setEmailDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preview text');
    }
  }

  async function handleSmsBlur() {
    if (!smsDraft || smsMessage === smsDraft.message) return;
    try {
      const updated = await patchSms({ message: smsMessage });
      if (updated) setSmsDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save SMS');
    }
  }

  async function handleContinue() {
    if (!emailDraft) return;
    if (!emailDraft.htmlContent?.trim()) {
      toast.error('Pick an email template before continuing.');
      setTab('email');
      return;
    }
    if (!subject.trim()) {
      toast.error('Add an email subject line before continuing.');
      setTab('email');
      return;
    }
    if (!smsMessage.trim()) {
      toast.error('Write the SMS message before continuing.');
      setTab('sms');
      return;
    }
    setSaving(true);
    try {
      // Flush any in-flight edits
      if (subject !== emailDraft.subject) await patchEmail({ subject });
      if (previewText !== emailDraft.previewText) await patchEmail({ previewText });
      if (smsDraft && smsMessage !== smsDraft.message) await patchSms({ message: smsMessage });
      router.push(`/campaigns/multi/${encodeURIComponent(id)}/schedule`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const accountKey = emailDraft?.accountKeys[0] || smsDraft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;
  const templateSlug = emailDraft ? parseTemplateSlug(emailDraft.metadata) : '';

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

  return (
    <div className="pb-32">
      <div className="max-w-6xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Message
          </p>
          <h1 className="text-2xl font-bold">{emailDraft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Compose the email and SMS that go to your audience. Both fire at the same time once
            you schedule.
          </p>
        </div>

        {/* Channel tabs */}
        <div className="border-b border-[var(--border)] mb-6 flex items-center gap-1">
          <ChannelTab
            active={tab === 'email'}
            onClick={() => setTab('email')}
            icon={EnvelopeIcon}
            label="Email"
            ready={Boolean(emailDraft?.htmlContent?.trim() && subject.trim())}
          />
          <ChannelTab
            active={tab === 'sms'}
            onClick={() => setTab('sms')}
            icon={ChatBubbleLeftRightIcon}
            label="SMS"
            ready={Boolean(smsMessage.trim())}
          />
        </div>

        {tab === 'email' && (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
            <div className="space-y-5 lg:sticky lg:top-20">
              <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] space-y-4">
                <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Email
                </p>
                <div>
                  <label className="block text-[11px] text-[var(--muted-foreground)] mb-1.5">
                    Subject line <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    onBlur={handleSubjectBlur}
                    placeholder="Your next service is due"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--muted-foreground)] mb-1.5">
                    Preview text
                  </label>
                  <input
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    onBlur={handlePreviewTextBlur}
                    placeholder="Lock in your appointment this week."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                  />
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] border-t border-[var(--border)] pt-3">
                  Sender: <span className="text-[var(--foreground)] font-medium">{account?.senderName || account?.dealer || '—'}</span>
                  <br />
                  {account?.senderEmail || 'Falls back to global SMTP_FROM'}
                </div>
              </div>

              {emailDraft?.htmlContent && templateSlug && (
                <Link
                  href={`/templates/editor?design=${encodeURIComponent(templateSlug)}&campaignId=${encodeURIComponent(id)}`}
                  className="block w-full text-center px-4 py-2.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60"
                >
                  <PencilSquareIcon className="w-4 h-4 inline mr-1.5" />
                  Edit template
                </Link>
              )}
            </div>

            <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Preview
                </p>
                {!emailDraft?.htmlContent && (
                  <Link
                    href={`/campaigns/${encodeURIComponent(id)}/template`}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    Pick a template →
                  </Link>
                )}
              </div>
              <div className="bg-[var(--muted)]/30 p-4 min-h-[500px]">
                {emailDraft?.htmlContent ? (
                  <iframe
                    title="Email preview"
                    srcDoc={emailDraft.htmlContent}
                    sandbox=""
                    className="w-full min-h-[480px] bg-white rounded-lg border border-[var(--border)]"
                  />
                ) : (
                  <div className="h-full min-h-[480px] flex flex-col items-center justify-center text-center text-[var(--muted-foreground)]">
                    <EnvelopeIcon className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm font-medium">No template selected yet</p>
                    <p className="text-xs mt-1.5 max-w-xs">
                      Click <strong>Pick a template</strong> above to load one from your library.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'sms' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  SMS message <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  onBlur={handleSmsBlur}
                  placeholder="Spring service special: 20% off oil changes through May. Reply STOP to opt out."
                  rows={6}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 resize-y"
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                  {smsMessage.length} character{smsMessage.length === 1 ? '' : 's'}. For media
                  (MMS), open the SMS-only builder for now — multi-channel media support ships
                  next.
                </p>
              </div>
            </div>

            <div className="glass-section-card rounded-2xl p-4 border border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Preview
              </p>
              {smsMessage.trim() ? (
                <div className="bg-[var(--muted)]/40 rounded-xl px-4 py-3">
                  <div className="inline-block max-w-full bg-[#e5e5ea] text-black text-sm leading-snug rounded-2xl px-3 py-2 whitespace-pre-wrap break-words">
                    {smsMessage}
                  </div>
                </div>
              ) : (
                <div className="bg-[var(--muted)]/40 rounded-xl p-6 text-center">
                  <ChatBubbleLeftRightIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto opacity-40 mb-2" />
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Type a message to see the preview.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/campaigns/multi/${encodeURIComponent(id)}/recipients`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton onClick={handleContinue} disabled={saving}>
            {saving ? 'Saving…' : 'Continue to Schedule'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ChannelTab({
  active,
  onClick,
  icon: Icon,
  label,
  ready,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ready: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-[var(--primary)] text-[var(--foreground)]'
          : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          ready ? 'bg-emerald-400' : 'bg-[var(--muted-foreground)] opacity-40'
        }`}
        aria-hidden
      />
    </button>
  );
}
