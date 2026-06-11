'use client';

import { useState, useRef, useEffect } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  BuildingStorefrontIcon,
  CheckIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  DATE_RANGE_PRESETS,
  type DateRangeKey,
  formatCustomRangeLabel,
  getDateRangeLabel,
} from '@/lib/date-ranges';
import { AccountAvatar } from '@/components/account-avatar';

// -- Types --

export interface CustomDateRange {
  start: Date;
  end: Date;
}

export interface AccountOption {
  key: string;
  label: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string } | null;
  city?: string;
  state?: string;
}

interface DashboardToolbarProps {
  dateRange: DateRangeKey;
  onDateRangeChange: (key: DateRangeKey) => void;
  customRange?: CustomDateRange | null;
  onCustomRangeChange?: (range: CustomDateRange) => void;
  accounts?: AccountOption[];
  selectedAccounts?: string[];
  onAccountChange?: (keys: string[]) => void;
  showReset?: boolean;
  triggerSize?: 'compact' | 'header';
  /** Which edge the dropdown panels anchor to. Defaults to 'right' (top-right toolbars). */
  align?: 'left' | 'right';
  /** Preset keys to omit (e.g. ['all'] where a data source can't serve unbounded ranges). */
  hidePresets?: DateRangeKey[];
  /** Earliest selectable custom-range date (yyyy-mm-dd), e.g. an API lookback floor. */
  minDate?: string;
}

function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter(v => v !== value)
    : [...values, value];
}

function TinyAvatar({ label, accountKey, storefrontImage, logos }: { label: string; accountKey?: string; storefrontImage?: string; logos?: AccountOption['logos'] }) {
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

function DropdownAvatar({ label, accountKey, storefrontImage, logos }: { label: string; accountKey?: string; storefrontImage?: string; logos?: AccountOption['logos'] }) {
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

function getFilterLabel(baseLabel: string, selectedLabels: string[]): string {
  if (selectedLabels.length === 0) return baseLabel;
  if (selectedLabels.length === 1) return selectedLabels[0];
  return `${baseLabel} (${selectedLabels.length})`;
}

export function DashboardToolbar({
  dateRange,
  onDateRangeChange,
  customRange,
  onCustomRangeChange,
  accounts,
  selectedAccounts,
  onAccountChange,
  showReset = true,
  triggerSize = 'compact',
  align = 'right',
  hidePresets = [],
  minDate,
}: DashboardToolbarProps) {
  const panelAlign = align === 'left' ? 'left-0' : 'right-0';
  const [openPanel, setOpenPanel] = useState<'date' | 'account' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const defaultEnd = new Date();
  const defaultStart = new Date();
  defaultStart.setMonth(defaultStart.getMonth() - 1);
  const [startInput, setStartInput] = useState(toInputDate(customRange?.start ?? defaultStart));
  const [endInput, setEndInput] = useState(toInputDate(customRange?.end ?? defaultEnd));

  useEffect(() => {
    if (customRange) {
      setStartInput(toInputDate(customRange.start));
      setEndInput(toInputDate(customRange.end));
    }
  }, [customRange]);

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

  const showAccountFilter = Boolean(accounts && accounts.length > 0 && onAccountChange);
  const selectedKeys = selectedAccounts || [];
  const selectedAccountObjs = (accounts || []).filter(a => selectedKeys.includes(a.key));
  const hasSelectedAccounts = selectedKeys.length > 0;
  const triggerSizingClass = triggerSize === 'header'
    ? 'h-10 px-3 text-sm rounded-lg'
    : 'px-3 py-1.5 text-xs rounded-lg';

  const dateLabel =
    dateRange === 'custom' && customRange
      ? formatCustomRangeLabel(customRange.start, customRange.end)
      : getDateRangeLabel(dateRange);

  const standardPresets = DATE_RANGE_PRESETS.filter(
    p => p.key !== 'custom' && !hidePresets.includes(p.key),
  );

  const singleSelectedAccount = selectedAccountObjs.length === 1 ? selectedAccountObjs[0] : null;
  const accountTriggerLabel = getFilterLabel(
    'Sub-Account',
    selectedAccountObjs.map(a => a.label),
  );

  const accountIcon = singleSelectedAccount
    ? <TinyAvatar label={singleSelectedAccount.label} accountKey={singleSelectedAccount.key} storefrontImage={singleSelectedAccount.storefrontImage} logos={singleSelectedAccount.logos} />
    : <BuildingStorefrontIcon className="w-3.5 h-3.5" />;

  function handlePresetSelect(key: DateRangeKey) {
    onDateRangeChange(key);
    if (key !== 'custom') setOpenPanel(null);
  }

  function handleCustomApply() {
    const start = new Date(startInput + 'T00:00:00');
    const end = new Date(endInput + 'T23:59:59');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    if (start > end) return;
    onDateRangeChange('custom');
    onCustomRangeChange?.({ start, end });
    setOpenPanel(null);
  }

  function handleAccountToggle(key: string) {
    if (!onAccountChange) return;
    onAccountChange(toggleSelection(selectedKeys, key));
  }

  function clearAccounts() {
    onAccountChange?.([]);
  }

  return (
    <div ref={toolbarRef} className="flex items-center gap-2 flex-wrap">
      {/* Date Range */}
      <div className="relative">
        <button
          onClick={() => setOpenPanel(openPanel === 'date' ? null : 'date')}
          className={`flex items-center gap-1.5 border transition-colors ${triggerSizingClass} ${
            openPanel === 'date'
              ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
          }`}
        >
          <CalendarDaysIcon className="w-3.5 h-3.5" />
          <span className="max-w-[160px] truncate">{dateLabel}</span>
          <ChevronDownIcon className={`w-3 h-3 transition-transform ${openPanel === 'date' ? 'rotate-180' : ''}`} />
        </button>

        {openPanel === 'date' && (
          <div
            className={`absolute top-full ${panelAlign} mt-2 z-50 glass-dropdown shadow-lg animate-fade-in-up`}
            style={{ minWidth: '260px' }}
          >
            <div className="p-1.5">
              <p className="px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Date Range
              </p>
              {standardPresets.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset.key)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                    dateRange === preset.key
                      ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  {preset.label}
                  {dateRange === preset.key && <CheckIcon className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>

            <div className="border-t border-[var(--border)] p-3 space-y-2.5">
              <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Custom Range
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] text-[var(--muted-foreground)] mb-0.5">Start</label>
                  <input
                    type="date"
                    value={startInput}
                    min={minDate}
                    max={endInput}
                    onChange={e => setStartInput(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-[var(--muted-foreground)] mb-0.5">End</label>
                  <input
                    type="date"
                    value={endInput}
                    min={startInput}
                    max={toInputDate(new Date())}
                    onChange={e => setEndInput(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                  />
                </div>
              </div>
              <button
                onClick={handleCustomApply}
                disabled={!startInput || !endInput || startInput > endInput}
                className="w-full py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sub-Account */}
      {showAccountFilter && (
        <div className="relative">
          <button
            onClick={() => setOpenPanel(openPanel === 'account' ? null : 'account')}
            className={`flex items-center gap-1.5 border transition-colors ${triggerSizingClass} ${
              openPanel === 'account'
                ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
                : hasSelectedAccounts
                  ? 'border-[var(--primary)]/50 text-[var(--primary)] bg-[var(--primary)]/5'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
            }`}
          >
            {accountIcon}
            <span className="max-w-[140px] truncate">{accountTriggerLabel}</span>
            {hasSelectedAccounts ? (
              <XMarkIcon
                className="w-3 h-3 hover:text-[var(--foreground)]"
                onClick={(e) => { e.stopPropagation(); clearAccounts(); }}
              />
            ) : (
              <ChevronDownIcon className={`w-3 h-3 transition-transform ${openPanel === 'account' ? 'rotate-180' : ''}`} />
            )}
          </button>

          {openPanel === 'account' && accounts && (
            <div
              className={`absolute top-full ${panelAlign} mt-2 z-50 glass-dropdown shadow-lg animate-fade-in-up`}
              style={{ minWidth: '260px' }}
            >
              <div className="p-1.5">
                <p className="px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Filter by Sub-Account
                </p>
                <button
                  onClick={clearAccounts}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                    !hasSelectedAccounts
                      ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  All Sub-Accounts
                  {!hasSelectedAccounts && <CheckIcon className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="border-t border-[var(--border)] max-h-[280px] overflow-y-auto p-1.5">
                {accounts.map(account => {
                  const isSelected = selectedKeys.includes(account.key);
                  const location = [account.city, account.state].filter(Boolean).join(', ');
                  return (
                    <button
                      key={account.key}
                      onClick={() => handleAccountToggle(account.key)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                          : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                      }`}
                    >
                      <DropdownAvatar label={account.label} accountKey={account.key} storefrontImage={account.storefrontImage} logos={account.logos} />
                      <span className="flex-1 min-w-0 text-left">
                        <span className="block truncate">{account.label}</span>
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

      {/* Reset */}
      {showReset && (dateRange !== '6m' || hasSelectedAccounts) && (
        <button
          onClick={() => {
            onDateRangeChange('6m');
            clearAccounts();
            setOpenPanel(null);
          }}
          className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          title="Reset filters"
        >
          <FunnelIcon className="w-3 h-3" />
          Reset
        </button>
      )}
    </div>
  );
}
