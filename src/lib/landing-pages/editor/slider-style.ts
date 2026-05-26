/**
 * Shared Tailwind class for range inputs across the LP editor.
 *
 * Mirrors the exact styling the forms / email template editors use:
 *   - 1px track in var(--border)
 *   - 14×14 thumb filled with var(--primary), card-colored ring, soft
 *     shadow, grab/grabbing cursor on press
 *
 * Browser default range inputs render with the OS accent color
 * (which on macOS happens to be a hot pink) — this overrides that
 * so the LP editor reads as a Loomi surface, not a system one.
 */
export const SLIDER_CLASS =
  'h-1 cursor-pointer appearance-none rounded-full bg-[var(--border)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--card)] [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--primary)] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--card)] [&::-moz-range-thumb]:cursor-grab';
