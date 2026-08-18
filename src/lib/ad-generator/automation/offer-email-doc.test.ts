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
    expect(contents).toContain('Chevrolet Lease Program');
    expect(contents).toContain('Well-qualified lessees only.');
    expect(contents).toContain('Must take delivery by 09/30.');
    expect(contents).toContain('Not available with some other offers.');
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
    expect(textContents([section])).toContain('Chevrolet Lease Program');
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

  it('separates consecutive offers with a divider but does not lead with one', () => {
    const blocks = offerBlocks(
      input({ vehicles: [vehicle(), vehicle({ name: 'Equinox' }), vehicle({ name: 'Tahoe' })] }),
    );
    expect(blocks[0].type).not.toBe('divider');
    expect(blocks.filter((b) => b.type === 'divider')).toHaveLength(2);
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

  it('substitutes only the first marker', () => {
    const doc = shell([
      { id: 'm1', type: 'text', props: { text: OFFERS_PLACEHOLDER } },
      { id: 'm2', type: 'text', props: { text: OFFERS_PLACEHOLDER } },
    ]);
    const out = spliceOffers(doc, offerBlocks(input()));
    expect(textContents(out!.blocks).filter((c) => c === OFFERS_PLACEHOLDER)).toHaveLength(1);
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
    expect(html).toContain('Chevrolet Lease Program');
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
