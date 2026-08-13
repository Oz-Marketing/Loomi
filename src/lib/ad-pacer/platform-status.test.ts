import { describe, it, expect } from 'vitest';
import {
  adStatusTone,
  normalizeAdStatus,
  statusMismatch,
  statusReasonText,
} from './platform-status';
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

// ── §13 Loomi-vs-Google mismatch ──

const gAd = (over: Partial<PacerAd>): PacerAd =>
  ({ platform: 'google', googleCampaignId: 'c', adStatus: 'Live', ...over }) as PacerAd;

/**
 * The expensive silent failure this exists for: Loomi keeps recommending — and
 * offering to push — a daily budget for a campaign that Google is not running.
 * Every number on that row is fiction until someone notices.
 */
describe('statusMismatch', () => {
  it('flags a Loomi-live campaign that Google has paused or removed', () => {
    expect(
      statusMismatch(gAd({ googleEffectiveStatus: 'PAUSED' })),
    ).toMatchObject({ kind: 'not_serving', platform: 'Paused' });
    expect(
      statusMismatch(gAd({ adStatus: 'Live - Changes Required', googleEffectiveStatus: 'REMOVED' })),
    ).toMatchObject({ kind: 'not_serving', platform: 'Removed' });
  });

  it('flags a parked campaign that Google is actually running', () => {
    // Unplanned spend on a line nobody is pacing.
    expect(
      statusMismatch(gAd({ adStatus: 'Off', googleEffectiveStatus: 'ENABLED' })),
    ).toMatchObject({ kind: 'unexpectedly_live', platform: 'Active' });
    expect(
      statusMismatch(
        gAd({ adStatus: 'In Draft', googleEffectiveStatus: 'ENABLED', googleBudgetConstrained: true }),
      ),
    ).toMatchObject({ kind: 'unexpectedly_live', platform: 'Limited' });
  });

  it('stays quiet when the two agree', () => {
    expect(statusMismatch(gAd({ googleEffectiveStatus: 'ENABLED' }))).toBeNull();
    expect(statusMismatch(gAd({ adStatus: 'Off', googleEffectiveStatus: 'PAUSED' }))).toBeNull();
  });

  it('does not cry wolf over a finished flight still enabled in Google', () => {
    // Ordinary at month end — the run is over on our side, the campaign object
    // is simply still there.
    expect(
      statusMismatch(gAd({ adStatus: 'Completed Run', googleEffectiveStatus: 'ENABLED' })),
    ).toBeNull();
  });

  it('treats an unlinked row as a setup gap, not a contradiction', () => {
    expect(statusMismatch(gAd({ googleCampaignId: null }))).toBeNull();
  });

  it('ignores Meta rows entirely', () => {
    expect(
      statusMismatch({ platform: 'meta', adStatus: 'Live', metaEffectiveStatus: 'PAUSED' } as PacerAd),
    ).toBeNull();
  });

  it('carries the reasons through so the warning can say why', () => {
    const m = statusMismatch(
      gAd({
        googleEffectiveStatus: 'PAUSED',
        googlePrimaryStatusReasons: '["CAMPAIGN_PAUSED","BUDGET_MISCONFIGURED"]',
      }),
    );
    expect(m?.reasons).toEqual(['CAMPAIGN_PAUSED', 'BUDGET_MISCONFIGURED']);
    expect(statusReasonText('CAMPAIGN_PAUSED')).toBe('the campaign is paused');
    // Unknown enums still say something useful rather than vanishing.
    expect(statusReasonText('SOME_NEW_REASON')).toBe('some new reason');
  });

  it('survives a malformed reasons blob', () => {
    const m = statusMismatch(
      gAd({ googleEffectiveStatus: 'PAUSED', googlePrimaryStatusReasons: '{not json' }),
    );
    expect(m?.reasons).toEqual([]);
  });
});
