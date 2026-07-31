import type { TemplateDoc } from '../doc-types';

/**
 * Template resolution for autonomous generation.
 *
 * DETERMINISM IS A CORRECTNESS REQUIREMENT HERE, not a preference. The generate
 * job is made idempotent by `@@unique([accountKey, templateId, offerFingerprint])`
 * on AdCreative — a re-run updates the existing draft. If resolution were random
 * or rotated on each call, a retry would pick a different templateId, miss the
 * constraint, and create a duplicate draft. So: same inputs ⇒ same template,
 * always. Any future "rotate templates" feature must be a pure function of
 * (sub-account, period), never of a clock or a shuffle.
 *
 * Precedence, first match wins:
 *   1. An explicit pin for the period the ad runs in.
 *   2. A template whose own publish window covers the run date — this is how
 *      seasonal creative takes over and then stops, with no config change. It
 *      reuses `TemplateDoc.schedule`, which already existed for the library.
 *   3. The sub-account's mapped default for this offer type.
 *   4. Its mapped default for all offer types.
 *   5. A make-matched published template (the brand fallback).
 *   6. Nothing — skip and log. Never guess: rendering an offer through an
 *      unintended template is worse than producing no ad.
 *
 * Pure — the caller supplies the candidate rows.
 */

export interface TemplateCandidate {
  id: string;
  name: string;
  /** null = global/shared, set = owned by that sub-account. */
  accountKey: string | null;
  /** Parsed doc; `schedule` and `make` are read from it. */
  doc: TemplateDoc;
  updatedAt: Date;
}

export interface TemplateResolutionInput {
  /** Published + active docs in scope for this sub-account. */
  candidates: TemplateCandidate[];
  accountKey: string;
  offerType: string;
  make: string;
  /** First day the ad runs — schedule windows are evaluated against THIS, not today. */
  runDate: Date;
  /** JSON-parsed `templateMap`: offerType (or `all`) → template id. */
  templateMap?: Record<string, string>;
  /** Explicit pin for this period, keyed by `yyyy-MM` of the run date. */
  monthlyPins?: Record<string, string>;
}

export type TemplateResolutionReason =
  | 'monthly_pin'
  | 'schedule_window'
  | 'offer_type_default'
  | 'all_types_default'
  | 'brand_fallback'
  | 'none';

export interface TemplateResolution {
  template: TemplateCandidate | null;
  reason: TemplateResolutionReason;
  /** Plain-language explanation for the run log and the review queue. */
  explanation: string;
}

/** `yyyy-MM` for a date, in UTC. */
export function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Does the doc's publish window contain `date`? Absent bounds are open-ended. */
export function scheduleCovers(doc: TemplateDoc, date: Date): boolean {
  const s = doc.schedule;
  if (!s) return false; // no window = not a scheduled template, so rule 2 skips it
  const day = date.toISOString().slice(0, 10);
  if (s.start && day < s.start) return false;
  if (s.end && day > s.end) return false;
  // A window with neither bound set isn't a real window.
  return Boolean(s.start || s.end);
}

/**
 * Break ties deterministically. Sub-account-owned templates beat globals (a
 * dealer's own plate wins over a shared one); then newest-updated; then id, which
 * guarantees a total order even if two rows share a timestamp — without that last
 * key the sort is unstable and idempotency is not actually guaranteed.
 */
function preferenceSort(accountKey: string) {
  return (a: TemplateCandidate, b: TemplateCandidate): number => {
    const own = (c: TemplateCandidate) => (c.accountKey === accountKey ? 0 : 1);
    if (own(a) !== own(b)) return own(a) - own(b);
    const t = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  };
}

export function resolveAutomationTemplate({
  candidates,
  accountKey,
  offerType,
  make,
  runDate,
  templateMap,
  monthlyPins,
}: TemplateResolutionInput): TemplateResolution {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const sorted = [...candidates].sort(preferenceSort(accountKey));

  // 1. Explicit pin for the run period.
  const pinned = monthlyPins?.[periodKey(runDate)];
  if (pinned) {
    const t = byId.get(pinned);
    if (t) {
      return {
        template: t,
        reason: 'monthly_pin',
        explanation: `Pinned to "${t.name}" for ${periodKey(runDate)}.`,
      };
    }
    // A pin naming a template that no longer exists must not silently fall
    // through as though nothing was pinned — the intent was explicit.
    return {
      template: null,
      reason: 'none',
      explanation: `Pinned template ${pinned} for ${periodKey(
        runDate,
      )} is no longer available — refusing to substitute a different design.`,
    };
  }

  // 2. Seasonal: a template whose own publish window covers the run date.
  const scheduled = sorted.filter((c) => scheduleCovers(c.doc, runDate));
  if (scheduled.length) {
    const t = scheduled[0];
    const s = t.doc.schedule!;
    return {
      template: t,
      reason: 'schedule_window',
      explanation: `"${t.name}" is scheduled for ${s.start ?? 'any time'} → ${s.end ?? 'open'}, which covers ${runDate
        .toISOString()
        .slice(0, 10)}.`,
    };
  }

  // 3 / 4. Mapped defaults — offer-type specific first, then the catch-all.
  for (const [key, reason] of [
    [offerType, 'offer_type_default'],
    ['all', 'all_types_default'],
  ] as const) {
    const mapped = templateMap?.[key];
    if (!mapped) continue;
    const t = byId.get(mapped);
    if (t) {
      return {
        template: t,
        reason,
        explanation:
          reason === 'offer_type_default'
            ? `"${t.name}" is this sub-account's default for ${offerType} offers.`
            : `"${t.name}" is this sub-account's default for all offer types.`,
      };
    }
  }

  // 5. Brand fallback: a published template built for this make.
  const m = make.trim().toLowerCase();
  const brand = m ? sorted.filter((c) => (c.doc.make ?? '').trim().toLowerCase() === m) : [];
  if (brand.length) {
    return {
      template: brand[0],
      reason: 'brand_fallback',
      explanation: `"${brand[0].name}" is the newest published ${make} template — no explicit mapping is set.`,
    };
  }

  // 6. Refuse.
  return {
    template: null,
    reason: 'none',
    explanation: candidates.length
      ? `No template is mapped for ${offerType} and none is built for ${make || 'this make'}. Map one in the automation config.`
      : 'No published templates are in scope for this sub-account.',
  };
}
