import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { assembleOffer, OFFER_TYPES } from './offer-text';
import { SYSTEM_FIELD_DEFAULTS } from './system-fields';
import { vehicleOffer } from './templates/vehicle-offer';
import { vehicleDualOffer } from './templates/vehicle-dual-offer';
import { adTemplateFromDoc } from './doc-template';
import * as offerDocs from './templates/offer-docs';
import type { AdData, AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';

/**
 * Render STABILITY — the vehicle kind's output must not move.
 *
 * Offer kinds turned `assembleOffer` from a switch over five hardcoded types
 * into an interpreter over per-type specs, and moved the field schema behind a
 * registry. Both are pure refactors, and this is what holds them to it: the
 * whole point of Phase 1 is that no existing template renders differently.
 *
 * It matters more for what comes NEXT. Adding a `service` or `general` kind
 * means touching the interpreter, the registry and the shared formatters — and a
 * regression there wouldn't look like a broken test, it would look like a dealer
 * ad quietly rendering `$—/mo` or dropping its due-at-signing line. Snapshots
 * catch that; nothing else in the suite covers these templates' HTML at all.
 *
 * Renders are snapshotted as (byte length + content hash) rather than the HTML
 * itself — a single artboard is thousands of lines, and fifteen of them inline
 * would be unreviewable. The offer BLOCKS are snapshotted in full, because those
 * are small, readable, and where a formatting change would actually show up.
 *
 * When one of these fails: it is a real behaviour change until proven otherwise.
 * Diff the offer-block snapshot first — it usually says exactly what moved.
 */

function digest(html: string): string {
  return `${html.length}b sha256:${createHash('sha256').update(html).digest('hex').slice(0, 16)}`;
}

/** Offer-type values plus the two degenerate ones that must not throw. */
const TYPE_VALUES = [...OFFER_TYPES.map((t) => t.value), '', 'unrecognized'];

/** Datasets chosen to exercise the branches that differ: real values, the
 *  canonical placeholders, everything blank, and a label/style override. */
const DATASETS: { name: string; data: AdData }[] = TYPE_VALUES.flatMap((t) => [
  { name: `${t || 'empty'}/template-defaults`, data: { ...vehicleOffer.defaults, offerType: t } },
  { name: `${t || 'empty'}/placeholders`, data: { ...SYSTEM_FIELD_DEFAULTS, offerType: t } },
  { name: `${t || 'empty'}/all-blank`, data: { offerType: t } },
  {
    name: `${t || 'empty'}/overridden`,
    data: { ...vehicleOffer.defaults, offerType: t, offerLabel: 'DRIVE HOME FOR', discountLabelStyle: 'cash_back' },
  },
]);

/** The doc-driven offer templates, which render through `renderDoc` +
 *  `enrichOfferFields` rather than a hand-written code template. */
const docTemplates: AdTemplate[] = Object.entries(offerDocs)
  .filter(([, v]) => !!v && typeof v === 'object' && 'elements' in (v as object))
  .map(([key, doc]) => adTemplateFromDoc(key, doc as TemplateDoc));

describe('vehicle offer block assembly', () => {
  it('is unchanged across every offer type and dataset', () => {
    const out: Record<string, unknown> = {};
    for (const { name, data } of DATASETS) {
      out[name] = assembleOffer(data);
      out[`${name} (o2_)`] = assembleOffer({ ...data, o2_offerType: 'apr', o2_aprRate: '0', o2_aprTerm: '60' }, 'o2_');
    }
    expect(out).toMatchSnapshot();
  });
});

describe('vehicle template renders', () => {
  for (const t of [vehicleOffer, vehicleDualOffer, ...docTemplates]) {
    it(`${t.id} is byte-stable across sizes and datasets`, () => {
      const out: Record<string, string> = {};
      for (const size of t.sizes) {
        for (const { name, data } of DATASETS) out[`${size.id} · ${name}`] = digest(t.render(data, size));
      }
      expect(out).toMatchSnapshot();
    });
  }

  it('covers every template and size the vehicle kind ships', () => {
    // Guards the guard: if a template or size is dropped from the lists above,
    // its snapshot silently stops being checked.
    expect([vehicleOffer, vehicleDualOffer, ...docTemplates].map((t) => `${t.id}:${t.sizes.length}`))
      .toMatchSnapshot();
  });
});
