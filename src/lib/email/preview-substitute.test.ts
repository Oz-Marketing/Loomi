import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only loadPreviewAccountData touches the database; the substitution itself
// is pure. Stubbing findUnique keeps the whole file DB-free.
const findUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const { loadPreviewAccountData, resolvePreviewTokens, toMergetagContext } =
  await import('./preview-substitute');

const ACCOUNT = {
  dealer: 'Young Mazda',
  email: 'sales@youngmazda.com',
  phone: '(406) 555-0143',
  address: '2900 N Reserve St',
  city: 'Missoula',
  state: 'MT',
  postalCode: '59808',
  website: 'https://youngmazda.com',
};

describe('toMergetagContext', () => {
  it('strips the braces the preview map carries', () => {
    expect(
      toMergetagContext({ '{{location.name}}': 'Young Mazda', '{{ contact.city }}': 'Missoula' }),
    ).toEqual({ 'location.name': 'Young Mazda', 'contact.city': 'Missoula' });
  });
});

describe('resolvePreviewTokens', () => {
  it('resolves {{location.*}} to the account, not to raw mustache text', () => {
    const html = resolvePreviewTokens(
      '<p>{{location.name}} · {{location.address}}, {{location.city}}, {{location.state}} {{location.postal_code}}</p>',
      ACCOUNT,
    );
    expect(html).toBe(
      '<p>Young Mazda · 2900 N Reserve St, Missoula, MT 59808</p>',
    );
    expect(html).not.toContain('{{');
  });

  it('resolves account custom values', () => {
    const html = resolvePreviewTokens('<a>{{custom_values.service_scheduler_url}}</a>', {
      ...ACCOUNT,
      customValues: {
        service_scheduler_url: {
          name: 'Service Scheduler',
          value: 'https://youngmazda.com/schedule',
        },
      },
    });
    expect(html).toBe('<a>https://youngmazda.com/schedule</a>');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(resolvePreviewTokens('{{  location.city  }}', ACCOUNT)).toBe('Missoula');
  });

  it('empties a blank account field instead of inventing one', () => {
    // The editor would show "(801) 555-0100" here so the layout can be
    // judged. A PNG gets forwarded, and nobody downstream can tell an
    // invented dealership phone number from a real one.
    const { phone, ...noPhone } = ACCOUNT;
    expect(phone).toBeTruthy();
    expect(resolvePreviewTokens('<p>Call {{location.phone}}</p>', noPhone)).toBe(
      '<p>Call </p>',
    );
  });

  it('empties every location token when there is no account at all', () => {
    const html = resolvePreviewTokens(
      '{{location.name}}|{{location.email}}|{{location.phone}}|{{location.address}}'
      + '|{{location.city}}|{{location.state}}|{{location.postal_code}}|{{location.website}}',
      null,
    );
    expect(html).toBe('|||||||');
  });

  it('empties the standard custom values the account has not set', () => {
    expect(
      resolvePreviewTokens('[{{custom_values.sales_phone}}][{{custom_values.review_link}}]', {
        dealer: 'Young Mazda',
      }),
    ).toBe('[][]');
  });

  it('empties contact tokens — a download is addressed to nobody', () => {
    expect(resolvePreviewTokens('Hi {{contact.first_name}},', ACCOUNT)).toBe('Hi ,');
  });

  it('leaves an unknown token intact so a typo stays visible', () => {
    // The whole point of the download is proofreading; silently deleting a
    // misspelled tag would hide the one thing a human can still catch.
    expect(resolvePreviewTokens('{{locations.name}}', ACCOUNT)).toBe('{{locations.name}}');
  });

  it('HTML-escapes the substituted value', () => {
    expect(resolvePreviewTokens('{{location.name}}', { ...ACCOUNT, dealer: "Bob's Tires & Lube" }))
      .toBe('Bob&#39;s Tires &amp; Lube');
  });

  it('returns an empty string for empty input rather than throwing', () => {
    expect(resolvePreviewTokens('', ACCOUNT)).toBe('');
  });
});

describe('loadPreviewAccountData', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('parses the JSON blob columns', async () => {
    findUnique.mockResolvedValueOnce({
      key: 'youngMazda',
      ...ACCOUNT,
      salesPhone: null,
      servicePhone: null,
      partsPhone: null,
      timezone: null,
      logos: JSON.stringify({ light: 'https://cdn/light.png' }),
      branding: JSON.stringify({ colors: { primary: '#101820' } }),
      customValues: JSON.stringify({ sales_phone: { name: 'Sales', value: '(406) 555-0101' } }),
      parentAccountKey: null,
    });

    const data = await loadPreviewAccountData('youngMazda');
    expect(data?.logos).toEqual({ light: 'https://cdn/light.png' });
    expect(data?.branding?.colors?.primary).toBe('#101820');
    expect(data?.customValues?.sales_phone.value).toBe('(406) 555-0101');
  });

  it('fills logo and branding gaps from the parent account, child wins', async () => {
    findUnique
      .mockResolvedValueOnce({
        key: 'youngMazda',
        ...ACCOUNT,
        salesPhone: null,
        servicePhone: null,
        partsPhone: null,
        timezone: null,
        logos: JSON.stringify({ light: 'https://cdn/rooftop-light.png' }),
        branding: JSON.stringify({ colors: { primary: '#101820' } }),
        customValues: null,
        parentAccountKey: 'youngGroup',
      })
      .mockResolvedValueOnce({
        logos: JSON.stringify({
          light: 'https://cdn/group-light.png',
          dark: 'https://cdn/group-dark.png',
        }),
        branding: JSON.stringify({ colors: { primary: '#ffffff', accent: '#c8102e' } }),
        parentAccountKey: null,
      });

    const data = await loadPreviewAccountData('youngMazda');
    expect(data?.logos).toEqual({
      light: 'https://cdn/rooftop-light.png',
      dark: 'https://cdn/group-dark.png',
    });
    expect(data?.branding?.colors).toEqual({ primary: '#101820', accent: '#c8102e' });
  });

  it('survives a parent cycle instead of walking forever', async () => {
    findUnique
      .mockResolvedValueOnce({
        key: 'a',
        ...ACCOUNT,
        salesPhone: null,
        servicePhone: null,
        partsPhone: null,
        timezone: null,
        logos: null,
        branding: null,
        customValues: null,
        parentAccountKey: 'b',
      })
      .mockResolvedValueOnce({ logos: null, branding: null, parentAccountKey: 'a' });

    await expect(loadPreviewAccountData('a')).resolves.toBeTruthy();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('returns null for an account that no longer exists', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(loadPreviewAccountData('gone')).resolves.toBeNull();
  });

  it('drops blank columns so the preview map can fall back to its sample', async () => {
    findUnique.mockResolvedValueOnce({
      key: 'youngMazda',
      ...ACCOUNT,
      phone: '   ',
      salesPhone: null,
      servicePhone: null,
      partsPhone: null,
      timezone: null,
      logos: null,
      branding: null,
      customValues: null,
      parentAccountKey: null,
    });

    const data = await loadPreviewAccountData('youngMazda');
    expect(data?.phone).toBeUndefined();
  });
});
