import { describe, it, expect } from 'vitest';
import {
  effectiveIndustries,
  templateInIndustry,
  isVehicleIndustry,
  splitTemplatesByIndustry,
  offerKindsForIndustry,
  kindInIndustry,
} from './industry';
import { OFFER_KINDS } from './offer-kinds';

describe('ad-generator industry scoping', () => {
  it('treats Automotive + Powersports as vehicle industries', () => {
    expect(isVehicleIndustry('Automotive')).toBe(true);
    expect(isVehicleIndustry('powersports')).toBe(true);
    expect(isVehicleIndustry('Healthcare')).toBe(false);
    expect(isVehicleIndustry(undefined)).toBe(false);
  });

  it('uses explicit industries when set', () => {
    expect(effectiveIndustries({ industries: ['Healthcare'] })).toEqual(['Healthcare']);
  });

  it('an untagged template has no industries (global to all)', () => {
    expect(effectiveIndustries({})).toEqual([]);
    expect(effectiveIndustries({ industries: [] })).toEqual([]);
  });

  it('scopes a tagged template to matching accounts, hides it from others', () => {
    expect(templateInIndustry({ industries: ['Automotive'] }, 'Automotive')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive', 'Powersports'] }, 'Powersports')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive'] }, 'Healthcare')).toBe(false);
  });

  it('an untagged template is global — visible to every account', () => {
    expect(templateInIndustry({}, 'Healthcare')).toBe(true);
    expect(templateInIndustry({ industries: [] }, 'Automotive')).toBe(true);
  });

  it('admin / no account sees the full library', () => {
    expect(templateInIndustry({ industries: ['Healthcare'] }, '')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive'] }, null)).toBe(true);
  });

  // ── Offer kinds ──
  //
  // The bug these cover: the kind registry is industry-blind, so a marketing
  // agency's "New template" modal offered "Blank vehicle offer" and the form
  // that follows asked for a lease term and a VIN.

  it('offers every kind to a vehicle industry', () => {
    expect(offerKindsForIndustry('Automotive').map((k) => k.id)).toEqual(OFFER_KINDS.map((k) => k.id));
    expect(offerKindsForIndustry('powersports').map((k) => k.id)).toContain('vehicle');
  });

  it('withholds vehicle-picker kinds from a non-vehicle industry', () => {
    const ids = offerKindsForIndustry('Marketing Agency').map((k) => k.id);
    expect(ids).not.toContain('vehicle');
    expect(ids).toEqual(['custom']);
  });

  it('leaves at least one kind for every industry — nobody is locked out', () => {
    for (const industry of ['Marketing Agency', 'Healthcare', 'Home Services']) {
      expect(offerKindsForIndustry(industry).length, industry).toBeGreaterThan(0);
    }
  });

  it('gives a kind that can stand alone its own sole-choice wording', () => {
    // "Custom offer — service, parts, hiring" is written to tell it apart from
    // the vehicle kind. Where it is the only kind there is nothing to tell it
    // apart from, and the fixed-ops examples name a sector the account isn't in.
    for (const k of offerKindsForIndustry('Marketing Agency')) {
      expect(k.soleChoiceCopy?.label.trim(), `${k.id} needs sole-choice copy`).toBeTruthy();
      expect(k.soleChoiceCopy?.description ?? '').not.toMatch(/vehicle|parts|service/i);
    }
  });

  it('admin / no account keeps every kind', () => {
    expect(offerKindsForIndustry('').map((k) => k.id)).toEqual(OFFER_KINDS.map((k) => k.id));
    expect(offerKindsForIndustry(null).map((k) => k.id)).toEqual(OFFER_KINDS.map((k) => k.id));
  });

  it('an account with no industry set keeps every kind', () => {
    // Withholding the vehicle kind because a settings field is blank would break
    // every dealer that never filled it in.
    expect(offerKindsForIndustry(undefined).map((k) => k.id)).toContain('vehicle');
  });

  it('hides a vehicle-kind template from a non-vehicle account', () => {
    expect(kindInIndustry({ offerKind: 'vehicle' }, 'Marketing Agency')).toBe(false);
    expect(kindInIndustry({ offerKind: 'vehicle' }, 'Automotive')).toBe(true);
    expect(kindInIndustry({ offerKind: 'custom' }, 'Marketing Agency')).toBe(true);
  });

  it('reads a doc with no kind as vehicle — legacy templates carried that schema', () => {
    expect(kindInIndustry({}, 'Marketing Agency')).toBe(false);
    expect(kindInIndustry({}, 'Automotive')).toBe(true);
    expect(kindInIndustry({}, null)).toBe(true);
  });
});

describe('splitTemplatesByIndustry', () => {
  const vehicleDoc = { industries: undefined, offerKind: 'vehicle' as const };
  const customDoc = { industries: undefined, offerKind: 'custom' as const };
  const legacyDoc = { industries: undefined, offerKind: undefined };
  const autoTagged = { industries: ['Automotive'], offerKind: 'custom' as const };

  it('reproduces the Oz Marketing incident: every vehicle template withheld from a non-vehicle account', () => {
    const owned = [
      { id: 'proto', doc: vehicleDoc },
      { id: 'proto-copy', doc: vehicleDoc },
      { id: 'bonneville', doc: vehicleDoc },
      { id: 'vehicle-offer', doc: autoTagged },
    ];
    const { visible, hidden } = splitTemplatesByIndustry(owned, 'Marketing Agency');
    // This is what made a full library render as "No ad templates yet".
    expect(visible).toEqual([]);
    expect(hidden).toHaveLength(4);
  });

  it('shows all of them to an automotive account', () => {
    const owned = [{ id: 'a', doc: vehicleDoc }, { id: 'b', doc: autoTagged }];
    const { visible, hidden } = splitTemplatesByIndustry(owned, 'Automotive');
    expect(visible).toHaveLength(2);
    expect(hidden).toEqual([]);
  });

  it('counts a legacy doc with no offerKind as vehicle, so it hides too', () => {
    const { visible, hidden } = splitTemplatesByIndustry([{ id: 'legacy', doc: legacyDoc }], 'Dental');
    expect(visible).toEqual([]);
    expect(hidden).toHaveLength(1);
  });

  it('keeps a custom-kind template visible to a non-vehicle account', () => {
    const { visible, hidden } = splitTemplatesByIndustry([{ id: 'c', doc: customDoc }], 'Marketing Agency');
    expect(visible).toHaveLength(1);
    expect(hidden).toEqual([]);
  });

  it('splits a mixed library, which is what the "N more hidden" note reports', () => {
    const owned = [
      { id: 'usable', doc: customDoc },
      { id: 'withheld', doc: vehicleDoc },
    ];
    const { visible, hidden } = splitTemplatesByIndustry(owned, 'Marketing Agency');
    expect(visible.map((t) => t.id)).toEqual(['usable']);
    expect(hidden.map((t) => t.id)).toEqual(['withheld']);
  });

  it('admin (no industry) sees everything and hides nothing', () => {
    const owned = [{ id: 'a', doc: vehicleDoc }, { id: 'b', doc: autoTagged }];
    expect(splitTemplatesByIndustry(owned, null).hidden).toEqual([]);
    expect(splitTemplatesByIndustry(owned, null).visible).toHaveLength(2);
  });

  it('drops an unreadable doc from BOTH halves — it is not "hidden by industry"', () => {
    const { visible, hidden } = splitTemplatesByIndustry([{ id: 'broken', doc: null }], 'Marketing Agency');
    expect(visible).toEqual([]);
    expect(hidden).toEqual([]);
  });
});
