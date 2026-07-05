'use client';

import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react';
import {
  CheckCircleIcon,
  CheckIcon,
  DocumentTextIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PauseCircleIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import type {
  FlowFilterOptions,
  FlowFilterState,
} from '@/components/filters/flow-toolbar';
import type { RepFilterOption } from '@/components/filters/blast-toolbar';

interface FlowFilterSidebarProps {
  open?: boolean;
  onClose?: () => void;
  inline?: boolean;
  className?: string;
  filters: FlowFilterState;
  onFiltersChange: (filters: FlowFilterState) => void;
  options: FlowFilterOptions;
}

interface SectionProps {
  label: string;
  allLabel: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}

type StatusKey = 'active' | 'draft' | 'paused' | 'inactive' | 'unknown';

const STATUS_META: Record<
  StatusKey,
  {
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    iconClass: string;
    activeClass: string;
  }
> = {
  active: {
    icon: CheckCircleIcon,
    iconClass: 'text-green-400',
    activeClass: 'border-green-400/50 bg-green-500/12 text-green-300',
  },
  draft: {
    icon: DocumentTextIcon,
    iconClass: 'text-zinc-400',
    activeClass: 'border-zinc-400/50 bg-zinc-500/12 text-zinc-300',
  },
  paused: {
    icon: PauseCircleIcon,
    iconClass: 'text-amber-400',
    activeClass: 'border-amber-400/50 bg-amber-500/12 text-amber-300',
  },
  inactive: {
    icon: XCircleIcon,
    iconClass: 'text-red-400',
    activeClass: 'border-red-400/50 bg-red-500/12 text-red-300',
  },
  unknown: {
    icon: QuestionMarkCircleIcon,
    iconClass: 'text-[var(--sidebar-muted-foreground)]',
    activeClass: 'border-[var(--primary)]/60 bg-[var(--primary)]/10 text-[var(--primary)]',
  },
};

function normalizeStatus(status: string): StatusKey {
  const s = status.toLowerCase().trim();
  if (s.includes('active') || s.includes('publish') || s.includes('running')) return 'active';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause') || s.includes('stop')) return 'paused';
  if (s.includes('inactive') || s.includes('cancel') || s.includes('disabled')) return 'inactive';
  return 'unknown';
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

const PILL_BASE_CLASS = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors';
const PILL_INACTIVE_CLASS = 'border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:border-[var(--primary)]/35 hover:bg-[var(--sidebar-muted)]/70';
const PILL_ACTIVE_CLASS = 'border-[var(--primary)]/60 bg-[var(--primary)]/14 text-[var(--primary)]';

function PillSection({
  label,
  allLabel,
  values,
  options,
  onChange,
}: SectionProps) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
          {label}
        </p>
        {values.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`${PILL_BASE_CLASS} ${
            values.length === 0 ? PILL_ACTIVE_CLASS : PILL_INACTIVE_CLASS
          }`}
        >
          {allLabel}
        </button>

        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(toggleSelection(values, option))}
              className={`${PILL_BASE_CLASS} ${selected ? PILL_ACTIVE_CLASS : PILL_INACTIVE_CLASS}`}
            >
              <span className="truncate max-w-[140px]">{option}</span>
              {selected && <CheckIcon className="w-3 h-3 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusPillSection({
  values,
  onChange,
  options,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: string[];
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
          Status
        </p>
        {values.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`${PILL_BASE_CLASS} ${
            values.length === 0 ? PILL_ACTIVE_CLASS : PILL_INACTIVE_CLASS
          }`}
        >
          All Statuses
        </button>

        {options.map((status) => {
          const selected = values.includes(status);
          const meta = STATUS_META[normalizeStatus(status)];
          const StatusIcon = meta.icon;
          return (
            <button
              key={status}
              type="button"
              onClick={() => onChange(toggleSelection(values, status))}
              className={`${PILL_BASE_CLASS} ${selected ? meta.activeClass : PILL_INACTIVE_CLASS}`}
            >
              <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? '' : meta.iconClass}`} />
              <span className="truncate max-w-[120px]">{status}</span>
              {selected && <CheckIcon className="w-3 h-3 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AccountSection({
  values,
  onChange,
  options,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: FlowFilterOptions['accounts'];
}) {
  const [query, setQuery] = useState('');

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((account) => {
      const location = [account.city, account.state].filter(Boolean).join(' ');
      return account.label.toLowerCase().includes(q) || location.toLowerCase().includes(q);
    });
  }, [options, query]);

  const selectedAccounts = options.filter((a) => values.includes(a.label));

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
          Sub-Account
        </p>
        <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
          {values.length > 0 ? `${values.length} selected` : `${options.length} total`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`${PILL_BASE_CLASS} ${
            values.length === 0 ? PILL_ACTIVE_CLASS : PILL_INACTIVE_CLASS
          }`}
        >
          All Sub-Accounts
        </button>
        {selectedAccounts.map((account) => (
          <button
            key={account.label}
            type="button"
            onClick={() => onChange(values.filter((v) => v !== account.label))}
            className={`${PILL_BASE_CLASS} ${PILL_ACTIVE_CLASS} group`}
          >
            <AccountAvatar
              name={account.label}
              accountKey={account.key || account.label}
              storefrontImage={account.storefrontImage}
              logos={account.logos}
              size={14}
              className="w-3.5 h-3.5 rounded-[3px] object-cover flex-shrink-0"
            />
            <span className="truncate max-w-[100px]">{account.label}</span>
            <XMarkIcon className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>

      {/* Search + list (always visible) */}
      <div className="rounded-xl border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-muted)]/30 p-2 space-y-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 text-[var(--sidebar-muted-foreground)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter sub-accounts..."
            className="w-full h-8 rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 pl-8 pr-2 text-[11px] text-[var(--sidebar-foreground)] placeholder:text-[var(--sidebar-muted-foreground)] focus:outline-none focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30"
          />
        </div>
        <div className="themed-scrollbar space-y-1 max-h-64 overflow-y-auto pr-1">
          {filteredAccounts.map((account) => {
            const selected = values.includes(account.label);
            const location = [account.city, account.state].filter(Boolean).join(', ');
            return (
              <button
                key={account.label}
                type="button"
                onClick={() => onChange(toggleSelection(values, account.label))}
                className={`w-full px-2 py-1.5 rounded-lg border text-[11px] text-left flex items-center gap-2 transition-colors ${
                  selected
                    ? 'border-[var(--primary)]/45 bg-[var(--primary)]/12 text-[var(--primary)]'
                    : 'border-transparent text-[var(--sidebar-foreground)] hover:border-[var(--sidebar-border-soft)] hover:bg-[var(--sidebar-muted)]/70'
                }`}
              >
                <AccountAvatar
                  name={account.label}
                  accountKey={account.key || account.label}
                  storefrontImage={account.storefrontImage}
                  logos={account.logos}
                  size={22}
                  className="w-[22px] h-[22px] rounded-md object-cover flex-shrink-0 border border-[var(--sidebar-border-soft)]"
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{account.label}</span>
                  {location && (
                    <span className="block text-[10px] text-[var(--sidebar-muted-foreground)] truncate">
                      {location}
                    </span>
                  )}
                </span>
                {selected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            );
          })}
          {filteredAccounts.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-[var(--sidebar-muted-foreground)]">
              No matching sub-accounts.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function RepDropdownSection({
  values,
  onChange,
  options,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: RepFilterOption[];
}) {
  if (options.length === 0) return null;

  const selectedReps = options.filter((r) => values.includes(r.id));

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
          Account Rep
        </p>
        <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
          {values.length > 0 ? `${values.length} selected` : `${options.length} total`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`${PILL_BASE_CLASS} ${
            values.length === 0 ? PILL_ACTIVE_CLASS : PILL_INACTIVE_CLASS
          }`}
        >
          All Reps
        </button>
        {selectedReps.map((rep) => (
          <button
            key={rep.id}
            type="button"
            onClick={() => onChange(values.filter((v) => v !== rep.id))}
            className={`${PILL_BASE_CLASS} ${PILL_ACTIVE_CLASS} group`}
          >
            <span className="truncate max-w-[100px]">{rep.label}</span>
            <XMarkIcon className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-muted)]/30 p-2 space-y-1">
        <div className="themed-scrollbar space-y-1 max-h-48 overflow-y-auto pr-1">
          {options.map((rep) => {
            const selected = values.includes(rep.id);
            return (
              <button
                key={rep.id}
                type="button"
                onClick={() => onChange(toggleSelection(values, rep.id))}
                className={`w-full px-2 py-1.5 rounded-lg border text-[11px] text-left flex items-center justify-between gap-2 transition-colors ${
                  selected
                    ? 'border-[var(--primary)]/45 bg-[var(--primary)]/12 text-[var(--primary)]'
                    : 'border-transparent text-[var(--sidebar-foreground)] hover:border-[var(--sidebar-border-soft)] hover:bg-[var(--sidebar-muted)]/70'
                }`}
              >
                <span className="truncate">{rep.label} ({rep.accountCount})</span>
                {selected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FlowFilterSidebar({
  open,
  onClose,
  inline = false,
  className = '',
  filters,
  onFiltersChange,
  options,
}: FlowFilterSidebarProps) {
  const isOpen = inline ? true : Boolean(open);

  useEffect(() => {
    if (inline || !isOpen || !onClose) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inline, isOpen, onClose]);

  if (!isOpen) return null;

  const activeCount = [filters.account, filters.status, filters.industry, filters.rep]
    .filter((values) => values.length > 0)
    .length;

  function setFilter<K extends keyof FlowFilterState>(
    key: K,
    values: FlowFilterState[K],
  ) {
    onFiltersChange({ ...filters, [key]: values });
  }

  const panel = (
    <aside
      className={
        inline
          ? `rounded-2xl text-[var(--sidebar-foreground)] flex flex-col overflow-hidden ${className}`.trim()
          : 'glass-panel glass-panel-strong fixed right-3 top-3 bottom-3 w-[350px] rounded-2xl flex flex-col overflow-hidden'
      }
    >
        <div className="p-5 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-[var(--primary)]" />
            <h3 className="text-sm font-bold tracking-tight">Filters</h3>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="themed-scrollbar flex-1 overflow-y-auto p-4 space-y-5">
          {options.accounts.length > 0 && (
            <AccountSection
              values={filters.account}
              onChange={(values) => setFilter('account', values)}
              options={options.accounts}
            />
          )}

          <RepDropdownSection
            values={filters.rep}
            onChange={(values) => setFilter('rep', values)}
            options={options.reps}
          />

          {options.statuses.length > 0 && (
            <StatusPillSection
              values={filters.status}
              onChange={(values) => setFilter('status', values)}
              options={options.statuses}
            />
          )}

          {options.industries.length > 1 && (
            <PillSection
              label="Industry"
              allLabel="All Industries"
              values={filters.industry}
              options={options.industries}
              onChange={(values) => setFilter('industry', values)}
            />
          )}
        </div>

        <div className="p-4 border-t border-[var(--sidebar-border-soft)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onFiltersChange({ account: [], status: [], oem: [], industry: [], rep: [] })}
            disabled={activeCount === 0}
            className="px-3 py-2 text-xs rounded-lg border border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] disabled:opacity-50 transition-colors"
          >
            Reset All
          </button>
          {inline ? (
            <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
              {activeCount} active
            </span>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </aside>
  );

  if (inline) return panel;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      {panel}
    </div>
  );
}
