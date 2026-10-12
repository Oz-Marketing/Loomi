'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import PrimaryButton from '@/components/primary-button';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import {
  TemplateLibraryPanel,
  type TemplateLibraryItem,
} from '@/components/campaigns/template-library-panel';
import { SelectedTemplatePanel } from '@/components/campaigns/selected-template-panel';
import { BlastNameField } from '@/components/campaigns/blast-name-field';
import { BlastLockedNotice } from '@/components/campaigns/blast-locked-notice';
import { isEditableBlastStatus } from '@/lib/messaging/blast-builder-steps';
import { readTemplateSlug } from '@/lib/messaging/blast-metadata';
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

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  accountKeys: string[];
  subject: string;
  previewText: string;
  htmlContent: string;
  sourceAudienceId: string;
  metadata?: string | null;
}

export default function MessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id } = use(params);
  const subHref = useSubaccountHref();
  // If this page was launched from the multi-channel builder we need to
  // route the user back to the multi flow (not the email-only one) so
  // the linked SMS draft stays accessible. Carry the flag through every
  // hop: applyTemplate → editor, edit-template → editor, schedule →
  // multi schedule, back → multi message.
  const fromMulti = searchParams.get('multi') === '1';
  const multiSuffix = fromMulti ? '&multi=1' : '';
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  async function fetchDraft(): Promise<DraftCampaign | null> {
    const res = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.campaign || null;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    fetchDraft()
      .then(async (campaign) => {
        if (cancelled) return;
        if (!campaign) {
          toast.error('Blast not found');
          router.push(subHref('/messaging/blasts'));
          return;
        }

        // A blast that's scheduled or sent keeps exactly what it was
        // committed with: no re-sync, no saves. The page shows a locked
        // state instead (below).
        if (!isEditableBlastStatus(campaign.status)) {
          setDraft(campaign);
          return;
        }

        // Multi-channel context: once a template is loaded on the email
        // draft, the user belongs on the multi message page where they
        // can switch to the SMS tab — which re-syncs the template itself.
        if (fromMulti && campaign.htmlContent) {
          router.replace(subHref(`/messaging/blasts/multi/${encodeURIComponent(id)}/message`));
          return;
        }

        // Pull the template's latest content (and its subject/preheader)
        // onto the draft — the editor saves the template, not the blast.
        // A sync that can't be saved changes nothing on screen: showing
        // html the send won't use would be worse than showing the stored one.
        const synced = await syncEmailDraftFromTemplate(campaign);
        if (cancelled) return;
        if (synced.error) {
          toast.error(
            `Couldn’t refresh this email from its template, so the last saved version is shown. ${synced.error}`,
          );
        }
        setDraft(synced.draft);
        setSubject(synced.draft.subject || '');
        setPreviewText(synced.draft.previewText || '');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function patchDraft(patch: Record<string, unknown>): Promise<DraftCampaign | null> {
    const res = await fetch(`/api/blasts/email/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save');
    return data?.campaign || null;
  }

  async function handleSubjectBlur() {
    if (!draft || subject === draft.subject) return;
    try {
      const updated = await patchDraft({ subject });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save subject');
    }
  }

  async function handlePreviewTextBlur() {
    if (!draft || previewText === draft.previewText) return;
    try {
      const updated = await patchDraft({ previewText });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preview text');
    }
  }

  /** Load the draft's fields after the template changed them. */
  function adopt(updated: DraftCampaign) {
    setDraft(updated);
    setSubject(updated.subject || '');
    setPreviewText(updated.previewText || '');
  }

  /** Carry the subject/preview someone typed but hasn't blurred yet. */
  async function draftWithTypedFields(current: DraftCampaign): Promise<DraftCampaign> {
    const patch: Record<string, unknown> = {};
    if (subject !== current.subject) patch.subject = subject;
    if (previewText !== current.previewText) patch.previewText = previewText;
    if (Object.keys(patch).length === 0) return current;
    return (await patchDraft(patch)) ?? current;
  }

  function openEditor(slug: string, extra = '') {
    router.push(
      `/templates/editor?design=${encodeURIComponent(slug)}&campaignId=${encodeURIComponent(id)}${multiSuffix}${extra}`,
    );
  }

  async function applyTemplate(template: TemplateLibraryItem) {
    if (!draft) return;
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
      // A shared library (or group) template is copied into this account
      // first. The editor saves in place, so editing the shared original
      // changed it for every account — and every draft re-synced from it.
      const slug = await resolveTemplateForBlast({
        template,
        blastName: draft.name,
        blastAccountKey: accountKey,
      });
      const updated = await attachTemplateToDraft(await draftWithTypedFields(draft), slug);
      adopt(updated);
      // Selecting a template drops you straight into the template editor so
      // you can adjust before scheduling. campaignId makes the editor show
      // blast-aware actions (Schedule) instead of Save Template.
      openEditor(slug);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  }

  // "Create New" from the picker: spin up a blank template owned by this
  // blast's account (accountKey → never global), attach it to the draft
  // (so returning from the editor re-syncs content), then drop the user into
  // the editor with blast-aware actions. Mirrors applyTemplate.
  async function handleCreateNew(mode: 'visual' | 'code') {
    if (!draft || applying) return;
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
      const updated = await attachTemplateToDraft(await draftWithTypedFields(draft), slug);
      adopt(updated);
      const builderSuffix = mode === 'code' ? '&builder=html' : '';
      openEditor(slug, `&accountKey=${encodeURIComponent(accountKey)}${builderSuffix}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
      setApplying(false);
    }
  }

  async function handleEdit() {
    if (!draft || applying) return;
    const slug = readTemplateSlug(draft.metadata);
    if (!slug) {
      toast.error("Can't open the editor — this blast has no template recorded.");
      return;
    }
    setApplying(true);
    try {
      // A blast still pointing at a shared template gets its own copy first.
      const own = await templateSlugToEdit({ slug, blastName: draft.name, blastAccountKey: accountKey });
      if (own !== slug) {
        adopt(await attachTemplateToDraft(await draftWithTypedFields(draft), own));
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
    if (!draft) return;
    try {
      // The slug goes too — left behind, the next load re-synced the old
      // template straight back onto the blast.
      setDraft(await detachTemplateFromDraft(draft));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change template');
    }
  }

  async function handleContinue() {
    if (!draft) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (subject !== draft.subject) patch.subject = subject;
      if (previewText !== draft.previewText) patch.previewText = previewText;
      if (Object.keys(patch).length > 0) await patchDraft(patch);
      router.push(
        subHref(
          fromMulti
            ? `/messaging/blasts/multi/${encodeURIComponent(id)}/schedule`
            : `/messaging/blasts/${encodeURIComponent(id)}/schedule`,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;
  const hasTemplate = Boolean(draft?.htmlContent);

  if (draftLoading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading blast…
        </p>
      </div>
    );
  }

  if (draft && !isEditableBlastStatus(draft.status)) {
    return <BlastLockedNotice status={draft.status} name={draft.name} />;
  }

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Message
          </p>
          <h1>
            <BlastNameField id={id} channel="email" variant="title" initialName={draft?.name ?? ''} />
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            {hasTemplate
              ? 'Set your subject and preview text. Click Edit to adjust the content.'
              : 'Set your subject and preview, then pick a template on the right.'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
          <SettingsPanel
            subject={subject}
            previewText={previewText}
            account={account}
            onSubjectChange={setSubject}
            onPreviewTextChange={setPreviewText}
            onSubjectBlur={handleSubjectBlur}
            onPreviewTextBlur={handlePreviewTextBlur}
          />

          {hasTemplate ? (
            <SelectedTemplatePanel
              htmlContent={draft!.htmlContent}
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
      </div>

      <BottomBar
        onBack={() =>
          router.push(
            subHref(
              fromMulti
                ? `/messaging/blasts/multi/${encodeURIComponent(id)}/message`
                : `/messaging/blasts/${encodeURIComponent(id)}/recipients`,
            ),
          )
        }
        onContinue={handleContinue}
        continueLabel={saving ? 'Saving…' : 'Continue to Schedule'}
        continueDisabled={!hasTemplate || !subject.trim() || saving}
        rightHint={
          !hasTemplate
            ? 'Pick a template to continue.'
            : !subject.trim()
              ? 'Add a subject line to continue.'
              : undefined
        }
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Left: settings panel (always visible)
// ─────────────────────────────────────────────────────

function SettingsPanel({
  subject,
  previewText,
  account,
  onSubjectChange,
  onPreviewTextChange,
  onSubjectBlur,
  onPreviewTextBlur,
}: {
  subject: string;
  previewText: string;
  account: AccountData | null;
  onSubjectChange: (v: string) => void;
  onPreviewTextChange: (v: string) => void;
  onSubjectBlur: () => void;
  onPreviewTextBlur: () => void;
}) {
  // Exactly what the send puts in the From header: the sender name, else the
  // account's name — see lib/messaging/blast-sender.
  const fromLine = formatFromLine(account);
  return (
    <div className="space-y-5 lg:sticky lg:top-20">
      <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] space-y-4">
        <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          Email message
        </p>
        <div>
          <label className="block text-[11px] text-[var(--muted-foreground)] mb-1.5">
            Subject line <span className="text-red-400">*</span>
          </label>
          <input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            onBlur={onSubjectBlur}
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
            onChange={(e) => onPreviewTextChange(e.target.value)}
            onBlur={onPreviewTextBlur}
            placeholder="Lock in your appointment this week."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] mb-1.5">
            From
            <Tooltip label="The sender name set in Settings → Email & Texts → Sending Config, or this account’s name when none is set. The address comes from the same place.">
              <InformationCircleIcon className="w-3.5 h-3.5" aria-label="About the From line" />
            </Tooltip>
          </label>
          <p className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm text-[var(--foreground)] truncate">
            {account?.senderEmail ? (
              fromLine
            ) : (
              <span className="text-amber-400">
                No sending address yet — add one in Settings → Email & Texts → Sending Config.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Shared bottom action bar
// ─────────────────────────────────────────────────────

function BottomBar({
  onBack,
  onContinue,
  continueLabel,
  continueDisabled,
  rightHint,
}: {
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
  continueDisabled?: boolean;
  rightHint?: string;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-4">
          {rightHint && (
            <p key={rightHint} className="text-xs text-[var(--muted-foreground)] animate-fade-in-up">
              {rightHint}
            </p>
          )}
          <PrimaryButton onClick={onContinue} disabled={continueDisabled}>
            {continueLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
