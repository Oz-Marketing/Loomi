import { describe, it, expect, beforeEach } from 'vitest';
import type { Block, EmailTemplate } from '@/lib/email/types';
import { DEFAULT_SETTINGS } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';
import {
  OFFERS_PLACEHOLDER,
  buildOfferEmail,
  offerBlocks,
  offerSection,
  resetBlockIds,
  spliceOffers,
  type OfferEmailInput,
  type OfferEmailVehicle,
  resolveLogoBlocks,
  dedupeProse,
  isOffersSlot,
  templateHasOffersMarker,
} from './offer-email-doc';

function vehicle(over: Partial<OfferEmailVehicle> = {}): OfferEmailVehicle {
  return {
    name: '2026 Chevrolet Silverado 1500',
    imageUrl: 'https://cdn.example.com/silverado.png',
    offerType: 'lease',
    headline: '$299/mo · 36 months',
    subhead: '$2,999 due at signing',
    programName: 'Chevrolet Lease Program',
    description: 'Well-qualified lessees only.',
    offerDetails: 'Must take delivery by 09/30.',
    eligibility: 'Not available with some other offers.',
    disclaimer: 'Plus tax, title, license. Stock #H4421A.',
    expiration: 'Offer ends September 30',
    ...over,
  };
}

function input(over: Partial<OfferEmailInput> = {}): OfferEmailInput {
  return {
    dealerName: 'Young Chevrolet',
    accentColor: '#c8102e',
    logoUrl: 'https://cdn.example.com/logo.png',
    ctaUrl: 'https://youngchev.com',
    ctaLabel: 'View inventory',
    vehicles: [vehicle()],
    ...over,
  };
}

/** Flatten a block tree so assertions don't care about nesting depth. */
function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...(b.children ? flatten(b.children) : [])]);
}

function textContents(blocks: Block[]): string[] {
  return flatten(blocks)
    .map((b) => (typeof b.props?.text === 'string' ? b.props.text : ''))
    .filter(Boolean);
}

beforeEach(() => resetBlockIds());

describe('offerSection', () => {
  it('reproduces the OEM verbiage verbatim', () => {
    const contents = textContents([offerSection(vehicle(), '#c8102e')]);
    expect(contents).toContain('Well-qualified lessees only.');
    expect(contents).toContain('Must take delivery by 09/30.');
    expect(contents).toContain('Not available with some other offers.');
  });

  it('does not render the program name', () => {
    // Connor's call: the OEM's internal program label ("Featured Special
    // Lease") is not a disclosure, and once the prose moved into the legal
    // strip it was a bold heading above nothing. The program's actual TERMS
    // still appear in full — that is what the assertion above protects.
    const contents = textContents([offerSection(vehicle(), '#c8102e')]);
    expect(contents).not.toContain('Chevrolet Lease Program');
  });

  it('reproduces the resolved disclaimer verbatim', () => {
    const contents = textContents([offerSection(vehicle(), '#c8102e')]);
    expect(contents).toContain('Plus tax, title, license. Stock #H4421A.');
  });

  it('keeps the offer when no vehicle image resolved', () => {
    // resolveJellybean returns null for models EVOX has no coverage for
    // (Accord and Civic 404 today) — an offer with real numbers is still
    // worth sending without a picture.
    const section = offerSection(vehicle({ imageUrl: null }), '#c8102e');
    const kinds = flatten([section]).map((b) => b.type);
    expect(kinds).not.toContain('image');
    expect(textContents([section])).toContain('$299/mo · 36 months');
  });

  it('drops empty OEM prose rather than emitting blank blocks', () => {
    const section = offerSection(
      vehicle({ description: '   ', offerDetails: null, eligibility: '' }),
      '#c8102e',
    );
    expect(textContents([section])).not.toContain('');
    // The disclaimer is the one thing that survives an offer with no prose.
    expect(textContents([section])).toContain('Plus tax, title, license. Stock #H4421A.');
  });
});

describe('offerBlocks', () => {
  it('carries one disclaimer per offer, not one for the email', () => {
    const blocks = offerBlocks(
      input({
        vehicles: [
          vehicle({ disclaimer: 'Silverado terms.' }),
          vehicle({ name: '2026 Chevrolet Equinox', disclaimer: 'Equinox terms.' }),
        ],
      }),
    );
    const contents = textContents(blocks);
    expect(contents).toContain('Silverado terms.');
    expect(contents).toContain('Equinox terms.');
  });

  it('spaces consecutive offers apart but does not lead with a gap', () => {
    // Each offer is a bordered card now, so the separator is space rather than a
    // rule — a divider between two boxes reads as a third line nobody drew.
    const blocks = offerBlocks(
      input({ vehicles: [vehicle(), vehicle({ name: 'Equinox' }), vehicle({ name: 'Tahoe' })] }),
    );
    expect(blocks[0].type).toBe('section');
    const gaps = blocks.filter((b) => b.type === 'spacer');
    // Two between the three cards, plus the one before the CTA button.
    expect(gaps).toHaveLength(3);
    expect(blocks.filter((b) => b.type === 'divider')).toHaveLength(0);
  });

  it('omits the CTA when the account has no website', () => {
    const blocks = offerBlocks(input({ ctaUrl: null }));
    expect(blocks.some((b) => b.type === 'button')).toBe(false);
  });
});

describe('spliceOffers', () => {
  const shell = (blocks: Block[]): EmailTemplate => ({
    version: '2',
    settings: { ...DEFAULT_SETTINGS },
    blocks,
  });

  it('replaces the marker with the offer blocks, keeping surrounding blocks', () => {
    const doc = shell([
      { id: 'h', type: 'heading', props: { text: 'Header' } },
      { id: 'm', type: 'text', props: { text: OFFERS_PLACEHOLDER } },
      { id: 'f', type: 'text', props: { text: 'Footer' } },
    ]);
    const out = spliceOffers(doc, offerBlocks(input()));
    expect(out).not.toBeNull();
    const contents = textContents(out!.blocks);
    expect(contents).toContain('Header');
    expect(contents).toContain('Footer');
    expect(contents).not.toContain(OFFERS_PLACEHOLDER);
    expect(contents).toContain('$299/mo · 36 months');
  });

  it('finds a marker nested inside a section', () => {
    const doc = shell([
      {
        id: 's',
        type: 'section',
        props: {},
        children: [{ id: 'm', type: 'text', props: { text: OFFERS_PLACEHOLDER } }],
      },
    ]);
    const out = spliceOffers(doc, offerBlocks(input()));
    expect(out).not.toBeNull();
    expect(textContents(out!.blocks)).toContain('$299/mo · 36 months');
  });

  it('tolerates whitespace around the marker', () => {
    const doc = shell([{ id: 'm', type: 'text', props: { text: `  ${OFFERS_PLACEHOLDER} ` } }]);
    expect(spliceOffers(doc, offerBlocks(input()))).not.toBeNull();
  });

  it('returns null when the shell has no marker', () => {
    // Must not silently send a shell with no offers in it — an empty email
    // nobody notices until a client does.
    const doc = shell([{ id: 'h', type: 'heading', props: { text: 'Header' } }]);
    expect(spliceOffers(doc, offerBlocks(input()))).toBeNull();
  });

  it('fills the first marker and removes the others', () => {
    // This used to assert the leftover marker STAYED, which meant a shell with
    // two slots mailed a literal "{{offers}}" to the recipient. The offers can
    // only be emitted once, so a surplus slot has nothing to become.
    const doc = shell([
      { id: 'm1', type: 'text', props: { text: OFFERS_PLACEHOLDER } },
      { id: 'm2', type: 'text', props: { text: OFFERS_PLACEHOLDER } },
    ]);
    const out = spliceOffers(doc, offerBlocks(input()));
    expect(textContents(out!.blocks).filter((c) => c === OFFERS_PLACEHOLDER)).toHaveLength(0);
  });
});

describe('buildOfferEmail', () => {
  it('produces a v2 document with the dealer name in the title', () => {
    const doc = buildOfferEmail(input());
    expect(doc.version).toBe('2');
    expect(doc.title).toContain('Young Chevrolet');
  });

  it('omits the logo block when no logo resolves', () => {
    const doc = buildOfferEmail(input({ logoUrl: null }));
    expect(doc.blocks.some((b) => b.type === 'logo')).toBe(false);
  });

  it('generates unique block ids across the whole document', () => {
    const doc = buildOfferEmail(
      input({ vehicles: [vehicle(), vehicle({ name: 'Equinox' }), vehicle({ name: 'Tahoe' })] }),
    );
    const ids = flatten(doc.blocks).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Renders for real, through the same react-email path the send worker uses.
 *
 * This is the test that matters most here: the block components ignore props
 * they don't recognise, so a wrong prop name (`content` instead of `text`,
 * `href` instead of `url`) produces a structurally valid document that renders
 * as a blank email. Only rendering catches it.
 */
describe('rendering', () => {
  it('renders the offer, the OEM verbiage and the disclaimer into the HTML', async () => {
    const html = await renderEmailTemplate(buildOfferEmail(input()));
    expect(html).toContain('2026 Chevrolet Silverado 1500');
    expect(html).toContain('$299/mo');
    expect(html).toContain('Well-qualified lessees only.');
    expect(html).toContain('Plus tax, title, license.');
  });

  it('renders the vehicle image and the CTA link', async () => {
    const html = await renderEmailTemplate(buildOfferEmail(input()));
    expect(html).toContain('https://cdn.example.com/silverado.png');
    expect(html).toContain('https://youngchev.com');
    expect(html).toContain('View inventory');
  });

  it('renders every offer in a multi-offer email', async () => {
    const html = await renderEmailTemplate(
      buildOfferEmail(
        input({
          vehicles: [
            vehicle({ name: 'Silverado', disclaimer: 'Silverado terms.' }),
            vehicle({ name: 'Equinox', disclaimer: 'Equinox terms.' }),
          ],
        }),
      ),
    );
    expect(html).toContain('Silverado terms.');
    expect(html).toContain('Equinox terms.');
  });

  it('produces a plain-text alternative carrying the disclaimer', async () => {
    const txt = await renderEmailTemplate(buildOfferEmail(input()), { plainText: true });
    expect(txt).toContain('Plus tax, title, license.');
  });
});

describe('resolveLogoBlocks', () => {
  const logo = (src: string) => ({ id: 'l', type: 'logo' as const, props: { src, width: 180 } });

  it('fills an empty logo src with the account logo', () => {
    const out = resolveLogoBlocks([logo('')], 'https://cdn.example/dealer.png');
    expect(out).toHaveLength(1);
    expect(out[0].props.src).toBe('https://cdn.example/dealer.png');
  });

  it('drops an empty logo when the account has none', () => {
    // src="" resolves to the page URL and paints a broken-image icon as the
    // first thing in the email. Dropping the block is the only safe read.
    expect(resolveLogoBlocks([logo('')], null)).toHaveLength(0);
  });

  it('leaves a logo that already names an image alone', () => {
    const out = resolveLogoBlocks([logo('https://cdn.example/fixed.png')], 'https://cdn.example/other.png');
    expect(out[0].props.src).toBe('https://cdn.example/fixed.png');
  });

  it('reaches logos nested inside a section', () => {
    const nested = [{ id: 's', type: 'section' as const, props: {}, children: [logo('')] }];
    const out = resolveLogoBlocks(nested, 'https://cdn.example/dealer.png');
    expect(out[0].children?.[0].props.src).toBe('https://cdn.example/dealer.png');
  });
});

describe('dedupeProse', () => {
  // The real Honda lease shape: offerDetails opens with description verbatim.
  const DESC = '$289.00 Lease Per MO. For 36 MOS. $4,899.00 Due at lease signing.';
  const DETAILS = `${DESC} Includes down payment, no security deposit required; excludes tax, title, license and dealer fees.`;

  it('drops a fragment another kept string already contains', () => {
    expect(dedupeProse([DESC, DETAILS])).toEqual([DETAILS]);
  });

  it('keeps the caller order when both survive', () => {
    expect(dedupeProse(['Alpha terms.', 'Beta terms.'])).toEqual(['Alpha terms.', 'Beta terms.']);
  });

  it('drops prose the disclaimer already carries', () => {
    // `eligibility` is routinely the resolved disclaimer, which would otherwise
    // print the legal text twice — once as prose, once in the legal strip.
    const legal = 'Closed-end lease. See dealer for details.';
    expect(dedupeProse(['Something else.', legal], legal)).toEqual(['Something else.']);
  });

  it('ignores whitespace and case when comparing', () => {
    expect(dedupeProse(['One   two THREE', 'one two three extra'])).toEqual(['one two three extra']);
  });

  it('drops empty and missing entries', () => {
    expect(dedupeProse([null, undefined, '  ', 'Real.'])).toEqual(['Real.']);
  });

  it('keeps genuinely different prose', () => {
    expect(dedupeProse(['Lease terms.', 'Eligibility rules.'])).toHaveLength(2);
  });
});

describe('isOffersSlot', () => {
  it('matches the offers BLOCK a designer drags from the palette', () => {
    expect(isOffersSlot({ id: 'o', type: 'offers', props: {} })).toBe(true);
  });

  it('still matches the legacy {{offers}} text marker', () => {
    // A live playbook points at a shell authored this way. Dropping support
    // would break it silently — the run would refuse and send nothing.
    expect(isOffersSlot({ id: 't', type: 'text', props: { text: '{{offers}}' } })).toBe(true);
    expect(isOffersSlot({ id: 't', type: 'text', props: { text: '  {{offers}}  ' } })).toBe(true);
  });

  it('ignores ordinary copy', () => {
    expect(isOffersSlot({ id: 't', type: 'text', props: { text: 'See our offers' } })).toBe(false);
    expect(isOffersSlot({ id: 'h', type: 'heading', props: { text: 'Offers' } })).toBe(false);
  });
});

describe('spliceOffers with the offers block', () => {
  it('replaces an offers block the same way it replaces the marker', () => {
    const shell = {
      version: '2' as const,
      title: 'Shell',
      settings: { bodyBg: '#fff', contentBg: '#fff', contentWidth: 600, fontFamily: 'Arial', textColor: '#000' },
      blocks: [
        { id: 'top', type: 'heading' as const, props: { text: 'Top' } },
        { id: 'slot', type: 'offers' as const, props: {} },
        { id: 'bot', type: 'heading' as const, props: { text: 'Bottom' } },
      ],
    };
    const out = spliceOffers(shell, offerBlocks(input()));
    expect(out).not.toBeNull();
    const types = out!.blocks.map((b) => b.type);
    expect(types[0]).toBe('heading');
    expect(types[types.length - 1]).toBe('heading');
    expect(types).not.toContain('offers');
    expect(textContents(out!.blocks)).toContain('2026 Chevrolet Silverado 1500');
  });

  it('reports a shell with an offers block as usable', () => {
    const content = JSON.stringify({
      version: '2',
      settings: {},
      blocks: [{ id: 'slot', type: 'offers', props: {} }],
    });
    expect(templateHasOffersMarker(content)).toBe(true);
  });
});

describe('spliceOffers with more than one slot', () => {
  const shell = (blocks: Block[]) => ({
    version: '2' as const,
    title: 'Shell',
    settings: { bodyBg: '#fff', contentBg: '#fff', contentWidth: 600, fontFamily: 'Arial', textColor: '#000' },
    blocks,
  });

  it('fills the first slot and drops the rest', () => {
    // Exactly what a shell looks like after a designer drags the new block into
    // one still carrying the legacy `{{offers}}` text. Leaving the second in
    // place ships a placeholder to the recipient.
    const out = spliceOffers(
      shell([
        { id: 'a', type: 'text', props: { text: '{{offers}}' } },
        { id: 'b', type: 'offers', props: {} },
        { id: 'c', type: 'heading', props: { text: 'Footer' } },
      ]),
      offerBlocks(input()),
    );
    expect(out).not.toBeNull();
    const types = out!.blocks.map((b) => b.type);
    expect(types).not.toContain('offers');
    expect(out!.blocks.some((b) => b.props?.text === '{{offers}}')).toBe(false);
    expect(types[types.length - 1]).toBe('heading');
  });

  it('emits the offers exactly once', () => {
    const out = spliceOffers(
      shell([
        { id: 'a', type: 'offers', props: {} },
        { id: 'b', type: 'offers', props: {} },
      ]),
      offerBlocks(input()),
    );
    const names = textContents(out!.blocks).filter((t) => t === '2026 Chevrolet Silverado 1500');
    expect(names).toHaveLength(1);
  });
});

describe("spliceOffers with a designer's card", () => {
  const shell = (blocks: Block[]) => ({
    version: '2' as const,
    title: 'Shell',
    settings: { bodyBg: '#fff', contentBg: '#fff', contentWidth: 600, fontFamily: 'Arial', textColor: '#000' },
    blocks,
  });

  /** What "save as custom block, repeat per offer" leaves in the template. */
  const authored: Block = {
    id: 'card',
    type: 'section',
    props: { repeatOver: 'offer', bgColor: '#101010' },
    children: [
      { id: 'n', type: 'heading', props: { text: '{{offer.name}}' } },
      { id: 'f', type: 'text', props: { text: '{{offer.main}}' } },
      { id: 'own', type: 'text', props: { text: 'Designer line' } },
    ],
  };

  it("uses the designer's card instead of the built-in section", () => {
    const three = [
      vehicle({ name: 'CR-V' }),
      vehicle({ name: 'Pilot' }),
      vehicle({ name: 'Ridgeline' }),
    ];
    const out = spliceOffers(shell([authored]), offerBlocks(input({ vehicles: three })), {
      vehicles: three,
      trailing: [],
    });
    expect(out).not.toBeNull();

    // One copy of the AUTHORED card per offer…
    const cards = out!.blocks.filter((b) => b.props?.bgColor === '#101010');
    expect(cards).toHaveLength(3);
    // …carrying the designer's own copy, which the code-built card has no idea
    // about — proof the layout came from them and not from `offerSection`.
    expect(textContents(out!.blocks).filter((t) => t === 'Designer line')).toHaveLength(3);
    expect(textContents(out!.blocks)).toContain('Ridgeline');
  });

  it('appends the CTA after the repeated cards', () => {
    const out = spliceOffers(shell([authored]), [], {
      vehicles: [vehicle()],
      trailing: [{ id: 'cta', type: 'button', props: { text: 'View inventory' } }],
    });
    const types = out!.blocks.map((b) => b.type);
    expect(types[types.length - 1]).toBe('button');
  });

  it('still uses the built-in section when the shell has no authored card', () => {
    const out = spliceOffers(
      shell([{ id: 'slot', type: 'offers', props: {} }]),
      offerBlocks(input()),
      { vehicles: [vehicle()], trailing: [] },
    );
    expect(textContents(out!.blocks)).toContain('2026 Chevrolet Silverado 1500');
    expect(out!.blocks.some((b) => b.props?.bgColor === '#101010')).toBe(false);
  });
});

describe('spliceOffers precedence', () => {
  const shell = (blocks: Block[]) => ({
    version: '2' as const,
    title: 'Shell',
    settings: { bodyBg: '#fff', contentBg: '#fff', contentWidth: 600, fontFamily: 'Arial', textColor: '#000' },
    blocks,
  });
  const authored: Block = {
    id: 'card',
    type: 'section',
    props: { repeatOver: 'offer', bgColor: '#101010' },
    children: [{ id: 'n', type: 'heading', props: { text: '{{offer.name}}' } }],
  };

  it("prefers the designer's card even when the built-in slot comes FIRST", () => {
    // Dragging the custom card into a shell that already had the built-in slot
    // is how a designer adopts it. First-wins would have silently kept the old
    // layout and dropped theirs.
    const out = spliceOffers(
      shell([{ id: 'slot', type: 'offers', props: {} }, authored]),
      offerBlocks(input()),
      { vehicles: [vehicle({ name: 'CR-V' })], trailing: [] },
    );
    expect(out!.blocks.some((b) => b.props?.bgColor === '#101010')).toBe(true);
    // The built-in section is not rendered alongside it.
    expect(textContents(out!.blocks)).not.toContain('2026 Chevrolet Silverado 1500');
    expect(textContents(out!.blocks)).toContain('CR-V');
  });

  it('drops the surplus built-in slot rather than leaving a placeholder', () => {
    const out = spliceOffers(
      shell([{ id: 'slot', type: 'offers', props: {} }, authored]),
      offerBlocks(input()),
      { vehicles: [vehicle()], trailing: [] },
    );
    expect(out!.blocks.some((b) => b.type === 'offers')).toBe(false);
  });
});
