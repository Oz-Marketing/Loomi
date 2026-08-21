import { prisma } from '@/lib/prisma';
import {
  createAd,
  createAdCreative,
  fetchAdSetForPublish,
  getMetaConfig,
  uploadAdImage,
  uploadAdVideo,
  waitForVideoReady,
} from '@/lib/integrations/meta-ads';
import type { AdCopyVariation } from '../copy-types';
import type { TemplateDoc } from '../doc-types';
import type { AdData } from '../types';
import { approvalStatusFor } from '../coop-approval-store';
import { loadActiveCoopPack } from '../coop-pack-store';
import { deterministicCopy } from './generate-copy';
import { resolveLaunch, type PresetRow } from '../launch-preset';
import {
  buildAdCreativePayload,
  buildAdPayload,
  categoryAgrees,
  publishBlockers,
  type Blocker,
  type CreativeAsset,
} from '../meta-publish';
import { preflight, summarizePreflight } from '../preflight';
import { mergeRenderData, renderCreativeSizes } from '../render-creative';
import { motionExportAvailable, renderMotionSizes } from '../render-motion';
import { docHasMotion } from '../motion-plan';
import { vehicleFromData } from '../vehicle-fields';

/**
 * Publish one generated ad into Meta — attach mode.
 *
 * ORDER MATTERS, and it is: check everything that can be checked without a write,
 * write the AdLaunch row, then write to Meta. A launch that fails on its third
 * Graph call has already created objects nobody asked for, and cleaning those up
 * is manual — so the cheap refusals all happen first.
 *
 * The ad is created PAUSED. Activation is a separate, explicit call.
 *
 * Server-only. Cannot be exercised without a live token, so everything that CAN be
 * decided without one lives in `meta-publish.ts` under test.
 */

export interface LaunchResult {
  launchId: string | null;
  status: 'published' | 'failed' | 'blocked';
  /** Why it can't proceed, when it can't. */
  blockers: Blocker[];
  adSetId?: string | null;
  campaignId?: string | null;
  adIds?: Record<string, string>;
  pacerAdId?: string | null;
  error?: string;
  /** Things a person should know, but which didn't stop the launch. */
  notices: string[];
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** yyyy-mm-dd in UTC — the pacer stores flight dates as plain strings. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Create (or update) the pacer row for a launch.
 *
 * THIS IS THE POINT OF LAUNCHING FROM LOOMI. Ads Manager can create a campaign;
 * it cannot create one that is already pacing-instrumented, already sitting in the
 * right month's plan, and already carrying its allocation. Doing it here at
 * creation time closes the loop that `discover`/`import` currently closes by hand,
 * later, if someone remembers.
 *
 * Best-effort: a pacer failure must not present as a failed launch, because the ad
 * genuinely exists on Meta by this point. It's reported as a notice instead.
 */
async function backLinkToPacer(params: {
  accountKey: string;
  name: string;
  adSetId: string;
  allocation: string | null;
  flightStart: Date;
  flightEnd: Date;
  notices: string[];
}): Promise<string | null> {
  try {
    const plan = await prisma.metaAdsPacerPlan.upsert({
      where: { accountKey: params.accountKey },
      create: { accountKey: params.accountKey },
      update: {},
      select: { id: true },
    });
    const period = params.flightStart.toISOString().slice(0, 7); // YYYY-MM

    // Don't duplicate a row for an ad set the pacer already tracks — a second
    // launch into the same ad set is a creative refresh, not a new budget line.
    const existing = await prisma.metaAdsPacerAd.findFirst({
      where: { planId: plan.id, metaObjectId: params.adSetId, period },
      select: { id: true },
    });
    if (existing) {
      params.notices.push(
        'The pacer already tracks this ad set for this month, so no second budget line was created.',
      );
      return existing.id;
    }

    const row = await prisma.metaAdsPacerAd.create({
      data: {
        planId: plan.id,
        name: params.name,
        period,
        platform: 'meta',
        // Linked at birth — this is what `discover`/`import` exists to do after
        // the fact, and it is why the row is worth creating here.
        metaObjectType: 'adset',
        metaObjectId: params.adSetId,
        flightStart: isoDate(params.flightStart),
        flightEnd: isoDate(params.flightEnd),
        allocation: params.allocation,
        adStatus: 'In Draft',
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    params.notices.push(
      `The ad was created on Meta, but its pacer row could not be written (${
        err instanceof Error ? err.message : 'unknown error'
      }). Link it with Discover/Import.`,
    );
    return null;
  }
}

export async function launchToMeta(params: {
  creativeId: string;
  requestedById?: string | null;
  requestedByName?: string | null;
  now?: Date;
}): Promise<LaunchResult> {
  const now = params.now ?? new Date();
  const notices: string[] = [];

  const ad = await prisma.adCreative.findUnique({
    where: { id: params.creativeId },
    select: {
      id: true,
      name: true,
      accountKey: true,
      templateId: true,
      doc: true,
      data: true,
      copy: true,
      offerFingerprint: true,
      expiresAt: true,
      status: true,
    },
  });
  if (!ad) return { launchId: null, status: 'blocked', blockers: [{ field: 'ad', reason: 'Ad not found.' }], notices };

  const doc = safeJson<TemplateDoc>(ad.doc);
  if (!doc) {
    return {
      launchId: null,
      status: 'blocked',
      blockers: [{ field: 'doc', reason: 'This ad has no renderable design.' }],
      notices,
    };
  }
  const data = safeJson<AdData>(ad.data) ?? ({} as AdData);
  const vehicle = vehicleFromData(data);
  const make = (vehicle.make || doc.make || '').trim();

  const account = await prisma.account.findUnique({
    where: { key: ad.accountKey },
    select: { dealer: true, website: true, metaAdAccountId: true, metaPageId: true, metaInstagramActorId: true },
  });

  let preset: PresetRow & { targetAdSetId?: string | null; launchMode?: string } | null = null;
  try {
    preset = (await prisma.adLaunchPreset.findUnique({
      where: { accountKey_platform: { accountKey: ad.accountKey, platform: 'meta' } },
    })) as (PresetRow & { targetAdSetId?: string | null; launchMode?: string }) | null;
  } catch {
    preset = null;
  }

  const stored = safeJson<AdCopyVariation>(ad.copy);
  const copy =
    stored ??
    deterministicCopy({
      data,
      dealerName: account?.dealer ?? '',
      vehicle: { year: Number(vehicle.year) || now.getFullYear(), make: vehicle.make, model: vehicle.model },
    });

  const launch = resolveLaunch({
    preset,
    data,
    texts: [
      data.disclaimer,
      data.terms,
      copy.meta.primaryText,
      copy.meta.headline,
      copy.meta.description,
      ...copy.google.headlines,
      ...copy.google.descriptions,
    ],
    fallbackUrl: account?.website ?? null,
    availableSizeIds: doc.sizes.map((s) => s.id),
  });
  notices.push(...launch.notices);

  const mode = (preset?.launchMode === 'create_new' ? 'create_new' : 'attach_existing') as
    | 'attach_existing'
    | 'create_new';
  if (mode === 'create_new') {
    // Refused rather than half-built: creating an ad set needs radius targeting
    // that requires geocoding Loomi doesn't have (see buildAdSetTargeting).
    return {
      launchId: null,
      status: 'blocked',
      blockers: [
        {
          field: 'launchMode',
          reason:
            'Creating a new campaign from Loomi is not available yet — it needs radius targeting that requires geocoding. Create the campaign once in Ads Manager, then set this account to attach to its ad set.',
        },
      ],
      notices,
    };
  }

  // ── everything checkable without a write ──
  //
  // Whether this ad MOVES is one of those things. A video ad needs an encoder on
  // this server, and finding that out after the AdLaunch row is written means a
  // failed launch and a row to clean up.
  const isMotionAd = docHasMotion(doc, mergeRenderData(doc, data), launch.sizeIds.length ? launch.sizeIds : undefined);
  const blockers = publishBlockers({
    pageId: account?.metaPageId,
    instagramActorId: account?.metaInstagramActorId,
    adAccountId: account?.metaAdAccountId,
    targetAdSetId: preset?.targetAdSetId,
    destinationUrl: launch.destinationUrl,
    copy,
    imageCount: launch.sizeIds.length,
    mode,
    motion: isMotionAd,
    videoExportAvailable: isMotionAd ? await motionExportAvailable() : true,
  });
  if (blockers.length) return { launchId: null, status: 'blocked', blockers, notices };

  const cfg = getMetaConfig();
  if (!cfg) {
    return {
      launchId: null,
      status: 'blocked',
      blockers: [{ field: 'token', reason: 'META_SYSTEM_USER_TOKEN is not configured in this environment.' }],
      notices,
    };
  }

  // Compliance re-check at launch, against the CURRENT pack — an ad approved three
  // weeks ago against a since-revised guideline must not publish silently.
  const coopEntry = make ? await loadActiveCoopPack(make, now) : null;
  const renderData = mergeRenderData(doc, data);
  const pf = preflight({
    doc,
    data: renderData,
    coopPack: coopEntry?.pack ?? null,
    sizeIds: launch.sizeIds,
  });
  if (!pf.ok) {
    return {
      launchId: null,
      status: 'blocked',
      blockers: [{ field: 'preflight', reason: `Preflight fails now: ${summarizePreflight(pf)}` }],
      notices,
    };
  }
  if (make) {
    const approval = await approvalStatusFor({
      templateId: ad.templateId,
      doc,
      make,
      activePackVersion: coopEntry?.pack.version ?? null,
    });
    if (approval.state !== 'current' && approval.state !== 'none') notices.push(approval.reason);
  }

  // The target ad set's campaign decides whether this ad may legally join it.
  let adSet;
  try {
    adSet = await fetchAdSetForPublish(cfg, preset!.targetAdSetId!);
  } catch (err) {
    return {
      launchId: null,
      status: 'blocked',
      blockers: [
        {
          field: 'targetAdSetId',
          reason: `Could not read the target ad set: ${err instanceof Error ? err.message : 'unknown error'}`,
        },
      ],
      notices,
    };
  }
  const agreement = categoryAgrees(adSet.specialAdCategories, launch.specialAdCategories);
  if (!agreement.ok) {
    return {
      launchId: null,
      status: 'blocked',
      blockers: [{ field: 'specialAdCategories', reason: agreement.reason }],
      notices,
    };
  }
  notices.push(agreement.reason);

  // ── the row goes in BEFORE the first write ──
  //
  // `AdCreative.offerFingerprint` already holds the VEHICLE-SCOPED key despite its
  // name — generation writes `creativeOfferKey(vehicle, offerFingerprint(inc))`
  // into it, precisely because of the Silverado collision. So this is the right
  // value for AdLaunch.offerKey, and reading the name alone would suggest
  // otherwise.
  const offerKey = ad.offerFingerprint ?? null;
  const payload = JSON.stringify({ launch, copy, adSet, resolvedAt: now.toISOString() });
  let launchRow;
  try {
    launchRow = await prisma.adLaunch.create({
      data: {
        accountKey: ad.accountKey,
        platform: 'meta',
        mode,
        creativeIds: JSON.stringify([ad.id]),
        offerKey,
        status: 'publishing',
        payload,
        platformAdSetId: adSet.id,
        platformCampaignId: adSet.campaignId,
        requestedById: params.requestedById ?? null,
        requestedByName: params.requestedByName ?? null,
      },
    });
  } catch (err) {
    // The partial unique index is what lands here: a live launch already exists
    // for this offer, which is exactly the duplicate spend it exists to prevent.
    return {
      launchId: null,
      status: 'blocked',
      blockers: [
        {
          field: 'offerKey',
          reason:
            'This offer already has a launch in flight or published for Meta. Cancel that one first if you need to republish. ' +
            (err instanceof Error ? err.message : ''),
        },
      ],
      notices,
    };
  }

  // ── writes ──
  try {
    const sizeIds = launch.sizeIds.length ? launch.sizeIds : undefined;
    const adAccountId = account!.metaAdAccountId!;
    // What Meta ends up pointing at: an image hash, or a video id + its poster.
    let asset: CreativeAsset;
    // Everything uploaded, recorded whether or not this ad uses it — so the
    // placement-specific follow-on never has to re-upload.
    const platformRefs: Record<string, string> = {};

    /**
     * ONE ad, using the squarest render.
     *
     * Meta's `link_data` (and `video_data`) carries a single asset, and creating
     * one ad per size would put near-identical ads in competition with each other
     * inside the same ad set — splitting delivery and learning for no gain.
     * Per-placement assets need `asset_feed_spec`, which is a follow-on.
     */
    const pickPreferred = <T extends { width: number; height: number }>(list: T[]): T =>
      list.find((r) => r.width === r.height) ?? list.find((r) => r.width > r.height) ?? list[0];

    if (isMotionAd) {
      // A moving ad publishes as a VIDEO creative. The poster comes from the same
      // renderer, so the thumbnail Meta shows is the frame the video opens on.
      const rendered = await renderMotionSizes({ doc, data, accountKey: ad.accountKey, sizeIds });
      if (!rendered.length) throw new Error('The creative rendered no video sizes.');
      notices.push(...new Set(rendered.flatMap((r) => r.warnings)));

      const preferred = pickPreferred(rendered);
      const dims = `${preferred.width}x${preferred.height}`;
      const { hash: thumbnailHash } = await uploadAdImage(cfg, adAccountId, preferred.poster, `${ad.id}-${dims}-poster.png`);
      const { videoId } = await uploadAdVideo(cfg, adAccountId, preferred.mp4, `${ad.id}-${dims}.mp4`);
      // Meta encodes asynchronously; a creative built on a still-processing video
      // fails with an error that reads like a bad id.
      const ready = await waitForVideoReady(cfg, videoId);
      if (!ready) {
        notices.push(
          'Facebook was still processing the video when the ad was created. If the ad shows no video, give it a few minutes and refresh in Ads Manager.',
        );
      }
      asset = { video: { videoId, thumbnailHash } };
      platformRefs[dims] = `video:${videoId}`;
      platformRefs[`${dims}-poster`] = thumbnailHash;
      if (rendered.length > 1) {
        notices.push(
          `Published the ${dims} video. The other ${rendered.length - 1} size(s) were rendered but not uploaded — Meta takes one asset per ad.`,
        );
      }
    } else {
      const rendered = await renderCreativeSizes({ doc, data, accountKey: ad.accountKey, sizeIds });
      if (!rendered.length) throw new Error('The creative rendered no sizes.');

      for (const r of rendered) {
        const { hash } = await uploadAdImage(cfg, adAccountId, r.png, `${ad.id}-${r.width}x${r.height}.png`);
        platformRefs[`${r.width}x${r.height}`] = hash;
      }
      const preferred = pickPreferred(rendered);
      asset = { imageHash: platformRefs[`${preferred.width}x${preferred.height}`] };
      if (rendered.length > 1) {
        notices.push(
          `Published the ${preferred.width}×${preferred.height} render. The other ${rendered.length - 1} size(s) were uploaded to the ad account's image library for placement-specific assets later.`,
        );
      }
    }

    const creativeId = await createAdCreative(
      cfg,
      adAccountId,
      buildAdCreativePayload({
        name: `${ad.name} — Loomi`,
        pageId: account!.metaPageId!,
        instagramActorId: account?.metaInstagramActorId,
        ...asset,
        link: launch.destinationUrl!,
        copy,
      }),
    );

    const adId = await createAd(
      cfg,
      account!.metaAdAccountId!,
      buildAdPayload({ name: ad.name, adSetId: adSet.id, creativeId }),
    );

    const flightStart = now;
    const flightEnd = ad.expiresAt ?? new Date(now.getTime() + launch.flightDays * 86400000);
    const pacerAdId = await backLinkToPacer({
      accountKey: ad.accountKey,
      name: ad.name,
      adSetId: adSet.id,
      allocation: launch.dailyBudget,
      flightStart,
      flightEnd,
      notices,
    });

    await prisma.adLaunch.update({
      where: { id: launchRow.id },
      data: {
        status: 'published',
        finishedAt: new Date(),
        platformAdIds: JSON.stringify({ [ad.id]: adId }),
        platformImageRefs: JSON.stringify(platformRefs),
        pacerAdId,
      },
    });

    return {
      launchId: launchRow.id,
      status: 'published',
      blockers: [],
      adSetId: adSet.id,
      campaignId: adSet.campaignId,
      adIds: { [ad.id]: adId },
      pacerAdId,
      notices,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Marked failed rather than left `publishing`: the partial unique index only
    // excludes terminal states, so a stuck `publishing` row would block every
    // retry — the precise defect the index was designed around.
    await prisma.adLaunch
      .update({ where: { id: launchRow.id }, data: { status: 'failed', finishedAt: new Date(), error: message } })
      .catch(() => null);
    return { launchId: launchRow.id, status: 'failed', blockers: [], error: message, notices };
  }
}
