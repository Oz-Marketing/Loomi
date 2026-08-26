import { describe, it, expect } from 'vitest';
import { pageHint, rotatingExample } from './page-hints';

describe('pageHint', () => {
  it('offers the co-op specialist on the co-op guidelines tab', () => {
    expect(pageHint('/settings/coop-guidelines')?.specialist).toBe('coop');
    expect(pageHint('/settings/coop-guidelines/')?.specialist).toBe('coop');
  });

  it('stays silent on every OTHER settings tab', () => {
    // The bug this file exists to prevent: a `/settings` prefix match put
    // "Ask me about co-op" on pages with nothing to do with co-op.
    for (const tab of [
      '/settings',
      '/settings/ad-sizes',
      '/settings/contact-field-blueprints',
      '/settings/notifications',
      '/settings/ad-disclaimers',
      '/settings/users',
    ]) {
      expect(pageHint(tab), tab).toBeNull();
    }
  });

  it('matches account- and surface-scoped variants of the co-op tab', () => {
    expect(pageHint('/subaccount/young-chev/settings/coop-guidelines')?.specialist).toBe('coop');
    expect(pageHint('/app/settings/coop-guidelines')?.specialist).toBe('coop');
  });

  it('follows the co-op specialist into the ad generator, with its own teaser', () => {
    const guidelines = pageHint('/settings/coop-guidelines')!;
    const adGen = pageHint('/ad-generator/build')!;
    expect(adGen.specialist).toBe(guidelines.specialist);
    // Same agent, different question — the ask is not the same in the two places.
    expect(adGen.teaser).not.toBe(guidelines.teaser);
    expect(pageHint('/subaccount/young-chev/ad-generator')?.specialist).toBe('coop');
  });

  it('stays silent everywhere else', () => {
    for (const path of ['/dashboard', '/contacts', '/', '/flows/abc', '/templates']) {
      expect(pageHint(path), path).toBeNull();
    }
  });

  it('does not match a route that merely contains a hint path', () => {
    expect(pageHint('/docs/settings-architecture')).toBeNull();
    expect(pageHint('/docs/settings/coop-guidelines')).toBeNull();
    expect(pageHint('/settings/coop-guidelines-archive')).toBeNull();
  });

  it('rotates examples without running off the end', () => {
    const hint = pageHint('/settings/coop-guidelines')!;
    expect(rotatingExample(hint, 0)).toBe(hint.examples[0]);
    expect(rotatingExample(hint, hint.examples.length)).toBe(hint.examples[0]);
    expect(rotatingExample(hint, hint.examples.length + 2)).toBe(hint.examples[2]);
  });
});
