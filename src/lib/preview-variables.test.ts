import { describe, expect, it } from 'vitest';
import {
  applyPreviewVariables,
  auditPreviewVariables,
  buildPreviewVariableMap,
  findMissingPreviewVariables,
  SAMPLE_PREVIEW_CONTACT,
} from './preview-variables';
import { accountMergeValues } from './sending/account-merge-values';
import { applyBlastMergetags, buildBlastMergetagContext } from './sending/blast-mergetags';

const MAP = buildPreviewVariableMap();

// buildPreviewVariableMap() gives every known token a sample value, so the
// "known but empty" case only shows up once real account data lands with
// blank fields. Model that explicitly rather than leaning on the fixture.
const MAP_WITH_BLANKS = { ...MAP, '{{location.name}}': '' };

describe('buildPreviewVariableMap sampleFallbacks', () => {
  const STRICT = buildPreviewVariableMap(null, null, { sampleFallbacks: false });

  it('defaults to sample values, which is what the editor wants', () => {
    expect(MAP['{{location.phone}}']).toBe('(801) 555-0100');
    expect(MAP['{{contact.first_name}}']).toBe('Alex');
  });

  it('empties every sample when fallbacks are off', () => {
    expect(STRICT['{{location.phone}}']).toBe('');
    expect(STRICT['{{contact.first_name}}']).toBe('');
    expect(STRICT['{{custom_values.sales_phone}}']).toBe('');
    expect(STRICT['{{unsubscribe_link}}']).toBe('');
  });

  it('still DEFINES every token it knows, so none reads as unrecognized', () => {
    // An absent key is an unknown token: the audit calls it invalid and the
    // substituter leaves the raw {{…}} standing. Emptied is not the same as
    // missing, and the download depends on the difference.
    for (const key of Object.keys(MAP)) {
      expect(STRICT, `missing ${key}`).toHaveProperty(key);
    }
    const { invalid, blank } = auditPreviewVariables(
      '{{location.phone}} {{contact.first_name}}',
      STRICT,
    );
    expect(invalid).toHaveLength(0);
    expect(blank).toEqual(['contact.first_name', 'location.phone']);
  });

  it('keeps real account data — only the invented values go', () => {
    const map = buildPreviewVariableMap(
      { dealer: 'Young Mazda', phone: '(406) 555-0143' },
      null,
      { sampleFallbacks: false },
    );
    expect(map['{{location.name}}']).toBe('Young Mazda');
    expect(map['{{location.phone}}']).toBe('(406) 555-0143');
    expect(map['{{custom_values.sales_phone}}']).toBe('(406) 555-0143');
    expect(map['{{location.city}}']).toBe('');
  });
});

describe('auditPreviewVariables', () => {
  // The report this split exists for: the editor showed
  // {{email.unsubscribe_link}} under "Missing Preview Data" with advice to
  // "select a contact with this data", so the typo looked like a data gap
  // and only surfaced as a hard blocker on the Schedule step.
  it('flags a bad namespace as invalid, not as missing data', () => {
    const { invalid, blank } = auditPreviewVariables(
      '<a href="{{email.unsubscribe_link}}">Unsub</a>',
      MAP,
    );
    expect(invalid).toContain('email.unsubscribe_link');
    expect(blank).not.toContain('email.unsubscribe_link');
  });

  it('treats the real unsubscribe token as valid', () => {
    const { invalid } = auditPreviewVariables(
      '<a href="{{unsubscribe_link}}">Unsub</a>',
      MAP,
    );
    expect(invalid).toHaveLength(0);
  });

  it('reports a known token with an empty value as blank', () => {
    const { invalid, blank } = auditPreviewVariables(
      '<p>{{location.name}}</p>',
      MAP_WITH_BLANKS,
    );
    expect(invalid).toHaveLength(0);
    expect(blank).toContain('location.name');
  });

  it('reports a known token that HAS a value as neither', () => {
    const { invalid, blank } = auditPreviewVariables('<p>{{location.name}}</p>', MAP);
    expect(invalid).toHaveLength(0);
    expect(blank).toHaveLength(0);
  });

  it('does not flag an unknown custom_values.* key as invalid', () => {
    // Per-account columns can't be enumerated here, and blast-preflight.ts
    // exempts the same prefix. Flagging them would cry wolf on valid tags.
    const { invalid, blank } = auditPreviewVariables(
      '<p>{{custom_values.spring_promo_code}}</p>',
      MAP,
    );
    expect(invalid).toHaveLength(0);
    expect(blank).toContain('custom_values.spring_promo_code');
  });

  it('separates both kinds in one template', () => {
    const { invalid, blank } = auditPreviewVariables(
      '<p>Hi {{contact.first_name}} at {{location.name}}</p>'
      + '<a href="{{email.unsubscribe_link}}">a</a>'
      + '<a href="{{contact.firstName}}">b</a>',
      MAP_WITH_BLANKS,
    );
    expect(invalid).toEqual([
      'contact.firstName',
      'email.unsubscribe_link',
    ]);
    expect(blank).toContain('location.name');
    // contact.first_name has a sample value, so it is neither.
    expect(invalid).not.toContain('contact.first_name');
    expect(blank).not.toContain('contact.first_name');
  });

  // These used to be skipped as Maizzle helpers. Maizzle is gone, so nothing
  // runs them: they ship literally and preflight blocks the send — which the
  // editor has to say first.
  it('flags template syntax Loomi no longer runs', () => {
    const { invalid, blank } = auditPreviewVariables(
      '{{ yield }} {{ page.title | upper }} {{#if x}} {{/if}} {{ fn(1) }}',
      MAP,
    );
    expect(invalid).toEqual(['#if x', '/if', 'fn(1)', 'page.title', 'yield']);
    expect(blank).toHaveLength(0);
  });

  it('flags an unsupported filter but accepts the supported ones', () => {
    const { invalid } = auditPreviewVariables(
      '{{contact.first_name | shout}} {{contact.first_name | upper}} {{contact.first_name | default: "there"}}',
      MAP,
    );
    expect(invalid).toEqual(['contact.first_name | shout']);
  });

  it('counts a blank value rescued by its default as filled', () => {
    const { blank } = auditPreviewVariables(
      '{{location.name | default: "our store"}}',
      MAP_WITH_BLANKS,
    );
    expect(blank).toHaveLength(0);
  });

  it('deduplicates a token used many times', () => {
    const { invalid } = auditPreviewVariables(
      '{{email.unsubscribe_link}} {{email.unsubscribe_link}} {{email.unsubscribe_link}}',
      MAP,
    );
    expect(invalid).toEqual(['email.unsubscribe_link']);
  });
});

describe('findMissingPreviewVariables (deprecated shim)', () => {
  it('still returns both categories together', () => {
    const out = findMissingPreviewVariables(
      '<p>{{location.name}}</p><a href="{{email.unsubscribe_link}}">a</a>',
      MAP_WITH_BLANKS,
    );
    expect(out).toContain('location.name');
    expect(out).toContain('email.unsubscribe_link');
  });
});

// ── Preview == send ─────────────────────────────────────────────────────
//
// The C1 incident: the editor filled {{custom_values.service_phone}} (and the
// logo, brand colors, every account custom value) from the account, while the
// send only read contact custom fields — so the preview showed the real phone
// and the inbox got a literal tag. Both now come from accountMergeValues();
// these tests pin that the two sides agree tag for tag.

const RICH_ACCOUNT = {
  dealer: 'Young Mazda',
  email: 'sales@youngmazda.com',
  senderEmail: 'offers@mktg.youngmazda.com',
  phone: '(406) 555-0143',
  servicePhone: '(406) 555-0150',
  partsPhone: '(406) 555-0151',
  address: '2900 N Reserve St',
  city: 'Missoula',
  state: 'MT',
  postalCode: '59808',
  website: 'youngmazda.com',
  timezone: 'America/Denver',
  logos: { light: 'https://cdn.loomi/young-mazda-light.png' },
  branding: { colors: { primary: '#101820', accent: '#c8102e' }, fonts: { heading: 'Georgia' } },
  customValues: {
    service_scheduler_url: { name: 'Service Scheduler', value: 'https://youngmazda.com/service' },
    'Holiday Hours': { name: 'Holiday Hours', value: 'Closed Thanksgiving' },
  },
};

describe('preview and send resolve account tags identically', () => {
  const preview = buildPreviewVariableMap(RICH_ACCOUNT, null, { sampleFallbacks: false });
  const send = buildBlastMergetagContext({ contact: null, account: RICH_ACCOUNT, unsubscribeToken: 'x' });

  it('agrees on every account-level tag', () => {
    const keys = Object.keys(accountMergeValues(RICH_ACCOUNT));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(preview[`{{${key}}}`], key).toBe(send[key]);
    }
  });

  it('includes the values that used to exist only in the preview', () => {
    expect(send['custom_values.service_phone']).toBe('(406) 555-0150');
    expect(send['custom_values.logo_url']).toBe('https://cdn.loomi/young-mazda-light.png');
    expect(send['custom_values.Holiday Hours']).toBe('Closed Thanksgiving');
    expect(send['custom_values.service_scheduler_url']).toBe('https://youngmazda.com/service');
  });

  it('agrees on {{location.email}}: the public address, not the bulk From address', () => {
    expect(preview['{{location.email}}']).toBe('sales@youngmazda.com');
    expect(send['location.email']).toBe('sales@youngmazda.com');
  });

  it('renders the same HTML for the same template', () => {
    const template =
      '<p>Hi {{contact.first_name | default: "there"}}! Service: {{custom_values.service_phone}}</p>'
      + '<a href="{{location.website}}">Shop</a><img src="{{custom_values.logo_url}}">'
      + '<p>{{custom_values.holiday_hours | upper}}</p>';
    expect(applyPreviewVariables(template, preview)).toBe(applyBlastMergetags(template, send, { escape: true }));
  });

  it('formats contact dates the same way on both sides', () => {
    const contact = { id: 'c1', lastServiceDate: '2026-03-04T00:00:00.000Z' };
    const previewMap = buildPreviewVariableMap(RICH_ACCOUNT, contact, { sampleFallbacks: false });
    const sendCtx = buildBlastMergetagContext({
      contact: { lastServiceDate: new Date('2026-03-04T00:00:00.000Z') },
      account: RICH_ACCOUNT,
      unsubscribeToken: 'x',
    });
    expect(previewMap['{{contact.last_service_date}}']).toBe('March 4, 2026');
    expect(sendCtx['contact.last_service_date']).toBe('March 4, 2026');
  });

  it("lets a preview contact's own custom field win, as the send does", () => {
    const map = buildPreviewVariableMap(
      RICH_ACCOUNT,
      { id: 'c1', customFields: { 'Service Phone': '(406) 555-9999' } },
      { sampleFallbacks: false },
    );
    expect(map['{{custom_values.service_phone}}']).toBe('(406) 555-9999');
  });
});

describe('buildPreviewVariableMap sample mode', () => {
  it('fills a blank account field with a sample, but never a real one', () => {
    const map = buildPreviewVariableMap({ dealer: 'Young Mazda' });
    expect(map['{{custom_values.service_phone}}']).toBe('(801) 555-0102');
    expect(map['{{location.name}}']).toBe('Young Mazda');
  });

  it('knows every contact tag the send knows, including date of birth', () => {
    const map = buildPreviewVariableMap();
    expect(map['{{contact.date_of_birth}}']).toBe('June 15, 1988');
    expect(map['{{contact.last_service_date}}']).toBe('October 5, 2025');
  });

  it('shows {{message.id}} empty, because nothing fills it at send', () => {
    expect(buildPreviewVariableMap()['{{message.id}}']).toBe('');
  });

  it('treats a blank website as missing data, not a typo', () => {
    const { invalid, blank } = auditPreviewVariables('<a href="{{location.website}}">x</a>', buildPreviewVariableMap());
    expect(invalid).toHaveLength(0);
    expect(blank).toEqual(['location.website']);
  });

  it('uses the shared sample contact', () => {
    expect(buildPreviewVariableMap()['{{contact.first_name}}']).toBe(SAMPLE_PREVIEW_CONTACT.firstName);
  });
});
