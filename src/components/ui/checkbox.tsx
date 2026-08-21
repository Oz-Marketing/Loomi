'use client';

import { CheckIcon, MinusIcon } from '@heroicons/react/24/outline';

const SIZES = {
  sm: { box: 'h-3.5 w-3.5 rounded-[4px]', icon: 'h-2.5 w-2.5', text: 'text-[11px]' },
  md: { box: 'h-4 w-4 rounded-[5px]', icon: 'h-3 w-3', text: 'text-xs' },
  lg: { box: 'h-5 w-5 rounded-md', icon: 'h-3.5 w-3.5', text: 'text-sm' },
} as const;

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Renders the dash state — "some but not all of the children are on". */
  indeterminate?: boolean;
  size?: keyof typeof SIZES;
  /** Text to the right of the box. Omit for a bare box (table cells). */
  label?: React.ReactNode;
  /** Required when there's no `label`, so the box still announces itself. */
  'aria-label'?: string;
  /** Merged onto the wrapping <label>. */
  className?: string;
  /**
   * Keep the click from reaching a clickable ancestor — a table row that
   * toggles on click would otherwise fire twice and cancel itself out.
   */
  stopPropagation?: boolean;
}

/**
 * Loomi's checkbox — use this instead of a bare `<input type="checkbox">`,
 * which paints an OS control (blue on macOS, square corners, its own focus
 * ring) that ignores the app's theme entirely.
 *
 * The real input is still here, just visually hidden: that keeps the native
 * keyboard behaviour, the `:focus-visible` ring and the screen-reader role for
 * free, and the styled box is driven off it with `peer-*`. Rendering a
 * `<button role="checkbox">` instead would mean reimplementing all three.
 */
export function Checkbox({
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  size = 'md',
  label,
  'aria-label': ariaLabel,
  className = '',
  stopPropagation = false,
}: CheckboxProps) {
  const s = SIZES[size];

  return (
    <label
      className={`inline-flex items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`${s.box} mt-px flex flex-shrink-0 items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)]/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--background)] ${
          checked || indeterminate
            ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
            : 'border-[var(--border)] bg-[var(--input)] text-transparent'
        }`}
      >
        {indeterminate ? (
          <MinusIcon className={`${s.icon} stroke-[3]`} />
        ) : (
          checked && <CheckIcon className={`${s.icon} stroke-[3]`} />
        )}
      </span>
      {/* No colour of its own — it inherits, so a caller can tint the whole
          control (a muted filter pill, say) from the wrapper's className. */}
      {label !== undefined && <span className={s.text}>{label}</span>}
    </label>
  );
}
