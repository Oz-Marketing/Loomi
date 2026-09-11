import { describe, expect, it } from 'vitest';
import {
  groupNotifications,
  notificationAccountKey,
  resolveNotificationHref,
} from './notifications-panel';

const n = (link: string | null, meta?: Record<string, unknown>) => ({
  link,
  metaJson: meta ? JSON.stringify(meta) : null,
});

describe('resolveNotificationHref', () => {
  it('scopes the destination to the account the notification is about', () => {
    // Without this you land on the page in whatever account you last had open,
    // which is rarely the one the notification concerns.
    expect(resolveNotificationHref(n('/ad-generator', { accountKey: 'youngChev' }))).toBe(
      '/ad-generator?account=youngChev',
    );
  });

  it('focuses the specific record when meta names one', () => {
    // The complaint this fixes: being dropped on a list and left to scroll.
    expect(
      resolveNotificationHref(n('/ad-generator', { accountKey: 'youngChev', creativeId: 'abc' })),
    ).toBe('/ad-generator?account=youngChev&focus=abc');
  });

  it('accepts adId as the focus, which the pacer notifications carry', () => {
    expect(resolveNotificationHref(n('/tools/meta/ad-planner', { adId: 'ad_1' }))).toBe(
      '/tools/meta/ad-planner?focus=ad_1',
    );
  });

  it('never overrides params the link already set', () => {
    expect(
      resolveNotificationHref(n('/ad-generator?account=explicit', { accountKey: 'other' })),
    ).toBe('/ad-generator?account=explicit');
  });

  it('leaves a link alone when there is no meta to improve it with', () => {
    expect(resolveNotificationHref(n('/changelog'))).toBe('/changelog');
  });

  it('survives malformed meta rather than dropping the link', () => {
    expect(resolveNotificationHref({ link: '/changelog', metaJson: '{oops' })).toBe('/changelog');
  });

  it('returns null when there is nowhere to go', () => {
    expect(resolveNotificationHref(n(null, { accountKey: 'youngChev' }))).toBeNull();
  });
});

describe('notificationAccountKey', () => {
  it('reads the account a notification is about', () => {
    expect(notificationAccountKey(n('/ad-generator', { accountKey: 'youngChev' }))).toBe(
      'youngChev',
    );
  });

  it('is null when there is no account to name', () => {
    expect(notificationAccountKey(n('/changelog'))).toBeNull();
    expect(notificationAccountKey(n('/changelog', { runId: 'r1' }))).toBeNull();
    expect(notificationAccountKey({ metaJson: '{oops' })).toBeNull();
  });

  it('treats an empty key as no key rather than labelling a row with nothing', () => {
    expect(notificationAccountKey(n('/ad-generator', { accountKey: '' }))).toBeNull();
  });
});

describe('groupNotifications', () => {
  const at = (id: string, type: string, iso: string) => ({ id, type, createdAt: iso });

  it('folds a night of the same news into one bundle', () => {
    // The complaint this fixes: the nightly Ad Generator run touches every
    // account, so one night arrives as thirty near-identical rows.
    const items = [
      at('a', 'incentive_ads_ready', '2026-09-11T02:00:00Z'),
      at('b', 'incentive_ads_ready', '2026-09-11T02:01:00Z'),
      at('c', 'incentive_ads_ready', '2026-09-11T02:02:00Z'),
    ];
    const rows = groupNotifications(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('group');
    expect(rows[0].kind === 'group' && rows[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a pair alone — a bundle of two is a row wearing extra chrome', () => {
    const rows = groupNotifications([
      at('a', 'incentive_ads_ready', '2026-09-11T02:00:00Z'),
      at('b', 'incentive_ads_ready', '2026-09-11T02:01:00Z'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['single', 'single']);
  });

  it('never bundles across days — last Tuesday is not this morning', () => {
    const rows = groupNotifications([
      at('a', 'incentive_ads_ready', '2026-09-11T14:00:00Z'),
      at('b', 'incentive_ads_ready', '2026-09-11T15:00:00Z'),
      at('c', 'incentive_ads_ready', '2026-09-11T16:00:00Z'),
      at('d', 'incentive_ads_ready', '2026-09-04T14:00:00Z'),
      at('e', 'incentive_ads_ready', '2026-09-04T15:00:00Z'),
      at('f', 'incentive_ads_ready', '2026-09-04T16:00:00Z'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'group')).toBe(true);
  });

  it('never bundles different news that happens to land the same day', () => {
    const rows = groupNotifications([
      at('a', 'incentive_ads_ready', '2026-09-11T02:00:00Z'),
      at('b', 'pacing_alert', '2026-09-11T02:01:00Z'),
      at('c', 'incentive_ads_ready', '2026-09-11T02:02:00Z'),
      at('d', 'incentive_ads_ready', '2026-09-11T02:03:00Z'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'single']);
    expect(rows[0].kind === 'group' && rows[0].items.map((i) => i.id)).toEqual(['a', 'c', 'd']);
  });

  it('keeps the list newest-first by seating a bundle where its newest member sat', () => {
    const rows = groupNotifications([
      at('newest', 'task_assigned', '2026-09-11T09:00:00Z'),
      at('a', 'incentive_ads_ready', '2026-09-11T02:00:00Z'),
      at('b', 'incentive_ads_ready', '2026-09-11T01:00:00Z'),
      at('c', 'incentive_ads_ready', '2026-09-11T00:30:00Z'),
      at('oldest', 'task_assigned', '2026-09-10T09:00:00Z'),
    ]);
    expect(rows.map((r) => (r.kind === 'group' ? 'group' : r.item.id))).toEqual([
      'newest',
      'group',
      'oldest',
    ]);
  });

  it('returns nothing for an empty list rather than an empty bundle', () => {
    expect(groupNotifications([])).toEqual([]);
  });
});
