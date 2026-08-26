import { describe, it, expect } from 'vitest';
import { summarizeLibrary, surveyLibrary, surveyShowFor } from './show-for-survey';
import { youngSubaruSingleOffer } from './archetypes/young-subaru-archetype';
import { youngSubaruSingleOfferDoc } from './templates/young-subaru-offers';
import { vehicleOfferDoc } from './templates/vehicle-offer-doc';
import type { TemplateDoc, DocElement } from './doc-types';

/**
 * The survey decides what a person has to look at, so what matters is the
 * classification: a gated layer that is part of a per-type plate set is a
 * mechanical migration, and one that gates real content is not.
 */

function docWith(elements: DocElement[]): TemplateDoc {
  const base = youngSubaruSingleOffer();
  return { ...base, id: 'survey-test', name: 'Survey test', elements };
}

const gated = (id: string, key: string, types: string[], name?: string): DocElement =>
  ({
    id,
    type: 'text',
    name,
    binding: { kind: 'field', key },
    visibleWhen: { field: 'offerType', in: types },
  }) as DocElement;

describe('a design with no offer-type gating', () => {
  it('is unaffected — the archetype gates nothing at all', () => {
    const r = surveyShowFor(youngSubaruSingleOffer());
    expect(r.verdict).toBe('unaffected');
    expect(r.gated).toEqual([]);
    expect(r.summary).toContain('Nothing to migrate');
  });
});

describe('gating that only switches plate copies', () => {
  const r = surveyShowFor(
    docWith([
      gated('lease-fig', '_offerMain', ['lease'], 'Lease payment'),
      gated('apr-fig', 'aprRate', ['apr'], 'APR figure'),
      gated('lease-terms', '_offerTerms', ['lease'], 'Lease terms'),
    ]),
  );

  it('is a mechanical plate migration', () => {
    expect(r.verdict).toBe('plate_migration');
    expect(r.replaceable).toBe(3);
    expect(r.contentGated).toBe(0);
  });

  it('counts the plates the migrated design needs, not the layers it loses', () => {
    expect(r.summary).toContain('1 offer plate replaces them');
  });

  it('names the offer types in the reader own words', () => {
    expect(r.summary).toContain('Lease');
    expect(r.summary).toContain('APR');
  });

  it('counts a second offer slot separately', () => {
    const dual = surveyShowFor(
      docWith([
        gated('o1', '_offerMain', ['lease']),
        gated('o2', '_o2_offerMain', ['apr']),
      ]),
    );
    expect(dual.verdict).toBe('plate_migration');
    expect(dual.summary).toContain('2 offer plates');
  });
});

describe('gating that carries content', () => {
  const r = surveyShowFor(
    docWith([
      gated('fig', '_offerMain', ['lease', 'apr'], 'Offer figure'),
      // A real per-type disclosure: cost per $1,000 borrowed belongs on an APR ad
      // and nowhere else. No plate renders this, so deleting the gate changes what
      // the ad says.
      gated('cpt', 'costPerThousand', ['apr'], 'Cost per $1,000'),
    ]),
  );

  it('needs a person to decide', () => {
    expect(r.verdict).toBe('needs_decision');
    expect(r.replaceable).toBe(1);
    expect(r.contentGated).toBe(1);
  });

  it('names the layers that are the reason', () => {
    expect(r.summary).toContain('Cost per $1,000');
    expect(r.summary).toContain('needs a call');
  });

  it('treats a typed static line as content unless it types an offer token', () => {
    const staticGate = surveyShowFor(
      docWith([
        {
          id: 'legal',
          type: 'text',
          name: 'APR legal line',
          binding: { kind: 'static', value: 'Financing subject to credit approval.' },
          visibleWhen: { field: 'offerType', in: ['apr'] },
        } as DocElement,
      ]),
    );
    expect(staticGate.verdict).toBe('needs_decision');
    expect(staticGate.gated[0].shows).toBe('static text');

    const tokenGate = surveyShowFor(
      docWith([
        {
          id: 'fig',
          type: 'text',
          name: 'Figure',
          binding: { kind: 'static', value: '{{_offerMain}} for {{leaseTerm}} months' },
          visibleWhen: { field: 'offerType', in: ['lease'] },
        } as DocElement,
      ]),
    );
    expect(tokenGate.verdict).toBe('plate_migration');
  });
});

describe('the library view', () => {
  const reports = surveyLibrary([
    youngSubaruSingleOffer(),
    youngSubaruSingleOfferDoc,
    vehicleOfferDoc,
    docWith([gated('cpt', 'costPerThousand', ['apr'], 'Cost per $1,000')]),
  ]);

  it('puts what needs a decision first', () => {
    expect(reports[0].verdict).toBe('needs_decision');
  });

  it('sorts unaffected templates last, where nobody has to read them', () => {
    expect(reports[reports.length - 1].verdict).toBe('unaffected');
  });

  it('counts the library in one line', () => {
    const line = summarizeLibrary(reports);
    expect(line).toContain('4 templates');
    expect(line).toContain('needing a decision');
  });

  it('reports on the real hand-built templates without throwing', () => {
    for (const r of reports) {
      expect(r.templateId, r.name).toBeTruthy();
      expect(r.summary.length).toBeGreaterThan(10);
    }
  });
});
