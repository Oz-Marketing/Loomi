import { describe, it, expect } from 'vitest';
import { normalizeAdStatus, adStatusTone } from './platform-status';
import type { PacerAd } from './types';

function ad(overrides: Partial<PacerAd>): PacerAd {
  return { platform: 'google', ...overrides } as unknown as PacerAd;
}

describe('normalizeAdStatus — Google', () => {
  it('unlinked → Not linked', () => {
    expect(normalizeAdStatus(ad({ googleCampaignId: null }))).toBe('Not linked');
  });
  it('ENABLED → Active, PAUSED → Paused, REMOVED → Removed', () => {
    expect(normalizeAdStatus(ad({ googleCampaignId: 'c', googleEffectiveStatus: 'ENABLED' }))).toBe('Active');
    expect(normalizeAdStatus(ad({ googleCampaignId: 'c', googleEffectiveStatus: 'PAUSED' }))).toBe('Paused');
    expect(normalizeAdStatus(ad({ googleCampaignId: 'c', googleEffectiveStatus: 'REMOVED' }))).toBe('Removed');
  });
  it('budget-constrained ENABLED → Limited', () => {
    expect(
      normalizeAdStatus(
        ad({ googleCampaignId: 'c', googleEffectiveStatus: 'ENABLED', googleBudgetConstrained: true }),
      ),
    ).toBe('Limited');
  });
  it('disapproval wins over everything', () => {
    expect(
      normalizeAdStatus(
        ad({
          googleCampaignId: 'c',
          googleEffectiveStatus: 'ENABLED',
          googleBudgetConstrained: true,
          googleAdsDisapproved: true,
        }),
      ),
    ).toBe('Disapproved');
  });
});

describe('normalizeAdStatus — Meta', () => {
  const m = (o: Partial<PacerAd>) => ad({ platform: 'meta', ...o });
  it('unlinked → Not linked', () => {
    expect(normalizeAdStatus(m({ metaObjectId: null }))).toBe('Not linked');
  });
  it('maps ACTIVE / PAUSED / ARCHIVED', () => {
    expect(normalizeAdStatus(m({ metaObjectId: 'x', metaEffectiveStatus: 'ACTIVE' }))).toBe('Active');
    expect(normalizeAdStatus(m({ metaObjectId: 'x', metaEffectiveStatus: 'ADSET_PAUSED' }))).toBe('Paused');
    expect(normalizeAdStatus(m({ metaObjectId: 'x', metaEffectiveStatus: 'ARCHIVED' }))).toBe('Removed');
  });
  it('unknown raw status → Unknown', () => {
    expect(normalizeAdStatus(m({ metaObjectId: 'x', metaEffectiveStatus: 'SOMETHING_NEW' }))).toBe('Unknown');
  });
});

describe('adStatusTone', () => {
  it('buckets by severity', () => {
    expect(adStatusTone('Active')).toBe('good');
    expect(adStatusTone('Limited')).toBe('warn');
    expect(adStatusTone('Disapproved')).toBe('bad');
    expect(adStatusTone('Not linked')).toBe('muted');
  });
});
