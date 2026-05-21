'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount, type AccountData } from '@/contexts/account-context';
import PrimaryButton from '@/components/primary-button';
import { TemplateLibraryPanel } from '@/components/campaigns/template-library-panel';
import { TemplatePreviewModal } from '@/components/campaigns/template-preview-modal';
import { SelectedTemplatePanel } from '@/components/campaigns/selected-template-panel';

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

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Templates are stored in raw form (v2 JSON for drag-and-drop, raw HTML
 * for HTML-mode). Both must be compiled before they can be rendered in
 * an iframe or sent as an email. /api/preview handles either format and
 * returns ready-to-render HTML.
 */
async function compileTemplate(raw: string): Promise<string> {
  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: raw, previewValues: {} }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.html) {
    throw new Error(data?.error || 'Failed to compile template');
  }
  return String(data.html);
}

export default function MessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id } = use(params);
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
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  async function fetchDraft(): Promise<DraftCampaign | null> {
    const res = await fetch(`/api/campaigns/email/${encodeURIComponent(id)}`);
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
          toast.error('Campaign not found');
          router.push('/messaging/campaigns');
          return;
        }

        // Multi-channel context: once a template is loaded on the email
        // draft, the user belongs on the multi message page where they
        // can switch to the SMS tab. The email-only settings/preview
        // view (State B) is only the right home for single-channel
        // email campaigns.
        if (fromMulti && campaign.htmlContent) {
          router.replace(`/campaigns/multi/${encodeURIComponent(id)}/message`);
          return;
        }

        // If the campaign references a template, re-fetch the latest content
        // and compile it so edits made in the editor flow into this campaign.
        // We store the COMPILED html on the campaign so the iframe preview
        // and the send pipeline both get email-ready HTML (drag-and-drop
        // templates are stored as v2 JSON in raw form, which would render
        // as code in an iframe otherwise).
        const meta = parseMetadata(campaign.metadata);
        const templateSlug = typeof meta.templateSlug === 'string' ? meta.templateSlug : '';
        let synced = campaign;
        if (templateSlug) {
          try {
            const rawRes = await fetch(
              `/api/templates?design=${encodeURIComponent(templateSlug)}&format=raw`,
            );
            const rawData = await rawRes.json().catch(() => ({}));
            const latestRaw = String(rawData?.raw || '');
            if (rawRes.ok && latestRaw) {
              const compiled = await compileTemplate(latestRaw);
              if (compiled !== campaign.htmlContent) {
                const updated = await patchDraft({ htmlContent: compiled });
                if (updated) synced = updated;
              }
            }
          } catch {
            // Best-effort sync; if it fails we still have the old snapshot.
          }
        }

        setDraft(synced);
        setSubject(synced.subject || '');
        setPreviewText(synced.previewText || '');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function patchDraft(patch: Record<string, unknown>): Promise<DraftCampaign | null> {
    const res = await fetch(`/api/campaigns/email/${encodeURIComponent(id)}`, {
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

  async function applyTemplate(design: string) {
    if (!draft) return;
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
      // Compile the template now so the campaign carries email-ready HTML
      // (handles both drag-and-drop v2 JSON and raw HTML templates).
      const compiled = await compileTemplate(raw);
      // Record the template slug on the campaign so we can re-fetch the
      // latest content when the user returns from the editor.
      const meta = { ...parseMetadata(draft.metadata), templateSlug: design };
      const updated = await patchDraft({
        subject: newSubject || draft.name,
        htmlContent: compiled,
        sourceType: 'template-library',
        metadata: JSON.stringify(meta),
      });
      if (updated) {
        setDraft(updated);
        setSubject(updated.subject);
      }
      setPreviewDesign(null);
      // Klaviyo pattern: selecting a template drops you straight into the
      // existing template editor so the user can adjust before scheduling.
      // campaignId is passed so the editor shows campaign-aware actions
      // (Schedule + Manage template) instead of Save Template.
      router.push(
        `/templates/editor?design=${encodeURIComponent(design)}&campaignId=${encodeURIComponent(id)}${multiSuffix}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  }

  async function handleChangeTemplate() {
    if (!draft) return;
    if (!confirm('Clear the current template and pick a different one?')) return;
    try {
      const updated = await patchDraft({ htmlContent: '' });
      if (updated) setDraft(updated);
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
        fromMulti
          ? `/campaigns/multi/${encodeURIComponent(id)}/schedule`
          : `/campaigns/${encodeURIComponent(id)}/schedule`,
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
          Loading campaign…
        </p>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Message
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
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
              onEdit={() => {
                const meta = parseMetadata(draft?.metadata);
                const slug = typeof meta.templateSlug === 'string' ? meta.templateSlug : '';
                if (!slug) {
                  toast.error("Can't open editor — this campaign has no template slug recorded.");
                  return;
                }
                router.push(
                  `/templates/editor?design=${encodeURIComponent(slug)}&campaignId=${encodeURIComponent(id)}${multiSuffix}`,
                );
              }}
              onChangeTemplate={handleChangeTemplate}
            />
          ) : (
            <TemplateLibraryPanel onSelect={setPreviewDesign} />
          )}
        </div>
      </div>

      {previewDesign && (
        <TemplatePreviewModal
          design={previewDesign}
          onClose={() => !applying && setPreviewDesign(null)}
          onUse={() => applyTemplate(previewDesign)}
          applying={applying}
        />
      )}

      <BottomBar
        onBack={() =>
          router.push(
            fromMulti
              ? `/campaigns/multi/${encodeURIComponent(id)}/message`
              : `/campaigns/${encodeURIComponent(id)}/recipients`,
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
          <label className="block text-[11px] text-[var(--muted-foreground)] mb-1.5">
            Sender name <span className="text-red-400">*</span>
          </label>
          <input
            value={account?.senderName || account?.dealer || ''}
            readOnly
            disabled
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm text-[var(--foreground)] cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[var(--muted-foreground)] mb-1.5">
            Sender email <span className="text-red-400">*</span>
          </label>
          <input
            value={account?.senderEmail || ''}
            readOnly
            disabled
            placeholder="Configure in Sending settings"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm text-[var(--foreground)] cursor-not-allowed placeholder:text-[var(--muted-foreground)]"
          />
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1.5">
            Configure in Subaccount Settings → Sending.
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
            <p className="text-xs text-[var(--muted-foreground)]">{rightHint}</p>
          )}
          <PrimaryButton onClick={onContinue} disabled={continueDisabled}>
            {continueLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
