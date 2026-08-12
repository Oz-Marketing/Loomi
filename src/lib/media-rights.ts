/**
 * Rights management for media assets — Phase 3 of docs/asset-management.md (§6).
 *
 * Pure: no Prisma, no React, no clock of its own. `now` is always passed in, so
 * the sweep, the API and the UI can all be tested against a fixed date and can
 * never disagree about what "expiring soon" means.
 *
 * The central rule is §3's: an asset expires on whichever comes FIRST of its
 * licence end and its effective (offer/campaign) end, and which one fired has to
 * be recorded. Those two dates answer different questions — "may we still use
 * this image" versus "is the deal it advertises still live" — and an asset
 * routinely outlives one but not the other.
 */

// ── Vocabularies ──

export const LICENSE_TYPES = [
  { value: 'oem-licensed', label: 'OEM-licensed' },
  { value: 'royalty-free', label: 'Royalty-free stock' },
  { value: 'rights-managed', label: 'Rights-managed stock' },
  { value: 'talent-release', label: 'Talent release' },
  { value: 'user-generated', label: 'User-generated' },
  { value: 'owned', label: 'Owned outright' },
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number]['value'];

export function licenseTypeLabel(value?: string | null): string | null {
  if (!value) return null;
  return LICENSE_TYPES.find((t) => t.value === value)?.label ?? null;
}

export function isLicenseType(value: unknown): value is LicenseType {
  return typeof value === 'string' && LICENSE_TYPES.some((t) => t.value === value);
}

export const USAGE_SCOPES = [
  { value: 'digital', label: 'Digital advertising' },
  { value: 'social', label: 'Social' },
  { value: 'print', label: 'Print' },
  { value: 'ooh', label: 'Out of home' },
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'email', label: 'Email' },
] as const;

export function usageScopeLabel(value: string): string {
  return USAGE_SCOPES.find((u) => u.value === value)?.label ?? value;
}

export function isUsageScope(value: unknown): boolean {
  return typeof value === 'string' && USAGE_SCOPES.some((u) => u.value === value);
}

// ── Windows ──

/**
 * How far ahead the first warning fires, and how long an expired asset stays in
 * grace before it is treated as fully lapsed.
 *
 * §6.2 specifies 30 days, then 7, then expiry, then a 14-day grace. The grace
 * exists so a renewal that is genuinely in progress doesn't cause a scramble —
 * the asset is flagged the whole time, it just isn't treated as dead yet.
 */
export const RIGHTS_WARN_DAYS = [30, 7] as const;
export const RIGHTS_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` until `date`. Negative once the date has passed. */
export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

// ── Status ──

/**
 * `unknown` is a first-class state, not a synonym for `active`.
 *
 * An asset with no licence recorded is exactly the thing this phase exists to
 * surface: on a library mid-migration it is most of them, and showing it as
 * "active" would quietly assert a clearance nobody has checked.
 */
export type RightsStatus =
  | 'unknown'
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'lapsed';

/** Which date drove the outcome. Mirrors `MediaAsset.expirationReason`. */
export type ExpirationReason = 'license' | 'effective' | 'manual';

export interface RightsInput {
  licenseExpiresAt?: Date | string | null;
  expiresAt?: Date | string | null;
  /** Set once the sweep has retired it, or by a manual expiry. */
  expiredAt?: Date | string | null;
  expirationReason?: string | null;
}

export interface RightsAssessment {
  status: RightsStatus;
  /** The date that governs — the earlier of the two, when both are present. */
  effectiveDate: Date | null;
  reason: ExpirationReason | null;
  /** Whole days until `effectiveDate`; negative once passed. Null when unknown. */
  daysRemaining: number | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The governing expiry: whichever of the licence and effective dates comes
 * first, with the reason that produced it.
 *
 * A tie resolves to `license`, deliberately — if both end the same day, the
 * licence is the constraint worth reporting, because an ended campaign is an
 * operational fact while a lapsed licence is a legal one.
 */
export function governingExpiry(input: RightsInput): { date: Date | null; reason: ExpirationReason | null } {
  const license = toDate(input.licenseExpiresAt);
  const effective = toDate(input.expiresAt);

  if (license && effective) {
    return license.getTime() <= effective.getTime()
      ? { date: license, reason: 'license' }
      : { date: effective, reason: 'effective' };
  }
  if (license) return { date: license, reason: 'license' };
  if (effective) return { date: effective, reason: 'effective' };
  return { date: null, reason: null };
}

/**
 * Assess an asset's rights position at `now`.
 *
 * A manual expiry wins over the dates: someone pulled it deliberately, and a
 * licence that happens to run another month doesn't undo that.
 */
export function assessRights(input: RightsInput, now: Date): RightsAssessment {
  const { date, reason } = governingExpiry(input);
  const expiredAt = toDate(input.expiredAt);

  // Manually expired, or expired with no dates to explain it.
  if (expiredAt && (input.expirationReason === 'manual' || !date)) {
    const daysSince = -daysUntil(expiredAt, now);
    return {
      status: daysSince > RIGHTS_GRACE_DAYS ? 'lapsed' : 'expired',
      effectiveDate: date,
      reason: 'manual',
      daysRemaining: date ? daysUntil(date, now) : null,
    };
  }

  if (!date) {
    return { status: 'unknown', effectiveDate: null, reason: null, daysRemaining: null };
  }

  const remaining = daysUntil(date, now);

  if (remaining > RIGHTS_WARN_DAYS[0]) {
    return { status: 'active', effectiveDate: date, reason, daysRemaining: remaining };
  }
  if (remaining > 0) {
    return { status: 'expiring_soon', effectiveDate: date, reason, daysRemaining: remaining };
  }
  // remaining <= 0 — the date has passed.
  return {
    status: -remaining > RIGHTS_GRACE_DAYS ? 'lapsed' : 'expired',
    effectiveDate: date,
    reason,
    daysRemaining: remaining,
  };
}

export const RIGHTS_STATUS_LABELS: Record<RightsStatus, string> = {
  unknown: 'No licence recorded',
  active: 'Licensed',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  lapsed: 'Lapsed',
};

/**
 * Short badge text — the version that fits on an asset card.
 *
 * Deliberately says how long is left rather than the status word alone: "12
 * days" prompts a renewal, "Expiring soon" gets ignored for a fortnight.
 */
export function rightsBadgeLabel(a: RightsAssessment): string | null {
  switch (a.status) {
    case 'expiring_soon':
      return a.daysRemaining === 1 ? '1 day left' : `${a.daysRemaining} days left`;
    case 'expired':
      return 'Expired';
    case 'lapsed':
      return 'Lapsed';
    default:
      // 'active' and 'unknown' don't earn a badge: one is fine and the other is
      // the default state of every untouched asset, so badging it would put a
      // warning on the entire library.
      return null;
  }
}

/**
 * The tightest warning threshold `days` has crossed, or null if it's crossed none.
 *
 * RIGHTS_WARN_DAYS is ordered widest-first, so the LAST match is the tightest:
 * 5 days remaining has crossed both 30 and 7, and the one worth reporting is 7.
 */
function warnBand(days: number): number | null {
  let band: number | null = null;
  for (const threshold of RIGHTS_WARN_DAYS) {
    if (days <= threshold) band = threshold;
  }
  return band;
}

/**
 * Which advance warning is due, or null when none is.
 *
 * Returns the threshold crossed (30 or 7) so the sweep can report it. The dedupe
 * rule is "one warning per band": having warned at 30 days, the daily sweep must
 * stay quiet until the asset drops inside 7, or it becomes noise people filter
 * out — which defeats the point of warning at all.
 */
export function dueWarning(
  a: RightsAssessment,
  lastWarnedAt: Date | string | null | undefined,
  now: Date,
): number | null {
  if (a.status !== 'expiring_soon' || a.daysRemaining === null) return null;

  const band = warnBand(a.daysRemaining);
  if (band === null) return null;

  const last = toDate(lastWarnedAt ?? null);
  if (!last) return band;

  // How many days remained when the last warning went out. `last` is in the
  // past, so this is always >= the current figure.
  const elapsed = -daysUntil(last, now);
  const bandThen = warnBand(a.daysRemaining + elapsed);

  // Same band as last time → already warned. A tighter one → warn again.
  return bandThen === band ? null : band;
}
