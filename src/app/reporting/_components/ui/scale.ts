/**
 * The Reporting type + spacing scale.
 *
 * These pages are read on a dealership screen, often shared over a call, and
 * the old markup leaned on `text-[10px]` / `text-[11px]` for labels and table
 * data throughout. That is below what most people read comfortably at arm's
 * length from a monitor across a desk, and it is what made the reports feel
 * cramped next to the reference dashboards.
 *
 * Floor is 12px for anything carrying data. 11px survives only for
 * all-caps eyebrow labels, where the letterforms are larger than the point size
 * suggests and the text is a category name rather than a value.
 *
 * Exported as constants rather than left inline so the scale is one edit, and
 * so a reviewer can see the whole scale at once instead of inferring it from
 * forty class strings.
 */

/** Small-caps section/field label above a value. */
export const LABEL = 'text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]';

/** Body copy inside a card — helper text, empty-section notes. */
export const BODY = 'text-[13px] text-[var(--muted-foreground)]';

/** Table cells and other dense tabular data. */
export const DATA = 'text-[13px] tabular-nums';

/** Table column headers. */
export const TH = 'text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]';

/** Card / section heading. */
export const HEADING = 'text-sm font-semibold text-[var(--foreground)]';

/** The headline figure on a stat tile. */
export const FIGURE = 'text-2xl font-semibold tabular-nums tracking-tight';

/** Supporting figure under a headline. */
export const SUBFIGURE = 'text-xs tabular-nums text-[var(--muted-foreground)]';

/**
 * One radius and one padding step per surface role, so cards stop mixing
 * rounded-xl/rounded-2xl and p-4/p-5 across neighbouring components.
 */
export const CARD = 'rounded-2xl border border-[var(--border)] p-5';
export const TILE = 'rounded-xl border border-[var(--border)] p-4';
