'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { isVisualEditableTemplate } from '@/lib/email/types';
import {
  PlusIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ListBulletIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  CodeBracketIcon,
  EllipsisVerticalIcon,
  ArrowUpTrayIcon,
  BuildingStorefrontIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  CheckIcon,
  CursorArrowRaysIcon,
  BookOpenIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { AccountAvatar } from '@/components/account-avatar';
import BulkActionDock from '@/components/bulk-action-dock';
import { LibraryPickerContent } from '@/components/library-picker-content';
import PrimaryButton from '@/components/primary-button';
import { getStarterTemplate } from '@/lib/template-starters';

// ── Types ──

interface EspTemplateRecord {
  id: string;
  accountKey: string;
  provider: string;
  remoteId: string | null;
  publishedTo?: string | null;
  name: string;
  subject: string | null;
  previewText: string | null;
  html: string;
  source?: string | null;
  status: string;
  editorType: string | null;
  thumbnailUrl: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TemplateFolder {
  id: string;
  accountKey: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FolderBreadcrumb {
  id: string | null;
  name: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  iconSrc?: string;
}

// ── Helpers ──

const VIEW_KEY = 'loomi-templates-view';

function loadView(): 'card' | 'list' {
  if (typeof window === 'undefined') return 'card';
  return (localStorage.getItem(VIEW_KEY) as 'card' | 'list') || 'card';
}
function saveView(view: 'card' | 'list') {
  localStorage.setItem(VIEW_KEY, view);
}

const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f59e0b20', text: '#f59e0b' },
  active: { bg: '#10b98120', text: '#10b981' },
  archived: { bg: '#6b728020', text: '#6b7280' },
};

const KNOWN_STATUSES = new Set(Object.keys(statusColors));
/** Normalize status for display — map unrecognized values to "draft". */
function displayStatus(status: string): string {
  return KNOWN_STATUSES.has(status) ? status : 'draft';
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function hasRenderablePreview(html: string | null | undefined): boolean {
  const trimmed = html?.trim() ?? '';
  return (
    trimmed.length > 0 &&
    (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML'))
  );
}

function getLatestRenderableHtml(template: Pick<EspTemplateRecord, 'source' | 'html'>): string {
  if (hasRenderablePreview(template.source)) {
    return (template.source || '').trim();
  }
  if (hasRenderablePreview(template.html)) {
    return (template.html || '').trim();
  }
  return '';
}

function hasVisualTemplateScaffold(raw: string | null | undefined): boolean {
  // Recognizes v2 JSON and legacy <x-base> scaffold as visual-editable.
  return isVisualEditableTemplate(raw);
}

function getTemplateTypeLabel(template: Pick<EspTemplateRecord, 'editorType' | 'source'>): 'HTML' | 'Drag & Drop' {
  if (template.editorType === 'code') return 'HTML';
  if (template.editorType === 'visual') return 'Drag & Drop';
  return hasVisualTemplateScaffold(template.source) ? 'Drag & Drop' : 'HTML';
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'template';
}

function buildCloneName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Untitled Template Copy';
  if (/\scopy$/i.test(trimmed)) return `${trimmed} 2`;
  return `${trimmed} Copy`;
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

async function downloadTemplateScreenshot(
  accountKey: string,
  templateId: string,
  fileBaseName: string,
): Promise<void> {
  const params = new URLSearchParams({ accountKey, templateId });
  params.set('ts', String(Date.now()));
  const res = await fetch(`/api/esp/templates/screenshot?${params.toString()}`);
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

function openHtmlInNewTab(html: string, title: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    toast.error('Unable to open a new tab. Please allow pop-ups.');
    return;
  }
  try {
    win.opener = null;
  } catch {
    // Ignore browser restrictions around opener.
  }
  win.document.title = title;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Known providers — used for pills and filter
const PROVIDER_META: Record<string, ProviderInfo> = {
  ghl: {
    id: 'ghl',
    displayName: 'GoHighLevel',
    iconSrc: 'https://storage.googleapis.com/msgsndr/CVpny6EUSHRxlXfqAFb7/media/6992d3c254da0462343bf828.jpg',
  },
  klaviyo: {
    id: 'klaviyo',
    displayName: 'Klaviyo',
    iconSrc: 'https://storage.googleapis.com/msgsndr/CVpny6EUSHRxlXfqAFb7/media/6992d3ac3b3cc9155bdaf06e.png',
  },
};

function providerLabel(provider: string): string {
  return PROVIDER_META[provider]?.displayName || provider;
}

function providerIcon(provider: string): string | undefined {
  return PROVIDER_META[provider]?.iconSrc;
}

function isPublishedToEsp(template: Pick<EspTemplateRecord, 'remoteId' | 'publishedTo'>): boolean {
  if (template.remoteId) return true;
  if (!template.publishedTo) return false;
  try {
    const parsed = JSON.parse(template.publishedTo);
    return Boolean(parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0);
  } catch {
    return false;
  }
}

// ── Extracted sub-components (stable references — never defined inside a render) ──

function ProviderLogoCircle({ provider, size = 18 }: { provider: string; size?: number }) {
  const icon = providerIcon(provider);
  const initials = provider.slice(0, 2).toUpperCase() || '?';
  return (
    <span
      title={providerLabel(provider)}
      className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--muted)] text-[10px] font-semibold text-[var(--muted-foreground)] overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {icon ? (
        <img
          src={icon}
          alt={providerLabel(provider)}
          className="w-full h-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}

interface AccountIdentityProps {
  acctKey: string;
  accounts: Record<string, AccountData>;
  provider: string;
  showProvider?: boolean;
  providerLogoSize?: number;
}

function AccountIdentity({
  acctKey,
  accounts,
  provider,
  showProvider = true,
  providerLogoSize = 18,
}: AccountIdentityProps) {
  const account = accounts[acctKey];
  const name = account?.dealer || acctKey;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <AccountAvatar
        name={name}
        accountKey={acctKey}
        storefrontImage={account?.storefrontImage}
        logos={account?.logos}
        size={20}
        className="rounded-full border border-[var(--border)] bg-[var(--muted)] flex-shrink-0"
      />
      <span className="text-[11px] font-medium text-[var(--muted-foreground)] truncate">
        {name}
      </span>
      {showProvider && (
        <ProviderLogoCircle provider={provider} size={providerLogoSize} />
      )}
    </div>
  );
}

interface EspHtmlPreviewProps {
  html: string;
  height?: number;
}

/** Check whether a thumbnail URL looks like it can be loaded client-side. */
function isUsableThumbnailUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // GHL internal URLs (msgsndr / leadconnectorhq storage) require auth and won't render
  if (trimmed.includes('leadconnectorhq.com') || trimmed.includes('msgsndr.com')) return false;
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
}

function EspHtmlPreview({ html, height = 160 }: EspHtmlPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    resizeObserver.observe(el);
    setContainerWidth(el.clientWidth);
    return () => resizeObserver.disconnect();
  }, []);

  const iframeWidth = 600;
  const scale = containerWidth > 0 ? containerWidth / iframeWidth : 0.4;

  // Only render if we have properly compiled HTML (starts with <!DOCTYPE or <html)
  // Raw Maizzle source (frontmatter, <x- tags) should not be rendered in an iframe
  const hasPreview = hasRenderablePreview(html);

  return (
    <div ref={containerRef} className="relative overflow-hidden bg-[var(--muted)]" style={{ height }}>
      {hasPreview && containerWidth > 0 && (
        <iframe
          srcDoc={`<style>html,body{overflow:hidden !important;margin:0;}</style>${html}`}
          className="border-0 pointer-events-none absolute top-0 left-0"
          scrolling="no"
          style={{
            width: `${iframeWidth}px`,
            height: `${Math.round(height / scale)}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          title="Template preview"
          sandbox="allow-same-origin"
          tabIndex={-1}
        />
      )}
      {!hasPreview && (
        <div className="absolute inset-0 flex items-center justify-center">
          <EnvelopeIcon className="w-10 h-10 text-[var(--muted-foreground)] opacity-30" />
        </div>
      )}
    </div>
  );
}

interface TemplateCardProps {
  t: EspTemplateRecord;
  showAccount?: boolean;
  isMenuOpen: boolean;
  isSelected: boolean;
  selectMode: boolean;
  downloading: boolean;
  canMove: boolean;
  accounts: Record<string, AccountData>;
  onMenuToggle: (id: string | null) => void;
  onPreview: (t: EspTemplateRecord) => void;
  onEdit: (t: Pick<EspTemplateRecord, 'id' | 'editorType'>) => void;
  onRename: (t: EspTemplateRecord) => void;
  onMove: (t: EspTemplateRecord) => void;
  onClone: (t: EspTemplateRecord) => void;
  onDownloadScreenshot: (t: EspTemplateRecord) => void;
  onDelete: (t: EspTemplateRecord) => void;
  onSelect: (id: string) => void;
}

function TemplateCard({
  t,
  showAccount = false,
  isMenuOpen,
  isSelected,
  selectMode,
  downloading,
  canMove,
  accounts,
  onMenuToggle,
  onPreview,
  onEdit,
  onRename,
  onMove,
  onClone,
  onDownloadScreenshot,
  onDelete,
  onSelect,
}: TemplateCardProps) {
  const normStatus = displayStatus(t.status);
  const sc = statusColors[normStatus];
  const templateTypeLabel = getTemplateTypeLabel(t);
  const previewHtml = getLatestRenderableHtml(t);
  const hasLiveHtmlPreview = previewHtml.length > 0;

  return (
    <div className={`glass-card rounded-xl group animate-fade-in-up relative ${isMenuOpen ? 'z-10' : ''}`}>
      {/* Selection ring overlay – renders above iframe */}
      {isSelected && (
        <div className="absolute inset-0 border-3 border-[var(--primary)] rounded-xl z-20 pointer-events-none" />
      )}
      <div
        className="rounded-t-xl cursor-pointer relative overflow-hidden"
        onClick={() => selectMode ? onSelect(t.id) : onPreview(t)}
      >
        {hasLiveHtmlPreview ? (
          <EspHtmlPreview html={previewHtml} height={160} />
        ) : isUsableThumbnailUrl(t.thumbnailUrl) ? (
          <div className="h-[160px] bg-[var(--muted)]">
            <img
              src={t.thumbnailUrl!}
              alt={t.name}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="h-[160px] bg-[var(--muted)] flex items-center justify-center">
            <EnvelopeIcon className="w-10 h-10 text-[var(--muted-foreground)] opacity-30" />
          </div>
        )}
        {/* Selection overlay */}
        {selectMode && (
          <div className="absolute inset-0 bg-black/10">
            <div className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
                : 'border-white/80 bg-black/20'
            }`}>
              {isSelected && <CheckIcon className="w-3.5 h-3.5" />}
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {showAccount ? (
              <AccountIdentity
                acctKey={t.accountKey}
                accounts={accounts}
                provider={t.provider}
                showProvider={isPublishedToEsp(t)}
              />
            ) : (
              <ProviderLogoCircle provider={t.provider} />
            )}
          </div>
          {!selectMode && (
            <div className="relative flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onMenuToggle(isMenuOpen ? null : t.id); }}
                className={`p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${isMenuOpen ? 'opacity-100 bg-[var(--muted)]' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <EllipsisVerticalIcon className="w-4 h-4" />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-52 glass-dropdown" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { onMenuToggle(null); onPreview(t); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <EyeIcon className="w-4 h-4" /> View
                  </button>
                  <button
                    onClick={() => { onMenuToggle(null); onEdit(t); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <PencilSquareIcon className="w-4 h-4" /> Edit
                  </button>
                  <button
                    onClick={() => { onMenuToggle(null); onRename(t); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <PencilIcon className="w-4 h-4" /> Rename
                  </button>
                  {canMove && (
                    <button
                      onClick={() => { onMenuToggle(null); onMove(t); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <FolderIcon className="w-4 h-4" /> Move
                    </button>
                  )}
                  <button
                    onClick={() => { onMenuToggle(null); onClone(t); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <DocumentDuplicateIcon className="w-4 h-4" /> Clone
                  </button>
                  <button
                    onClick={() => { onMenuToggle(null); onDownloadScreenshot(t); }}
                    disabled={downloading}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-60"
                  >
                    {downloading ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    )}
                    {downloading ? 'Downloading...' : 'Download PNG'}
                  </button>
                  <button
                    onClick={() => { onMenuToggle(null); onDelete(t); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" /> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <h3
          className="text-sm font-semibold cursor-pointer hover:text-[var(--primary)] transition-colors truncate"
          onClick={() => selectMode ? onSelect(t.id) : onEdit(t)}
        >
          {t.name}
        </h3>
        <div className="flex items-center gap-2 mt-2">
          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {templateTypeLabel}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: sc.bg, color: sc.text }}
          >
            {normStatus}
          </span>
          {t.remoteId && (
            <ArrowUpTrayIcon className="w-3 h-3 text-[var(--muted-foreground)]" title="Published" />
          )}
          <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">{timeAgo(t.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

interface TemplateRowProps {
  t: EspTemplateRecord;
  showAccount?: boolean;
  isMenuOpen: boolean;
  isSelected: boolean;
  selectMode: boolean;
  downloading: boolean;
  canMove: boolean;
  accounts: Record<string, AccountData>;
  onMenuToggle: (id: string | null) => void;
  onPreview: (t: EspTemplateRecord) => void;
  onEdit: (t: Pick<EspTemplateRecord, 'id' | 'editorType'>) => void;
  onRename: (t: EspTemplateRecord) => void;
  onMove: (t: EspTemplateRecord) => void;
  onClone: (t: EspTemplateRecord) => void;
  onDownloadScreenshot: (t: EspTemplateRecord) => void;
  onDelete: (t: EspTemplateRecord) => void;
  onSelect: (id: string) => void;
}

function TemplateRow({
  t,
  showAccount = false,
  isMenuOpen,
  isSelected,
  selectMode,
  downloading,
  canMove,
  accounts,
  onMenuToggle,
  onPreview,
  onEdit,
  onRename,
  onMove,
  onClone,
  onDownloadScreenshot,
  onDelete,
  onSelect,
}: TemplateRowProps) {
  const normStatus = displayStatus(t.status);
  const sc = statusColors[normStatus];
  const templateTypeLabel = getTemplateTypeLabel(t);

  return (
    <div
      className={`flex items-center gap-4 p-3 glass-card rounded-xl group animate-fade-in-up relative ${isMenuOpen ? 'z-10' : ''}`}
      onClick={selectMode ? () => onSelect(t.id) : undefined}
    >
      {/* Selection ring overlay */}
      {isSelected && (
        <div className="absolute inset-0 border-3 border-[var(--primary)] rounded-xl z-20 pointer-events-none" />
      )}
      {/* Selection checkbox */}
      {selectMode && (
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
          isSelected
            ? 'bg-[var(--primary)] border-[var(--primary)] text-white'
            : 'border-[var(--border)] hover:border-[var(--primary)]'
        }`}>
          {isSelected && <CheckIcon className="w-3 h-3" />}
        </div>
      )}
      <div className="w-10 h-10 rounded-lg bg-[var(--muted)] flex items-center justify-center flex-shrink-0 overflow-hidden">
        {isUsableThumbnailUrl(t.thumbnailUrl) ? (
          <img
            src={t.thumbnailUrl!}
            alt={t.name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <EnvelopeIcon className="w-5 h-5 text-[var(--muted-foreground)] opacity-40" />
        )}
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={selectMode ? undefined : () => onEdit(t)}>
        <h3 className="font-semibold text-sm truncate">{t.name}</h3>
      </div>
      {showAccount ? (
        <div className="min-w-0 max-w-[260px]">
          <AccountIdentity
            acctKey={t.accountKey}
            accounts={accounts}
            provider={t.provider}
            showProvider={isPublishedToEsp(t)}
          />
        </div>
      ) : (
        <ProviderLogoCircle provider={t.provider} />
      )}
      <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] flex-shrink-0">
        {templateTypeLabel}
      </span>
      <span
        className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: sc.bg, color: sc.text }}
      >
        {normStatus}
      </span>
      {t.remoteId && (
        <ArrowUpTrayIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" title="Published" />
      )}
      <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 w-14 text-right">
        {timeAgo(t.updatedAt)}
      </span>
      {!selectMode && (
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onMenuToggle(isMenuOpen ? null : t.id); }}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <EllipsisVerticalIcon className="w-4 h-4" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-52 glass-dropdown" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { onMenuToggle(null); onPreview(t); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <EyeIcon className="w-4 h-4" /> View
              </button>
              <button
                onClick={() => { onMenuToggle(null); onEdit(t); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <PencilSquareIcon className="w-4 h-4" /> Edit
              </button>
              <button
                onClick={() => { onMenuToggle(null); onRename(t); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <PencilIcon className="w-4 h-4" /> Rename
              </button>
              {canMove && (
                <button
                  onClick={() => { onMenuToggle(null); onMove(t); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <FolderIcon className="w-4 h-4" /> Move
                </button>
              )}
              <button
                onClick={() => { onMenuToggle(null); onClone(t); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <DocumentDuplicateIcon className="w-4 h-4" /> Clone
              </button>
              <button
                onClick={() => { onMenuToggle(null); onDownloadScreenshot(t); }}
                disabled={downloading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-60"
              >
                {downloading ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowDownTrayIcon className="w-4 h-4" />
                )}
                {downloading ? 'Downloading...' : 'Download PNG'}
              </button>
              <button
                onClick={() => { onMenuToggle(null); onDelete(t); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <TrashIcon className="w-4 h-4" /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ToolbarProps {
  showAccountFilter?: boolean;
  search: string;
  setSearch: (v: string) => void;
  isAdmin: boolean;
  accountFilter: string;
  setAccountFilter: (v: string) => void;
  accountDropdownOpen: boolean;
  setAccountDropdownOpen: (v: boolean) => void;
  accountDropdownRef: React.RefObject<HTMLDivElement | null>;
  accountFilterLabel: string;
  selectedAccountData: AccountData | null;
  allAccountKeys: string[];
  accounts: Record<string, AccountData>;
  providerFilter: string;
  setProviderFilter: (v: string) => void;
  uniqueProviders: string[];
  viewMode: 'card' | 'list';
  toggleView: (mode: 'card' | 'list') => void;
  // Bulk selection
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  selectedIds: Set<string>;
  setSelectedIds: (v: Set<string>) => void;
  filteredCount: number;
  filteredIds: string[];
  onBulkDelete: () => void;
  onBulkMove?: () => void;
  foldersEnabled?: boolean;
}

function Toolbar({
  showAccountFilter = false,
  search,
  setSearch,
  isAdmin,
  accountFilter,
  setAccountFilter,
  accountDropdownOpen,
  setAccountDropdownOpen,
  accountDropdownRef,
  accountFilterLabel,
  selectedAccountData,
  allAccountKeys,
  accounts,
  providerFilter,
  setProviderFilter,
  uniqueProviders,
  viewMode,
  toggleView,
  selectMode,
  setSelectMode,
  selectedIds,
  setSelectedIds,
  filteredCount,
  filteredIds,
  onBulkDelete,
  onBulkMove,
  foldersEnabled = false,
}: ToolbarProps) {
  const closeSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCount) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredIds));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
              placeholder={isAdmin ? 'Search templates or sub-accounts...' : 'Search templates...'}
            />
          </div>

          {/* Account filter dropdown (admin flat list only) */}
          {showAccountFilter && allAccountKeys.length > 1 && (
            <div ref={accountDropdownRef} className="relative">
              <button
                onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                className={`inline-flex items-center gap-1.5 h-[38px] px-3 text-sm rounded-lg border transition-colors ${
                  accountDropdownOpen
                    ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
                    : accountFilter !== 'all'
                      ? 'border-[var(--primary)]/50 text-[var(--primary)] bg-[var(--primary)]/5'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                }`}
              >
                {accountFilter !== 'all' ? (
                  <AccountAvatar
                    name={accountFilterLabel}
                    accountKey={accountFilter}
                    storefrontImage={selectedAccountData?.storefrontImage}
                    logos={selectedAccountData?.logos}
                    size={16}
                    className="w-4 h-4 rounded-[3px] object-cover flex-shrink-0 border border-[var(--border)]"
                  />
                ) : (
                  <BuildingStorefrontIcon className="w-3.5 h-3.5" />
                )}
                <span className="max-w-[140px] truncate">{accountFilterLabel}</span>
                {accountFilter !== 'all' ? (
                  <XMarkIcon
                    className="w-3 h-3 hover:text-[var(--foreground)]"
                    onClick={(e) => { e.stopPropagation(); setAccountFilter('all'); setAccountDropdownOpen(false); }}
                  />
                ) : (
                  <ChevronDownIcon className={`w-3 h-3 transition-transform ${accountDropdownOpen ? 'rotate-180' : ''}`} />
                )}
              </button>

              {accountDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 z-50 glass-dropdown shadow-lg animate-fade-in-up" style={{ minWidth: '260px' }}>
                  <div className="p-1.5">
                    <p className="px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                      Filter by Account
                    </p>
                    <button
                      onClick={() => { setAccountFilter('all'); setAccountDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                        accountFilter === 'all'
                          ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                      }`}
                    >
                      All Accounts
                      {accountFilter === 'all' && <CheckIcon className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="border-t border-[var(--border)] max-h-[280px] overflow-y-auto p-1.5">
                    {allAccountKeys.map(k => {
                      const acct = accounts[k];
                      const isSelected = accountFilter === k;
                      const location = [acct?.city, acct?.state].filter(Boolean).join(', ');
                      return (
                        <button
                          key={k}
                          onClick={() => { setAccountFilter(k); setAccountDropdownOpen(false); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                            isSelected
                              ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                              : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                          }`}
                        >
                          <AccountAvatar
                            name={acct?.dealer || k}
                            accountKey={k}
                            storefrontImage={acct?.storefrontImage}
                            logos={acct?.logos}
                            size={20}
                            className="w-5 h-5 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
                          />
                          <span className="flex-1 min-w-0 text-left">
                            <span className="block truncate">{acct?.dealer || k}</span>
                            {location && (
                              <span className="block text-[10px] text-[var(--muted-foreground)] truncate">{location}</span>
                            )}
                          </span>
                          {isSelected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Provider filter */}
          {uniqueProviders.length > 1 && (
            <div className="flex items-center gap-1 bg-[var(--muted)] rounded-lg p-0.5">
              <button
                onClick={() => setProviderFilter('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${providerFilter === 'all' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}
              >
                All
              </button>
              {uniqueProviders.map(p => (
                <button
                  key={p}
                  onClick={() => setProviderFilter(p)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${providerFilter === p ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}
                >
                  {providerIcon(p) && (
                    <img src={providerIcon(p)} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                  )}
                  {providerLabel(p)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Select toggle */}
          <button
            onClick={() => {
              if (selectMode) {
                closeSelectMode();
                return;
              }
              setSelectMode(true);
            }}
            className={`inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border transition-colors ${
              selectMode
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            <img src="/icons/select-checkbox.svg" alt="" aria-hidden className="w-3.5 h-3.5 invert opacity-80" />
            {selectMode ? 'Cancel' : 'Select'}
          </button>

          {/* View toggle */}
          <div className="flex items-center bg-[var(--muted)] rounded-lg p-0.5">
            <button
              onClick={() => toggleView('card')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}
              title="Card view"
            >
              <Squares2X2Icon className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleView('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}
              title="List view"
            >
              <ListBulletIcon className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {selectMode && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel="templates"
          onClose={closeSelectMode}
          actions={[
            {
              id: 'select-all',
              label: selectedIds.size === filteredCount ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: toggleSelectAll,
              disabled: filteredCount === 0,
            },
            {
              id: 'move',
              label: 'Move',
              icon: <FolderIcon className="h-4 w-4" />,
              onClick: () => { if (onBulkMove) onBulkMove(); },
              disabled: !foldersEnabled || !onBulkMove || selectedIds.size === 0,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: onBulkDelete,
              disabled: selectedIds.size === 0,
              danger: true,
            },
          ]}
        />
      )}
    </>
  );
}

interface TemplateListViewProps {
  templates: EspTemplateRecord[];
  showAccount?: boolean;
  loading: boolean;
  allTemplatesEmpty: boolean;
  viewMode: 'card' | 'list';
  providerFilter: string;
  search: string;
  openMenu: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  canMove: boolean;
  accounts: Record<string, AccountData>;
  downloadingId: string | null;
  onMenuToggle: (id: string | null) => void;
  onPreview: (t: EspTemplateRecord) => void;
  onEdit: (t: Pick<EspTemplateRecord, 'id' | 'editorType'>) => void;
  onRename: (t: EspTemplateRecord) => void;
  onMove: (t: EspTemplateRecord) => void;
  onClone: (t: EspTemplateRecord) => void;
  onDownloadScreenshot: (t: EspTemplateRecord) => void;
  onDelete: (t: EspTemplateRecord) => void;
  onSelect: (id: string) => void;
}

function TemplateListView({
  templates: items,
  showAccount = false,
  loading,
  allTemplatesEmpty,
  viewMode,
  providerFilter,
  search,
  openMenu,
  selectMode,
  selectedIds,
  canMove,
  accounts,
  downloadingId,
  onMenuToggle,
  onPreview,
  onEdit,
  onRename,
  onMove,
  onClone,
  onDownloadScreenshot,
  onDelete,
  onSelect,
}: TemplateListViewProps) {
  return (
    <>
      <p className="text-xs text-[var(--muted-foreground)] mb-4">
        {loading ? 'Loading...' : `${items.length} template${items.length !== 1 ? 's' : ''}`}
        {providerFilter !== 'all' && ` from ${providerLabel(providerFilter)}`}
        {search && ` matching "${search}"`}
      </p>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-card rounded-xl animate-pulse">
              <div className="h-32 rounded-t-xl bg-[var(--muted)]" />
              <div className="p-4 space-y-2">
                <div className="h-3 bg-[var(--muted)] rounded w-16" />
                <div className="h-4 bg-[var(--muted)] rounded w-3/4" />
                <div className="h-3 bg-[var(--muted)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <EnvelopeIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {allTemplatesEmpty ? (
            <>
              <p className="text-sm font-medium mb-1">No templates yet</p>
              <p className="text-xs mb-4">Click &quot;Sync&quot; to pull templates from your connected platform, or create a new one.</p>
            </>
          ) : (
            <p className="text-sm">No templates were found.</p>
          )}
        </div>
      )}

      {!loading && items.length > 0 && (
        viewMode === 'card' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map(t => (
              <TemplateCard
                key={t.id}
                t={t}
                showAccount={showAccount}
                isMenuOpen={openMenu === t.id}
                isSelected={selectedIds.has(t.id)}
                selectMode={selectMode}
                downloading={downloadingId === t.id}
                canMove={canMove}
                accounts={accounts}
                onMenuToggle={onMenuToggle}
                onPreview={onPreview}
                onEdit={onEdit}
                onRename={onRename}
                onMove={onMove}
                onClone={onClone}
                onDownloadScreenshot={onDownloadScreenshot}
                onDelete={onDelete}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map(t => (
              <TemplateRow
                key={t.id}
                t={t}
                showAccount={showAccount}
                isMenuOpen={openMenu === t.id}
                isSelected={selectedIds.has(t.id)}
                selectMode={selectMode}
                downloading={downloadingId === t.id}
                canMove={canMove}
                accounts={accounts}
                onMenuToggle={onMenuToggle}
                onPreview={onPreview}
                onEdit={onEdit}
                onRename={onRename}
                onMove={onMove}
                onClone={onClone}
                onDownloadScreenshot={onDownloadScreenshot}
                onDelete={onDelete}
                onSelect={onSelect}
              />
            ))}
          </div>
        )
      )}
    </>
  );
}

// ── Page ──

export default function TemplatesPage() {
  const { isAdmin, isAccount, accountKey, accountData, accounts } = useAccount();
  const { confirm } = useLoomiDialog();
  const router = useRouter();
  const pathname = usePathname();
  const subHref = useSubaccountHref();

  // State
  const [allTemplates, setAllTemplates] = useState<EspTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Modals
  const [showCreateChoice, setShowCreateChoice] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState<EspTemplateRecord | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EspTemplateRecord | null>(null);
  const [renameTemplate, setRenameTemplate] = useState<EspTemplateRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [cloneTemplate, setCloneTemplate] = useState<EspTemplateRecord | null>(null);
  const [cloneDestination, setCloneDestination] = useState<'loomi' | 'subaccounts' | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // Admin overview table sort + pagination
  const [overviewSortField, setOverviewSortField] = useState<'name' | 'location' | 'templates' | 'integrations'>('name');
  const [overviewSortDir, setOverviewSortDir] = useState<'asc' | 'desc'>('asc');
  const [overviewPage, setOverviewPage] = useState(1);

  // Library picker (inside create modal)
  const [libraryPickerMode, setLibraryPickerMode] = useState(false);
  const [createAccountKey, setCreateAccountKey] = useState<string | null>(null);
  const [createAccountSearch, setCreateAccountSearch] = useState('');
  const [cloneAccountSearch, setCloneAccountSearch] = useState('');
  const [cloneAccountKeys, setCloneAccountKeys] = useState<Set<string>>(new Set());
  const [createMode, setCreateMode] = useState<'visual' | 'code' | null>(null);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [templateFolders, setTemplateFolders] = useState<TemplateFolder[]>([]);
  const [templateFolderAssignments, setTemplateFolderAssignments] = useState<Record<string, string>>({});
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([{ id: null, name: 'Root' }]);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [renameFolderItem, setRenameFolderItem] = useState<TemplateFolder | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [deleteFolderItem, setDeleteFolderItem] = useState<TemplateFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTemplateIds, setMoveTemplateIds] = useState<string[]>([]);
  const [moveFolderPath, setMoveFolderPath] = useState<FolderBreadcrumb[]>([{ id: null, name: 'Root' }]);
  const [movingTemplates, setMovingTemplates] = useState(false);
  const previewTemplateHtml = useMemo(
    () => (previewTemplate ? getLatestRenderableHtml(previewTemplate) : ''),
    [previewTemplate],
  );
  const hasPreviewTemplateHtml = previewTemplateHtml.length > 0;

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const accountDropdownRef = useRef<HTMLDivElement>(null);
  const menuClickRef = useRef(false);
  const lastTemplatesRefreshAtRef = useRef(0);
  const templatesRequestIdRef = useRef(0);
  const templateFoldersRequestIdRef = useRef(0);

  // Bulk selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const autoSyncedAccountKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setViewMode(loadView());
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => {
      if (menuClickRef.current) { menuClickRef.current = false; return; }
      setOpenMenu(null);
      setFolderMenuId(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Close account dropdown on outside click
  useEffect(() => {
    if (!accountDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target as Node)) {
        setAccountDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [accountDropdownOpen]);

  // Derive the effective account key for single-account mode
  const effectiveAccountKey = isAccount ? accountKey : null;
  const folderAccountKey = effectiveAccountKey || (accountFilter !== 'all' ? accountFilter : null);
  const showAdminOverview = isAdmin && !folderAccountKey;
  const foldersEnabled = Boolean(folderAccountKey);
  const activeTemplatesScopeKey = effectiveAccountKey || '__all__';
  const activeFolderScopeKey = folderAccountKey || '__none__';
  const activeTemplatesScopeKeyRef = useRef(activeTemplatesScopeKey);
  const activeFolderScopeKeyRef = useRef(activeFolderScopeKey);

  useEffect(() => {
    activeTemplatesScopeKeyRef.current = activeTemplatesScopeKey;
  }, [activeTemplatesScopeKey]);

  useEffect(() => {
    activeFolderScopeKeyRef.current = activeFolderScopeKey;
  }, [activeFolderScopeKey]);

  useEffect(() => {
    if (isAccount && accountFilter !== 'all') {
      setAccountFilter('all');
    }
  }, [accountFilter, isAccount]);

  // ── Data Loading ──

  const loadTemplates = useCallback(async (requestedAccountKey: string | null = effectiveAccountKey) => {
    const requestScopeKey = requestedAccountKey || '__all__';
    if (requestScopeKey !== activeTemplatesScopeKeyRef.current) return;

    const requestId = ++templatesRequestIdRef.current;
    try {
      const url = requestedAccountKey
        ? `/api/esp/templates?accountKey=${encodeURIComponent(requestedAccountKey)}`
        : '/api/esp/templates';
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (requestId !== templatesRequestIdRef.current || requestScopeKey !== activeTemplatesScopeKeyRef.current) {
        return;
      }
      if (res.ok) {
        setAllTemplates(data.templates || []);
      } else {
        console.error('Failed to load templates:', data.error);
      }
    } catch (err) {
      if (requestId !== templatesRequestIdRef.current || requestScopeKey !== activeTemplatesScopeKeyRef.current) {
        return;
      }
      console.error('Failed to load templates:', err);
    } finally {
      if (requestId === templatesRequestIdRef.current && requestScopeKey === activeTemplatesScopeKeyRef.current) {
        setLoading(false);
      }
    }
  }, [effectiveAccountKey]);

  useEffect(() => {
    setAllTemplates([]);
    setLoading(true);
    void loadTemplates(effectiveAccountKey);
  }, [activeTemplatesScopeKey, effectiveAccountKey, loadTemplates]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const refresh = () => {
      const now = Date.now();
      if (now - lastTemplatesRefreshAtRef.current < 800) return;
      lastTemplatesRefreshAtRef.current = now;
      loadTemplates();
    };

    const onFocus = () => refresh();
    const onPageShow = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadTemplates]);

  const loadTemplateFolders = useCallback(async (requestedAccountKey: string | null = folderAccountKey) => {
    const requestScopeKey = requestedAccountKey || '__none__';
    if (requestScopeKey !== activeFolderScopeKeyRef.current || !foldersEnabled || !requestedAccountKey) {
      setTemplateFolders([]);
      setTemplateFolderAssignments({});
      return;
    }

    const requestId = ++templateFoldersRequestIdRef.current;
    setFoldersLoading(true);
    try {
      const params = new URLSearchParams({ accountKey: requestedAccountKey });
      const res = await fetch(`/api/esp/template-folders?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (requestId !== templateFoldersRequestIdRef.current || requestScopeKey !== activeFolderScopeKeyRef.current) {
        return;
      }
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to load folders';
        toast.error(message);
        return;
      }
      const nextFolders = Array.isArray(data?.folders) ? data.folders as TemplateFolder[] : [];
      const nextAssignments = data?.assignments && typeof data.assignments === 'object'
        ? data.assignments as Record<string, string>
        : {};
      setTemplateFolders(nextFolders);
      setTemplateFolderAssignments(nextAssignments);
    } catch {
      if (requestId !== templateFoldersRequestIdRef.current || requestScopeKey !== activeFolderScopeKeyRef.current) {
        return;
      }
      toast.error('Failed to load folders');
    } finally {
      if (requestId === templateFoldersRequestIdRef.current && requestScopeKey === activeFolderScopeKeyRef.current) {
        setFoldersLoading(false);
      }
    }
  }, [folderAccountKey, foldersEnabled]);

  useEffect(() => {
    setCurrentFolderId(null);
    setFolderPath([{ id: null, name: 'Root' }]);
    setShowNewFolderInput(false);
    setNewFolderName('');
    setFolderMenuId(null);
    if (!foldersEnabled || !folderAccountKey) {
      setTemplateFolders([]);
      setTemplateFolderAssignments({});
      return;
    }
    void loadTemplateFolders(folderAccountKey);
  }, [activeFolderScopeKey, folderAccountKey, foldersEnabled, loadTemplateFolders]);

  useEffect(() => {
    if (!foldersEnabled) return;
    if (!currentFolderId) {
      setFolderPath([{ id: null, name: 'Root' }]);
      return;
    }

    const byId = new Map<string, TemplateFolder>(
      templateFolders.map((folder): [string, TemplateFolder] => [folder.id, folder]),
    );
    const seen = new Set<string>();
    const pathItems: FolderBreadcrumb[] = [];
    let cursor: string | null = currentFolderId;
    while (cursor && byId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const nextFolder: TemplateFolder = byId.get(cursor)!;
      pathItems.unshift({ id: nextFolder.id, name: nextFolder.name });
      cursor = nextFolder.parentId;
    }
    setFolderPath([{ id: null, name: 'Root' }, ...pathItems]);
  }, [currentFolderId, foldersEnabled, templateFolders]);

  // ── Grouped data for admin overview ──

  const accountGroups = useMemo(() => {
    const groups: Record<string, { templates: EspTemplateRecord[]; providers: Set<string> }> = {};
    for (const t of allTemplates) {
      if (!groups[t.accountKey]) {
        groups[t.accountKey] = { templates: [], providers: new Set() };
      }
      groups[t.accountKey].templates.push(t);
      groups[t.accountKey].providers.add(t.provider);
    }
    return groups;
  }, [allTemplates]);

  // All account keys that have templates OR are accessible
  const allAccountKeys = useMemo(() => {
    const keys = new Set(Object.keys(accounts));
    Object.keys(accountGroups).forEach(k => keys.add(k));
    return Array.from(keys).sort((a, b) => {
      const nameA = accounts[a]?.dealer || a;
      const nameB = accounts[b]?.dealer || b;
      return nameA.localeCompare(nameB);
    });
  }, [accounts, accountGroups]);

  const overviewFilteredAccountKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAccountKeys;
    return allAccountKeys.filter((k) => {
      const acct = accounts[k];
      const name = (acct?.dealer || k).toLowerCase();
      const location = [acct?.city, acct?.state].filter(Boolean).join(', ').toLowerCase();
      return name.includes(q) || location.includes(q) || k.toLowerCase().includes(q);
    });
  }, [allAccountKeys, accounts, search]);

  const OVERVIEW_PAGE_SIZE = 10;

  const overviewSortedKeys = useMemo(() => {
    const dir = overviewSortDir === 'asc' ? 1 : -1;
    return [...overviewFilteredAccountKeys].sort((a, b) => {
      let cmp = 0;
      if (overviewSortField === 'name') {
        cmp = (accounts[a]?.dealer || a).localeCompare(accounts[b]?.dealer || b);
      } else if (overviewSortField === 'location') {
        const locA = [accounts[a]?.city, accounts[a]?.state].filter(Boolean).join(', ');
        const locB = [accounts[b]?.city, accounts[b]?.state].filter(Boolean).join(', ');
        cmp = locA.localeCompare(locB);
      } else if (overviewSortField === 'templates') {
        cmp = (accountGroups[a]?.templates.length || 0) - (accountGroups[b]?.templates.length || 0);
      } else if (overviewSortField === 'integrations') {
        const provsA = new Set([...(accounts[a]?.connectedProviders || []), ...(accountGroups[a]?.providers || [])]);
        const provsB = new Set([...(accounts[b]?.connectedProviders || []), ...(accountGroups[b]?.providers || [])]);
        cmp = provsA.size - provsB.size;
      }
      if (cmp === 0) cmp = (accounts[a]?.dealer || a).localeCompare(accounts[b]?.dealer || b);
      return cmp * dir;
    });
  }, [overviewFilteredAccountKeys, overviewSortField, overviewSortDir, accounts, accountGroups]);

  const overviewTotalPages = Math.max(1, Math.ceil(overviewSortedKeys.length / OVERVIEW_PAGE_SIZE));

  useEffect(() => {
    if (overviewPage > overviewTotalPages) setOverviewPage(overviewTotalPages);
  }, [overviewPage, overviewTotalPages]);

  const overviewPageStart = (overviewPage - 1) * OVERVIEW_PAGE_SIZE;
  const overviewPagedKeys = overviewSortedKeys.slice(overviewPageStart, overviewPageStart + OVERVIEW_PAGE_SIZE);
  const overviewShowingStart = overviewSortedKeys.length === 0 ? 0 : overviewPageStart + 1;
  const overviewShowingEnd = Math.min(overviewPageStart + OVERVIEW_PAGE_SIZE, overviewSortedKeys.length);

  const toggleOverviewSort = (field: typeof overviewSortField) => {
    if (overviewSortField === field) {
      setOverviewSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOverviewSortField(field);
      setOverviewSortDir('asc');
    }
    setOverviewPage(1);
  };

  const overviewSortIndicator = (field: typeof overviewSortField) => {
    if (overviewSortField !== field) return '↕';
    return overviewSortDir === 'asc' ? '↑' : '↓';
  };

  const createFilteredAccountKeys = useMemo(() => {
    const q = createAccountSearch.trim().toLowerCase();
    if (!q) return allAccountKeys;
    return allAccountKeys.filter((k) => {
      const acct = accounts[k];
      const name = (acct?.dealer || k).toLowerCase();
      const location = [acct?.city, acct?.state].filter(Boolean).join(', ').toLowerCase();
      return name.includes(q) || location.includes(q) || k.toLowerCase().includes(q);
    });
  }, [allAccountKeys, accounts, createAccountSearch]);

  const cloneFilteredAccountKeys = useMemo(() => {
    const q = cloneAccountSearch.trim().toLowerCase();
    if (!q) return allAccountKeys;
    return allAccountKeys.filter((k) => {
      const acct = accounts[k];
      const name = (acct?.dealer || k).toLowerCase();
      const location = [acct?.city, acct?.state].filter(Boolean).join(', ').toLowerCase();
      return name.includes(q) || location.includes(q) || k.toLowerCase().includes(q);
    });
  }, [allAccountKeys, accounts, cloneAccountSearch]);

  const syncTemplatesForAccounts = useCallback(async (
    accountKeys: string[],
    options?: { force?: boolean; silent?: boolean },
  ) => {
    const uniqueKeys = Array.from(
      new Set(
        accountKeys
          .map((key) => key?.trim())
          .filter((key): key is string => Boolean(key)),
      ),
    );
    const targetKeys = options?.force
      ? uniqueKeys
      : uniqueKeys.filter((key) => !autoSyncedAccountKeysRef.current.has(key));

    if (targetKeys.length === 0) {
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        total: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: [] as string[],
      };
    }

    let succeeded = 0;
    let failed = 0;
    let total = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: string[] = [];

    try {
      for (const key of targetKeys) {
        try {
          const res = await fetch(`/api/esp/templates/sync?accountKey=${encodeURIComponent(key)}`, {
            method: 'POST',
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const label = accounts[key]?.dealer || key;
            const message =
              typeof data?.error === 'string' ? data.error : `Sync failed (${res.status})`;
            failed += 1;
            errors.push(`${label}: ${message}`);
            continue;
          }

          succeeded += 1;
          autoSyncedAccountKeysRef.current.add(key);

          total += Number(data?.sync?.total ?? 0);
          created += Number(data?.sync?.created ?? 0);
          updated += Number(data?.sync?.updated ?? 0);
          unchanged += Number(data?.sync?.unchanged ?? 0);
        } catch (err) {
          const label = accounts[key]?.dealer || key;
          const message = err instanceof Error ? err.message : 'Sync failed';
          failed += 1;
          errors.push(`${label}: ${message}`);
        }
      }

      if (succeeded > 0) {
        await loadTemplates();
      }

      if (!options?.silent) {
        if (succeeded > 0 && failed === 0) {
          if (targetKeys.length === 1) {
            toast.success(`Synced ${total} templates (${created} new, ${updated} updated)`);
          } else {
            toast.success(`Synced ${succeeded} accounts (${created} new, ${updated} updated, ${unchanged} unchanged templates)`);
          }
        } else if (succeeded > 0 && failed > 0) {
          toast.warning(`Synced ${succeeded}/${targetKeys.length} accounts. ${failed} failed.`);
        } else if (errors.length > 0) {
          toast.error(errors[0]);
        } else {
          toast.error('Failed to sync templates');
        }
      }
    } finally {
    }

    return {
      attempted: targetKeys.length,
      succeeded,
      failed,
      total,
      created,
      updated,
      unchanged,
      errors,
    };
  }, [accounts, loadTemplates]);


  useEffect(() => {
    const keysToAutoSync = effectiveAccountKey
      ? [effectiveAccountKey]
      : accountFilter !== 'all'
        ? [accountFilter]
        : [];
    if (keysToAutoSync.length === 0) return;
    void syncTemplatesForAccounts(keysToAutoSync, { silent: true, force: false });
  }, [effectiveAccountKey, accountFilter, syncTemplatesForAccounts]);

  // Account filter label
  const selectedAccountData = accountFilter !== 'all' ? accounts[accountFilter] : null;
  const accountFilterLabel = accountFilter === 'all'
    ? 'All Accounts'
    : selectedAccountData?.dealer || accountFilter;
  const activeAccountName = folderAccountKey
    ? (accounts[folderAccountKey]?.dealer || folderAccountKey)
    : null;

  // ── Filtering (for flat list view and account-level view) ──

  const filtered = useMemo(() => {
    let result = allTemplates;

    // Account filter
    if (accountFilter !== 'all') {
      result = result.filter(t => t.accountKey === accountFilter);
    }

    // Provider filter
    if (providerFilter !== 'all') {
      result = result.filter(t => t.provider === providerFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.subject && t.subject.toLowerCase().includes(q)) ||
        (isAdmin && (accounts[t.accountKey]?.dealer || '').toLowerCase().includes(q))
      );
    }

    if (foldersEnabled) {
      result = result.filter((template) => {
        const assignedFolderId = templateFolderAssignments[template.id] || null;
        if (currentFolderId) return assignedFolderId === currentFolderId;
        return !assignedFolderId;
      });
    }

    return result;
  }, [
    allTemplates,
    providerFilter,
    search,
    accountFilter,
    isAdmin,
    accounts,
    foldersEnabled,
    templateFolderAssignments,
    currentFolderId,
  ]);

  const filteredIds = useMemo(() => filtered.map(t => t.id), [filtered]);

  const uniqueProviders = useMemo(() => {
    const set = new Set(allTemplates.map(t => t.provider));
    return Array.from(set).sort();
  }, [allTemplates]);

  const currentLevelFolders = useMemo(() => {
    if (!foldersEnabled) return [] as TemplateFolder[];
    return templateFolders
      .filter((folder) => (folder.parentId || null) === (currentFolderId || null))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentFolderId, foldersEnabled, templateFolders]);

  const moveFolders = useMemo(() => {
    if (!foldersEnabled) return [] as TemplateFolder[];
    const parentId = moveFolderPath[moveFolderPath.length - 1]?.id || null;
    return templateFolders
      .filter((folder) => (folder.parentId || null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [foldersEnabled, moveFolderPath, templateFolders]);

  const toggleView = (mode: 'card' | 'list') => { setViewMode(mode); saveView(mode); };

  // ── Handlers ──

  const navigateToEditor = (template: Pick<EspTemplateRecord, 'id' | 'editorType'>) => {
    const search = new URLSearchParams({ id: template.id });
    if (template.editorType === 'code') {
      search.set('builder', 'html');
    }
    router.push(`/templates/editor?${search.toString()}`);
  };

  const handleCreateChoice = (mode: 'visual' | 'code') => {
    setCreateMode(mode);
    setCreateName('');
  };

  const handleCreateFolder = useCallback(async () => {
    if (!folderAccountKey) return;
    const folderName = newFolderName.trim();
    if (!folderName) return;
    setCreatingFolder(true);
    try {
      const res = await fetch('/api/esp/template-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: folderAccountKey,
          name: folderName,
          parentId: currentFolderId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to create folder';
        toast.error(message);
        return;
      }
      const created = data?.folder as TemplateFolder | undefined;
      if (created) {
        setTemplateFolders((prev) => [...prev, created]);
      } else {
        await loadTemplateFolders();
      }
      setNewFolderName('');
      setShowNewFolderInput(false);
      toast.success('Folder created');
    } catch {
      toast.error('Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }, [currentFolderId, folderAccountKey, loadTemplateFolders, newFolderName]);

  const openRenameFolderModal = useCallback((folder: TemplateFolder) => {
    setRenameFolderItem(folder);
    setRenameFolderValue(folder.name);
  }, []);

  const closeRenameFolderModal = useCallback(() => {
    if (renamingFolder) return;
    setRenameFolderItem(null);
    setRenameFolderValue('');
  }, [renamingFolder]);

  const handleRenameFolder = useCallback(async () => {
    if (!renameFolderItem || !folderAccountKey) return;
    const nextName = renameFolderValue.trim();
    if (!nextName) {
      toast.error('Folder name is required');
      return;
    }
    if (nextName === renameFolderItem.name) {
      closeRenameFolderModal();
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch(`/api/esp/template-folders/${encodeURIComponent(renameFolderItem.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: folderAccountKey,
          name: nextName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to rename folder';
        toast.error(message);
        return;
      }
      setTemplateFolders((prev) =>
        prev.map((folder) => (
          folder.id === renameFolderItem.id
            ? { ...folder, name: nextName }
            : folder
        )),
      );
      closeRenameFolderModal();
      toast.success('Folder renamed');
    } catch {
      toast.error('Failed to rename folder');
    } finally {
      setRenamingFolder(false);
    }
  }, [closeRenameFolderModal, folderAccountKey, renameFolderItem, renameFolderValue]);

  const handleDeleteFolder = useCallback(async () => {
    if (!deleteFolderItem || !folderAccountKey) return;
    setDeletingFolder(true);
    try {
      const params = new URLSearchParams({ accountKey: folderAccountKey });
      const res = await fetch(`/api/esp/template-folders/${encodeURIComponent(deleteFolderItem.id)}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to delete folder';
        toast.error(message);
        return;
      }

      const deletedIds = Array.isArray(data?.deletedIds) ? data.deletedIds as string[] : [];
      const deletedSet = new Set(deletedIds);

      setTemplateFolders(Array.isArray(data?.folders) ? data.folders as TemplateFolder[] : []);
      setTemplateFolderAssignments(
        data?.assignments && typeof data.assignments === 'object'
          ? data.assignments as Record<string, string>
          : {},
      );
      if (currentFolderId && deletedSet.has(currentFolderId)) {
        setCurrentFolderId(null);
      }
      setDeleteFolderItem(null);
      toast.success('Folder deleted');
    } catch {
      toast.error('Failed to delete folder');
    } finally {
      setDeletingFolder(false);
    }
  }, [currentFolderId, deleteFolderItem, folderAccountKey]);

  const openMoveTemplatesModal = useCallback((templateIds: string[]) => {
    if (templateIds.length === 0) return;
    setMoveTemplateIds(Array.from(new Set(templateIds)));
    setMoveFolderPath(folderPath.length > 0 ? folderPath : [{ id: null, name: 'Root' }]);
    setShowMoveModal(true);
  }, [folderPath]);

  const closeMoveModal = useCallback(() => {
    if (movingTemplates) return;
    setShowMoveModal(false);
    setMoveTemplateIds([]);
    setMoveFolderPath([{ id: null, name: 'Root' }]);
  }, [movingTemplates]);

  const handleMoveTemplates = useCallback(async () => {
    if (!folderAccountKey || moveTemplateIds.length === 0) return;
    const targetFolderId = moveFolderPath[moveFolderPath.length - 1]?.id || null;
    setMovingTemplates(true);
    try {
      const res = await fetch('/api/esp/template-folders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: folderAccountKey,
          templateIds: moveTemplateIds,
          folderId: targetFolderId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to move templates';
        toast.error(message);
        return;
      }
      setTemplateFolderAssignments(
        data?.assignments && typeof data.assignments === 'object'
          ? data.assignments as Record<string, string>
          : {},
      );
      closeMoveModal();
      toast.success(`Moved ${moveTemplateIds.length} template${moveTemplateIds.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to move templates');
    } finally {
      setMovingTemplates(false);
    }
  }, [closeMoveModal, folderAccountKey, moveFolderPath, moveTemplateIds]);

  const openRenameModal = useCallback((template: EspTemplateRecord) => {
    setRenameTemplate(template);
    setRenameValue(template.name || '');
  }, []);

  const closeRenameModal = useCallback(() => {
    if (renaming) return;
    setRenameTemplate(null);
    setRenameValue('');
  }, [renaming]);

  const handleRenameTemplate = useCallback(async () => {
    if (!renameTemplate) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error('Template name is required');
      return;
    }

    if (nextName === (renameTemplate.name || '').trim()) {
      closeRenameModal();
      return;
    }

    setRenaming(true);
    try {
      const res = await fetch(`/api/esp/templates/${encodeURIComponent(renameTemplate.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to rename template';
        toast.error(message);
        return;
      }

      setAllTemplates((prev) =>
        prev.map((template) => (
          template.id === renameTemplate.id
            ? { ...template, name: nextName }
            : template
        )),
      );
      setPreviewTemplate((prev) => (
        prev && prev.id === renameTemplate.id
          ? { ...prev, name: nextName }
          : prev
      ));
      toast.success('Template renamed');
      setRenameTemplate(null);
      setRenameValue('');
    } catch {
      toast.error('Failed to rename template');
    } finally {
      setRenaming(false);
    }
  }, [closeRenameModal, renameTemplate, renameValue]);

  const openCloneModal = useCallback((template: EspTemplateRecord) => {
    setCloneTemplate(template);
    setCloneDestination(null);
    setCloneAccountSearch('');
    setCloneAccountKeys(new Set());
  }, []);

  const closeCloneModal = useCallback(() => {
    setCloneTemplate(null);
    setCloneDestination(null);
    setCloneAccountSearch('');
    setCloneAccountKeys(new Set());
    setCloning(false);
  }, []);

  const toggleCloneAccount = useCallback((accountKeyToToggle: string) => {
    setCloneAccountKeys((prev) => {
      const next = new Set(prev);
      if (next.has(accountKeyToToggle)) next.delete(accountKeyToToggle);
      else next.add(accountKeyToToggle);
      return next;
    });
  }, []);

  const cloneTemplateToAccounts = useCallback(async (
    template: EspTemplateRecord,
    targetAccountKeys: string[],
    destination: 'loomi' | 'subaccounts',
  ) => {
    if (targetAccountKeys.length === 0) return;

    setCloning(true);
    try {
      const payloadName = buildCloneName(template.name || 'Untitled Template');
      const results = await Promise.all(
        targetAccountKeys.map(async (targetAccountKey) => {
          try {
            const res = await fetch('/api/esp/templates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountKey: targetAccountKey,
                name: payloadName,
                subject: template.subject || undefined,
                previewText: template.previewText || undefined,
                html: template.html || '',
                source: template.source || null,
                editorType: template.editorType || null,
                syncToRemote: false,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              return {
                ok: false,
                accountKey: targetAccountKey,
                templateId: null,
                error: typeof data?.error === 'string' ? data.error : `Clone failed (${res.status})`,
              };
            }
            const templateId = typeof data?.template?.id === 'string' ? data.template.id : null;
            return { ok: true, accountKey: targetAccountKey, templateId, error: '' };
          } catch {
            return {
              ok: false,
              accountKey: targetAccountKey,
              templateId: null,
              error: 'Network error while cloning',
            };
          }
        }),
      );

      const succeeded = results.filter((result) => result.ok).length;
      const failed = results.length - succeeded;

      if (succeeded > 0 && destination === 'loomi' && foldersEnabled && folderAccountKey && currentFolderId) {
        const clonedTemplateIds = results
          .filter((result) => result.ok && result.accountKey === folderAccountKey && typeof result.templateId === 'string')
          .map((result) => result.templateId as string);

        if (clonedTemplateIds.length > 0) {
          try {
            const assignRes = await fetch('/api/esp/template-folders/assign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountKey: folderAccountKey,
                templateIds: clonedTemplateIds,
                folderId: currentFolderId,
              }),
            });
            const assignData = await assignRes.json().catch(() => ({}));
            if (assignRes.ok) {
              setTemplateFolderAssignments(
                assignData?.assignments && typeof assignData.assignments === 'object'
                  ? assignData.assignments as Record<string, string>
                  : {},
              );
            } else {
              const message = typeof assignData?.error === 'string'
                ? assignData.error
                : 'Failed to place cloned template in current folder';
              toast.warning(message);
            }
          } catch {
            toast.warning('Template cloned, but failed to place it in the current folder');
          }
        }
      }

      if (succeeded > 0 && failed === 0) {
        toast.success(
          destination === 'loomi'
            ? 'Cloned to Loomi'
            : `Cloned to ${succeeded} sub-account${succeeded === 1 ? '' : 's'}`,
        );
      } else if (succeeded > 0) {
        const firstError = results.find((result) => !result.ok)?.error;
        toast.warning(`Cloned ${succeeded}/${results.length}. ${firstError || ''}`.trim());
      } else {
        const firstError = results.find((result) => !result.ok)?.error;
        toast.error(firstError || 'Failed to clone template');
      }

      if (succeeded > 0) {
        await loadTemplates();
      }
    } finally {
      setCloning(false);
    }
  }, [currentFolderId, folderAccountKey, foldersEnabled, loadTemplates]);

  const handleCloneToLoomi = useCallback(async () => {
    if (!cloneTemplate) return;
    await cloneTemplateToAccounts(cloneTemplate, [cloneTemplate.accountKey], 'loomi');
    closeCloneModal();
  }, [cloneTemplate, cloneTemplateToAccounts, closeCloneModal]);

  const handleCloneToSubAccounts = useCallback(async () => {
    if (!cloneTemplate || cloneAccountKeys.size === 0) return;
    await cloneTemplateToAccounts(cloneTemplate, Array.from(cloneAccountKeys), 'subaccounts');
    closeCloneModal();
  }, [cloneTemplate, cloneAccountKeys, cloneTemplateToAccounts, closeCloneModal]);

  const handleCreateConfirm = async () => {
    if (!createMode || !createName.trim()) return;
    const createKey = createAccountKey || (accountFilter !== 'all' ? accountFilter : null) || effectiveAccountKey;
    if (!createKey) return;
    setCreating(true);
    try {
      const starterSource = getStarterTemplate(createMode, createName.trim());
      const res = await fetch('/api/esp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: createKey,
          name: createName.trim(),
          html: '',
          source: starterSource,
          editorType: createMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create template');
        return;
      }
      // Assign to current folder if inside one
      if (currentFolderId && data.template?.id) {
        try {
          await fetch('/api/esp/template-folders/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountKey: createKey,
              templateIds: [data.template.id],
              folderId: currentFolderId,
            }),
          });
          setTemplateFolderAssignments((prev) => ({
            ...prev,
            [data.template.id]: currentFolderId,
          }));
        } catch {
          // Non-blocking — template was created, folder assignment is secondary
          console.warn('[templates] Failed to assign new template to folder');
        }
      }
      setShowCreateChoice(false);
      setLibraryPickerMode(false);
      setCreateAccountKey(null);
      setCreateMode(null);
      setCreateName('');
      const search = new URLSearchParams({ id: data.template.id });
      if (createMode === 'code') {
        search.set('builder', 'html');
      }
      router.push(`/templates/editor?${search.toString()}`);
    } catch {
      toast.error('Failed to create template');
    } finally {
      setCreating(false);
    }
  };

  const selectLibraryTemplate = (slug: string) => {
    const createKey = createAccountKey || (accountFilter !== 'all' ? accountFilter : null) || effectiveAccountKey;
    if (!createKey) return;
    setShowCreateChoice(false);
    setLibraryPickerMode(false);
    setCreateAccountKey(null);
    router.push(`/templates/editor?mode=visual&accountKey=${encodeURIComponent(createKey)}&libraryTemplate=${encodeURIComponent(slug)}`);
  };

  const handleDelete = async (deleteFromRemote: boolean) => {
    if (!deleteTemplate) return;
    const espName = providerLabel(deleteTemplate.provider);
    try {
      const url = `/api/esp/templates/${deleteTemplate.id}${deleteFromRemote ? '?deleteFromRemote=true' : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        if (data.remoteDeleted) {
          toast.success(`Deleted from Loomi and ${espName}`);
        } else if (deleteFromRemote && !data.remoteDeleted) {
          toast.warning(`Removed from Loomi, but could not delete from ${espName}`);
        } else {
          toast.success('Removed from Loomi');
        }
        setDeleteTemplate(null);
        await loadTemplates();
      } else {
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: 'Delete Templates',
      message: `Delete ${selectedIds.size} template${selectedIds.size !== 1 ? 's' : ''}?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    const results = await Promise.all(
      Array.from(selectedIds).map(async (id) => {
        try {
          const res = await fetch(`/api/esp/templates/${id}`, { method: 'DELETE' });
          const data = await res.json().catch(() => ({}));
          return {
            ok: res.ok,
            error:
              typeof data?.error === 'string'
                ? data.error
                : `Delete failed (${res.status})`,
          };
        } catch {
          return { ok: false, error: 'Network error' };
        }
      }),
    );

    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;

    if (failed > 0 && succeeded > 0) {
      const firstError = results.find((result) => !result.ok)?.error;
      toast.warning(`Deleted ${succeeded}, failed ${failed}${firstError ? ` (${firstError})` : ''}`);
    } else if (failed > 0) {
      const firstError = results.find((result) => !result.ok)?.error;
      toast.error(firstError || `Failed to delete ${failed} template${failed !== 1 ? 's' : ''}`);
    } else {
      toast.success(`Deleted ${succeeded} template${succeeded !== 1 ? 's' : ''}`);
    }

    setSelectMode(false);
    setSelectedIds(new Set());
    if (succeeded > 0) {
      await loadTemplates();
    }
  };

  const handleDownloadScreenshot = async (template: EspTemplateRecord) => {
    setDownloadingId(template.id);
    try {
      await downloadTemplateScreenshot(
        template.accountKey,
        template.id,
        template.name || 'template',
      );
      toast.success('Template screenshot downloaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download screenshot';
      toast.error(message);
    } finally {
      setDownloadingId((prev) => (prev === template.id ? null : prev));
    }
  };


  const openAdminAccount = useCallback((nextAccountKey: string) => {
    setAccountFilter(nextAccountKey);
    setSearch('');
    setProviderFilter('all');
    setSelectMode(false);
    setSelectedIds(new Set());
    setCurrentFolderId(null);
    setFolderPath([{ id: null, name: 'Root' }]);
  }, []);

  const backToAllAccounts = useCallback(() => {
    setAccountFilter('all');
    setSearch('');
    setProviderFilter('all');
    setSelectMode(false);
    setSelectedIds(new Set());
    setCurrentFolderId(null);
    setFolderPath([{ id: null, name: 'Root' }]);
  }, []);

  const resetToAccountRoot = useCallback(() => {
    setSearch('');
    setCurrentFolderId(null);
    setFolderPath([{ id: null, name: 'Root' }]);
  }, []);

  const activeFolderName = folderPath.length > 1 ? folderPath[folderPath.length - 1]?.name : null;

  const jumpToFolderCrumb = useCallback((pathIndex: number) => {
    const crumb = folderPath[pathIndex];
    if (!crumb) return;
    setCurrentFolderId(crumb.id);
    setFolderPath(folderPath.slice(0, pathIndex + 1));
  }, [folderPath]);

  // Shared toolbar props
  const toolbarProps = {
    search,
    setSearch,
    isAdmin,
    accountFilter,
    setAccountFilter,
    accountDropdownOpen,
    setAccountDropdownOpen,
    accountDropdownRef,
    accountFilterLabel,
    selectedAccountData: selectedAccountData || null,
    allAccountKeys,
    accounts,
    providerFilter,
    setProviderFilter,
    uniqueProviders,
    viewMode,
    toggleView,
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    filteredCount: filtered.length,
    filteredIds,
    onBulkDelete: handleBulkDelete,
    onBulkMove: foldersEnabled ? () => openMoveTemplatesModal(Array.from(selectedIds)) : undefined,
    foldersEnabled,
  };

  // Shared list view props
  const listViewProps = {
    loading,
    allTemplatesEmpty: allTemplates.length === 0,
    viewMode,
    providerFilter,
    search,
    openMenu,
    selectMode,
    selectedIds,
    canMove: foldersEnabled,
    accounts,
    downloadingId,
    onMenuToggle: (id: string | null) => { if (id !== null) menuClickRef.current = true; setOpenMenu(id); },
    onPreview: setPreviewTemplate,
    onEdit: navigateToEditor,
    onRename: openRenameModal,
    onMove: (template: EspTemplateRecord) => openMoveTemplatesModal([template.id]),
    onClone: openCloneModal,
    onDownloadScreenshot: handleDownloadScreenshot,
    onDelete: setDeleteTemplate,
    onSelect: handleToggleSelect,
  };
  const canCloneToSubAccounts = isAdmin && allAccountKeys.length > 0;
  const inlineFolderGrid = foldersEnabled && !foldersLoading && currentLevelFolders.length > 0 ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-6">
      {currentLevelFolders.map((folder) => (
        <div
          key={folder.id}
          className="glass-card rounded-xl p-5 text-left group hover:ring-1 hover:ring-[var(--primary)]/30 transition-all animate-fade-in-up relative"
        >
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setCurrentFolderId(folder.id)}
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
              <FolderIcon className="w-5 h-5 text-[var(--primary)]" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                className="text-xs font-semibold truncate"
                title={folder.name}
              >
                {folder.name}
              </h3>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {timeAgo(folder.createdAt)}
              </span>
            </div>
          </div>
          <div className="absolute top-2 right-2">
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                menuClickRef.current = true;
                setFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
              }}
              className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${folderMenuId === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {folderMenuId === folder.id && (
              <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
                <button
                  onClick={() => {
                    setFolderMenuId(null);
                    openRenameFolderModal(folder);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                >
                  <PencilIcon className="w-4 h-4" />
                  Rename
                </button>
                <button
                  onClick={() => {
                    setFolderMenuId(null);
                    setDeleteFolderItem(folder);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                >
                  <TrashIcon className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  // ── Render ──

  return (
    <div>
      {/* Header */}
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <EnvelopeIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Templates</h2>
              <div className="flex items-center gap-2 text-sm mt-0.5 flex-wrap">
                {isAdmin ? (
                  showAdminOverview ? (
                    <span className="text-[var(--muted-foreground)]">All Accounts</span>
                  ) : (
                    <>
                      {!effectiveAccountKey && (
                        <>
                          <button
                            onClick={backToAllAccounts}
                            className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                          >
                            All Accounts
                          </button>
                          <span className="text-[var(--muted-foreground)]">{'>'}</span>
                        </>
                      )}
                      {activeFolderName ? (
                        <button
                          onClick={resetToAccountRoot}
                          className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                        >
                          {activeAccountName}
                        </button>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">{activeAccountName}</span>
                      )}
                      {folderPath.slice(1).map((crumb, idx) => {
                        const pathIndex = idx + 1;
                        const isLast = pathIndex === folderPath.length - 1;
                        return (
                          <span
                            key={`${crumb.id || 'root'}-${pathIndex}`}
                            className="inline-flex items-center gap-2"
                          >
                            <span className="text-[var(--muted-foreground)]">{'>'}</span>
                            {isLast ? (
                              <span className="text-[var(--muted-foreground)]">{crumb.name}</span>
                            ) : (
                              <button
                                onClick={() => jumpToFolderCrumb(pathIndex)}
                                className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                              >
                                {crumb.name}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </>
                  )
                ) : effectiveAccountKey ? (
                  <>
                    {activeFolderName ? (
                      <button
                        onClick={resetToAccountRoot}
                        className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                      >
                        {activeAccountName}
                      </button>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">
                        {isAccount && accountData
                          ? `Email templates for ${accountData.dealer}`
                          : 'Manage your email templates'}
                      </span>
                    )}
                    {folderPath.slice(1).map((crumb, idx) => {
                      const pathIndex = idx + 1;
                      const isLast = pathIndex === folderPath.length - 1;
                      return (
                        <span
                          key={`${crumb.id || 'root'}-${pathIndex}`}
                          className="inline-flex items-center gap-2"
                        >
                          <span className="text-[var(--muted-foreground)]">{'>'}</span>
                          {isLast ? (
                            <span className="text-[var(--muted-foreground)]">{crumb.name}</span>
                          ) : (
                            <button
                              onClick={() => jumpToFolderCrumb(pathIndex)}
                              className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </>
                ) : (
                  <span className="text-[var(--muted-foreground)]">
                    Manage your email templates
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {foldersEnabled && (
              <button
                type="button"
                onClick={() => {
                  setNewFolderName('');
                  setShowNewFolderInput(true);
                }}
                className="inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors"
              >
                <FolderPlusIcon className="w-4 h-4" />
                Add Folder
              </button>
            )}
            {(isAdmin || effectiveAccountKey) && (
              <PrimaryButton
                type="button"
                onClick={() => {
                  setCreateAccountKey(folderAccountKey);
                  setShowCreateChoice(true);
                }}
              >
                <PlusIcon className="w-4 h-4" />
                Add Template
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>

      {/* Route-based tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-[var(--border)]">
        <Link
          href={subHref('/templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            pathname.endsWith('/templates')
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          Sub-account Templates
        </Link>
        <Link
          href={subHref('/templates/library')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            pathname.endsWith('/templates/library')
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          Template Library
        </Link>
      </div>


      {/* ── Admin Overview Mode ── */}
      {isAdmin && showAdminOverview && (
        <>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOverviewPage(1); }}
                className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                placeholder="Search sub-accounts..."
              />
            </div>
          </div>

          {overviewSortedKeys.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <MagnifyingGlassIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sub-accounts match &quot;{search.trim()}&quot;</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto glass-table">
                <table className="w-full min-w-[600px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                      <th className="w-12 px-3 py-2"></th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleOverviewSort('name')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Sub-Account Name
                          <span className="text-[10px]">{overviewSortIndicator('name')}</span>
                        </button>
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleOverviewSort('location')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Location
                          <span className="text-[10px]">{overviewSortIndicator('location')}</span>
                        </button>
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleOverviewSort('templates')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Templates
                          <span className="text-[10px]">{overviewSortIndicator('templates')}</span>
                        </button>
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleOverviewSort('integrations')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Integrations
                          <span className="text-[10px]">{overviewSortIndicator('integrations')}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewPagedKeys.map((key) => {
                      const acct = accounts[key];
                      const accountName = acct?.dealer || key;
                      const location = [acct?.city, acct?.state].filter(Boolean).join(', ');
                      const group = accountGroups[key];
                      const templateCount = group?.templates.length || 0;
                      const connected = acct?.connectedProviders || [];
                      const groupedProviders = group ? [...group.providers] : [];
                      const providers = [...new Set([...connected, ...groupedProviders])];

                      return (
                        <tr
                          key={key}
                          onClick={() => openAdminAccount(key)}
                          className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50 transition-colors cursor-pointer"
                        >
                          <td className="px-3 py-2 align-middle">
                            <div className="flex items-center justify-center h-full">
                              <AccountAvatar
                                name={accountName}
                                accountKey={key}
                                storefrontImage={acct?.storefrontImage}
                                logos={acct?.logos}
                                size={36}
                                className="w-9 h-9 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <span className="text-sm font-medium">{accountName}</span>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <span className="text-xs text-[var(--muted-foreground)]">{location || '—'}</span>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <span className="text-xs text-[var(--muted-foreground)]">
                              {templateCount === 0 ? '—' : `${templateCount} template${templateCount === 1 ? '' : 's'}`}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex items-center gap-1.5">
                              {providers.length === 0 ? (
                                <span className="text-xs text-[var(--muted-foreground)]">—</span>
                              ) : (
                                providers.map((provider) => (
                                  <ProviderLogoCircle key={`${key}:${provider}`} provider={provider} size={20} />
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-[var(--muted-foreground)]">
                  Showing {overviewShowingStart}-{overviewShowingEnd} of {overviewSortedKeys.length}
                  {search.trim() && ` matching "${search.trim()}"`}
                </p>
                {overviewTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setOverviewPage(1)} disabled={overviewPage === 1} className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors">First</button>
                    <button type="button" onClick={() => setOverviewPage((p) => Math.max(1, p - 1))} disabled={overviewPage === 1} className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors">Prev</button>
                    {(() => {
                      const maxVisible = 5;
                      const tp = overviewTotalPages;
                      let start = Math.max(1, overviewPage - Math.floor(maxVisible / 2));
                      let end = start + maxVisible - 1;
                      if (end > tp) { end = tp; start = Math.max(1, end - maxVisible + 1); }
                      const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                      return pages.map((p) => (
                        <button key={p} type="button" onClick={() => setOverviewPage(p)} className={`px-2 py-1 text-xs rounded-md border transition-colors ${p === overviewPage ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'border-[var(--border)] hover:bg-[var(--muted)]'}`}>{p}</button>
                      ));
                    })()}
                    <button type="button" onClick={() => setOverviewPage((p) => Math.min(overviewTotalPages, p + 1))} disabled={overviewPage === overviewTotalPages} className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors">Next</button>
                    <button type="button" onClick={() => setOverviewPage(overviewTotalPages)} disabled={overviewPage === overviewTotalPages} className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors">Last</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Admin Account Detail Mode ── */}
      {isAdmin && !showAdminOverview && (
        <>
          <Toolbar showAccountFilter={!effectiveAccountKey} {...toolbarProps} />
          {inlineFolderGrid}
          <TemplateListView templates={filtered} {...listViewProps} />
        </>
      )}

      {/* ── Account Mode ── */}
      {!isAdmin && (
        <>
          {/* No account selected */}
          {!effectiveAccountKey && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <EnvelopeIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an account to view its email templates.</p>
            </div>
          )}

          {/* Account-level template view */}
          {effectiveAccountKey && (
            <>
              <Toolbar {...toolbarProps} />
              {inlineFolderGrid}
              <TemplateListView templates={filtered} {...listViewProps} />
            </>
          )}
        </>
      )}

      {/* ── Create Choice Modal ── */}
      {showCreateChoice && (() => {
        const modalAccountKey = createAccountKey || (accountFilter !== 'all' ? accountFilter : null) || effectiveAccountKey;
        const needsAccountPicker = isAdmin && !modalAccountKey;
        const selectedAccountName = modalAccountKey ? (accounts[modalAccountKey]?.dealer || modalAccountKey) : null;

        // Determine modal title based on current step
        const modalTitle = needsAccountPicker
          ? 'Select Sub-account'
          : libraryPickerMode
            ? 'Select from Library'
            : createMode
              ? 'Name Your Template'
              : 'Add New Template';

        // Show back button when user can go back a step
        const showBack = libraryPickerMode || createMode || (!needsAccountPicker && isAdmin && !effectiveAccountKey);

        const handleBack = () => {
          if (createMode) {
            setCreateMode(null);
            setCreateName('');
          } else if (libraryPickerMode) {
            setLibraryPickerMode(false);
          } else {
            setCreateAccountKey(null);
            setCreateAccountSearch('');
          }
        };

        const handleClose = () => {
          setShowCreateChoice(false);
          setLibraryPickerMode(false);
          setCreateAccountKey(null);
          setCreateAccountSearch('');
          setCreateMode(null);
          setCreateName('');
        };

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={handleClose}>
          <div className={`glass-modal flex flex-col ${libraryPickerMode ? 'w-[960px] max-w-[calc(100vw-3rem)] h-[70vh] max-h-[720px]' : 'w-[640px]'}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
              <div className="flex items-center gap-2">
                {showBack && (
                  <button
                    onClick={handleBack}
                    className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <ArrowLeftIcon className="w-4 h-4" />
                  </button>
                )}
                <h3 className="text-base font-semibold">{modalTitle}</h3>
              </div>
              <button onClick={handleClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            {libraryPickerMode ? (
              <div className="flex-1 min-h-0">
                <LibraryPickerContent onSelect={selectLibraryTemplate} />
              </div>
            ) : (
            <div className="p-5">
              {/* Account picker step for admins */}
              {needsAccountPicker ? (
                <>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">Which sub-account should this template be created for?</p>
                  <div className="relative mb-3">
                    <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <input
                      type="text"
                      value={createAccountSearch}
                      onChange={(e) => setCreateAccountSearch(e.target.value)}
                      placeholder="Search sub-accounts..."
                      className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                    />
                  </div>
                  <div className="max-h-[360px] overflow-y-auto space-y-1">
                    {createFilteredAccountKeys.map(k => {
                      const acct = accounts[k];
                      const location = [acct?.city, acct?.state].filter(Boolean).join(', ');
                      return (
                        <button
                          key={k}
                          onClick={() => setCreateAccountKey(k)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-left"
                        >
                          <AccountAvatar
                            name={acct?.dealer || k}
                            accountKey={k}
                            storefrontImage={acct?.storefrontImage}
                            logos={acct?.logos}
                            size={32}
                            className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-[var(--border)]"
                          />
                          <div className="min-w-0">
                            <span className="block text-sm font-medium truncate">{acct?.dealer || k}</span>
                            {location && (
                              <span className="block text-[11px] text-[var(--muted-foreground)] truncate">{location}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {createFilteredAccountKeys.length === 0 && (
                      <p className="text-xs text-[var(--muted-foreground)] px-1 py-2">No sub-accounts found.</p>
                    )}
                  </div>
                </>
              ) : createMode ? (
                /* ── Name step ── */
                <>
                  {isAdmin && selectedAccountName && (
                    <p className="text-xs text-[var(--muted-foreground)] mb-3">
                      Creating for: <span className="font-medium text-[var(--foreground)]">{selectedAccountName}</span>
                    </p>
                  )}
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">
                    Give your {createMode === 'visual' ? 'Drag & Drop' : 'HTML'} template a name:
                  </p>
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleCreateConfirm(); }}
                    className="space-y-4"
                  >
                    <input
                      type="text"
                      value={createName}
                      onChange={e => setCreateName(e.target.value)}
                      placeholder="e.g. March Newsletter, Welcome Email..."
                      autoFocus
                      className="w-full px-4 py-3 text-sm rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!createName.trim() || creating}
                      className="w-full py-3 text-sm font-medium rounded-xl bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {creating ? 'Creating...' : 'Create Template'}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {isAdmin && selectedAccountName && (
                    <p className="text-xs text-[var(--muted-foreground)] mb-3">
                      Creating for: <span className="font-medium text-[var(--foreground)]">{selectedAccountName}</span>
                    </p>
                  )}
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose how you&apos;d like to build your template:</p>
                  <div className="grid grid-cols-3 gap-3">
                    {/* From Library */}
                    <button
                      onClick={() => setLibraryPickerMode(true)}
                      className="group flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                        <BookOpenIcon className="w-6 h-6 text-[var(--primary)]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">From Library</h4>
                        <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                          Start from a library template
                        </p>
                      </div>
                    </button>

                    {/* Drag & Drop */}
                    <button
                      onClick={() => handleCreateChoice('visual')}
                      className="group flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                        <CursorArrowRaysIcon className="w-6 h-6 text-[var(--primary)]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Drag & Drop</h4>
                        <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                          Visual builder with sections
                        </p>
                      </div>
                    </button>

                    {/* HTML Editor */}
                    <button
                      onClick={() => handleCreateChoice('code')}
                      className="group flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                        <CodeBracketIcon className="w-6 h-6 text-[var(--primary)]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">HTML Editor</h4>
                        <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                          Write or paste raw HTML
                        </p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── New Folder Modal ── */}
      {showNewFolderInput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => {
            if (creatingFolder) return;
            setShowNewFolderInput(false);
            setNewFolderName('');
          }}
        >
          <div className="glass-modal w-[440px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">New Folder</h3>
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                disabled={creatingFolder}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateFolder();
                  }
                  if (e.key === 'Escape' && !creatingFolder) {
                    e.preventDefault();
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }
                }}
                placeholder="Folder name"
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                disabled={creatingFolder}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleCreateFolder(); }}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {creatingFolder ? 'Creating...' : 'Create Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Folder Modal ── */}
      {renameFolderItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={closeRenameFolderModal}>
          <div className="glass-modal w-[440px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Rename Folder</h3>
              <button
                onClick={closeRenameFolderModal}
                disabled={renamingFolder}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <input
                type="text"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRenameFolder();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeRenameFolderModal();
                  }
                }}
                placeholder="Folder name"
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={closeRenameFolderModal}
                disabled={renamingFolder}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleRenameFolder(); }}
                disabled={renamingFolder || !renameFolderValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {renamingFolder ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Folder Modal ── */}
      {deleteFolderItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => !deletingFolder && setDeleteFolderItem(null)}>
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Delete Folder</h3>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-sm text-[var(--foreground)]">
                Delete <strong>{deleteFolderItem.name}</strong> and all subfolders?
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Templates inside deleted folders are moved back to root.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setDeleteFolderItem(null)}
                disabled={deletingFolder}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleDeleteFolder(); }}
                disabled={deletingFolder}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deletingFolder ? 'Deleting...' : 'Delete Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move Templates Modal ── */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={closeMoveModal}>
          <div className="glass-modal w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold">Move to Folder</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {moveTemplateIds.length} item{moveTemplateIds.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <button
                onClick={closeMoveModal}
                disabled={movingTemplates}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-[var(--border)] text-sm">
              {moveFolderPath.map((crumb, idx) => {
                const isLast = idx === moveFolderPath.length - 1;
                return (
                  <span key={`${crumb.id || 'root'}-${idx}`} className="inline-flex items-center gap-1.5">
                    {idx > 0 && <span className="text-[var(--muted-foreground)]">{'>'}</span>}
                    {isLast ? (
                      <span className="text-[var(--foreground)] font-medium inline-flex items-center gap-1">
                        {idx === 0 ? <HomeIcon className="w-3 h-3" /> : <FolderIcon className="w-3 h-3" />}
                        {crumb.name}
                      </span>
                    ) : (
                      <button
                        onClick={() => setMoveFolderPath((prev) => prev.slice(0, idx + 1))}
                        className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors inline-flex items-center gap-1"
                      >
                        {idx === 0 ? <HomeIcon className="w-3 h-3" /> : <FolderIcon className="w-3 h-3" />}
                        {crumb.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-[220px]">
              {moveFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--muted-foreground)]">
                  <FolderIcon className="w-8 h-8 opacity-30 mb-2" />
                  <p className="text-xs">No subfolders here</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {moveFolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setMoveFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }])}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[var(--muted)] transition-colors"
                    >
                      <FolderIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{folder.name}</span>
                      <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] ml-auto flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--muted-foreground)]">
                Move to: <strong>{moveFolderPath[moveFolderPath.length - 1].name}</strong>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeMoveModal}
                  disabled={movingTemplates}
                  className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleMoveTemplates(); }}
                  disabled={movingTemplates}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {movingTemplates ? 'Moving...' : 'Move Here'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renameTemplate && (
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
              <p className="text-xs text-[var(--muted-foreground)]">
                Update the name for <span className="text-[var(--foreground)] font-medium">{renameTemplate.name}</span>.
              </p>
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

      {/* ── Clone Modal ── */}
      {cloneTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={closeCloneModal}>
          <div className="glass-modal w-[680px] max-w-[calc(100vw-2rem)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                {cloneDestination === 'subaccounts' && (
                  <button
                    onClick={() => setCloneDestination(null)}
                    className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    title="Back"
                  >
                    <ArrowLeftIcon className="w-4 h-4" />
                  </button>
                )}
                <h3 className="text-base font-semibold">
                  {cloneDestination === 'subaccounts' ? 'Select Sub-accounts' : 'Clone Template'}
                </h3>
              </div>
              <button onClick={closeCloneModal} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {cloneDestination === 'subaccounts' ? (
              <div className="p-5">
                <p className="text-sm text-[var(--muted-foreground)] mb-3">
                  Select one or more sub-accounts to clone <span className="text-[var(--foreground)] font-medium">{cloneTemplate.name}</span>.
                </p>
                <div className="relative mb-3">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <input
                    type="text"
                    value={cloneAccountSearch}
                    onChange={(e) => setCloneAccountSearch(e.target.value)}
                    placeholder="Search sub-accounts..."
                    className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                  />
                </div>

                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {cloneAccountKeys.size} selected
                  </p>
                  <button
                    onClick={() => {
                      if (cloneFilteredAccountKeys.length === 0) return;
                      const allFilteredSelected = cloneFilteredAccountKeys.every((key) => cloneAccountKeys.has(key));
                      if (allFilteredSelected) {
                        setCloneAccountKeys((prev) => {
                          const next = new Set(prev);
                          cloneFilteredAccountKeys.forEach((key) => next.delete(key));
                          return next;
                        });
                      } else {
                        setCloneAccountKeys((prev) => {
                          const next = new Set(prev);
                          cloneFilteredAccountKeys.forEach((key) => next.add(key));
                          return next;
                        });
                      }
                    }}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    {cloneFilteredAccountKeys.length > 0 && cloneFilteredAccountKeys.every((key) => cloneAccountKeys.has(key))
                      ? 'Deselect Filtered'
                      : 'Select Filtered'}
                  </button>
                </div>

                <div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-0.5">
                  {cloneFilteredAccountKeys.map((k) => {
                    const acct = accounts[k];
                    const location = [acct?.city, acct?.state].filter(Boolean).join(', ');
                    const selected = cloneAccountKeys.has(k);
                    return (
                      <button
                        key={k}
                        onClick={() => toggleCloneAccount(k)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                          selected
                            ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                            : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          selected ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)]'
                        }`}>
                          {selected && <CheckIcon className="w-3 h-3" />}
                        </div>
                        <AccountAvatar
                          name={acct?.dealer || k}
                          accountKey={k}
                          storefrontImage={acct?.storefrontImage}
                          logos={acct?.logos}
                          size={30}
                          className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-[var(--border)]"
                        />
                        <div className="min-w-0">
                          <span className="block text-sm font-medium truncate">{acct?.dealer || k}</span>
                          {location && (
                            <span className="block text-[11px] text-[var(--muted-foreground)] truncate">{location}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {cloneFilteredAccountKeys.length === 0 && (
                    <p className="text-xs text-[var(--muted-foreground)] px-1 py-2">No sub-accounts found.</p>
                  )}
                </div>

                <p className="text-[11px] text-[var(--muted-foreground)] mt-3">
                  Clones are saved as Loomi drafts only. They are not auto-published to ESP.
                </p>

                <div className="flex items-center justify-end gap-2 mt-4">
                  <button
                    onClick={closeCloneModal}
                    className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCloneToSubAccounts}
                    disabled={cloning || cloneAccountKeys.size === 0}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {cloning ? 'Cloning...' : `Clone to ${cloneAccountKeys.size} Sub-account${cloneAccountKeys.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm text-[var(--muted-foreground)] mb-4">
                  Where do you want to clone <span className="text-[var(--foreground)] font-medium">{cloneTemplate.name}</span>?
                </p>
                <div className={`grid gap-3 ${canCloneToSubAccounts ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <button
                    onClick={handleCloneToLoomi}
                    disabled={cloning}
                    className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all text-left disabled:opacity-50"
                  >
                    <h4 className="text-sm font-semibold">Clone to Loomi</h4>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      Create a local draft in the current sub-account only.
                    </p>
                  </button>
                  {canCloneToSubAccounts && (
                    <button
                      onClick={() => setCloneDestination('subaccounts')}
                      className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all text-left"
                    >
                      <h4 className="text-sm font-semibold">Clone to Sub-account(s)</h4>
                      <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                        Choose one or more sub-accounts to receive Loomi draft copies.
                      </p>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTemplate && (() => {
        const linkedToEsp = isPublishedToEsp(deleteTemplate);
        const espName = providerLabel(deleteTemplate.provider);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setDeleteTemplate(null)}>
            <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <h3 className="text-base font-semibold">Delete Template</h3>
              </div>
              <div className="p-5">
                <p className="text-sm text-[var(--foreground)] mb-1">
                  Are you sure you want to delete <strong>{deleteTemplate.name}</strong>?
                </p>
                {isAdmin && (
                  <p className="text-xs text-[var(--muted-foreground)] mt-1">
                    Account: {accounts[deleteTemplate.accountKey]?.dealer || deleteTemplate.accountKey}
                  </p>
                )}
                {linkedToEsp ? (
                  <p className="text-xs text-[var(--muted-foreground)] mt-3">
                    This template exists in {espName}. You can remove it from Loomi only, or also delete it from {espName}.
                  </p>
                ) : (
                  <p className="text-xs text-[var(--muted-foreground)] mt-3">
                    This template is only stored in Loomi and will be permanently removed.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
                <button
                  onClick={() => setDeleteTemplate(null)}
                  className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  Cancel
                </button>
                {linkedToEsp ? (
                  <>
                    <button
                      onClick={() => handleDelete(false)}
                      className="px-4 py-2 text-sm font-medium text-red-400 border border-red-400/30 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      Remove from Loomi
                    </button>
                    <button
                      onClick={() => handleDelete(true)}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      Delete from {espName} too
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleDelete(false)}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Preview Modal ── */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setPreviewTemplate(null)}>
          <div className="glass-modal w-[720px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-semibold truncate">{previewTemplate.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {isAdmin ? (
                    <AccountIdentity
                      acctKey={previewTemplate.accountKey}
                      accounts={accounts}
                      provider={previewTemplate.provider}
                      showProvider={isPublishedToEsp(previewTemplate)}
                      providerLogoSize={20}
                    />
                  ) : (
                    <ProviderLogoCircle provider={previewTemplate.provider} size={20} />
                  )}
                  {previewTemplate.subject && (
                    <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                      Subject: {previewTemplate.subject}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => openHtmlInNewTab(previewTemplateHtml, previewTemplate.name)}
                  disabled={!hasPreviewTemplateHtml}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Preview in New Tab
                </button>
                <button
                  onClick={() => { setPreviewTemplate(null); navigateToEditor(previewTemplate); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--primary)] border border-[var(--primary)]/30 rounded-lg hover:bg-[var(--primary)]/5 transition-colors"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => setPreviewTemplate(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-[var(--muted)]">
              {hasPreviewTemplateHtml ? (
                <iframe
                  srcDoc={previewTemplateHtml}
                  className="w-full h-full border-0"
                  style={{ minHeight: '500px' }}
                  title={`Preview: ${previewTemplate.name}`}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-[var(--muted-foreground)]">
                  <div className="text-center">
                    <EnvelopeIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No preview available</p>
                    <p className="text-xs mt-1">Open the template in the editor to generate a preview.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
