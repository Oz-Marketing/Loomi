import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/email/types';
import { bindBlock, bindingOf, expandPerOffer, fillTokens, repeatsPerOffer } from './offer-bindings';
import type { OfferEmailVehicle } from './offer-email-doc';

function vehicle(over: Partial<OfferEmailVehicle> = {}): OfferEmailVehicle {
  return {
    name: '2026 Honda CR-V LX',
    imageUrl: 'https://cdn.example/crv.png',
    offerType: 'lease',
    headline: '$289/mo · 36 months',
    subhead: '$4,899 due at signing',
    offerLabel: 'PER MONTH LEASE',
    offerMain: '$289/mo',
    offerTerms: '36-month lease · $4,899 due at signing',
    programName: 'Featured Special Lease',
    description: 'desc',
    offerDetails: 'details',
    eligibility: 'elig',
    disclaimer: 'Closed-end lease. See dealer.',
    expiration: 'Offer ends September 30',
    ...over,
  };
}

/** A designer's card: a section wrapping a bound image, name, figure and legal. */
function card(): Block {
  return {
    id: 'card',
    type: 'section',
    props: { repeatOver: 'offer', bgColor: '#ffffff' },
    children: [
      { id: 'img', type: 'image', props: { bindTo: 'offer.image', src: '', alt: '' } },
      { id: 'name', type: 'heading', props: { text: '{{offer.name}}' } },
      { id: 'fig', type: 'text', props: { text: '{{offer.main}}', fontSize: 44 } },
      { id: 'exp', type: 'text', props: { text: '{{offer.expiration}}' } },
      { id: 'note', type: 'text', props: { text: 'Ask about trade-in.' } },
    ],
  };
}

const textOf = (b: Block, id: string): string | undefined =>
  (b.children?.find((c) => c.id === id)?.props?.text as string) ?? undefined;

describe('bindingOf / repeatsPerOffer', () => {
  it('reads a binding and ignores blank ones', () => {
    expect(bindingOf({ id: 'a', type: 'text', props: { bindTo: 'offer.name' } })).toBe('offer.name');
    expect(bindingOf({ id: 'a', type: 'text', props: { bindTo: '  ' } })).toBeNull();
    expect(bindingOf({ id: 'a', type: 'text', props: {} })).toBeNull();
  });

  it('detects the per-offer repeat', () => {
    expect(repeatsPerOffer(card())).toBe(true);
    expect(repeatsPerOffer({ id: 'a', type: 'section', props: {} })).toBe(false);
  });
});

describe('bindBlock', () => {
  it('fills bound text from the offer', () => {
    const out = bindBlock(card(), vehicle())!;
    expect(textOf(out, 'name')).toBe('2026 Honda CR-V LX');
    expect(textOf(out, 'fig')).toBe('$289/mo');
  });

  it('fills a bound image and its alt', () => {
    const out = bindBlock(card(), vehicle())!;
    const img = out.children!.find((c) => c.id === 'img')!;
    expect(img.props.src).toBe('https://cdn.example/crv.png');
    expect(img.props.alt).toBe('2026 Honda CR-V LX');
  });

  it('leaves unbound copy exactly as the designer wrote it', () => {
    const out = bindBlock(card(), vehicle())!;
    expect(textOf(out, 'note')).toBe('Ask about trade-in.');
  });

  it('DROPS a bound block whose field is empty for this offer', () => {
    // Otherwise the card ships the placeholder the designer typed while laying
    // it out — which reads as real copy, because it is, just not about this
    // offer. "Offer ends soon" under an offer with no end date is a lie.
    const out = bindBlock(card(), vehicle({ expiration: null }))!;
    expect(out.children!.some((c) => c.id === 'exp')).toBe(false);
    expect(out.children!.some((c) => c.id === 'fig')).toBe(true);
  });

  it('drops a bound image when EVOX has no coverage', () => {
    const out = bindBlock(card(), vehicle({ imageUrl: null }))!;
    expect(out.children!.some((c) => c.id === 'img')).toBe(false);
    // The offer still goes out — real numbers without a picture beat no offer.
    expect(textOf(out, 'fig')).toBe('$289/mo');
  });

  it('falls back to the headline when the plate figure is absent', () => {
    const out = bindBlock(card(), vehicle({ offerMain: undefined }))!;
    expect(textOf(out, 'fig')).toBe('$289/mo · 36 months');
  });
});

describe('fillTokens', () => {
  it('mixes copy and data in one line', () => {
    // The reason text uses inline tokens rather than a whole-field bind: a
    // dropdown cannot express a sentence.
    expect(fillTokens('Lease a {{offer.name}} for {{offer.main}}', vehicle())).toBe(
      'Lease a 2026 Honda CR-V LX for $289/mo',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(fillTokens('{{ offer.name }}', vehicle())).toBe('2026 Honda CR-V LX');
  });

  it('returns null when any token is empty for this offer', () => {
    // All-or-nothing: "Offer ends " with nothing after it is worse than no line.
    expect(fillTokens('Offer ends {{offer.expiration}}', vehicle({ expiration: null }))).toBeNull();
  });

  it('leaves unknown tokens alone rather than blanking the line', () => {
    expect(fillTokens('Hello {{offer.nope}}', vehicle())).toBeNull();
  });
});

describe('expandPerOffer', () => {
  it('renders the authored card once per offer', () => {
    const out = expandPerOffer(card(), [
      vehicle(),
      vehicle({ name: '2026 Honda Pilot EX-L', offerMain: '$439/mo' }),
      vehicle({ name: '2026 Honda Ridgeline RTL', offerMain: '$399/mo' }),
    ]);
    expect(out).toHaveLength(3);
    expect(textOf(out[1], 'name')).toBe('2026 Honda Pilot EX-L');
    expect(textOf(out[2], 'fig')).toBe('$399/mo');
  });

  it('handles however many offers the month produced', () => {
    // The count is unknowable when the card is designed — that is the whole
    // reason this is a repeat rather than a fixed layout.
    expect(expandPerOffer(card(), [])).toHaveLength(0);
    expect(expandPerOffer(card(), Array.from({ length: 11 }, () => vehicle()))).toHaveLength(11);
  });

  it('strips the repeat marker from the copies', () => {
    // Left on, every rendered card would look like another repeat slot to
    // anything that walks the document afterwards.
    const out = expandPerOffer(card(), [vehicle()]);
    expect(repeatsPerOffer(out[0])).toBe(false);
  });
});
