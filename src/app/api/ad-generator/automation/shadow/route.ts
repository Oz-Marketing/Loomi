/**
 * Shadow-mode API — /api/ad-generator/automation/shadow
 *
 * GET  → the Phase 1 shadow report for a sub-account (feeds + freshness, watched
 *        vehicles + offer cycle states, measured per-OEM lead times, run history).
 * POST → setup and on-demand triggers:
 *          save_config | add_feed | remove_feed | sync_feeds | poll_offers
 *
 * The two run actions exist because waiting for the 06:00 UTC cron to see whether
 * anything works is not a workable feedback loop. They call exactly the same
 * service functions the worker calls, so triggering by hand and letting the cron
 * fire are the same code path.
 *
 * Still shadow mode: nothing here creates a creative or renders anything.
 * Admin-only — it burns MarketCheck quota and exposes raw feed data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { buildShadowReport } from '@/lib/ad-generator/automation/shadow-report';
import { pollAccountOffers, type AutomationConfigRow } from '@/lib/ad-generator/automation/poll-offers';
import { syncAllInventoryFeeds } from '@/lib/ad-generator/automation/sync-inventory';
import { expireStaleAds } from '@/lib/ad-generator/automation/expire-ads';
import {
  generateForAccount,
  GENERATE_CONFIG_SELECT,
  type GenerateConfigRow,
} from '@/lib/ad-generator/automation/generate-ads';
import type { SelectableOfferType } from '@/lib/ad-generator/automation/select-offer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A poll fans out one MarketCheck lookup per watched vehicle, each with up to
// four fallback passes; a feed sync pulls every configured URL.
export const maxDuration = 300;

/** Coerce a client-supplied number into a sane range, falling back on nonsense. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function gate(accountKey: string) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requirePermission('studio.adgen.generate');
  if (error) return error;
  if (!accountKey) return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  return null;
}

export async function GET(req: NextRequest) {
  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;

  try {
    return NextResponse.json(await buildShadowReport(accountKey));
  } catch (err) {
    console.error('[api/adgen/automation/shadow] GET failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not build the shadow report' },
      { status: 500 },
    );
  }
}

/** The config columns the poll needs, in the shape it expects. */
const CONFIG_SELECT = {
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
} as const;

export async function POST(req: NextRequest) {
  let body: {
    accountKey?: string;
    action?: string;
    // generate
    scope?: { vehicles?: unknown[]; offerTypes?: unknown[] };
    // save_config
    enabled?: boolean;
    makes?: string[];
    focusModels?: string[];
    excludeModels?: string[];
    zip?: string;
    runWindowMode?: string;
    offerTypePriority?: string[];
    /** offerType (or `all`) → AdTemplateDoc id. */
    templateMap?: Record<string, string>;
    sizeIds?: string[];
    maxAdsPerRun?: number;
    minStock?: number;
    radius?: number;
    mode?: string;
    // add_feed / remove_feed
    name?: string;
    url?: string;
    storeCode?: string;
    feedId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;

  try {
    switch (body.action) {
      case 'save_config': {
        // Derive make + ZIP from the sub-account when not supplied, so enabling
        // a sub-account needs no typing.
        const account = await prisma.account.findUnique({
          where: { key: accountKey },
          select: { oem: true, oems: true, postalCode: true },
        });
        const fallbackMakes = body.makes?.length
          ? body.makes
          : account?.oem
            ? [account.oem]
            : [];
        const data = {
          enabled: body.enabled ?? false,
          makes: JSON.stringify(fallbackMakes),
          focusModels: JSON.stringify(body.focusModels ?? []),
          excludeModels: JSON.stringify(body.excludeModels ?? []),
          zip: (body.zip ?? account?.postalCode ?? '').trim() || null,
          runWindowMode: ['current_month', 'next_month', 'rolling'].includes(body.runWindowMode ?? '')
            ? body.runWindowMode!
            : 'next_month',
          offerTypePriority: JSON.stringify(
            (body.offerTypePriority ?? ['lease', 'apr', 'cash']).filter((t) =>
              ['lease', 'apr', 'cash'].includes(t),
            ),
          ),
          // Drop empty selections so an unset dropdown clears the mapping rather
          // than storing a blank id the resolver would have to skip past.
          templateMap: JSON.stringify(
            Object.fromEntries(
              Object.entries(body.templateMap ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()),
            ),
          ),
          // Clamped rather than trusted: a 0 or negative cap would mean "generate
          // nothing" while looking like a limit, and an unbounded one could render
          // hundreds of ads in a single run.
          // Empty = every size the template defines, which is both the old
          // behaviour and the right default: a size list is an optimisation, and
          // an accidental empty one shouldn't silently stop rendering.
          sizeIds:
            Array.isArray(body.sizeIds) && body.sizeIds.length
              ? JSON.stringify(body.sizeIds.filter((x) => typeof x === 'string' && x.trim()))
              : null,
          maxAdsPerRun: clamp(body.maxAdsPerRun, 1, 100, 10),
          minStock: clamp(body.minStock, 0, 500, 0),
          radius: clamp(body.radius, 5, 500, 75),
          mode: body.mode === 'ready' ? 'ready' : 'draft',
        };
        const row = await prisma.adAutomationConfig.upsert({
          where: { accountKey },
          create: { accountKey, ...data },
          update: data,
        });
        return NextResponse.json({ ok: true, config: { accountKey: row.accountKey, enabled: row.enabled } });
      }

      case 'add_feed': {
        const url = (body.url ?? '').trim();
        const name = (body.name ?? '').trim() || url.split('/').pop() || 'Inventory feed';
        if (!/^https?:\/\//i.test(url)) {
          return NextResponse.json({ error: 'A http(s) feed URL is required' }, { status: 400 });
        }
        const row = await prisma.inventoryFeed.upsert({
          where: { accountKey_url: { accountKey, url } },
          create: { accountKey, name, url, storeCode: body.storeCode?.trim() || null },
          update: { name, storeCode: body.storeCode?.trim() || null, isActive: true },
        });
        return NextResponse.json({ ok: true, feed: { id: row.id, name: row.name } });
      }

      case 'remove_feed': {
        const feedId = (body.feedId ?? '').trim();
        if (!feedId) return NextResponse.json({ error: 'feedId is required' }, { status: 400 });
        // Scope the delete to this sub-account so a feed id from elsewhere can't
        // be removed by swapping the key.
        const deleted = await prisma.inventoryFeed.deleteMany({ where: { id: feedId, accountKey } });
        return NextResponse.json({ ok: true, removed: deleted.count });
      }

      case 'sync_feeds': {
        const result = await syncAllInventoryFeeds(accountKey);
        return NextResponse.json({ ok: true, feeds: result.feeds, runId: result.runId });
      }

      case 'poll_offers': {
        const config = (await prisma.adAutomationConfig.findUnique({
          where: { accountKey },
          select: CONFIG_SELECT,
        })) as AutomationConfigRow | null;
        if (!config) {
          return NextResponse.json(
            { error: 'Save the automation config for this sub-account first' },
            { status: 400 },
          );
        }
        const account = await prisma.account.findUnique({
          where: { key: accountKey },
          select: { oem: true, oems: true, postalCode: true },
        });
        let fallbackMakes: string[] = [];
        if (account) {
          try {
            const multi = JSON.parse(account.oems ?? '[]');
            fallbackMakes = Array.isArray(multi) && multi.length
              ? multi.filter((m): m is string => typeof m === 'string')
              : account.oem
                ? [account.oem]
                : [];
          } catch {
            fallbackMakes = account.oem ? [account.oem] : [];
          }
        }
        const cfg = config.zip
          ? config
          : { ...config, zip: account?.postalCode ?? null };
        const result = await pollAccountOffers(cfg, { fallbackMakes });
        return NextResponse.json({
          ok: true,
          runId: result.runId,
          scopes: result.scopes.length,
          offersSeen: result.offersSeen,
          offersNew: result.offersNew,
          offersEnded: result.offersEnded,
        });
      }

      case 'generate': {
        const config = (await prisma.adAutomationConfig.findUnique({
          where: { accountKey },
          select: GENERATE_CONFIG_SELECT,
        })) as GenerateConfigRow | null;
        if (!config) {
          return NextResponse.json(
            { error: 'Save the automation config for this sub-account first' },
            { status: 400 },
          );
        }
        // Optional per-run narrowing from the Generate dialog. Validated hard:
        // these come from a client, and an unrecognised offer type reaching
        // `selectOffer` would reject every incentive without saying why.
        const rawVehicles = Array.isArray(body.scope?.vehicles) ? body.scope!.vehicles! : [];
        const rawTypes = Array.isArray(body.scope?.offerTypes) ? body.scope!.offerTypes! : [];
        const scope = {
          vehicles: rawVehicles.filter((v): v is string => typeof v === 'string' && !!v.trim()),
          offerTypes: rawTypes.filter((t): t is SelectableOfferType =>
            t === 'lease' || t === 'apr' || t === 'cash',
          ),
        };
        const result = await generateForAccount(config, { scope });
        return NextResponse.json({
          ok: true,
          runId: result.runId,
          created: result.generated.filter((g) => !g.updated).length,
          refreshed: result.generated.filter((g) => g.updated).length,
          generated: result.generated,
          skipped: result.skipped,
        });
      }

      case 'expire': {
        const r = await expireStaleAds(accountKey);
        return NextResponse.json({
          ok: true,
          runId: r.runId,
          demoted: r.demoted.length,
          annotated: r.annotated,
          details: r.demoted,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[api/adgen/automation/shadow] ${body.action} failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 },
    );
  }
}
