'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  MagnifyingGlassIcon,
  ArrowTopRightOnSquareIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  EllipsisHorizontalIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  PauseCircleIcon,
  XCircleIcon,
  EnvelopeIcon,
  CheckIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  ArchiveBoxIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar as SharedAccountAvatar } from '@/components/account-avatar';
import BulkActionDock from '@/components/bulk-action-dock';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';

// ── Types ──

interface Campaign {
  id: string;
  campaignId?: string;
  scheduleId?: string;
  name: string;
  status: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  sentAt?: string;
  sentCount?: number;
  locationId?: string;
  accountKey?: string;
  dealer?: string;
  bulkRequestId?: string;
  parentId?: string;
  /**
   * Channel for the row: 'email' (any HTML-based campaign), 'sms' (text-only),
   * or 'multi' (linked email + SMS pair). Loomi-list sets this; ESP-fetched
   * rows are always 'email'. The Campaigns table renders a badge from it.
   */
  channel?: 'email' | 'sms' | 'multi';
}

export interface AccountMeta {
  dealer: string;
  category?: string;
  oem?: string;
  oems?: string[];
  state?: string;
  city?: string;
  locationId?: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
  accountRepId?: string | null;
  accountRepName?: string | null;
  accountRepEmail?: string | null;
}

interface CampaignPageListProps {
  campaigns: Campaign[];
  loading?: boolean;
  accountNames?: Record<string, string>;
  accountMeta?: Record<string, AccountMeta>;
  accountProviders?: Record<string, string>;
  emptyState?: {
    title: string;
    subtitle?: string;
    actionLabel?: string;
    actionHref?: string;
  } | null;
  /**
   * Extra controls rendered to the right of the search input. The page
   * uses this to slot the date-range dropdown and Filters button next
   * to the search bar instead of cluttering the header.
   */
  toolbarExtras?: React.ReactNode;
  /**
   * When set, skip the accounts-overview drill-in table entirely and
   * render the flat campaign list straight away. Used by the sub-account
   * view where the accounts table doesn't add value — the user is
   * already scoped to one account.
   */
  singleAccountMode?: boolean;
}

function getCampaignKey(campaign: Campaign): string {
  return [
    campaign.accountKey || 'no-account',
    campaign.scheduleId || campaign.id || 'no-id',
    campaign.campaignId || 'no-campaign',
    campaign.createdAt || campaign.updatedAt || 'no-date',
  ].join('|');
}

function campaignAccountKey(campaign: Campaign): string | null {
  return campaign.accountKey || null;
}

// ── Helpers ──

const STATUS_BADGE: Record<string, string> = {
  sent:       'bg-green-500/10 text-green-400',
  scheduled:  'bg-blue-500/10 text-blue-400',
  draft:      'bg-zinc-500/10 text-zinc-400',
  paused:     'bg-orange-500/10 text-orange-400',
  cancelled:  'bg-red-500/10 text-red-400',
};

const STATUS_ICON: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  sent:       CheckCircleIcon,
  scheduled:  ClockIcon,
  draft:      DocumentTextIcon,
  paused:     PauseCircleIcon,
  cancelled:  XCircleIcon,
};

const PAGE_SIZE = 10;

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('complete') || s.includes('deliver') || s.includes('finish') || s.includes('sent')) return 'sent';
  if (s.includes('active') || s.includes('sched') || s.includes('queue') || s.includes('start') || s.includes('running') || s.includes('progress')) return 'scheduled';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause')) return 'paused';
  if (s.includes('stop') || s.includes('cancel') || s.includes('inactive')) return 'cancelled';
  return s;
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE[normalizeStatus(status)] || 'bg-zinc-500/10 text-zinc-400';
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'draft') return 'In Progress';
  const withSpaces = normalized.replace(/_/g, ' ');
  return withSpaces.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDateTimeParts(dateStr?: string): { date: string; time: string } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return {
    date: `${month} ${day}, ${year}`,
    time,
  };
}

function getTimestamp(dateStr?: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function getScheduledTs(campaign: Campaign): number {
  return getTimestamp(campaign.scheduledAt);
}

function getLastUpdatedTs(campaign: Campaign): number {
  return getTimestamp(campaign.updatedAt || campaign.createdAt);
}

function getScheduledDateParts(campaign: Campaign): { date: string; time: string } | null {
  return getDateTimeParts(campaign.scheduledAt);
}

function getLastUpdatedDateParts(campaign: Campaign): { date: string; time: string } | null {
  return getDateTimeParts(campaign.updatedAt || campaign.createdAt);
}

function formatShortDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Sort ──

type CampaignSortField = 'status' | 'scheduled' | 'updated';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = {
  sent: 0, scheduled: 1, draft: 2, paused: 3, cancelled: 4,
};

function compareCampaigns(a: Campaign, b: Campaign, field: CampaignSortField, dir: SortDir): number {
  let cmp = 0;
  if (field === 'status') {
    const aOrder = STATUS_ORDER[normalizeStatus(a.status)] ?? 99;
    const bOrder = STATUS_ORDER[normalizeStatus(b.status)] ?? 99;
    cmp = aOrder - bOrder;
  } else if (field === 'scheduled') {
    cmp = getScheduledTs(a) - getScheduledTs(b);
  } else if (field === 'updated') {
    cmp = getLastUpdatedTs(a) - getLastUpdatedTs(b);
  } else {
    cmp = getLastUpdatedTs(a) - getLastUpdatedTs(b);
  }
  return dir === 'desc' ? -cmp : cmp;
}

// ── Account table sort ──

type AccountSortField = 'dealer' | 'campaigns' | 'sent' | 'lastActivity';

interface AccountRow {
  key: string;
  label: string;
  campaigns: Campaign[];
  sentCount: number;
  scheduledCount: number;
  lastActivityTs: number;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
}

function compareAccountRows(a: AccountRow, b: AccountRow, field: AccountSortField, dir: SortDir): number {
  let cmp = 0;
  if (field === 'dealer') {
    cmp = a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  } else if (field === 'campaigns') {
    cmp = a.campaigns.length - b.campaigns.length;
  } else if (field === 'sent') {
    cmp = a.sentCount - b.sentCount;
  } else if (field === 'lastActivity') {
    cmp = a.lastActivityTs - b.lastActivityTs;
  }
  if (cmp === 0) cmp = a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  return dir === 'desc' ? -cmp : cmp;
}

// ── Download helpers ──

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed.replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'campaign-email';
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

// ── Pagination helper ──

function getVisiblePages(currentPage: number, totalPages: number, maxVisible = 5): number[] {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const halfWindow = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage - halfWindow);
  let end = start + maxVisible - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - maxVisible + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

// ── Loomi edit URL ──

/**
 * Resolve the in-app edit URL for a Loomi-native campaign. Returns null
 * for ESP-imported rows (they're edited externally) and for sent
 * campaigns (no in-app re-editing once it's gone out).
 */
function getLoomiEditUrl(c: Campaign): string | null {
  const provider = (c.provider || '').toLowerCase();
  if (provider !== 'loomi-email' && provider !== 'loomi-sms') return null;
  const status = c.status?.toLowerCase() || '';
  const isTerminal =
    status === 'completed' ||
    status === 'partial' ||
    status === 'failed' ||
    status === 'sent' ||
    status === 'canceled';
  if (isTerminal) return null;
  const id = encodeURIComponent(c.campaignId || c.id);
  const channel = c.channel;
  if (channel === 'multi') return `/messaging/campaigns/multi/${id}/recipients`;
  if (channel === 'sms' || provider === 'loomi-sms') return `/messaging/campaigns/sms/${id}/recipients`;
  return `/messaging/campaigns/${id}/recipients`;
}

// ── Channel inference + badge ──

/**
 * Returns the channel for a campaign row. Loomi-list endpoints stamp `channel`
 * explicitly; ESP-fetched campaigns fall through to 'email' since the ESP
 * integration we currently support is email-only.
 */
function getCampaignChannel(c: Campaign): 'email' | 'sms' | 'multi' {
  if (c.channel) return c.channel;
  const provider = (c.provider || '').toLowerCase();
  if (provider === 'loomi-sms') return 'sms';
  return 'email';
}

function ChannelBadge({ channel }: { channel: 'email' | 'sms' | 'multi' }) {
  if (channel === 'sms') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400">
        <ChatBubbleLeftRightIcon className="w-3 h-3" />
        SMS
      </span>
    );
  }
  if (channel === 'multi') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400">
        <EnvelopeIcon className="w-3 h-3" />
        <ChatBubbleLeftRightIcon className="w-3 h-3 -ml-0.5" />
        Email + SMS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/10 text-sky-400">
      <EnvelopeIcon className="w-3 h-3" />
      Email
    </span>
  );
}

// ── Sortable Column Header ──

function SortHeader<F extends string>({
  label,
  field,
  activeField,
  activeDir,
  onToggle,
  className,
}: {
  label: string;
  field: F;
  activeField: F | null;
  activeDir: SortDir;
  onToggle: (f: F) => void;
  className?: string;
}) {
  const isActive = activeField === field;
  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      className={`inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors ${
        isActive ? 'text-[var(--foreground)]' : ''
      } ${className || ''}`}
    >
      {label}
      {isActive ? (
        activeDir === 'desc'
          ? <ChevronDownIcon className="w-2.5 h-2.5" />
          : <ChevronUpIcon className="w-2.5 h-2.5" />
      ) : (
        <ChevronUpDownIcon className="w-2.5 h-2.5 opacity-60" />
      )}
    </button>
  );
}

// ── Campaign Row (table row) ──

function CampaignTableRow({
  item,
  accountMeta: _accountMeta,
  accountProviders: _accountProviders,
  isMenuOpen,
  downloading,
  selectMode,
  selected,
  onToggleMenu,
  onPreview,
  onDownload,
  onToggleSelect,
  onEdit,
  onArchive,
  onDelete,
}: {
  item: Campaign;
  // accountMeta + accountProviders were only used for ESP deep links.
  // Accepted (unused) to keep the prop surface stable until callers
  // are swept.
  accountMeta?: Record<string, AccountMeta>;
  accountProviders?: Record<string, string>;
  isMenuOpen: boolean;
  downloading: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleMenu: (item: Campaign) => void;
  onPreview: (item: Campaign) => void;
  onDownload: (item: Campaign) => void;
  onToggleSelect: (item: Campaign) => void;
  onEdit: (item: Campaign) => void;
  onArchive: (item: Campaign) => void;
  onDelete: (item: Campaign) => void;
}) {
  void _accountMeta;
  void _accountProviders;
  const loomiEditUrl = getLoomiEditUrl(item);
  const normalizedStatus = normalizeStatus(item.status);
  const scheduledParts = getScheduledDateParts(item);
  const updatedParts = getLastUpdatedDateParts(item);
  const StatusIcon = STATUS_ICON[normalizedStatus];
  const isLoomi = (item.provider || '').toLowerCase().startsWith('loomi-');
  const canPreview = isLoomi;
  // Archive/Delete only operate on Loomi-native rows. In-flight statuses
  // are blocked server-side too — we mirror that here so the button
  // doesn't dangle uselessly.
  const canMutate = isLoomi && normalizedStatus !== 'scheduled' && item.status !== 'queued' && item.status !== 'processing';
  const rowClickable = !selectMode && Boolean(loomiEditUrl);

  function handleRowClick() {
    if (selectMode) {
      onToggleSelect(item);
      return;
    }
    if (loomiEditUrl) onEdit(item);
  }

  return (
    <tr
      onClick={rowClickable || selectMode ? handleRowClick : undefined}
      className={`border-b border-[var(--border)] last:border-b-0 transition-colors ${
        rowClickable || selectMode ? 'cursor-pointer' : ''
      } ${selected ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/50'}`}
    >
      {selectMode && (
        <td className="w-10 px-3 py-2.5 align-middle">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(item)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border border-[var(--border)] bg-transparent accent-[var(--primary)] cursor-pointer"
            aria-label="Select campaign"
          />
        </td>
      )}
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <EnvelopeIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
          <span className="text-sm font-medium truncate">{item.name || '(Untitled)'}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <ChannelBadge channel={getCampaignChannel(item)} />
      </td>
      <td className="px-3 py-2.5 align-middle">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(item.status)}`}>
          {StatusIcon && <StatusIcon className="w-3 h-3" />}
          {statusLabel(item.status)}
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle text-right tabular-nums leading-tight">
        {scheduledParts ? (
          <>
            <span className="block text-xs text-[var(--muted-foreground)]">{scheduledParts.date}</span>
            <span className="block text-[10px] text-[var(--muted-foreground)]">{scheduledParts.time}</span>
          </>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle text-right tabular-nums leading-tight">
        {updatedParts ? (
          <>
            <span className="block text-xs text-[var(--muted-foreground)]">{updatedParts.date}</span>
            <span className="block text-[10px] text-[var(--muted-foreground)]">{updatedParts.time}</span>
          </>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
              type="button"
              onClick={() => onToggleMenu(item)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
              aria-label="More actions"
            >
              <EllipsisHorizontalIcon className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown shadow-lg p-1.5">
                {loomiEditUrl ? (
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    Edit
                    <PencilSquareIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--muted-foreground)] opacity-50 cursor-not-allowed"
                  >
                    Edit
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onPreview(item)}
                  disabled={!canPreview}
                  className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Preview Email
                  <EyeIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                </button>

                <button
                  type="button"
                  onClick={() => onDownload(item)}
                  disabled={!canPreview || downloading}
                  className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloading ? 'Downloading...' : 'Download Email'}
                  <ArrowDownTrayIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                </button>

                {isLoomi && <div className="my-1 border-t border-[var(--border)] " />}

                {isLoomi && (
                  <button
                    type="button"
                    onClick={() => onArchive(item)}
                    disabled={!canMutate}
                    className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Archive
                    <ArchiveBoxIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  </button>
                )}

                {isLoomi && (
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    disabled={!canMutate}
                    className="w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Pagination UI ──

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  itemLabel = 'items',
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  itemLabel?: string;
}) {
  if (totalPages <= 1) return null;
  const showingStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingEnd = Math.min(page * pageSize, totalItems);
  const visiblePages = getVisiblePages(page, totalPages);

  return (
    <div className="flex items-center justify-between mt-3">
      <p className="text-xs text-[var(--muted-foreground)]">
        Showing {showingStart}-{showingEnd} of {totalItems} {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
        >
          First
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
        >
          Prev
        </button>
        {visiblePages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
            className={`px-2 py-1 text-xs rounded-md border transition-colors ${
              pageNumber === page
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'border-[var(--border)] hover:bg-[var(--muted)]'
            }`}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
        >
          Last
        </button>
      </div>
    </div>
  );
}

// ── Component ──

export function CampaignPageList({
  campaigns,
  loading,
  accountNames,
  accountMeta,
  accountProviders,
  emptyState,
  toolbarExtras,
  singleAccountMode = false,
}: CampaignPageListProps) {
  const { alert, confirm } = useLoomiDialog();
  const router = useRouter();

  // Search
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Drill-down state: null = accounts table, string = that account's campaigns.
  // In singleAccountMode the accounts table is skipped — the caller's
  // campaigns prop is already scoped to one account, so we treat the
  // synthetic key '__single__' as "permanently drilled in".
  const [selectedAccount, setSelectedAccount] = useState<string | null>(
    singleAccountMode ? '__single__' : null,
  );

  // Account table state
  const [accountPage, setAccountPage] = useState(1);
  const [accountSortField, setAccountSortField] = useState<AccountSortField>('lastActivity');
  const [accountSortDir, setAccountSortDir] = useState<SortDir>('desc');

  // Campaign table state
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignSortField, setCampaignSortField] = useState<CampaignSortField | null>(null);
  const [campaignSortDir, setCampaignSortDir] = useState<SortDir>('desc');

  // Menu/preview/download state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Bulk selection state (drill-down view only)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Reset pagination on search change
  useEffect(() => {
    setAccountPage(1);
    setCampaignPage(1);
  }, [debouncedSearch, campaigns.length]);

  // When drilling into an account, reset campaign table state
  function drillInto(accountKey: string) {
    setSelectedAccount(accountKey);
    setCampaignPage(1);
    setCampaignSortField(null);
    setCampaignSortDir('desc');
    setSearch('');
    setOpenMenuId(null);
    setSelectMode(false);
    setSelectedKeys(new Set());
  }

  function drillOut() {
    setSelectedAccount(null);
    setSearch('');
    setOpenMenuId(null);
    setSelectMode(false);
    setSelectedKeys(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedKeys(new Set());
  }

  // ── Build account rows ──
  // Orphan campaigns (created at admin level with no accountKey) bucket
  // under a friendly "Unassigned" label so the drill-in row is readable
  // instead of showing a `_unknown` sentinel. They're still drill-inable
  // so the user can resume them.
  const UNASSIGNED_KEY = '__unassigned__';
  const accountRows: AccountRow[] = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    campaigns.forEach((c) => {
      const key = campaignAccountKey(c) || c.dealer || UNASSIGNED_KEY;
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    });

    return [...map.entries()].map(([key, items]) => {
      const sentCount = items.filter(c => normalizeStatus(c.status) === 'sent').length;
      const scheduledCount = items.filter(c => normalizeStatus(c.status) === 'scheduled').length;
      const lastActivityTs = Math.max(...items.map(c => getLastUpdatedTs(c)), 0);
      const meta = accountMeta?.[key];
      const fallbackLabel = key === UNASSIGNED_KEY ? 'Unassigned' : key;
      return {
        key,
        label: accountNames?.[key] || items[0]?.dealer || fallbackLabel,
        campaigns: items,
        sentCount,
        scheduledCount,
        lastActivityTs,
        storefrontImage: meta?.storefrontImage,
        logos: meta?.logos,
      };
    });
  }, [campaigns, accountNames, accountMeta]);

  // ── Accounts table: filter + sort + paginate ──
  const filteredAccountRows = useMemo(() => {
    if (!debouncedSearch) return accountRows;
    const q = debouncedSearch.toLowerCase();
    return accountRows.filter(r => r.label.toLowerCase().includes(q));
  }, [accountRows, debouncedSearch]);

  const sortedAccountRows = useMemo(() => {
    return [...filteredAccountRows].sort((a, b) =>
      compareAccountRows(a, b, accountSortField, accountSortDir),
    );
  }, [filteredAccountRows, accountSortField, accountSortDir]);

  const accountTotalPages = Math.max(1, Math.ceil(sortedAccountRows.length / PAGE_SIZE));

  useEffect(() => {
    if (accountPage > accountTotalPages) setAccountPage(accountTotalPages);
  }, [accountPage, accountTotalPages]);

  const pagedAccountRows = useMemo(() => {
    const start = (accountPage - 1) * PAGE_SIZE;
    return sortedAccountRows.slice(start, start + PAGE_SIZE);
  }, [sortedAccountRows, accountPage]);

  function toggleAccountSort(field: AccountSortField) {
    if (accountSortField === field) {
      setAccountSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setAccountSortField(field);
      setAccountSortDir('asc');
    }
    setAccountPage(1);
  }

  const accountSortIndicator = (field: AccountSortField) => {
    if (accountSortField !== field) return '↕';
    return accountSortDir === 'asc' ? '↑' : '↓';
  };

  // ── Campaign table (drill-down): filter + sort + paginate ──
  const selectedAccountRow = useMemo(
    () => accountRows.find(r => r.key === selectedAccount) || null,
    [accountRows, selectedAccount],
  );

  const selectedCampaigns = useMemo(() => {
    // In singleAccountMode the caller already scoped `campaigns` to one
    // account, so we work over the whole list directly.
    let result = singleAccountMode
      ? campaigns
      : (selectedAccountRow ? selectedAccountRow.campaigns : []);
    if (!singleAccountMode && !selectedAccountRow) return [];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q) ||
        statusLabel(c.status).toLowerCase().includes(q),
      );
    }
    if (campaignSortField) {
      result = [...result].sort((a, b) => compareCampaigns(a, b, campaignSortField, campaignSortDir));
    }
    return result;
  }, [singleAccountMode, campaigns, selectedAccountRow, debouncedSearch, campaignSortField, campaignSortDir]);

  const campaignTotalPages = Math.max(1, Math.ceil(selectedCampaigns.length / PAGE_SIZE));

  useEffect(() => {
    if (campaignPage > campaignTotalPages) setCampaignPage(campaignTotalPages);
  }, [campaignPage, campaignTotalPages]);

  const pagedCampaigns = useMemo(() => {
    const start = (campaignPage - 1) * PAGE_SIZE;
    return selectedCampaigns.slice(start, start + PAGE_SIZE);
  }, [selectedCampaigns, campaignPage]);

  function toggleCampaignSort(field: CampaignSortField) {
    if (campaignSortField === field) {
      if (campaignSortDir === 'desc') setCampaignSortDir('asc');
      else { setCampaignSortField(null); setCampaignSortDir('desc'); }
    } else {
      setCampaignSortField(field);
      setCampaignSortDir('desc');
    }
  }

  // ── Preview / Download ──

  // ESP-backed preview is gone. Loomi-native campaigns can wire a new
  // preview endpoint in a follow-up — for now the action surfaces a
  // friendly "unavailable" state in the preview modal.
  async function handlePreview(campaign: Campaign) {
    setOpenMenuId(null);
    setPreviewCampaign(campaign);
    setPreviewHtml('');
    setPreviewUrl('');
    setPreviewLoading(false);
    setPreviewError('Preview is not available yet for this campaign.');
  }

  async function handleDownload(campaign: Campaign) {
    const key = getCampaignKey(campaign);
    setOpenMenuId(null);
    setDownloadingId(key);
    try {
      await downloadCampaignScreenshot(campaign);
    } catch (err) {
      console.error('PNG download failed:', err instanceof Error ? err.message : err);
      await alert({
        title: 'Download Failed',
        message: 'Failed to download campaign email. Please try again.',
      });
    } finally {
      setDownloadingId(null);
    }
  }

  // ── Bulk selection helpers ──

  function toggleSelectCampaign(campaign: Campaign) {
    const key = getCampaignKey(campaign);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedKeys((prev) => {
      const pageKeys = pagedCampaigns.map((c) => getCampaignKey(c));
      const allSelected = pageKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allSelected) {
        for (const k of pageKeys) next.delete(k);
      } else {
        for (const k of pageKeys) next.add(k);
      }
      return next;
    });
  }

  function getSelectedCampaigns(): Campaign[] {
    return selectedCampaigns.filter((c) => selectedKeys.has(getCampaignKey(c)));
  }

  function isLoomiCampaign(c: Campaign): boolean {
    const p = (c.provider || '').toLowerCase();
    return p === 'loomi-email' || p === 'loomi-sms';
  }

  function isLoomiEmail(c: Campaign): boolean {
    return (c.provider || '').toLowerCase() === 'loomi-email';
  }

  async function downloadCampaignScreenshot(campaign: Campaign): Promise<void> {
    const fileBase = campaign.name || 'campaign-email';
    // Only Loomi-native email campaigns support in-app screenshots now —
    // ESP-fetched rows have nowhere to point.
    if (!isLoomiEmail(campaign)) {
      throw new Error('Download is unavailable for this campaign.');
    }
    const campaignId = campaign.campaignId || campaign.id;
    if (!campaignId) throw new Error('Download is unavailable for this campaign.');
    const res = await fetch(
      `/api/campaigns/loomi/screenshot?campaignId=${encodeURIComponent(campaignId)}`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        typeof data.error === 'string' ? data.error : `Screenshot failed (${res.status})`,
      );
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error('Screenshot returned empty data');
    downloadBlob(blob, `${sanitizeFileName(fileBase)}.png`);
  }

  async function handleBulkDownload() {
    const targets = getSelectedCampaigns();
    if (targets.length === 0) return;
    setBulkBusy(true);
    const failed: string[] = [];
    try {
      for (const c of targets) {
        try {
          await downloadCampaignScreenshot(c);
        } catch (err) {
          console.error('Bulk download failed for', c.name, err);
          failed.push(c.name || '(Untitled)');
        }
      }
    } finally {
      setBulkBusy(false);
    }
    if (failed.length > 0) {
      await alert({
        title: 'Some downloads failed',
        message: `${failed.length} campaign${failed.length === 1 ? '' : 's'} could not be exported. The first failure was: ${failed[0]}`,
      });
    }
  }

  async function handleBulkCopy() {
    const targets = getSelectedCampaigns().filter(isLoomiCampaign);
    const skipped = selectedKeys.size - targets.length;
    if (targets.length === 0) {
      await alert({
        title: 'Copy not supported',
        message: 'Only Loomi-created campaigns can be duplicated. ESP-imported rows are read-only here.',
      });
      return;
    }
    setBulkBusy(true);
    const failed: string[] = [];
    try {
      for (const c of targets) {
        const id = c.campaignId || c.id;
        const path = isLoomiEmail(c) ? 'email' : 'sms';
        try {
          const res = await fetch(`/api/campaigns/${path}/${encodeURIComponent(id)}/duplicate`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.error('Bulk copy failed for', c.name, err);
          failed.push(c.name || '(Untitled)');
        }
      }
    } finally {
      setBulkBusy(false);
    }
    exitSelectMode();
    if (failed.length > 0 || skipped > 0) {
      await alert({
        title: 'Copy summary',
        message: [
          `${targets.length - failed.length} campaign${targets.length - failed.length === 1 ? '' : 's'} duplicated.`,
          failed.length > 0 ? `${failed.length} failed.` : '',
          skipped > 0 ? `${skipped} ESP row${skipped === 1 ? '' : 's'} skipped (not duplicable here).` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    // Refresh the page so the new drafts appear. The parent owns the
    // campaigns array, so a soft reload is the simplest sync.
    if (typeof window !== 'undefined') window.location.reload();
  }

  // ── Single-row handlers (Edit / Archive / Delete from the row's
  //    overflow menu or row click). They mirror the bulk equivalents
  //    but operate on one campaign. ──

  function handleEditCampaign(campaign: Campaign) {
    setOpenMenuId(null);
    const url = getLoomiEditUrl(campaign);
    if (url) router.push(url);
  }

  async function handleArchiveCampaign(campaign: Campaign) {
    setOpenMenuId(null);
    if (!isLoomiCampaign(campaign)) return;
    const id = campaign.campaignId || campaign.id;
    const path = isLoomiEmail(campaign) ? 'email' : 'sms';
    try {
      const res = await fetch(`/api/campaigns/${path}/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
    } catch (err) {
      await alert({
        title: 'Archive failed',
        message: err instanceof Error ? err.message : 'Failed to archive campaign.',
      });
      return;
    }
    if (typeof window !== 'undefined') window.location.reload();
  }

  async function handleDeleteCampaign(campaign: Campaign) {
    setOpenMenuId(null);
    if (!isLoomiCampaign(campaign)) return;
    const confirmed = await confirm({
      title: 'Delete this campaign?',
      message: `This will permanently delete "${campaign.name || '(Untitled)'}" and any draft recipient data. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const id = campaign.campaignId || campaign.id;
    const path = isLoomiEmail(campaign) ? 'email' : 'sms';
    try {
      const res = await fetch(`/api/campaigns/${path}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
    } catch (err) {
      await alert({
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Failed to delete campaign.',
      });
      return;
    }
    if (typeof window !== 'undefined') window.location.reload();
  }

  async function handleBulkDelete() {
    const targets = getSelectedCampaigns().filter(isLoomiCampaign);
    const skipped = selectedKeys.size - targets.length;
    if (targets.length === 0) {
      await alert({
        title: 'Delete not supported',
        message: 'Only Loomi-created campaigns can be deleted from here. ESP-imported rows must be managed in their provider.',
      });
      return;
    }
    const confirmed = await confirm({
      title: 'Delete selected campaigns?',
      message: `This will permanently delete ${targets.length} campaign${targets.length === 1 ? '' : 's'} and any draft recipient data. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    setBulkBusy(true);
    const failed: string[] = [];
    try {
      for (const c of targets) {
        const id = c.campaignId || c.id;
        const path = isLoomiEmail(c) ? 'email' : 'sms';
        try {
          const res = await fetch(`/api/campaigns/${path}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.error('Bulk delete failed for', c.name, err);
          failed.push(c.name || '(Untitled)');
        }
      }
    } finally {
      setBulkBusy(false);
    }
    exitSelectMode();
    if (failed.length > 0 || skipped > 0) {
      await alert({
        title: 'Delete summary',
        message: [
          `${targets.length - failed.length} campaign${targets.length - failed.length === 1 ? '' : 's'} deleted.`,
          failed.length > 0 ? `${failed.length} failed.` : '',
          skipped > 0 ? `${skipped} ESP row${skipped === 1 ? '' : 's'} skipped (managed by provider).` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    if (typeof window !== 'undefined') window.location.reload();
  }

  // ── Loading skeleton ──

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-6 animate-pulse">
        <div className="w-40 h-5 bg-[var(--muted)] rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-48 h-4 bg-[var(--muted)] rounded" />
              <div className="w-20 h-4 bg-[var(--muted)] rounded" />
              <div className="flex-1" />
              <div className="w-16 h-4 bg-[var(--muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ──

  return (
    <>
      <div className="animate-fade-in-up animate-stagger-3">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {selectedAccount && !singleAccountMode && (
              <button
                type="button"
                onClick={drillOut}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                All Accounts
              </button>
            )}
            <p className="text-sm text-[var(--muted-foreground)]">
              {singleAccountMode ? (
                <>
                  {selectedCampaigns.length} campaign{selectedCampaigns.length !== 1 ? 's' : ''}
                  {debouncedSearch ? ' found' : ''}
                </>
              ) : selectedAccount ? (
                <>
                  <span className="text-[var(--foreground)] font-medium">{selectedAccountRow?.label}</span>
                  {' · '}
                  {selectedCampaigns.length} campaign{selectedCampaigns.length !== 1 ? 's' : ''}
                  {debouncedSearch ? ' found' : ''}
                </>
              ) : (
                <>
                  {sortedAccountRows.length} account{sortedAccountRows.length !== 1 ? 's' : ''}
                  {debouncedSearch ? ' found' : ''}
                  {' · '}
                  {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  if (selectedAccount) setCampaignPage(1);
                  else setAccountPage(1);
                }}
                placeholder={selectedAccount ? 'Search campaigns...' : 'Search sub-accounts...'}
                className="w-52 pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            {selectedAccount && (
              <button
                type="button"
                onClick={() => {
                  if (selectMode) exitSelectMode();
                  else setSelectMode(true);
                }}
                className={`inline-flex items-center gap-1.5 h-[30px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                  selectMode
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                <CheckIcon className="w-3.5 h-3.5" />
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            {toolbarExtras}
          </div>
        </div>

        {/* ── Accounts Table (Level 1) ── */}
        {!selectedAccount && (
          <>
            {sortedAccountRows.length === 0 ? (
              <div className="text-center py-16 text-[var(--muted-foreground)]">
                <p className="text-sm">
                  {debouncedSearch
                    ? 'No sub-accounts match your search.'
                    : (emptyState?.title || 'No campaigns found')}
                </p>
                {!debouncedSearch && emptyState?.subtitle && (
                  <p className="text-xs mt-1">{emptyState.subtitle}</p>
                )}
                {!debouncedSearch && emptyState?.actionHref && emptyState?.actionLabel && (
                  <a
                    href={emptyState.actionHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition-colors"
                  >
                    {emptyState.actionLabel}
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto glass-table">
                <table className="w-full min-w-[600px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                      <th className="w-12 px-3 py-2"></th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleAccountSort('dealer')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Sub-Account
                          <span className="text-[10px]">{accountSortIndicator('dealer')}</span>
                        </button>
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleAccountSort('campaigns')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Campaigns
                          <span className="text-[10px]">{accountSortIndicator('campaigns')}</span>
                        </button>
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleAccountSort('sent')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Sent
                          <span className="text-[10px]">{accountSortIndicator('sent')}</span>
                        </button>
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Scheduled
                      </th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <button type="button" onClick={() => toggleAccountSort('lastActivity')} className="inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors">
                          Last Activity
                          <span className="text-[10px]">{accountSortIndicator('lastActivity')}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAccountRows.map((row) => (
                      <tr
                        key={row.key}
                        onClick={() => drillInto(row.key)}
                        className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50 transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-2 align-middle">
                          <div className="flex items-center justify-center h-full">
                            <SharedAccountAvatar
                              name={row.label}
                              accountKey={row.key}
                              storefrontImage={row.storefrontImage}
                              logos={row.logos}
                              size={36}
                              className="w-9 h-9 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <span className="text-sm font-medium">{row.label}</span>
                        </td>
                        <td className="px-3 py-2 align-middle text-center">
                          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{row.campaigns.length}</span>
                        </td>
                        <td className="px-3 py-2 align-middle text-center">
                          {row.sentCount > 0 ? (
                            <span className="text-xs tabular-nums text-green-400">{row.sentCount}</span>
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-middle text-center">
                          {row.scheduledCount > 0 ? (
                            <span className="text-xs tabular-nums text-blue-400">{row.scheduledCount}</span>
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-middle text-right">
                          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                            {formatShortDate(row.lastActivityTs)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <PaginationBar
              page={accountPage}
              totalPages={accountTotalPages}
              totalItems={sortedAccountRows.length}
              pageSize={PAGE_SIZE}
              onPageChange={setAccountPage}
              itemLabel="accounts"
            />
          </>
        )}

        {/* ── Campaign Table (Level 2 — drill-down) ── */}
        {selectedAccount && (
          <>
            {selectedCampaigns.length === 0 ? (
              <div className="text-center py-16 text-[var(--muted-foreground)]">
                <p className="text-sm">
                  {debouncedSearch
                    ? 'No campaigns match your search.'
                    : 'No campaigns found for this account.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto glass-table">
                <table className="w-full min-w-[600px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                      {selectMode && (
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={
                              pagedCampaigns.length > 0 &&
                              pagedCampaigns.every((c) => selectedKeys.has(getCampaignKey(c)))
                            }
                            ref={(el) => {
                              if (!el) return;
                              const someSelected = pagedCampaigns.some((c) =>
                                selectedKeys.has(getCampaignKey(c)),
                              );
                              const allSelected =
                                pagedCampaigns.length > 0 &&
                                pagedCampaigns.every((c) => selectedKeys.has(getCampaignKey(c)));
                              el.indeterminate = someSelected && !allSelected;
                            }}
                            onChange={toggleSelectAllOnPage}
                            className="h-4 w-4 rounded border border-[var(--border)] bg-transparent accent-[var(--primary)] cursor-pointer"
                            aria-label="Select all campaigns on this page"
                          />
                        </th>
                      )}
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Name
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Channel
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <SortHeader label="Status" field="status" activeField={campaignSortField} activeDir={campaignSortDir} onToggle={toggleCampaignSort} />
                      </th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <SortHeader label="Scheduled" field="scheduled" activeField={campaignSortField} activeDir={campaignSortDir} onToggle={toggleCampaignSort} />
                      </th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        <SortHeader label="Last Updated" field="updated" activeField={campaignSortField} activeDir={campaignSortDir} onToggle={toggleCampaignSort} />
                      </th>
                      <th className="w-14 px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCampaigns.map((item) => {
                      const rowKey = getCampaignKey(item);
                      return (
                        <CampaignTableRow
                          key={rowKey}
                          item={item}
                          accountMeta={accountMeta}
                          accountProviders={accountProviders}
                          isMenuOpen={openMenuId === rowKey}
                          downloading={downloadingId === rowKey}
                          selectMode={selectMode}
                          selected={selectedKeys.has(rowKey)}
                          onToggleMenu={(campaign) => {
                            const key = getCampaignKey(campaign);
                            setOpenMenuId((prev) => (prev === key ? null : key));
                          }}
                          onPreview={handlePreview}
                          onDownload={handleDownload}
                          onToggleSelect={toggleSelectCampaign}
                          onEdit={handleEditCampaign}
                          onArchive={handleArchiveCampaign}
                          onDelete={handleDeleteCampaign}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <PaginationBar
              page={campaignPage}
              totalPages={campaignTotalPages}
              totalItems={selectedCampaigns.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCampaignPage}
              itemLabel="campaigns"
            />
          </>
        )}
      </div>

      {/* Bulk action dock (drill-down view only) */}
      {selectMode && selectedAccount && (
        <BulkActionDock
          count={selectedKeys.size}
          itemLabel="campaigns"
          onClose={exitSelectMode}
          actions={[
            {
              id: 'select-all',
              label:
                pagedCampaigns.length > 0 &&
                pagedCampaigns.every((c) => selectedKeys.has(getCampaignKey(c)))
                  ? 'Deselect all'
                  : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: toggleSelectAllOnPage,
              disabled: pagedCampaigns.length === 0,
            },
            {
              id: 'copy',
              label: 'Copy',
              icon: <DocumentDuplicateIcon className="h-4 w-4" />,
              onClick: () => { void handleBulkCopy(); },
              disabled: selectedKeys.size === 0 || bulkBusy,
            },
            {
              id: 'download',
              label: 'Download PNG',
              icon: <ArrowDownTrayIcon className="h-4 w-4" />,
              onClick: () => { void handleBulkDownload(); },
              disabled: selectedKeys.size === 0 || bulkBusy,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: () => { void handleBulkDelete(); },
              disabled: selectedKeys.size === 0 || bulkBusy,
              danger: true,
            },
          ]}
        />
      )}

      {/* Preview modal */}
      {previewCampaign && (
        <div
          className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setPreviewCampaign(null)}
        >
          <div
            className="glass-modal w-[1120px] max-w-[96vw] h-[86vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">Email Preview</h3>
                <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
                  {previewCampaign.name || 'Untitled campaign'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition-colors"
                  >
                    Open Source
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewCampaign(null)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                  aria-label="Close preview"
                >
                  <XMarkIcon className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-3 overflow-hidden">
              {previewLoading ? (
                <div className="h-full rounded-xl border border-[var(--border)] flex items-center justify-center text-sm text-[var(--muted-foreground)]">
                  Loading preview...
                </div>
              ) : previewError ? (
                <div className="h-full rounded-xl border border-red-500/20 bg-red-500/10 flex items-center justify-center text-sm text-red-300 px-4 text-center">
                  {previewError}
                </div>
              ) : (
                <iframe
                  title="Campaign email preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  className="w-full h-full rounded-xl border border-[var(--border)] bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
