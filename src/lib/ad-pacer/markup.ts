/**
 * The single source of truth for markup → spend-target math (spec §0.1).
 *
 * "Markup" is the gross→spend factor: actual spend = client gross × markup
 * (e.g. 0.77 for a 23%-margin account, 0.85 for a 15%-margin one). It is read
 * from ONE place per account and fed through ONE target formula — no surface
 * computes its own, and there is NO hardcoded markup literal anywhere in calc
 * code. Resolution order:
 *
 *   1. the account's own override (Account.markup), when set and valid
 *   2. else the agency-wide default configured in admin settings
 *
 * If neither is configured the factor is 0, which makes an unconfigured markup
 * surface as an obviously-broken $0 target rather than silently computing at a
 * plausible-looking default (the §0.1 failure mode this design prevents).
 *
 * This module is PURE (no DB/prisma) so it can be imported by both client and
 * server. The agency default is fetched server-side via
 * `@/lib/services/markup` and the resolved factor is sent to the client in the
 * API payload — the client never re-resolves and never holds a literal.
 */

/** True when a stored markup value is usable (a finite, positive factor). */
export function isValidMarkup(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * The ONE margin lookup. `accountMarkup` is Account.markup (per-account
 * override, null when none); `globalDefault` is the admin-configured agency
 * default (0 when unconfigured). Never falls back to a hardcoded literal.
 */
export function accountMarginSetting(
  accountMarkup: number | null | undefined,
  globalDefault: number,
): number {
  if (isValidMarkup(accountMarkup)) return accountMarkup;
  return isValidMarkup(globalDefault) ? globalDefault : 0;
}

/**
 * The ONE effective spend-target formula. `markup` is the resolved factor from
 * `accountMarginSetting`; `appliedIn` is the signed carryover applied INTO the
 * month (the ledger sum — preserving the existing adjusted-target semantics:
 * a prior over reduces this month's target, a prior under raises it). Returns
 * the target in actual-spend dollars.
 */
export function effectiveSpendTarget(
  clientBudget: number,
  markup: number,
  appliedIn = 0,
): number {
  const gross = Number.isFinite(clientBudget) ? clientBudget : 0;
  const m = Number.isFinite(markup) ? markup : 0;
  const carry = Number.isFinite(appliedIn) ? appliedIn : 0;
  return gross * m + carry;
}
