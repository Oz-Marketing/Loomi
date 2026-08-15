import { describe, it, expect } from 'vitest';
import { normalizeCampaign } from './gohighlevel';

/**
 * Parity for the previous provider's campaign normalization, mirroring Oz
 * Dealer Tools' GoHighLevel::normalizeCampaign. Engagement defaults to 0 (not
 * available via a Private Integration token).
 *
 * The companion aggregateStats parity suite went with the standalone email
 * report — the Email & Text Blasts route sums these campaigns itself, into a
 * shape it can merge with Loomi's own sends (lib/reporting/blasts.ts).
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
