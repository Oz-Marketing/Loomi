'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount, type AccountData } from '@/contexts/account-context';
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
          router.push('/campaigns');
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
        `/templates/editor?design=${encodeURIComponent(design)}&campaignId=${encodeURIComponent(id)}`,
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
      router.push(`/campaigns/${encodeURIComponent(id)}/schedule`);
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
                  `/templates/editor?design=${encodeURIComponent(slug)}&campaignId=${encodeURIComponent(id)}`,
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
        onBack={() => router.push(`/campaigns/${encodeURIComponent(id)}/recipients`)}
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
// Right (no template loaded): template library
// ─────────────────────────────────────────────────────

function TemplateLibraryPanel({ onSelect }: { onSelect: (design: string) => void }) {
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');

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

  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--border)] flex-wrap">
        <p className="text-base font-semibold">Templates</p>
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[460px]">
          <div className="relative flex-1">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTemplates.map((t) => (
              <TemplateCard key={t.id} template={t} onClick={() => onSelect(t.design)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Individual template card with live iframe thumbnail.
function TemplateCard({
  template,
  onClick,
}: {
  template: TemplateLibraryItem;
  onClick: () => void;
}) {
  const [thumbHtml, setThumbHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rawRes = await fetch(
          `/api/templates?design=${encodeURIComponent(template.design)}&format=raw`,
        );
        const rawData = await rawRes.json().catch(() => ({}));
        if (!rawRes.ok || !rawData?.raw) return;
        const previewRes = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: String(rawData.raw), previewValues: {} }),
        });
        const previewData = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok || !previewData?.html) return;
        if (!cancelled) setThumbHtml(String(previewData.html));
      } catch {
        // Thumbnail is decorative — silent failure is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.design]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden hover:border-[var(--primary)]/60 transition-colors group flex flex-col"
    >
      {/* Thumbnail */}
      <div className="aspect-[3/4] relative overflow-hidden bg-white border-b border-[var(--border)]">
        {thumbHtml ? (
          <iframe
            title=""
            aria-hidden
            srcDoc={thumbHtml}
            sandbox=""
            className="absolute top-0 left-0 origin-top-left pointer-events-none"
            style={{
              width: '600px',
              height: '800px',
              transform: 'scale(0.45)',
              transformOrigin: 'top left',
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ArrowPathIcon className="w-5 h-5 text-[var(--muted-foreground)] animate-spin opacity-50" />
          </div>
        )}
      </div>
      {/* Meta */}
      <div className="p-3 flex-1">
        <p className="text-sm font-medium text-[var(--foreground)] truncate">
          {template.name || template.design}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {template.published && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90">
              <CheckCircleIcon className="w-3 h-3" />
              Published
            </span>
          )}
          {template.updatedAt && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Updated {formatUpdated(template.updatedAt)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Right (template loaded): preview + Edit + ... menu
// ─────────────────────────────────────────────────────

function SelectedTemplatePanel({
  htmlContent,
  onEdit,
  onChangeTemplate,
}: {
  htmlContent: string;
  onEdit: () => void;
  onChangeTemplate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          Preview
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60"
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
              aria-label="Template options"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] glass-dropdown p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onChangeTemplate();
                  }}
                  className="w-full text-left px-3 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] inline-flex items-center gap-2"
                >
                  <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                  Change template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="bg-[var(--muted)]/30 p-4 flex-1 min-h-[600px]">
        <iframe
          title="Campaign preview"
          srcDoc={htmlContent}
          sandbox=""
          className="w-full h-full min-h-[580px] bg-white rounded-lg border border-[var(--border)]"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Template preview modal (used by library)
// ─────────────────────────────────────────────────────

function TemplatePreviewModal({
  design,
  onClose,
  onUse,
  applying,
}: {
  design: string;
  onClose: () => void;
  onUse: () => void;
  applying: boolean;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(design);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

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
        const raw = String(rawData.raw);
        const titleMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
        if (titleMatch) {
          const line = titleMatch[1].match(/^title:\s*(.+)$/m);
          if (line) setName(line[1].trim().replace(/^["']|["']$/g, ''));
        }
        const previewRes = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: raw, previewValues: {} }),
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
        className="glass-modal w-[1100px] max-w-full h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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

        {/* Desktop / mobile toggle row */}
        <div className="flex items-center justify-center px-6 py-2.5 border-b border-[var(--border)] flex-shrink-0">
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            <button
              type="button"
              onClick={() => setPreviewMode('desktop')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                previewMode === 'desktop'
                  ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              aria-pressed={previewMode === 'desktop'}
            >
              <ComputerDesktopIcon className="w-4 h-4" />
              Desktop
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('mobile')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                previewMode === 'mobile'
                  ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              aria-pressed={previewMode === 'mobile'}
            >
              <DevicePhoneMobileIcon className="w-4 h-4" />
              Mobile
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--muted)]/30 p-4 flex justify-center">
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
              sandbox=""
              className={`bg-white rounded-lg border border-[var(--border)] h-full ${
                previewMode === 'mobile' ? 'w-[390px]' : 'w-full'
              }`}
            />
          )}
        </div>

        {/* Footer */}
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
