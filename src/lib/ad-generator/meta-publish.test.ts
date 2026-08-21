import { describe, it, expect } from 'vitest';
import type { AdCopyVariation } from './copy-types';
import {
  buildAdCreativePayload,
  buildAdPayload,
  buildAdSetPayload,
  buildAdSetTargeting,
  buildCampaignPayload,
  buildObjectStorySpec,
  categoryAgrees,
  publishBlockers,
  toMinorUnits,
} from './meta-publish';

function copy(): AdCopyVariation {
  return {
    fields: {},
    meta: { primaryText: '2026 Trax — $311/mo.', headline: '$311/mo — Trax', description: 'Per month lease' },
    google: { headlines: ['a', 'b', 'c'], descriptions: ['d', 'e'] },
  };
}

const OK_INPUTS = {
  pageId: '1234',
  adAccountId: 'act_999',
  targetAdSetId: '5678',
  destinationUrl: 'https://youngchevy.com/new/trax?utm_source=meta',
  copy: copy(),
  imageCount: 3,
  mode: 'attach_existing' as const,
};

describe('toMinorUnits', () => {
  it('converts dollars to cents', () => {
    expect(toMinorUnits('50')).toBe(5000);
    expect(toMinorUnits('49.99')).toBe(4999);
    expect(toMinorUnits('$1,200')).toBe(120000);
  });

  it('rejects nothing and non-positive amounts', () => {
    expect(toMinorUnits(null)).toBeNull();
    expect(toMinorUnits('')).toBeNull();
    expect(toMinorUnits('0')).toBeNull();
    expect(toMinorUnits('-5')).toBeNull();
  });
});

describe('publishBlockers', () => {
  it('passes a complete attach-mode launch', () => {
    expect(publishBlockers(OK_INPUTS)).toEqual([]);
  });

  it('blocks a missing Page — the hard one', () => {
    // A Meta ad creative cannot be created without object_story_spec.page_id.
    const b = publishBlockers({ ...OK_INPUTS, pageId: null });
    expect(b).toHaveLength(1);
    expect(b[0].field).toBe('metaPageId');
    expect(b[0].reason).toContain('cannot be created without one');
  });

  it('blocks a missing ad account, destination, copy, and images', () => {
    const b = publishBlockers({
      ...OK_INPUTS,
      adAccountId: null,
      destinationUrl: '',
      copy: null,
      imageCount: 0,
    });
    expect(b.map((x) => x.field).sort()).toEqual(['copy', 'destinationUrl', 'images', 'metaAdAccountId']);
  });

  it('blocks attach mode with no target ad set', () => {
    const b = publishBlockers({ ...OK_INPUTS, targetAdSetId: null });
    expect(b[0].field).toBe('targetAdSetId');
  });

  it('does not require a target ad set in create mode', () => {
    expect(publishBlockers({ ...OK_INPUTS, mode: 'create_new', targetAdSetId: null })).toEqual([]);
  });

  it('blocks copy with a headline but no primary text', () => {
    const c = copy();
    c.meta.primaryText = '';
    expect(publishBlockers({ ...OK_INPUTS, copy: c })[0].field).toBe('copy');
  });
});

describe('categoryAgrees', () => {
  it('refuses to attach a credit ad to an unrestricted campaign', () => {
    // The category lives on the CAMPAIGN and cannot be changed after creation, so
    // in attach mode this is the one check that has to be a hard stop.
    const r = categoryAgrees(['NONE'], ['FINANCIAL_PRODUCTS_SERVICES']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('cannot be changed after creation');
  });

  it('refuses when the campaign declares no categories at all', () => {
    expect(categoryAgrees([], ['FINANCIAL_PRODUCTS_SERVICES']).ok).toBe(false);
    expect(categoryAgrees(null, ['FINANCIAL_PRODUCTS_SERVICES']).ok).toBe(false);
  });

  it('accepts when the campaign already carries it', () => {
    const r = categoryAgrees(['FINANCIAL_PRODUCTS_SERVICES'], ['FINANCIAL_PRODUCTS_SERVICES']);
    expect(r.ok).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(categoryAgrees(['financial_products_services'], ['FINANCIAL_PRODUCTS_SERVICES']).ok).toBe(true);
  });

  it('lets an unrestricted ad live in a restricted campaign', () => {
    // It only inherits tighter targeting, which is allowed and merely costs reach.
    expect(categoryAgrees(['FINANCIAL_PRODUCTS_SERVICES'], ['NONE']).ok).toBe(true);
  });
});

describe('publishBlockers — video', () => {
  const ok = {
    pageId: '1',
    adAccountId: 'act_1',
    destinationUrl: 'https://d.com',
    copy: copy(),
    imageCount: 1,
    mode: 'attach_existing' as const,
    targetAdSetId: '5',
  };

  it('refuses a motion ad on a server with no encoder, before anything is written', () => {
    const blockers = publishBlockers({ ...ok, motion: true, videoExportAvailable: false });
    expect(blockers.map((b) => b.field)).toContain('video');
  });

  it('allows a motion ad when the encoder is there', () => {
    expect(publishBlockers({ ...ok, motion: true, videoExportAvailable: true })).toEqual([]);
  });

  it('ignores the encoder entirely for a still ad', () => {
    expect(publishBlockers({ ...ok, videoExportAvailable: false })).toEqual([]);
  });
});

describe('buildObjectStorySpec', () => {
  const base = { pageId: '1234', imageHash: 'abc', link: 'https://d.com', copy: copy() };

  it('carries the page, image, link and copy', () => {
    const spec = buildObjectStorySpec(base) as {
      page_id: string;
      link_data: Record<string, unknown>;
    };
    expect(spec.page_id).toBe('1234');
    expect(spec.link_data.image_hash).toBe('abc');
    expect(spec.link_data.message).toBe('2026 Trax — $311/mo.');
    expect(spec.link_data.name).toBe('$311/mo — Trax');
  });

  it('omits the Instagram actor when absent rather than sending it empty', () => {
    // An empty actor id is rejected; omitting it just means Facebook placements.
    expect(buildObjectStorySpec(base)).not.toHaveProperty('instagram_actor_id');
    expect(buildObjectStorySpec({ ...base, instagramActorId: '  ' })).not.toHaveProperty('instagram_actor_id');
    expect(buildObjectStorySpec({ ...base, instagramActorId: '99' })).toHaveProperty('instagram_actor_id', '99');
  });

  it('omits an empty description', () => {
    const c = copy();
    c.meta.description = '';
    const spec = buildObjectStorySpec({ ...base, copy: c }) as { link_data: Record<string, unknown> };
    expect(spec.link_data).not.toHaveProperty('description');
  });

  it('builds video_data — not link_data — for a clip, with the link on the CTA', () => {
    // `video_data` has no `link` of its own. Sending one there and none on the
    // call to action publishes an ad with nowhere to click.
    const spec = buildObjectStorySpec({
      pageId: '1234',
      video: { videoId: 'v9', thumbnailHash: 'thumb' },
      link: 'https://d.com',
      copy: copy(),
    }) as { page_id: string; video_data: Record<string, unknown>; link_data?: unknown };
    expect(spec.link_data).toBeUndefined();
    expect(spec.video_data.video_id).toBe('v9');
    expect(spec.video_data.image_hash).toBe('thumb');
    expect(spec.video_data.title).toBe('$311/mo — Trax');
    expect(spec.video_data.message).toBe('2026 Trax — $311/mo.');
    expect(spec.video_data.call_to_action).toEqual({ type: 'LEARN_MORE', value: { link: 'https://d.com' } });
  });

  it('maps the description to link_description on a video', () => {
    const spec = buildObjectStorySpec({
      pageId: '1',
      video: { videoId: 'v', thumbnailHash: 't' },
      link: 'https://d.com',
      copy: copy(),
    }) as { video_data: Record<string, unknown> };
    expect(spec.video_data.link_description).toBe(copy().meta.description);
  });

  it('refuses a spec with no asset at all', () => {
    expect(() => buildObjectStorySpec({ pageId: '1', link: 'https://d.com', copy: copy() })).toThrow(/imageHash or a video/);
  });
});

describe('buildAdCreativePayload', () => {
  it('opts out of Meta’s standard enhancements', () => {
    // Meta's auto-enhancements restate offers and crop images. On an ad whose
    // numbers are legally load-bearing and whose layout was co-op approved, an
    // OEM approved THIS plate — not Meta's remix of it.
    const p = buildAdCreativePayload({
      name: 'ad',
      pageId: '1',
      imageHash: 'h',
      link: 'https://d.com',
      copy: copy(),
    }) as { degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: string } } } };
    expect(p.degrees_of_freedom_spec.creative_features_spec.standard_enhancements.enroll_status).toBe('OPT_OUT');
  });
});

describe('buildAdPayload', () => {
  it('is always PAUSED', () => {
    const p = buildAdPayload({ name: 'ad', adSetId: '5', creativeId: '9' });
    expect(p.status).toBe('PAUSED');
    expect(p.adset_id).toBe('5');
    expect(p.creative).toEqual({ creative_id: '9' });
  });
});

describe('buildCampaignPayload', () => {
  it('is PAUSED and always states the categories', () => {
    const p = buildCampaignPayload({
      name: 'August lease',
      objective: 'OUTCOME_TRAFFIC',
      specialAdCategories: ['FINANCIAL_PRODUCTS_SERVICES'],
    });
    expect(p.status).toBe('PAUSED');
    expect(p.special_ad_categories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
  });

  it('sends NONE explicitly rather than omitting the field', () => {
    // It isn't optional on a new campaign, and it can never be changed afterwards.
    expect(buildCampaignPayload({ name: 'x', objective: 'OUTCOME_TRAFFIC', specialAdCategories: ['NONE'] })
      .special_ad_categories).toEqual(['NONE']);
  });
});

describe('buildAdSetTargeting', () => {
  it('refuses to build radius targeting it cannot express', () => {
    // Meta wants a lat/long + distance; Loomi has a zip and no geocoder. Saying so
    // beats silently sending zip targeting that is invalid for a credit ad.
    const r = buildAdSetTargeting({ geoZip: '84401', radiusMiles: 15, requiresRadius: true });
    expect(r.targeting).toBeNull();
    expect(r.blocker).toContain('geocoded');
    expect(r.blocker).toContain('attach');
  });

  it('builds zip targeting for a non-financing ad', () => {
    const r = buildAdSetTargeting({ geoZip: '84401', radiusMiles: 25, requiresRadius: false });
    expect(r.blocker).toBeNull();
    expect(r.targeting).toEqual({ geo_locations: { zips: [{ key: 'US:84401' }] }, age_min: 18 });
  });

  it('reports having no geo at all', () => {
    expect(buildAdSetTargeting({ geoZip: null, radiusMiles: 25, requiresRadius: false }).blocker).toContain('no zip');
  });
});

describe('buildAdSetPayload', () => {
  it('is PAUSED and converts the budget to cents', () => {
    const p = buildAdSetPayload({
      name: 'set',
      campaignId: 'c1',
      dailyBudget: '50',
      targeting: { geo_locations: {} },
    });
    expect(p.status).toBe('PAUSED');
    expect(p.daily_budget).toBe(5000);
  });

  it('omits the budget when there is none rather than sending zero', () => {
    const p = buildAdSetPayload({ name: 'set', campaignId: 'c1', dailyBudget: null, targeting: {} });
    expect(p).not.toHaveProperty('daily_budget');
  });
});
