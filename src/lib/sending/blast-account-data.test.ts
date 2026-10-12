import { beforeEach, describe, expect, it, vi } from 'vitest';

// The loader is the only database touch; Prisma is stubbed with a tiny
// in-memory table so the inheritance walk can be exercised end to end.
type Row = Record<string, unknown> & { key: string };
let table: Row[] = [];
const findMany = vi.fn(async (args: { where: { key: { in: string[] } } }) =>
  table.filter((row) => args.where.key.in.includes(row.key)),
);

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findMany: (args: { where: { key: { in: string[] } } }) => findMany(args) } },
}));

const { loadBlastAccountData } = await import('./blast-account-data');
const { buildBlastMergetagContext } = await import('./blast-mergetags');

function account(overrides: Partial<Row> & { key: string }): Row {
  return {
    dealer: null,
    email: null,
    senderEmail: null,
    phone: null,
    salesPhone: null,
    servicePhone: null,
    partsPhone: null,
    address: null,
    city: null,
    state: null,
    postalCode: null,
    website: null,
    timezone: null,
    logos: null,
    branding: null,
    customValues: null,
    parentAccountKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockClear();
  table = [];
});

describe('loadBlastAccountData', () => {
  it('loads every field the account-level tags need, JSON parsed', async () => {
    table = [
      account({
        key: 'young-mazda',
        dealer: 'Young Mazda',
        email: 'sales@youngmazda.com',
        servicePhone: '(406) 555-0150',
        timezone: 'America/Denver',
        logos: JSON.stringify({ light: 'https://cdn/light.png' }),
        branding: JSON.stringify({ colors: { primary: '#101820' } }),
        customValues: JSON.stringify({ review_link: { name: 'Reviews', value: 'https://g.page/r/x' } }),
      }),
    ];
    const data = (await loadBlastAccountData(['young-mazda'])).get('young-mazda')!;
    expect(data.servicePhone).toBe('(406) 555-0150');
    expect(data.timezone).toBe('America/Denver');
    expect(data.logos).toEqual({ light: 'https://cdn/light.png' });
    expect(data.branding?.colors).toEqual({ primary: '#101820' });

    const ctx = buildBlastMergetagContext({ contact: null, account: data, unsubscribeToken: 'x' });
    expect(ctx['custom_values.service_phone']).toBe('(406) 555-0150');
    expect(ctx['custom_values.review_link']).toBe('https://g.page/r/x');
    expect(ctx['custom_values.logo_url']).toBe('https://cdn/light.png');
  });

  it("inherits logo and branding gaps down the hierarchy, nearest ancestor first, the account's own value winning", async () => {
    table = [
      account({
        key: 'rooftop',
        parentAccountKey: 'group',
        logos: JSON.stringify({ light: 'https://cdn/rooftop.png' }),
        branding: JSON.stringify({ colors: { primary: '#111111' } }),
      }),
      account({
        key: 'group',
        parentAccountKey: 'holding',
        logos: JSON.stringify({ light: 'https://cdn/group.png', dark: 'https://cdn/group-dark.png' }),
        branding: JSON.stringify({ colors: { primary: '#222222', accent: '#c8102e' } }),
      }),
      account({
        key: 'holding',
        logos: JSON.stringify({ white: 'https://cdn/holding-white.png', dark: 'https://cdn/holding-dark.png' }),
        branding: JSON.stringify({ fonts: { heading: 'Georgia' } }),
      }),
    ];
    const data = (await loadBlastAccountData(['rooftop'])).get('rooftop')!;
    expect(data.logos).toEqual({
      light: 'https://cdn/rooftop.png',
      dark: 'https://cdn/group-dark.png',
      white: 'https://cdn/holding-white.png',
    });
    expect(data.branding).toEqual({
      colors: { primary: '#111111', accent: '#c8102e' },
      fonts: { heading: 'Georgia' },
    });
  });

  it('fetches ancestors one level at a time for the whole batch', async () => {
    table = [
      account({ key: 'a', parentAccountKey: 'group' }),
      account({ key: 'b', parentAccountKey: 'group' }),
      account({ key: 'c', parentAccountKey: 'group' }),
      account({ key: 'group', logos: JSON.stringify({ light: 'https://cdn/group.png' }) }),
    ];
    const map = await loadBlastAccountData(['a', 'b', 'c']);
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const key of ['a', 'b', 'c']) expect(map.get(key)?.logos?.light).toBe('https://cdn/group.png');
  });

  it('survives a parent cycle', async () => {
    table = [
      account({ key: 'a', parentAccountKey: 'b' }),
      account({ key: 'b', parentAccountKey: 'a', logos: JSON.stringify({ light: 'https://cdn/b.png' }) }),
    ];
    const map = await loadBlastAccountData(['a']);
    expect(map.get('a')?.logos?.light).toBe('https://cdn/b.png');
    expect(findMany.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('skips missing accounts and empty input', async () => {
    expect((await loadBlastAccountData([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect((await loadBlastAccountData(['gone'])).size).toBe(0);
  });

  it('tolerates malformed JSON columns', async () => {
    table = [account({ key: 'x', logos: '{not json', branding: '[]', customValues: '"str"' })];
    const data = (await loadBlastAccountData(['x'])).get('x')!;
    expect(data.logos).toEqual({});
    expect(data.branding).toEqual({});
    expect(data.customValues).toEqual({});
  });
});
