import type { Block, EmailTemplate } from '@/lib/email/types';
import { DEFAULT_SETTINGS } from '@/lib/email/types';

/**
 * The companion offer email — pure document construction.
 *
 * Turns the offers a generate run produced into a v2 `EmailTemplate`, which the
 * caller renders to HTML and persists as a DRAFT `EmailBlast`. No prisma, no
 * network, no rendering: everything here is a pure function of its input, so the
 * layout is testable without a database and without EVOX.
 *
 * Two rules govern the content, and both come from the same place — the numbers
 * and the words a dealer advertises are legally the manufacturer's, not ours:
 *
 *   1. **OEM verbiage is passed through verbatim.** `programName`,
 *      `description`, `offerDetails` and `eligibility` come straight from the
 *      MarketCheck payload. Nothing here rewords them.
 *   2. **The disclaimer is reproduced exactly** as `resolveDisclaimerText`
 *      resolved it for the ad. The email and the ad it accompanies must carry
 *      the same legal text, because they advertise the same programme.
 *
 * See docs/ad-generator-campaign-launch.md ("The direction beyond this").
 */

/** Marker block content in a shell template, replaced by the offer section. */
export const OFFERS_PLACEHOLDER = '{{offers}}';

export interface OfferEmailVehicle {
  /** "2026 Chevrolet Silverado 1500" — the ad's `vehicleName`. */
  name: string;
  /** EVOX jellybean (or inventory photo) — the ad's `vehicleImageUrl`. */
  imageUrl: string | null;
  /** lease | apr | cash | discount | sales_price | custom */
  offerType: string;
  /** Human offer line, e.g. "$299/mo · 36 mo". Already formatted by the caller. */
  headline: string;
  /** Secondary line, e.g. "$2,999 due at signing". Empty when there's nothing. */
  subhead: string;
  /** Manufacturer programme name, verbatim from the feed. */
  programName: string | null;
  /** Manufacturer prose, verbatim from the feed. */
  description: string | null;
  /** Manufacturer offer detail prose, verbatim from the feed. */
  offerDetails: string | null;
  /** Manufacturer eligibility prose, verbatim from the feed. */
  eligibility: string | null;
  /** Fully resolved disclaimer for THIS offer — reproduced exactly. */
  disclaimer: string;
  /** "Offer ends March 31", when the offer carries an end date. */
  expiration: string | null;
}

export interface OfferEmailInput {
  dealerName: string;
  /** Brand primary colour (hex) for headings + buttons. */
  accentColor: string;
  /** Dealer logo for the header, when one resolves. */
  logoUrl: string | null;
  /** Where every CTA points. */
  ctaUrl: string | null;
  ctaLabel: string;
  vehicles: OfferEmailVehicle[];
}

let seq = 0;
/** Block ids only need to be unique within one document, and the document is
 *  built in a single pass — so a counter beats randomness, which would make the
 *  output non-deterministic and untestable. */
function blockId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Reset the id counter so a test can assert on exact ids. */
export function resetBlockIds(): void {
  seq = 0;
}

// Prop names below are the components' own (src/lib/email/components) — `text`,
// `url`, `bgColor`, not the html-ish names. A wrong key renders a silently empty
// block rather than failing, so these must match the interfaces exactly.
function text(body: string, props: Record<string, unknown> = {}): Block {
  return {
    id: blockId('text'),
    type: 'text',
    props: { text: body, fontSize: 15, lineHeight: 1.6, align: 'left', ...props },
  };
}

function heading(body: string, props: Record<string, unknown> = {}): Block {
  return {
    id: blockId('heading'),
    type: 'heading',
    props: { text: body, level: 2, fontSize: 22, align: 'left', ...props },
  };
}

/**
 * One offer, as a section.
 *
 * The vehicle image is optional on purpose. `resolveJellybean` returns null
 * whenever EVOX is unconfigured or the model has no per-model coverage (Accord
 * and Civic 404 today), and an offer with real numbers is still worth sending
 * without a picture — so a missing image drops the image block rather than the
 * offer.
 */
export function offerSection(v: OfferEmailVehicle, accentColor: string): Block {
  const children: Block[] = [];

  if (v.imageUrl) {
    children.push({
      id: blockId('image'),
      type: 'image',
      props: { src: v.imageUrl, alt: v.name, width: 520, maxWidth: '100%', align: 'center' },
    });
  }

  children.push(heading(v.name, { level: 2, fontSize: 20, color: accentColor }));
  children.push(
    text(v.headline, { fontSize: 26, fontWeight: 700, color: accentColor, lineHeight: 1.2 }),
  );
  if (v.subhead) children.push(text(v.subhead, { fontSize: 15, color: '#444444' }));

  // Manufacturer's own words, verbatim. The programme name is the heading a
  // dealer recognises; the prose underneath is what the OEM published.
  if (v.programName) children.push(text(v.programName, { fontSize: 14, fontWeight: 700 }));
  for (const prose of [v.description, v.offerDetails, v.eligibility]) {
    const s = (prose ?? '').trim();
    if (s) children.push(text(s, { fontSize: 14, color: '#333333' }));
  }

  if (v.expiration) {
    children.push(text(v.expiration, { fontSize: 14, fontWeight: 700, color: '#333333' }));
  }

  // Per-offer disclaimer, verbatim. Small, but never omitted and never
  // summarized — a multi-offer email carries one disclaimer PER offer because
  // each programme has its own terms.
  children.push(
    text(v.disclaimer, { fontSize: 11, color: '#777777', lineHeight: 1.45 }),
  );

  return {
    id: blockId('section'),
    type: 'section',
    props: { paddingTop: 24, paddingBottom: 24, bgColor: '#ffffff' },
    children,
  };
}

/** The offer blocks alone — what replaces `{{offers}}` in a shell template. */
export function offerBlocks(input: OfferEmailInput): Block[] {
  const blocks: Block[] = [];
  input.vehicles.forEach((v, i) => {
    if (i > 0) {
      blocks.push({
        id: blockId('divider'),
        type: 'divider',
        props: { color: '#e5e5e5', thickness: 1 },
      });
    }
    blocks.push(offerSection(v, input.accentColor));
  });

  if (input.ctaUrl) {
    blocks.push({
      id: blockId('button'),
      type: 'button',
      props: {
        text: input.ctaLabel,
        url: input.ctaUrl,
        bgColor: input.accentColor,
        textColor: '#ffffff',
        align: 'center',
        borderRadius: 6,
      },
    });
  }

  return blocks;
}

/**
 * Splice the offer blocks into a shell template at its `{{offers}}` marker.
 *
 * Returns null when the shell has no marker — a caller must treat that as a
 * configuration error rather than silently sending the shell with no offers in
 * it, which would be an empty email nobody notices until a client does.
 */
export function spliceOffers(shell: EmailTemplate, blocks: Block[]): EmailTemplate | null {
  let found = false;

  function walk(list: Block[]): Block[] {
    const out: Block[] = [];
    for (const b of list) {
      // `text` is the prop every copy block uses (see TextProps/HeadingProps),
      // so a marker authored in the visual builder lands there.
      const content = typeof b.props?.text === 'string' ? b.props.text.trim() : '';
      if (!found && content === OFFERS_PLACEHOLDER) {
        found = true;
        out.push(...blocks);
        continue;
      }
      out.push(b.children ? { ...b, children: walk(b.children) } : b);
    }
    return out;
  }

  const spliced = walk(shell.blocks);
  return found ? { ...shell, blocks: spliced } : null;
}

/**
 * Does a stored `Template.content` carry the `{{offers}}` marker?
 *
 * Shared by the settings dropdown and the playbooks audit so "usable as a
 * shell" has exactly one definition — two drifting copies would let the audit
 * bless a template the generator then refuses.
 */
export function templateHasOffersMarker(content: string): boolean {
  let doc: EmailTemplate | null = null;
  try {
    doc = JSON.parse(content) as EmailTemplate;
  } catch {
    return false;
  }
  const walk = (list: Block[]): boolean =>
    list.some((b) => {
      const t = typeof b.props?.text === 'string' ? b.props.text.trim() : '';
      return t === OFFERS_PLACEHOLDER || (b.children ? walk(b.children) : false);
    });
  return Array.isArray(doc?.blocks) ? walk(doc.blocks) : false;
}

/** A complete standalone email, for accounts with no shell template configured. */
export function buildOfferEmail(input: OfferEmailInput): EmailTemplate {
  const blocks: Block[] = [];

  if (input.logoUrl) {
    blocks.push({
      id: blockId('logo'),
      type: 'logo',
      props: { src: input.logoUrl, alt: input.dealerName, width: 180, align: 'center' as const },
    });
  }

  blocks.push(
    heading('Current offers', { level: 1, fontSize: 28, align: 'center', color: input.accentColor }),
  );
  blocks.push(...offerBlocks(input));

  return {
    version: '2',
    title: `${input.dealerName} — current offers`,
    settings: { ...DEFAULT_SETTINGS },
    blocks,
  };
}
