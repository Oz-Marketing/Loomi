'use client';

import { useState, useRef, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  BuildingStorefrontIcon,
  XMarkIcon,
  ChevronDownIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';

// Toolbar shrank down to the essentials: contact count, refresh, and a
// text-search input. Preset/audience pill chips moved to /contacts/segments;
// Import + Add CTAs moved up to the page header. ContactsAccountFilter still
// lives here as a reusable export.

interface ContactsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  hasAccountFilter?: boolean;
  totalCount: number;
  filteredCount: number;
  loading: boolean;
  onRefresh?: () => void;
}

export function ContactsToolbar({
  search,
  onSearchChange,
  hasAccountFilter = false,
  totalCount,
  filteredCount,
  loading,
  onRefresh,
}: ContactsToolbarProps) {
  const showFilteredCount =
    Boolean(search.trim()) || hasAccountFilter || filteredCount !== totalCount;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {showFilteredCount
              ? `${filteredCount.toLocaleString()} / ${totalCount.toLocaleString()}`
              : `${totalCount.toLocaleString()}`
            } contact{totalCount !== 1 ? 's' : ''}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              title="Refresh"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        <div className="relative flex-1 max-w-md min-w-[260px] ml-auto">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, email, phone, vehicle, tag..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
    </div>
  );
}

// ── Account multi-select (still used by admin /contacts header) ──

interface ContactAccountFilterOption {
  key: string;
  dealer: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  city?: string;
  state?: string;
}

interface ContactsAccountFilterProps {
  values: string[];
  onChange: (values: string[]) => void;
  accounts: ContactAccountFilterOption[];
  className?: string;
}

function TinyAccountAvatar({
  dealer,
  accountKey,
  storefrontImage,
  logos,
}: {
  dealer: string;
  accountKey: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
}) {
  return (
    <AccountAvatar
      size={20}
      name={dealer}
      accountKey={accountKey}
      storefrontImage={storefrontImage}
      logos={logos}
    />
  );
}

export function ContactsAccountFilter({
  values,
  onChange,
  accounts,
  className,
}: ContactsAccountFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const selectedCount = values.length;
  const label =
    selectedCount === 0
      ? 'All sub-accounts'
      : selectedCount === 1
        ? accounts.find((a) => a.key === values[0])?.dealer || '1 sub-account'
        : `${selectedCount} sub-accounts`;

  function toggle(key: string) {
    if (values.includes(key)) {
      onChange(values.filter((value) => value !== key));
    } else {
      onChange([...values, key]);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 px-3 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 transition-colors"
      >
        <BuildingStorefrontIcon className="w-4 h-4" />
        <span className="truncate max-w-[180px]">{label}</span>
        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[280px] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg z-30 max-h-[400px] overflow-y-auto">
          <div className="p-2 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Filter accounts
            </span>
            {values.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1"
              >
                <XMarkIcon className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <ul className="py-1">
            {accounts.map((account) => {
              const isSelected = values.includes(account.key);
              return (
                <li key={account.key}>
                  <button
                    type="button"
                    onClick={() => toggle(account.key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--muted)]/50"
                  >
                    <TinyAccountAvatar
                      dealer={account.dealer}
                      accountKey={account.key}
                      storefrontImage={account.storefrontImage}
                      logos={account.logos}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{account.dealer}</p>
                      {(account.city || account.state) && (
                        <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                          {[account.city, account.state].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                    {isSelected && <CheckIcon className="w-4 h-4 text-[var(--primary)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
