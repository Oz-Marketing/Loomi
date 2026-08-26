import { describe, it, expect } from 'vitest';
import {
  OFFER_KINDS,
  offerKind,
  offerKindForDoc,
  docOfferKind,
  fieldsForKind,
  usableByAutomation,
  DEFAULT_OFFER_KIND,
  composesDisclaimer,
  kindForOfferType,
} from './offer-kinds';
import { SYSTEM_FIELDS, SYSTEM_FIELD_DEFAULTS } from './system-fields';
import { OFFER_TYPES, offerTypeSpec } from './offer-text';
import { VEHICLE_OFFER_TYPE_SPECS } from './offer-types';
import { blankTemplateDoc } from './doc-template';
import { buildTokenValues } from './disclaimer';
import { BASELINE_REQUIRED, missingRequired } from './compliance';
import { isFieldVisible } from './types';
import { customOfferFields } from './templates/custom-offer';
import { assembleOffer, isNoOfferType } from './offer-text';
import { requiredFieldsFor } from './compliance';
import { vehicleOffer } from './templates/vehicle-offer';

describe('offer kind registry', () => {
  it('registers the kinds in picker order, with vehicle as the default', () => {
    expect(OFFER_KINDS.map((k) => k.id)).toEqual(['vehicle', 'custom']);
    expect(DEFAULT_OFFER_KIND).toBe('vehicle');
  });

  it('gives every kind a unique id and a non-empty schema', () => {
    const ids = OFFER_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of OFFER_KINDS) {
      expect(k.fields.length, `${k.id} has no fields`).toBeGreaterThan(0);
      expect(k.label.trim(), `${k.id} has no label`).not.toBe('');
    }
  });

  it('gives every kind a card badge that can be told apart', () => {
    // The badge sits beside two NEUTRAL grey chips (draft status, and the
    // "Custom" template-sync chip) and the emerald "ready" status. A kind whose
    // shortLabel or tone is missing renders an unreadable or invisible badge.
    for (const k of OFFER_KINDS) {
      expect(k.shortLabel.trim(), `${k.id} needs a shortLabel`).not.toBe('');
      expect(k.shortLabel.length, `${k.id} shortLabel too long for a 9px chip`).toBeLessThanOrEqual(10);
      expect(['blue', 'amber', 'violet'], `${k.id} tone`).toContain(k.tone);
    }
  });

  it('never lets a kind declare a field key twice', () => {
    for (const k of OFFER_KINDS) {
      const keys = k.fields.map((f) => f.key);
      expect(new Set(keys).size, `${k.id} has duplicate field keys`).toBe(keys.length);
    }
  });

  it('gives every kind defaults only for keys it actually declares', () => {
    // A default for a field the kind doesn't have is dead weight that shows up
    // as a phantom value in `renderData` and in preflight's bound-field list.
    // `dealerName` / `brandColor` / `logoUrl` come from account branding rather
    // than the schema, so they're expected extras.
    const branding = new Set(['dealerName', 'brandColor', 'logoUrl']);
    for (const k of OFFER_KINDS) {
      const keys = new Set(k.fields.map((f) => f.key));
      const orphans = Object.keys(k.defaults).filter((d) => !keys.has(d) && !branding.has(d));
      expect(orphans, `${k.id} has defaults for unknown fields`).toEqual([]);
    }
  });

  it('sources the vehicle schema from the code template, not a copy', () => {
    // Not just deep-equal: the SAME array, so the two can never drift.
    expect(offerKind('vehicle').fields).toBe(vehicleOffer.fields);
    expect(SYSTEM_FIELDS).toBe(vehicleOffer.fields);
  });

  it('keeps SYSTEM_FIELD_DEFAULTS intact (preflight derives its placeholder guard from it)', () => {
    // The placeholder-leak guard keys off the "X,XXX"-style entries here; losing
    // one would silently stop preflight catching that placeholder in a render.
    expect(SYSTEM_FIELD_DEFAULTS.monthlyPayment).toBe('XXX');
    expect(SYSTEM_FIELD_DEFAULTS.msrp).toBe('XX,XXX');
    expect(SYSTEM_FIELD_DEFAULTS.vehicleName).toBe(vehicleOffer.defaults.vehicleName);
  });

  it('falls back to vehicle for an unknown or empty kind id', () => {
    // A doc's kind is persisted JSON and can outlive the kind that wrote it;
    // falling back keeps that template editable instead of taking the library down.
    expect(offerKind('nope').id).toBe('vehicle');
    expect(offerKind('').id).toBe('vehicle');
    expect(offerKind(undefined).id).toBe('vehicle');
    expect(offerKind(null).id).toBe('vehicle');
  });

  it('reads an absent doc.offerKind as vehicle', () => {
    expect(docOfferKind({})).toBe('vehicle');
    expect(docOfferKind({ offerKind: '  ' })).toBe('vehicle');
    expect(docOfferKind({ offerKind: 'vehicle' })).toBe('vehicle');
    expect(offerKindForDoc({}).id).toBe('vehicle');
    expect(fieldsForKind(undefined)).toBe(vehicleOffer.fields);
  });

  it('never claims dual-offer support without offer types', () => {
    // "Two offers" merges the VEHICLE dual field kit, so a kind claiming
    // dualOffer without being the vehicle-shaped one would inject the wrong
    // schema. Offer types are a necessary condition.
    for (const k of OFFER_KINDS) {
      if (k.capabilities.dualOffer) expect(k.offerTypes.length, `${k.id}`).toBeGreaterThan(0);
    }
  });

  it('gives every offer type a globally unique value', () => {
    // `assembleOffer` only ever receives AdData, so it looks a spec up by VALUE
    // with no kind in scope. A second kind reusing `lease` would silently
    // assemble the vehicle one.
    const values = OFFER_KINDS.flatMap((k) => k.offerTypes.map((t) => t.value));
    expect(new Set(values).size).toBe(values.length);
  });

  it('derives a required-field baseline for every type of every kind', () => {
    // `BASELINE_REQUIRED` used to be a hand-written `Record<OfferType, …>`, which
    // meant a new kind's types resolved to `undefined` and silently required
    // nothing. Deriving it from the specs is what makes that impossible.
    for (const k of OFFER_KINDS) {
      for (const t of k.offerTypes) {
        expect(BASELINE_REQUIRED[t.value], `${k.id}/${t.value}`).toEqual(t.required ?? []);
      }
    }
    // A free-text or message-only type intrinsically requires nothing.
    expect(BASELINE_REQUIRED.custom).toEqual([]);
    expect(BASELINE_REQUIRED.no_offer).toEqual([]);
  });

  it('resolves every registered offer type through offerTypeSpec', () => {
    for (const k of OFFER_KINDS) {
      for (const t of k.offerTypes) expect(offerTypeSpec(t.value)?.value).toBe(t.value);
    }
  });
});

describe('OFFER_TYPES (derived from the specs)', () => {
  it('is unchanged in order and labels', () => {
    // The picker list and the assembly rules now come from one source; this is
    // the assertion that the derivation didn't reorder or relabel anything.
    expect(OFFER_TYPES).toEqual([
      { value: 'lease', label: 'Lease' },
      { value: 'apr', label: 'APR Financing' },
      { value: 'discount', label: 'Discount / Cash Back' },
      { value: 'sales_price', label: 'Sales Price' },
      // Relabelled from "Custom (free text)" when the Custom offer KIND arrived
      // — the stored VALUE is unchanged, which is what matters for existing data.
      { value: 'custom', label: 'Free text' },
    ]);
  });

  it('only `custom` assembles nothing', () => {
    const noMain = VEHICLE_OFFER_TYPE_SPECS.filter((t) => !t.main).map((t) => t.value);
    expect(noMain).toEqual(['custom']);
  });
});

describe('usableByAutomation', () => {
  it('still gates on usage', () => {
    expect(usableByAutomation({ usage: 'oem' })).toBe(true);
    expect(usableByAutomation({ usage: 'both' })).toBe(true);
    expect(usableByAutomation({ usage: undefined })).toBe(true); // legacy ⇒ 'both'
    expect(usableByAutomation({ usage: 'custom' })).toBe(false);
  });

  it('also gates on the kind, so a non-automation kind can never be picked', () => {
    // The trap this exists for: automation's last resort is any published
    // template whose `make` matches the vehicle. Without the kind gate, a
    // service template becomes a candidate for a Mazda lease ad.
    expect(usableByAutomation({ usage: 'oem', offerKind: 'vehicle' })).toBe(true);
    const nonAutomation = OFFER_KINDS.filter((k) => !k.capabilities.automation);
    for (const k of nonAutomation) {
      expect(usableByAutomation({ usage: 'oem', offerKind: k.id })).toBe(false);
    }
  });
});

describe('blankTemplateDoc', () => {
  it('stamps the vehicle schema and records the kind explicitly', () => {
    const doc = blankTemplateDoc('t1', 'Untitled');
    expect(doc.offerKind).toBe('vehicle');
    expect(doc.fields).toBe(vehicleOffer.fields);
    // Recorded rather than left to the compat default: `fields` is frozen at
    // creation, so the kind and the schema stamped from it must agree for life.
    expect(offerKindForDoc(doc).fields).toBe(doc.fields);
  });

  it('defaults are a copy, so editing one doc cannot mutate the kind', () => {
    const a = blankTemplateDoc('a');
    const b = blankTemplateDoc('b');
    a.defaults.msrp = 'tampered';
    expect(b.defaults.msrp).toBe(SYSTEM_FIELD_DEFAULTS.msrp);
    expect(offerKind('vehicle').defaults.msrp).toBe(SYSTEM_FIELD_DEFAULTS.msrp);
  });

  it('falls back to the vehicle schema for an unknown kind rather than an empty form', () => {
    const doc = blankTemplateDoc('t2', 'Untitled', undefined, 'nonsense');
    expect(doc.offerKind).toBe('vehicle');
    expect(doc.fields).toBe(vehicleOffer.fields);
  });
});


describe('the custom kind', () => {
  const custom = offerKind('custom');

  it('is the whole non-vehicle taxonomy — service, parts and message-only in one', () => {
    // This started as three kinds (`service`, `parts`, `general`). Parts shares
    // 100% of service's offer math and a hiring ad is a service offer with no
    // offer, so what varied was the OFFER TYPE, not the kind.
    expect(OFFER_KINDS.map((k) => k.id)).toEqual(['vehicle', 'custom']);
    expect(custom.offerTypes.map((t) => t.value)).toEqual([
      'flat_price',
      'percent_off',
      'dollar_off',
      'other_offer',
      'no_offer',
    ]);
  });

  it('has a MAKE but no vehicle — the reason the capability had to split', () => {
    // Manufacturer service/parts co-op is real money, keyed by brand. Collapsing
    // these two flags would force a choice between a service ad that asks for a
    // VIN and a service ad with no manufacturer checking at all.
    expect(custom.capabilities.vehiclePicker).toBe(false);
    expect(custom.capabilities.manufacturerRules).toBe(true);
    expect(custom.fields.some((f) => /^_veh|^vin$|vehicleName/.test(f.key))).toBe(false);
  });

  it('is not automatable and not dual', () => {
    expect(custom.capabilities.automation).toBe(false); // no feed publishes coupons or job ads
    expect(custom.capabilities.dualOffer).toBe(false);
    for (const usage of ['oem', 'both', 'custom', undefined] as const) {
      expect(usableByAutomation({ usage, offerKind: 'custom' })).toBe(false);
    }
  });

  it('composes a disclaimer but appends no vehicle fee boilerplate', () => {
    expect(composesDisclaimer(custom)).toBe(true);
    // "Advertised price includes all dealer-imposed fees" is a claim about a
    // VEHICLE price. The correct fixed-ops sentence is legal text and is not
    // invented in code — it arrives as template bodies from the Co-op team.
    expect(custom.dealerFeeBoilerplate).toBe('');
    expect(offerKind('vehicle').dealerFeeBoilerplate).toMatch(/dealer-imposed fees/);
  });

  it('owns no offer type value the vehicle kind already owns', () => {
    // Stated here because it is WHY the phrase type is `other_offer` and not
    // `custom`, which the vehicle kind owns as a free-text offer TYPE.
    expect(kindForOfferType('custom')?.id).toBe('vehicle');
    expect(kindForOfferType('other_offer')?.id).toBe('custom');
    expect(kindForOfferType('flat_price')?.id).toBe('custom');
    expect(kindForOfferType('nonsense')).toBeUndefined();
  });

  it('assembles each offer type into the block the artwork binds to', () => {
    expect(assembleOffer({ offerType: 'flat_price', offerPrice: '79.95', regularPrice: '109' })).toEqual({
      label: 'SPECIAL',
      main: '$79.95',
      prose: '$79.95',
      value: '79.95',
      currency: '$',
      percent: '',
      terms: 'Reg. $109',
    });
    expect(assembleOffer({ offerType: 'percent_off', percentOff: '15', minimumSpend: '200' })).toMatchObject({
      main: '15% OFF',
      prose: '15% OFF',
      value: '15',
      currency: '',
      percent: '%',
      terms: 'on any purchase over $200',
    });
    expect(assembleOffer({ offerType: 'dollar_off', dollarOff: '50' })).toMatchObject({
      main: '$50 OFF',
      prose: '$50 OFF',
      currency: '$',
      percent: '',
    });
  });

  it('passes a phrase headline through verbatim — no thousands separators', () => {
    // `text` format exists for exactly this: "Buy 3 get 1 free" is not a number,
    // and running it through the number formatter is how a headline gets mangled.
    const o = assembleOffer({ offerType: 'other_offer', offerPhrase: 'Buy 3 get 1 free' });
    expect(o?.main).toBe('Buy 3 get 1 free');
    expect(o?.value).toBe('Buy 3 get 1 free');
    expect(o?.currency).toBe('');
    expect(o?.percent).toBe('');
  });

  it('assembles nothing, and requires nothing, for a message-only ad', () => {
    // This is what carries a hiring or event ad. It has to be reachable without
    // the user inventing a price.
    expect(assembleOffer({ offerType: 'no_offer', headline: 'Now Hiring' })).toBeNull();
    expect(requiredFieldsFor('no_offer')).toEqual([]);
    expect(missingRequired({ offerType: 'no_offer', headline: 'Now Hiring' })).toEqual([]);
  });

  it('tells "no offer" apart from a free-text offer', () => {
    // Both assemble nothing, but a vehicle free-text offer IS still an offer and
    // still carries manufacturer claims — so only one of them suppresses the
    // compliance checks.
    expect(isNoOfferType('no_offer')).toBe(true);
    expect(isNoOfferType('custom')).toBe(false);
    expect(isNoOfferType('flat_price')).toBe(false);
    // Unknown / empty defaults to "there IS an offer" — the reading under which
    // manufacturer rules still get checked.
    expect(isNoOfferType('')).toBe(false);
    expect(isNoOfferType(undefined)).toBe(false);
    expect(isNoOfferType('nonsense')).toBe(false);
  });

  it('requires the figure each type advertises, plus what it is', () => {
    // An ad has to say WHAT is on offer, not just a number — so offerName is
    // required for every real type, and it's what the default bodies name.
    expect(requiredFieldsFor('flat_price')).toEqual(['offerName', 'offerPrice']);
    expect(requiredFieldsFor('percent_off')).toEqual(['offerName', 'percentOff']);
    expect(requiredFieldsFor('dollar_off')).toEqual(['offerName', 'dollarOff']);
    expect(requiredFieldsFor('other_offer')).toEqual(['offerName', 'offerPhrase']);
  });

  it('has no field for either savings figure', () => {
    // They are derived. There is deliberately nowhere to type a savings claim
    // that does not match the arithmetic.
    const keys = customOfferFields.map((f) => f.key);
    expect(keys).not.toContain('savingsAmount');
    expect(keys).not.toContain('savingsPercent');
    expect(custom.slugs.savings_amount).toMatch(/^DERIVED/);
    expect(custom.slugs.savings_percent).toMatch(/^DERIVED/);
  });

  it('names its fields for what they hold, not for one of the things they hold', () => {
    // The same field carries "Synthetic Blend Oil Change" and "Genuine Subaru
    // Floor Mats". `serviceName` / `servicePrice` were renamed when parts folded
    // in — a key named after one of its uses is how a schema starts lying.
    const keys = customOfferFields.map((f) => f.key);
    expect(keys).toContain('offerName');
    expect(keys).toContain('offerPrice');
    expect(keys).not.toContain('serviceName');
    expect(keys).not.toContain('servicePrice');
  });

  it('marks copy fields AI-writable and every factual field not', () => {
    const copyOf = (k: string) => customOfferFields.find((f) => f.key === k)?.copy ?? false;
    for (const k of ['headline', 'subheadline', 'bodyText', 'ctaText', 'offerLabel']) {
      expect(copyOf(k), `${k} should be AI-writable`).toBe(true);
    }
    // A model inventing an exclusion, a phone number or a redemption limit is
    // inventing a statement of fact.
    for (const k of [
      'offerPrice', 'regularPrice', 'percentOff', 'dollarOff', 'minimumSpend',
      'appliesTo', 'includedAllowance', 'exclusions', 'partNumber', 'availabilityNote',
      'couponCode', 'redemptionLimit', 'states', 'phone', 'location', 'websiteUrl',
      'eventDates', 'expiration', 'disclaimer',
    ]) {
      expect(copyOf(k), `${k} must not be AI-writable`).toBe(false);
    }
    for (const f of customOfferFields.filter((f) => f.copy)) {
      expect(f.maxLength, `${f.key} needs a length cap`).toBeGreaterThan(0);
    }
  });

  it('starts every factual field empty and the figures as placeholders', () => {
    for (const k of [
      'appliesTo', 'includedAllowance', 'exclusions', 'partNumber', 'availabilityNote',
      'couponCode', 'redemptionLimit', 'states', 'eventDates', 'location', 'phone', 'websiteUrl',
    ]) {
      expect(custom.defaults[k], `${k} should start empty`).toBe('');
    }
    // Figures read as obvious scaffolding, like the vehicle kind's.
    expect(custom.defaults.offerPrice).toBe('XX.XX');
    expect(custom.defaults.regularPrice).toBe('XXX');
  });

  it('hides every offer and restriction input on a message-only ad', () => {
    // The point of `no_offer`: a hiring ad must not be asked for a coupon code.
    const shown = customOfferFields.filter((f) => isFieldVisible(f, { offerType: 'no_offer' }));
    for (const k of ['offerName', 'offerPrice', 'percentOff', 'couponCode', 'appliesTo', 'states']) {
      expect(shown.some((f) => f.key === k), `${k} should be hidden`).toBe(false);
    }
    // ...but the message, the media and the practical details stay.
    for (const k of ['headline', 'bodyText', 'ctaText', 'backgroundImage', 'location', 'phone', 'disclaimer']) {
      expect(shown.some((f) => f.key === k), `${k} should stay visible`).toBe(true);
    }
  });

  it('shares `expiration` and `disclaimer` with the vehicle kind, by key', () => {
    const vehicleKeys = new Set(offerKind('vehicle').fields.map((f) => f.key));
    for (const k of ['expiration', 'disclaimer']) expect(vehicleKeys.has(k)).toBe(true);
  });

  it('builds a custom doc carrying only custom fields', () => {
    const doc = blankTemplateDoc('c1', 'Oil change', undefined, 'custom');
    expect(doc.offerKind).toBe('custom');
    expect(doc.fields).toBe(customOfferFields);
    // The regression this guards: a custom doc must not inherit the ~50-field
    // vehicle schema, which is what `blankTemplateDoc` used to stamp everywhere.
    expect(doc.fields.some((f) => f.key === 'msrp')).toBe(false);
    expect(doc.fields.some((f) => f.key === 'vin')).toBe(false);
    expect(doc.defaults.msrp).toBeUndefined();
  });

  it('gives every slug it declares a resolver in the token engine', () => {
    // A slug with no case in `buildTokenValues` renders as literal `{{token}}` in
    // a legal line. Derived slugs come from `deriveOfferFigures`, so a complete
    // offer is the fixture that proves both halves are wired.
    const values = buildTokenValues({
      offerType: 'flat_price',
      dealerName: 'Oz Subaru',
      offerName: 'Oil change',
      offerPrice: '99',
      regularPrice: '139',
      percentOff: '15',
      dollarOff: '50',
      minimumSpend: '200',
      appliesTo: 'Most vehicles',
      includedAllowance: 'Up to 5 quarts',
      exclusions: 'Diesel excluded',
      partNumber: 'J501SFL500',
      availabilityNote: 'While supplies last',
      couponCode: 'OIL99',
      redemptionLimit: 'One per customer',
      offerPhrase: 'Buy 3 get 1',
      states: 'UT; ID',
      expiration: 'August 31',
      eventDates: 'August 22-24',
      location: '1234 Riverdale Rd',
      phone: '(801) 555-0100',
      websiteUrl: 'youngautomotive.com',
    });
    const unresolved = Object.keys(custom.slugs).filter((slug) => values[slug] == null);
    expect(unresolved).toEqual([]);
  });
});
