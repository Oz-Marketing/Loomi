import { describe, expect, it } from 'vitest';
import { resolveNotificationHref } from './notifications-panel';

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
