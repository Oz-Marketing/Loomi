import { describe, expect, it } from 'vitest';
import { buildDraft, siteUrl, type DraftCopy } from './assemble';
import { DISCLAIMER, YOUNG_CHEVROLET } from './compliance/__fixtures__/drafts';
import type { DraftAccount } from './compliance/types';
import { factSources } from './extraction';
import type { CreativeReading } from './reading';
import { campaignSlug } from './utm';

/**
 * The assembler's promise: copy that keeps to the facts, put through the
 * assembler, clears every rule for every brand — the palettes, fonts, CTA
 * layout, footer and links are code's, so the model can't fail them.
 */

const READING: CreativeReading = {
  requestType: 'model_offer',
  fields: [
    { key: 'headline', label: 'Headline', value: '2026 Equinox ACTIV, $3,500 off MSRP', confidence: 'high' },
    { key: 'expiration', label: 'Offer ends', value: 'Offer ends 10/31/2026', confidence: 'high' },
  ],
  disclaimer: { text: DISCLAIMER, confidence: 'high' },
  offerType: 'cash',
  vehicle: { year: 2026, make: 'Chevrolet', model: 'Equinox', trim: 'ACTIV' },
  model: 'claude-opus-5-5',
  readAt: '2026-10-14T00:00:00.000Z',
};

function copy(dealer: string): DraftCopy {
  return {
    headline: 'The 2026 Equinox ACTIV, $3,500 off',
    body: [`Take $3,500 off MSRP on a new 2026 Equinox ACTIV at ${dealer}.`, 'The offer ends Oct 31.'],
    ctas: [{ label: 'Shop Equinox', purpose: 'new_inventory' }, { label: 'Value Your Trade', purpose: 'trade_in' }],
    heroAlt: '2026 Equinox ACTIV, $3,500 off MSRP',
    subjects: [
      { kind: 'initial', text: 'Save $3,500 on the 2026 Equinox ACTIV' },
      { kind: 'initial', text: 'The 2026 Equinox ACTIV, $3,500 off MSRP' },
      { kind: 'urgent', text: 'Ends Oct 31: $3,500 off the Equinox ACTIV' },
    ],
    previews: [
      { kind: 'initial', text: `$3,500 off MSRP at ${dealer}.` },
      { kind: 'urgent', text: 'Last days to take $3,500 off.' },
    ],
    notes: [],
  };
}

async function built(account: DraftAccount, patch: { logoUrl?: string | null; copy?: DraftCopy } = {}) {
  return buildDraft({
    copy: patch.copy ?? copy(account.dealer),
    reading: READING,
    account,
    logoUrl: patch.logoUrl === undefined ? 'https://cdn.example.com/logo.png' : patch.logoUrl,
    heroUrl: 'https://cdn.example.com/creative.png',
    website: siteUrl(account.website ?? 'https://example.com'),
    utmCampaign: campaignSlug('Equinox ACTIV Monthly Offer', 10, 2026),
    facts: factSources(READING, null),
    coop: false,
    coopPack: null,
  });
}

const errors = (b: Awaited<ReturnType<typeof built>>) =>
  b.evaluation.violations.filter((v) => v.severity === 'error').map((v) => `${v.ruleId}: ${v.message}`);

const STORES: DraftAccount[] = [
  YOUNG_CHEVROLET,
  { key: 'youngKia', dealer: 'Young Kia', oems: ['Kia'], groupKeys: ['youngAutomotiveGroup'], siteDisplay: 'YoungKia.com', website: 'https://www.youngkia.com/' },
  { key: 'youngHonda', dealer: 'Young Honda', oems: ['Honda'], groupKeys: ['youngAutomotiveGroup'], siteDisplay: 'YoungHonda.com', website: 'youngHonda.com' },
  { key: 'youngVw', dealer: 'Young Volkswagen', oems: ['Volkswagen'], groupKeys: ['youngAutomotiveGroup'], siteDisplay: 'YoungVW.com', website: 'https://youngvw.com' },
  { key: 'youngHyundai', dealer: 'Young Hyundai', oems: ['Hyundai'], groupKeys: [], siteDisplay: 'YoungHyundai.com', website: 'https://www.younghyundai.com/' },
];

describe('buildDraft', () => {
  it.each(STORES.map((s) => [s.dealer, s] as const))('%s: a factual draft clears every rule', async (_name, store) => {
    const b = await built(store);
    expect(errors(b)).toEqual([]);
    expect(b.evaluation.blocked).toBe(false);
  });

  it('carries the disclaimer verbatim and never lets the model near it', async () => {
    const b = await built(YOUNG_CHEVROLET);
    expect(b.artifact.disclaimer).toEqual({ text: DISCLAIMER, blockId: 'disclaimer' });
  });

  it('puts one CTA on its own and two side by side', async () => {
    const one = await built(YOUNG_CHEVROLET, { copy: { ...copy('Young Chevrolet'), ctas: [{ label: 'Shop Equinox', purpose: 'new_inventory' }] } });
    expect(one.artifact.template.blocks.some((b) => b.type === 'columns')).toBe(false);
    expect(errors(one)).toEqual([]);
    const two = await built(YOUNG_CHEVROLET);
    // Each cell is a Section holding its button, as the editor builds Columns.
    const cells = two.artifact.template.blocks.find((b) => b.id === 'ctas')?.children ?? [];
    expect(cells.map((c) => [c.type, c.children?.[0]?.type])).toEqual([['section', 'button'], ['section', 'button']]);
  });

  it('leaves the footer logo off for Hyundai, Audi and Volkswagen', async () => {
    const b = await built(STORES[4]);
    const footer = b.artifact.template.blocks.find((x) => x.id === 'footer');
    expect(footer?.children?.some((c) => c.type === 'logo')).toBe(false);
  });

  it('still blocks what data, not copy, is missing: the site name and the logo', async () => {
    const b = await built({ ...YOUNG_CHEVROLET, siteDisplay: null }, { logoUrl: null });
    expect(b.evaluation.violations.filter((v) => v.severity === 'error').map((v) => v.ruleId).sort()).toEqual([
      'footer.dealer-logo',
      'footer.site-url',
    ]);
  });

  it('still blocks a number the creative never said', async () => {
    const bad = copy('Young Chevrolet');
    bad.subjects[0] = { kind: 'initial', text: 'Save $4,000 on the 2026 Equinox ACTIV' };
    const b = await built(YOUNG_CHEVROLET, { copy: bad });
    expect(b.evaluation.violations.some((v) => v.ruleId === 'claims.supported')).toBe(true);
  });
});

describe('button links', () => {
  it('sends each button, and the creative, where its link points — tagged', async () => {
    const b = await buildDraft({
      copy: copy('Young Chevrolet'),
      reading: READING,
      account: YOUNG_CHEVROLET,
      logoUrl: 'https://cdn.example.com/logo.png',
      heroUrl: 'https://cdn.example.com/creative.png',
      website: 'https://www.youngchev.com/',
      utmCampaign: campaignSlug('Equinox ACTIV Monthly Offer', 10, 2026),
      facts: factSources(READING, null),
      coop: false,
      coopPack: null,
      ctaUrls: ['https://www.youngchev.com/new-inventory/index.htm?model=Equinox', 'https://www.youngchev.com/trade'],
    });
    const ctas = b.artifact.template.blocks.find((x) => x.id === 'ctas')!.children!.map((cell) => cell.children![0]);
    expect(new URL(ctas[0].props.url as string).searchParams.get('model')).toBe('Equinox');
    expect(new URL(ctas[1].props.url as string).pathname).toBe('/trade');
    const hero = b.artifact.template.blocks.find((x) => x.id === 'hero')!;
    expect(new URL(hero.props.linkUrl as string).pathname).toBe('/new-inventory/index.htm');
    expect(errors(b)).toEqual([]);
  });
});

describe('siteUrl', () => {
  it('normalizes a website on file to its origin', () => {
    expect(siteUrl('youngHonda.com')).toBe('https://younghonda.com/');
    expect(siteUrl('https://www.youngchev.com/new?x=1')).toBe('https://www.youngchev.com/');
  });
});
