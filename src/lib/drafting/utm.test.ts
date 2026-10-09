import { describe, expect, it } from 'vitest';
import { UTM_CAMPAIGN_PATTERN, campaignSlug, tagLink } from './utm';

describe('campaignSlug', () => {
  it('kebab-cases the name and appends the month and year', () => {
    expect(campaignSlug('CX-90 Monthly Offer', 10, 2026)).toBe('cx-90-monthly-offer-october-2026');
    expect(campaignSlug('Buy 3 Tires & Get the 4th for $1!', 9, 2026)).toBe('buy-3-tires-and-get-the-4th-for-1-september-2026');
    expect(campaignSlug('Señor Service Special', 1, 2027)).toBe('senor-service-special-january-2027');
  });

  it('always produces a slug the UTM rule accepts', () => {
    for (const name of ['CX-90 Monthly Offer', '!!!', 'Grand Opening — Morgan']) {
      expect(UTM_CAMPAIGN_PATTERN.test(campaignSlug(name, 12, 2026)), name).toBe(true);
    }
  });
});

describe('tagLink', () => {
  it('sets the house parameters and keeps the rest of the URL', () => {
    const tagged = new URL(tagLink('https://www.younghonda.com/new?model=accord#offers', 'x-october-2026', 'cta-1'));
    expect(Object.fromEntries(tagged.searchParams)).toEqual({
      model: 'accord',
      utm_source: 'email',
      utm_medium: 'email',
      utm_campaign: 'x-october-2026',
      utm_content: 'cta-1',
    });
    expect(tagged.hash).toBe('#offers');
  });
});
