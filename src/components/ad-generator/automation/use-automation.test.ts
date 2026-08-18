import { describe, it, expect } from 'vitest';
import { BLANK_FORM, toPayload, type ScopeForm } from './use-automation';

/**
 * `save_config` is a FULL REPLACE — every field the request omits is reset to
 * its column default. So a setting that lives on the form but not in the
 * payload is silently wiped the next time anyone saves, or merely flips the
 * on/off switch (which posts the saved scope through this same function).
 *
 * That failure is invisible in review and invisible at runtime until someone
 * notices their configuration reverted, so it's pinned here.
 */
describe('toPayload', () => {
  /** Form key → the payload key it must reach. */
  const MAPPING: Record<keyof ScopeForm, string> = {
    makes: 'makes',
    focus: 'focusModels',
    exclude: 'excludeModels',
    zip: 'zip',
    windowMode: 'runWindowMode',
    templateId: 'templateMap',
    sizeIds: 'sizeIds',
    maxAds: 'maxAdsPerRun',
    minStock: 'minStock',
    mode: 'mode',
    emailEnabled: 'emailEnabled',
    emailTemplateId: 'emailTemplateId',
    emailAudienceId: 'emailAudienceId',
    emailMaxOffers: 'emailMaxOffers',
    playbookId: 'playbookId',
    expandOfferTypes: 'expandOfferTypes',
    offerPriority: 'offerTypePriority',
  };

  it('carries every editable field into the payload', () => {
    // Guards the whole class of bug rather than today's fields: add something to
    // ScopeForm without mapping it and this fails at the type level.
    const payload = toPayload(BLANK_FORM) as Record<string, unknown>;
    for (const key of Object.keys(MAPPING) as (keyof ScopeForm)[]) {
      expect(payload, `${key} is missing from the payload`).toHaveProperty(MAPPING[key]);
    }
  });

  it('round-trips the companion email settings', () => {
    const form: ScopeForm = {
      ...BLANK_FORM,
      emailEnabled: true,
      emailTemplateId: 'youngchevy-offers',
      emailAudienceId: 'aud_1',
      emailMaxOffers: '4',
    };
    expect(toPayload(form)).toMatchObject({
      emailEnabled: true,
      emailTemplateId: 'youngchevy-offers',
      emailAudienceId: 'aud_1',
      emailMaxOffers: 4,
    });
  });

  it('keeps the email off by default', () => {
    expect(toPayload(BLANK_FORM)).toMatchObject({ emailEnabled: false, emailMaxOffers: 6 });
  });

  it('falls back to a sane offer count rather than 0 on unparseable input', () => {
    // The input strips non-digits, so '' is reachable — and 0 would mean "feature
    // no offers", which reads as a limit but produces an empty email.
    expect(toPayload({ ...BLANK_FORM, emailMaxOffers: '' })).toMatchObject({ emailMaxOffers: 6 });
  });
});
