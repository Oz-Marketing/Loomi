import { describe, expect, it } from 'vitest';
import {
  auditPreviewVariables,
  buildPreviewVariableMap,
  findMissingPreviewVariables,
} from './preview-variables';

const MAP = buildPreviewVariableMap();

// buildPreviewVariableMap() gives every known token a sample value, so the
// "known but empty" case only shows up once real account data lands with
// blank fields. Model that explicitly rather than leaning on the fixture.
const MAP_WITH_BLANKS = { ...MAP, '{{location.name}}': '' };

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

  it('ignores Maizzle helpers and expressions', () => {
    const { invalid, blank } = auditPreviewVariables(
      '{{ yield }} {{ page.title | upper }} {{#if x}} {{/if}} {{ fn(1) }}',
      MAP,
    );
    expect(invalid).toHaveLength(0);
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
