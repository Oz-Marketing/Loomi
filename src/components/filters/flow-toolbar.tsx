'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDownIcon,
  BuildingStorefrontIcon,
  CheckIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import type { AccountFilterOption, RepFilterOption } from '@/components/filters/blast-toolbar';

// -- Types --

export interface FlowFilterState {
  account: string[];
  status: string[];
  oem: string[];
  industry: string[];
  rep: string[];
}

export interface FlowFilterOptions {
  accounts: AccountFilterOption[];
  statuses: string[];
  oems: string[];
  industries: string[];
  reps: RepFilterOption[];
}

interface FlowToolbarProps {
  filters: FlowFilterState;
  onFiltersChange: (filters: FlowFilterState) => void;
  options: FlowFilterOptions;
}

function TinyAvatar({ label, accountKey, storefrontImage, logos }: { label: string; accountKey?: string; storefrontImage?: string; logos?: AccountFilterOption['logos'] }) {
  return (
    <AccountAvatar
      name={label}
      accountKey={accountKey || label}
      storefrontImage={storefrontImage}
      logos={logos}
      size={16}
      className="w-4 h-4 rounded-[3px] object-cover flex-shrink-0 border border-[var(--border)]"
    />
  );
}

function DropdownAvatar({ label, accountKey, storefrontImage, logos }: { label: string; accountKey?: string; storefrontImage?: string; logos?: AccountFilterOption['logos'] }) {
  return (
    <AccountAvatar
      name={label}
      accountKey={accountKey || label}
      storefrontImage={storefrontImage}
      logos={logos}
      size={20}
      className="w-5 h-5 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
    />
  );
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter(v => v !== value)
    : [...values, value];
}

function getFilterLabel(baseLabel: string, values: string[]): string {
  if (values.length === 0) return baseLabel;
  if (values.length === 1) return values[0];
  return `${baseLabel} (${values.length})`;
}

export function FlowToolbar({
  filters,
  onFiltersChange,
  options,
}: FlowToolbarProps) {
  const [openPanel, setOpenPanel] = useState<'account' | 'status' | 'industry' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPanel) return;
    function handleClick(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openPanel]);

  useEffect(() => {
    if (!openPanel) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenPanel(null);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [openPanel]);

  const activeCount = [filters.account, filters.status, filters.industry, filters.rep]
    .filter(values => values.length > 0)
    .length;

  function setFilter<K extends keyof FlowFilterState>(key: K, values: FlowFilterState[K]) {
    onFiltersChange({ ...filters, [key]: values });
  }

  function toggleFilterValue<K extends keyof FlowFilterState>(key: K, value: string) {
    setFilter(key, toggleSelection(filters[key], value) as FlowFilterState[K]);
  }

  function clearFilter<K extends keyof FlowFilterState>(key: K) {
    setFilter(key, [] as FlowFilterState[K]);
  }

  function clearAll() {
    onFiltersChange({ account: [], status: [], oem: [], industry: [], rep: [] });
    setOpenPanel(null);
  }

  const selectedAccountOptions = options.accounts.filter(a => filters.account.includes(a.label));
  const selectedAccountOption = selectedAccountOptions.length === 1 ? selectedAccountOptions[0] : null;

  const accountIcon = selectedAccountOption
    ? <TinyAvatar label={selectedAccountOption.label} accountKey={selectedAccountOption.key} storefrontImage={selectedAccountOption.storefrontImage} logos={selectedAccountOption.logos} />
    : <BuildingStorefrontIcon className="w-3.5 h-3.5" />;

  return (
    <div ref={toolbarRef} className="flex items-center gap-2 flex-wrap">
      {options.accounts.length > 0 && (
        <AccountFilterDropdown
          values={filters.account}
          isOpen={openPanel === 'account'}
          icon={accountIcon}
          triggerLabel={getFilterLabel('Sub-Account', filters.account)}
          onToggle={() => setOpenPanel(openPanel === 'account' ? null : 'account')}
          onClear={() => clearFilter('account')}
          accounts={options.accounts}
          onToggleValue={(value) => toggleFilterValue('account', value)}
        />
      )}

      {options.statuses.length > 0 && (
        <MultiFilterDropdown
          label="Status"
          values={filters.status}
          isOpen={openPanel === 'status'}
          onToggle={() => setOpenPanel(openPanel === 'status' ? null : 'status')}
          onClear={() => clearFilter('status')}
          panelTitle="Filter by Status"
          panelOptions={options.statuses}
          panelAllLabel="All Statuses"
          onToggleValue={(value) => toggleFilterValue('status', value)}
        />
      )}

      {options.industries.length > 1 && (
        <MultiFilterDropdown
          label="Industry"
          values={filters.industry}
          isOpen={openPanel === 'industry'}
          onToggle={() => setOpenPanel(openPanel === 'industry' ? null : 'industry')}
          onClear={() => clearFilter('industry')}
          panelTitle="Filter by Industry"
          panelOptions={options.industries}
          panelAllLabel="All Industries"
          onToggleValue={(value) => toggleFilterValue('industry', value)}
        />
      )}

      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          title="Reset filters"
        >
          <FunnelIcon className="w-3 h-3" />
          Reset{activeCount > 1 ? ` (${activeCount})` : ''}
        </button>
      )}
    </div>
  );
}

function AccountFilterDropdown({
  values,
  isOpen,
  icon,
  triggerLabel,
  onToggle,
  onClear,
  accounts,
  onToggleValue,
}: {
  values: string[];
  isOpen: boolean;
  icon: React.ReactNode;
  triggerLabel: string;
  onToggle: () => void;
  onClear: () => void;
  accounts: AccountFilterOption[];
  onToggleValue: (value: string) => void;
}) {
  const hasSelection = values.length > 0;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
          isOpen
            ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
            : hasSelection
              ? 'border-[var(--primary)]/50 text-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
        }`}
      >
        {icon}
        <span className="max-w-[140px] truncate">{triggerLabel}</span>
        {hasSelection ? (
          <XMarkIcon
            className="w-3 h-3 hover:text-[var(--foreground)]"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
          />
        ) : (
          <ChevronDownIcon className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-2 z-50 glass-dropdown shadow-lg animate-fade-in-up"
          style={{ minWidth: '260px' }}
        >
          <div className="p-1.5">
            <p className="px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              Filter by Account
            </p>
            <button
              onClick={onClear}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                !hasSelection
                  ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              All Accounts
              {!hasSelection && <CheckIcon className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="border-t border-[var(--border)] max-h-[280px] overflow-y-auto p-1.5">
            {accounts.map((acct) => {
              const isSelected = values.includes(acct.label);
              const location = [acct.city, acct.state].filter(Boolean).join(', ');
              return (
                <button
                  key={acct.label}
                  onClick={() => onToggleValue(acct.label)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <DropdownAvatar label={acct.label} accountKey={acct.key} storefrontImage={acct.storefrontImage} logos={acct.logos} />
                  <span className="flex-1 min-w-0 text-left">
                    <span className="block truncate">{acct.label}</span>
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
  );
}

function MultiFilterDropdown({
  label,
  values,
  isOpen,
  icon,
  onToggle,
  onClear,
  panelTitle,
  panelOptions,
  panelAllLabel,
  onToggleValue,
}: {
  label: string;
  values: string[];
  isOpen: boolean;
  icon?: React.ReactNode;
  onToggle: () => void;
  onClear: () => void;
  panelTitle: string;
  panelOptions: string[];
  panelAllLabel: string;
  onToggleValue: (value: string) => void;
}) {
  const hasSelection = values.length > 0;
  const triggerLabel = getFilterLabel(label, values);

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
          isOpen
            ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
            : hasSelection
              ? 'border-[var(--primary)]/50 text-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
        }`}
      >
        {icon}
        <span className="max-w-[140px] truncate">{triggerLabel}</span>
        {hasSelection ? (
          <XMarkIcon
            className="w-3 h-3 hover:text-[var(--foreground)]"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
          />
        ) : (
          <ChevronDownIcon className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-2 z-50 glass-dropdown shadow-lg animate-fade-in-up"
          style={{ minWidth: '220px' }}
        >
          <div className="p-1.5">
            <p className="px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              {panelTitle}
            </p>
            <button
              onClick={onClear}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                !hasSelection
                  ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              {panelAllLabel}
              {!hasSelection && <CheckIcon className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="border-t border-[var(--border)] max-h-[280px] overflow-y-auto p-1.5">
            {panelOptions.map((opt) => {
              const isSelected = values.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => onToggleValue(opt)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {isSelected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
