/**
 * The one chart theme for Reporting — palette, surfaces, and the Apex option
 * fragments every chart shares.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Grid colour, foreground colour, tooltip theme, and the series palette used to
 * be redeclared in every chart wrapper (four in ads/shared.tsx, six in
 * dealer-charts.tsx). They had drifted into TWO DIFFERENT PALETTES, and the ads
 * one was unreadable: validated against the light and dark chart surfaces it
 * failed the lightness band, failed CVD separation (#a78bfa vs #38bdf8 at ΔE
 * 5.2 deuteranopia — below even the conditional floor), and put five of its six
 * hues under 3:1 contrast. Anyone with red-green colour blindness could not read
 * a spend donut. The dealer-charts palette passed everything, so it won.
 *
 * ── THE PALETTE IS FOUR HUES. THIS IS A CEILING, NOT AN OVERSIGHT ───────────
 * Re-validated at `--pairs all` (the donut case, where every slice is on screen
 * at once) against both surfaces. Four passes. Every fifth hue tried collides
 * with one already in the set under normal vision, before colour blindness is
 * even considered:
 *
 *   + #0891b2 cyan   → ΔE 11.8 vs #059669 emerald   (normal vision, floor 15)
 *   + #9333ea purple → ΔE 11.4 vs #6366f1 indigo    (normal vision, floor 15)
 *   + #64748b slate  → reads gray; ΔE 2.5 vs #ec4899 under protanopia
 *
 * So a fifth CATEGORY does not get a fifth hue — it folds into "Other" with
 * `foldToPalette()`. Gray is correct there precisely because it reads as absence
 * of category rather than as another one.
 *
 * Order is fixed and assigned BY ENTITY, never by rank: a filter that drops a
 * series must not repaint the survivors. Emerald and amber are the weakest pair
 * under protanopia, so indigo sits between them.
 *
 * ── SECONDARY ENCODING IS REQUIRED, NOT OPTIONAL ────────────────────────────
 * The worst surviving pair (#ec4899 vs #059669) sits at ΔE 7.6 deuteranopia —
 * inside the 6–8 band that is legal ONLY when something other than hue also
 * separates the marks. That is why `baseChartOptions` forces a legend for two or
 * more series and why `SURFACE_GAP` puts a 2px surface-coloured gap between
 * adjacent fills. Do not turn either off to "clean up" a chart.
 *
 * Re-run the validator before changing any hue:
 *   node scripts/validate_palette.js "<hex,…>" --mode dark  --surface "#12101a" --pairs all
 *   node scripts/validate_palette.js "<hex,…>" --mode light --surface "#fafafb" --pairs all
 */
import type { ApexOptions } from 'apexcharts';

/**
 * Fixed categorical order. Assign by entity, never by rank.
 * Validated all-pairs, both themes. See the header before touching a hue.
 */
export const SERIES_COLORS = ['#059669', '#6366f1', '#d97706', '#ec4899'] as const;

/** The fold-in bucket. Deliberately low-chroma: "Other" is not a category. */
export const OTHER_COLOR = '#71717a';

/** How many real categories a chart may colour before folding into "Other". */
export const MAX_SERIES = SERIES_COLORS.length;

/**
 * Composited colour of the chart surface — `--card` flattened over
 * `--gradient-bg`, which is what a chart is actually drawn on. The validator
 * needs a real colour, and a translucent token is not one.
 */
export const CHART_SURFACE = { dark: '#12101a', light: '#fafafb' } as const;

export const chartSurface = (isDark: boolean) =>
  isDark ? CHART_SURFACE.dark : CHART_SURFACE.light;

/** Recessive grid — present enough to read a value against, never competing. */
export const gridColor = (isDark: boolean) =>
  isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

/** Axis + label ink. Text wears text tokens, never a series colour. */
export const chartFg = (isDark: boolean) => (isDark ? '#9ca3af' : '#525252');

/** 2px surface gap between adjacent fills / overlapping marks. */
export const surfaceGap = (isDark: boolean) => chartSurface(isDark);

/**
 * Collapse a ranked list to the four palette slots plus "Other".
 *
 * Callers pass entity totals; anything past the fourth is summed into a single
 * gray bucket. Returns colours alongside the items so a caller never has to
 * index the palette itself (which is how rank-coloured charts get written).
 *
 * Items are NOT sorted here — the caller's order is the entity order, and
 * re-sorting is exactly the "colour follows rank" bug.
 */
export function foldToPalette<T extends { label: string; value: number }>(
  items: T[],
  otherLabel = 'Other',
): { label: string; value: number; color: string }[] {
  const kept = items.slice(0, MAX_SERIES).map((it, i) => ({
    label: it.label,
    value: it.value,
    color: SERIES_COLORS[i],
  }));
  const rest = items.slice(MAX_SERIES);
  if (rest.length === 0) return kept;
  return [
    ...kept,
    {
      label: rest.length === 1 ? rest[0].label : `${otherLabel} (${rest.length})`,
      value: rest.reduce((sum, it) => sum + it.value, 0),
      color: OTHER_COLOR,
    },
  ];
}

/**
 * The options every Reporting chart starts from. Spread it first, then override
 * only what the form needs:
 *
 *   const options = { ...baseChartOptions({ isDark, seriesCount: 2 }), xaxis: {…} }
 *
 * `seriesCount` drives the legend: a lone series needs no legend box (the
 * section title names it), two or more always get one — identity is never
 * carried by colour alone.
 */
export function baseChartOptions({
  isDark,
  seriesCount = 1,
  type = 'line',
}: {
  isDark: boolean;
  seriesCount?: number;
  type?: 'line' | 'bar' | 'area' | 'donut';
}): ApexOptions {
  return {
    chart: {
      type,
      toolbar: { show: false },
      zoom: { enabled: false },
      foreColor: chartFg(isDark),
      animations: { enabled: true, speed: 250 },
      fontFamily: 'inherit',
    },
    colors: [...SERIES_COLORS],
    dataLabels: { enabled: false },
    legend: {
      show: seriesCount > 1,
      position: 'top',
      horizontalAlign: 'left',
      markers: { size: 7 },
      fontSize: '12px',
    },
    grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
    tooltip: { theme: isDark ? 'dark' : 'light', shared: seriesCount > 1, intersect: false },
    states: { hover: { filter: { type: 'lighten' } } },
  };
}
