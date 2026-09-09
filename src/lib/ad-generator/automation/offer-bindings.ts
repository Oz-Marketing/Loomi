import type { Block } from '@/lib/email/types';
import type { OfferEmailVehicle } from './offer-email-doc';

/**
 * Binding a designer's email block to one OEM offer.
 *
 * WHAT THIS REPLACES. `offerSection()` builds the offer card in code — fixed
 * type sizes, fixed order, fixed colours — so a designer could place the card
 * but never change it. This is the other half: a block a designer AUTHORED,
 * whose text and images name an offer field, filled in per offer at generation.
 *
 * WHY THE COUNT ISN'T THE DESIGNER'S PROBLEM. The card is authored ONCE. A
 * manufacturer publishes a different number of programs every month — three in
 * one, eleven in the next — so the run repeats the authored card per offer
 * rather than the designer laying out a fixed number of them.
 *
 * Pure: no prisma, no rendering. The same discipline as `offer-email-doc`, and
 * for the same reason — the layout has to be testable without a database.
 */

/**
 * Prop key an IMAGE block carries to say which offer picture it shows.
 *
 * Images bind whole — a picture is one value — which is why they get a "Shows"
 * dropdown. TEXT does not use this: text carries `{{offer.x}}` tokens inline, so
 * one line can mix copy and data the way the ad builder's does.
 */
export const BIND_PROP = 'bindTo';

/** `{{offer.field}}`, the token form text uses. */
const TOKEN_RE = /\{\{\s*(offer\.[a-zA-Z]+)\s*\}\}/g;

/** Prop key marking a block the run repeats, one copy per offer. */
export const REPEAT_PROP = 'repeatOver';

/**
 * The saved block a subtree came from, stamped on its root at insert.
 *
 * A custom block is COPIED into the template, so once inserted there is nothing
 * to distinguish "the OEM offer card" from any other section — the editor
 * labelled it "Section" like everything else. Carrying the name makes it
 * identifiable on the canvas without a lookup, and survives the template being
 * saved and reopened.
 */
export const CUSTOM_BLOCK_NAME_PROP = 'customBlockName';

/**
 * Prop key marking text that should wear the DEALER'S brand colour.
 *
 * A custom block is authored once and used by every rooftop, so a colour picked
 * in the editor is the same colour for all of them — and the built-in card it
 * replaces took each dealer's accent from `Account.branding`. Without this, one
 * agency-wide card would put Chevrolet blue on a Honda store's email, which is
 * the regression that moving the card out of code would otherwise introduce.
 */
export const BRAND_ACCENT_PROP = 'useBrandAccent';

/**
 * The offer fields a designer can bind to.
 *
 * Deliberately the SAME vocabulary the plate uses — `main` is the big figure and
 * `label` the small line above it, exactly as `assembleOffer` produces them —
 * so an email card and an ad plate built from one offer say the same thing.
 */
export const OFFER_BINDINGS = [
  { value: 'offer.name', label: 'Vehicle name', kind: 'text' },
  { value: 'offer.main', label: 'Offer figure (e.g. $289/mo)', kind: 'text' },
  { value: 'offer.label', label: 'Offer label (e.g. PER MONTH LEASE)', kind: 'text' },
  { value: 'offer.terms', label: 'Terms line', kind: 'text' },
  { value: 'offer.expiration', label: 'Expiration', kind: 'text' },
  { value: 'offer.programName', label: 'Program name', kind: 'text' },
  { value: 'offer.description', label: 'Manufacturer description', kind: 'text' },
  { value: 'offer.offerDetails', label: 'Manufacturer offer details', kind: 'text' },
  { value: 'offer.eligibility', label: 'Manufacturer eligibility', kind: 'text' },
  { value: 'offer.disclaimer', label: 'Disclaimer', kind: 'text' },
  { value: 'offer.image', label: 'Vehicle image (jellybean)', kind: 'image' },
] as const;

export type OfferBinding = (typeof OFFER_BINDINGS)[number]['value'];

const TEXT_VALUES: Record<string, (v: OfferEmailVehicle) => string | null> = {
  'offer.name': (v) => v.name,
  'offer.main': (v) => (v.offerMain ?? '').trim() || v.headline,
  'offer.label': (v) => (v.offerLabel ?? '').trim() || null,
  'offer.terms': (v) => (v.offerTerms ?? '').trim() || v.subhead || null,
  'offer.expiration': (v) => v.expiration,
  'offer.programName': (v) => v.programName,
  'offer.description': (v) => v.description,
  'offer.offerDetails': (v) => v.offerDetails,
  'offer.eligibility': (v) => v.eligibility,
  'offer.disclaimer': (v) => v.disclaimer,
};

/** Is this block bound to an offer field? */
export function bindingOf(block: Block): string | null {
  const raw = block.props?.[BIND_PROP];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** Does the run repeat this block once per offer? */
export function repeatsPerOffer(block: Block): boolean {
  return block.props?.[REPEAT_PROP] === 'offer';
}

/**
 * Fill one authored card for one offer.
 *
 * A bound block whose field is EMPTY for this offer is dropped, not left with
 * its design-time placeholder text. An offer with no expiration would otherwise
 * ship the words the designer typed while laying the card out — which reads as
 * real copy, because it is real copy, just not about this offer.
 */
export function bindBlock(
  block: Block,
  vehicle: OfferEmailVehicle,
  /** The account's brand colour, for blocks that opted into it. */
  accentColor?: string,
): Block | null {
  const bind = bindingOf(block);
  const accent = block.props?.[BRAND_ACCENT_PROP] && accentColor ? { color: accentColor } : {};

  if (bind === 'offer.image') {
    if (!vehicle.imageUrl) return null;
    return {
      ...block,
      props: { ...block.props, src: vehicle.imageUrl, alt: vehicle.name },
      ...(block.children ? { children: bindChildren(block.children, vehicle, accentColor) } : {}),
    };
  }

  const raw = typeof block.props?.text === 'string' ? block.props.text : '';
  if (raw && TOKEN_RE.test(raw)) {
    TOKEN_RE.lastIndex = 0;
    const filled = fillTokens(raw, vehicle);
    // Null means a token in this line had no value for this offer. The whole
    // block goes rather than the sentence around the hole — "Offer ends " with
    // nothing after it is worse than no line at all.
    if (filled === null) return null;
    return {
      ...block,
      props: { ...block.props, text: filled, ...accent },
      ...(block.children ? { children: bindChildren(block.children, vehicle, accentColor) } : {}),
    };
  }

  // Unbound: kept exactly as authored — the designer's own headings, spacers,
  // dividers and styling are the point of letting them build the card.
  const withAccent = Object.keys(accent).length ? { ...block, props: { ...block.props, ...accent } } : block;
  return withAccent.children
    ? { ...withAccent, children: bindChildren(withAccent.children, vehicle, accentColor) }
    : withAccent;
}

/**
 * Substitute every `{{offer.x}}` in a line, or null if any resolves empty.
 *
 * All-or-nothing on purpose: a card is authored against a sample offer, so a
 * half-filled line ships the designer's scaffolding as if it were copy.
 */
export function fillTokens(text: string, vehicle: OfferEmailVehicle): string | null {
  let missing = false;
  const out = text.replace(TOKEN_RE, (_m, key: string) => {
    const get = TEXT_VALUES[key];
    const value = (get ? get(vehicle) : null)?.trim() ?? '';
    if (!value) missing = true;
    return value;
  });
  TOKEN_RE.lastIndex = 0;
  if (missing) return null;
  return out.trim() ? out : null;
}

function bindChildren(children: Block[], vehicle: OfferEmailVehicle, accentColor?: string): Block[] {
  return children
    .map((c) => bindBlock(c, vehicle, accentColor))
    .filter((c): c is Block => c !== null);
}

/**
 * The authored card, once per offer.
 *
 * `repeatOver` is stripped from the copies: it has done its job, and leaving it
 * on would make each rendered card look like another repeat slot to anything
 * that walks the document later.
 */
export function expandPerOffer(
  card: Block,
  vehicles: OfferEmailVehicle[],
  accentColor?: string,
): Block[] {
  const out: Block[] = [];
  for (const v of vehicles) {
    const bound = bindBlock(card, v, accentColor);
    if (!bound) continue;
    const props = { ...bound.props };
    delete props[REPEAT_PROP];
    out.push({ ...bound, props });
  }
  return out;
}
