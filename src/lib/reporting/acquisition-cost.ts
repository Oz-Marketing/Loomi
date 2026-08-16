/**
 * Acquisition cost — what a lead and a sold unit actually cost in media.
 *
 * ── WHY THIS IS THE REPORT NOBODY ELSE CAN BUILD ────────────────────────────
 * Google can tell a dealer its cost per *Google-attributed conversion*. Meta
 * can do the same for Meta. Neither can see the DMS, so neither can tell you
 * what a delivered unit cost. Loomi holds both halves: billed media spend
 * (per-account margin applied) and the CRM outcome (`ContactEvent`). This joins
 * them.
 *
 * ── WHAT CANNOT BE JOINED, AND WHY THAT MATTERS MORE ────────────────────────
 * There is NO per-channel path from media spend to a sale in this data, and
 * pretending otherwise is the main way this report could do damage.
 *
 *   • `Contact.source` is the CRM's lead source — "AutoTrader", "Website",
 *     "Walk-in". A different taxonomy from ad channels, and "Website" says
 *     nothing about whether that visit came from Google or Meta.
 *   • `ContactEvent.sourceCrm` names the CRM SYSTEM (cdk, tekion), not a
 *     marketing source.
 *   • Nothing carries a click id, utm set, or campaign back to the deal.
 *
 * So spend-by-channel and leads-by-CRM-source are two truthful lists that must
 * never be divided by each other. `computeAcquisitionCost` will not do it, and
 * the shape it returns gives the UI nothing to do it with.
 *
 * Two things ARE honest, and this module produces exactly those:
 *
 *   1. BLENDED — total media spend ÷ total outcomes. No attribution claim.
 *      This is the standard automotive-retail measure and it is what a GM
 *      means by "what does a car cost me in advertising".
 *   2. PLATFORM-ATTRIBUTED — where a channel has offline conversions imported
 *      back into it, that channel's own spend ÷ its own imported purchases.
 *      This is the PLATFORM's attribution, clearly labelled as such, not ours.
 *
 * ── THE THREE CAVEATS THAT CHANGE THE NUMBER ────────────────────────────────
 * PARTIAL SPEND. If a configured channel fails or is unlinked, total spend is
 * understated and every blended figure comes out too low — a CPL that quietly
 * omits Meta looks like an improvement. `coverage` reports it and the result is
 * marked `partial`; the UI must not print a blended figure without the warning.
 *
 * LEADS ARE GOOD LEADS. The Oz Reports bridge drops CRM-flagged BAD and
 * DUPLICATE leads before pushing, so Loomi's denominator excludes them (~29% at
 * one rooftop). Cost per lead here is therefore HIGHER than a
 * cost-per-total-leads figure. See lead-performance.ts.
 *
 * LAG. A car sold this month was very often clicked on last month. Dividing one
 * window's spend by the same window's units assumes a cycle shorter than the
 * window. Over a month that is rough; over a quarter it is reasonable; day to
 * day it is noise. The trend matters more than any single value, which is why
 * `monthly` exists.
 */

/** One media channel's contribution, as gathered from its own report route. */
export interface ChannelSpendInput {
  key: string;
  label: string;
  /** Billed spend (margin applied), or null when the channel didn't report. */
  spend: number | null;
  /** Why it didn't report — the route's own words. */
  note?: string;
  /**
   * Outcomes the PLATFORM attributed to itself via offline-conversion import.
   * Undefined when the account has no offline import configured, which is the
   * common case; zero is a real measurement and is treated differently.
   */
  offlineLeads?: number;
  offlinePurchases?: number;
}

/** CRM-side outcomes for the same window. */
export interface OutcomeInput {
  /** Lead `Contact` rows created in the window. Good leads only — see header. */
  leads: number;
  /** `sale` events in the window. */
  soldUnits: number;
  /** Transaction revenue, NOT gross — the bridge doesn't carry gross. */
  revenue: number;
}

export interface CostPer {
  costPerLead: number | null;
  costPerSoldUnit: number | null;
}

export interface ChannelAttribution {
  key: string;
  label: string;
  spend: number;
  offlineLeads: number;
  offlinePurchases: number;
  costPerLead: number | null;
  costPerSoldUnit: number | null;
}

export interface AcquisitionCost {
  totalSpend: number;
  /** Blended over every channel that reported. */
  blended: CostPer;
  outcomes: OutcomeInput;
  /** Revenue ÷ spend. Transaction revenue, so NOT a return on ad spend. */
  revenuePerDollar: number | null;
  coverage: {
    reporting: string[];
    missing: { label: string; note?: string }[];
    /** True when at least one channel failed to report — blended is understated. */
    partial: boolean;
  };
  /**
   * Per-channel figures, ONLY for channels with platform-attributed offline
   * conversions. Empty is the normal state; it means no channel has offline
   * import configured, not that the channels performed badly.
   */
  attributed: ChannelAttribution[];
}

/** Divide, or null when the denominator can't support a rate. */
function per(total: number, count: number): number | null {
  if (!(count > 0) || !(total > 0)) return null;
  return Math.round((total / count) * 100) / 100;
}

export function computeAcquisitionCost(
  channels: ChannelSpendInput[],
  outcomes: OutcomeInput,
): AcquisitionCost {
  const reporting = channels.filter((c) => c.spend !== null);
  const missing = channels
    .filter((c) => c.spend === null)
    .map((c) => ({ label: c.label, note: c.note }));

  const totalSpend =
    Math.round(reporting.reduce((sum, c) => sum + (c.spend ?? 0), 0) * 100) / 100;

  // Only channels the platform itself matched back to CRM outcomes. A channel
  // with no offline import is absent, NOT zero — reporting it as "$0 per sale"
  // or as "∞" would both be inventions.
  const attributed: ChannelAttribution[] = reporting
    .filter((c) => c.offlinePurchases !== undefined || c.offlineLeads !== undefined)
    .map((c) => {
      const spend = c.spend ?? 0;
      const offlineLeads = c.offlineLeads ?? 0;
      const offlinePurchases = c.offlinePurchases ?? 0;
      return {
        key: c.key,
        label: c.label,
        spend,
        offlineLeads,
        offlinePurchases,
        costPerLead: per(spend, offlineLeads),
        costPerSoldUnit: per(spend, offlinePurchases),
      };
    })
    // A channel that imported the capability but matched nothing is noise.
    .filter((c) => c.offlineLeads > 0 || c.offlinePurchases > 0);

  return {
    totalSpend,
    blended: {
      costPerLead: per(totalSpend, outcomes.leads),
      costPerSoldUnit: per(totalSpend, outcomes.soldUnits),
    },
    outcomes,
    revenuePerDollar:
      totalSpend > 0 && outcomes.revenue > 0
        ? Math.round((outcomes.revenue / totalSpend) * 100) / 100
        : null,
    coverage: {
      reporting: reporting.map((c) => c.label),
      missing,
      partial: missing.length > 0,
    },
    attributed,
  };
}

/** One month of the trend. */
export interface AcquisitionMonth {
  period: string;
  label: string;
  spend: number;
  leads: number;
  soldUnits: number;
  costPerLead: number | null;
  costPerSoldUnit: number | null;
}

/**
 * Blended cost per month.
 *
 * The trend is the point of this report: a single month's cost per unit is
 * distorted by the lag between click and delivery, but the direction over six
 * or twelve months is not. Months with spend but no outcomes yield `null`
 * rather than a spike to infinity — an in-flight month with nothing closed yet
 * is missing data, not an infinitely expensive one.
 */
export function monthlyAcquisitionCost(
  spendByMonth: Record<string, number>,
  outcomesByMonth: Record<string, { leads: number; soldUnits: number }>,
): AcquisitionMonth[] {
  const periods = [
    ...new Set([...Object.keys(spendByMonth), ...Object.keys(outcomesByMonth)]),
  ].sort();

  return periods.map((period) => {
    const spend = Math.round((spendByMonth[period] ?? 0) * 100) / 100;
    const { leads = 0, soldUnits = 0 } = outcomesByMonth[period] ?? {};
    const [y, m] = period.split('-');
    return {
      period,
      label: new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      spend,
      leads,
      soldUnits,
      costPerLead: per(spend, leads),
      costPerSoldUnit: per(spend, soldUnits),
    };
  });
}
