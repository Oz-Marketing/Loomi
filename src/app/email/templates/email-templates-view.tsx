'use client';

import { useContext, useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
// The header-actions slot context now lives in the shared header module; re-export
// so existing importers of it from this view keep working.
import { TemplatesHeaderActionsContext } from '@/components/templates/template-header-actions';
export { TemplatesHeaderActionsContext };
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  BookOpenIcon,
  EnvelopeIcon,
  TrashIcon,
  TagIcon,
  Square2StackIcon,
  PencilIcon,
  CursorArrowRaysIcon,
  CodeBracketIcon,
  EyeIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';
import { TemplateCard, type TemplateCardAction } from '@/components/templates/template-card';
import { TemplateLibraryShell, TemplateEmptyState } from '@/components/templates/template-library-shell';
import { TemplateFilterRail, type FilterRailExtraSection } from '@/components/templates/template-filter-rail';
import { useTemplateFilters } from '@/components/templates/use-template-filters';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { TemplatePreview } from '@/components/template-preview';
import {
  parseTemplateTagsPayload,
  assignmentsMapToArray,
} from '@/lib/template-tags-payload';
import PrimaryButton from '@/components/primary-button';

// ── Types ──

interface TemplateEntry {
  design: string;
  accountKey?: string | null;
  name: string;
  editorType?: 'code' | 'visual' | string | null;
  category?: string | null;
  updatedAt?: string;
  createdBy?: string | null;
  createdByAvatar?: string | null;
  updatedBy?: string | null;
  updatedByAvatar?: string | null;
  published?: boolean;
  publishedAt?: string | null;
  publishedBy?: string | null;
}

type TypeFilter = 'all' | 'visual' | 'code';

interface TagData {
  tags: string[];
  assignments: Record<string, string[]>;
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
  const { userRole, account, accountKey, accountData } = useAccount();
  const campaignDraftQuery = searchParams.get('campaignDraft') === '1' ? '?campaignDraft=1' : '';

  const isClient = userRole === 'client';
  // developer, super_admin, and admin all get full management access to the library.
  const canManage = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  // When viewing inside a subaccount, swap to the tabbed view that separates
  // "Subaccount Templates" (owned by this subaccount) from the shared
  // "Template Library".
  if (account.mode === 'account' && accountKey) {
    return (
      <SubaccountTabsView
        accountKey={accountKey}
        accountLabel={accountData?.dealer ?? accountKey}
        canManage={canManage}
        isClient={isClient}
        campaignDraftQuery={campaignDraftQuery}
      />
    );
  }

  return (
    <div>
      {canManage && <ManagementView campaignDraftQuery={campaignDraftQuery} />}
      {isClient && <ReadOnlyView campaignDraftQuery={campaignDraftQuery} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Subaccount Tabs View ──
// ═══════════════════════════════════════════════════════════════════

/**
 * Shell for the templates page when viewing inside a subaccount. Renders the
 * sticky title + tab switcher and swaps between the subaccount-scoped view
 * and the shared library (read-only published templates) below.
 */
function SubaccountTabsView({
  accountKey,
  accountLabel,
  canManage,
  isClient,
  campaignDraftQuery,
}: {
  accountKey: string;
  accountLabel: string;
  canManage: boolean;
  isClient: boolean;
  campaignDraftQuery: string;
}) {
  const [tab, setTab] = useState<'subaccount' | 'library'>('subaccount');
  // Force-remount the subaccount view when a library copy completes so the
  // freshly-cloned template appears immediately on tab switch.
  const [subaccountRefreshKey, setSubaccountRefreshKey] = useState(0);
  // Slot element for header-aligned action buttons. ManagementView
  // portals its Create + overflow buttons into this div via the
  // TemplatesHeaderActionsContext below.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const subaccountSubtitle = `Templates owned by ${accountLabel}.`;
  const librarySubtitle = 'Published templates from the shared library.';

  return (
    <TemplatesHeaderActionsContext.Provider value={actionsSlot}>
    <div>
      <div className="page-sticky-header has-tabs mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5 truncate">
                {tab === 'subaccount' ? subaccountSubtitle : librarySubtitle}
              </p>
            </div>
          </div>
          {/* Right-aligned action slot. ManagementView's Create
              Template + overflow buttons portal in here when active. */}
          <div
            ref={setActionsSlot}
            className="flex items-center gap-2 flex-shrink-0"
          />
        </div>
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {([
            { id: 'subaccount' as const, label: 'Subaccount Templates' },
            { id: 'library' as const, label: 'Template Library' },
          ]).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'subaccount' ? (
        canManage ? (
          <ManagementView
            key={`mgmt-${subaccountRefreshKey}`}
            campaignDraftQuery={campaignDraftQuery}
            accountKey={accountKey}
            embedded
          />
        ) : isClient ? (
          <ReadOnlyView
            key={`ro-${subaccountRefreshKey}`}
            campaignDraftQuery={campaignDraftQuery}
            accountKey={accountKey}
            embedded
          />
        ) : null
      ) : (
        <ReadOnlyView
          campaignDraftQuery={campaignDraftQuery}
          copyTargetAccountKey={accountKey}
          copyTargetAccountLabel={accountLabel}
          onCopyComplete={() => {
            setSubaccountRefreshKey((n) => n + 1);
            setTab('subaccount');
          }}
          embedded
        />
      )}
    </div>
    </TemplatesHeaderActionsContext.Provider>
  );
}

// Portals Create Template + overflow menu into the slot the parent
// SubaccountTabsView reserves in its sticky header. Renders nothing
// (returns null) until the slot DOM node is available on first
// render after mount.
function EmbeddedHeaderActions({
  showOverflowMenu,
  overflowMenuRef,
  onToggleOverflowMenu,
  onManageTags,
  onCreate,
}: {
  showOverflowMenu: boolean;
  overflowMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleOverflowMenu: () => void;
  onManageTags: () => void;
  onCreate: () => void;
}) {
  const slot = useContext(TemplatesHeaderActionsContext);
  if (!slot) return null;
  return createPortal(
    <>
      <div className="relative" ref={showOverflowMenu ? overflowMenuRef : undefined}>
        <button
          onClick={onToggleOverflowMenu}
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="More actions"
          aria-label="More actions"
        >
          <EllipsisHorizontalIcon className="w-4 h-4" />
        </button>
        {showOverflowMenu && (
          <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
            <button
              onClick={onManageTags}
              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
            >
              <TagIcon className="w-4 h-4" />
              Manage tags
            </button>
          </div>
        )}
      </div>
      <PrimaryButton onClick={onCreate}>
        <PlusIcon className="w-4 h-4" />
        New Email Template
      </PrimaryButton>
    </>,
    slot,
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Email Templates Panel (reusable; used by the unified /templates) ──
// ═══════════════════════════════════════════════════════════════════

/**
 * Header-less email-templates surface for the Email tab of the unified
 * /templates page. Scope is implicit by context: at Admin (no accountKey) the
 * management view shows the SYSTEM library (accountKey null); inside a
 * sub-account it shows ONLY that account's own templates. Clients get the
 * read-only view of the same scope. No "browse system library" toggle — admins
 * push templates to subaccounts instead. Keyed by accountKey so a sub-account
 * switch fully remounts onto the new scope.
 */
export function EmailTemplatesPanel({
  campaignDraftQuery,
  accountKey,
  canManage,
  isClient,
}: {
  campaignDraftQuery: string;
  accountKey?: string;
  accountLabel?: string;
  canManage: boolean;
  isClient: boolean;
}) {
  if (canManage) {
    return (
      <ManagementView
        key={`mgmt-${accountKey ?? 'admin'}`}
        campaignDraftQuery={campaignDraftQuery}
        accountKey={accountKey}
        embedded
      />
    );
  }
  if (isClient) {
    return (
      <ReadOnlyView
        key={`ro-${accountKey ?? 'admin'}`}
        campaignDraftQuery={campaignDraftQuery}
        accountKey={accountKey}
        embedded
      />
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// ── Management View (full management — developer, super_admin, admin) ──
// ═══════════════════════════════════════════════════════════════════

function ManagementView({
  campaignDraftQuery,
  accountKey,
  embedded,
}: {
  campaignDraftQuery: string;
  // When set, scopes the view to this subaccount's templates (no publish UI).
  accountKey?: string;
  // When true, the parent renders the page header so this view hides its own.
  embedded?: boolean;
}) {
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const scoped = Boolean(accountKey);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreateChoice, setShowCreateChoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showTagModal, setShowTagModal] = useState(false);
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [selectedDesigns, setSelectedDesigns] = useState<Set<string>>(new Set());
  const [renameDesign, setRenameDesign] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [, setDownloadingDesign] = useState<string | null>(null);
  const [, setPublishingDesign] = useState<string | null>(null);
  // Toolbar popover anchors
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // Bulk tag modal (opens from the bulk-action dock)
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;

  const loadTemplates = async () => {
    try {
      const listUrl = accountKey
        ? `/api/templates?accountKey=${encodeURIComponent(accountKey)}`
        : '/api/templates';
      const [tRes, tagRes] = await Promise.all([
        fetch(listUrl),
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

  // Refetch when the account scope changes — the unified /templates page
  // can mount this view before the sub-account context has resolved from
  // the URL, so the initial accountKey may be undefined and then settle.
  useEffect(() => { loadTemplates(); }, [accountKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showOverflowMenu) return;
    const handler = (e: MouseEvent) => {
      if (!overflowMenuRef.current?.contains(e.target as Node)) setShowOverflowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOverflowMenu]);

  const tplMap = useMemo(() => {
    const map: Record<string, TemplateEntry> = {};
    templates.forEach((t) => { map[t.design] = t; });
    return map;
  }, [templates]);

  // Type (Drag & Drop / HTML) is Email-specific — pre-filter, then the shared
  // hook handles category/tags/status/search + facet counts (the left rail).
  const typedTemplates = useMemo(() => {
    if (typeFilter === 'visual') return templates.filter((t) => t.editorType === 'visual');
    if (typeFilter === 'code') return templates.filter((t) => t.editorType !== 'visual');
    return templates;
  }, [templates, typeFilter]);

  const { filters, setFilters, facets, filtered, active, reset } = useTemplateFilters(typedTemplates, {
    getName: (t) => t.name || formatDesign(t.design),
    getCategory: (t) => t.category,
    getTags: (t) => tagData.assignments[t.design] ?? [],
    // Publish status only applies to the system library (admin), not a
    // sub-account's own templates — matches the old "no publish when scoped".
    getStatus: scoped ? undefined : (t) => (t.published ? 'published' : 'draft'),
  });

  // Categories in use (for the card's inline category popover suggestions).
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [templates]);

  // Type facet for the rail's extra section.
  const typeCounts = useMemo(
    () => ({
      visual: templates.filter((t) => t.editorType === 'visual').length,
      code: templates.filter((t) => t.editorType !== 'visual').length,
    }),
    [templates],
  );

  /**
   * Persist a new tag assignment for one template. Sends the full tag payload
   * (server is happy to receive it; the diff lives client-side).
   */
  const setTagsForTemplate = async (design: string, tags: string[]) => {
    const next: TagData = {
      tags: Array.from(new Set([...tagData.tags, ...tags])),
      assignments: { ...tagData.assignments, [design]: tags },
    };
    if (tags.length === 0) delete next.assignments[design];
    setTagData(next);
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: next.tags,
          assignments: assignmentsMapToArray(next.assignments),
        }),
      });
    } catch {
      toast.error('Failed to save tags');
      void loadTemplates();
    }
  };

  /** Apply (add or remove) a single tag across many templates. */
  const applyTagToTemplates = async (tag: string, designs: string[], action: 'add' | 'remove') => {
    const nextAssignments = { ...tagData.assignments };
    for (const design of designs) {
      const current = nextAssignments[design] || [];
      if (action === 'add' && !current.includes(tag)) {
        nextAssignments[design] = [...current, tag];
      } else if (action === 'remove' && current.includes(tag)) {
        const filtered = current.filter((t) => t !== tag);
        if (filtered.length === 0) delete nextAssignments[design];
        else nextAssignments[design] = filtered;
      }
    }
    const nextTags = action === 'add'
      ? Array.from(new Set([...tagData.tags, tag]))
      : tagData.tags;
    const next: TagData = { tags: nextTags, assignments: nextAssignments };
    setTagData(next);
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: next.tags,
          assignments: assignmentsMapToArray(next.assignments),
        }),
      });
      toast.success(`${action === 'add' ? 'Added' : 'Removed'} "${tag}" on ${designs.length} template${designs.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to update tags');
      void loadTemplates();
    }
  };

  const setCategoryForTemplate = async (design: string, category: string | null) => {
    setTemplates((prev) => prev.map((t) => (t.design === design ? { ...t, category } : t)));
    try {
      const res = await fetch('/api/templates/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: design, category }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      toast.error('Failed to update category');
      void loadTemplates();
    }
  };

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
        body: JSON.stringify({
          design: defaultName,
          mode,
          ...(accountKey ? { accountKey } : {}),
        }),
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
    // Show the names of the templates that will be deleted (capped at 8 lines).
    // The previous count-only message let users miss when the selection had
    // unintentionally accumulated rows from a prior Move action — names make
    // over-selection obvious before the user clicks through.
    const nameByDesign = new Map(
      templates.map((t) => [t.design, t.name || formatDesign(t.design) || 'Untitled']),
    );
    const selectedNames = Array.from(selectedDesigns).map(
      (design) => nameByDesign.get(design) || 'Unknown template',
    );
    const previewLimit = 8;
    const shown = selectedNames.slice(0, previewLimit).map((n) => `• ${n}`).join('\n');
    const remaining = selectedNames.length - previewLimit;
    const list = remaining > 0 ? `${shown}\n… and ${remaining} more` : shown;
    const count = selectedDesigns.size;
    const headline = `Delete ${count} template${count !== 1 ? 's' : ''}?`;
    const confirmed = await confirm({
      title: 'Delete Templates',
      message: `${headline}\n\n${list}\n\nThis cannot be undone.`,
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
      {/* Sticky header — page title + primary actions. Hidden when embedded
          (parent component already renders a header above tabs). */}
      {!embedded && (
        <div className="page-sticky-header mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5 truncate">
                Shared template library. Publish templates to make them available to sub-accounts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative" ref={showOverflowMenu ? overflowMenuRef : undefined}>
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                title="More actions"
                aria-label="More actions"
              >
                <EllipsisHorizontalIcon className="w-4 h-4" />
              </button>
              {showOverflowMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
                  <button
                    onClick={() => { setShowTagModal(true); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                  >
                    <TagIcon className="w-4 h-4" />
                    Manage tags
                  </button>
                </div>
              )}
            </div>
            <PrimaryButton onClick={() => setShowCreateChoice(true)}>
              <PlusIcon className="w-4 h-4" />
              Create Template
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Embedded actions — when the parent owns the header, portal
          the Create + overflow buttons into the header's right-side
          slot via TemplatesHeaderActionsContext. The buttons sit next
          to the page title instead of below the tabs. */}
      {embedded && (
        <EmbeddedHeaderActions
          showOverflowMenu={showOverflowMenu}
          overflowMenuRef={overflowMenuRef}
          onToggleOverflowMenu={() => setShowOverflowMenu(!showOverflowMenu)}
          onManageTags={() => { setShowTagModal(true); setShowOverflowMenu(false); }}
          onCreate={() => setShowCreateChoice(true)}
        />
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

      {/* No templates → shared empty card (no rail), matching the other tabs. */}
      {templates.length === 0 ? (
        <TemplateEmptyState
          icon={EnvelopeIcon}
          title="No email templates yet"
          subtitle="Create a reusable email layout — your team starts each campaign from one of these."
          actionLabel="New Email Template"
          onAction={() => setShowCreateChoice(true)}
        />
      ) : (
      <TemplateLibraryShell
        search={filters.search}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        resultCount={filtered.length}
        rail={
          <TemplateFilterRail
            filters={filters}
            setFilters={setFilters}
            facets={facets}
            active={active || typeFilter !== 'all'}
            reset={() => { reset(); setTypeFilter('all'); }}
            showStatus={!scoped}
            extraSections={[
              {
                key: 'type',
                title: 'Type',
                options: [
                  { value: 'visual', label: 'Drag & Drop', count: typeCounts.visual },
                  { value: 'code', label: 'HTML', count: typeCounts.code },
                ],
                selected: typeFilter === 'all' ? null : typeFilter,
                onSelect: (v) => setTypeFilter((v as TypeFilter) ?? 'all'),
              } as FilterRailExtraSection,
            ]}
          />
        }
      >
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
          {active || typeFilter !== 'all' ? 'No templates match your filters.' : 'No templates yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const isSelected = selectedDesigns.has(t.design);
            const isPublished = t.published === true;
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            const actions: TemplateCardAction[] = [
              { key: 'view', label: 'View', icon: EyeIcon, run: () => setPreviewDesign(t.design) },
              { key: 'edit', label: 'Edit', icon: PencilIcon, run: () => router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft })) },
              { key: 'rename', label: 'Rename', icon: PencilIcon, run: () => openRenameModal(t) },
              { key: 'download', label: 'Download PNG', icon: ArrowDownTrayIcon, run: () => void handleDownloadScreenshot(t) },
              { key: 'clone', label: 'Clone', icon: Square2StackIcon, run: () => void cloneTemplate(t.design) },
              ...(!scoped
                ? [
                    isPublished
                      ? { key: 'unpublish', label: 'Unpublish', icon: PencilSquareIcon, run: () => void setPublishedState([t.design], false) }
                      : { key: 'publish', label: 'Publish to Library', icon: CheckCircleIcon, run: () => void setPublishedState([t.design], true) },
                  ]
                : []),
              { key: 'delete', label: 'Delete', icon: TrashIcon, run: () => void deleteTemplate(t.design), danger: true },
            ];
            return (
              <TemplateCard
                key={t.design}
                preview={<TemplatePreview design={t.design} height={180} />}
                name={t.name || formatDesign(t.design)}
                status={scoped ? undefined : isPublished ? 'published' : 'draft'}
                badges={
                  <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {templateTypeLabel}
                  </span>
                }
                category={t.category}
                tags={tags}
                taxonomy={{ categories: allCategories, tags: tagData.tags }}
                author={{ name: t.updatedBy || t.createdBy, avatarUrl: t.updatedByAvatar || t.createdByAvatar }}
                editable
                selectable
                selected={isSelected}
                onToggleSelect={() => handleToggleSelect(t.design)}
                actions={actions}
                onClick={() => setPreviewDesign(t.design)}
                onCategoryChange={(c) => void setCategoryForTemplate(t.design, c)}
                onTagsChange={(next) => void setTagsForTemplate(t.design, next)}
              />
            );
          })}
        </div>
      )}
      </TemplateLibraryShell>
      )}

      {/* Modals */}
      {showTagModal && (
        <ManageTagsModal
          tagData={tagData}
          onSave={saveTagData}
          onClose={() => setShowTagModal(false)}
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

      {/* Bulk action dock — appears when at least one template is selected. */}
      {selectedDesigns.size > 0 && (
        <BulkActionDock
          count={selectedDesigns.size}
          itemLabel={selectedDesigns.size === 1 ? 'template' : 'templates'}
          actions={(() => {
            const slugs = Array.from(selectedDesigns);
            const filteredSlugs = filtered.map((t) => t.design);
            const allFilteredSelected =
              filteredSlugs.length > 0 && filteredSlugs.every((d) => selectedDesigns.has(d));
            const actions: BulkActionDockItem[] = [
              {
                id: 'select-page',
                label: allFilteredSelected ? 'Deselect page' : 'Select page',
                icon: <CheckIcon className="w-4 h-4" />,
                onClick: () => {
                  if (allFilteredSelected) {
                    setSelectedDesigns(new Set());
                  } else {
                    setSelectedDesigns(new Set(filteredSlugs));
                  }
                },
              },
              ...(scoped
                ? []
                : [
                    {
                      id: 'publish',
                      label: 'Publish',
                      icon: <CheckCircleIcon className="w-4 h-4" />,
                      onClick: async () => {
                        await setPublishedState(slugs, true);
                        setSelectedDesigns(new Set());
                      },
                    },
                    {
                      id: 'unpublish',
                      label: 'Unpublish',
                      icon: <PencilSquareIcon className="w-4 h-4" />,
                      onClick: async () => {
                        await setPublishedState(slugs, false);
                        setSelectedDesigns(new Set());
                      },
                    },
                  ]),
              {
                id: 'tag',
                label: 'Tag',
                icon: <TagIcon className="w-4 h-4" />,
                onClick: () => setBulkTagModalOpen(true),
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleBulkDelete,
                danger: true,
              },
            ];
            return actions;
          })()}
          onClose={() => setSelectedDesigns(new Set())}
        />
      )}

      {/* Bulk tag modal */}
      {bulkTagModalOpen && (
        <BulkTagModal
          selectedDesigns={Array.from(selectedDesigns)}
          tags={tagData.tags}
          assignments={tagData.assignments}
          onApply={(tag, action) => applyTagToTemplates(tag, Array.from(selectedDesigns), action)}
          onClose={() => setBulkTagModalOpen(false)}
        />
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Bulk Tag Modal — applies tags to multiple selected templates ──
// ═══════════════════════════════════════════════════════════════════

function BulkTagModal({
  selectedDesigns,
  tags,
  assignments,
  onApply,
  onClose,
}: {
  selectedDesigns: string[];
  tags: string[];
  assignments: Record<string, string[]>;
  onApply: (tag: string, action: 'add' | 'remove') => Promise<void> | void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  // Compute tri-state for each tag across the selection.
  const tagState: Record<string, 'all' | 'some' | 'none'> = {};
  for (const tag of tags) {
    let count = 0;
    for (const slug of selectedDesigns) {
      if ((assignments[slug] || []).includes(tag)) count += 1;
    }
    if (count === 0) tagState[tag] = 'none';
    else if (count === selectedDesigns.length) tagState[tag] = 'all';
    else tagState[tag] = 'some';
  }

  const filtered = tags.filter((t) => t.toLowerCase().includes(query.toLowerCase()));
  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 &&
    !tags.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  const count = selectedDesigns.length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold">Edit tags</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Toggle tags on {count} selected template{count === 1 ? '' : 's'}. Mixed selections show a dash.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && showCreate) {
                await onApply(trimmed, 'add');
                setQuery('');
              }
            }}
            placeholder="Search or create…"
            autoFocus
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
          />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 && !showCreate && (
            <p className="px-2 py-3 text-[11px] text-[var(--muted-foreground)] italic text-center">
              No tags match.
            </p>
          )}
          {filtered.map((tag) => {
            const state = tagState[tag] || 'none';
            const color = getTagColor(tag);
            return (
              <button
                key={tag}
                onClick={() => onApply(tag, state === 'none' ? 'add' : 'remove')}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-[var(--muted)] transition-colors text-left"
              >
                <span className="flex items-center justify-center w-4 h-4">
                  {state === 'all' && <CheckIcon className="w-4 h-4 text-[var(--primary)]" />}
                  {state === 'some' && <span className="w-2 h-0.5 bg-[var(--primary)] rounded" />}
                </span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.className.split(' ')[0]}`} />
                <span className="flex-1 truncate">{tag}</span>
              </button>
            );
          })}
          {showCreate && (
            <button
              onClick={async () => {
                await onApply(trimmed, 'add');
                setQuery('');
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-[var(--muted)] transition-colors text-left text-[var(--primary)]"
            >
              <PlusIcon className="w-4 h-4" />
              <span>Create &ldquo;{trimmed}&rdquo;</span>
            </button>
          )}
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 h-9 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Read-Only View (client role: only published templates, no edit) ──
// ═══════════════════════════════════════════════════════════════════

function ReadOnlyView({
  campaignDraftQuery,
  accountKey,
  embedded,
  copyTargetAccountKey,
  copyTargetAccountLabel,
  onCopyComplete,
}: {
  campaignDraftQuery: string;
  // When set, fetch templates owned by this subaccount (no publishedOnly).
  // When unset, fetch published library templates.
  accountKey?: string;
  embedded?: boolean;
  // When set, show a "Copy to Subaccount" action that clones the library
  // template into this subaccount. Ignored when `accountKey` is set
  // (subaccount-scoped views don't show this action).
  copyTargetAccountKey?: string;
  copyTargetAccountLabel?: string;
  onCopyComplete?: () => void;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [copyingDesign, setCopyingDesign] = useState<string | null>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;
  const showCopyAction = Boolean(copyTargetAccountKey) && !accountKey;

  useEffect(() => {
    const listUrl = accountKey
      ? `/api/templates?accountKey=${encodeURIComponent(accountKey)}`
      : '/api/templates?publishedOnly=true';
    Promise.all([
      fetch(listUrl).then((r) => r.json()),
      fetch('/api/template-tags').then((r) => r.json()),
    ]).then(([tData, tagResult]) => {
      setTemplates(Array.isArray(tData) ? tData : []);
      setTagData(parseTemplateTagsPayload(tagResult));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [accountKey]);

  const copyToSubaccount = async (design: string) => {
    if (!copyTargetAccountKey || copyingDesign) return;
    setCopyingDesign(design);
    try {
      const res = await fetch('/api/templates/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDesign: design, accountKey: copyTargetAccountKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to copy template');
        return;
      }
      const label = copyTargetAccountLabel || 'subaccount';
      toast.success(`Copied to ${label}`);
      onCopyComplete?.();
    } catch {
      toast.error('Failed to copy template');
    } finally {
      setCopyingDesign(null);
    }
  };

  // Type (Drag & Drop / HTML) pre-filter, then the shared hook handles
  // category/tags/search + facet counts for the left rail.
  const typedTemplates = useMemo(() => {
    if (typeFilter === 'visual') return templates.filter((t) => t.editorType === 'visual');
    if (typeFilter === 'code') return templates.filter((t) => t.editorType !== 'visual');
    return templates;
  }, [templates, typeFilter]);

  const { filters, setFilters, facets, filtered, active, reset } = useTemplateFilters(typedTemplates, {
    getName: (t) => t.name || formatDesign(t.design),
    getCategory: (t) => t.category,
    getTags: (t) => tagData.assignments[t.design] ?? [],
  });

  const typeCounts = useMemo(
    () => ({
      visual: templates.filter((t) => t.editorType === 'visual').length,
      code: templates.filter((t) => t.editorType !== 'visual').length,
    }),
    [templates],
  );

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  return (
    <div>
      {!embedded && (
        <div className="page-sticky-header mb-6">
          <div className="flex items-center gap-3">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                Browse the shared template library.
              </p>
            </div>
          </div>
        </div>
      )}

      {isCampaignDraft && (
        <div className="mb-4 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Select a template to open it in the editor, then click <span className="text-[var(--foreground)] font-medium">Schedule</span>.
        </div>
      )}

      <TemplateLibraryShell
        search={filters.search}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        resultCount={filtered.length}
        rail={
          <TemplateFilterRail
            filters={filters}
            setFilters={setFilters}
            facets={facets}
            active={active || typeFilter !== 'all'}
            reset={() => { reset(); setTypeFilter('all'); }}
            extraSections={[
              {
                key: 'type',
                title: 'Type',
                options: [
                  { value: 'visual', label: 'Drag & Drop', count: typeCounts.visual },
                  { value: 'code', label: 'HTML', count: typeCounts.code },
                ],
                selected: typeFilter === 'all' ? null : typeFilter,
                onSelect: (v) => setTypeFilter((v as TypeFilter) ?? 'all'),
              } as FilterRailExtraSection,
            ]}
          />
        }
      >
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
          {active || typeFilter !== 'all' ? 'No templates match your filters.' : 'No templates available.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            const openTemplate = () => {
              if (isCampaignDraft) router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
              else setPreviewDesign(t.design);
            };
            const actions: TemplateCardAction[] = showCopyAction
              ? [
                  {
                    key: 'copy',
                    label: copyingDesign === t.design
                      ? 'Copying…'
                      : copyTargetAccountLabel
                        ? `Copy to ${copyTargetAccountLabel}`
                        : 'Copy to subaccount',
                    icon: Square2StackIcon,
                    run: () => void copyToSubaccount(t.design),
                  },
                ]
              : [];
            return (
              <TemplateCard
                key={t.design}
                preview={<TemplatePreview design={t.design} height={180} />}
                name={t.name || formatDesign(t.design)}
                badges={
                  <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {templateTypeLabel}
                  </span>
                }
                category={t.category}
                tags={tags}
                isClient
                actions={actions}
                onClick={openTemplate}
              />
            );
          })}
        </div>
      )}
      </TemplateLibraryShell>

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
  tagData, onSave, onClose,
}: {
  tagData: TagData;
  onSave: (data: TagData) => void; onClose: () => void;
}) {
  const { confirm } = useLoomiDialog();
  const [local, setLocal] = useState<TagData>(JSON.parse(JSON.stringify(tagData)));
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');

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

  const getTagCount = (tagName: string) =>
    Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal w-[480px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold">Manage Tags</h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">Create, rename, and remove tags.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tags */}
          <div>
            <div className="space-y-1.5">
              {local.tags.length === 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)] italic py-4 text-center">
                  No tags yet. Create one below or add one inline from a template card.
                </p>
              )}
              {local.tags.map((tag) => {
                const color = getTagColor(tag);
                return (
                  <div key={tag} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                    <span className={`inline-block w-2 h-2 rounded-full ${color.className.split(' ')[0]}`} />
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
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]" placeholder="New tag name..." />
              <PrimaryButton onClick={addTag} disabled={!newTagName.trim()}>Add</PrimaryButton>
            </div>
          </div>

          <p className="text-[11px] text-[var(--muted-foreground)] -mt-1">
            Assign tags to templates directly from the library — click the <span className="inline-flex items-center gap-0.5 text-[var(--muted-foreground)]"><PlusIcon className="w-3 h-3 inline" />tag</span> button on any template card.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors">Cancel</button>
          <PrimaryButton onClick={() => onSave(local)}>Save</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

