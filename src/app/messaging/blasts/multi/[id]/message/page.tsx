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
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import PrimaryButton from '@/components/primary-button';
import { IphoneSmsPreview } from '@/components/campaigns/iphone-sms-preview';
import {
  TemplateLibraryPanel,
  type TemplateLibraryItem,
} from '@/components/campaigns/template-library-panel';
import { SelectedTemplatePanel } from '@/components/campaigns/selected-template-panel';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { BlastLockedNotice } from '@/components/campaigns/blast-locked-notice';
import { isEditableBlastStatus } from '@/lib/messaging/blast-builder-steps';
import { readLinkedSmsId, readTemplateSlug } from '@/lib/messaging/blast-metadata';
import { formatFromLine } from '@/lib/messaging/blast-sender';
import {
  attachTemplateToDraft,
  detachTemplateFromDraft,
  resolveTemplateForBlast,
  syncEmailDraftFromTemplate,
  templateSlugToEdit,
} from '@/lib/messaging/blast-template';

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
  metadata: string;
}

interface SmsDraft {
  id: string;
  name: string;
  status: string;
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

export default function MultiMessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();
  const subHref = useSubaccountHref();

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
  const [applying, setApplying] = useState(false);

  // Either half past draft locks the pair — they're scheduled as one.
  const lockedDraft =
    emailDraft && !isEditableBlastStatus(emailDraft.status)
      ? emailDraft
      : smsDraft && !isEditableBlastStatus(smsDraft.status)
        ? smsDraft
        : null;

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
        if (!smsId) {
          throw new Error('Linked SMS draft missing');
        }
        const smsRes = await fetch(`/api/blasts/sms/${encodeURIComponent(smsId)}`);
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || !smsData?.campaign) {
          throw new Error(smsData?.error || 'Linked SMS draft not loadable');
        }
        const sms = smsData.campaign as SmsDraft;

        // Pull the template's latest content onto the email half. This page
        // never did, so editor changes never reached an Email + Text blast's
        // email and "Create New" left the blank starter as what would send.
        // Drafts only — a committed pair keeps what it was scheduled with.
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
        setSubject(email.subject || '');
        setPreviewText(email.previewText || '');
        setSmsMessage(sms.message || '');
        setSmsMediaUrls(parseSmsMediaUrls(sms.metadata || ''));
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

  async function patchEmail(patch: Record<string, unknown>): Promise<EmailDraft | null> {
    const res = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`, {
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
    const res = await fetch(`/api/blasts/sms/${encodeURIComponent(smsDraft.id)}`, {
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

  /** Load the email half's fields after the template changed them. */
  function adoptEmail(updated: EmailDraft) {
    setEmailDraft(updated);
    setSubject(updated.subject || '');
    setPreviewText(updated.previewText || '');
  }

  /** Carry the subject/preview someone typed but hasn't blurred yet. */
  async function emailWithTypedFields(current: EmailDraft): Promise<EmailDraft> {
    const patch: Record<string, unknown> = {};
    if (subject !== current.subject) patch.subject = subject;
    if (previewText !== current.previewText) patch.previewText = previewText;
    if (Object.keys(patch).length === 0) return current;
    return (await patchEmail(patch)) ?? current;
  }

  function openEditor(slug: string, extra = '') {
    // multi=1 so the editor's Done and Change template come back to the
    // Email + Text builder, not the email-only one.
    router.push(
      `/templates/editor?design=${encodeURIComponent(slug)}&campaignId=${encodeURIComponent(id)}&multi=1${extra}`,
    );
  }

  async function applyTemplate(template: TemplateLibraryItem) {
    if (!emailDraft) return;
    // Without the preview modal in the way, two quick clicks in the library
    // fire two applies — each compiling and PATCHing — and the second can
    // land after the first, attaching a template the user did not pick last.
    if (applying) return;
    if (!accountKey) {
      toast.error('Choose recipients first, so the template can be set up for the right account.');
      return;
    }
    setApplying(true);
    try {
      // Shared library and group templates are copied into this account
      // first, so editing never changes them for everyone else.
      const slug = await resolveTemplateForBlast({
        template,
        blastName: emailDraft.name,
        blastAccountKey: accountKey,
      });
      adoptEmail(await attachTemplateToDraft(await emailWithTypedFields(emailDraft), slug));
      openEditor(slug);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  }

  // "Create New" from the picker: create a blank template owned by this
  // blast's account (accountKey → never global), attach it to the email
  // draft, then open the editor. Mirrors applyTemplate.
  async function handleCreateNew(mode: 'visual' | 'code') {
    if (!emailDraft || applying) return;
    if (!accountKey) {
      toast.error('This blast has no account, so a template can’t be created here.');
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
      adoptEmail(await attachTemplateToDraft(await emailWithTypedFields(emailDraft), slug));
      const builderSuffix = mode === 'code' ? '&builder=html' : '';
      openEditor(slug, `&accountKey=${encodeURIComponent(accountKey)}${builderSuffix}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
      setApplying(false);
    }
  }

  async function handleEdit() {
    if (!emailDraft || applying) return;
    const slug = readTemplateSlug(emailDraft.metadata);
    if (!slug) {
      toast.error("Can't open the editor — no template is recorded for this email.");
      return;
    }
    setApplying(true);
    try {
      // A blast still pointing at a shared template gets its own copy first.
      const own = await templateSlugToEdit({
        slug,
        blastName: emailDraft.name,
        blastAccountKey: accountKey,
      });
      if (own !== slug) {
        adoptEmail(await attachTemplateToDraft(await emailWithTypedFields(emailDraft), own));
      }
      openEditor(own);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open the editor');
      setApplying(false);
    }
  }

  async function handleChangeTemplate() {
    // No confirm() here. It is a native modal, which is SUPPRESSED in an
    // embedded or sandboxed view (Loomi's own preview pane, an in-app
    // browser) — it returns false there, so the button looked dead rather
    // than cancelled. The action is also cheap to undo: it detaches the
    // template from this blast, it does not delete the template, and the
    // picker opens immediately so re-selecting is one click.
    if (!emailDraft) return;
    try {
      // The slug goes too, or the next load re-syncs the old template back.
      setEmailDraft(await detachTemplateFromDraft(emailDraft));
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

  async function persistSmsMedia(next: string[]) {
    if (!smsDraft) return;
    try {
      // Just the media keys, merged server-side. This used to rewrite the
      // text half's whole metadata, dropping anything another step kept
      // there — its confirmed audience among them.
      const updated = await patchSms({
        metadataPatch: { channel: next.length > 0 ? 'MMS' : 'SMS', mediaUrls: next },
      });
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
      toast.error('Maximum 10 images per blast.');
      return;
    }
    setSmsUploading(true);
    try {
      const uploaded: string[] = [];
      const smsAccountKey = smsDraft.accountKeys[0] || '';
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', 'ad-creative');
        if (smsAccountKey) fd.append('accountKey', smsAccountKey);
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
      router.push(subHref(`/messaging/blasts/multi/${encodeURIComponent(id)}/schedule`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const accountKey = emailDraft?.accountKeys[0] || smsDraft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

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

  return (
    <div className="pb-32">
      <div className="max-w-6xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Message
          </p>
          <h1>
            <BlastNameField id={id} channel="multi" variant="title" initialName={emailDraft?.name ?? ''} />
          </h1>
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
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start animate-fade-in-up">
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
                {/* What the send puts in the From header: sender name, else
                    the account's name (lib/messaging/blast-sender). */}
                <div className="text-[11px] text-[var(--muted-foreground)] border-t border-[var(--border)] pt-3">
                  From:{' '}
                  {account?.senderEmail ? (
                    <span className="text-[var(--foreground)] font-medium">{formatFromLine(account)}</span>
                  ) : (
                    <span className="text-amber-400">
                      No From address set — add one in Settings &rarr; Sending
                      before scheduling
                    </span>
                  )}
                </div>
              </div>

            </div>

            {emailDraft?.htmlContent ? (
              <SelectedTemplatePanel
                htmlContent={emailDraft.htmlContent}
                onEdit={handleEdit}
                onChangeTemplate={handleChangeTemplate}
              />
            ) : (
            // Selecting a design applies it and goes STRAIGHT to the editor,
            // with no preview-and-confirm step in between. You are going to
            // edit this template regardless — that is the whole point of
            // picking one for a blast — so previewing first was a step that
            // only ever delayed the edit.
              <TemplateLibraryPanel
                onSelect={applyTemplate}
                onCreateNew={handleCreateNew}
                accountKey={accountKey || undefined}
                busy={applying}
              />
            )}
          </div>
        )}

        {tab === 'sms' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start animate-fade-in-up">
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

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(subHref(`/messaging/blasts/multi/${encodeURIComponent(id)}/recipients`))}
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
        className={`w-1.5 h-1.5 rounded-full transition-colors ${
          ready ? 'bg-emerald-400' : 'bg-[var(--muted-foreground)] opacity-40'
        }`}
        aria-hidden
      />
    </button>
  );
}
