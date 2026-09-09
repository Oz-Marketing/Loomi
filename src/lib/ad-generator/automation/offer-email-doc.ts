import type { Block, EmailTemplate } from '@/lib/email/types';
import { DEFAULT_SETTINGS } from '@/lib/email/types';
import { expandPerOffer, repeatsPerOffer } from './offer-bindings';

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
  /**
   * The PLATE's own three-part offer, from `assembleOffer` — the small uppercase
   * label ("PER MONTH LEASE"), the big figure ("$289/mo") and the supporting
   * terms line.
   *
   * Optional because callers written before the email was restyled pass only
   * `headline`/`subhead`, and those still render. Supplied, they make the email
   * and the ad agree BY CONSTRUCTION rather than by two formatters that happen
   * to round the same way today.
   */
  offerLabel?: string;
  offerMain?: string;
  offerTerms?: string;
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
/**
 * Drop prose the reader has already been shown.
 *
 * MarketCheck's four text fields overlap heavily, and the feed is not tidy about
 * it. A real Honda lease returns `description` = "$289.00 Lease Per MO. For 36
 * MOS. $4,899.00 Due at lease signing." and `offerDetails` = that same sentence
 * plus three more clauses — so rendering both prints the first sentence twice.
 * `eligibility` is then commonly the resolved disclaimer as well, which prints
 * the legal text a second time under the offer.
 *
 * Rule: keep a string only when no OTHER kept string already contains it, and
 * never keep one the disclaimer already carries. Comparison is on collapsed
 * whitespace and case, because the feed varies both.
 *
 * Deliberately containment rather than equality — the overlap here is a
 * superset relationship, not a duplicate, and equality would catch none of it.
 * Order matters: longest first, so the superset survives and the fragment goes.
 */
export function dedupeProse(parts: Array<string | null | undefined>, alreadyShown = ''): string[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const shown = norm(alreadyShown);
  const cleaned = parts
    .map((p) => (p ?? '').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  // Longest first so a superset is considered before the fragment it contains.
  const byLength = [...cleaned].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const part of byLength) {
    const n = norm(part);
    if (shown && shown.includes(n)) continue;
    if (kept.some((k) => norm(k).includes(n))) continue;
    kept.push(part);
  }
  // Restore the caller's order — the dedupe decides WHAT survives, not the
  // sequence the reader sees.
  return cleaned.filter((c) => kept.includes(c));
}

export function offerSection(v: OfferEmailVehicle, accentColor: string): Block {
  // Mirrors the plate, top to bottom: vehicle on white, the big figure in the
  // dealer's brand color under a small uppercase label, the terms line, then the
  // manufacturer's words, then the legal strip. The ad and the email are one
  // collection — a dealer should recognise the second from the first.
  const main = (v.offerMain ?? '').trim() || v.headline;
  const label = (v.offerLabel ?? '').trim();
  const terms = (v.offerTerms ?? '').trim() || v.subhead;

  const body: Block[] = [];

  // The vehicle sits on white with room around it. Optional on purpose:
  // `resolveJellybean` returns null wherever EVOX has no coverage, and an offer
  // with real numbers is still worth sending without a picture.
  if (v.imageUrl) {
    body.push({
      id: blockId('image'),
      type: 'image',
      props: { src: v.imageUrl, alt: v.name, width: 460, maxWidth: '100%', align: 'center' },
    });
  }

  body.push(
    text(v.name, {
      fontSize: 17,
      fontWeight: 700,
      align: 'center',
      color: '#111111',
      marginBottom: 2,
    }),
  );

  // Label ABOVE the figure, exactly as the plate stacks them — the eye lands on
  // the number and reads the qualifier without hunting.
  if (label) {
    body.push(
      text(label, {
        fontSize: 11,
        fontWeight: 700,
        align: 'center',
        color: '#777777',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 0,
      }),
    );
  }

  body.push(
    text(main, {
      fontSize: 44,
      fontWeight: 800,
      align: 'center',
      color: accentColor,
      lineHeight: 1.05,
      marginTop: 2,
      marginBottom: 2,
    }),
  );

  if (terms) {
    body.push(text(terms, { fontSize: 14, align: 'center', color: '#555555', marginTop: 0 }));
  }

  if (v.expiration) {
    body.push(
      text(v.expiration, {
        fontSize: 12,
        fontWeight: 700,
        align: 'center',
        color: '#111111',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginTop: 6,
      }),
    );
  }

  // The program NAME ("Featured Special Lease", "Special APR") is deliberately
  // not rendered. It is Honda's internal program labeling, not a required
  // disclosure — the legal strip below carries the program's actual terms in
  // full — and once the prose moved into that strip it became a bold heading
  // sitting above nothing, reading as a label for text that had left.

  // The manufacturer's prose is FINE PRINT, not body copy, so it goes in the
  // legal strip rather than under the headline.
  //
  // What it actually contains, from a real Honda APR program: a rate TIER TABLE
  // ("1.99% APR 24-36 MOS. or 2.99% APR 37-60 MOS. or …"), which advertises
  // terms this offer is not — the plate headlines one tier; a repetition of
  // "for well-qualified buyers" that `eligibility` already carries; and a
  // representative payment example ("$28.64/month per $1,000 financed"). Only
  // the last is load-bearing, and it is load-bearing enough that `preflight`
  // REQUIRES `costPerThousand` on every APR ad.
  //
  // So none of it is deleted — that would drop a required disclosure — but none
  // of it competes with the figure either. Deduped, because `description` is
  // routinely a verbatim prefix of `offerDetails`.
  const legalText = (v.disclaimer ?? '').trim();
  const fineProse = dedupeProse([v.description, v.offerDetails, v.eligibility], legalText);

  // Per-offer legal strip. Every program has its own terms, so a multi-offer
  // email carries one PER offer — never summarized, never dropped.
  const legalBlocks = [...fineProse, ...(legalText ? [legalText] : [])];
  if (legalBlocks.length > 0) {
    body.push({
      id: blockId('section'),
      type: 'section',
      props: {
        bgColor: '#f7f7f7',
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 16,
        paddingRight: 16,
        borderRadiusTopLeft: 6,
        borderRadiusTopRight: 6,
        borderRadiusBottomRight: 6,
        borderRadiusBottomLeft: 6,
      },
      children: legalBlocks.map((t) =>
        text(t, { fontSize: 10, color: '#777777', lineHeight: 1.5 }),
      ),
    });
  }

  // The card. A hairline border and a radius are what turn a run of stacked
  // text into a set of objects you can count at a glance, the way the grid of
  // plates reads.
  return {
    id: blockId('section'),
    type: 'section',
    props: {
      bgColor: '#ffffff',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: '#e2e2e2',
      borderRadiusTopLeft: 10,
      borderRadiusTopRight: 10,
      borderRadiusBottomRight: 10,
      borderRadiusBottomLeft: 10,
      paddingTop: 22,
      paddingBottom: 22,
      paddingLeft: 24,
      paddingRight: 24,
    },
    children: body,
  };
}

/** The offer blocks alone — what replaces `{{offers}}` in a shell template. */
export function offerBlocks(input: OfferEmailInput): Block[] {
  const blocks: Block[] = [];
  input.vehicles.forEach((v, i) => {
    // Space between cards, not a rule. Each offer is now a bordered card, and a
    // divider between two bordered boxes reads as a third line nobody drew.
    if (i > 0) blocks.push({ id: blockId('spacer'), type: 'spacer', props: { height: 16 } });
    blocks.push(offerSection(v, input.accentColor));
  });

  blocks.push(...ctaBlocks(input));

  return blocks;
}

/**
 * The button after the last offer.
 *
 * Split out so a DESIGNER-authored card gets one too: their card is the offer,
 * not the whole section, and expanding it per offer would otherwise lose the
 * single call to action that follows the list.
 */
export function ctaBlocks(input: OfferEmailInput): Block[] {
  const blocks: Block[] = [];
  if (input.ctaUrl) {
    blocks.push({ id: blockId('spacer'), type: 'spacer', props: { height: 20 } });
    blocks.push({
      id: blockId('button'),
      type: 'button',
      props: {
        text: input.ctaLabel,
        url: input.ctaUrl,
        bgColor: input.accentColor,
        textColor: '#ffffff',
        align: 'center',
        borderRadius: 8,
        paddingTop: 14,
        paddingBottom: 14,
        paddingLeft: 32,
        paddingRight: 32,
        fontSize: 15,
        fontWeight: 700,
      },
    });
  }

  return blocks;
}

/**
 * Resolve a shell's LOGO block against the account being sent to.
 *
 * A shell is shared across accounts, so it cannot hard-code a logo — but every
 * dealer's ads carry theirs, and an offer email that doesn't is visibly not part
 * of the same collection. The convention: author a `logo` block with an empty
 * `src` and this fills it from `OfferEmailInput.logoUrl`.
 *
 * A block left empty because the account has NO logo on file is dropped, not
 * rendered. An `<img>` with `src=""` resolves to the page URL and paints a
 * broken-image icon in most clients — the first thing in the email, on every
 * send.
 */
export function resolveLogoBlocks(blocks: Block[], logoUrl: string | null): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const isLogo = b.type === 'logo';
    const src = typeof b.props?.src === 'string' ? b.props.src.trim() : '';
    if (isLogo && !src) {
      if (!logoUrl) continue; // nothing to show — drop it rather than break it
      out.push({ ...b, props: { ...b.props, src: logoUrl } });
      continue;
    }
    out.push(b.children ? { ...b, children: resolveLogoBlocks(b.children, logoUrl) } : b);
  }
  return out;
}

/**
 * Is this block the slot a run fills with the month's offers?
 *
 * TWO FORMS, on purpose. The `offers` BLOCK is what a designer drags out of the
 * email palette — visible on the canvas, impossible to typo. The `{{offers}}`
 * text marker is what shells were authored with before that block existed, and
 * a live playbook still points at one, so it keeps working. New shells should
 * use the block; nothing needs migrating.
 */
export function isOffersSlot(b: Block): boolean {
  // A block a designer authored and marked "repeat for each offer". This is the
  // one the run should prefer — it is their layout, not the built-in card.
  if (repeatsPerOffer(b)) return true;
  if (b.type === 'offers') return true;
  // `text` is the prop every copy block uses (see TextProps/HeadingProps), so a
  // marker authored in the visual builder lands there.
  const content = typeof b.props?.text === 'string' ? b.props.text.trim() : '';
  return content === OFFERS_PLACEHOLDER;
}

/**
 * Splice the offer blocks into a shell template at its `{{offers}}` marker.
 *
 * Returns null when the shell has no marker — a caller must treat that as a
 * configuration error rather than silently sending the shell with no offers in
 * it, which would be an empty email nobody notices until a client does.
 */
/** Does this document hold a card a designer marked "repeat for each offer"? */
function hasAuthoredCard(list: Block[]): boolean {
  return list.some((b) => repeatsPerOffer(b) || (b.children ? hasAuthoredCard(b.children) : false));
}

export function spliceOffers(
  shell: EmailTemplate,
  blocks: Block[],
  /** Supplied when the shell may hold a designer-authored card to expand. */
  opts: { vehicles?: OfferEmailVehicle[]; trailing?: Block[]; accentColor?: string } = {},
): EmailTemplate | null {
  const vehicles = opts.vehicles ?? [];
  const trailing = opts.trailing ?? [];
  let found = false;

  // A DESIGNER'S card wins over the built-in slot wherever each sits in the
  // document — not whichever comes first. Dragging the custom card into a shell
  // that already had the built-in slot is the obvious way to adopt it, and
  // first-wins would have silently kept rendering the old one. When an authored
  // card is present the built-in slot is treated as a surplus slot and dropped.
  const preferAuthored = hasAuthoredCard(shell.blocks);

  function walk(list: Block[]): Block[] {
    const out: Block[] = [];
    for (const b of list) {
      if (isOffersSlot(b)) {
        // With an authored card in the document, the built-in slot is surplus.
        if (preferAuthored && !repeatsPerOffer(b)) continue;
        // A DESIGNER'S card wins over the built-in one. `blocks` is what
        // `offerBlocks()` built in code; when the slot is an authored card
        // marked to repeat, that card is expanded per offer instead and the
        // code-built section is never used. This is what makes the layout
        // theirs rather than ours.
        if (!found && repeatsPerOffer(b)) {
          found = true;
          out.push(...expandPerOffer(b, vehicles, opts.accentColor));
          out.push(...trailing);
          continue;
        }
        // The FIRST slot takes the offers. Any further slot is DROPPED, not
        // left in place: the offers have already been emitted once, and a
        // second slot has nothing to put in itself — it would ship the dashed
        // "offers appear here" placeholder, or a literal `{{offers}}`, to the
        // recipient. Two slots is easy to end up with, because a shell authored
        // against the old text marker still carries it after a designer drags
        // in the new block.
        if (!found) {
          found = true;
          out.push(...blocks);
        }
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
    list.some((b) => isOffersSlot(b) || (b.children ? walk(b.children) : false));
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
