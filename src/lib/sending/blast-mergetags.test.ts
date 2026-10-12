import { describe, expect, it } from 'vitest';
import {
  analyzeMergetags,
  applyBlastMergetags,
  buildBlastMergetagContext,
  findUnknownMergetags,
  formatMergeDate,
  listMergetags,
  parseMergetag,
  resolveMergetagValue,
  scanMergetags,
  stringifyMergeValue,
  suggestMergetag,
  withUrlScheme,
} from './blast-mergetags';

const UNSUB = '[%unsubscribe_url%]';

function ctx(overrides?: {
  contact?: Parameters<typeof buildBlastMergetagContext>[0]['contact'];
  account?: Parameters<typeof buildBlastMergetagContext>[0]['account'];
}) {
  return buildBlastMergetagContext({
    contact: overrides?.contact ?? {
      firstName: 'Dana',
      lastName: 'Reyes',
      email: 'dana@example.com',
      city: 'Layton',
      vehicleMake: 'Audi',
      vehicleModel: 'Q5',
      lastServiceDate: new Date('2026-03-04T18:30:00.000Z'),
      customFields: { loyalty_tier: 'gold', visits: 4 },
    },
    account: overrides?.account ?? {
      dealer: 'Audi Layton',
      senderEmail: 'marketing@audilayton.com',
      city: 'Layton',
      state: 'UT',
    },
    unsubscribeToken: UNSUB,
  });
}

describe('buildBlastMergetagContext', () => {
  it('exposes the dotted namespace the template editor advertises', () => {
    const c = ctx();
    expect(c['contact.first_name']).toBe('Dana');
    expect(c['contact.full_name']).toBe('Dana Reyes');
    expect(c['location.name']).toBe('Audi Layton');
    expect(c['unsubscribe_link']).toBe(UNSUB);
  });

  it('derives full_name when the column is empty', () => {
    const c = ctx({ contact: { firstName: 'Sam', lastName: 'Vance' } });
    expect(c['contact.full_name']).toBe('Sam Vance');
  });

  it('renders dates the way a US reader writes them', () => {
    expect(ctx()['contact.last_service_date']).toBe('March 4, 2026');
  });

  it('namespaces custom fields and stringifies non-strings', () => {
    const c = ctx();
    expect(c['custom_values.loyalty_tier']).toBe('gold');
    expect(c['custom_values.visits']).toBe('4');
  });

  it('yields empty strings, never undefined, for absent contact data', () => {
    const c = buildBlastMergetagContext({
      contact: null,
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(c['contact.first_name']).toBe('');
    expect(c['location.name']).toBe('');
  });
});

describe('applyBlastMergetags', () => {
  it('substitutes known tags', () => {
    const out = applyBlastMergetags('Hi {{contact.first_name}}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi Dana!');
  });

  it('tolerates inner whitespace', () => {
    const out = applyBlastMergetags('Hi {{  contact.first_name  }}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi Dana!');
  });

  it('resolves a KNOWN but empty tag to nothing rather than leaving braces', () => {
    const out = applyBlastMergetags(
      'Hi {{contact.first_name}}!',
      buildBlastMergetagContext({
        contact: { firstName: null },
        account: null,
        unsubscribeToken: UNSUB,
      }),
      { escape: true },
    );
    expect(out).toBe('Hi !');
  });

  it('leaves an UNKNOWN tag intact so a typo stays visible', () => {
    const out = applyBlastMergetags('Hi {{contact.frist_name}}!', ctx(), {
      escape: true,
    });
    expect(out).toBe('Hi {{contact.frist_name}}!');
  });

  // This is the whole point of the module: the editor offers
  // {{unsubscribe_link}} as a link target, and it has to become a real URL.
  it('turns {{unsubscribe_link}} into the SendGrid substitution tag', () => {
    const out = applyBlastMergetags(
      '<a href="{{unsubscribe_link}}">Unsubscribe</a>',
      ctx(),
      { escape: true },
    );
    expect(out).toBe(`<a href="${UNSUB}">Unsubscribe</a>`);
  });

  it('escapes HTML in substituted values but not in the template', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: `Tim & "Bud" <O'Neil>` },
      account: null,
      unsubscribeToken: UNSUB,
    });
    const out = applyBlastMergetags('<p>Hi {{contact.first_name}}</p>', c, {
      escape: true,
    });
    expect(out).toBe(
      '<p>Hi Tim &amp; &quot;Bud&quot; &lt;O&#39;Neil&gt;</p>',
    );
  });

  it('does not escape for the text/plain part', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: 'Tim & Bud' },
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('Hi {{contact.first_name}}', c, { escape: false }))
      .toBe('Hi Tim & Bud');
  });

  it('returns empty string for empty input', () => {
    expect(applyBlastMergetags('', ctx(), { escape: true })).toBe('');
  });

  it('ignores single-brace text', () => {
    expect(applyBlastMergetags('{contact.first_name}', ctx(), { escape: true }))
      .toBe('{contact.first_name}');
  });
});

describe('findUnknownMergetags', () => {
  it('reports only the tags that would ship literally', () => {
    const found = findUnknownMergetags(
      'Hi {{contact.first_name}}, your {{vehicle_make}} at {{location.name}}',
      ctx(),
    );
    expect(found).toEqual(['vehicle_make']);
  });

  it('dedupes repeats', () => {
    expect(findUnknownMergetags('{{nope}} {{nope}}', ctx())).toEqual(['nope']);
  });

  it('finds nothing in a fully valid body', () => {
    expect(
      findUnknownMergetags('{{contact.first_name}} {{unsubscribe_link}}', ctx()),
    ).toEqual([]);
  });
});

describe('listMergetags', () => {
  it('lists every referenced tag', () => {
    expect(
      listMergetags('{{contact.first_name}} and {{location.name}}').sort(),
    ).toEqual(['contact.first_name', 'location.name']);
  });
});

// ── Dates ───────────────────────────────────────────────────────────────

describe('formatMergeDate', () => {
  it('reads a date-only string straight off the calendar', () => {
    expect(formatMergeDate('2026-10-31')).toBe('October 31, 2026');
  });

  // The off-by-one this guards against: a lease end imported as "2026-10-31"
  // is stored as midnight UTC, which is the evening of October 30 in Utah.
  it('never slides a midnight-UTC date to the previous day in a US zone', () => {
    const stored = new Date('2026-10-31T00:00:00.000Z');
    expect(formatMergeDate(stored, 'America/Denver')).toBe('October 31, 2026');
    expect(formatMergeDate(stored, 'America/Los_Angeles')).toBe('October 31, 2026');
  });

  it("puts a real timestamp on the account's own calendar day", () => {
    // 9:30pm on Oct 31 in Utah is already Nov 1 in UTC.
    const instant = new Date('2026-11-01T03:30:00.000Z');
    expect(formatMergeDate(instant, 'America/Denver')).toBe('October 31, 2026');
    expect(formatMergeDate(instant)).toBe('November 1, 2026');
  });

  it('falls back to UTC for a zone it does not recognize', () => {
    expect(formatMergeDate(new Date('2026-11-01T03:30:00.000Z'), 'Mars/Olympus')).toBe(
      'November 1, 2026',
    );
  });

  it('handles empty, invalid and non-date input without throwing', () => {
    expect(formatMergeDate(null)).toBe('');
    expect(formatMergeDate('')).toBe('');
    expect(formatMergeDate(new Date('nope'))).toBe('');
    expect(formatMergeDate('next Tuesday')).toBe('next Tuesday');
  });
});

// ── Filters and fallbacks ───────────────────────────────────────────────

describe('applyBlastMergetags — filters', () => {
  const blank = buildBlastMergetagContext({
    contact: { firstName: '' },
    account: null,
    unsubscribeToken: UNSUB,
  });

  it('gives a blank value its default instead of "Hi ,"', () => {
    expect(
      applyBlastMergetags('Hi {{contact.first_name | default: "there"}},', blank, { escape: false }),
    ).toBe('Hi there,');
  });

  it('uses the real value when there is one', () => {
    expect(
      applyBlastMergetags('Hi {{contact.first_name | default: "there"}},', ctx(), { escape: false }),
    ).toBe('Hi Dana,');
  });

  it('accepts single quotes, curly quotes and the Django-style spelling', () => {
    for (const tag of [
      "{{contact.first_name | default: 'there'}}",
      '{{contact.first_name | default: \u{201c}there\u{201d}}}',
      '{{ contact.first_name|default:"there" }}',
    ]) {
      expect(applyBlastMergetags(tag, blank, { escape: false }), tag).toBe('there');
    }
  });

  // React escapes the quotes in text it renders, so this is what a default
  // typed into a text block looks like in the compiled HTML.
  it('reads a default whose quotes the HTML renderer escaped', () => {
    expect(
      applyBlastMergetags(
        '<p>Hi {{contact.first_name | default: &quot;there &amp; everywhere&quot;}}</p>',
        blank,
        { escape: true },
      ),
    ).toBe('<p>Hi there &amp; everywhere</p>');
  });

  it('treats a whitespace-only value as blank', () => {
    const c = buildBlastMergetagContext({ contact: { firstName: '   ' }, account: null, unsubscribeToken: UNSUB });
    expect(applyBlastMergetags('{{contact.first_name | default: "friend"}}', c, { escape: false })).toBe('friend');
  });

  it('applies upper, lower, capitalize and title', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: 'dana', lastName: 'MCKAY', city: 'salt lake city' },
      account: null,
      unsubscribeToken: UNSUB,
    });
    // The seeded "Loyalty — Premium Gold" template uses exactly this tag.
    expect(applyBlastMergetags('CONGRATULATIONS, {{contact.first_name | upper}}', c, { escape: false }))
      .toBe('CONGRATULATIONS, DANA');
    expect(applyBlastMergetags('{{contact.last_name | lower}}', c, { escape: false })).toBe('mckay');
    expect(applyBlastMergetags('{{contact.first_name | capitalize}}', c, { escape: false })).toBe('Dana');
    expect(applyBlastMergetags('{{contact.city | title}}', c, { escape: false })).toBe('Salt Lake City');
  });

  it('title-cases ALL-CAPS CRM data and hyphenated names', () => {
    const c = buildBlastMergetagContext({
      contact: { fullName: 'MARY-JANE WATSON' },
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('{{contact.full_name | title}}', c, { escape: false })).toBe('Mary-Jane Watson');
  });

  it('capitalize leaves the rest of the word alone', () => {
    const c = buildBlastMergetagContext({ contact: { lastName: 'mcDonald' }, account: null, unsubscribeToken: UNSUB });
    expect(applyBlastMergetags('{{contact.last_name | capitalize}}', c, { escape: false })).toBe('McDonald');
  });

  it('chains filters left to right', () => {
    expect(
      applyBlastMergetags('{{contact.first_name | default: "valued customer" | upper}}', blank, { escape: false }),
    ).toBe('VALUED CUSTOMER');
  });

  it('leaves a tag with an unknown filter exactly as written', () => {
    const input = 'Hi {{contact.first_name | shout}}';
    expect(applyBlastMergetags(input, ctx(), { escape: false })).toBe(input);
  });

  it('leaves a default with an unquoted fallback as written', () => {
    const input = 'Hi {{contact.first_name | default: there}}';
    expect(applyBlastMergetags(input, blank, { escape: false })).toBe(input);
  });
});

describe('parseMergetag', () => {
  it('reads key and filters', () => {
    const parsed = parseMergetag(' contact.first_name | default: "there" | upper ');
    expect(parsed.problem).toBeNull();
    expect(parsed.key).toBe('contact.first_name');
    expect(parsed.filters).toEqual([
      { name: 'default', args: ['there'] },
      { name: 'upper', args: [] },
    ]);
  });

  it('keeps an escaped quote inside a fallback', () => {
    expect(parseMergetag('contact.first_name | default: "the \\"best\\" customer"').filters[0].args)
      .toEqual(['the "best" customer']);
  });

  it('reports each kind of broken filter', () => {
    expect(parseMergetag('contact.first_name | shout').problem).toEqual({ kind: 'unknown_filter', filter: 'shout' });
    expect(parseMergetag('contact.first_name | default').problem?.kind).toBe('bad_filter_args');
    expect(parseMergetag('contact.first_name | default: there').problem?.kind).toBe('bad_filter_args');
    expect(parseMergetag('contact.first_name | upper: "x"').problem?.kind).toBe('bad_filter_args');
    expect(parseMergetag('contact.first_name | default: "there').problem?.kind).toBe('bad_filter_args');
  });

  it('does not find filters on Object.prototype', () => {
    expect(parseMergetag('contact.first_name | constructor').problem).toEqual({
      kind: 'unknown_filter',
      filter: 'constructor',
    });
  });

  it('calls template syntax it does not run malformed', () => {
    for (const inner of ['#if x', '/if', 'fn(1)', '', '   ']) {
      expect(parseMergetag(inner).problem?.kind, inner).toBe('malformed');
    }
  });

  it('allows spaces and apostrophes in a custom key', () => {
    expect(parseMergetag("custom_values.Salesperson\u{2019}s Name").key).toBe(
      "custom_values.Salesperson\u{2019}s Name",
    );
  });
});

// ── Keys ────────────────────────────────────────────────────────────────

describe('prototype keys', () => {
  // `rawKey in ctx` found Object.prototype, resolved {{constructor}} to a
  // function, and escapeHtml(fn) threw — for every recipient of the blast.
  it('leaves {{constructor}}-style tags literal instead of throwing', () => {
    const input = '{{constructor}} {{toString}} {{__proto__}} {{hasOwnProperty}} {{valueOf}}';
    expect(() => applyBlastMergetags(input, ctx(), { escape: true })).not.toThrow();
    expect(applyBlastMergetags(input, ctx(), { escape: true })).toBe(input);
    expect(findUnknownMergetags(input, ctx()).sort()).toEqual(
      ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf'],
    );
  });

  it('does not resolve a custom value named after a prototype key', () => {
    expect(resolveMergetagValue(ctx(), 'custom_values.constructor')).toBeUndefined();
  });
});

describe('custom keys match regardless of case and separators', () => {
  // CSV import keeps raw headers as keys, so contacts carry "Trade In Value".
  const c = buildBlastMergetagContext({
    contact: { customFields: { 'Trade In Value': '$12,500' } },
    account: null,
    unsubscribeToken: UNSUB,
  });

  it.each([
    '{{custom_values.Trade In Value}}',
    '{{custom_values.trade_in_value}}',
    '{{custom_values.trade-in-value}}',
    '{{custom_values.TRADE_IN_VALUE}}',
    '{{ custom_values.trade   in value }}',
  ])('%s', (tag) => {
    expect(applyBlastMergetags(tag, c, { escape: false })).toBe('$12,500');
  });

  it('matches an account custom value saved with a different spelling', () => {
    const a = buildBlastMergetagContext({
      contact: null,
      account: { customValues: { trade_in_url: { name: 'Trade-in', value: 'https://dealer.com/trade' } } },
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('{{custom_values.Trade In URL}}', a, { escape: false })).toBe(
      'https://dealer.com/trade',
    );
  });
});

describe('custom value resolution order', () => {
  const account = {
    dealer: 'Audi Layton',
    servicePhone: '(801) 555-0102',
    customValues: { promo_code: { name: 'Promo', value: 'FALL25' } },
  };

  it('prefers the contact field, then the account value', () => {
    const c = buildBlastMergetagContext({
      contact: { customFields: { promo_code: 'VIP50' } },
      account,
      unsubscribeToken: UNSUB,
    });
    expect(c['custom_values.promo_code']).toBe('VIP50');
    expect(c['custom_values.service_phone']).toBe('(801) 555-0102');
  });

  it('falls through to the account when the contact cell is blank', () => {
    const c = buildBlastMergetagContext({
      contact: { customFields: { promo_code: '  ' } },
      account,
      unsubscribeToken: UNSUB,
    });
    expect(c['custom_values.promo_code']).toBe('FALL25');
  });

  it('is empty when neither has it', () => {
    const c = buildBlastMergetagContext({ contact: null, account, unsubscribeToken: UNSUB });
    expect(applyBlastMergetags('[{{custom_values.review_link}}]', c, { escape: false })).toBe('[]');
  });
});

describe('stringifyMergeValue', () => {
  it('never renders [object Object]', () => {
    expect(stringifyMergeValue({ nested: { deep: true } })).toBe('');
    expect(stringifyMergeValue({ name: 'Tier', value: 'Gold' })).toBe('Gold');
  });

  it('joins arrays, words booleans and formats ISO dates', () => {
    expect(stringifyMergeValue(['Oil change', 'Tire rotation'])).toBe('Oil change, Tire rotation');
    expect(stringifyMergeValue(true)).toBe('Yes');
    expect(stringifyMergeValue(false)).toBe('No');
    expect(stringifyMergeValue('2027-02-01')).toBe('February 1, 2027');
    expect(stringifyMergeValue('2027-02-01T00:00:00.000Z')).toBe('February 1, 2027');
    expect(stringifyMergeValue(4)).toBe('4');
    expect(stringifyMergeValue(Number.NaN)).toBe('');
  });

  it('flows through a contact context', () => {
    const c = buildBlastMergetagContext({
      contact: { customFields: { prefs: { channel: 'sms' }, services: ['A', 'B'] } },
      account: null,
      unsubscribeToken: UNSUB,
    });
    expect(c['custom_values.prefs']).toBe('');
    expect(c['custom_values.services']).toBe('A, B');
  });
});

describe('account values at send', () => {
  // The C1 regression: the preview showed these from the account while the
  // send only looked at contact custom fields.
  it('fills account-backed custom values and the public email', () => {
    const c = buildBlastMergetagContext({
      contact: null,
      account: {
        dealer: 'Audi Layton',
        email: 'info@audilayton.com',
        senderEmail: 'offers@mktg.audilayton.com',
        phone: '(801) 555-0100',
        servicePhone: '(801) 555-0102',
        logos: JSON.stringify({ light: 'https://cdn.loomi/logo.png' }),
        branding: JSON.stringify({ colors: { primary: '#bb0a30' } }),
      },
      unsubscribeToken: UNSUB,
    });
    expect(c['custom_values.service_phone']).toBe('(801) 555-0102');
    expect(c['custom_values.sales_phone']).toBe('(801) 555-0100');
    expect(c['custom_values.logo_url']).toBe('https://cdn.loomi/logo.png');
    expect(c['custom_values.brand_primary_color']).toBe('#bb0a30');
    expect(c['location.email']).toBe('info@audilayton.com');
  });

  it('uses the From address for {{location.email}} only when there is no public one', () => {
    const c = buildBlastMergetagContext({
      contact: null,
      account: { senderEmail: 'offers@mktg.audilayton.com' },
      unsubscribeToken: UNSUB,
    });
    expect(c['location.email']).toBe('offers@mktg.audilayton.com');
  });

  it('accepts {{unsubscribe_url}} as an alias, as the seeded library templates spell it', () => {
    expect(applyBlastMergetags('<a href="{{unsubscribe_url}}">x</a>', ctx(), { escape: true })).toBe(
      `<a href="${UNSUB}">x</a>`,
    );
  });
});

// ── Links ───────────────────────────────────────────────────────────────

describe('applyBlastMergetags — tags inside links', () => {
  const linkCtx = buildBlastMergetagContext({
    contact: { firstName: 'Tim & Bud', vehicleMake: 'Land Rover' },
    account: { website: 'audilayton.com', customValues: { bad: { name: 'x', value: 'javascript:alert(1)' } } },
    unsubscribeToken: UNSUB,
  });

  it('leaves a whole-URL tag as is, adding the scheme a bare website lacks', () => {
    expect(applyBlastMergetags('<a href="{{location.website}}">Shop</a>', linkCtx, { escape: true }))
      .toBe('<a href="https://audilayton.com">Shop</a>');
  });

  it('keeps the website as typed in body copy', () => {
    expect(applyBlastMergetags('<p>Visit {{location.website}}</p>', linkCtx, { escape: true }))
      .toBe('<p>Visit audilayton.com</p>');
  });

  it('builds on a website at the start of a URL without doubling the slash', () => {
    const c = buildBlastMergetagContext({ contact: null, account: { website: 'https://audilayton.com/' }, unsubscribeToken: UNSUB });
    expect(applyBlastMergetags('<a href="{{location.website}}/service">S</a>', c, { escape: true }))
      .toBe('<a href="https://audilayton.com/service">S</a>');
  });

  it('URL-encodes a value inside a query string', () => {
    expect(
      applyBlastMergetags('<a href="https://x.com/?a=1&amp;name={{contact.first_name}}">Go</a>', linkCtx, { escape: true }),
    ).toBe('<a href="https://x.com/?a=1&amp;name=Tim%20%26%20Bud">Go</a>');
  });

  it('encodes a value in a path without breaking its slashes', () => {
    expect(
      applyBlastMergetags('<a href="https://x.com/inventory/{{contact.vehicle_make}}">Go</a>', linkCtx, { escape: true }),
    ).toBe('<a href="https://x.com/inventory/Land%20Rover">Go</a>');
  });

  it('drops a script URL rather than shipping it', () => {
    expect(applyBlastMergetags('<a href="{{custom_values.bad}}">x</a>', linkCtx, { escape: true }))
      .toBe('<a href="">x</a>');
  });

  it('never encodes the unsubscribe token, wherever it sits', () => {
    expect(
      applyBlastMergetags('<a href="https://x.com/u?to={{unsubscribe_link}}">x</a>', linkCtx, { escape: true }),
    ).toBe(`<a href="https://x.com/u?to=${UNSUB}">x</a>`);
  });

  it('escapes an ampersand in a whole-URL value for the attribute', () => {
    const c = buildBlastMergetagContext({
      contact: null,
      account: { website: 'https://dealer.com/?a=1&b=2' },
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('<a href="{{location.website}}">x</a>', c, { escape: true }))
      .toBe('<a href="https://dealer.com/?a=1&amp;b=2">x</a>');
  });

  it('encodes a tag inside a URL written out in the text part', () => {
    expect(
      applyBlastMergetags('Book (https://x.com/?name={{contact.first_name}}) for {{contact.first_name}}', linkCtx, { escape: false }),
    ).toBe('Book (https://x.com/?name=Tim%20%26%20Bud) for Tim & Bud');
  });

  it('never re-scans a substituted value', () => {
    const c = buildBlastMergetagContext({
      contact: { firstName: '{{location.email}}' },
      account: { email: 'secret@dealer.com' },
      unsubscribeToken: UNSUB,
    });
    expect(applyBlastMergetags('Hi {{contact.first_name}}', c, { escape: false })).toBe('Hi {{location.email}}');
  });
});

describe('withUrlScheme', () => {
  it('adds https to a bare host and nothing else', () => {
    expect(withUrlScheme('dealer.com')).toBe('https://dealer.com');
    expect(withUrlScheme('www.dealer.com/specials?x=1')).toBe('https://www.dealer.com/specials?x=1');
    expect(withUrlScheme('//cdn.dealer.com/a.png')).toBe('https://cdn.dealer.com/a.png');
    expect(withUrlScheme('http://dealer.com')).toBe('http://dealer.com');
    expect(withUrlScheme('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(withUrlScheme('[%unsubscribe_url%]')).toBe('[%unsubscribe_url%]');
    expect(withUrlScheme('/relative/path')).toBe('/relative/path');
  });
});

// ── Analysis ────────────────────────────────────────────────────────────

describe('analyzeMergetags', () => {
  it('says why each tag would ship literally', () => {
    const problems = analyzeMergetags(
      '{{contact.frist_name}} {{contact.first_name | shout}} {{contact.first_name | default: x}} {{#if vip}}',
      ctx(),
    );
    expect(problems.map((p) => p.kind)).toEqual([
      'unknown_key',
      'unknown_filter',
      'bad_filter_args',
      'malformed',
    ]);
    expect(problems[1].filter).toBe('shout');
  });

  it('accepts every valid form', () => {
    expect(
      analyzeMergetags(
        '{{contact.first_name | default: "there"}} {{ location.name|upper }} {{custom_values.loyalty_tier | title}}',
        ctx(),
      ),
    ).toEqual([]);
  });
});

describe('scanMergetags', () => {
  it('knows which tags are links', () => {
    const found = scanMergetags(
      '<a href="{{location.website}}">x</a><a href="https://x.com/?n={{contact.first_name}}">y</a><p>{{location.name}}</p>',
      { html: true },
    );
    expect(found.map((f) => [f.parsed.key, f.attribute, f.wholeAttribute])).toEqual([
      ['location.website', 'href', true],
      ['contact.first_name', 'href', false],
      ['location.name', null, false],
    ]);
  });
});

describe('suggestMergetag', () => {
  it('finds a namespace flattened into the key', () => {
    expect(suggestMergetag('vehicle.year', ctx())).toBe('contact.vehicle_year');
  });

  it('stays inside a namespace that exists rather than guessing across it', () => {
    // {{contact.name}} is a person; {{location.name}} is the dealership.
    expect(suggestMergetag('contact.name', ctx())).toBeNull();
  });

  it('still crosses a namespace that does not exist', () => {
    expect(suggestMergetag('email.unsubscribe_link', ctx())).toBe('unsubscribe_link');
  });
});
