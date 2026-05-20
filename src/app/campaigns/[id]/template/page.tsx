'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import PrimaryButton from '@/components/primary-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface TemplateLibraryItem {
  id: string;
  design: string;
  name: string;
  category?: string | null;
  type?: string;
  published?: boolean;
  publishedAt?: string | null;
  updatedAt: string;
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
}

type SortKey = 'updated' | 'name';

function formatUpdated(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MessageStepPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const { accounts } = useAccount();

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);

  // Editor state — kept local until persisted on blur or Continue.
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
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
      .then((campaign) => {
        if (cancelled) return;
        if (!campaign) {
          toast.error('Campaign not found');
          router.push('/campaigns');
          return;
        }
        setDraft(campaign);
        setSubject(campaign.subject || '');
        setPreviewText(campaign.previewText || '');
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
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to save');
    }
    return data?.campaign || null;
  }

  async function handleSubjectBlur() {
    if (!draft) return;
    if (subject === draft.subject) return;
    try {
      const updated = await patchDraft({ subject });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save subject');
    }
  }

  async function handlePreviewTextBlur() {
    if (!draft) return;
    if (previewText === draft.previewText) return;
    try {
      const updated = await patchDraft({ previewText });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preview text');
    }
  }

  async function handleContinue() {
    if (!draft) return;
    setSaving(true);
    try {
      // Persist any pending field changes before navigating.
      const patch: Record<string, unknown> = {};
      if (subject !== draft.subject) patch.subject = subject;
      if (previewText !== draft.previewText) patch.previewText = previewText;
      if (Object.keys(patch).length > 0) {
        await patchDraft(patch);
      }
      router.push(`/campaigns/${encodeURIComponent(id)}/schedule`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeTemplate() {
    if (!draft) return;
    if (!confirm('Clear the current template and pick a different one? Your subject and preview text will be kept.')) {
      return;
    }
    try {
      const updated = await patchDraft({ htmlContent: '' });
      if (updated) setDraft(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change template');
    }
  }

  const accountKey = draft?.accountKeys[0] || '';
  const account = accountKey ? accounts[accountKey] : null;

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

  // State A: no template loaded → show picker
  if (!draft?.htmlContent) {
    return (
      <TemplatePickerView
        campaignId={id}
        campaignName={draft?.name || 'Campaign'}
        onApplied={async () => {
          const next = await fetchDraft();
          if (next) {
            setDraft(next);
            setSubject(next.subject || '');
            setPreviewText(next.previewText || '');
          }
        }}
      />
    );
  }

  // State B: template loaded → Klaviyo-style editor (settings + preview)
  return (
    <div className="pb-32">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-6 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
              Message
            </p>
            <h1 className="text-2xl font-bold">{draft.name}</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
              Set your subject and preview, then edit the content.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
          {/* Left: settings */}
          <div className="space-y-5">
            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Subject Line <span className="text-red-400">*</span>
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
                <label className="block text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Preview Text
                </label>
                <input
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  onBlur={handlePreviewTextBlur}
                  placeholder="Lock in your appointment this week."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
                  Shown in the inbox preview after the subject.
                </p>
              </div>
            </div>

            <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)] space-y-3">
              <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Sender
              </p>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">From name</p>
                <p className="text-sm font-medium mt-0.5">
                  {account?.senderName || account?.dealer || (
                    <span className="text-[var(--muted-foreground)]">Not configured</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">From email</p>
                <p className="text-sm font-medium mt-0.5">
                  {account?.senderEmail || (
                    <span className="text-[var(--muted-foreground)]">Falls back to global SMTP_FROM</span>
                  )}
                </p>
              </div>
              {account?.replyToEmail && (
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Reply-to</p>
                  <p className="text-sm font-medium mt-0.5">{account.replyToEmail}</p>
                </div>
              )}
              <p className="text-[11px] text-[var(--muted-foreground)] pt-2 border-t border-[var(--border)]">
                Configure in Subaccount Settings → Sending.
              </p>
            </div>

            <button
              type="button"
              onClick={handleChangeTemplate}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
            >
              <ArrowsRightLeftIcon className="w-4 h-4" />
              Change template
            </button>
          </div>

          {/* Right: preview */}
          <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Preview
              </p>
              <button
                type="button"
                onClick={() =>
                  router.push(`/campaigns/${encodeURIComponent(id)}/edit`)
                }
                className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" />
                Edit
              </button>
            </div>
            <div className="bg-[var(--muted)]/30 p-4 flex-1 min-h-[600px]">
              <iframe
                title="Campaign preview"
                srcDoc={draft.htmlContent}
                sandbox=""
                className="w-full h-full min-h-[580px] bg-white rounded-lg border border-[var(--border)]"
              />
            </div>
          </div>
        </div>
      </div>

      <BottomBar
        onBack={() => router.push(`/campaigns/${encodeURIComponent(id)}/recipients`)}
        onContinue={handleContinue}
        continueDisabled={!subject.trim() || saving}
        continueLabel={saving ? 'Saving…' : 'Continue to Schedule'}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// State A: template picker (when no htmlContent)
// ─────────────────────────────────────────────────────

function TemplatePickerView({
  campaignId,
  campaignName,
  onApplied,
}: {
  campaignId: string;
  campaignName: string;
  onApplied: () => Promise<void>;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((items: unknown) => {
        if (cancelled) return;
        setTemplates(Array.isArray(items) ? (items as TemplateLibraryItem[]) : []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? templates.filter(
          (t) =>
            t.name?.toLowerCase().includes(query) ||
            t.design?.toLowerCase().includes(query) ||
            t.category?.toLowerCase().includes(query),
        )
      : templates;
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return (a.name || a.design).localeCompare(b.name || b.design);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }, [templates, search, sort]);

  async function applyTemplate(design: string) {
    setApplying(true);
    try {
      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(design)}&format=raw`);
      const rawData = await rawRes.json().catch(() => ({}));
      if (!rawRes.ok || !rawData?.raw) {
        throw new Error(rawData?.error || 'Failed to load template');
      }
      const raw = String(rawData.raw);
      // Pull subject from frontmatter title if present
      const titleMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      let subject = '';
      if (titleMatch) {
        const line = titleMatch[1].match(/^title:\s*(.+)$/m);
        if (line) subject = line[1].trim().replace(/^["']|["']$/g, '');
      }
      const patchRes = await fetch(`/api/campaigns/email/${encodeURIComponent(campaignId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject || campaignName,
          htmlContent: raw,
          sourceType: 'template-library',
        }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to apply template');
      }
      await onApplied();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  }

  return (
    <div className="pb-32">
      <div className="max-w-6xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Message
          </p>
          <h1 className="text-2xl font-bold">{campaignName}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Pick a starting point. You&apos;ll customize the content in the next step.
          </p>
        </div>

        <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-[var(--border)] flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="updated">Recently updated</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
          <div className="p-5">
            {loading ? (
              <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2 py-8">
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Loading templates…
              </p>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12">
                <DocumentTextIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">
                  {search ? 'No templates match that search.' : 'No templates in the library yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPreviewDesign(t.design)}
                    className="text-left rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/[0.03] transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--primary)]/10 group-hover:text-[var(--primary)]">
                        <DocumentTextIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">
                          {t.name || t.design}
                        </p>
                        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 truncate">
                          {t.category || t.design}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          {t.published && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90">
                              <CheckCircleIcon className="w-3 h-3" />
                              Published
                            </span>
                          )}
                          {t.updatedAt && (
                            <span className="text-[10px] text-[var(--muted-foreground)]">
                              Updated {formatUpdated(t.updatedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewDesign && (
        <TemplatePreviewModal
          design={previewDesign}
          name={templates.find((t) => t.design === previewDesign)?.name || previewDesign}
          onClose={() => !applying && setPreviewDesign(null)}
          onUse={() => applyTemplate(previewDesign)}
          applying={applying}
        />
      )}

      <BottomBar
        onBack={() =>
          router.push(`/campaigns/${encodeURIComponent(campaignId)}/recipients`)
        }
        rightSlot={
          <p className="text-xs text-[var(--muted-foreground)]">
            Click a template to preview, then use it.
          </p>
        }
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Preview modal (shown over the picker)
// ─────────────────────────────────────────────────────

function TemplatePreviewModal({
  design,
  name,
  onClose,
  onUse,
  applying,
}: {
  design: string;
  name: string;
  onClose: () => void;
  onUse: () => void;
  applying: boolean;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(design)}&format=raw`);
        const rawData = await rawRes.json().catch(() => ({}));
        if (!rawRes.ok || !rawData?.raw) {
          throw new Error(rawData?.error || 'Failed to load template');
        }
        const previewRes = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: String(rawData.raw), previewValues: {} }),
        });
        const previewData = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok || !previewData?.html) {
          throw new Error(previewData?.error || 'Failed to compile preview');
        }
        if (!cancelled) setHtml(String(previewData.html));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [design]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-overlay-in p-6"
      onClick={onClose}
    >
      <div
        className="glass-modal w-[800px] max-w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h3 className="text-base font-semibold truncate pr-4">{name}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden bg-[var(--muted)]/30 flex items-stretch p-4">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Loading preview…
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : (
            <iframe
              title="Template preview"
              srcDoc={html}
              className="flex-1 bg-white rounded-lg border border-[var(--border)]"
              sandbox=""
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <PrimaryButton onClick={onUse} disabled={applying || loading || Boolean(error)}>
            {applying ? 'Applying…' : 'Use template'}
          </PrimaryButton>
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
  continueLabel = 'Continue',
  continueDisabled,
  rightSlot,
}: {
  onBack: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  rightSlot?: React.ReactNode;
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
        {onContinue ? (
          <PrimaryButton onClick={onContinue} disabled={continueDisabled}>
            {continueLabel}
          </PrimaryButton>
        ) : (
          rightSlot
        )}
      </div>
    </div>
  );
}
