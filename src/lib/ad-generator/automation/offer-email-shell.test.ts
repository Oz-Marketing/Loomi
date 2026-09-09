import { describe, expect, it } from 'vitest';
import { reusableTemplateSlug } from './offer-email-shell';

describe('reusableTemplateSlug', () => {
  it('reuses the row a previous rebuild created', () => {
    // The whole point: a monthly rebuild, and every design pick, must update one
    // template rather than minting "Offers", "Offers-2", "Offers-3"…
    expect(reusableTemplateSlug('acct-offers', 'oem-monthly-offers')).toBe('acct-offers');
  });

  it('refuses to reuse the SHELL itself', () => {
    // Writing the rendered email over the shell destroys its {{offers}} marker
    // and breaks every future run. This exact bug shipped once.
    expect(reusableTemplateSlug('oem-monthly-offers', 'oem-monthly-offers')).toBeNull();
  });

  it('makes a new row when nothing is recorded', () => {
    expect(reusableTemplateSlug(null, 'oem-monthly-offers')).toBeNull();
    expect(reusableTemplateSlug(undefined, 'oem-monthly-offers')).toBeNull();
  });

  it('still reuses when the account has no shell configured', () => {
    // No shell means `buildOfferEmail` produced a standalone document; there is
    // no row to collide with, so the recorded one is safe.
    expect(reusableTemplateSlug('acct-offers', null)).toBe('acct-offers');
  });
});
