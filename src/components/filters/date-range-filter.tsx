'use client';

import { useState, useRef, useEffect } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import {
  DATE_RANGE_PRESETS,
  type DateRangeKey,
  formatCustomRangeLabel,
} from '@/lib/date-ranges';

export interface CustomDateRange {
  start: Date;
  end: Date;
}

interface DateRangeFilterProps {
  value: DateRangeKey;
  onChange: (key: DateRangeKey) => void;
  /** Called when a custom range is picked */
  onCustomChange?: (range: CustomDateRange) => void;
  /** Current custom range (for display when value === 'custom') */
  customRange?: CustomDateRange | null;
}

function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function DateRangeFilter({
  value,
  onChange,
  onCustomChange,
  customRange,
}: DateRangeFilterProps) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Default start/end for the date inputs
  const defaultEnd = new Date();
  const defaultStart = new Date();
  defaultStart.setMonth(defaultStart.getMonth() - 1);

  const [startInput, setStartInput] = useState(
    toInputDate(customRange?.start ?? defaultStart),
  );
  const [endInput, setEndInput] = useState(
    toInputDate(customRange?.end ?? defaultEnd),
  );

  // Sync inputs when customRange prop changes externally
  useEffect(() => {
    if (customRange) {
      setStartInput(toInputDate(customRange.start));
      setEndInput(toInputDate(customRange.end));
    }
  }, [customRange]);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showPicker]);

  function handlePresetClick(key: DateRangeKey) {
    if (key === 'custom') {
      setShowPicker(prev => !prev);
      // If not already custom, switch to custom mode
      if (value !== 'custom') {
        onChange('custom');
        // Apply defaults immediately so dashboard filters
        if (onCustomChange) {
          onCustomChange({
            start: new Date(startInput + 'T00:00:00'),
            end: new Date(endInput + 'T23:59:59'),
          });
        }
      }
    } else {
      setShowPicker(false);
      onChange(key);
    }
  }

  function handleApply() {
    const start = new Date(startInput + 'T00:00:00');
    const end = new Date(endInput + 'T23:59:59');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    if (start > end) return; // invalid range
    onChange('custom');
    onCustomChange?.({ start, end });
    setShowPicker(false);
  }

  // Presets without 'custom' — we render it separately
  const standardPresets = DATE_RANGE_PRESETS.filter(p => p.key !== 'custom');

  return (
    <div className="relative flex items-center gap-1.5 flex-wrap">
      <CalendarDaysIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />

      {/* Standard preset pills */}
      {standardPresets.map(preset => (
        <button
          key={preset.key}
          onClick={() => handlePresetClick(preset.key)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            value === preset.key
              ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
          }`}
        >
          <span className="hidden sm:inline">{preset.label}</span>
          <span className="sm:hidden">{preset.shortLabel}</span>
        </button>
      ))}

      {/* Custom pill */}
      <button
        onClick={() => handlePresetClick('custom')}
        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
          value === 'custom'
            ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5'
            : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
        }`}
      >
        <span className="hidden sm:inline">
          {value === 'custom' && customRange
            ? formatCustomRangeLabel(customRange.start, customRange.end)
            : 'Custom'}
        </span>
        <span className="sm:hidden">
          {value === 'custom' && customRange ? 'Custom ✓' : 'Custom'}
        </span>
      </button>

      {/* Date picker dropdown */}
      {showPicker && (
        <div
          ref={pickerRef}
          className="absolute top-full left-0 mt-2 z-50 glass-dropdown p-4 shadow-lg animate-fade-in-up"
          style={{ minWidth: '280px' }}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startInput}
                max={endInput}
                onChange={e => setStartInput(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endInput}
                min={startInput}
                max={toInputDate(new Date())}
                onChange={e => setEndInput(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </div>
            <button
              onClick={handleApply}
              disabled={!startInput || !endInput || startInput > endInput}
              className="w-full py-2 px-4 text-xs font-medium rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
