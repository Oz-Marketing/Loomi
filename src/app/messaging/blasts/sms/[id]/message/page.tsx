'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
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
  metadata: string;
}

interface CampaignMetadata {
  channel: 'SMS' | 'MMS';
  mediaUrls: string[];
  sourceMetadata?: string;
}

function parseMetadata(raw: string): CampaignMetadata {
  const empty: CampaignMetadata = { channel: 'SMS', mediaUrls: [], sourceMetadata: '' };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<CampaignMetadata>;
    return {
      channel: parsed.channel === 'MMS' ? 'MMS' : 'SMS',
      mediaUrls: Array.isArray(parsed.mediaUrls)
        ? parsed.mediaUrls.filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [],
      sourceMetadata: typeof parsed.sourceMetadata === 'string' ? parsed.sourceMetadata : '',
    };
  } catch {
    return empty;
  }
}

function smsSegmentInfo(text: string): { length: number; perSegment: number; segments: number } {
  const length = text.length;
  if (length === 0) return { length: 0, perSegment: 160, segments: 0 };
  // eslint-disable-next-line no-control-regex
  const hasUnicode = /[^ -]/.test(text);
  const perSegment = hasUnicode ? 70 : 160;
  const segments = Math.ceil(length / perSegment);
  return { length, perSegment, segments };
}

export default function SmsMessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setMessage(data.campaign.message || '');
        const meta = parseMetadata(data.campaign.metadata || '');
        setMediaUrls(meta.mediaUrls);
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

  async function patchDraft(patch: Record<string, unknown>): Promise<DraftCampaign | null> {
    const res = await fetch(`/api/blasts/sms/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save');
    return data?.campaign || null;
  }

  function buildMetadata(urls: string[]): string {
    const channel: 'SMS' | 'MMS' = urls.length > 0 ? 'MMS' : 'SMS';
    return JSON.stringify({ channel, mediaUrls: urls, sourceMetadata: '' });
  }

  async function handleMessageBlur() {
    if (!draft || message === draft.message) return;
    try {
      const updated = await patchDraft({ message });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save message');
    }
  }

  async function persistMediaUrls(next: string[]) {
    if (!draft) return;
    try {
      const updated = await patchDraft({ metadata: buildMetadata(next) });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save media');
    }
  }

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const toUpload = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (toUpload.length === 0) {
      toast.error('Only image files are supported for MMS.');
      return;
    }
    if (mediaUrls.length + toUpload.length > 10) {
      toast.error('Maximum 10 images per blast.');
      return;
    }
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', 'ad-creative');
        if (accountKey) fd.append('accountKey', accountKey);
        const res = await fetch('/api/media', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Upload failed');
        const url = data?.url || data?.asset?.url;
        if (url) uploaded.push(String(url));
      }
      const next = [...mediaUrls, ...uploaded];
      setMediaUrls(next);
      await persistMediaUrls(next);
      toast.success(
        `Added ${uploaded.length} image${uploaded.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeImage(url: string) {
    const next = mediaUrls.filter((u) => u !== url);
    setMediaUrls(next);
    await persistMediaUrls(next);
  }

  async function handleContinue() {
    if (!draft) return;
    if (!message.trim() && mediaUrls.length === 0) {
      toast.error('Add a message or at least one image before continuing.');
      return;
    }
    setSaving(true);
    try {
      if (message !== draft.message) {
        await patchDraft({ message });
      }
      router.push(`/messaging/blasts/sms/${encodeURIComponent(id)}/schedule`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const segInfo = smsSegmentInfo(message);
  const isMms = mediaUrls.length > 0;
  const channelLabel = isMms ? 'MMS' : 'SMS';

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
          <h1 className="text-2xl font-bold">{draft?.name || 'Blast'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Write the text your recipients will see. Add images to send as MMS.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Left: composer */}
          <div className="space-y-5">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Message <span className="text-red-400">*</span>
                </label>
                <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded">
                  {channelLabel}
                </span>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onBlur={handleMessageBlur}
                placeholder="Spring service special: 20% off oil changes through May. Reply STOP to opt out."
                rows={6}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 resize-y"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                <span>
                  {segInfo.length} char{segInfo.length === 1 ? '' : 's'}
                  {' · '}
                  {segInfo.segments} segment{segInfo.segments === 1 ? '' : 's'}
                  {' · '}
                  {segInfo.perSegment === 70 ? 'Unicode (70/seg)' : 'GSM-7 (160/seg)'}
                </span>
                <span className="text-[var(--muted-foreground)]">
                  {Math.max(0, segInfo.perSegment * segInfo.segments - segInfo.length)} left in segment
                </span>
              </div>
            </div>

            {/* Media (MMS) */}
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Media
                </label>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {mediaUrls.length} / 10
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {mediaUrls.map((url) => (
                  <div
                    key={url}
                    className="relative aspect-square rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--muted)] group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(url)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-black/90 text-white inline-flex items-center justify-center"
                      aria-label="Remove image"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {mediaUrls.length < 10 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="aspect-square rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/[0.03] transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    {uploading ? (
                      <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    ) : (
                      <PhotoIcon className="w-6 h-6" />
                    )}
                    <span className="text-[10px] font-medium">
                      {uploading ? 'Uploading…' : 'Add image'}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-3">
                JPG, PNG, GIF, or WebP. Up to 25 MB each. MMS carries higher per-message
                cost — typically $0.02–$0.05 vs $0.005 for SMS.
              </p>
            </div>

            <div className="glass-section-card rounded-2xl p-4 border border-[var(--border)]">
              <p className="text-[11px] text-[var(--muted-foreground)]">
                <strong className="text-[var(--foreground)]">Tip:</strong> Marketing SMS in
                the US needs an opt-out mechanism. Including &ldquo;Reply STOP to opt out&rdquo;
                satisfies most carrier rules.
              </p>
            </div>
          </div>

          {/* Right: iPhone-style preview */}
          <div className="lg:sticky lg:top-20">
            <IphoneSmsPreview
              dealerName={account?.dealer || 'Your dealership'}
              message={message}
              mediaUrls={mediaUrls}
              isMms={isMms}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/blasts/sms/${encodeURIComponent(id)}/recipients`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton
            onClick={handleContinue}
            disabled={saving || (!message.trim() && mediaUrls.length === 0)}
          >
            {saving ? 'Saving…' : 'Continue to Schedule'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
