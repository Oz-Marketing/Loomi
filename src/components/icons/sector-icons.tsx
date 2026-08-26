import type { ReactElement, SVGProps } from 'react';

/**
 * The three surface marks — Studio, Reporting, Projects.
 *
 * COLOUR IS FIXED, NOT THEMED. These deliberately do NOT follow `--primary`.
 * The point of a per-product mark is that you learn to recognise it by colour
 * without reading the label — the same reason Google Ads is blue and Analytics
 * is orange no matter what surface you meet them on. A mark that re-tints with
 * the user's accent can't do that job, and all three would collapse to one
 * colour anyway, which is exactly the state the switch was in with Heroicons.
 *
 * ONE SHARED PALETTE, PAIRED PER SURFACE. Each mark is built from a single hue
 * at three or four values. That the values come from one ramp per surface, and
 * the ramps from one family, is what makes them read as a set rather than three
 * icons that happen to sit together.
 *
 * GRAMMAR: flat fills only. No strokes, no gradients, no gloss, no filters —
 * two or three bold shapes with generous rounding. Everything survives 18px,
 * which is the size the sidebar actually renders them at, and there is nothing
 * here that costs more than a fill.
 */

const STUDIO = {
  base: '#8b5cf6',
  indigo: '#6366f1',
  light: '#a78bfa',
  deep: '#7c3aed',
} as const;

/** Green rather than the obvious analytics orange — at this construction the
 *  warm ramp read as a copy of the Google Analytics mark. */
const REPORTING = {
  dot: '#059669',
  mid: '#10b981',
  tall: '#34d399',
} as const;

const PROJECTS = {
  row: '#f97316',
  rowLight: '#fdba74',
  rowMid: '#fb923c',
  dot: '#c2410c',
} as const;

function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * A four-blade pinwheel.
 *
 * THE SHAPE. Each blade is a sail: out from the hub to a tip, then a long belly
 * curving back. What makes it spin is that the tip sits at ONE EDGE of the
 * blade's angular span rather than the middle — the body sweeps off behind it,
 * like folded paper. A blade whose tip is centred reads as a flower petal
 * instead, and four rotated bars read as a rotor; both were tried and neither
 * turns.
 *
 * THE ROUNDING. The other two marks are fully rounded stadiums, so sharp paper
 * points would break the family. Stroking each blade in its own fill colour
 * with a round linejoin rounds every corner at once, at a radius of
 * `GROW / 2` — so the sail is drawn at r=34 and finishes at r=42.
 *
 * These two pull against each other, and that is the whole tuning problem:
 * rounding softens the very tips that carry the rotation. This sits
 * deliberately near the soft end of that trade — it reads as a pinwheel rather
 * than shouting it, and sits with the bars and rows instead of competing with
 * them. Raising `GROW` blobs the blades together; dropping it sharpens the spin.
 */
const BLADE = 'M48 48Q53.63 37.4 72.04 23.96Q85.98 49.33 48 48Z';
const GROW = 16;

export function StudioSectorIcon(props: SVGProps<SVGSVGElement>) {
  const blades: [number, string][] = [
    [0, STUDIO.base],
    [90, STUDIO.indigo],
    [180, STUDIO.light],
    [270, STUDIO.deep],
  ];
  return (
    <Glyph {...props}>
      {blades.map(([rot, fill]) => (
        <path
          key={rot}
          d={BLADE}
          fill={fill}
          stroke={fill}
          strokeWidth={GROW}
          strokeLinejoin="round"
          strokeLinecap="round"
          transform={`rotate(${rot} 48 48)`}
        />
      ))}
    </Glyph>
  );
}

/**
 * A dot and two ascending stadiums, lightening as they rise. The dot is what
 * stops it reading as a generic bar chart — three bars is a chart, a dot and
 * two bars is a mark.
 */
export function ReportingSectorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="21" cy="73" r="11" fill={REPORTING.dot} />
      <rect x="37" y="40" width="22" height="44" rx="11" fill={REPORTING.mid} />
      <rect x="65" y="10" width="22" height="74" rx="11" fill={REPORTING.tall} />
    </Glyph>
  );
}

/**
 * Stacked stadiums of unequal length — a list of work — with the live item
 * called out as a dot. The unequal lengths are what stop it reading as a
 * hamburger menu.
 */
export function ProjectsSectorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <rect x="10" y="16" width="76" height="20" rx="10" fill={PROJECTS.row} />
      <rect x="10" y="44" width="50" height="20" rx="10" fill={PROJECTS.rowLight} />
      <rect x="10" y="72" width="62" height="20" rx="10" fill={PROJECTS.rowMid} />
      <circle cx="74" cy="54" r="12" fill={PROJECTS.dot} />
    </Glyph>
  );
}

/** Keyed by the `Surface` union in `surface-switch.tsx` — Projects is `app`. */
export const SECTOR_ICONS: Record<
  'studio' | 'reporting' | 'app',
  (props: SVGProps<SVGSVGElement>) => ReactElement
> = {
  studio: StudioSectorIcon,
  reporting: ReportingSectorIcon,
  app: ProjectsSectorIcon,
};
