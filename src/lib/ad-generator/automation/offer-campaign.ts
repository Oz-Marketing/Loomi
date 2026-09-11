/**
 * The Campaign container an OEM offer run writes into — one per account per
 * offer cycle.
 *
 * WHY A CYCLE KEY. The container used to be created inside the offer-email
 * step and keyed off the SET of offers the email featured. That made "which
 * campaign" an accident of which offers a given run happened to see: a hand run
 * scoped to two models and the scheduled run the next morning had different
 * sets, different keys, and produced two campaigns for one month. And an
 * account with email off got no container at all, so its ads never reached the
 * Campaigns page — the client's home.
 *
 * Now the key is the account plus the UTC month of the run window's start
 * (`adgen:<accountKey>:<yyyy-mm>`), and the RUN owns the container, whether or
 * not an email is drafted. Every run for a cycle lands in the same row.
 *
 * WHY THE MONTH OF THE WINDOW, not of the clock. Under `next_month` a run on
 * 25 September is building October's offers; naming that campaign "September"
 * would be wrong on the day it was made. The window is what the run is FOR.
 *
 * Server-only.
 */
import { prisma } from '@/lib/prisma';
import { archiveCampaign, createCampaign, restoreCampaign } from '@/lib/services/campaigns';
import type { RunWindow } from './offer-timing';

const KEY_RE = /^adgen:(.+):(\d{4})-(\d{2})$/;

/** `yyyy-mm`, UTC, of the window's first day. */
export function offerCycleMonth(window: RunWindow): string {
  const d = window.start;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function offerCycleKey(accountKey: string, window: RunWindow): string {
  return `adgen:${accountKey}:${offerCycleMonth(window)}`;
}

/** The `yyyy-mm` a cycle key names, or null for a key in another shape. */
export function parseCycleKeyMonth(key: string | null | undefined): string | null {
  const m = key ? KEY_RE.exec(key) : null;
  return m ? `${m[2]}-${m[3]}` : null;
}

/** "October 2026" for a window starting in October 2026. */
export function offerCycleLabel(window: RunWindow): string {
  return window.start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "October 2026 offers — Young Honda Ogden".
 *
 * Month first: two of the three campaigns in dev had been renamed by hand to
 * exactly that shape, which is as clear a signal as a naming convention gets.
 * The year is for the Archived filter, where a dozen Octobers otherwise look
 * alike.
 */
export function offerCampaignName(dealer: string, window: RunWindow): string {
  return `${offerCycleLabel(window)} offers — ${dealer}`;
}

/** Has the cycle month ended, as of `now`? Strictly before the current UTC month. */
export function cycleMonthHasEnded(month: string, now: Date): boolean {
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return month < current;
}

/**
 * Archive this account's automation campaigns whose cycle month has ended.
 *
 * A SWEEP, not a side effect of creating the next container. Coupled to
 * creation it never fired in the month-end wait state — the run built nothing,
 * so nothing was created, so September sat in Active through October — and
 * under `next_month` it archived the live month on the first morning of that
 * month. Keyed on the month in the key, compared with the clock: a container
 * is archived only once the month it was FOR is over.
 *
 * Returns the ids archived.
 */
export async function archiveEndedOfferCycles(accountKey: string, now = new Date()): Promise<string[]> {
  const rows = await prisma.campaign.findMany({
    where: { accountKey, source: 'automation', archivedAt: null, automationKey: { not: null } },
    select: { id: true, automationKey: true },
  });
  const ended = rows.filter((r) => {
    const month = parseCycleKeyMonth(r.automationKey);
    return month !== null && cycleMonthHasEnded(month, now);
  });
  for (const r of ended) await archiveCampaign(r.id);
  return ended.map((r) => r.id);
}

/**
 * The same sweep across every account that has automation containers — for the
 * 05:00 expire job, so an account whose automation is OFF (run by hand last
 * month, nothing scheduled) still rolls over when its month ends.
 */
export async function archiveAllEndedOfferCycles(
  now = new Date(),
): Promise<{ accounts: number; archived: number }> {
  const accounts = await prisma.campaign.findMany({
    where: { source: 'automation', archivedAt: null, automationKey: { not: null }, accountKey: { not: null } },
    select: { accountKey: true },
    distinct: ['accountKey'],
  });
  let archived = 0;
  for (const a of accounts) {
    if (!a.accountKey) continue;
    archived += (await archiveEndedOfferCycles(a.accountKey, now)).length;
  }
  return { accounts: accounts.length, archived };
}

export interface OfferCampaignRef {
  id: string;
  /** True when this call created the row; false when it found (or restored) one. */
  created: boolean;
}

/**
 * The cycle's container: found, or created `building` so the run can write
 * into it before anyone reads it.
 *
 * Two runs racing on a fresh cycle both miss the lookup and both try to
 * create; the unique key turns the loser's insert into P2002, and it re-reads.
 * A container someone archived by hand mid-cycle is RESTORED rather than
 * duplicated — the key forbids a second row, and a run with live ads for the
 * cycle is the cycle being live again.
 */
export async function ensureOfferCampaign(input: {
  accountKey: string;
  dealer: string;
  window: RunWindow;
  createdByUserId?: string | null;
  createdByRole?: string | null;
}): Promise<OfferCampaignRef> {
  const automationKey = offerCycleKey(input.accountKey, input.window);
  const found = await prisma.campaign.findUnique({
    where: { automationKey },
    select: { id: true, archivedAt: true },
  });
  if (found) {
    if (found.archivedAt) await restoreCampaign(found.id);
    return { id: found.id, created: false };
  }
  try {
    const created = await createCampaign({
      name: offerCampaignName(input.dealer, input.window),
      accountKey: input.accountKey,
      source: 'automation',
      goal: null,
      status: 'building',
      automationKey,
      createdByUserId: input.createdByUserId ?? null,
      createdByRole: input.createdByRole ?? null,
    });
    return { id: created.id, created: true };
  } catch (err) {
    // Lost the race: the other run's row exists now.
    if ((err as { code?: string })?.code === 'P2002') {
      const again = await prisma.campaign.findUnique({ where: { automationKey }, select: { id: true } });
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
}

/**
 * Whether the ad's campaign is mid-run. While `runOfferCampaign` writes into a
 * container it is marked `building`; picking or editing a design under it
 * would race the run's own upsert of that row.
 */
export async function creativeCampaignIsBuilding(creativeId: string): Promise<boolean> {
  const row = await prisma.adCreative.findUnique({
    where: { id: creativeId },
    select: { campaign: { select: { status: true } } },
  });
  return row?.campaign?.status === 'building';
}
