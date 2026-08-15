'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  PhotoIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
  EllipsisHorizontalIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  Square2StackIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  CheckIcon,
  BookmarkIcon,
  BuildingStorefrontIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  FunnelIcon,
  ArrowLeftStartOnRectangleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { toast } from '@/lib/toast';
import { useDockedScroll } from '@/hooks/use-docked-scroll';
import { safeJson } from '@/lib/safe-json';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import BulkActionDock from '@/components/bulk-action-dock';
import { CropEditorModal, type CropRect } from '@/components/media/crop-editor-modal';
import { RenditionPanel } from '@/components/media/rendition-panel';
import { PublicLinkPanel } from '@/components/media/public-link-panel';
import { RightsActivityPanel } from '@/components/media/rights-activity-panel';
import { ScopeMoveModal, type ScopeMoveTarget } from '@/components/media/scope-move-modal';
import { CollectionsSection } from '@/components/media/collections-section';
import { BulkMetadataModal } from '@/components/media/bulk-metadata-modal';
import {
  MediaScopeSection,
  scopeLabel,
  scopeSearchLabel,
  scopeToParams,
  type AdminScope,
} from '@/components/media/media-scope-section';
import { ApprovalPanel } from '@/components/media/approval-panel';
import {
  AssetMetadataFields,
  EMPTY_ASSET_METADATA,
  assetMetadataDiff,
  assetMetadataFrom,
  assetMetadataToFormFields,
  type AssetMetadataValue,
} from '@/components/media/asset-metadata-fields';
import { assetSourceLabel } from '@/lib/media-metadata';
import {
  DIRECT_UPLOAD_MAX_BYTES,
  checkAnyUploadSize,
  formatBytes,
  needsDirectUpload,
} from '@/lib/media-limits';
import {
  extractArchive,
  inspectArchive,
  isZip,
  type ArchiveInspection,
} from '@/lib/media-archive';
import { rightsBadgeLabel, type RightsAssessment } from '@/lib/media-rights';
import type { MediaPreflight } from '@/lib/media-preflight';
import {
  MEDIA_FACET_KEYS,
  buildMediaFacetOptions,
  facetsForAsset,
  matchesMediaFacets,
  countMediaFacetsSelected,
  type MediaFacetSelection,
} from '@/lib/media-facets';
import { MediaFilterRail, type OwnershipFilter } from '@/components/media/media-filter-rail';
import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';
import { Select } from '@/components/select';
import { HelpTip } from '@/components/ui/help-tip';
import PrimaryButton from '@/components/primary-button';

// ── Constants ──

// Size checking lives in lib/media-limits.ts so the browser refuses a file for
// exactly the reason the API would.

// ── Types ──

interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size?: number;
  thumbnailUrl?: string;
  /** Accessible alt text — surfaced as the default `alt=` value when
   *  the asset is inserted into HTML/landing-page content. Null until
   *  the user provides one. */
  altText?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** STORAGE origin. Not to be confused with `assetSource` (DAM provenance). */
  source?: 'esp' | 's3';
  category?: string;
  /** Set when the asset is soft-archived (hidden from the default view). */
  archivedAt?: string | null;

  // ── DAM metadata (docs/asset-management.md Phase 1) ──
  accountKey?: string | null;
  oem?: string | null;
  assetSource?: string | null;
  assetCategory?: string | null;
  modelYear?: string[];
  vehicleModel?: string[];
  tags?: string[];
  rightsHolder?: string | null;
  parentAssetId?: string | null;

  // ── Rights (Phase 3) ──
  licenseType?: string | null;
  licenseRef?: string | null;
  licenseStartsAt?: string | null;
  licenseExpiresAt?: string | null;
  expiresAt?: string | null;
  expiredAt?: string | null;
  usageScope?: string[];
  territoryScope?: string[];
  derivativesPermitted?: boolean | null;
  sublicensingPermitted?: boolean | null;
  /** Derived server-side — see serializeMediaAsset. */
  rights?: RightsAssessment | null;

  /** Externally-managed (brand logo / custom font) — read-only here. */
  managedBy?: string | null;
  managedRef?: string | null;

  // ── Approval (Phase 5) ──
  status?: string | null;
  approvedAt?: string | null;
  approvedByName?: string | null;
  reviewNote?: string | null;
  preflight?: MediaPreflight | null;
}

interface MediaCapabilities {
  canUpload: boolean;
  canDelete: boolean;
  canRename: boolean;
}

interface AccountMediaPreview {
  files: MediaFile[];
  totalCount?: number;
  provider: string | null;
  capabilities: MediaCapabilities | null;
  loading: boolean;
  error?: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  iconSrc?: string;
}

// ── Helpers ──

// All media flows through Loomi-native S3 storage. Single-entry
// provider catalog keeps the source-pill rendering uniform.
const PROVIDER_META: Record<string, ProviderInfo> = {
  s3: {
    id: 's3',
    displayName: 'Loomi',
    iconSrc: undefined,
  },
};

const S3_CAPABILITIES: MediaCapabilities = {
  canUpload: true,
  canDelete: true,
  canRename: true,
};

/**
 * What you may do to an asset you don't own — look at it, copy its URL, download
 * it. Nothing that writes.
 *
 * The API already refuses these (checkAccess returns false for an asset outside
 * your accountKey), so this isn't the security boundary; it's there so the menu
 * doesn't offer four actions that all end in a 403 toast. An OEM-shared asset is
 * one row behind every rooftop that carries the brand, and "delete" on it would
 * mean something very different from what the person clicking expects.
 */
const INHERITED_CAPABILITIES: MediaCapabilities = {
  canUpload: false,
  canDelete: false,
  canRename: false,
};

function CropIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M 11.970703 3.9726562 A 2.0002 2.0002 0 0 0 10 6 L 10 10 L 6 10 A 2.0002 2.0002 0 1 0 6 14 L 10 14 L 10 31 C 10 34.842251 13.157749 38 17 38 L 34 38 L 34 42 A 2.0002 2.0002 0 1 0 38 42 L 38 38 L 42 38 A 2.0002 2.0002 0 1 0 42 34 L 17 34 C 15.320251 34 14 32.679749 14 31 L 14 6 A 2.0002 2.0002 0 0 0 11.970703 3.9726562 z M 16 10 L 16 14 L 31 14 C 32.679749 14 34 15.320251 34 17 L 34 32 L 38 32 L 38 17 C 38 13.157749 34.842251 10 31 10 L 16 10 z" />
    </svg>
  );
}

function providerLabel(provider: string): string {
  return PROVIDER_META[provider]?.displayName || provider;
}

function providerIcon(provider: string): string | undefined {
  return PROVIDER_META[provider]?.iconSrc;
}

function timeAgo(dateStr: string | null | undefined): string {
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

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaItemKey(file: MediaFile): string {
  const source = file.source || 'esp';
  const id = (file.id || '').trim();
  const url = (file.url || '').trim();
  const name = (file.name || '').trim();
  const createdAt = (file.createdAt || '').trim();

  if (id) return `${source}:id:${id}`;
  if (url) return `${source}:url:${url}`;
  return `${source}:name:${name}:created:${createdAt}`;
}

function stagedFileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}::${file.type}`;
}

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

// ── Extracted sub-components (stable references — never defined inside a render) ──

function ProviderPill({ prov }: { prov: string }) {
  const icon = providerIcon(prov);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--muted)] text-[10px] font-medium text-[var(--muted-foreground)]">
      {icon && (
        <img src={icon} alt={providerLabel(prov)} className="w-3.5 h-3.5 rounded-full object-cover" />
      )}
      {providerLabel(prov)}
    </span>
  );
}

/**
 * Where an asset comes from, as a corner badge on the thumbnail.
 *
 * Priority is deliberate: the BRAND matters more than the provenance, because an
 * OEM-scoped asset is shared — a rooftop editing one is editing every sub-account
 * that carries that brand. Falls back to the DAM source when there's no brand,
 * and renders nothing at all when neither is set, so untagged libraries look
 * exactly as they do today.
 */
function AssetOriginBadge({ f }: { f: MediaFile }) {
  // A managed asset's origin is the useful thing to show — "Brand logo" tells
  // you why it can't be edited here, which "Dealer-supplied" would not.
  if (f.managedBy) {
    return (
      <span
        className="absolute top-2 right-2 z-10 inline-flex items-center rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm"
        title="Managed in Settings — upload or replace it there"
      >
        {f.managedBy === 'account-font' ? 'Brand font' : 'Brand logo'}
      </span>
    );
  }

  const shared = !f.accountKey && !!f.oem;
  const label = f.oem || assetSourceLabel(f.assetSource);
  if (!label) return null;

  return (
    <span
      className={`absolute top-2 right-2 z-10 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium backdrop-blur-sm ${
        shared
          ? 'bg-[var(--primary)]/85 text-white'
          : 'bg-black/50 text-white/90'
      }`}
      title={shared ? `Shared across all ${f.oem} sub-accounts` : label}
    >
      {label}
    </span>
  );
}

/**
 * Licence countdown, bottom-left of the thumbnail.
 *
 * Only appears when there's something to act on — expiring, expired or lapsed.
 * An asset that's fine, or that has no licence recorded, gets nothing: badging
 * "unknown" would put a warning on most of a library mid-migration, and a
 * warning on everything is a warning on nothing.
 */
function RightsBadge({ f }: { f: MediaFile }) {
  if (!f.rights) return null;
  const label = rightsBadgeLabel(f.rights);
  if (!label) return null;

  const past = f.rights.status === 'expired' || f.rights.status === 'lapsed';
  return (
    <span
      className={`absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm ${
        past ? 'bg-red-600/90 text-white' : 'bg-amber-500/90 text-white'
      }`}
      title={
        past
          ? 'Out of licence — replace before reusing this asset'
          : `Licence or campaign ends in ${f.rights.daysRemaining} day(s)`
      }
    >
      <ExclamationTriangleIcon className="h-3 w-3" />
      {label}
    </span>
  );
}

interface MediaCardProps {
  f: MediaFile;
  isMenuOpen: boolean;
  isSelected: boolean;
  selectionActive: boolean;
  provider: string | null;
  capabilities: MediaCapabilities | null;
  /** Owned by another scope (OEM/global/ancestor) — read-only here. */
  inherited?: boolean;
  menuClickRef: React.MutableRefObject<boolean>;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onSelect: () => void;
  onPreview: () => void;
  onCopyUrl: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  /** Change which scope owns the asset. Admin-only, so undefined otherwise. */
  onMoveScope?: () => void;
  onDelete?: () => void;
}

function MediaCard({
  f,
  isMenuOpen,
  isSelected,
  selectionActive,
  provider: activeProvider,
  capabilities: activeCaps,
  inherited,
  menuClickRef,
  draggable,
  onDragStart,
  onMenuToggle,
  onMenuClose,
  onSelect,
  onPreview,
  onCopyUrl,
  onDownload,
  onRename,
  onMoveScope,
  onDelete,
}: MediaCardProps) {
  const isImage = f.type?.startsWith('image') || f.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const caps = inherited
    ? INHERITED_CAPABILITIES
    : f.source === 's3' ? S3_CAPABILITIES : activeCaps;

  return (
    <div
      className={`glass-card rounded-xl group animate-fade-in-up relative ${isMenuOpen ? 'z-30' : 'z-0'} ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {/* Thumbnail */}
      <div
        className="h-[140px] bg-[var(--muted)] relative overflow-hidden rounded-t-xl cursor-pointer"
        onClick={onPreview}
      >
        {isImage && f.url ? (
          <img
            src={f.thumbnailUrl || f.url}
            alt={f.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <PhotoIcon className="w-10 h-10 text-[var(--muted-foreground)] opacity-30" />
          </div>
        )}
        {/* Hover overlay — pointer-events-none so it never blocks the checkbox. */}
        <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <EyeIcon className="w-6 h-6 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
        </div>
        {/* Select checkbox — appears on hover, and stays once anything is selected. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          aria-label={isSelected ? 'Deselect' : 'Select'}
          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-[var(--primary)] border-[var(--primary)] opacity-100'
              : `bg-black/40 border-white/60 hover:border-white ${selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
          }`}
        >
          {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
        </button>

        {/* Provenance badge. An OEM-shared asset has to be visually distinct from
            a rooftop's own — editing one changes it for every sub-account that
            carries the brand. */}
        <AssetOriginBadge f={f} />
        <RightsBadge f={f} />
        {/* Only DRAFT is badged. Once a library is curated, approved is the
            normal state, and badging the norm marks everything. */}
        {f.status === 'draft' && (
          <span className="absolute bottom-2 right-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            Draft
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {(f.source === 's3' ? <ProviderPill prov="s3" /> : activeProvider ? <ProviderPill prov={activeProvider} /> : null)}
          <div className="relative flex-shrink-0">
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  menuClickRef.current = true;
                  onMenuToggle();
                }}
                className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <EllipsisVerticalIcon className="w-4 h-4" />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
                  <button
                    onClick={() => { onMenuClose(); onCopyUrl(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <Square2StackIcon className="w-4 h-4" /> Copy URL
                  </button>
                  {onDownload && (
                    <button
                      onClick={() => { onMenuClose(); onDownload(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" /> Download
                    </button>
                  )}
                  {caps?.canRename && onRename && (
                    <button
                      onClick={() => { onMenuClose(); onRename(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <PencilSquareIcon className="w-4 h-4" /> Edit details
                    </button>
                  )}
                  {onMoveScope && (
                    <button
                      onClick={() => { onMenuClose(); onMoveScope(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <BuildingStorefrontIcon className="w-4 h-4" /> Move…
                    </button>
                  )}
                  {caps?.canDelete && onDelete && (
                    <button
                      onClick={() => { onMenuClose(); onDelete(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
        </div>
        <h3 className="text-xs font-semibold truncate" title={f.name}>
          {f.name}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          {f.size != null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {formatFileSize(f.size)}
            </span>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
            {timeAgo(f.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function MediaListRow({
  f,
  isMenuOpen,
  isSelected,
  selectionActive,
  provider: activeProvider,
  capabilities: activeCaps,
  inherited,
  menuClickRef,
  draggable,
  onDragStart,
  onMenuToggle,
  onMenuClose,
  onSelect,
  onPreview,
  onCopyUrl,
  onDownload,
  onRename,
  onMoveScope,
  onDelete,
}: MediaCardProps) {
  const isImage = f.type?.startsWith('image') || f.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const caps = inherited
    ? INHERITED_CAPABILITIES
    : f.source === 's3' ? S3_CAPABILITIES : activeCaps;

  return (
    <div
      className={`glass-card rounded-lg group animate-fade-in-up relative ${isMenuOpen ? 'z-30' : 'z-0'} flex items-center gap-3 px-3 py-2.5 ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {/* Select checkbox — appears on hover, stays once anything is selected. */}
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        aria-label={isSelected ? 'Deselect' : 'Select'}
        className={`flex-shrink-0 transition-opacity ${isSelected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          isSelected
            ? 'bg-[var(--primary)] border-[var(--primary)]'
            : 'bg-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'
        }`}>
          {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
        </div>
      </button>
      {/* Thumbnail */}
      <div
        className="w-10 h-10 rounded-lg bg-[var(--muted)] overflow-hidden flex-shrink-0 cursor-pointer"
        onClick={onPreview}
      >
        {isImage && f.url ? (
          <img src={f.thumbnailUrl || f.url} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <PhotoIcon className="w-5 h-5 text-[var(--muted-foreground)] opacity-30" />
          </div>
        )}
      </div>
      {/* Name + meta */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onPreview}>
        <p className="text-sm font-medium truncate">{f.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {f.size != null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">{formatFileSize(f.size)}</span>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)]">{timeAgo(f.createdAt)}</span>
        </div>
      </div>
      {/* Provider */}
      <div className="flex-shrink-0 hidden sm:block">
        {f.source === 's3' ? <ProviderPill prov="s3" /> : activeProvider ? <ProviderPill prov={activeProvider} /> : null}
      </div>
      {/* Actions */}
      <div className="relative flex-shrink-0">
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              menuClickRef.current = true;
              onMenuToggle();
            }}
            className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <EllipsisVerticalIcon className="w-4 h-4" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
              <button
                onClick={() => { onMenuClose(); onCopyUrl(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Square2StackIcon className="w-4 h-4" /> Copy URL
              </button>
              {onDownload && (
                <button
                  onClick={() => { onMenuClose(); onDownload(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Download
                </button>
              )}
              {caps?.canRename && onRename && (
                <button
                  onClick={() => { onMenuClose(); onRename(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <PencilSquareIcon className="w-4 h-4" /> Rename
                </button>
              )}
              {onMoveScope && (
                <button
                  onClick={() => { onMenuClose(); onMoveScope(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <BuildingStorefrontIcon className="w-4 h-4" /> Move…
                </button>
              )}
              {caps?.canDelete && onDelete && (
                <button
                  onClick={() => { onMenuClose(); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
    </div>
  );
}


// ── Page ──

export default function MediaPage() {
  const { confirm } = useLoomiDialog();
  const { isAdmin, isAccount, accountKey, accountData, accounts, userRole } = useAccount();
  const subaccountHref = useSubaccountHref();

  /**
   * This route renders without Loomi's sidebar, so it isn't inside
   * SurfaceShell's scroll card — nothing was setting `data-scrolled`, and the
   * pinned header sat transparent over the grid.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useDockedScroll(scrollRef);

  // ── Single-account detail state ──
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MediaCapabilities | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');

  // Upload
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pageDragOver, setPageDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageDragDepthRef = useRef(0);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  /**
   * Where the staged files will land: `'account'` = wherever the user is
   * browsing (unchanged behaviour, and the default), `'oem:<Brand>'` = shared
   * with every sub-account carrying that brand, `'global'` = the Loomi library.
   * Only offered to admins; the API rejects the other two for anyone else.
   */
  const [uploadScope, setUploadScope] = useState('account');
  /**
   * Classification applied to every file in the batch.
   *
   * Batch-wide rather than per-file on purpose: uploads arrive as a set that
   * shares its provenance — seventeen Audi template zips are all Audi, all
   * OEM-supplied, all templates. Per-file editing already exists in the asset
   * drawer for the exceptions.
   */
  /**
   * Zip inspection, keyed by staged-file fingerprint. OEM portals hand out one
   * zip per campaign, so an archive is the normal shape of an import, not an
   * edge case.
   */
  const [archives, setArchives] = useState<Record<string, ArchiveInspection>>({});
  /** Per-zip choice. Seeded from the recommendation; the person can override. */
  const [unpackChoice, setUnpackChoice] = useState<Record<string, boolean>>({});

  const [uploadMetadata, setUploadMetadata] = useState<AssetMetadataValue>(EMPTY_ASSET_METADATA);
  const [showUploadMetadata, setShowUploadMetadata] = useState(false);

  // Modals
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renameFile, setRenameFile] = useState<MediaFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Edit-details modal also owns the alt-text field — seeded when the
  // user opens the modal alongside renameValue, PATCHed together so
  // a single Save covers both fields.
  const [renameAltValue, setRenameAltValue] = useState('');
  // DAM metadata, seeded from the asset when the modal opens. Kept as its own
  // state (not merged into renameFile) so the diff on save is against what was
  // loaded, not against whatever the list has since been refreshed to.
  const [renameMetadata, setRenameMetadata] = useState<AssetMetadataValue>(EMPTY_ASSET_METADATA);
  const [renameMetadataInitial, setRenameMetadataInitial] =
    useState<AssetMetadataValue>(EMPTY_ASSET_METADATA);
  const [renaming, setRenaming] = useState(false);
  const [deleteFile, setDeleteFile] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [cropFile, setCropFile] = useState<MediaFile | null>(null);
  const [cropping, setCropping] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Bulk selection — selection is always available (hover a file for a checkbox);
  // the bulk action bar shows whenever at least one file is selected.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionActive = selectedIds.size > 0;
  // Archived view: when on, the library shows ONLY archived assets (restore surface).
  const [showArchived, setShowArchived] = useState(false);
  // ⋯ overflow menu next to New Folder (holds the Archived-view toggle).
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  /**
   * Which assets to show by ownership: the account's OWN assets, or its
   * EFFECTIVE set — everything it may use, including OEM-shared and inherited.
   *
   * Default 'mine' so the account's own library is what it opens on; the banner
   * below makes the shared set discoverable rather than mixing it in unasked.
   */
  const [ownership, setOwnership] = useState<OwnershipFilter>('mine');
  const [facetSelection, setFacetSelection] = useState<MediaFacetSelection>({});
  /** The admin view's own facet selection — independent of the account view's. */
  const [adminFacetSelection, setAdminFacetSelection] = useState<MediaFacetSelection>({});
  /** Mobile-only: the rail is always shown from `lg` up. */
  const [railOpen, setRailOpen] = useState(false);
  /** How many assets the account can see beyond its own — drives the banner. */
  const [sharedCount, setSharedCount] = useState(0);

  // Drag-and-drop

  // View mode — persisted in localStorage
  const [viewMode, setViewModeRaw] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return (localStorage.getItem('media-view-mode') as 'grid' | 'list') ?? 'grid';
  });
  const setViewMode = useCallback((mode: 'grid' | 'list') => {
    setViewModeRaw(mode);
    if (typeof window !== 'undefined') localStorage.setItem('media-view-mode', mode);
  }, []);

  // Admin account filter — persisted in sessionStorage so it survives
  // unexpected component remounts (e.g. during session refreshes).
  const [accountFilter, setAccountFilterRaw] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return sessionStorage.getItem('media-account-filter') ?? 'all';
  });
  const setAccountFilter = useCallback((value: string) => {
    setAccountFilterRaw(value);
    if (typeof window !== 'undefined') {
      if (value === 'all') sessionStorage.removeItem('media-account-filter');
      else sessionStorage.setItem('media-account-filter', value);
    }
  }, []);

  // ── Admin overview state ──
  const [overviewData, setOverviewData] = useState<Record<string, AccountMediaPreview>>({});
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState('');
  const [overviewTab, setOverviewTab] = useState<'assets' | 'rights'>('assets');
  /**
   * Which slice of the library the admin grid is showing.
   *
   * This replaced three tabs — Sub-account Media, Loomi Media and OEM Libraries —
   * which were all one question asked as navigation. They shared a grid, a search
   * box and every facet; only the where-clause differed. So it's a filter, and it
   * lives in the rail with the others.
   */
  const [adminScope, setAdminScope] = useState<AdminScope>({ kind: 'all' });
  /** Bumped after an upload so the scope counts re-fetch. */
  const [scopeRefreshKey, setScopeRefreshKey] = useState(0);
  // ── Admin S3 media state ──
  const [adminMediaFiles, setAdminMediaFiles] = useState<MediaFile[]>([]);
  const [adminMediaTotal, setAdminMediaTotal] = useState(0);
  const [adminMediaLoading, setAdminMediaLoading] = useState(false);

  // Derive the effective account key
  const effectiveAccountKey = isAccount
    ? accountKey
    : accountFilter !== 'all'
      ? accountFilter
      : null;

  /**
   * The consumer tier (§2.2). Clients browse and download the assets their
   * agency has approved; they never author. The API already forces
   * approved-only for this role — this hides the controls that would 403.
   */
  const isConsumer = userRole === 'client';

  // The brands the current account carries — floated to the top of the Brand
  // picker so a Ford rooftop isn't scrolling past forty marques to reach Ford.
  const accountBrands = useMemo(() => {
    const list = accountData?.oems?.length
      ? accountData.oems
      : accountData?.oem
        ? [accountData.oem]
        : [];
    return list.map((b) => b.trim()).filter(Boolean);
  }, [accountData?.oem, accountData?.oems]);

  /**
   * Upload destinations. The first option is always "where I am", so the default
   * upload behaves exactly as it did before this existed.
   *
   * The brand options are what make an OEM asset storable once: picking
   * "Shared — all Audi sub-accounts" writes `accountKey: null, oem: 'Audi'`, and
   * every Audi rooftop resolves it without a copy.
   */
  const uploadScopeOptions = useMemo(() => {
    const here = effectiveAccountKey
      ? `This sub-account${accountData?.dealer ? ` — ${accountData.dealer}` : ''}`
      : 'Loomi library — all accounts';
    const options = [{ value: 'account', label: here }];
    if (!isAdmin) return options;

    // An account's own brands when we know them; the full marque list otherwise
    // (the Select searches once the list is long).
    const brands = accountBrands.length > 0
      ? accountBrands
      : [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS];
    for (const brand of brands) {
      options.push({ value: `oem:${brand}`, label: `Shared — all ${brand} sub-accounts` });
    }
    if (effectiveAccountKey) {
      options.push({ value: 'global', label: 'Loomi library — all accounts' });
    }
    return options;
  }, [effectiveAccountKey, accountData?.dealer, isAdmin, accountBrands]);

  // Show overview when admin has no specific account selected
  const showOverview = isAdmin && !effectiveAccountKey;
  // Consumers can't upload, so the whole-page drop target would be a lie.
  const canDropUploadFiles = !isConsumer && (showOverview || !!effectiveAccountKey);
  /** The single admin asset view. Scope decides what's in it. */
  const isAdminGridTab = showOverview && overviewTab === 'assets';

  // All account keys (sorted)
  const allAccountKeys = useMemo(() => {
    return Object.keys(accounts).sort((a, b) => {
      const nameA = accounts[a]?.dealer || a;
      const nameB = accounts[b]?.dealer || b;
      return nameA.localeCompare(nameB);
    });
  }, [accounts]);

  // Every account is "connected" now that media is Loomi-S3-backed.
  const connectedAccountKeys = allAccountKeys;


  // Ref guard: prevents the global close-handler from firing in the same
  // tick as a menu-toggle button click.  React 18 delegates synthetic events
  // to the root container — e.stopPropagation() should stop native bubbling
  // to `document`, but in practice it sometimes doesn't.  The ref is our
  // belt-and-suspenders fallback.
  const menuClickRef = useRef(false);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => {
      if (menuClickRef.current) {
        menuClickRef.current = false;
        return;
      }
      setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Admin Overview Loading ──

  const loadOverview = useCallback(async () => {
    if (!isAdmin || connectedAccountKeys.length === 0) return;

    // Initialize loading state for all connected accounts
    const initialState: Record<string, AccountMediaPreview> = {};
    for (const key of connectedAccountKeys) {
      initialState[key] = {
        files: [],
        provider: null,
        capabilities: null,
        loading: true,
      };
    }
    setOverviewData(initialState);

    // Fetch total file counts for all connected accounts.
    // S3 is the canonical (and only) media store now — ESP media is gone.
    const results = await Promise.allSettled(
      connectedAccountKeys.map(async (key) => {
        const params = new URLSearchParams({
          accountKey: key,
          countOnly: 'true',
        });
        const res = await fetch(`/api/media?${params.toString()}`);
        const data = await res.json();

        if (res.ok) {
          return {
            accountKey: key,
            totalCount: (data.total as number) || 0,
            provider: 's3' as string | null,
            capabilities: S3_CAPABILITIES as MediaCapabilities | null,
          };
        } else {
          return {
            accountKey: key,
            totalCount: 0,
            provider: null,
            capabilities: null,
            error: data.error || 'Failed to load',
          };
        }
      })
    );

    // Update state with results
    setOverviewData(prev => {
      const updated = { ...prev };
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { accountKey: key, totalCount, provider: rowProvider, capabilities: rowCaps, error } = result.value as {
            accountKey: string;
            totalCount: number;
            provider: string | null;
            capabilities: MediaCapabilities | null;
            error?: string;
          };
          updated[key] = {
            files: [],
            totalCount,
            provider: rowProvider,
            capabilities: rowCaps,
            loading: false,
            error,
          };
        } else {
          // Promise rejected — find the account key from the index
          const idx = results.indexOf(result);
          const key = connectedAccountKeys[idx];
          if (key) {
            updated[key] = {
              files: [],
              provider: null,
              capabilities: null,
              loading: false,
              error: 'Failed to load media',
            };
          }
        }
      }
      return updated;
    });

    setOverviewLoaded(true);
  }, [isAdmin, connectedAccountKeys]);

  useEffect(() => {
    if (showOverview && !overviewLoaded && connectedAccountKeys.length > 0) {
      loadOverview();
    }
  }, [showOverview, overviewLoaded, connectedAccountKeys, loadOverview]);

  // ── Admin S3 Media Loading ──

  const loadAdminMedia = useCallback(async (searchQuery?: string, scope: AdminScope = { kind: 'all' }) => {
    if (!isAdmin) return;
    setAdminMediaLoading(true);

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchQuery?.trim()) params.set('search', searchQuery.trim());
      // The scope IS the query — see scopeToParams, which is the one place that
      // mapping lives so the rail and the fetch can't disagree.
      for (const [k, v] of Object.entries(scopeToParams(scope))) params.set(k, v);

      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        setAdminMediaFiles(data.files || []);
        setAdminMediaTotal(data.total || 0);
      } else {
        toast.error(data.error || 'Failed to load Loomi media');
      }
    } catch {
      toast.error('Failed to load Loomi media');
    }

    setAdminMediaLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    if (showOverview) {
      loadAdminMedia(undefined, adminScope);
    } else {
      setAdminMediaFiles([]);
      setAdminMediaTotal(0);
    }
    // adminScope is a dependency: changing scope has to refetch, or the grid
    // keeps showing the previous slice's assets.
  }, [showOverview, loadAdminMedia, adminScope]);

  // ── Single-Account Data Loading ──

  /**
   * Monotonic request id, so a slow response can't overwrite a newer one.
   *
   * The page mounts on the last-selected account and then corrects to the one
   * in the route, which fires two loads back to back. Without this guard the
   * FIRST account's response can land second and blank the list — the library
   * then shows "No media files yet" for an account that has files, and a reload
   * fixes it, which is exactly the kind of bug that gets reported as flaky.
   */
  const loadSeqRef = useRef(0);

  const loadMedia = useCallback(async (cursor?: string) => {
    if (!effectiveAccountKey) return;
    const seq = ++loadSeqRef.current;

    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setFiles([]);
    }

    try {
      const params = new URLSearchParams({
        accountKey: effectiveAccountKey,
      });
      if (cursor) params.set('cursor', cursor);
      if (ownership === 'mine') {
      } else {
        params.set('scope', 'effective');
      }
      if (showArchived) params.set('archived', 'true');
      params.set('limit', '50');

      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json();

      // A newer load started while this one was in flight — drop the result
      // rather than clobbering fresher state.
      if (seq !== loadSeqRef.current) return;

      if (res.ok) {
        const incoming = (data.files || []).map((f: MediaFile) => ({ ...f, source: 's3' as const }));

        if (cursor) {
          setFiles(prev => [...prev, ...incoming]);
        } else {
          setFiles(incoming);
        }
        setNextCursor(data.nextCursor || undefined);
        setProvider('s3');
        setCapabilities(isConsumer ? INHERITED_CAPABILITIES : S3_CAPABILITIES);
      } else {
        toast.error(data.error || 'Failed to load media');
      }
    } catch {
      if (seq !== loadSeqRef.current) return;
      toast.error('Failed to load media');
    }

    if (seq !== loadSeqRef.current) return;
    setLoading(false);
    setLoadingMore(false);
  }, [effectiveAccountKey, showArchived, ownership, isConsumer]);

  /**
   * How many assets this account can see that it does not own.
   *
   * Two counts rather than one query: the effective total minus the account's
   * own total. Cheap (both are countOnly) and it avoids a bespoke endpoint whose
   * only job would be to answer a banner.
   */
  useEffect(() => {
    if (!effectiveAccountKey) {
      setSharedCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [own, all] = await Promise.all([
          fetch(`/api/media?accountKey=${encodeURIComponent(effectiveAccountKey)}&countOnly=true`).then((r) => r.json()),
          fetch(`/api/media?accountKey=${encodeURIComponent(effectiveAccountKey)}&scope=effective&countOnly=true`).then((r) => r.json()),
        ]);
        if (!cancelled) setSharedCount(Math.max(0, (all?.total ?? 0) - (own?.total ?? 0)));
      } catch {
        if (!cancelled) setSharedCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveAccountKey]);

  useEffect(() => {
    if (effectiveAccountKey) {
      loadMedia();
    } else {
      setFiles([]);
      setProvider(null);
      setCapabilities(null);
      setNextCursor(undefined);
    }
  }, [effectiveAccountKey, loadMedia]);

  // ── Upload ──

  const stageFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const newFiles = Array.from(fileList);
    // Checked against what ANY route can carry: anything over the buffered
    // ceiling goes direct to S3 instead of being refused.
    const rejected = newFiles
      .map((f) => ({ file: f, error: checkAnyUploadSize(f.size) }))
      .filter((r): r is { file: File; error: string } => r.error !== null);
    for (const r of rejected) {
      toast.error(`${r.file.name}: ${r.error}`);
    }
    const valid = newFiles.filter((f) => checkAnyUploadSize(f.size) === null);
    if (valid.length === 0) return;
    setStagedFiles((prev) => {
      const seen = new Set(prev.map(stagedFileKey));
      const merged = [...prev];
      for (const file of valid) {
        const fingerprint = stagedFileKey(file);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        merged.push(file);
      }
      return merged;
    });

    // Inspect archives as they're staged, so the choice is on screen before
    // anyone commits to an upload. Reading the table of contents doesn't
    // decompress anything, so this is cheap even for a large zip.
    for (const file of valid) {
      if (!isZip(file)) continue;
      const key = stagedFileKey(file);
      inspectArchive(file)
        .then((inspection) => {
          setArchives((prev) => ({ ...prev, [key]: inspection }));
          // Seed the choice from the recommendation. A package defaults to
          // staying whole — shredding a runnable template is the expensive
          // mistake, and it's the one that isn't obvious afterwards.
          setUnpackChoice((prev) => ({
            ...prev,
            [key]: inspection.kind === 'collection' && !inspection.error,
          }));
        })
        .catch(() => {
          /* a zip we can't read just uploads as a file, which is the old behaviour */
        });
    }
  }, []);

  const handleUpload = async (files?: File[]) => {
    const staged = files ?? stagedFiles;
    if (staged.length === 0) return;

    setUploading(true);

    /**
     * Expand any archive the person chose to unpack.
     *
     * Extraction happens HERE rather than server-side so every extracted file
     * goes through the ordinary upload endpoint — inheriting content-hash
     * dedupe, thumbnails, size limits and the batch metadata without any of it
     * being reimplemented for archives.
     */
    const filesToUpload: File[] = [];
    let skippedInArchives = 0;
    for (const file of staged) {
      const key = stagedFileKey(file);
      if (!isZip(file) || !unpackChoice[key]) {
        filesToUpload.push(file);
        continue;
      }
      try {
        const { files: extracted, skipped } = await extractArchive(file);
        if (extracted.length === 0) {
          // Nothing usable inside — keep the archive rather than silently
          // uploading nothing at all.
          toast.error(`${file.name}: nothing could be extracted, uploading as a file`);
          filesToUpload.push(file);
          continue;
        }
        filesToUpload.push(...extracted);
        skippedInArchives += skipped.length;
      } catch {
        toast.error(`${file.name}: could not be unpacked, uploading as a file`);
        filesToUpload.push(file);
      }
    }

    if (skippedInArchives > 0) {
      toast.success(`Skipped ${skippedInArchives} system file${skippedInArchives > 1 ? 's' : ''} inside the archive${staged.length > 1 ? 's' : ''}`);
    }
    const uploadedFiles: MediaFile[] = [];
    let successCount = 0;
    let failCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];

      /**
       * Large files bypass the app server entirely: pre-signed PUT straight to
       * S3, then a finalize call to create the row. They give up dedupe and a
       * thumbnail (both need the bytes server-side) in exchange for not being
       * capped by what a Node process can hold.
       */
      if (needsDirectUpload(file.size, file.type)) {
        try {
          const scopedOem = uploadScope.startsWith('oem:') ? uploadScope.slice(4) : null;
          const scopeBody = {
            ...(uploadScope === 'account' && effectiveAccountKey
              ? { accountKey: effectiveAccountKey }
              : {}),
            ...(scopedOem ? { oem: scopedOem } : {}),
          };

          const signRes = await fetch('/api/media/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              ...scopeBody,
            }),
          });
          const signed = await signRes.json().catch(() => ({}));
          if (!signRes.ok) throw new Error(signed?.error || 'Could not start the upload');

          // Content-Type must match what was signed, or S3 rejects the PUT.
          const put = await fetch(signed.url, {
            method: 'PUT',
            headers: { 'Content-Type': signed.contentType },
            body: file,
          });
          if (!put.ok) {
            // The overwhelmingly likely cause, and one the app can't fix.
            throw new Error(
              `Upload was rejected by storage (${put.status}). If this is the first large upload, the bucket may need CORS configured for PUT.`,
            );
          }

          const finRes = await fetch('/api/media/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: signed.key,
              assetId: signed.assetId,
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              ...scopeBody,
              ...assetMetadataToFormFields(uploadMetadata),
              ...(scopedOem && !uploadMetadata.oem ? { oem: scopedOem } : {}),
              ...(scopedOem && !uploadMetadata.assetSource ? { assetSource: 'oem-supplied' } : {}),
            }),
          });
          const fin = await finRes.json().catch(() => ({}));
          if (!finRes.ok) throw new Error(fin?.error || 'Upload finished but could not be saved');

          uploadedFiles.push({ ...fin.file, source: 's3' });
          successCount++;
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
          failCount++;
        }
        continue;
      }

      const send = (allowDuplicate: boolean) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', 'general');

        // 'account' = upload where the user is browsing. The OEM and global
        const scopedOem = uploadScope.startsWith('oem:') ? uploadScope.slice(4) : null;
        if (uploadScope === 'account') {
          if (effectiveAccountKey) formData.append('accountKey', effectiveAccountKey);
        } else if (scopedOem) {
          formData.append('oem', scopedOem);
        }

        // Batch classification. The destination's implied values win where the
        // person didn't choose one — an upload to "all Audi sub-accounts" is
        // Audi and OEM-supplied unless they said otherwise — but an explicit
        // choice is never overwritten.
        const meta = {
          ...assetMetadataToFormFields(uploadMetadata),
          // The destination's implied values fill in where the person didn't
          // choose one; an explicit choice is never overwritten.
          ...(scopedOem && !uploadMetadata.oem ? { oem: scopedOem } : {}),
          ...(scopedOem && !uploadMetadata.assetSource ? { assetSource: 'oem-supplied' } : {}),
        };
        for (const [key, value] of Object.entries(meta)) {
          if (value) formData.append(key, value);
        }

        if (allowDuplicate) formData.append('allowDuplicate', 'true');
        return fetch('/api/media', { method: 'POST', body: formData });
      };

      try {
        let res = await send(false);

        // 409 = identical bytes already in this scope. Ask rather than decide:
        // re-uploading a file that's already here is usually a mistake, but a
        // deliberate second copy is a legitimate thing to want.
        if (res.status === 409) {
          const dup = await res.json().catch(() => null);
          const keepGoing = await confirm({
            title: 'This file is already here',
            message:
              dup?.message
              || `"${file.name}" already exists in this location with identical contents.`,
            confirmLabel: 'Upload anyway',
            cancelLabel: 'Skip',
          });
          if (!keepGoing) {
            duplicateCount++;
            continue;
          }
          res = await send(true);
        }

        const { ok, data, error } = await safeJson<{ file: MediaFile }>(res);

        if (ok && data?.file) {
          uploadedFiles.push({ ...data.file, source: 's3' });
          successCount++;
        } else {
          toast.error(`Failed to upload ${file.name}: ${error || 'Unknown error'}`);
          failCount++;
        }
      } catch {
        toast.error(`Failed to upload ${file.name}`);
        failCount++;
      }
    }

    // Only merge into the visible list when the upload landed in the scope being
    // viewed. An OEM- or Loomi-scoped upload lives somewhere else, and showing it
    // here would imply it can be edited in place — which for a shared asset is
    // exactly the wrong impression.
    const landedInView = uploadScope === 'account';
    if (uploadedFiles.length > 0 && landedInView) {
      if (showOverview && !effectiveAccountKey) {
        setAdminMediaFiles(prev => [...uploadedFiles, ...prev]);
        setAdminMediaTotal(prev => prev + uploadedFiles.length);
      } else {
        setFiles(prev => [...uploadedFiles, ...prev]);
      }
    }
    if (successCount > 0) {
      const destination = uploadScopeOptions.find(o => o.value === uploadScope)?.label;
      toast.success(
        landedInView
          ? `Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`
          : `Uploaded ${successCount} file${successCount > 1 ? 's' : ''} to ${destination}`,
      );
    }
    if (duplicateCount > 0) {
      toast.success(`Skipped ${duplicateCount} file${duplicateCount > 1 ? 's' : ''} already in this location`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} upload${failCount > 1 ? 's' : ''} failed`);
    }

    setUploading(false);
    setShowUploadModal(false);
    setStagedFiles([]);
    setUploadScope('account');
    setUploadMetadata(EMPTY_ASSET_METADATA);
    setShowUploadMetadata(false);
    setArchives({});
    setUnpackChoice({});
    // The rail's per-brand counts are now wrong, and if the upload landed in the
    // library on screen the grid needs it too — an asset that doesn't appear
    // where you just put it reads as a failed upload.
    if (showOverview) {
      setScopeRefreshKey((k) => k + 1);
      loadAdminMedia(undefined, adminScope);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    stageFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  // ── Global file drag/drop (full-page target) ──
  useEffect(() => {
    if (!canDropUploadFiles) return;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      pageDragDepthRef.current += 1;
      setPageDragOver(true);
    };

    const onDragOverWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setPageDragOver(true);
    };

    const onDragLeaveWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      pageDragDepthRef.current = Math.max(0, pageDragDepthRef.current - 1);
      if (pageDragDepthRef.current === 0) {
        setPageDragOver(false);
      }
    };

    const onDropWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      if (showUploadModal) return;
      e.preventDefault();
      pageDragDepthRef.current = 0;
      setPageDragOver(false);

      const droppedFiles = e.dataTransfer?.files || null;
      if (!droppedFiles || droppedFiles.length === 0) return;

      stageFiles(droppedFiles);

      setShowUploadModal(true);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOverWindow);
    window.addEventListener('dragleave', onDragLeaveWindow);
    window.addEventListener('drop', onDropWindow);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOverWindow);
      window.removeEventListener('dragleave', onDragLeaveWindow);
      window.removeEventListener('drop', onDropWindow);
      pageDragDepthRef.current = 0;
      setPageDragOver(false);
    };
  }, [canDropUploadFiles, showUploadModal, stageFiles]);

  // ── Edit details (filename + alt text) ──

  const handleRename = async () => {
    if (!renameFile || !renameValue.trim()) return;
    setRenaming(true);

    try {
      // Build a sparse PATCH body — only send fields the user actually
      // changed so the API doesn't churn updatedAt unnecessarily.
      // altText: null === "clear"; matches API contract.
      const trimmedAlt = renameAltValue.trim();
      const nextAlt: string | null = trimmedAlt.length === 0 ? null : trimmedAlt;
      const currentAlt = renameFile.altText ?? null;

      const body: Record<string, unknown> = {
        ...assetMetadataDiff(renameMetadata, renameMetadataInitial),
      };
      if (renameValue.trim() !== renameFile.name) {
        body.name = renameValue.trim();
      }
      if (nextAlt !== currentAlt) {
        body.altText = nextAlt;
      }
      if (Object.keys(body).length === 0) {
        setRenameFile(null);
        setRenaming(false);
        return;
      }
      if (effectiveAccountKey) body.accountKey = effectiveAccountKey;

      const res = await fetch(`/api/media/${encodeURIComponent(renameFile.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.file) {
        if (showOverview && !effectiveAccountKey) {
          setAdminMediaFiles(prev =>
            prev.map(f => (f.id === renameFile.id ? { ...f, ...data.file, source: 's3' as const } : f))
          );
        } else {
          setFiles(prev =>
            prev.map(f => (f.id === renameFile.id ? { ...f, ...data.file, source: 's3' as const } : f))
          );
        }
        toast.success('File updated');
        setRenameFile(null);
      } else {
        toast.error(data.error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update file');
    }

    setRenaming(false);
  };

  // ── Delete ──

  const handleDelete = async () => {
    if (!deleteFile) return;
    setDeleting(true);

    try {
      const params = effectiveAccountKey ? `?accountKey=${encodeURIComponent(effectiveAccountKey)}` : '';
      const res = await fetch(
        `/api/media/${encodeURIComponent(deleteFile.id)}${params}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (res.ok) {
        if (showOverview && !effectiveAccountKey) {
          setAdminMediaFiles(prev => prev.filter(f => f.id !== deleteFile.id));
          setAdminMediaTotal(prev => prev - 1);
        } else {
          setFiles(prev => prev.filter(f => f.id !== deleteFile.id));
        }
        toast.success('File deleted');
        setDeleteFile(null);
      } else {
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete file');
    }

    setDeleting(false);
  };

  // ── Copy URL ──

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied to clipboard');
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  // ── Download File ──

  const downloadFile = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCropSave = async (crop: CropRect) => {
    const fileToCrop = cropFile;
    if (!fileToCrop?.id) return;

    setCropping(true);

    try {
      // Crop is done SERVER-SIDE (sharp): the browser can't fetch the
      // cross-origin S3 image into a canvas (Spaces sends no CORS headers → the
      // old client-side crop failed with "Failed to fetch" / tainted canvas).
      const res = await fetch(`/api/media/${encodeURIComponent(fileToCrop.id)}/crop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: crop.x, y: crop.y, width: crop.width, height: crop.height }),
      });
      const { ok, data, error } = await safeJson<{ file: MediaFile }>(res);
      if (!ok || !data?.file) {
        throw new Error(error || 'Failed to crop image');
      }

      const created: MediaFile = { ...data.file, source: 's3' };
      if (showOverview && !effectiveAccountKey) {
        setAdminMediaFiles(prev => [created, ...prev]);
        setAdminMediaTotal(prev => prev + 1);
      } else {
        setFiles(prev => [created, ...prev]);
      }
      setPreviewFile(created);

      toast.success('Cropped image saved');
      setCropFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to crop image';
      toast.error(message);
    } finally {
      setCropping(false);
    }
  };

  // ── Bulk Selection ──

  const toggleSelectFile = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiles = () => {
    setSelectedIds(new Set(filtered.map(f => f.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // ── Move ──





  // ── Bulk Delete ──

  const handleBulkDelete = async () => {
    if (!effectiveAccountKey || selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: 'Delete Files',
      message: `Delete ${count} selected file${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        const res = await fetch(
          `/api/media/${encodeURIComponent(id)}?accountKey=${encodeURIComponent(effectiveAccountKey)}`,
          { method: 'DELETE' },
        );
        if (res.ok) successCount++;
      } catch { /* skip */ }
    }

    if (successCount > 0) {
      setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      toast.success(`Deleted ${successCount} file${successCount > 1 ? 's' : ''}`);
    }

    setDeleting(false);
    clearSelection();
  };

  // ── Bulk Archive / Restore ──
  // Soft-archive hides assets from the default library without deleting the
  // files; restore brings them back. Either way the affected rows leave the
  // current view (archived items leave the default view; restored items leave
  // the Archived view), so we optimistically drop them from the list.
  const handleBulkArchive = async (archived: boolean) => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        });
        if (res.ok) ok++;
      } catch { /* skip */ }
    }
    if (ok > 0) {
      setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      toast.success(`${archived ? 'Archived' : 'Restored'} ${ok} file${ok > 1 ? 's' : ''}`);
    }
    setDeleting(false);
    clearSelection();
  };

  // ── Bulk metadata edit ──
  const [bulkEditItems, setBulkEditItems] = useState<MediaFile[] | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);

  const applyBulkMetadata = async (fields: Record<string, unknown>) => {
    if (!bulkEditItems?.length) return;
    setBulkEditing(true);
    try {
      const res = await fetch('/api/media/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: bulkEditItems.map((f) => f.id), ...fields }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Could not apply those changes');
      } else {
        toast.success(`Updated ${data.updated} asset${data.updated === 1 ? '' : 's'}`);
        // Named, not counted: "2 skipped" leaves someone guessing which two.
        if (data.skipped?.length) {
          toast.error(`Skipped (no access): ${data.skipped.slice(0, 3).join(', ')}${data.skipped.length > 3 ? '…' : ''}`);
        }
        if (showOverview) loadAdminMedia(undefined, adminScope);
        else loadMedia();
        clearSelection();
        setBulkEditItems(null);
      }
    } catch {
      toast.error('Could not apply those changes');
    }
    setBulkEditing(false);
  };

  // ── Collections ──
  //
  // Selecting one TAKES OVER the grid rather than stacking on the current
  // filters: a collection is a set someone defined, and intersecting it with
  // whatever was already selected would show neither thing.
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionFiles, setCollectionFiles] = useState<MediaFile[] | null>(null);
  const [collectionName, setCollectionName] = useState<string | null>(null);
  const [collectionsKey, setCollectionsKey] = useState(0);

  useEffect(() => {
    if (!activeCollectionId) {
      setCollectionFiles(null);
      setCollectionName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/media/collections/${encodeURIComponent(activeCollectionId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setCollectionFiles(data.files || []);
          setCollectionName(data.collection?.name ?? null);
        } else {
          toast.error(data?.error || 'Could not open that collection');
          setActiveCollectionId(null);
        }
      } catch {
        if (!cancelled) setActiveCollectionId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCollectionId]);

  /** Save the current scope + facets + search as a smart collection. */
  const saveCurrentAsCollection = async () => {
    const name = window.prompt('Name this saved search');
    if (!name?.trim()) return;
    const query = {
      accountKey: adminScope.kind === 'account' ? adminScope.value : adminScope.kind === 'all' ? undefined : null,
      oem: adminScope.kind === 'oem' ? adminScope.value : adminScope.kind === 'global' ? 'none' : undefined,
      facets: adminFacetSelection,
      search: overviewSearch.trim() || undefined,
    };
    try {
      const res = await fetch('/api/media/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), kind: 'smart', query }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      toast.success(`Saved “${name.trim()}” — it keeps up as assets change`);
      setCollectionsKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that search');
    }
  };

  /** Add the current selection to a static collection, creating it if needed. */
  const addSelectionToCollection = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const name = window.prompt(`Add ${ids.length} asset${ids.length > 1 ? 's' : ''} to which collection? (a new one is created if the name is new)`);
    if (!name?.trim()) return;

    try {
      const listRes = await fetch(`/api/media/collections${adminScope.kind === 'account' ? `?accountKey=${encodeURIComponent(adminScope.value)}` : ''}`);
      const existing = listRes.ok ? (await listRes.json()).collections ?? [] : [];
      const match = existing.find(
        (c: { name: string; kind: string }) => c.name.toLowerCase() === name.trim().toLowerCase() && c.kind === 'static',
      );

      let id = match?.id;
      if (!id) {
        const created = await fetch('/api/media/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), kind: 'static' }),
        });
        const data = await created.json().catch(() => ({}));
        if (!created.ok) throw new Error(data?.error || 'failed');
        id = data.collection.id;
      }

      const res = await fetch(`/api/media/collections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addAssetIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      // `added` can be lower than the selection when some were already members —
      // saying which is more useful than claiming all of them landed.
      toast.success(
        data.added === ids.length
          ? `Added ${data.added} to “${name.trim()}”`
          : `Added ${data.added} to “${name.trim()}” (${ids.length - data.added} already there)`,
      );
      setCollectionsKey((k) => k + 1);
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add to that collection');
    }
  };

  // ── Scope moves ──
  //
  // Admin-only: promoting an asset to an OEM library publishes it to every
  // rooftop on that brand, which isn't one sub-account's call to make.
  const [scopeMoveItems, setScopeMoveItems] = useState<MediaFile[] | null>(null);
  const [movingScope, setMovingScope] = useState(false);

  const handleScopeMove = async (target: ScopeMoveTarget) => {
    if (!scopeMoveItems?.length) return;
    setMovingScope(true);
    let ok = 0;
    const failures: string[] = [];
    let duplicateOf: string | null = null;

    for (const item of scopeMoveItems) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(item.id)}/scope`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          ok += 1;
          if (data?.duplicateOf) duplicateOf = data.duplicateOf;
        } else {
          failures.push(`${item.name}: ${data?.error || 'failed'}`);
        }
      } catch {
        failures.push(`${item.name}: failed`);
      }
    }

    if (ok > 0) {
      toast.success(`Moved ${ok} asset${ok > 1 ? 's' : ''}`);
      // The moved assets have left whichever scope is on screen, so both the
      // grid and the rail's counts are now wrong.
      if (showOverview) {
        setScopeRefreshKey((k) => k + 1);
        loadAdminMedia(undefined, adminScope);
      } else {
        loadMedia();
      }
      clearSelection();
    }
    // Reported per asset: a partial move is the common failure (one managed
    // logo in a selection) and "3 of 5 moved" is actionable where a generic
    // error isn't.
    for (const f of failures.slice(0, 4)) toast.error(f);
    if (failures.length > 4) toast.error(`…and ${failures.length - 4} more failed`);
    if (duplicateOf) {
      toast.error(`A file with identical contents ("${duplicateOf}") is already there.`);
    }

    setMovingScope(false);
    setScopeMoveItems(null);
  };

  // ── Bulk Download ──

  const [downloading, setDownloading] = useState(false);

  /**
   * Zip the selection server-side and hand it to the browser.
   *
   * A blob rather than a link because the endpoint is a POST (the id list is too
   * long for a query string once someone selects fifty assets) and because the
   * server needs to check read access per file before it builds the archive.
   */
  const handleBulkDownload = async (includeRenditions: boolean) => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/media/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], includeRenditions }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Could not build the download');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loomi-media-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const skipped = Number(res.headers.get('X-Skipped-Files') || '0');
      if (skipped > 0) {
        toast.error(`${skipped} file${skipped > 1 ? 's' : ''} could not be read and were left out`);
      } else {
        toast.success(`Downloaded ${selectedIds.size} file${selectedIds.size > 1 ? 's' : ''}`);
      }
    } catch {
      toast.error('Could not build the download');
    }
    setDownloading(false);
  };

  // ── Bulk Duplicate ──
  const handleBulkDuplicate = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
        if (res.ok) ok++;
      } catch { /* skip */ }
    }
    if (ok > 0) toast.success(`Duplicated ${ok} file${ok > 1 ? 's' : ''}`);
    setDeleting(false);
    clearSelection();
    loadMedia(); // surface the new copies
  };

  // ── Bulk Delete Admin S3 Files ──

  const handleBulkDeleteAdmin = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: 'Delete files',
      message: `Delete ${count} selected file${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) successCount++;
      } catch { /* skip */ }
    }

    if (successCount > 0) {
      setAdminMediaFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      setAdminMediaTotal(prev => prev - successCount);
      toast.success(`Deleted ${successCount} file${successCount > 1 ? 's' : ''}`);
    }

    setDeleting(false);
    clearSelection();
  };








  // ── Filtering ──

  /**
   * Is this asset owned by the account being viewed, or inherited?
   *
   * Inherited covers all three of the other scopes — global, OEM-shared, and an
   * ancestor's. What they have in common is the thing that matters here: editing
   * or deleting one affects other accounts, so the UI treats it as read-only.
   */
  const isInherited = useCallback(
    (f: MediaFile) =>
      // A consumer never owns anything here: read-only is the whole tier.
      isConsumer
      // Brand logos and fonts are catalogued from Account settings, which owns
      // their lifecycle. Deleting one here would break a live logo.
      || !!f.managedBy
      || (!!effectiveAccountKey && (f.accountKey ?? null) !== effectiveAccountKey),
    [effectiveAccountKey, isConsumer],
  );

  /** Each visible asset paired with its facet values, computed once per load. */
  const filesWithFacets = useMemo(
    () => files.map((f) => ({ file: f, facets: facetsForAsset(f) })),
    [files],
  );

  const facetOptions = useMemo(
    () => buildMediaFacetOptions(filesWithFacets, facetSelection),
    [filesWithFacets, facetSelection],
  );

  /**
   * Which facets are worth showing. A facet whose every asset shares one value
   * can't narrow anything — a single-brand rooftop shouldn't carry a Brand
   * picker listing only its own marque.
   */
  const visibleFacets = useMemo(
    () => MEDIA_FACET_KEYS.filter((k) => buildMediaFacetOptions(filesWithFacets, {})[k].length > 1),
    [filesWithFacets],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filesWithFacets
      .filter(({ file, facets }) => {
        if (ownership === 'mine' && isInherited(file)) return false;
        if (ownership === 'shared' && !isInherited(file)) return false;
        if (!matchesMediaFacets(facets, facetSelection)) return false;
        if (!q) return true;
        // Mirrors the server's search fields so typing doesn't change what
        // matches as results move between the cached list and a refetch.
        return [file.name, file.altText, file.oem, file.rightsHolder, ...(file.tags ?? [])]
          .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
      })
      .map(({ file }) => file);
  }, [filesWithFacets, search, facetSelection, ownership, isInherited]);

  /**
   * Counts for the Ownership rows.
   *
   * In the 'mine' view the fetched list only holds the account's own assets, so
   * the shared figure comes from the separate countOnly pair rather than from
   * what happens to be loaded — otherwise the row would read 0 and look like
   * there is nothing to switch to.
   */
  const ownershipCounts = useMemo(() => {
    if (ownership === 'mine') {
      return { mine: files.length, shared: sharedCount, all: files.length + sharedCount };
    }
    const mine = files.filter((f) => !isInherited(f)).length;
    return { mine, shared: files.length - mine, all: files.length };
  }, [files, ownership, sharedCount, isInherited]);

  const activeFilterCount =
    countMediaFacetsSelected(facetSelection) + (ownership !== 'mine' ? 1 : 0);

  const changeOwnership = useCallback((next: OwnershipFilter) => {
    setOwnership(next);
  }, []);

  // ── Filtered admin media (for overview search) ──
  /**
   * Facets for the admin view, derived exactly as the account view derives its
   * own. The admin grid had no facets at all while three tabs stood in for
   * scope — now that scope is a filter, the rest of the taxonomy belongs beside
   * it rather than being a thing only sub-account users get.
   */
  const adminFilesWithFacets = useMemo(
    () => adminMediaFiles.map((f) => ({ file: f, facets: facetsForAsset(f) })),
    [adminMediaFiles],
  );

  const adminFacetOptions = useMemo(
    () => buildMediaFacetOptions(adminFilesWithFacets, adminFacetSelection),
    [adminFilesWithFacets, adminFacetSelection],
  );

  const adminVisibleFacets = useMemo(
    () => MEDIA_FACET_KEYS.filter(
      (k) => buildMediaFacetOptions(adminFilesWithFacets, {})[k].length > 1,
    ),
    [adminFilesWithFacets],
  );

  const filteredAdminMedia = useMemo(() => {
    // An open collection replaces the grid wholesale — see the state comment.
    if (collectionFiles) return collectionFiles;
    const q = overviewSearch.trim().toLowerCase();
    return adminFilesWithFacets
      .filter(({ file, facets }) => {
        if (!matchesMediaFacets(facets, adminFacetSelection)) return false;
        if (!q) return true;
        // Same fields the server searches, so typing doesn't change what matches
        // as results move between the cached list and a refetch.
        return [file.name, file.altText, file.oem, file.rightsHolder, ...(file.tags ?? [])]
          .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
      })
      .map(({ file }) => file);
  }, [adminFilesWithFacets, overviewSearch, adminFacetSelection, collectionFiles]);

  /** Sub-accounts for the Scope rail, with the counts the old cards showed. */
  const scopeAccounts = useMemo(
    () =>
      connectedAccountKeys.map((key) => ({
        key,
        dealer: accounts[key]?.dealer || key,
        count: overviewData[key]?.totalCount,
      })),
    [connectedAccountKeys, accounts, overviewData],
  );

  useEffect(() => {
    if (!showOverview) return;
    setSelectedIds(new Set());
    setOpenMenu(null);
    setOverviewSearch('');
    // Scope changed: a facet value from the previous slice usually doesn't exist
    // in the new one, and leaving it selected shows an empty grid for no visible
    // reason.
    setAdminFacetSelection({});
  }, [overviewTab, showOverview, adminScope]);

  // Loomi-native media is always available; gating on a provider
  // connection no longer makes sense post-ESP-teardown.
  const hasConnection = Boolean(effectiveAccountKey);
  const activeAccountName = effectiveAccountKey
    ? (accounts[effectiveAccountKey]?.dealer || accountData?.dealer || effectiveAccountKey)
    : null;

  const backToAllAccounts = useCallback(() => {
    setAccountFilter('all');
    setSearch('');
    setOverviewSearch('');
  }, [setAccountFilter]);

  // ── Render ──

  return (
    <div data-unsaved-ignore="true" className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--background)]">
      {/* Own chrome. This route renders without Loomi's sidebar (see
          layout-shell.tsx), so the way back has to live here — otherwise the
          asset library is a dead end. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-2.5">
        <Link
          href={subaccountHref('/dashboard')}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftStartOnRectangleIcon className="h-4 w-4 rotate-180" />
          Back to Loomi
        </Link>
      </div>

      {/* Padding must match what .page-sticky-header cancels with its negative
         margins — 1.5rem, then 2rem from 768px. It was px-5 (1.25rem), so the
         full-bleed header overhung by 12px a side and this scroller grew a
         horizontal scrollbar. overflow-x-hidden is the backstop: nothing in a
         media library should ever scroll sideways.

         NO padding-top, deliberately. A sticky `top: 0` child docks against this
         scroller's CONTENT box, not its padding box, so any padding-top here
         becomes a permanent strip between the chrome bar above and the docked
         header — and because the header's backdrop only covers the header, the
         grid scrolled visibly through that strip. Rest-state clearance comes
         from `.content-dock-lead` below, which scrolls away instead. */}
      <div
        ref={scrollRef}
        data-scrolled="false"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6 md:px-8"
      >
        {/* Rest-state clearance above the pinned header, which scrolls away
            beneath it — the same spacer SurfaceShell gives pages inside it.
            This route renders its own chrome, so it has to provide it. */}
        <div aria-hidden className="content-dock-lead" />
      {/* Header */}
      {/* mb-2, not mb-6: `.page-sticky-header` already carries 0.75rem of its own
          bottom padding, so a 1.5rem margin on top of it left ~36px between the
          title block and the tabs. */}
      <div className="page-sticky-header mb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <PhotoIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              {/* "Asset Library", not "Media Library": this holds co-op PDFs,
                  brand-guideline documents, fonts and campaign zips as well as
                  images, and "media" quietly tells people not to look here for
                  those. The route stays /media — no reason to break links over a
                  label — and the model is still MediaAsset. */}
              <h2 className="text-2xl font-bold">Asset Library</h2>
              <div className="flex items-center gap-2 text-sm mt-0.5 flex-wrap">
                {isAdmin ? (
                  effectiveAccountKey ? (
                    <>
                      <button
                        onClick={backToAllAccounts}
                        className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                      >
                        All Accounts
                      </button>
                      <span className="text-[var(--muted-foreground)]">{'>'}</span>
                      <span className="text-[var(--muted-foreground)]">{activeAccountName}</span>
                    </>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">All Accounts</span>
                  )
                ) : effectiveAccountKey ? (
                  <>
                    <span className="text-[var(--muted-foreground)]">{activeAccountName}</span>
                  </>
                ) : (
                  <span className="text-[var(--muted-foreground)]">Manage your media files</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons in header */}
          <div className="flex items-center gap-2">
            {showOverview && (
              <PrimaryButton
                onClick={() => {
                  setStagedFiles([]);
                  // Uploading while looking at Audi's library should go to Audi's
                  // library. Anywhere else keeps the previous default.
                  // Uploading while looking at a slice should go to that slice.
                  setUploadScope(
                    adminScope.kind === 'oem'
                      ? `oem:${adminScope.value}`
                      : adminScope.kind === 'account'
                        ? `account:${adminScope.value}`
                        : 'account',
                  );
                  setShowUploadModal(true);
                }}
                disabled={uploading}
              >
                <ArrowUpTrayIcon className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Add Assets'}
              </PrimaryButton>
            )}
            {effectiveAccountKey && (
              <>
                {/* ⋯ overflow menu — holds the Archived view toggle. Sits before
                    New Folder in the toolbar. */}
                <div className="relative">
                  <button
                    onClick={() => setMoreMenuOpen((v) => !v)}
                    title="More"
                    aria-label="More options"
                    className={`inline-flex items-center justify-center h-10 w-10 rounded-lg border transition-colors ${
                      showArchived
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <EllipsisHorizontalIcon className="w-5 h-5" />
                  </button>
                  {moreMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-40 w-48 glass-dropdown">
                        <button
                          onClick={() => { setShowArchived((v) => !v); setSelectedIds(new Set()); setMoreMenuOpen(false); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          {showArchived ? <ArrowUturnLeftIcon className="w-4 h-4" /> : <ArchiveBoxIcon className="w-4 h-4" />}
                          {showArchived ? 'Back to library' : 'View archived'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {!isConsumer && (
                  <PrimaryButton
                    onClick={() => { setStagedFiles([]); setShowUploadModal(true); }}
                    disabled={uploading}
                  >
                    <ArrowUpTrayIcon className="w-4 h-4" />
                    {uploading ? 'Uploading...' : 'Add Assets'}
                  </PrimaryButton>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Admin Overview Mode ── */}
      {showOverview && (
        <>
          {/* Hidden file input for uploads (overview mode) */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => { stageFiles(e.target.files); if (e.target) e.target.value = ''; }}
            className="hidden"
            id="media-upload-input"
          />

          {/* Two tabs, not five. Assets is one view whose scope is a filter in the
              rail; Rights & Activity is genuinely a different screen — an
              operational report with no grid and no facets. */}
          <div className="flex items-center gap-1 mb-4 border-b border-[var(--border)]">
            <button
              onClick={() => setOverviewTab('assets')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                overviewTab === 'assets'
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Assets
            </button>
            <button
              onClick={() => setOverviewTab('rights')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                overviewTab === 'rights'
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Rights &amp; Activity
            </button>
          </div>

          {overviewTab === 'rights' && <RightsActivityPanel />}

          {/* Scope + facets on the left, assets on the right — the same shape the
              account view uses, so an admin isn't learning a second layout. */}
          {isAdminGridTab && (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            {/* The wrapper owns the width; children fill it. Previously it set
                lg:w-52 AND carried pr-1 around a child that was also lg:w-52,
                so content was 4px wider than the box — and overflow-y:auto
                forces the x axis from visible to auto, which is where the
                horizontal scrollbar came from. overflow-x-hidden makes that
                impossible regardless of what a future child does. */}
            {/* lg:top tracks the docked header: its height plus the header's
                bottom margin plus a 4px breath. Changing either the header's
                height or its mb-* means changing this too, or the rail docks
                with a gap above it. */}
            <div className="w-full shrink-0 space-y-4 lg:sticky lg:top-[96px] lg:w-52 lg:max-h-[calc(100vh-11rem)] lg:self-start lg:overflow-y-auto lg:overflow-x-hidden lg:overscroll-contain">
              {/* Search leads the rail, above scope. It narrows the same slice
                  the controls below it define, so it belongs with them rather
                  than floating over the grid. */}
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={overviewSearch}
                  onChange={(e) => setOverviewSearch(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)]"
                  placeholder={`Search ${scopeSearchLabel(adminScope, accounts[adminScope.kind === 'account' ? adminScope.value : '']?.dealer)}...`}
                />
              </div>
              <MediaScopeSection
                scope={adminScope}
                onScopeChange={setAdminScope}
                accounts={scopeAccounts}
                refreshKey={scopeRefreshKey}
              />
              <CollectionsSection
                accountKey={adminScope.kind === 'account' ? adminScope.value : null}
                selectedId={activeCollectionId}
                onSelect={setActiveCollectionId}
                refreshKey={collectionsKey}
              />
              <MediaFilterRail
                options={adminFacetOptions}
                visibleFacets={adminVisibleFacets}
                selection={adminFacetSelection}
                onSelectionChange={setAdminFacetSelection}
                // Ownership is meaningless here: scope already answers "whose is
                // this", and more precisely than mine/shared could.
                ownership="all"
                onOwnershipChange={() => {}}
                showOwnership={false}
              />
            </div>
            <div className="min-w-0 flex-1">

              {/* Search now leads the rail (it narrows the same slice the rail
                  defines), so this row carries only what describes the result:
                  which slice is showing, and the offer to save it. Right-aligned
                  because it no longer has a left-hand control to sit beside. */}
              <div className="mb-4 flex items-center justify-end gap-3">
                {collectionName ? (
                  <button
                    onClick={() => setActiveCollectionId(null)}
                    className="shrink-0 text-xs text-[var(--primary)] transition-opacity hover:opacity-80"
                    title="Back to the library"
                  >
                    {collectionName} ✕
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Only offered once something is actually narrowed — saving
                        "everything" as a search would be a collection of the
                        whole library. */}
                    {(countMediaFacetsSelected(adminFacetSelection) > 0 || adminScope.kind !== 'all' || overviewSearch.trim()) && (
                      <button
                        onClick={saveCurrentAsCollection}
                        className="text-xs text-[var(--primary)] transition-opacity hover:opacity-80"
                      >
                        Save this view
                      </button>
                    )}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {scopeLabel(adminScope, accounts[adminScope.kind === 'account' ? adminScope.value : '']?.dealer)}
                    </p>
                  </div>
                )}
              </div>

          {/* ── Loomi Media Library section ── */}
          {isAdminGridTab && adminMediaLoading && adminMediaFiles.length === 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="glass-card rounded-xl animate-pulse">
                    <div className="h-[140px] rounded-t-xl bg-[var(--muted)]" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-[var(--muted)] rounded w-16" />
                      <div className="h-3 bg-[var(--muted)] rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdminGridTab && !adminMediaLoading && filteredAdminMedia.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-end mb-3">
                <p className="text-xs text-[var(--muted-foreground)]">
                  {filteredAdminMedia.length} file{filteredAdminMedia.length !== 1 ? 's' : ''}
                  {adminMediaTotal > filteredAdminMedia.length && ` of ${adminMediaTotal}`}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-3">
                {filteredAdminMedia.map(f => {
                  const itemKey = mediaItemKey(f);
                  return (
                    <MediaCard
                      key={itemKey}
                      f={f}
                      isMenuOpen={openMenu === itemKey}
                      isSelected={selectedIds.has(f.id)}
                      selectionActive={selectionActive}
                      provider="s3"
                      capabilities={S3_CAPABILITIES}
                      menuClickRef={menuClickRef}
                      onMenuToggle={() => setOpenMenu(prev => prev === itemKey ? null : itemKey)}
                      onMenuClose={() => setOpenMenu(null)}
                      onSelect={() => toggleSelectFile(f.id)}
                      onPreview={() => setPreviewFile(f)}
                      onCopyUrl={() => copyUrl(f.url)}
                      onDownload={() => downloadFile(f.url, f.name)}
                      onRename={() => {
                        setRenameValue(f.name);
                        setRenameAltValue(f.altText ?? '');
                        const meta = assetMetadataFrom(f);
                        setRenameMetadata(meta);
                        setRenameMetadataInitial(meta);
                        setRenameFile(f);
                      }}
                      onMoveScope={isAdmin && !f.managedBy ? () => setScopeMoveItems([f]) : undefined}
                      onDelete={() => setDeleteFile(f)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {isAdminGridTab && !adminMediaLoading && filteredAdminMedia.length === 0 && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                {overviewSearch.trim() ? 'Nothing matches your search' : 'No assets in this scope'}
              </p>
              <p className="text-xs">
                {overviewSearch.trim()
                  ? 'Try a different search term.'
                  : 'Nothing in this scope yet — upload, or pick another scope on the left.'}
              </p>
            </div>
          )}
            </div>
          </div>
          )}

        </>
      )}

      {/* ── Single-Account Detail Mode ── */}
      {!showOverview && (
        <>
          {/* Hidden file input for uploads */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => { stageFiles(e.target.files); if (e.target) e.target.value = ''; }}
            className="hidden"
            id="media-upload-input"
          />

          {/* Toolbar */}
          {effectiveAccountKey && (hasConnection || isAdmin) && (
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-xs">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                    placeholder="Search name, brand, keywords..."
                  />
                </div>
                {/* The rail is always visible on desktop; on narrow screens it
                    collapses behind this, same as the templates library. */}
                <button
                  type="button"
                  onClick={() => setRailOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] lg:hidden"
                >
                  <FunnelIcon className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {/* View mode toggle */}
                <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                    title="Grid view"
                  >
                    <Squares2X2Icon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                    title="List view"
                  >
                    <ListBulletIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {loading ? 'Loading...' : (
                  <>
                    {`${filtered.length} file${filtered.length !== 1 ? 's' : ''}`}
                  </>
                )}
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}

          {/* Nothing in the account's own view hints that shared assets exist.
              Without this the OEM library is invisible unless someone happens to
              open the filter rail. */}
          {effectiveAccountKey && ownership === 'mine' && sharedCount > 0 && !showArchived && (
            <button
              type="button"
              onClick={() => changeOwnership('all')}
              className="mb-4 flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            >
              <BuildingStorefrontIcon className="h-4 w-4 shrink-0 text-[var(--primary)]" />
              <span className="flex-1">
                <span className="font-medium text-[var(--foreground)]">
                  {sharedCount} shared {sharedCount === 1 ? 'asset is' : 'assets are'} available
                </span>
                {' '}from your brands and the Loomi library.
              </span>
              <span className="shrink-0 font-medium text-[var(--primary)]">Show</span>
            </button>
          )}

          {/* Account mode: no account selected */}
          {!isAdmin && !effectiveAccountKey && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an account to view its media files.</p>
            </div>
          )}

          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {effectiveAccountKey && (hasConnection || isAdmin) && (
            // Sticks below the docked page header and scrolls independently of
            // the asset grid, so a long facet list never pushes the page.
            <div className={`${railOpen ? 'block' : 'hidden'} lg:sticky lg:top-[128px] lg:block lg:max-h-[calc(100vh-13rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1`}>
              <MediaFilterRail
                options={facetOptions}
                visibleFacets={visibleFacets}
                selection={facetSelection}
                onSelectionChange={setFacetSelection}
                ownership={ownership}
                onOwnershipChange={changeOwnership}
                showOwnership={sharedCount > 0 || ownership !== 'mine'}
                ownershipCounts={ownershipCounts}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">

          {/* Loading skeleton */}
          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                <div key={i} className="glass-card rounded-xl animate-pulse">
                  <div className="h-[140px] rounded-t-xl bg-[var(--muted)]" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-[var(--muted)] rounded w-16" />
                    <div className="h-3 bg-[var(--muted)] rounded w-3/4" />
                    <div className="h-2 bg-[var(--muted)] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && effectiveAccountKey && (hasConnection || isAdmin) && filtered.length === 0 && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              {files.length === 0 ? (
                isConsumer ? (
                  /* A client sees only APPROVED assets, so an empty library
                     usually means "nothing cleared yet", not "no files". The
                     old copy told them to click an Upload button they don't
                     have, about a library that isn't empty. */
                  <>
                    <p className="text-sm font-medium mb-1">Nothing shared with you yet</p>
                    <p className="text-xs">
                      Assets appear here once your account team has approved them.
                    </p>
                  </>
                ) : (
                <>
                  <p className="text-sm font-medium mb-1">No media files yet</p>
                  <p className="text-xs">Click &quot;Upload Media&quot; to upload files.</p>
                </>
                )
              ) : (
                <p className="text-sm">No files match your search.</p>
              )}
            </div>
          )}

          {/* Media grid / list */}
          {!loading && filtered.length > 0 && (
            <div className={viewMode === 'list'
              ? 'flex flex-col gap-1.5'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-3'
            }>
              {filtered.map(f => {
                const itemKey = mediaItemKey(f);
                const ItemComponent = viewMode === 'list' ? MediaListRow : MediaCard;
                // Inherited assets are read-only here: they belong to another
                // scope and editing one would change it for every account that
                // sees it. The API refuses too — this just keeps the menu honest.
                const fileInherited = isInherited(f);
                return (
                  <ItemComponent
                    key={itemKey}
                    f={f}
                    isMenuOpen={openMenu === itemKey}
                    isSelected={selectedIds.has(f.id)}
                    selectionActive={selectionActive}
                    provider={provider}
                    capabilities={capabilities}
                    inherited={fileInherited}
                    menuClickRef={menuClickRef}
                    onMenuToggle={() => setOpenMenu(prev => prev === itemKey ? null : itemKey)}
                    onMenuClose={() => setOpenMenu(null)}
                    onSelect={() => toggleSelectFile(f.id)}
                    onPreview={() => setPreviewFile(f)}
                    onCopyUrl={() => copyUrl(f.url)}
                    onDownload={() => downloadFile(f.url, f.name)}
                    onRename={capabilities?.canRename && !fileInherited ? () => {
                      setRenameValue(f.name);
                      setRenameAltValue(f.altText ?? '');
                      const meta = assetMetadataFrom(f);
                      setRenameMetadata(meta);
                      setRenameMetadataInitial(meta);
                      setRenameFile(f);
                    } : undefined}
                    onMoveScope={isAdmin && !fileInherited && !f.managedBy ? () => setScopeMoveItems([f]) : undefined}
                    onDelete={capabilities?.canDelete && !fileInherited ? () => setDeleteFile(f) : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Load More */}
          {!loading && nextCursor && (
            <div className="text-center mt-6">
              <button
                onClick={() => loadMedia(nextCursor)}
                disabled={loadingMore}
                className="px-6 py-2.5 text-sm font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
          </div>
          </div>
        </>
      )}
      </div>
      {/* Docks, modals and the drop overlay sit OUTSIDE the scroll container so
          they anchor to the viewport rather than to the scrolled content. */}

      {showOverview && isAdminGridTab && selectionActive && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel="files"
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: selectedIds.size === filteredAdminMedia.length ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: () => {
                if (selectedIds.size === filteredAdminMedia.length) {
                  setSelectedIds(new Set());
                  return;
                }
                setSelectedIds(new Set(filteredAdminMedia.map((file) => file.id)));
              },
              disabled: filteredAdminMedia.length === 0,
            },
            {
              id: 'bulk-edit',
              label: 'Edit details',
              icon: <PencilSquareIcon className="h-4 w-4" />,
              onClick: () => {
                const chosen = adminMediaFiles.filter((f) => selectedIds.has(f.id));
                if (chosen.length) setBulkEditItems(chosen);
              },
              disabled: selectedIds.size === 0 || bulkEditing,
            },
            {
              id: 'collect',
              label: 'Add to collection',
              icon: <BookmarkIcon className="h-4 w-4" />,
              onClick: addSelectionToCollection,
              disabled: selectedIds.size === 0,
            },
            {
              id: 'move-scope',
              label: 'Move',
              icon: <BuildingStorefrontIcon className="h-4 w-4" />,
              onClick: () => {
                const chosen = adminMediaFiles.filter((f) => selectedIds.has(f.id));
                if (chosen.length) setScopeMoveItems(chosen);
              },
              disabled: !isAdmin || selectedIds.size === 0 || movingScope,
            },
            {
              id: 'download',
              label: downloading ? 'Zipping…' : 'Download',
              icon: <ArrowDownTrayIcon className="h-4 w-4" />,
              onClick: () => handleBulkDownload(false),
              disabled: selectedIds.size === 0 || downloading,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDeleteAdmin,
              disabled: selectedIds.size === 0 || deleting,
              danger: true,
            },
          ]}
        />
      )}

      {!showOverview && selectionActive && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel="files"
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: selectedIds.size === filtered.length ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: () => {
                if (selectedIds.size === filtered.length) {
                  setSelectedIds(new Set());
                  return;
                }
                selectAllFiles();
              },
              disabled: filtered.length === 0,
            },
            // Archived view offers Restore; the normal view offers the full set.
            ...(showArchived
              ? [
                  {
                    id: 'restore',
                    label: 'Restore',
                    icon: <ArrowUturnLeftIcon className="h-4 w-4" />,
                    onClick: () => handleBulkArchive(false),
                    disabled: selectedIds.size === 0 || deleting,
                  },
                ]
              : [
                  {
                    id: 'bulk-edit',
                    label: 'Edit details',
                    icon: <PencilSquareIcon className="h-4 w-4" />,
                    onClick: () => {
                      const chosen = (showOverview ? adminMediaFiles : files)
                        .filter((f) => selectedIds.has(f.id));
                      if (chosen.length) setBulkEditItems(chosen);
                    },
                    disabled: selectedIds.size === 0 || bulkEditing,
                  },
                  {
                    id: 'collect',
                    label: 'Add to collection',
                    icon: <BookmarkIcon className="h-4 w-4" />,
                    onClick: addSelectionToCollection,
                    disabled: selectedIds.size === 0,
                  },
                  {
                    id: 'move-scope',
                    label: 'Move',
                    icon: <BuildingStorefrontIcon className="h-4 w-4" />,
                    onClick: () => {
                      const chosen = (showOverview ? adminMediaFiles : files)
                        .filter((f) => selectedIds.has(f.id));
                      if (chosen.length) setScopeMoveItems(chosen);
                    },
                    disabled: !isAdmin || selectedIds.size === 0 || movingScope,
                  },
                  {
                    id: 'download',
                    label: downloading ? 'Zipping…' : 'Download',
                    icon: <ArrowDownTrayIcon className="h-4 w-4" />,
                    onClick: () => handleBulkDownload(false),
                    disabled: selectedIds.size === 0 || downloading,
                  },
                  {
                    id: 'duplicate',
                    label: 'Duplicate',
                    icon: <DocumentDuplicateIcon className="h-4 w-4" />,
                    onClick: handleBulkDuplicate,
                    disabled: selectedIds.size === 0 || deleting,
                  },
                  {
                    id: 'archive',
                    label: 'Archive',
                    icon: <ArchiveBoxIcon className="h-4 w-4" />,
                    onClick: () => handleBulkArchive(true),
                    disabled: selectedIds.size === 0 || deleting,
                  },
                ]),
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDelete,
              disabled: !capabilities?.canDelete || selectedIds.size === 0 || deleting,
              danger: true,
            },
          ]}
        />
      )}


      {/* ── Edit details Modal (filename + alt text) ── */}
      {bulkEditItems && bulkEditItems.length > 0 && (
        <BulkMetadataModal
          count={bulkEditItems.length}
          accountBrands={accountBrands}
          busy={bulkEditing}
          onCancel={() => setBulkEditItems(null)}
          onApply={applyBulkMetadata}
        />
      )}

      {scopeMoveItems && scopeMoveItems.length > 0 && (
        <ScopeMoveModal
          count={scopeMoveItems.length}
          singleName={scopeMoveItems.length === 1 ? scopeMoveItems[0].name : undefined}
          accounts={scopeAccounts.map(({ key, dealer }) => ({ key, dealer }))}
          busy={movingScope}
          onCancel={() => setScopeMoveItems(null)}
          onConfirm={handleScopeMove}
        />
      )}

      {renameFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setRenameFile(null)}>
          <div className="glass-modal w-[560px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Edit file details</h3>
            </div>
            {/* min-h-0 is what actually lets a flex child shrink below its
                content and scroll; without it the body grows and pushes the
                footer past the viewport. pb-40 gives the last Select room to
                open inside the scroll area rather than against its edge. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 pb-40">
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-2">File name</label>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                  className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
                  autoFocus
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
                  Display name only — the file's URL doesn't change.
                </p>
              </div>
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-2">
                  Alt text
                </label>
                <textarea
                  value={renameAltValue}
                  onChange={(e) => setRenameAltValue(e.target.value)}
                  placeholder="Describe what's in the image, for screen readers and SEO."
                  rows={2}
                  className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] resize-none"
                />
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
                  Used as the default <code className="font-mono">alt</code> when this image is inserted into HTML or emails. Leave empty to clear.
                </p>
              </div>

              <div className="pt-2 border-t border-[var(--border)]">
                <h4 className="text-sm font-semibold mb-3">Classification</h4>
                <AssetMetadataFields
                  value={renameMetadata}
                  onChange={setRenameMetadata}
                  accountBrands={accountBrands}
                  disabled={renaming}
                />
              </div>

              <PublicLinkPanel assetId={renameFile.id} readOnly={isInherited(renameFile)} />

              <RenditionPanel
                assetId={renameFile.id}
                canGenerate={!!renameFile.type?.startsWith('image/') && renameFile.type !== 'image/svg+xml'}
                readOnly={isInherited(renameFile)}
              />

              <ApprovalPanel
                assetId={renameFile.id}
                status={renameFile.status}
                approvedByName={renameFile.approvedByName}
                approvedAt={renameFile.approvedAt}
                reviewNote={renameFile.reviewNote}
                readOnly={isInherited(renameFile)}
                onChanged={(file) => {
                  const next = { ...renameFile, ...(file as Partial<MediaFile>), source: 's3' as const };
                  setRenameFile(next);
                  setFiles((prev) => prev.map((f) => (f.id === next.id ? next : f)));
                }}
              />
            </div>
            <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setRenameFile(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={renaming || !renameValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {renaming ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Delete Confirmation Modal ── */}
      {deleteFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setDeleteFile(null)}>
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Delete File</h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--foreground)]">
                Are you sure you want to delete <strong>{deleteFile.name}</strong>?
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                This will permanently remove the file from {deleteFile.source === 's3' ? 'Loomi' : provider ? providerLabel(provider) : 'the connected platform'}. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setDeleteFile(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload Modal ── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => !uploading && setShowUploadModal(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' && !uploading) setShowUploadModal(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div
            className="glass-modal w-[520px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Upload Media</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Destination. Only shown when there's a real choice to make —
                  a non-admin always uploads to their own account. */}
              {uploadScopeOptions.length > 1 && (
                <div>
                  <label className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mb-2">
                    Upload to
                    <HelpTip title="Upload destination">
                      <p>
                        <strong>This sub-account</strong> keeps the file private to the
                        account you&apos;re viewing.
                      </p>
                      <p className="mt-2">
                        <strong>Shared</strong> stores it once against the brand — every
                        sub-account carrying that brand sees it, instead of it being
                        uploaded per rooftop.
                      </p>
                      <p className="mt-2">
                        <strong>Loomi library</strong> is for brand-agnostic assets used
                        across every account.
                      </p>
                    </HelpTip>
                  </label>
                  <Select
                    value={uploadScope}
                    onChange={setUploadScope}
                    options={uploadScopeOptions}
                    previewFont={false}
                  />
                </div>
              )}

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl ${stagedFiles.length > 0 ? 'p-5' : 'p-10'} text-center transition-all cursor-pointer ${
                  dragOver
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--primary)]/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2 text-[var(--primary)]">
                    <ArrowUpTrayIcon className="w-8 h-8 animate-bounce" />
                    <span className="text-sm font-medium">Uploading...</span>
                  </div>
                ) : (
                  <>
                    <ArrowUpTrayIcon className={`${stagedFiles.length > 0 ? 'w-6 h-6 mb-1' : 'w-10 h-10 mb-3'} mx-auto text-[var(--muted-foreground)]`} />
                    <p className={`${stagedFiles.length > 0 ? 'text-xs' : 'text-sm'} text-[var(--foreground)] font-medium mb-0.5`}>
                      {stagedFiles.length > 0 ? 'Drop more files or click to add' : 'Drop files here or click to browse'}
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">Up to {formatBytes(DIRECT_UPLOAD_MAX_BYTES)} — larger files upload straight to storage</p>
                  </>
                )}
              </div>

              {/* Batch classification. Collapsed by default: it's the difference
                  between a findable library and a folder of files, but it must
                  not stand between someone and a quick upload. */}
              {stagedFiles.length > 0 && !uploading && (
                <div className="rounded-lg border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setShowUploadMetadata((v) => !v)}
                    aria-expanded={showUploadMetadata}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--muted)] rounded-lg transition-colors"
                  >
                    <span className="text-xs font-medium text-[var(--foreground)]">
                      Classify {stagedFiles.length === 1 ? 'this file' : `these ${stagedFiles.length} files`}
                    </span>
                    <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">Optional</span>
                    <ChevronRightIcon
                      className={`h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform ${
                        showUploadMetadata ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                  {showUploadMetadata && (
                    <div className="border-t border-[var(--border)] p-3">
                      <AssetMetadataFields
                        value={uploadMetadata}
                        onChange={setUploadMetadata}
                        accountBrands={accountBrands}
                      />
                      <p className="mt-3 text-[10px] text-[var(--muted-foreground)]">
                        Applied to every file in this upload. You can change any of it per file afterwards.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Archives — what's inside, and whether to unpack. Shown before
                  the file list because the choice changes what gets uploaded. */}
              {stagedFiles.filter(isZip).map((file) => {
                const key = stagedFileKey(file);
                const info = archives[key];
                if (!info) {
                  return (
                    <div key={key} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                      Reading {file.name}…
                    </div>
                  );
                }
                if (info.error) {
                  return (
                    <div key={key} className="rounded-lg border border-[var(--border)] px-3 py-2">
                      <p className="text-xs font-medium text-[var(--foreground)]">{file.name}</p>
                      <p className="mt-0.5 text-[11px] text-amber-400">{info.error}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                        It will be uploaded as a single file.
                      </p>
                    </div>
                  );
                }
                const unpack = unpackChoice[key] ?? false;
                return (
                  <div key={key} className="rounded-lg border border-[var(--border)] p-3">
                    <p className="text-xs font-medium text-[var(--foreground)]">{file.name}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{info.reason}</p>

                    <div className="mt-2 flex items-center rounded-lg border border-[var(--border)] p-0.5">
                      <button
                        type="button"
                        onClick={() => setUnpackChoice((prev) => ({ ...prev, [key]: true }))}
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          unpack ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        Unpack {info.entries.length} file{info.entries.length === 1 ? '' : 's'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setUnpackChoice((prev) => ({ ...prev, [key]: false }))}
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          !unpack ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        Keep as one file
                      </button>
                    </div>

                    {unpack && info.kind === 'package' && (
                      // Overriding the recommendation on a bundle is the case
                      // worth naming out loud — the fragments are individually
                      // useless and the package is what someone actually needs.
                      <p className="mt-1.5 text-[10px] leading-snug text-amber-400">
                        This looks like a template package whose files reference each other.
                        Unpacking will store the pieces separately and the package won&apos;t be usable.
                      </p>
                    )}

                    {unpack && (
                      <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto">
                        {info.entries.slice(0, 40).map((e) => (
                          <li key={e.path} className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                            <span className="min-w-0 flex-1 truncate">{e.name}</span>
                            <span className="shrink-0 tabular-nums">{formatBytes(e.bytes)}</span>
                          </li>
                        ))}
                        {info.entries.length > 40 && (
                          <li className="text-[10px] text-[var(--muted-foreground)]">
                            …and {info.entries.length - 40} more
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}

              {/* Staged files list */}
              {stagedFiles.length > 0 && !uploading && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-[var(--muted-foreground)]">
                      {stagedFiles.length} file{stagedFiles.length !== 1 ? 's' : ''} ready
                    </p>
                    <button
                      onClick={() => setStagedFiles([])}
                      className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {stagedFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--muted)]/50 group">
                        {file.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt=""
                            className="w-7 h-7 rounded object-cover flex-shrink-0 border border-[var(--border)]"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded bg-[var(--muted)] flex items-center justify-center flex-shrink-0 border border-[var(--border)]">
                            <ArrowUpTrayIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{file.name}</p>
                          <p className="text-[10px] text-[var(--muted-foreground)]">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setStagedFiles((prev) => prev.filter((_, i) => i !== idx)); }}
                          className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Upload action footer */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => { setStagedFiles([]); setShowUploadModal(false); }}
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpload()}
                  disabled={uploading || stagedFiles.length === 0}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {uploading
                    ? 'Uploading...'
                    : `Upload ${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''}`
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {cropFile && (
        <CropEditorModal
          file={cropFile}
          saving={cropping}
          onClose={() => { if (!cropping) setCropFile(null); }}
          onSave={handleCropSave}
        />
      )}

      {/* ── Image Preview Modal ── */}
      {previewFile && (() => {
        const previewIsImage = previewFile.type?.startsWith('image') || previewFile.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        // Use the correct file list for navigation based on context
        const previewList = showOverview ? filteredAdminMedia : filtered;
        const currentIndex = previewList.findIndex(f => f.id === previewFile.id);
        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex < previewList.length - 1;

        const goPrev = () => { if (hasPrev) setPreviewFile(previewList[currentIndex - 1]); };
        const goNext = () => { if (hasNext) setPreviewFile(previewList[currentIndex + 1]); };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-overlay-in"
            onClick={() => setPreviewFile(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPreviewFile(null);
              if (e.key === 'ArrowLeft') goPrev();
              if (e.key === 'ArrowRight') goNext();
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <div className="glass-modal w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-3 min-w-0">
                  <PhotoIcon className="w-5 h-5 text-[var(--muted-foreground)] flex-shrink-0" />
                  <h3 className="text-sm font-semibold truncate" title={previewFile.name}>
                    {previewFile.name}
                  </h3>
                  {currentIndex >= 0 && (
                    <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
                      {currentIndex + 1} / {previewList.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex-shrink-0"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Image */}
              <div className="flex-1 overflow-hidden flex items-center justify-center bg-black/20 relative min-h-0">
                {previewIsImage && previewFile.url ? (
                  <img
                    src={previewFile.url}
                    alt={previewFile.name}
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--muted-foreground)]">
                    <PhotoIcon className="w-16 h-16 opacity-30 mb-3" />
                    <p className="text-sm">Preview not available</p>
                  </div>
                )}

                {/* Prev/Next navigation */}
                {hasPrev && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                  >
                    <ArrowRightIcon className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border)]">
                <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                  {provider && <ProviderPill prov={provider} />}
                  {previewFile.size != null && <span>{formatFileSize(previewFile.size)}</span>}
                  {previewFile.createdAt && <span>{timeAgo(previewFile.createdAt)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {previewIsImage && (
                    <button
                      onClick={() => setCropFile(previewFile)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                    >
                      <CropIcon className="w-3.5 h-3.5" /> Crop
                    </button>
                  )}
                  <button
                    onClick={() => copyUrl(previewFile.url)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    <Square2StackIcon className="w-3.5 h-3.5" /> Copy URL
                  </button>
                  {capabilities?.canDelete && (
                    <button
                      onClick={() => { setPreviewFile(null); setDeleteFile(previewFile); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      <TrashIcon className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Global file drop overlay ── */}
      {pageDragOver && !showUploadModal && canDropUploadFiles && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div className="absolute inset-0 bg-[var(--primary)]/8 backdrop-blur-[1px]" />
          <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/10 flex items-center justify-center">
            <div className="text-center px-6">
              <ArrowUpTrayIcon className="w-10 h-10 mx-auto text-[var(--primary)] mb-3" />
              <p className="text-base font-semibold text-[var(--foreground)]">Drop files to upload</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Files will be added to the upload queue.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
