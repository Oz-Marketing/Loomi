'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import PrimaryButton from '@/components/primary-button';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import { TemplateLibraryPanel } from '@/components/campaigns/template-library-panel';
import { TemplatePreviewModal } from '@/components/campaigns/template-preview-modal';
import { SelectedTemplatePanel } from '@/components/campaigns/selected-template-panel';

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

type Tab = 'email' | 'sms';

function parseLinkedSmsId(rawMetadata: string): string | null {
  if (!rawMetadata) return null;
  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;
    const value = parsed?.linkedSmsBlastId;
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
  const [smsMediaUrls, setSmsMediaUrls] = useState<string[]>([]);
  const [smsUploading, setSmsUploading] = useState(false);
  const smsFileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // Email template picker state (embedded in the Email tab)
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

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
        setSmsMediaUrls(parseSmsMediaUrls(smsData.campaign.metadata || ''));
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

  /**
   * Compile template raw (v2 JSON for drag-and-drop, raw HTML for HTML-mode)
   * to email-ready HTML via /api/preview. Mirrors the standalone email
   * flow so both end up storing compiled HTML on the campaign.
   */
  async function compileTemplate(raw: string): Promise<string> {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: raw, previewValues: {} }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.html) throw new Error(data?.error || 'Failed to compile template');
    return String(data.html);
  }

  async function applyTemplate(design: string) {
    if (!emailDraft) return;
    setApplying(true);
    try {
      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(design)}&format=raw`);
      const rawData = await rawRes.json().catch(() => ({}));
      if (!rawRes.ok || !rawData?.raw) {
        throw new Error(rawData?.error || 'Failed to load template');
      }
      const raw = String(rawData.raw);
      const titleMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      let newSubject = subject;
      if (!newSubject && titleMatch) {
        const line = titleMatch[1].match(/^title:\s*(.+)$/m);
        if (line) newSubject = line[1].trim().replace(/^["']|["']$/g, '');
      }
      const compiled = await compileTemplate(raw);
      // Preserve existing multi-channel metadata (multiChannel + linkedSmsBlastId)
      // while recording the chosen templateSlug.
      let existingMeta: Record<string, unknown> = {};
      try {
        existingMeta = JSON.parse(emailDraft.metadata || '{}') as Record<string, unknown>;
      } catch {
        existingMeta = {};
      }
      const meta = JSON.stringify({ ...existingMeta, templateSlug: design });
      const updated = await patchEmail({
        subject: newSubject || emailDraft.name,
        htmlContent: compiled,
        sourceType: 'template-library',
        metadata: meta,
      });
      if (updated) {
        setEmailDraft(updated);
        setSubject(updated.subject);
      }
      setPreviewDesign(null);
      // Jump into the editor with multi=1 so navigation from the editor
      // goes back to /campaigns/multi/[id]/...
      router.push(
        `/templates/editor?design=${encodeURIComponent(design)}&campaignId=${encodeURIComponent(id)}&multi=1`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  }

  // "Create New" from the picker: create a blank template scoped to this
  // campaign's sub-account (accountKey → never global), attach it to the
  // email draft, then open the editor with multi=1 so navigation flows
  // back into the multi-channel builder. Mirrors applyTemplate.
  async function handleCreateNew(mode: 'visual' | 'code') {
    if (!emailDraft) return;
    if (!accountKey) {
      toast.error('This campaign has no sub-account, so a template can’t be created here.');
      return;
    }
    setApplying(true);
    try {
      const createRes = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: 'Untitled Template', mode, accountKey }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData?.design) {
        throw new Error(createData?.error || 'Failed to create template');
      }
      const slug = String(createData.design);

      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(slug)}&format=raw`);
      const rawData = await rawRes.json().catch(() => ({}));
      const raw = String(rawData?.raw || '');
      const compiled = raw ? await compileTemplate(raw) : '';
      // Preserve existing multi-channel metadata while recording the slug.
      let existingMeta: Record<string, unknown> = {};
      try {
        existingMeta = JSON.parse(emailDraft.metadata || '{}') as Record<string, unknown>;
      } catch {
        existingMeta = {};
      }
      const meta = JSON.stringify({ ...existingMeta, templateSlug: slug });
      const updated = await patchEmail({
        subject: subject || emailDraft.name,
        htmlContent: compiled,
        sourceType: 'template-library',
        metadata: meta,
      });
      if (updated) {
        setEmailDraft(updated);
        setSubject(updated.subject);
      }
      const builderSuffix = mode === 'code' ? '&builder=html' : '';
      router.push(
        `/templates/editor?design=${encodeURIComponent(slug)}&campaignId=${encodeURIComponent(id)}&accountKey=${encodeURIComponent(accountKey)}&multi=1${builderSuffix}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
      setApplying(false);
    }
  }

  async function handleChangeTemplate() {
    if (!emailDraft) return;
    if (!confirm('Clear the current template and pick a different one?')) return;
    try {
      const updated = await patchEmail({ htmlContent: '' });
      if (updated) setEmailDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change template');
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

  function buildSmsMetadata(urls: string[]): string {
    const channel: 'SMS' | 'MMS' = urls.length > 0 ? 'MMS' : 'SMS';
    return JSON.stringify({
      channel,
      mediaUrls: urls,
      sourceMetadata: '',
      multiChannel: true,
      linkedEmailBlastId: id,
    });
  }

  async function persistSmsMedia(next: string[]) {
    if (!smsDraft) return;
    try {
      const updated = await patchSms({ metadata: buildSmsMetadata(next) });
      if (updated) setSmsDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save media');
    }
  }

  async function handleSmsFiles(files: FileList | null) {
    if (!files || files.length === 0 || !smsDraft) return;
    const toUpload = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (toUpload.length === 0) {
      toast.error('Only image files are supported for MMS.');
      return;
    }
    if (smsMediaUrls.length + toUpload.length > 10) {
      toast.error('Maximum 10 images per campaign.');
      return;
    }
    setSmsUploading(true);
    try {
      const uploaded: string[] = [];
      const accountKey = smsDraft.accountKeys[0] || '';
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
      const next = [...smsMediaUrls, ...uploaded];
      setSmsMediaUrls(next);
      await persistSmsMedia(next);
      toast.success(`Added ${uploaded.length} image${uploaded.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSmsUploading(false);
      if (smsFileInputRef.current) smsFileInputRef.current.value = '';
    }
  }

  async function removeSmsImage(url: string) {
    const next = smsMediaUrls.filter((u) => u !== url);
    setSmsMediaUrls(next);
    await persistSmsMedia(next);
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
      router.push(`/messaging/campaigns/multi/${encodeURIComponent(id)}/schedule`);
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

            </div>

            {emailDraft?.htmlContent ? (
              <SelectedTemplatePanel
                htmlContent={emailDraft.htmlContent}
                onEdit={() => {
                  if (!templateSlug) {
                    toast.error("Can't open editor — no template slug recorded.");
                    return;
                  }
                  router.push(
                    `/templates/editor?design=${encodeURIComponent(templateSlug)}&campaignId=${encodeURIComponent(id)}&multi=1`,
                  );
                }}
                onChangeTemplate={handleChangeTemplate}
              />
            ) : (
              <TemplateLibraryPanel onSelect={setPreviewDesign} onCreateNew={handleCreateNew} />
            )}
          </div>
        )}

        {tab === 'sms' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
            <div className="space-y-5">
              <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                    SMS message <span className="text-red-400">*</span>
                  </label>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-0.5 rounded">
                    {smsMediaUrls.length > 0 ? 'MMS' : 'SMS'}
                  </span>
                </div>
                <textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  onBlur={handleSmsBlur}
                  placeholder="Spring service special: 20% off oil changes through May. Reply STOP to opt out."
                  rows={6}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 resize-y"
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-2">
                  {smsMessage.length} character{smsMessage.length === 1 ? '' : 's'}
                </p>
              </div>

              {/* MMS media */}
              <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                    Media
                  </label>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {smsMediaUrls.length} / 10
                  </span>
                </div>

                <input
                  ref={smsFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleSmsFiles(e.target.files)}
                />

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {smsMediaUrls.map((url) => (
                    <div
                      key={url}
                      className="relative aspect-square rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--muted)] group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeSmsImage(url)}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-black/90 text-white inline-flex items-center justify-center"
                        aria-label="Remove image"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {smsMediaUrls.length < 10 && (
                    <button
                      type="button"
                      onClick={() => smsFileInputRef.current?.click()}
                      disabled={smsUploading}
                      className="aspect-square rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/[0.03] transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      {smsUploading ? (
                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                      ) : (
                        <PhotoIcon className="w-6 h-6" />
                      )}
                      <span className="text-[10px] font-medium">
                        {smsUploading ? 'Uploading…' : 'Add image'}
                      </span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-3">
                  JPG, PNG, GIF, or WebP. Up to 25 MB each. MMS carries higher per-message cost
                  than SMS.
                </p>
              </div>
            </div>

            {/* iPhone-style preview */}
            <div className="lg:sticky lg:top-20">
              <IphoneSmsPreview
                dealerName={account?.dealer || 'Your dealership'}
                message={smsMessage}
                mediaUrls={smsMediaUrls}
                isMms={smsMediaUrls.length > 0}
              />
            </div>
          </div>
        )}
      </div>

      {previewDesign && (
        <TemplatePreviewModal
          design={previewDesign}
          onClose={() => !applying && setPreviewDesign(null)}
          onUse={() => applyTemplate(previewDesign)}
          applying={applying}
        />
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/messaging/campaigns/multi/${encodeURIComponent(id)}/recipients`)}
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
