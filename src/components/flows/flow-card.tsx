'use client';

import Link from 'next/link';
import {
  CheckCircleIcon,
  PauseCircleIcon,
  XCircleIcon,
  DocumentTextIcon,
  BoltIcon,
  EllipsisHorizontalIcon,
  ClockIcon,
  PencilSquareIcon,
  PencilIcon,
  DocumentDuplicateIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar as SharedAccountAvatar } from '@/components/account-avatar';

export interface FlowCardWorkflow {
  id: string;
  name: string;
  status: string;
  source?: string;
  provider?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
}

export interface FlowCardAccountMeta {
  dealer: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-500/10 text-green-400',
  draft:     'bg-zinc-500/10 text-zinc-400',
  inactive:  'bg-red-500/10 text-red-400',
  paused:    'bg-orange-500/10 text-orange-400',
};

const STATUS_ICON: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  active:   CheckCircleIcon,
  draft:    DocumentTextIcon,
  inactive: XCircleIcon,
  paused:   PauseCircleIcon,
};

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('active') || s.includes('publish') || s.includes('running')) return 'active';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause') || s.includes('stop')) return 'paused';
  if (s.includes('inactive') || s.includes('cancel') || s.includes('disabled')) return 'inactive';
  return s;
}

function formatRelativeDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    if (hours < 1) return 'just now';
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isLoomiWorkflow(workflow: FlowCardWorkflow): boolean {
  return (workflow.source || '').trim().toLowerCase() === 'loomi';
}

function PublishSwitch({
  active,
  disabled,
  updating,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  updating: boolean;
  onToggle: (next: 'active' | 'inactive') => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled || updating}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(active ? 'inactive' : 'active');
      }}
      title={
        disabled
          ? 'Publish toggle only available for Loomi flows'
          : active
            ? 'Click to unpublish'
            : 'Click to publish'
      }
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'bg-green-500' : 'bg-[var(--muted)] border border-[var(--border)]'
      } ${updating ? 'animate-pulse' : ''}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          active ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function FlowCard({
  workflow,
  accountMeta,
  accountName,
  showAccount,
  isMenuOpen,
  isStatusUpdating,
  onToggleMenu,
  onToggleLoomiStatus,
  hrefBuilder,
  onEdit,
  onRename,
  onClone,
  onArchive,
  onRestore,
  onDelete,
}: {
  workflow: FlowCardWorkflow;
  accountMeta?: FlowCardAccountMeta;
  accountName?: string | null;
  showAccount: boolean;
  isMenuOpen: boolean;
  isStatusUpdating: boolean;
  onToggleMenu: (workflow: FlowCardWorkflow) => void;
  onToggleLoomiStatus?: (workflow: FlowCardWorkflow, next: 'active' | 'inactive') => void;
  hrefBuilder?: (workflow: FlowCardWorkflow) => string;
  /** Row-action callbacks — when provided, they appear in the card's
   *  3-dot menu. Mirrors the FlowsTable per-row menu so the card view
   *  has full parity with the table view. */
  onEdit?: (workflow: FlowCardWorkflow) => void;
  onRename?: (workflow: FlowCardWorkflow) => void;
  onClone?: (workflow: FlowCardWorkflow) => void;
  onArchive?: (workflow: FlowCardWorkflow) => void;
  onRestore?: (workflow: FlowCardWorkflow) => void;
  onDelete?: (workflow: FlowCardWorkflow) => void;
}) {
  const normalized = normalizeStatus(workflow.status);
  const StatusIcon = STATUS_ICON[normalized];
  const isLoomi = isLoomiWorkflow(workflow);
  const canTogglePublish = isLoomi && typeof onToggleLoomiStatus === 'function';
  const href = hrefBuilder ? hrefBuilder(workflow) : `/flows/${workflow.id}`;
  const accountKey = workflow.accountKey || null;
  const dealer = accountName || workflow.dealer || accountKey || '—';

  return (
    <div className="glass-card group relative rounded-xl p-4 transition-all hover:border-[var(--primary)]/40 hover:shadow-lg">
      <Link href={href} className="absolute inset-0 rounded-xl" aria-label={`Open ${workflow.name}`} />

      {/* Header row — left half is non-interactive (so clicks bubble
          to the underlying Link); the toggle + menu cluster on the
          right opts back into pointer events. */}
      <div className="relative flex items-start justify-between gap-2 mb-3 pointer-events-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
            <BoltIcon className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" title={workflow.name}>
              {workflow.name || '(Untitled)'}
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 mt-1 rounded-full text-[10px] font-medium capitalize ${
                STATUS_BADGE[normalized] || 'bg-zinc-500/10 text-zinc-400'
              }`}
            >
              {StatusIcon && <StatusIcon className="w-3 h-3" />}
              {normalized.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        <div className="relative flex items-center gap-1 flex-shrink-0 pointer-events-auto">
          {isLoomi && (
            <PublishSwitch
              active={normalized === 'active'}
              disabled={!canTogglePublish}
              updating={isStatusUpdating}
              onToggle={(next) => onToggleLoomiStatus?.(workflow, next)}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleMenu(workflow);
            }}
            className="relative z-10 inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            aria-label="More actions"
          >
            <EllipsisHorizontalIcon className="w-4 h-4" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown shadow-lg p-1">
              {onEdit && (
                <MenuButton
                  icon={<PencilSquareIcon className="w-3.5 h-3.5" />}
                  label="Edit flow"
                  onClick={() => {
                    onEdit(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {onRename && (
                <MenuButton
                  icon={<PencilIcon className="w-3.5 h-3.5" />}
                  label="Rename"
                  onClick={() => {
                    onRename(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {onClone && (
                <MenuButton
                  icon={<DocumentDuplicateIcon className="w-3.5 h-3.5" />}
                  label="Duplicate"
                  onClick={() => {
                    onClone(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {canTogglePublish && (
                <MenuButton
                  icon={<CheckCircleIcon className="w-3.5 h-3.5" />}
                  label={
                    isStatusUpdating
                      ? 'Updating…'
                      : normalized === 'active'
                        ? 'Unpublish'
                        : 'Publish'
                  }
                  disabled={isStatusUpdating}
                  onClick={() => {
                    if (isStatusUpdating) return;
                    onToggleLoomiStatus?.(
                      workflow,
                      normalized === 'active' ? 'inactive' : 'active',
                    );
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {(onArchive || onRestore || onDelete) && (onEdit || onRename || onClone || canTogglePublish) && (
                <div className="my-1 h-px bg-[var(--border)]" />
              )}
              {onArchive && normalized !== 'archived' && (
                <MenuButton
                  icon={<ArchiveBoxIcon className="w-3.5 h-3.5" />}
                  label="Archive"
                  onClick={() => {
                    onArchive(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {onRestore && normalized === 'archived' && (
                <MenuButton
                  icon={<ArrowUturnLeftIcon className="w-3.5 h-3.5" />}
                  label="Restore"
                  onClick={() => {
                    onRestore(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
              {onDelete && (
                <MenuButton
                  icon={<TrashIcon className="w-3.5 h-3.5" />}
                  label="Delete"
                  danger
                  onClick={() => {
                    onDelete(workflow);
                    onToggleMenu(workflow);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {showAccount && accountKey && (
        <div className="relative flex items-center gap-2 mb-3 pb-3 border-b border-[var(--border)] pointer-events-none">
          <SharedAccountAvatar
            name={dealer}
            accountKey={accountKey}
            storefrontImage={accountMeta?.storefrontImage}
            logos={accountMeta?.logos}
            size={20}
            className="w-5 h-5 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
          />
          <span className="text-xs text-[var(--muted-foreground)] truncate">{dealer}</span>
        </div>
      )}

      <div className="relative flex items-center justify-between text-[11px] text-[var(--muted-foreground)] pointer-events-none">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          Updated {formatRelativeDate(workflow.updatedAt || workflow.createdAt)}
        </span>
        {workflow.createdAt && (
          <span title={new Date(workflow.createdAt).toLocaleString()}>
            Created {formatRelativeDate(workflow.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Menu button ──────────────────────────────────────────────────

function MenuButton({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        danger
          ? 'text-rose-300 hover:bg-rose-500/10'
          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
