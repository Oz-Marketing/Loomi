import { describe, it, expect } from 'vitest';
import { normalizeCampaign, aggregateStats } from './gohighlevel';

/**
 * Parity for the GHL email normalization + aggregation, mirroring Oz Dealer
 * Tools' GoHighLevel::normalizeCampaign / aggregateStats. Engagement defaults
 * to 0 (not available via a Private Integration token).
 */

describe('normalizeCampaign', () => {
  it('maps delivery counts and computes rates', () => {
    const c = normalizeCampaign({
      id: 'c1',
      name: 'June Service Reminder',
      status: 'complete',
      totalCount: 1000,
      successCount: 980,
      failed: 20,
      dateScheduled: 1749081600000, // unix ms
    });
    expect(c.sent).toBe(1000);
    expect(c.delivered).toBe(980);
    expect(c.failed).toBe(20);
    expect(c.delivery_rate).toBe(98); // 980/1000
    expect(c.fail_rate).toBe(2);
    expect(c.scheduled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ms → ISO
    // No engagement fields present → 0.
    expect(c.open_rate).toBe(0);
    expect(c.opened).toBe(0);
  });

  it('falls back across field aliases and defaults the name', () => {
    const c = normalizeCampaign({ _id: 'x', processed: 50, success: 50 });
    expect(c.id).toBe('x');
    expect(c.name).toBe('Untitled');
    expect(c.sent).toBe(50);
    expect(c.delivered).toBe(50);
    expect(c.delivery_rate).toBe(100);
  });
});

describe('aggregateStats (Oz parity)', () => {
  it('sums counts and computes blended rates', () => {
    const campaigns = [
      normalizeCampaign({ totalCount: 1000, successCount: 950, failed: 50, opened: 200, clicked: 40 }),
      normalizeCampaign({ totalCount: 500, successCount: 500, failed: 0, opened: 100, clicked: 10 }),
    ];
    const agg = aggregateStats(campaigns);
    expect(agg.total_campaigns).toBe(2);
    expect(agg.total_sent).toBe(1500);
    expect(agg.total_delivered).toBe(1450);
    expect(agg.total_failed).toBe(50);
    expect(agg.delivery_rate).toBe(96.7); // 1450/1500 → 96.666 → 96.7
    expect(agg.avg_recipients).toBe(750);
    // base = max(delivered, sent) = 1500 (Oz parity), so 300/1500 → 20.0
    expect(agg.avg_open_rate).toBe(20);
    expect(agg.has_engagement).toBe(true);
  });

  it('flags no engagement when opens/clicks/bounces are all zero', () => {
    const agg = aggregateStats([normalizeCampaign({ totalCount: 100, successCount: 100 })]);
    expect(agg.has_engagement).toBe(false);
    expect(agg.avg_open_rate).toBe(0);
  });
});
