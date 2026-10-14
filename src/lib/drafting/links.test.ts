import { describe, expect, it } from 'vitest';
import { accountLinks, classifyResponse, resolveCtas, type LinkCheck } from './links';

const HOME = 'https://www.youngchev.com/';

describe('accountLinks', () => {
  it('reads each purpose from its tag, accepting the older names and any spelling of the key', () => {
    const links = accountLinks({
      'Specials URL': { name: 'Specials', value: 'https://www.youngchev.com/specials' },
      inventory_url: { name: 'Inventory', value: 'youngchev.com/new-inventory' },
      trade_in_url: { name: 'Trade', value: '' },
      finance_url: { name: 'Finance', value: 'javascript:alert(1)' },
    });
    expect(links.specials).toEqual({ url: 'https://www.youngchev.com/specials', key: 'Specials URL' });
    expect(links.new_inventory?.url).toBe('https://youngchev.com/new-inventory');
    expect(links.trade_in).toBeUndefined();
    expect(links.finance).toBeUndefined();
  });
});

describe('classifyResponse', () => {
  it('tells a dead link, a moved page and bot protection apart', () => {
    expect(classifyResponse('https://x.com/specials', 200, 'https://x.com/specials')).toBe('ok');
    expect(classifyResponse('https://x.com/specials', 404, 'https://x.com/specials')).toBe('dead');
    expect(classifyResponse('https://x.com/specials', 200, 'https://x.com/')).toBe('homepage');
    expect(classifyResponse('https://x.com/specials', 403, 'https://x.com/specials')).toBe('unconfirmed');
    expect(classifyResponse('https://x.com/', 200, 'https://x.com/')).toBe('ok');
  });
});

describe('resolveCtas', () => {
  const links = { specials: { url: 'https://www.youngchev.com/specials', key: 'specials_url' } };
  const run = (result: LinkCheck, purpose = 'specials') =>
    resolveCtas([{ label: 'See Specials', purpose }], links, HOME, async () => result);

  it("uses the account's link when it loads", async () => {
    expect(await run('ok')).toEqual([{ url: 'https://www.youngchev.com/specials', note: null }]);
  });

  it('falls back to the homepage, and says why, when the link is missing, dead or moved', async () => {
    expect((await run('ok', 'trade_in'))[0]).toEqual({
      url: HOME,
      note: '"See Specials" goes to the homepage: the account has no {{custom_values.trade_in_url}} for value your trade.',
    });
    expect((await run('dead'))[0].url).toBe(HOME);
    expect((await run('homepage'))[0].note).toContain('redirects to the homepage');
  });

  it("keeps a link it couldn't confirm, with a note", async () => {
    const [r] = await run('unconfirmed');
    expect(r.url).toBe('https://www.youngchev.com/specials');
    expect(r.note).toContain("couldn't confirm");
  });

  it('checks each link once, and sends an unknown purpose to the homepage', async () => {
    let calls = 0;
    const r = await resolveCtas(
      [{ label: 'A', purpose: 'specials' }, { label: 'B', purpose: 'specials' }, { label: 'C', purpose: 'made_up' }],
      links,
      HOME,
      async () => {
        calls++;
        return 'ok';
      },
    );
    expect(calls).toBe(1);
    expect(r[2]).toEqual({ url: HOME, note: null });
  });
});
