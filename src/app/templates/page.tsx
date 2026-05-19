'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  BookOpenIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  TagIcon,
  Square2StackIcon,
  PencilIcon,
  ArrowPathIcon,
  AdjustmentsHorizontalIcon,
  CursorArrowRaysIcon,
  CodeBracketIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  BuildingOfficeIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { TemplatePreview } from '@/components/template-preview';
import { CloneToAccountsModal } from '@/components/clone-to-accounts-modal';
import {
  parseTemplateTagsPayload,
  assignmentsMapToArray,
} from '@/lib/template-tags-payload';
import PrimaryButton from '@/components/primary-button';

// ── Types ──

interface TemplateEntry {
  design: string;
  name: string;
  editorType?: 'code' | 'visual' | string | null;
  updatedAt?: string;
  createdBy?: string | null;
  createdByAvatar?: string | null;
  updatedBy?: string | null;
  updatedByAvatar?: string | null;
  published?: boolean;
  publishedAt?: string | null;
  publishedBy?: string | null;
}

type PublishFilter = 'all' | 'published' | 'draft';

interface TagData {
  tags: string[];
  assignments: Record<string, string[]>;
}

interface BulkResult {
  dryRun: boolean;
  totalTemplates: number;
  affectedCount: number;
  appliedCount?: number;
  totalChanges: number;
  errors: { design: string; error: string }[];
  affectedTemplates: { design: string; summary: string }[];
}

// ── Helpers ──

function formatDesign(d: string) {
  return d
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getLibraryTemplateTypeLabel(template: Pick<TemplateEntry, 'editorType'>): 'HTML' | 'Drag & Drop' {
  return template.editorType === 'visual' ? 'Drag & Drop' : 'HTML';
}

function buildLibraryEditorHref(
  template: Pick<TemplateEntry, 'design' | 'editorType'> | string,
  options?: { campaignDraft?: boolean; editorType?: TemplateEntry['editorType'] },
): string {
  const design = typeof template === 'string' ? template : template.design;
  const editorType = typeof template === 'string' ? options?.editorType : template.editorType;
  const search = new URLSearchParams({ design });
  if (editorType === 'code') {
    search.set('builder', 'html');
  }
  if (options?.campaignDraft) {
    search.set('campaignDraft', '1');
  }
  return `/templates/editor?${search.toString()}`;
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'template';
}

function updateLibraryTemplateTitle(raw: string, title: string): string {
  const nextTitle = JSON.stringify(title.trim());
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);

  if (!frontmatterMatch) {
    return `---\ntitle: ${nextTitle}\n---\n\n${raw}`;
  }

  const existingFrontmatter = frontmatterMatch[1];
  const hasTitle = /^title:\s*.*$/m.test(existingFrontmatter);
  const updatedFrontmatter = hasTitle
    ? existingFrontmatter.replace(/^title:\s*.*$/m, `title: ${nextTitle}`)
    : `title: ${nextTitle}\n${existingFrontmatter}`;
  const rest = raw.slice(frontmatterMatch[0].length);

  return `---\n${updatedFrontmatter}\n---\n${rest}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadLibraryTemplateScreenshot(
  design: string,
  fileBaseName: string,
): Promise<void> {
  const params = new URLSearchParams({ design });
  const res = await fetch(`/api/templates/screenshot?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Screenshot failed (${res.status})`,
    );
  }

  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Screenshot returned empty data');
  }

  downloadBlob(blob, `${sanitizeFileName(fileBaseName)}.png`);
}

function openLibraryPreviewInNewTab(design: string): void {
  const url = `/api/preview?design=${encodeURIComponent(design)}&format=html`;
  const win = window.open(url, '_blank');
  if (!win) {
    toast.error('Unable to open a new tab. Please allow pop-ups.');
    return;
  }
  try {
    win.opener = null;
  } catch {
    // Ignore browser restrictions around opener.
  }
}

// ═══════════════════════════════════════════════════════════════════
// ── Main Page ──
// ═══════════════════════════════════════════════════════════════════

export default function TemplateLibraryPage() {
  const searchParams = useSearchParams();
  const { userRole } = useAccount();
  const campaignDraftQuery = searchParams.get('campaignDraft') === '1' ? '?campaignDraft=1' : '';

  const isClient = userRole === 'client';
  // developer, super_admin, and admin all get full management access to the library.
  const canManage = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  return (
    <div>
      {/* Sticky header */}
      <div className="page-sticky-header mb-6">
        <div className="flex items-center gap-3">
          <BookOpenIcon className="w-7 h-7 text-[var(--primary)]" />
          <div>
            <h1 className="text-2xl font-bold">Templates</h1>
            <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
              {canManage
                ? 'Shared template library. Publish templates to make them available to sub-accounts.'
                : 'Browse the shared template library.'}
            </p>
          </div>
        </div>
      </div>

      {canManage && <ManagementView campaignDraftQuery={campaignDraftQuery} />}
      {isClient && <ReadOnlyView campaignDraftQuery={campaignDraftQuery} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Management View (full management — developer, super_admin, admin) ──
// ═══════════════════════════════════════════════════════════════════

function ManagementView({ campaignDraftQuery }: { campaignDraftQuery: string }) {
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreateChoice, setShowCreateChoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDesigns, setSelectedDesigns] = useState<Set<string>>(new Set());
  const [renameDesign, setRenameDesign] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [cloneToAccountDesign, setCloneToAccountDesign] = useState<string | null>(null);
  const [downloadingDesign, setDownloadingDesign] = useState<string | null>(null);
  const [publishFilter, setPublishFilter] = useState<PublishFilter>('all');
  const [publishingDesign, setPublishingDesign] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;

  const loadTemplates = async () => {
    try {
      const [tRes, tagRes] = await Promise.all([
        fetch('/api/templates'),
        fetch('/api/template-tags'),
      ]);
      const tData = await tRes.json();
      const tagResult = await tagRes.json();
      setTemplates(Array.isArray(tData) ? tData : []);
      setTagData(parseTemplateTagsPayload(tagResult));
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  };

  useEffect(() => { loadTemplates(); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const tplMap = useMemo(() => {
    const map: Record<string, TemplateEntry> = {};
    templates.forEach((t) => { map[t.design] = t; });
    return map;
  }, [templates]);

  const templateKeys = useMemo(() => templates.map((t) => t.design), [templates]);

  const filtered = useMemo(() => {
    let list = templates;
    if (publishFilter === 'published') {
      list = list.filter((t) => t.published === true);
    } else if (publishFilter === 'draft') {
      list = list.filter((t) => t.published !== true);
    }
    if (selectedTag) {
      const assigned = tagData.assignments;
      list = list.filter((t) => (assigned[t.design] || []).includes(selectedTag));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.design.toLowerCase().includes(q),
      );
    }
    return list;
  }, [templates, publishFilter, selectedTag, search, tagData]);

  const draftCount = useMemo(() => templates.filter((t) => t.published !== true).length, [templates]);
  const publishedCount = useMemo(() => templates.filter((t) => t.published === true).length, [templates]);

  const filteredKeys = useMemo(() => filtered.map((t) => t.design), [filtered]);

  // Pick a default name that won't collide with anything already in the
  // library. Walks "Untitled Template", "Untitled Template 2", etc. so
  // the rep lands in the editor with a clean default they can rename.
  const nextUntitledName = (): string => {
    const existing = new Set(
      templates.map((t) => (t.name || formatDesign(t.design)).trim().toLowerCase()),
    );
    if (!existing.has('untitled template')) return 'Untitled Template';
    for (let n = 2; n < 1000; n++) {
      const candidate = `Untitled Template ${n}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    // Fallback — astronomically unlikely to land here, but keep the
    // function total.
    return `Untitled Template ${Date.now()}`;
  };

  const createTemplate = async (mode: 'visual' | 'code') => {
    if (saving) return;
    setSaving(true);
    const defaultName = nextUntitledName();
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: defaultName, mode }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create'); setSaving(false); return; }
      setShowCreateChoice(false);
      // No loadTemplates() here — we're navigating straight to the
      // editor, so refetching the list is wasted work.
      router.push(buildLibraryEditorHref(
        { design: data.design, editorType: mode },
        { campaignDraft: isCampaignDraft },
      ));
    } catch { toast.error('Failed to create'); }
    setSaving(false);
  };

  const deleteTemplate = async (design: string) => {
    const confirmed = await confirm({
      title: 'Delete Template',
      message: `Delete "${formatDesign(design)}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/templates?design=${encodeURIComponent(design)}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete'); return; }
      toast.success('Template deleted');
      await loadTemplates();
    } catch { toast.error('Failed to delete'); }
  };

  const cloneTemplate = async (sourceDesign: string) => {
    try {
      const res = await fetch('/api/templates/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDesign }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to clone'); return; }
      toast.success(`Cloned as "${data.name}"`);
      await loadTemplates();
    } catch { toast.error('Failed to clone'); }
  };

  const setPublishedState = async (designs: string[], published: boolean) => {
    if (designs.length === 0) return;
    const single = designs.length === 1 ? designs[0] : null;
    if (single) setPublishingDesign(single);
    try {
      const res = await fetch('/api/templates/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: designs, published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to update publish state');
        return;
      }
      // Optimistic update so the pill flips immediately without a full reload.
      setTemplates((prev) =>
        prev.map((t) =>
          designs.includes(t.design) ? { ...t, published } : t,
        ),
      );
      const count = designs.length;
      const label = published ? 'Published' : 'Unpublished';
      toast.success(`${label} ${count} template${count === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to update publish state');
    } finally {
      if (single) setPublishingDesign(null);
    }
  };

  const openRenameModal = (template: TemplateEntry) => {
    setRenameDesign(template.design);
    setRenameValue(template.name || formatDesign(template.design));
  };

  const closeRenameModal = () => {
    if (renaming) return;
    setRenameDesign(null);
    setRenameValue('');
  };

  const handleRenameTemplate = async () => {
    if (!renameDesign) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error('Template name is required');
      return;
    }

    const currentName = tplMap[renameDesign]?.name || formatDesign(renameDesign);
    if (nextName === currentName.trim()) {
      closeRenameModal();
      return;
    }

    setRenaming(true);
    try {
      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(renameDesign)}&format=raw`);
      const rawData = await rawRes.json().catch(() => ({}));
      if (!rawRes.ok || typeof rawData?.raw !== 'string') {
        const message = typeof rawData?.error === 'string' ? rawData.error : 'Failed to load template';
        toast.error(message);
        return;
      }

      const updatedRaw = updateLibraryTemplateTitle(rawData.raw, nextName);
      const saveRes = await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design: renameDesign,
          raw: updatedRaw,
        }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        const message = typeof saveData?.error === 'string' ? saveData.error : 'Failed to rename template';
        toast.error(message);
        return;
      }

      toast.success('Template renamed');
      closeRenameModal();
      await loadTemplates();
    } catch {
      toast.error('Failed to rename template');
    } finally {
      setRenaming(false);
    }
  };

  const handleToggleSelect = (design: string) => {
    setSelectedDesigns((prev) => {
      const next = new Set(prev);
      if (next.has(design)) next.delete(design);
      else next.add(design);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedDesigns.size === 0) return;
    const count = selectedDesigns.size;
    const confirmed = await confirm({
      title: 'Delete Templates',
      message: `Delete ${count} template${count !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    const results = await Promise.allSettled(
      Array.from(selectedDesigns).map((design) =>
        fetch(`/api/templates?design=${encodeURIComponent(design)}`, { method: 'DELETE' }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      toast.error(`Deleted ${succeeded}, failed ${failed}`);
    } else {
      toast.success(`Deleted ${succeeded} template${succeeded !== 1 ? 's' : ''}`);
    }

    setSelectMode(false);
    setSelectedDesigns(new Set());
    await loadTemplates();
  };

  const saveTagData = async (data: TagData) => {
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: data.tags,
          assignments: assignmentsMapToArray(data.assignments),
        }),
      });
      setTagData(data);
      setShowTagModal(false);
      toast.success('Tags saved');
    } catch { toast.error('Failed to save tags'); }
  };

  const handleDownloadScreenshot = async (template: TemplateEntry) => {
    setDownloadingDesign(template.design);
    try {
      await downloadLibraryTemplateScreenshot(
        template.design,
        template.name || formatDesign(template.design),
      );
      toast.success('Template screenshot downloaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download screenshot';
      toast.error(message);
    } finally {
      setDownloadingDesign((prev) => (prev === template.design ? null : prev));
    }
  };

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  return (
    <div>
      {/* Toolbar */}
      {selectMode ? (
        <div className="flex items-center justify-between gap-3 mb-4 px-4 py-3 rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/20">
          <div className="flex items-center gap-3">
            <CheckCircleIcon className="w-5 h-5 text-[var(--primary)]" />
            <span className="text-sm font-medium">
              {selectedDesigns.size} selected
            </span>
            <button
              onClick={() => {
                const allFilteredDesigns = filtered.map((t) => t.design);
                if (selectedDesigns.size === allFilteredDesigns.length) {
                  setSelectedDesigns(new Set());
                } else {
                  setSelectedDesigns(new Set(allFilteredDesigns));
                }
              }}
              className="text-xs text-[var(--primary)] hover:underline"
            >
              {selectedDesigns.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selectedDesigns.size > 0 && (
              <>
                <button
                  onClick={async () => {
                    const slugs = Array.from(selectedDesigns);
                    await setPublishedState(slugs, true);
                    setSelectMode(false);
                    setSelectedDesigns(new Set());
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-400 border border-emerald-400/30 rounded-lg hover:bg-emerald-500/10 transition-colors"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  Publish
                </button>
                <button
                  onClick={async () => {
                    const slugs = Array.from(selectedDesigns);
                    await setPublishedState(slugs, false);
                    setSelectMode(false);
                    setSelectedDesigns(new Set());
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-400 border border-amber-400/30 rounded-lg hover:bg-amber-500/10 transition-colors"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                  Unpublish
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-400 border border-red-400/30 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                  Delete
                </button>
              </>
            )}
            <button
              onClick={() => { setSelectMode(false); setSelectedDesigns(new Set()); }}
              className="px-3 py-1.5 text-sm font-medium text-[var(--muted-foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative flex-1 max-w-xs">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates..."
                className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
              />
            </div>
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40">
              {(
                [
                  { value: 'all' as const, label: 'All', count: templates.length },
                  { value: 'published' as const, label: 'Published', count: publishedCount },
                  { value: 'draft' as const, label: 'Drafts', count: draftCount },
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPublishFilter(opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    publishFilter === opt.value
                      ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {opt.label} <span className="tabular-nums text-[10px] opacity-70">{opt.count}</span>
                </button>
              ))}
            </div>
            {tagData.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    !selectedTag
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  All
                </button>
                {tagData.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                      selectedTag === tag
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              title="Select templates"
            >
              <CheckCircleIcon className="w-4 h-4" />
              Select
            </button>
            <button
              onClick={() => setShowTagModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              title="Manage Tags"
            >
              <TagIcon className="w-4 h-4" />
              Tags
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              title="Bulk Edit"
            >
              <AdjustmentsHorizontalIcon className="w-4 h-4" />
              Bulk Edit
            </button>
            <PrimaryButton onClick={() => setShowCreateChoice(true)}>
              <PlusIcon className="w-4 h-4" />
              Create Template
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Create choice modal — single-step picker. Selecting a builder
          creates the template immediately with a default "Untitled
          Template" name and navigates to the editor, where the user
          can rename it. */}
      {showCreateChoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => !saving && setShowCreateChoice(false)}
        >
          <div className="glass-modal w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Create New Template</h3>
              <button
                onClick={() => !saving && setShowCreateChoice(false)}
                disabled={saving}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose how you&apos;d like to build your template:</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => createTemplate('visual')}
                  disabled={saving}
                  className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                    <CursorArrowRaysIcon className="w-6 h-6 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-1">Drag &amp; Drop</h4>
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">Visual builder with sections</p>
                  </div>
                </button>
                <button
                  onClick={() => createTemplate('code')}
                  disabled={saving}
                  className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                    <CodeBracketIcon className="w-6 h-6 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-1">HTML Editor</h4>
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">Write or paste raw HTML</p>
                  </div>
                </button>
              </div>
              {saving && (
                <p className="text-[11px] text-[var(--muted-foreground)] text-center mt-4">
                  Creating template…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
          <BookOpenIcon className="w-8 h-8 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)] text-sm">
            {search || selectedTag ? 'No templates were found.' : 'No templates yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const isOpen = menuOpen === t.design;
            const isSelected = selectedDesigns.has(t.design);
            const isDownloading = downloadingDesign === t.design;
            const isPublished = t.published === true;
            const isPublishing = publishingDesign === t.design;
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            return (
              <div
                key={t.design}
                className={`group relative glass-card rounded-xl overflow-hidden ${isOpen ? 'z-10' : ''}`}
              >
                {/* Selection ring overlay – renders above iframe */}
                {isSelected && (
                  <div className="absolute inset-0 border-3 border-[var(--primary)] rounded-xl z-20 pointer-events-none" />
                )}
                {/* Preview area */}
                <div
                  className="cursor-pointer relative"
                  onClick={() => {
                    if (selectMode) { handleToggleSelect(t.design); return; }
                    setPreviewDesign(t.design);
                  }}
                >
                  <TemplatePreview design={t.design} height={220} />
                  {selectMode && (
                    <div className="absolute inset-0 bg-black/10">
                      <div className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-white/80 bg-black/20'}`}>
                        {isSelected && <CheckCircleIcon className="w-4 h-4" />}
                      </div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="text-sm font-medium truncate hover:text-[var(--primary)] transition-colors cursor-pointer"
                      onClick={() => {
                        if (selectMode) { handleToggleSelect(t.design); return; }
                        setPreviewDesign(t.design);
                      }}
                    >
                      {t.name || formatDesign(t.design)}
                    </span>

                    {/* Menu */}
                    {!selectMode && (
                      <div className="relative" ref={isOpen ? menuRef : undefined}>
                        <button
                          onClick={() => setMenuOpen(isOpen ? null : t.design)}
                          className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <EllipsisVerticalIcon className="w-4 h-4" />
                        </button>
                        {isOpen && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-56 glass-dropdown">
                            <button
                              onClick={() => { setMenuOpen(null); setPreviewDesign(t.design); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <EyeIcon className="w-4 h-4" />
                              View
                            </button>
                            <button
                              onClick={() => {
                                router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                                setMenuOpen(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <PencilIcon className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => { setMenuOpen(null); openRenameModal(t); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <PencilIcon className="w-4 h-4" />
                              Rename
                            </button>
                            <button
                              onClick={() => { setMenuOpen(null); handleDownloadScreenshot(t); }}
                              disabled={isDownloading}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2 disabled:opacity-60"
                            >
                              {isDownloading ? (
                                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                              ) : (
                                <ArrowDownTrayIcon className="w-4 h-4" />
                              )}
                              {isDownloading ? 'Downloading...' : 'Download PNG'}
                            </button>
                            <button
                              onClick={() => { cloneTemplate(t.design); setMenuOpen(null); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <Square2StackIcon className="w-4 h-4" />
                              Clone
                            </button>
                            <button
                              onClick={() => {
                                setMenuOpen(null);
                                void setPublishedState([t.design], !isPublished);
                              }}
                              disabled={isPublishing}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2 disabled:opacity-60"
                            >
                              {isPublished ? (
                                <>
                                  <PencilSquareIcon className="w-4 h-4" />
                                  Unpublish
                                </>
                              ) : (
                                <>
                                  <CheckCircleIcon className="w-4 h-4" />
                                  Publish to Library
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                if (!isPublished) return;
                                setCloneToAccountDesign(t.design);
                                setMenuOpen(null);
                              }}
                              disabled={!isPublished}
                              title={isPublished ? undefined : 'Publish this template first to push it to sub-accounts'}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            >
                              <BuildingOfficeIcon className="w-4 h-4" />
                              Clone to Account
                            </button>
                            <button
                              onClick={() => { deleteTemplate(t.design); setMenuOpen(null); }}
                              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {templateTypeLabel}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectMode || isPublishing) return;
                        void setPublishedState([t.design], !isPublished);
                      }}
                      disabled={isPublishing || selectMode}
                      title={isPublished ? 'Click to unpublish' : 'Click to publish to library'}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-default ${
                        isPublished
                          ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                          : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                      }`}
                    >
                      {isPublishing ? (
                        <ArrowPathIcon className="w-3 h-3 animate-spin" />
                      ) : isPublished ? (
                        <CheckCircleIcon className="w-3 h-3" />
                      ) : null}
                      {isPublished ? 'Published' : 'Draft'}
                    </button>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {(t.createdBy || t.updatedBy) && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {(() => {
                        const avatar = t.updatedByAvatar || t.createdByAvatar;
                        const name = t.updatedBy || t.createdBy;
                        const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
                        return avatar ? (
                          <img src={avatar} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[var(--muted)] flex items-center justify-center text-[7px] font-semibold text-[var(--muted-foreground)] flex-shrink-0">{initials}</span>
                        );
                      })()}
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                        {t.updatedBy ? `Edited by ${t.updatedBy}` : `By ${t.createdBy}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mt-4">
        {filtered.length} template{filtered.length !== 1 ? 's' : ''} available
      </p>

      {/* Modals */}
      {showTagModal && (
        <ManageTagsModal
          tagData={tagData}
          templateKeys={templateKeys}
          tplMap={tplMap}
          onSave={saveTagData}
          onClose={() => setShowTagModal(false)}
        />
      )}
      {showBulkModal && (
        <BulkEditModal
          templates={templates}
          filteredKeys={filteredKeys}
          tplMap={tplMap}
          onReload={loadTemplates}
          onClose={() => setShowBulkModal(false)}
        />
      )}
      {renameDesign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={closeRenameModal}>
          <div className="glass-modal w-[460px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Rename Template</h3>
              <button
                onClick={closeRenameModal}
                disabled={renaming}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRenameTemplate();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeRenameModal();
                  }
                }}
                placeholder="Template name"
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={closeRenameModal}
                disabled={renaming}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleRenameTemplate(); }}
                disabled={renaming || !renameValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {renaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDesign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setPreviewDesign(null)}>
          <div className="glass-modal w-[720px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-semibold truncate">
                  {tplMap[previewDesign]?.name || formatDesign(previewDesign)}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => openLibraryPreviewInNewTab(previewDesign)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Preview in New Tab
                </button>
                <button
                  onClick={() => {
                    setPreviewDesign(null);
                    router.push(buildLibraryEditorHref(
                      previewDesign,
                      {
                        campaignDraft: isCampaignDraft,
                        editorType: tplMap[previewDesign]?.editorType,
                      },
                    ));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--primary)] border border-[var(--primary)]/30 rounded-lg hover:bg-[var(--primary)]/5 transition-colors"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => setPreviewDesign(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <TemplatePreview design={previewDesign} interactive />
            </div>
          </div>
        </div>
      )}

      {/* Clone to Account modal */}
      <CloneToAccountsModal
        open={!!cloneToAccountDesign}
        onClose={() => setCloneToAccountDesign(null)}
        templateDesign={cloneToAccountDesign || ''}
        templateName={cloneToAccountDesign ? (tplMap[cloneToAccountDesign]?.name || formatDesign(cloneToAccountDesign)) : ''}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Read-Only View (client role: only published templates, no edit) ──
// ═══════════════════════════════════════════════════════════════════

function ReadOnlyView({ campaignDraftQuery }: { campaignDraftQuery: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;

  useEffect(() => {
    // Client role only sees published templates (server enforces this too).
    Promise.all([
      fetch('/api/templates?publishedOnly=true').then((r) => r.json()),
      fetch('/api/template-tags').then((r) => r.json()),
    ]).then(([tData, tagResult]) => {
      setTemplates(Array.isArray(tData) ? tData : []);
      setTagData(parseTemplateTagsPayload(tagResult));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const filtered = useMemo(() => {
    let list = templates;
    if (selectedTag) {
      const assigned = tagData.assignments;
      list = list.filter((t) => (assigned[t.design] || []).includes(selectedTag));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.design.toLowerCase().includes(q),
      );
    }
    return list;
  }, [templates, selectedTag, search, tagData]);

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  return (
    <div>
      {isCampaignDraft && (
        <div className="mb-4 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Select a template to open it in the editor, then click <span className="text-[var(--foreground)] font-medium">Schedule</span>.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
          />
        </div>
        {tagData.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedTag(null)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                !selectedTag
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              All
            </button>
            {tagData.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  selectedTag === tag
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
          <BookOpenIcon className="w-8 h-8 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)] text-sm">
            {search || selectedTag ? 'No templates were found.' : 'No templates available.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            return (
              <div
                key={t.design}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isCampaignDraft) {
                    router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                  } else {
                    setPreviewDesign(t.design);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (isCampaignDraft) {
                      router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                    } else {
                      setPreviewDesign(t.design);
                    }
                  }
                }}
                className="glass-card rounded-xl overflow-hidden cursor-pointer hover:border-[var(--primary)]/40 transition-colors"
              >
                <TemplatePreview design={t.design} height={220} />
                <div className="p-3">
                  <p className="text-sm font-medium truncate">
                    {t.name || formatDesign(t.design)}
                  </p>
                  <div className="mt-1.5">
                    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {templateTypeLabel}
                    </span>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {tags.map((tag) => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {(t.createdBy || t.updatedBy) && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {(() => {
                        const avatar = t.updatedByAvatar || t.createdByAvatar;
                        const name = t.updatedBy || t.createdBy;
                        const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
                        return avatar ? (
                          <img src={avatar} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[var(--muted)] flex items-center justify-center text-[7px] font-semibold text-[var(--muted-foreground)] flex-shrink-0">{initials}</span>
                        );
                      })()}
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                        {t.updatedBy ? `Edited by ${t.updatedBy}` : `By ${t.createdBy}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mt-4">
        {filtered.length} template{filtered.length !== 1 ? 's' : ''} available
      </p>

      {/* Preview Modal */}
      {previewDesign && (() => {
        const pt = templates.find((t) => t.design === previewDesign);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setPreviewDesign(null)}>
            <div className="glass-modal w-[720px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold truncate">
                    {pt?.name || formatDesign(previewDesign)}
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openLibraryPreviewInNewTab(previewDesign)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Preview in New Tab
                  </button>
                  <button
                    onClick={() => {
                      setPreviewDesign(null);
                      router.push(buildLibraryEditorHref(
                        previewDesign,
                        { campaignDraft: isCampaignDraft, editorType: pt?.editorType },
                      ));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--primary)] border border-[var(--primary)]/30 rounded-lg hover:bg-[var(--primary)]/5 transition-colors"
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => setPreviewDesign(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <TemplatePreview design={previewDesign} interactive />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Manage Tags Modal ──
// ═══════════════════════════════════════════════════════════════════

function ManageTagsModal({
  tagData, templateKeys, tplMap, onSave, onClose,
}: {
  tagData: TagData; templateKeys: string[];
  tplMap: Record<string, TemplateEntry>;
  onSave: (data: TagData) => void; onClose: () => void;
}) {
  const { confirm } = useLoomiDialog();
  const [local, setLocal] = useState<TagData>(JSON.parse(JSON.stringify(tagData)));
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    if (local.tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    setLocal({ ...local, tags: [...local.tags, name] });
    setNewTagName('');
  };

  const renameTag = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setEditingTag(null); return; }
    if (local.tags.some((t) => t !== oldName && t.toLowerCase() === trimmed.toLowerCase())) { setEditingTag(null); return; }
    const newTags = local.tags.map((t) => (t === oldName ? trimmed : t));
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      newAssignments[key] = tags.map((t) => (t === oldName ? trimmed : t));
    }
    setLocal({ tags: newTags, assignments: newAssignments });
    setEditingTag(null);
  };

  const deleteTag = async (tagName: string) => {
    const count = Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;
    if (count > 0) {
      const confirmed = await confirm({
        title: 'Remove Tag',
        message: `Remove "${tagName}" tag from ${count} template${count > 1 ? 's' : ''}?`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;
    }
    const newTags = local.tags.filter((t) => t !== tagName);
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      const filtered = tags.filter((t) => t !== tagName);
      if (filtered.length > 0) newAssignments[key] = filtered;
    }
    setLocal({ tags: newTags, assignments: newAssignments });
  };

  const assignTag = (templateKey: string, tagName: string) => {
    const current = local.assignments[templateKey] || [];
    if (current.includes(tagName)) return;
    setLocal({
      ...local,
      assignments: { ...local.assignments, [templateKey]: [...current, tagName] },
    });
    setOpenDropdown(null);
  };

  const unassignTag = (templateKey: string, tagName: string) => {
    const current = local.assignments[templateKey] || [];
    const filtered = current.filter((t) => t !== tagName);
    const newAssignments = { ...local.assignments };
    if (filtered.length > 0) {
      newAssignments[templateKey] = filtered;
    } else {
      delete newAssignments[templateKey];
    }
    setLocal({ ...local, assignments: newAssignments });
  };

  const getTagCount = (tagName: string) =>
    Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h3 className="text-sm font-semibold">Manage Tags</h3>
          <button onClick={onClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Tags */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Tags</h4>
            <div className="space-y-1.5">
              {local.tags.map((tag) => (
                <div key={tag} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                  {editingTag === tag ? (
                    <input
                      type="text"
                      value={editTagValue}
                      onChange={(e) => setEditTagValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') renameTag(tag, editTagValue); if (e.key === 'Escape') setEditingTag(null); }}
                      onBlur={() => renameTag(tag, editTagValue)}
                      className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--foreground)]"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium">{tag}</span>
                  )}
                  <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{getTagCount(tag)}</span>
                  <button onClick={() => { setEditingTag(tag); setEditTagValue(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors" title="Rename">
                    <PencilIcon className="w-3 h-3" />
                  </button>
                  <button onClick={() => { void deleteTag(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete tag">
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]" placeholder="New tag name..." />
              <PrimaryButton onClick={addTag} disabled={!newTagName.trim()}>Add</PrimaryButton>
            </div>
          </div>

          {/* Assignments */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Template Assignments</h4>
            <div className="space-y-2">
              {templateKeys.map((k) => {
                const t = tplMap[k];
                if (!t) return null;
                const assigned = local.assignments[k] || [];
                const available = local.tags.filter((tg) => !assigned.includes(tg));
                const isDropdownOpen = openDropdown === k;
                const designLabel = t.name || formatDesign(t.design);

                return (
                  <div key={k} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{designLabel}</p>
                    </div>
                    <div className="flex-1 flex items-center gap-1.5 flex-wrap justify-end">
                      {assigned.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                          {tag}
                          <button onClick={() => unassignTag(k, tag)} className="hover:text-red-400 transition-colors">
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {assigned.length === 0 && <span className="text-[10px] text-[var(--muted-foreground)] italic">untagged</span>}
                      {available.length > 0 && (
                        <div className="relative" ref={isDropdownOpen ? dropdownRef : undefined}>
                          <button
                            onClick={() => setOpenDropdown(isDropdownOpen ? null : k)}
                            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                            title="Add tag"
                          >
                            <PlusIcon className="w-3.5 h-3.5" />
                          </button>
                          {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 w-36 glass-dropdown">
                              {available.map((tag) => (
                                <button key={tag} onClick={() => assignTag(k, tag)} className="w-full text-left px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors">Cancel</button>
          <PrimaryButton onClick={() => onSave(local)}>Save</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Bulk Edit Modal ──
// ═══════════════════════════════════════════════════════════════════

function BulkEditModal({
  templates, filteredKeys, tplMap, onReload, onClose,
}: {
  templates: TemplateEntry[]; filteredKeys: string[];
  tplMap: Record<string, TemplateEntry>;
  onReload: () => Promise<void>; onClose: () => void;
}) {
  const [operation, setOperation] = useState<'findReplace' | 'setComponentProp'>('findReplace');
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [regexFlags, setRegexFlags] = useState('gi');
  const [componentType, setComponentType] = useState('footer');
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');
  const [propAction, setPropAction] = useState<'set' | 'unset'>('set');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const selectedDesigns = useMemo(() => {
    if (scope === 'all') return templates.map((t) => t.design);
    return filteredKeys.map((key) => tplMap[key]?.design).filter(Boolean) as string[];
  }, [scope, templates, filteredKeys, tplMap]);

  const operationPayload = useMemo(() => {
    if (operation === 'findReplace') {
      return { kind: 'findReplace' as const, find: findText, replace: replaceText, mode: regexMode ? 'regex' : 'plain', flags: regexMode ? regexFlags : undefined };
    }
    return { kind: 'setComponentProp' as const, componentType, propKey, value: propValue, action: propAction };
  }, [operation, findText, replaceText, regexMode, regexFlags, componentType, propKey, propValue, propAction]);

  const runBulk = async (dryRun: boolean) => {
    if (selectedDesigns.length === 0) { toast.error('No templates in selected scope'); return; }
    if (operation === 'findReplace' && !findText) { toast.error('Find text is required'); return; }
    if (operation === 'setComponentProp' && (!componentType || !propKey)) { toast.error('Component type and prop key are required'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/templates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, designs: selectedDesigns, operation: operationPayload }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Bulk operation failed'); return; }
      setResult(data as BulkResult);

      if (dryRun) {
        toast.success(`Preview ready: ${data.affectedCount} template${data.affectedCount === 1 ? '' : 's'} affected`);
      } else {
        toast.success(`Applied to ${data.appliedCount} template${data.appliedCount === 1 ? '' : 's'}`);
        await onReload();
      }
    } catch {
      toast.error('Bulk operation failed');
    }
    setLoading(false);
  };

  const commonComponents = [
    'header', 'hero', 'copy', 'cta', 'features', 'image', 'image-overlay',
    'image-card-overlay', 'vehicle-card', 'countdown-stat', 'testimonial', 'footer',
    'spacer', 'divider',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal w-[760px] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-semibold">Bulk Edit Templates</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Run a dry preview first, then apply with automatic version snapshots.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Operation */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Operation</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => { setOperation('findReplace'); setResult(null); }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${operation === 'findReplace' ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}>Find & Replace</button>
              <button onClick={() => { setOperation('setComponentProp'); setResult(null); }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${operation === 'setComponentProp' ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}>Set Component Prop</button>
            </div>
          </div>

          {/* Scope */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Scope</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => { setScope('filtered'); setResult(null); }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${scope === 'filtered' ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}>Current Filter</button>
              <button onClick={() => { setScope('all'); setResult(null); }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${scope === 'all' ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}>All Templates</button>
              <span className="text-xs text-[var(--muted-foreground)] ml-1">{selectedDesigns.length} selected</span>
            </div>
          </div>

          {/* Fields */}
          {operation === 'findReplace' ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Find</label>
                <input type="text" value={findText} onChange={(e) => { setFindText(e.target.value); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder={regexMode ? 'Regex pattern...' : 'Text to find...'} />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Replace With</label>
                <input type="text" value={replaceText} onChange={(e) => { setReplaceText(e.target.value); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="Replacement text (can be empty)" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setRegexMode(!regexMode); setResult(null); }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${regexMode ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}>Regex Mode</button>
                {regexMode && (
                  <input type="text" value={regexFlags} onChange={(e) => { setRegexFlags(e.target.value); setResult(null); }} className="w-24 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-[var(--foreground)] font-mono" placeholder="flags" />
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Component Type</label>
                  <select value={componentType} onChange={(e) => { setComponentType(e.target.value); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]">
                    {commonComponents.map((comp) => (<option key={comp} value={comp}>{comp}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Action</label>
                  <select value={propAction} onChange={(e) => { setPropAction(e.target.value as 'set' | 'unset'); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]">
                    <option value="set">Set/Update Prop</option>
                    <option value="unset">Unset Prop</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Prop Key</label>
                <input type="text" value={propKey} onChange={(e) => { setPropKey(e.target.value); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] font-mono" placeholder="e.g. phone-color" />
              </div>
              {propAction === 'set' && (
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Prop Value</label>
                  <input type="text" value={propValue} onChange={(e) => { setPropValue(e.target.value); setResult(null); }} className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="e.g. {{location.phone}}" />
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="border border-[var(--border)] rounded-xl bg-[var(--background)] p-3 space-y-2">
              <p className="text-xs font-medium">{result.dryRun ? 'Dry Run' : 'Applied'}: {result.affectedCount} / {result.totalTemplates} templates affected, {result.totalChanges} changes</p>
              {result.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-1">
                  {result.errors.map((err) => (<p key={`${err.design}-${err.error}`}>{err.design}: {err.error}</p>))}
                </div>
              )}
              {result.affectedTemplates.length > 0 && (
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {result.affectedTemplates.map((change) => (
                    <div key={`${change.design}-${change.summary}`} className="text-xs flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--border)]">
                      <span className="font-medium">{change.design}</span>
                      <span className="text-[var(--muted-foreground)]">&bull; {change.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30">
          <p className="text-[10px] text-[var(--muted-foreground)]">Apply mode snapshots each changed template before writing.</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors">Close</button>
            <button onClick={() => runBulk(true)} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border)] text-[var(--foreground)] rounded-lg text-sm font-medium hover:bg-[var(--muted)] transition-colors disabled:opacity-50">
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Preview Impact
            </button>
            <PrimaryButton onClick={() => runBulk(false)} disabled={loading}>Apply Changes</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
