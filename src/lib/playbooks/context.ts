/**
 * Playbooks — audit context loader.
 *
 * The ONLY module in `src/lib/playbooks` that touches the database. Everything
 * downstream (checks, definitions, audit) is pure, so the whole scoring model
 * is testable without one.
 *
 * It issues a FIXED number of queries regardless of how many sub-accounts are
 * being audited — nine reads, then in-memory indexing. The obvious shape (loop
 * the accounts, query per check) is 38 rooftops × 25 checks of round trips and
 * gets slower every time someone adds a store.
 */

import { prisma } from '@/lib/prisma';
import { ancestorKeys, type AccountEdge } from '@/lib/account-hierarchy';
import { normalizeOems } from '@/lib/oems';
import { designHash } from '@/lib/ad-generator/template-sync';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import {
  OFFERS_PLACEHOLDER,
  templateHasOffersMarker,
} from '@/lib/ad-generator/automation/offer-email-doc';
import { isV2Template } from '@/lib/email/types';
import type { AccountAuditContext, CoopFacts, CoopState, ResolvedBranding } from './types';

/** Current planning month as YYYY-MM. Inlined rather than imported from
 *  `@/lib/ad-pacer/period`, whose module pulls in a client component. */
export function currentPeriod(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Whole-currency string → number. Blank / unparseable reads as 0, not NaN. */
function money(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function nonEmpty(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

type AccountRow = {
  key: string;
  slug: string | null;
  dealer: string;
  category: string | null;
  oem: string | null;
  oems: string | null;
  timezone: string | null;
  logos: string | null;
  branding: string | null;
  markup: number | null;
  accountRepId: string | null;
  parentAccountKey: string | null;
  lifecyclePresetsSeededAt: Date | null;
  senderEmail: string | null;
  sendingDomain: string | null;
  twilioPhoneNumber: string | null;
  twilioMessagingServiceSid: string | null;
  metaAdAccountId: string | null;
  metaPageId: string | null;
  metaAssetsConfirmedAt: Date | null;
  metaPixelId: string | null;
  metaDefaultConversionEvent: string | null;
  metaTimezone: string | null;
  googleAdsCustomerId: string | null;
  googleConversionAction: string | null;
};

/**
 * Resolve the brand kit up the parent chain, the account's own value winning
 * and the nearest ancestor filling any gap — the same rule `/api/accounts`
 * applies, so the audit agrees with what the rest of the app renders.
 */
function resolveBranding(key: string, byKey: Map<string, AccountRow>, edges: AccountEdge[]): ResolvedBranding {
  const chain = [key, ...ancestorKeys(edges, key)];
  let logoLight: string | null = null;
  let primaryColor: string | null = null;
  let ownedLogo = false;
  let ownedColor = false;

  for (const [depth, k] of chain.entries()) {
    const row = byKey.get(k);
    if (!row) continue;
    if (!logoLight) {
      const logos = parseJson<Record<string, string>>(row.logos);
      const found = nonEmpty(logos?.light);
      if (found) {
        logoLight = found;
        ownedLogo = depth === 0;
      }
    }
    if (!primaryColor) {
      const branding = parseJson<{ colors?: Record<string, string> }>(row.branding);
      const found = nonEmpty(branding?.colors?.primary);
      if (found) {
        primaryColor = found;
        ownedColor = depth === 0;
      }
    }
    if (logoLight && primaryColor) break;
  }

  return {
    logoLight,
    primaryColor,
    // "Inherited" describes the resolved kit as a whole: if either half came
    // from an ancestor, editing this account alone won't fully control it.
    inherited: (!!logoLight && !ownedLogo) || (!!primaryColor && !ownedColor),
  };
}

/** Template ids referenced by an AdAutomationConfig's `templateMap` JSON. */
function templateIdsFromMap(raw: string | null): string[] {
  const map = parseJson<Record<string, unknown>>(raw);
  if (!map) return [];
  const ids = Object.values(map).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return [...new Set(ids)];
}

/**
 * Build one audit context per requested account key.
 *
 * `accountKeys` is the caller's already-authorised scope — this function does
 * no access control of its own.
 */
export async function loadAuditContexts(
  accountKeys: string[],
  opts: { now?: Date } = {},
): Promise<AccountAuditContext[]> {
  const now = opts.now ?? new Date();
  const period = currentPeriod(now);
  if (accountKeys.length === 0) return [];

  const accountSelect = {
    key: true,
    slug: true,
    dealer: true,
    category: true,
    oem: true,
    oems: true,
    timezone: true,
    logos: true,
    branding: true,
    markup: true,
    accountRepId: true,
    parentAccountKey: true,
    lifecyclePresetsSeededAt: true,
    senderEmail: true,
    sendingDomain: true,
    twilioPhoneNumber: true,
    twilioMessagingServiceSid: true,
    metaAdAccountId: true,
    metaPageId: true,
    metaAssetsConfirmedAt: true,
    metaPixelId: true,
    metaDefaultConversionEvent: true,
    metaTimezone: true,
    googleAdsCustomerId: true,
    googleConversionAction: true,
  } as const;

  const [allAccounts, launchPresets, plans, automationConfigs, feeds, automationRuns, ingestRuns] =
    await Promise.all([
      // EVERY account, not just the scoped ones: brand-kit inheritance walks the
      // parent chain, and a rooftop's group account is often outside the scope
      // being audited.
      prisma.account.findMany({ select: accountSelect }),
      prisma.adLaunchPreset.findMany({
        where: { accountKey: { in: accountKeys } },
        select: { accountKey: true, platform: true, launchMode: true, targetAdSetId: true },
      }),
      prisma.metaAdsPacerPlan.findMany({
        where: { accountKey: { in: accountKeys } },
        select: {
          accountKey: true,
          periodBudgets: {
            where: { period },
            select: {
              baseBudgetGoal: true,
              addedBudgetGoal: true,
              googleBaseBudgetGoal: true,
              googleAddedBudgetGoal: true,
              managedByBudget: true,
              googleManagedByBudget: true,
            },
          },
        },
      }),
      prisma.adAutomationConfig.findMany({
        where: { accountKey: { in: accountKeys } },
        select: {
          accountKey: true,
          enabled: true,
          templateMap: true,
          notifyUserIds: true,
          emailEnabled: true,
          emailTemplateId: true,
          emailAudienceId: true,
        },
      }),
      prisma.inventoryFeed.findMany({
        where: { accountKey: { in: accountKeys } },
        select: {
          accountKey: true,
          name: true,
          isActive: true,
          lastSyncedAt: true,
          lastSyncStatus: true,
          vehicleCount: true,
        },
      }),
      // NO accountKey filter: a null accountKey is a GLOBAL SWEEP covering every
      // enabled sub-account. Filtering it out reports each rooftop as stale while
      // the nightly job is running perfectly.
      prisma.adAutomationRun.groupBy({ by: ['accountKey'], _max: { startedAt: true } }),
      prisma.ingestRun.groupBy({
        by: ['accountKey'],
        where: { accountKey: { in: accountKeys } },
        _max: { startedAt: true },
      }),
    ]);

  const byKey = new Map(allAccounts.map((a) => [a.key, a as AccountRow]));
  const edges: AccountEdge[] = allAccounts.map((a) => ({
    key: a.key,
    parentAccountKey: a.parentAccountKey,
  }));

  const presetsByAccount = new Map<string, typeof launchPresets>();
  for (const p of launchPresets) {
    const list = presetsByAccount.get(p.accountKey) ?? [];
    list.push(p);
    presetsByAccount.set(p.accountKey, list);
  }

  const planByAccount = new Map(plans.map((p) => [p.accountKey, p]));
  const configByAccount = new Map(automationConfigs.map((c) => [c.accountKey, c]));

  const feedsByAccount = new Map<string, typeof feeds>();
  for (const f of feeds) {
    const list = feedsByAccount.get(f.accountKey) ?? [];
    list.push(f);
    feedsByAccount.set(f.accountKey, list);
  }

  const sweepRunAt = automationRuns.find((r) => r.accountKey === null)?._max.startedAt ?? null;
  const runByAccount = new Map(
    automationRuns
      .filter((r) => r.accountKey !== null)
      .map((r) => [r.accountKey as string, r._max.startedAt]),
  );
  const ingestByAccount = new Map(
    ingestRuns.map((r) => [r.accountKey, r._max.startedAt]),
  );

  // Second round trip: co-op standing needs the template ids, which only exist
  // once the automation configs are in hand.
  const templateIds = [
    ...new Set(automationConfigs.flatMap((c) => templateIdsFromMap(c.templateMap))),
  ];
  const [templates, approvals] = await Promise.all([
    templateIds.length
      ? prisma.adTemplateDoc.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, name: true, doc: true },
        })
      : Promise.resolve([] as { id: string; name: string; doc: string }[]),
    templateIds.length
      ? prisma.adTemplateCoopApproval.findMany({
          where: { templateId: { in: templateIds }, revokedAt: null },
          select: { templateId: true, make: true, docHash: true },
        })
      : Promise.resolve([] as { templateId: string; make: string; docHash: string }[]),
  ]);

  // ── companion offer email ──
  //
  // Three more batched reads, still a fixed count regardless of how many
  // rooftops are being audited. The last-email lookup keys off `automationKey`
  // (`adgen:<accountKey>:<hash>`) rather than a column, because `EmailBlast`
  // stores its accounts as a JSON array and so cannot be grouped by account.
  const emailTemplateSlugs = [
    ...new Set(
      automationConfigs
        .map((c) => c.emailTemplateId)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    ),
  ];
  const emailAudienceIds = [
    ...new Set(
      automationConfigs
        .map((c) => c.emailAudienceId)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    ),
  ];
  const [shellTemplates, emailAudiences, offerEmails] = await Promise.all([
    emailTemplateSlugs.length
      ? prisma.template.findMany({
          where: { slug: { in: emailTemplateSlugs } },
          select: { slug: true, content: true },
        })
      : Promise.resolve([] as { slug: string; content: string }[]),
    emailAudienceIds.length
      ? prisma.audience.findMany({
          where: { id: { in: emailAudienceIds } },
          select: { id: true, accountKey: true },
        })
      : Promise.resolve([] as { id: string; accountKey: string | null }[]),
    prisma.emailBlast.findMany({
      where: { automationKey: { startsWith: 'adgen:' } },
      select: { automationKey: true, createdAt: true },
    }),
  ]);

  const shellBySlug = new Map(shellTemplates.map((t) => [t.slug, t]));
  const audienceById = new Map(emailAudiences.map((a) => [a.id, a]));
  const lastOfferEmailByAccount = new Map<string, Date>();
  for (const b of offerEmails) {
    // `adgen:<accountKey>:<hash>` — the account key is the middle segment.
    const key = b.automationKey?.split(':')[1];
    if (!key) continue;
    const prev = lastOfferEmailByAccount.get(key);
    if (!prev || b.createdAt > prev) lastOfferEmailByAccount.set(key, b.createdAt);
  }

  /** Does the configured shell resolve to a v2 template carrying the marker? */
  function shellState(slug: string | null): { ok: boolean; problem: string | null } {
    if (!slug) return { ok: true, problem: null }; // compose from branding
    const row = shellBySlug.get(slug);
    if (!row) return { ok: false, problem: 'the configured template no longer exists' };
    if (!isV2Template(row.content)) {
      return { ok: false, problem: 'the configured template is not a visual (v2) template' };
    }
    return templateHasOffersMarker(row.content)
      ? { ok: true, problem: null }
      : { ok: false, problem: `the template has no ${OFFERS_PLACEHOLDER} block` };
  }

  const templateById = new Map(templates.map((t) => [t.id, t]));
  // Current design hash per template. A doc that won't parse yields null, which
  // reads downstream as "can't confirm the approval still applies" — a warning,
  // not a silent pass.
  const currentHashById = new Map<string, string | null>(
    templates.map((t) => {
      const doc = parseJson<TemplateDoc>(t.doc);
      return [t.id, doc ? designHash(doc) : null];
    }),
  );

  const approvalsByTemplate = new Map<string, typeof approvals>();
  for (const a of approvals) {
    const list = approvalsByTemplate.get(a.templateId) ?? [];
    list.push(a);
    approvalsByTemplate.set(a.templateId, list);
  }

  function coopFor(templateIdList: string[], makes: string[]): CoopFacts[] {
    const makeSet = new Set(makes.map((m) => m.toLowerCase()));
    return templateIdList.map((id) => {
      const template = templateById.get(id);
      const name = template?.name ?? id;
      // An approval only counts if it came from a make this rooftop actually
      // runs — a Ford programme's sign-off says nothing about a Chevy store.
      // With no make on file, any live approval is the best evidence we have.
      const relevant = (approvalsByTemplate.get(id) ?? []).filter(
        (a) => makeSet.size === 0 || makeSet.has(a.make.toLowerCase()),
      );
      if (relevant.length === 0) return { templateId: id, templateName: name, state: 'missing' as CoopState };
      const currentHash = currentHashById.get(id) ?? null;
      const matches = currentHash != null && relevant.some((a) => a.docHash === currentHash);
      return {
        templateId: id,
        templateName: name,
        state: (matches ? 'approved' : 'stale') as CoopState,
      };
    });
  }

  const contexts: AccountAuditContext[] = [];
  for (const key of accountKeys) {
    const row = byKey.get(key);
    if (!row) continue; // key vanished between the scope read and this one

    const config = configByAccount.get(key);
    const configTemplateIds = templateIdsFromMap(config?.templateMap ?? null);
    const makes = normalizeOems(parseJson<string[]>(row.oems) ?? row.oems, row.oem);
    const budget = planByAccount.get(key)?.periodBudgets?.[0];

    // The account's own last run, or the last global sweep — whichever is newer.
    const ownRun = runByAccount.get(key) ?? null;
    const lastAutomationRunAt =
      ownRun && sweepRunAt ? (ownRun > sweepRunAt ? ownRun : sweepRunAt) : (ownRun ?? sweepRunAt);

    contexts.push({
      accountKey: key,
      dealer: row.dealer,
      slug: row.slug ?? key,
      category: row.category,
      makes,
      timezone: row.timezone,
      accountRepId: row.accountRepId,
      markup: row.markup,
      lifecyclePresetsSeededAt: row.lifecyclePresetsSeededAt,
      branding: resolveBranding(key, byKey, edges),
      meta: {
        adAccountId: row.metaAdAccountId,
        pageId: row.metaPageId,
        assetsConfirmedAt: row.metaAssetsConfirmedAt,
        pixelId: row.metaPixelId,
        defaultConversionEvent: row.metaDefaultConversionEvent,
        timezone: row.metaTimezone,
      },
      google: {
        customerId: row.googleAdsCustomerId,
        conversionAction: row.googleConversionAction,
      },
      email: { senderEmail: row.senderEmail, sendingDomain: row.sendingDomain },
      sms: {
        messagingServiceSid: row.twilioMessagingServiceSid,
        phoneNumber: row.twilioPhoneNumber,
      },
      launchPresets: (presetsByAccount.get(key) ?? []).map((p) => ({
        platform: p.platform,
        launchMode: p.launchMode,
        targetAdSetId: p.targetAdSetId,
      })),
      pacer: {
        hasPlan: planByAccount.has(key),
        period,
        metaBudgetGoal: money(budget?.baseBudgetGoal) + money(budget?.addedBudgetGoal),
        googleBudgetGoal: money(budget?.googleBaseBudgetGoal) + money(budget?.googleAddedBudgetGoal),
        managedByBudget: budget?.managedByBudget ?? false,
        googleManagedByBudget: budget?.googleManagedByBudget ?? false,
      },
      automation: {
        exists: !!config,
        enabled: config?.enabled ?? false,
        templateIds: configTemplateIds,
        notifyUserCount: (parseJson<string[]>(config?.notifyUserIds ?? null) ?? []).length,
        emailEnabled: config?.emailEnabled ?? false,
        emailTemplateSlug: config?.emailTemplateId ?? null,
        emailTemplateOk: shellState(config?.emailTemplateId ?? null).ok,
        emailTemplateProblem: shellState(config?.emailTemplateId ?? null).problem,
        emailAudienceId: config?.emailAudienceId ?? null,
        // An audience belonging to another sub-account is worse than none: the
        // generator refuses it, so the draft silently lands untargeted.
        emailAudienceOk: config?.emailAudienceId
          ? audienceById.get(config.emailAudienceId)?.accountKey === key
          : false,
        lastOfferEmailAt: lastOfferEmailByAccount.get(key) ?? null,
      },
      feeds: (feedsByAccount.get(key) ?? []).map((f) => ({
        name: f.name,
        isActive: f.isActive,
        lastSyncedAt: f.lastSyncedAt,
        lastSyncStatus: f.lastSyncStatus,
        vehicleCount: f.vehicleCount,
      })),
      coop: coopFor(configTemplateIds, makes),
      lastAutomationRunAt,
      lastIngestRunAt: ingestByAccount.get(key) ?? null,
      now,
    });
  }

  return contexts;
}
