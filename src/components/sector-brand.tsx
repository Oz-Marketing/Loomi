import { SECTOR_ICONS } from '@/components/icons/sector-icons';

/**
 * The emblem at the top of each surface's sidebar: the sector's own mark, plus
 * the wordmark naming it.
 *
 * This replaces three different things that had drifted apart — Studio showed
 * the `loomi studio` lockup PNG, Projects showed the bare `loomi` wordmark PNG
 * with no sector name at all, and Reporting rendered `loomi reporting` as live
 * text. One component now serves all three, so the surfaces are finally
 * branded the same way as each other.
 *
 * THE FACE IS QUICKSAND, not the interface font. The wordmark is brand, so it
 * should not change shape when someone picks a different typeface in the
 * Appearance tab — which is exactly what would happen if it inherited
 * `--font-sans`. Quicksand is loaded in ./lib/appearance/fonts.ts alongside the
 * pickable faces but kept out of the picker's catalog.
 *
 * THE TEXT STAYS MONOCHROME. Tinting the sector word to match its mark is
 * tempting and reads well on the dark canvas, but the green and orange both
 * fall under 3:1 against the light theme's near-white, which is not a contrast
 * ratio to hand a word people need to read. The mark carries the colour; the
 * word carries the name.
 */
const LABELS: Record<Surface, string> = {
  studio: 'studio',
  reporting: 'reporting',
  app: 'projects',
};

export type Surface = 'studio' | 'reporting' | 'app';

export function SectorBrand({ surface, className = '' }: { surface: Surface; className?: string }) {
  const Icon = SECTOR_ICONS[surface];
  return (
    <span className={`flex items-center gap-2 min-w-0 ${className}`}>
      <Icon className="h-7 w-7 flex-shrink-0" />
      <span
        className="truncate text-[1.0625rem] font-semibold tracking-tight"
        style={{ fontFamily: 'var(--font-quicksand), var(--font-sans, system-ui), sans-serif' }}
      >
        loomi <span className="text-[var(--sidebar-muted-foreground)]">{LABELS[surface]}</span>
      </span>
    </span>
  );
}
