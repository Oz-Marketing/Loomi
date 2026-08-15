import { describe, it, expect } from 'vitest';
import { buildMeetingDoc, analysisSection, isSilent, type PlatformResult } from './meeting-doc';

const ok = (key: string, label: string, metrics: Record<string, number>): PlatformResult => ({
  key,
  label,
  status: 'ok',
  metrics,
});
const missing = (key: string, label: string, note: string): PlatformResult => ({
  key,
  label,
  status: 'unavailable',
  note,
  metrics: null,
});

const base = {
  dealer: 'Young Honda',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
};

const section = (doc: ReturnType<typeof buildMeetingDoc>, title: string) =>
  doc.sections.find((s) => s.title === title);

describe('buildMeetingDoc — media table', () => {
  it('maps Google cost and Meta spend into one Spend column', () => {
    // The two platforms name the same measure differently; a deck that showed
    // Google as $0 because it looked for `spend` would be worse than useless.
    const doc = buildMeetingDoc({
      ...base,
      platforms: [
        ok('google', 'Google Ads', { cost: 5000, impressions: 100_000, clicks: 2_000, conversions: 40 }),
        ok('meta', 'Meta', { spend: 3000, impressions: 200_000, clicks: 4_000, conversions: 25 }),
      ],
    });
    const media = section(doc, 'Media performance')!;
    expect(media.rows.map((r) => [r[0], r[1]])).toEqual([
      ['Google Ads', 5000],
      ['Meta', 3000],
    ]);
    expect(doc.kpis![0]).toMatchObject({ label: 'Media spend', value: '$8,000' });
  });

  it('computes CTR from the totals, not as a mean of per-platform rates', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [
        ok('google', 'Google Ads', { cost: 1, impressions: 1_000, clicks: 100 }), // 10%
        ok('meta', 'Meta', { spend: 1, impressions: 9_000, clicks: 90 }), // 1%
      ],
    });
    // Mean of rates would be 5.5%; the rate of the totals is 190/10000 = 1.9%.
    const clicksKpi = doc.kpis!.find((k) => k.label === 'Clicks')!;
    expect(clicksKpi.secondary).toBe('1.90% CTR');
  });

  it('keeps GA4 and Reputation out of the media table', () => {
    // Neither buys media; a row of empty spend columns would read as a channel
    // that ran and delivered nothing.
    const doc = buildMeetingDoc({
      ...base,
      platforms: [
        ok('google', 'Google Ads', { cost: 100, impressions: 10, clicks: 1 }),
        ok('ga4', 'Website', { sessions: 5_000, totalUsers: 4_000, newUsers: 3_000, pageViews: 12_000 }),
        ok('reputation', 'Reputation', { rating: 4.6, reviewCount: 312 }),
      ],
    });
    expect(section(doc, 'Media performance')!.rows.map((r) => r[0])).toEqual(['Google Ads']);
    expect(section(doc, 'Website')).toBeDefined();
    expect(section(doc, 'Reputation')!.rows[0]).toEqual(['Average rating', '4.6']);
  });

  it('still renders a media section when no channel reported', () => {
    const doc = buildMeetingDoc({ ...base, platforms: [] });
    expect(section(doc, 'Media performance')!.rows[0][0]).toMatch(/No media channels/);
  });
});

describe('buildMeetingDoc — missing sources are disclosed', () => {
  it('lists every unavailable source with its reason', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [
        ok('google', 'Google Ads', { cost: 100, impressions: 10, clicks: 1 }),
        missing('stackadapt', 'OTT / CTV', 'Not configured for this account'),
        missing('gbp', 'Business Profile', 'Not connected to Google'),
      ],
    });
    const notIncluded = section(doc, 'Not included')!;
    expect(notIncluded.rows).toEqual([
      ['OTT / CTV', 'Not configured for this account'],
      ['Business Profile', 'Not connected to Google'],
    ]);
  });

  it('falls back to a generic reason rather than a blank cell', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [{ key: 'meta', label: 'Meta', status: 'unavailable', metrics: null }],
    });
    expect(section(doc, 'Not included')!.rows[0][1]).toBe('No data available');
  });

  it('omits the section entirely when every source reported', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [ok('google', 'Google Ads', { cost: 1, impressions: 1, clicks: 1 })],
    });
    expect(section(doc, 'Not included')).toBeUndefined();
  });

  it('treats an ok status with null metrics as unavailable', () => {
    // A route that answered 200 with nothing usable must not count as a
    // channel that ran — the channel count in the header would overstate.
    const doc = buildMeetingDoc({
      ...base,
      platforms: [{ key: 'meta', label: 'Meta', status: 'ok', metrics: null }],
    });
    expect(section(doc, 'Not included')!.rows[0][0]).toBe('Meta');
    expect(doc.meta!.find((m) => m.label === 'Channels included')!.value).toBe('0');
  });
});

describe('buildMeetingDoc — dealer sections', () => {
  it('labels sales revenue as customer revenue, never gross', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [],
      sales: {
        totalUnits: 40,
        newUnits: 20,
        usedUnits: 15,
        leaseUnits: 5,
        totalRevenue: 1_600_000,
        avgPrice: 40_000,
      },
    });
    const labels = section(doc, 'Sales')!.rows.map((r) => r[0]);
    expect(labels).toContain('Customer revenue');
    expect(labels.join(' ').toLowerCase()).not.toContain('gross');
  });

  it('adds sales and service KPIs only when those sections exist', () => {
    const withoutDealer = buildMeetingDoc({ ...base, platforms: [] });
    expect(withoutDealer.kpis!.map((k) => k.label)).not.toContain('Units sold');

    const withDealer = buildMeetingDoc({
      ...base,
      platforms: [],
      service: { roCount: 210, totalRevenue: 84_000, avgRoValue: 400 },
    });
    expect(withDealer.kpis!.map((k) => k.label)).toContain('Repair orders');
  });

  it('carries no cost or margin field from the budget summary', () => {
    const doc = buildMeetingDoc({
      ...base,
      platforms: [],
      budget: {
        contractTotal: 500_000,
        planned: 420_000,
        spent: 100_000,
        byChannel: [{ label: 'Meta', amount: 200_000 }],
      },
    });
    const keys = JSON.stringify(doc).toLowerCase();
    for (const banned of ['spendtarget', 'markup', 'margin', '"cost"']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('analysisSection', () => {
  it('splits prose into one row per paragraph', () => {
    const s = analysisSection('First para.\n\nSecond para.\n\n\nThird para.')!;
    expect(s.rows).toEqual([['First para.'], ['Second para.'], ['Third para.']]);
  });

  it('collapses internal newlines so a row is one clean paragraph', () => {
    const s = analysisSection('A sentence\nwrapped mid-line.')!;
    expect(s.rows).toEqual([['A sentence wrapped mid-line.']]);
  });

  it('returns null for empty or whitespace-only analysis', () => {
    expect(analysisSection('')).toBeNull();
    expect(analysisSection('   \n\n  ')).toBeNull();
  });

  it('is omitted from the document when no analysis was generated', () => {
    const doc = buildMeetingDoc({ ...base, platforms: [], analysis: null });
    expect(section(doc, 'Analysis')).toBeUndefined();
  });
});

describe('isSilent', () => {
  it('flags a configured platform that reported nothing', () => {
    expect(isSilent(ok('meta', 'Meta', { spend: 0, impressions: 0, clicks: 0 }))).toBe(true);
  });

  it('does not flag a platform with any activity', () => {
    expect(isSilent(ok('meta', 'Meta', { spend: 0, impressions: 500, clicks: 0 }))).toBe(false);
    expect(isSilent(ok('ga4', 'Website', { sessions: 10 }))).toBe(false);
  });

  it('treats null metrics as silent', () => {
    expect(isSilent(missing('meta', 'Meta', 'x'))).toBe(true);
  });
});
