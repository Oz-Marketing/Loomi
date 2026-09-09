import { prisma } from '@/lib/prisma';
import { getIncentives, marketcheckConfigured } from '@/lib/integrations/marketcheck';
import { diffOffers, normalizeEndDate, offerScopeKey } from './fingerprint';
import {
  evaluateOfferCycle,
  monthWindow,
  nextMonthWindow,
  rollingWindow,
  type OfferCycleState,
  type RunWindow,
} from './offer-timing';
import { selectOffer, type SelectableOfferType } from './select-offer';
import { currentNewStock } from './sync-inventory';
import { createNotification } from '@/lib/notifications/service';
import { resolveReviewers } from './generate-ads';

/**
 * Offer poll — Phase 1 shadow mode.
 *
 * Fetches each watched vehicle's OEM programmes, fingerprints them, diffs against
 * what was last seen, and records the result. It GENERATES NOTHING: no creative,
 * no render, no notification. That's deliberate — we want real offer history
 * (how noisy is the feed? how far ahead does each OEM publish? how often does the
 * chosen offer actually change?) before anything runs unattended.
 *
 * Server-only.
 */

export interface AutomationConfigRow {
  accountKey: string;
  enabled: boolean;
  makes: string | null;
  focusModels: string | null;
  excludeModels: string | null;
  zip: string | null;
  radius: number;
  offerTypePriority: string;
  runWindowMode: string;
  rollingDays: number;
  /** Optional: absent on callers that only poll. Drives who is told a cycle landed. */
  notifyUserIds?: string | null;
}

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Build the run window this sub-account plans against. */
export function runWindowFor(config: Pick<AutomationConfigRow, 'runWindowMode' | 'rollingDays'>, now: Date): RunWindow {
  switch (config.runWindowMode) {
    case 'current_month':
      return monthWindow(now);
    case 'rolling':
      return rollingWindow(now, config.rollingDays || 30);
    case 'next_month':
    default:
      return nextMonthWindow(now);
  }
}

export interface WatchScope {
  make: string;
  model: string;
  year: number;
  /** On-lot new units for this year/make/model, when inventory is known. */
  stock: number;
}

/**
 * Which vehicles to poll for a sub-account.
 *
 * Default is AUTO: whatever new stock the inventory feeds report. That's what
 * makes a sub-account work with no configuration — the watch list maintains
 * itself as the lot turns over. A focus list narrows it; an exclude list
 * suppresses. With no inventory at all, an explicit focus list is the only way
 * to watch anything, since there'd otherwise be nothing to enumerate.
 */
export async function resolveWatchScopes(
  config: AutomationConfigRow,
  fallbackMakes: string[],
): Promise<WatchScope[]> {
  const focus = jsonArray(config.focusModels).map((m) => m.toLowerCase());
  const exclude = new Set(jsonArray(config.excludeModels).map((m) => m.toLowerCase()));
  const configuredMakes = jsonArray(config.makes);
  const makes = (configuredMakes.length ? configuredMakes : fallbackMakes).map((m) => m.trim()).filter(Boolean);
  const makeSet = new Set(makes.map((m) => m.toLowerCase()));

  const stock = await currentNewStock(config.accountKey);
  const scopes: WatchScope[] = [];

  for (const s of stock) {
    if (makeSet.size && !makeSet.has(s.make.toLowerCase())) continue;
    if (exclude.has(s.model.toLowerCase())) continue;
    if (focus.length && !focus.includes(s.model.toLowerCase())) continue;
    scopes.push({ make: s.make, model: s.model, year: s.year, stock: s.count });
  }

  // No inventory rows yet — fall back to the explicit focus list against the
  // current model year so a sub-account can be watched before feeds land.
  if (scopes.length === 0 && focus.length) {
    const year = new Date().getUTCFullYear();
    for (const make of makes) {
      for (const model of jsonArray(config.focusModels)) {
        if (exclude.has(model.toLowerCase())) continue;
        scopes.push({ make, model, year, stock: 0 });
      }
    }
  }

  return scopes;
}

export interface ScopeReport {
  make: string;
  model: string;
  year: number;
  stock: number;
  offersReturned: number;
  cycleState: OfferCycleState;
  cycleSummary: string;
  newFingerprints: string[];
  endedFingerprints: string[];
  /** What the policy WOULD have chosen — recorded, not acted on. */
  wouldChoose: string | null;
  usedYear: number;
  usedNational: boolean;
}

/** Where a reviewer lands from the notification — the run's own surface. */
const OFFERS_LINK = '/ad-generator';

export interface PollResult {
  accountKey: string;
  runId: string | null;
  window: RunWindow;
  scopes: ScopeReport[];
  offersSeen: number;
  offersNew: number;
  offersEnded: number;
}

/**
 * Poll one sub-account's watched vehicles and persist the offer diff.
 *
 * Snapshot rows are upserted (never deleted); offers that stop appearing get
 * `endedAt` stamped. Retaining that history is what later lets us MEASURE each
 * OEM's publication lead time rather than hardcoding a guess.
 */
export async function pollAccountOffers(
  config: AutomationConfigRow,
  opts: { fallbackMakes?: string[]; now?: Date } = {},
): Promise<PollResult> {
  const now = opts.now ?? new Date();
  const started = new Date();
  const window = runWindowFor(config, now);
  const priority = jsonArray(config.offerTypePriority).filter((t): t is SelectableOfferType =>
    ['lease', 'apr', 'cash'].includes(t),
  );

  const scopes = await resolveWatchScopes(config, opts.fallbackMakes ?? []);
  const reports: ScopeReport[] = [];
  let offersSeen = 0;
  let offersNew = 0;
  let offersEnded = 0;

  for (const scope of scopes) {
    const scopeKey = offerScopeKey({
      accountKey: config.accountKey,
      make: scope.make,
      model: scope.model,
      year: scope.year,
      zip: config.zip ?? undefined,
    });

    const res = await getIncentives(scope.make, scope.model, scope.year, config.zip ?? undefined, config.radius);
    offersSeen += res.incentives.length;

    // Previously-live fingerprints for this scope (ended ones don't count as
    // "seen before" — a returning programme is genuinely news again).
    let previous: string[] = [];
    try {
      const rows = await prisma.oemOfferSnapshot.findMany({
        where: { scopeKey, endedAt: null },
        select: { fingerprint: true },
      });
      previous = rows.map((r) => r.fingerprint);
    } catch (err) {
      console.warn('[poll-offers] snapshot table unavailable (unmigrated?):', err);
    }

    const diff = diffOffers(res.incentives, previous);
    const cycle = evaluateOfferCycle(res.incentives, window);
    const selection = selectOffer(res.incentives, { runWindow: window, priority, now });

    offersNew += diff.new.length;
    offersEnded += diff.ended.length;

    // Persist. Best-effort per scope so one bad write doesn't lose the sweep.
    try {
      for (const entry of [...diff.new, ...diff.unchanged]) {
        const inc = entry.incentive!;
        await prisma.oemOfferSnapshot.upsert({
          where: { scopeKey_fingerprint: { scopeKey, fingerprint: entry.fingerprint } },
          create: {
            accountKey: config.accountKey,
            scopeKey,
            fingerprint: entry.fingerprint,
            make: scope.make,
            model: scope.model,
            year: scope.year,
            zip: config.zip ?? null,
            offerType: inc.type,
            payload: JSON.stringify(inc),
            endDate: normalizeEndDate(inc.endDate) || null,
          },
          // Clearing endedAt matters: an OEM that re-publishes the identical
          // programme next month must count as live again, not stay retired.
          update: { lastSeenAt: new Date(), endedAt: null, payload: JSON.stringify(inc) },
        });
      }
      if (diff.ended.length) {
        await prisma.oemOfferSnapshot.updateMany({
          where: { scopeKey, fingerprint: { in: diff.ended.map((e) => e.fingerprint) }, endedAt: null },
          data: { endedAt: new Date() },
        });
      }
    } catch (err) {
      console.warn(`[poll-offers] persist failed for ${scopeKey}:`, err);
    }

    const chosen = selection.chosen?.incentive;
    reports.push({
      make: scope.make,
      model: scope.model,
      year: scope.year,
      stock: scope.stock,
      offersReturned: res.incentives.length,
      cycleState: cycle.state,
      cycleSummary: cycle.summary,
      newFingerprints: diff.new.map((e) => e.fingerprint),
      endedFingerprints: diff.ended.map((e) => e.fingerprint),
      wouldChoose: chosen
        ? `${chosen.type} ${
            chosen.type === 'lease'
              ? `$${Math.round(chosen.payment)}/mo`
              : chosen.type === 'apr'
                ? `${chosen.rate}%`
                : `$${Math.round(chosen.amount)}`
          }`
        : null,
      usedYear: res.usedYear,
      usedNational: res.usedNational,
    });
  }

  // Heartbeat row — written even when nothing changed.
  let runId: string | null = null;
  try {
    const run = await prisma.adAutomationRun.create({
      data: {
        accountKey: config.accountKey,
        kind: 'offer_poll',
        startedAt: started,
        finishedAt: new Date(),
        scopesChecked: scopes.length,
        offersSeen,
        offersNew,
        offersEnded,
        vehiclesSeen: scopes.reduce((n, s) => n + s.stock, 0),
        detail: JSON.stringify({
          window: { start: window.start.toISOString(), end: window.end.toISOString() },
          scopes: reports,
        }),
      },
    });
    runId = run.id;
  } catch (err) {
    console.warn('[poll-offers] could not record run:', err);
  }

  const result: PollResult = {
    accountKey: config.accountKey, runId, window, scopes: reports, offersSeen, offersNew, offersEnded,
  };
  await notifyOffersLanded({ accountKey: config.accountKey, notifyUserIds: config.notifyUserIds ?? null }, result);
  return result;
}

/** Distinct models that gained at least one offer in this sweep. */
export function modelsWithNewOffers(scopes: Pick<ScopeReport, 'model' | 'newFingerprints'>[]): string[] {
  return [...new Set(scopes.filter((s) => s.newFingerprints.length > 0).map((s) => s.model))];
}

/** Distinct manufacturers that gained at least one offer in this sweep. */
export function makesWithNewOffers(scopes: Pick<ScopeReport, 'make' | 'newFingerprints'>[]): string[] {
  return [...new Set(scopes.filter((s) => s.newFingerprints.length > 0).map((s) => s.make))];
}

/**
 * Put the manufacturer in the title, not the body.
 *
 * "40 new manufacturer offers published" made you open the notification and
 * read a model list to work out whose book turned over — and models are the
 * worst possible clue, because Colorado and Equinox only say "Chevrolet" to
 * someone who already knows. The make is the first thing a reviewer needs and
 * it belongs in the line they see in the bell.
 *
 * A group account can poll several makes in one sweep, so this handles more
 * than one; past two the makes go after the count rather than in front of it,
 * because "40 new Honda, Chevrolet, Ford offers published" does not parse.
 */
export function offersLandedTitle(makes: string[], count: number): string {
  const noun = `offer${count === 1 ? '' : 's'}`;
  if (makes.length === 1) return `${count} new ${makes[0]} ${noun} published`;
  if (makes.length === 0) return `${count} new manufacturer ${noun} published`;
  return `${count} new ${noun} published — ${summariseModels(makes, 3)}`;
}

/**
 * Name what turned over, readably.
 *
 * "40 new offers" is a number; "Colorado, Equinox, Silverado 1500 and 7 more" is
 * the thing a person can act on. Capped at three because a cycle routinely
 * covers a dozen models and a notification title is not a list.
 */
export function summariseModels(models: string[], max = 3): string {
  const shown = models.slice(0, max).join(', ');
  const rest = models.length - Math.min(models.length, max);
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * Tell the account's reviewers that a new OEM cycle landed.
 *
 * WHY AT POLL TIME, when generation already notifies half an hour later. Three
 * reasons, and each one is a real gap:
 *
 *  • Generation is off (`enabled: false`) or produced nothing for an unrelated
 *    reason. The offers still landed, and nobody hears about it.
 *  • A manufacturer's window is often only a few weeks. Knowing at 06:00 that
 *    the book turned over is worth more than knowing at 06:30 that ads exist.
 *  • Between cycles the feed sits empty for days — every Honda program expired
 *    09/08/2026 with no replacement. Silence is indistinguishable from a broken
 *    integration, so the arrival of offers has to be its own event.
 *
 * Goes to the REVIEWERS (notifyUserIds → account rep → admins), not to clients:
 * a dealer is told when there are ads to look at, which is `incentive_ads_ready`.
 * A raw feed change is an operations signal.
 *
 * In-app AND email. `createNotification` gates each channel on the user's own
 * `NotificationPreference`, so someone who muted the bell or the inbox keeps
 * that choice; `sendEmailNow` only asks for the email, it does not force it.
 *
 * Best-effort throughout: a poll that recorded its snapshots has done its job,
 * and a failed notification must not lose that.
 */
async function notifyOffersLanded(
  config: { accountKey: string; notifyUserIds: string | null },
  result: PollResult,
): Promise<void> {
  if (result.offersNew === 0) return;

  const models = modelsWithNewOffers(result.scopes);
  if (models.length === 0) return;
  const vehicles = summariseModels(models);
  const makes = makesWithNewOffers(result.scopes);

  let recipients: string[] = [];
  try {
    recipients = await resolveReviewers(config);
  } catch {
    return;
  }
  if (recipients.length === 0) return;

  const n = result.offersNew;
  const title = offersLandedTitle(makes, n);
  const body = `New offers landed for ${vehicles}. Ads build on the next run; nothing publishes until a person approves it.`;

  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'incentive_offers_landed',
        severity: 'info',
        title,
        body,
        link: OFFERS_LINK,
        meta: { accountKey: config.accountKey, runId: result.runId, offersNew: n, makes, models },
        // One per poll run. A cycle can land across several scopes in the same
        // sweep, and that is one piece of news, not six.
        dedupeKey: `adgen-offers:${config.accountKey}:${result.runId ?? new Date().toISOString().slice(0, 10)}`,
        dedupeWindowHours: 12,
        sendEmailNow: true,
      });
    } catch (err) {
      console.warn('[poll-offers] notification failed:', err);
    }
  }
}

/** Poll every enabled sub-account. Shadow mode — records only. */
export async function pollAllAccounts(now = new Date()): Promise<PollResult[]> {
  if (!marketcheckConfigured()) {
    console.warn('[poll-offers] MARKETCHECK_API_KEY unset — skipping poll');
    return [];
  }
  let configs: AutomationConfigRow[] = [];
  try {
    configs = await prisma.adAutomationConfig.findMany({
      where: { enabled: true },
      select: {
        accountKey: true,
        enabled: true,
        makes: true,
        focusModels: true,
        excludeModels: true,
        zip: true,
        radius: true,
        offerTypePriority: true,
        runWindowMode: true,
        rollingDays: true,
        // Who to tell when a cycle lands — same list generation notifies.
        notifyUserIds: true,
      },
    });
  } catch (err) {
    console.warn('[poll-offers] config table unavailable (unmigrated?):', err);
    return [];
  }

  const out: PollResult[] = [];
  for (const config of configs) {
    // Fall back to the sub-account's own OEM + postal code when unset, so a
    // freshly-enabled row needs no extra typing.
    let fallbackMakes: string[] = [];
    let cfg = config;
    try {
      const account = await prisma.account.findUnique({
        where: { key: config.accountKey },
        select: { oem: true, oems: true, postalCode: true },
      });
      if (account) {
        const multi = jsonArray(account.oems);
        fallbackMakes = multi.length ? multi : account.oem ? [account.oem] : [];
        if (!cfg.zip && account.postalCode) cfg = { ...cfg, zip: account.postalCode };
      }
    } catch {
      // Non-fatal: an unreadable account just means no fallbacks.
    }
    try {
      out.push(await pollAccountOffers(cfg, { fallbackMakes, now }));
    } catch (err) {
      console.error(`[poll-offers] ${config.accountKey} failed:`, err);
    }
  }
  return out;
}
