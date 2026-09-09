/**
 * Why a generate run passed a vehicle over.
 *
 * Client-safe (no prisma, no Node) so the run-history UI can label a reason with
 * the same vocabulary the generator records it with.
 *
 * Each reason gets a short label for a badge and a `fix` line saying where to go
 * next — a run that reports "1 skipped" and nothing else is indistinguishable
 * from a broken pipeline, which is exactly the dead end this exists to avoid.
 */

export type SkipReason =
  | 'stock_gate'
  | 'no_eligible_offer'
  | 'no_template'
  /** EVOX has no licensed imagery for the model, and dealer photos are never
   *  used. Reported separately from `preflight_failed` because it's the one skip
   *  reason with a purely commercial fix — extending EVOX coverage — rather than
   *  anything to change in the data or the template. */
  | 'no_vehicle_imagery'
  /** A required OEM sales-event mark has no element to render into. */
  | 'no_event_slot'
  | 'preflight_failed'
  | 'render_failed'
  | 'cap_reached'
  /** A two-offer template, and the vehicle only has one usable offer this cycle.
   *  Per-template by nature: the single-offer designs for the same vehicle are
   *  unaffected and still generate. */
  | 'dual_needs_second_offer'
  /** A two-offer template built for two different models. Automation groups work
   *  per vehicle, so it cannot fill one; it stays a manual build. */
  | 'dual_two_model_unsupported';

export interface SkippedVehicle {
  vehicle: string;
  reason: SkipReason;
  detail: string;
  /**
   * The design that couldn't be built, when the skip belongs to one template
   * rather than the whole vehicle.
   *
   * Under the offer fan-out most skips are per-variant: a vehicle can produce
   * five designs and fail the sixth. Without this the run log says "1 skipped"
   * and a reader cannot tell whether the vehicle produced nothing at all or
   * nearly everything. Absent = the whole vehicle was passed over.
   */
  templateName?: string;
  /** The offer the variant would have advertised, when the skip is offer-specific. */
  offerSummary?: string;
}

export const SKIP_REASON: Record<SkipReason, { label: string; fix: string }> = {
  stock_gate: {
    label: 'Not enough stock',
    fix: 'Sync inventory, or lower Min stock in Settings.',
  },
  no_eligible_offer: {
    label: 'No usable offer',
    fix: 'The manufacturer has nothing valid for the run window yet — check Plan for in Settings.',
  },
  no_template: {
    label: 'No template',
    fix: 'Publish a design in Templates, and check it is in scope for this account.',
  },
  no_vehicle_imagery: {
    label: 'No vehicle image',
    fix: 'EVOX has no licensed image for this model. Nothing to fix in the template.',
  },
  no_event_slot: {
    label: 'Nowhere for the event mark',
    fix: 'Add an image element bound to the sales-event mark to the template.',
  },
  preflight_failed: {
    label: 'Template check failed',
    fix: 'The template is missing something the ad needs — the detail names it.',
  },
  render_failed: {
    label: 'Render failed',
    fix: 'The design threw while rendering. The detail carries the error.',
  },
  cap_reached: {
    label: 'Run cap reached',
    fix: 'Raise Max vehicles per run in Settings to take more in one go.',
  },
  dual_needs_second_offer: {
    label: 'Needs a second offer',
    fix: 'This design shows two offers and the manufacturer only has one live for this vehicle. Nothing to fix — the other designs still ran.',
  },
  dual_two_model_unsupported: {
    label: 'Two-model design',
    fix: 'Designs comparing two different vehicles are built by hand. Automation fills two-offer designs only when both offers are for the same model.',
  },
};

/** A reason recorded by an older/newer build still reads as something. */
export function skipReasonLabel(reason: string): string {
  return SKIP_REASON[reason as SkipReason]?.label ?? reason.replace(/_/g, ' ');
}

export function skipReasonFix(reason: string): string | null {
  return SKIP_REASON[reason as SkipReason]?.fix ?? null;
}

/** Group skips by reason, most common first — for a one-line "why nothing ran". */
export function summarizeSkips(skips: { reason: string }[]): string {
  if (!skips.length) return '';
  const counts = new Map<string, number>();
  for (const s of skips) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => (n > 1 ? `${skipReasonLabel(reason)} (${n})` : skipReasonLabel(reason)))
    .join(', ');
}
