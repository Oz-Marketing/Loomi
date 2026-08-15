import type { AdCopyVariation } from './copy-types';
import type { SpecialAdCategory } from './launch-preset';

/**
 * Meta publish payloads — pure construction, no HTTP.
 *
 * Split out from the Graph client on purpose. The payload is where the mistakes
 * that matter live (a missing `page_id`, the wrong special ad category, an ad
 * created ACTIVE), and none of those need a network call to catch. So the shapes
 * are built and checked here under test, and the HTTP layer stays a thin wrapper
 * that posts what it's given.
 *
 * Everything is created PAUSED. Not timidity: the twenty minutes of assembly is
 * the part worth automating, and the one irreversible act — starting to spend — is
 * the part worth keeping human. It also means a v1 bug produces a wrong paused
 * campaign, which is an annoyance rather than an incident.
 */

/**
 * Meta wants minor units.
 *
 * The sign is checked BEFORE the string is sanitized. Stripping non-digits first
 * turns "-50" into "50", so a negative budget would silently publish as a positive
 * one — the sanitizer has to not be the thing that decides the sign.
 */
export function toMinorUnits(dollars: string | number | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null;
  const raw = String(dollars).trim();
  if (raw.startsWith('-')) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// ── what has to be true before publishing ────────────────────────────────────

export interface PublishInputs {
  pageId?: string | null;
  instagramActorId?: string | null;
  adAccountId?: string | null;
  /** Present only in attach mode. */
  targetAdSetId?: string | null;
  destinationUrl?: string | null;
  copy?: AdCopyVariation | null;
  /** How many rendered sizes are available to upload. */
  imageCount: number;
  mode: 'attach_existing' | 'create_new';
}

export interface Blocker {
  field: string;
  reason: string;
}

/**
 * Everything absent that would make the publish fail, checked BEFORE the first
 * platform call.
 *
 * Worth doing up front rather than discovering it in a Graph error: a launch that
 * fails on its third call has already created a campaign and an ad set that
 * nobody asked for, and cleaning that up is manual.
 */
export function publishBlockers(input: PublishInputs): Blocker[] {
  const out: Blocker[] = [];
  if (!input.adAccountId?.trim()) {
    out.push({ field: 'metaAdAccountId', reason: 'This sub-account has no Meta ad account set.' });
  }
  if (!input.pageId?.trim()) {
    // The hard one. A Meta ad creative cannot exist without a Page.
    out.push({
      field: 'metaPageId',
      reason:
        'No Facebook Page is confirmed for this sub-account. A Meta ad creative cannot be created without one — confirm the Page first.',
    });
  }
  if (!input.destinationUrl?.trim()) {
    out.push({ field: 'destinationUrl', reason: 'There is nowhere to send the click.' });
  }
  if (!input.copy?.meta.primaryText?.trim() || !input.copy?.meta.headline?.trim()) {
    out.push({ field: 'copy', reason: 'Meta requires both primary text and a headline.' });
  }
  if (input.imageCount < 1) {
    out.push({ field: 'images', reason: 'No rendered creative to upload.' });
  }
  if (input.mode === 'attach_existing' && !input.targetAdSetId?.trim()) {
    out.push({
      field: 'targetAdSetId',
      reason: 'Attach mode needs a target ad set. Pick the ad set this creative should be added to.',
    });
  }
  return out;
}

// ── special ad category agreement (attach mode) ──────────────────────────────

export interface CategoryMismatch {
  ok: boolean;
  reason: string;
}

/**
 * Does the EXISTING campaign carry the category this ad requires?
 *
 * `special_ad_categories` lives on the CAMPAIGN, not the ad or the ad set — so in
 * attach mode we cannot set it, we can only check it. Attaching a credit ad to a
 * campaign declared `NONE` publishes a financial-products ad outside the
 * restrictions Meta requires for one, which is a policy violation against an ad
 * account shared by every rooftop.
 *
 * So this refuses rather than warns. It is the one check in the attach path that
 * has to be a hard stop.
 */
export function categoryAgrees(
  campaignCategories: string[] | null | undefined,
  required: SpecialAdCategory[],
): CategoryMismatch {
  const have = new Set((campaignCategories ?? []).map((c) => c.toUpperCase()));
  const need = required.filter((c) => c !== 'NONE');

  if (need.length === 0) {
    // An ad needing nothing can live in a restricted campaign — it just inherits
    // tighter targeting, which is allowed and only costs reach.
    return { ok: true, reason: 'This ad needs no special ad category.' };
  }
  const missing = need.filter((c) => !have.has(c));
  if (missing.length === 0) {
    return { ok: true, reason: `The target campaign already declares ${need.join(', ')}.` };
  }
  return {
    ok: false,
    reason:
      `This ad requires the ${missing.join(', ')} special ad category, but the target campaign declares ` +
      `${have.size ? [...have].join(', ') : 'none'}. A campaign's category cannot be changed after creation, so this ` +
      `creative needs a campaign that already carries it — attaching it here would publish a credit ad outside ` +
      `Meta's required restrictions.`,
  };
}

// ── payloads ────────────────────────────────────────────────────────────────

/** `object_story_spec` — who the ad is from and what it shows. */
export function buildObjectStorySpec(params: {
  pageId: string;
  instagramActorId?: string | null;
  imageHash: string;
  link: string;
  copy: AdCopyVariation;
}): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    page_id: params.pageId,
    link_data: {
      image_hash: params.imageHash,
      link: params.link,
      message: params.copy.meta.primaryText,
      name: params.copy.meta.headline,
      ...(params.copy.meta.description ? { description: params.copy.meta.description } : {}),
      call_to_action: { type: 'LEARN_MORE' },
    },
  };
  // Omitted rather than sent empty: an empty actor id is rejected, and without it
  // the ad simply runs on Facebook placements instead of failing.
  if (params.instagramActorId?.trim()) spec.instagram_actor_id = params.instagramActorId.trim();
  return spec;
}

export function buildAdCreativePayload(params: {
  name: string;
  pageId: string;
  instagramActorId?: string | null;
  imageHash: string;
  link: string;
  copy: AdCopyVariation;
}): Record<string, unknown> {
  return {
    name: params.name,
    object_story_spec: buildObjectStorySpec(params),
    // Meta's automatic "enhancements" restate offers and crop images. On an ad
    // whose numbers are legally load-bearing and whose layout was co-op approved,
    // both are unacceptable — an OEM approved THIS plate, not Meta's remix of it.
    degrees_of_freedom_spec: {
      creative_features_spec: {
        standard_enhancements: { enroll_status: 'OPT_OUT' },
      },
    },
  };
}

/** One ad per creative, into an ad set. Always PAUSED. */
export function buildAdPayload(params: {
  name: string;
  adSetId: string;
  creativeId: string;
}): Record<string, unknown> {
  return {
    name: params.name,
    adset_id: params.adSetId,
    creative: { creative_id: params.creativeId },
    status: 'PAUSED',
  };
}

/** A new campaign. PAUSED, and carrying the derived categories. */
export function buildCampaignPayload(params: {
  name: string;
  objective: string;
  specialAdCategories: SpecialAdCategory[];
  bidStrategy?: string | null;
}): Record<string, unknown> {
  return {
    name: params.name,
    objective: params.objective,
    status: 'PAUSED',
    // Always sent, even as ['NONE']: the field is not optional for new campaigns,
    // and it can never be changed afterwards.
    special_ad_categories: params.specialAdCategories,
    ...(params.bidStrategy ? { bid_strategy: params.bidStrategy } : {}),
    buying_type: 'AUCTION',
  };
}

/**
 * Targeting for a NEW ad set.
 *
 * Note the gap this exposes: Meta expresses a radius as a lat/long plus a
 * distance, and Loomi stores a zip. Converting one to the other needs geocoding
 * that doesn't exist here yet — so `create_new` cannot produce radius targeting
 * today, and passes the zip through as a plain zip. That is FINE for a
 * non-financing ad and INVALID for a credit one, where zip targeting is
 * unavailable and a radius is mandatory.
 *
 * Which is the strongest practical argument for attach-first: an existing ad set
 * already carries valid targeting, so the monthly refresh needs none of this.
 */
export function buildAdSetTargeting(params: {
  geoZip?: string | null;
  radiusMiles: number;
  requiresRadius: boolean;
}): { targeting: Record<string, unknown> | null; blocker: string | null } {
  if (params.requiresRadius) {
    return {
      targeting: null,
      blocker:
        'A financial-products ad must target a radius, and building one needs the zip geocoded to a lat/long — which Loomi cannot do yet. Attach this creative to an existing ad set instead, or create the campaign in Ads Manager once and attach to it every month after.',
    };
  }
  if (!params.geoZip?.trim()) {
    return { targeting: null, blocker: 'No geo target: the preset has no zip.' };
  }
  return {
    targeting: {
      geo_locations: { zips: [{ key: `US:${params.geoZip.trim()}` }] },
      age_min: 18,
    },
    blocker: null,
  };
}

export function buildAdSetPayload(params: {
  name: string;
  campaignId: string;
  dailyBudget?: string | null;
  targeting: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  endTime?: string | null;
}): Record<string, unknown> {
  const budget = toMinorUnits(params.dailyBudget);
  return {
    name: params.name,
    campaign_id: params.campaignId,
    status: 'PAUSED',
    targeting: params.targeting,
    optimization_goal: params.optimizationGoal ?? 'LINK_CLICKS',
    billing_event: params.billingEvent ?? 'IMPRESSIONS',
    ...(budget ? { daily_budget: budget } : {}),
    ...(params.endTime ? { end_time: params.endTime } : {}),
  };
}
