import { describe, expect, it } from 'vitest';
import { CAMPAIGN, blockById, draft } from '../__fixtures__/drafts';
import { tagLink } from '../../utm';
import { utmRule } from './links';

describe('links.utm', () => {
  it('rejects an untagged link and names what it lacks', async () => {
    const a = await draft((t) => {
      blockById(t, 'cta-trade').props.url = 'https://www.youngchev.com/trade';
    });
    expect(utmRule.check(a)).toMatchObject([
      {
        severity: 'error',
        message: expect.stringContaining(`utm_source=email, utm_medium=email, utm_campaign=${CAMPAIGN}, a utm_content of its own`),
      },
    ]);
  });

  it('rejects two links sharing a utm_content', async () => {
    const a = await draft((t) => {
      blockById(t, 'cta-trade').props.url = tagLink('https://www.youngchev.com/trade', CAMPAIGN, 'cta-shop');
    });
    expect(utmRule.check(a)[0].message).toMatch(/share utm_content "cta-shop"/);
  });

  it('rejects a link tagged for a different campaign', async () => {
    const a = await draft((t) => {
      blockById(t, 'cta-trade').props.url = tagLink('https://www.youngchev.com/trade', 'equinox-september-2026', 'cta-trade');
    });
    expect(utmRule.check(a)[0].message).toContain(`utm_campaign=${CAMPAIGN}`);
  });

  it('requires the campaign slug to end in the month and year', async () => {
    const a = await draft(undefined, { utmCampaign: 'equinox-activ' });
    expect(utmRule.check(a).some((f) => f.message.includes('isn\'t a slug ending in the month and year'))).toBe(true);
  });

  it('skips phone, mail and unsubscribe links', async () => {
    const a = await draft((t) => {
      blockById(t, 'cta-trade').props.url = 'tel:+18015550134';
    });
    expect(utmRule.check(a)).toEqual([]);
  });
});
