import type { AdData, FieldSpec } from './types';
import type { OfferTypeSpec } from './offer-types';
import { CUSTOM_OFFER_TYPE_SPECS, VEHICLE_OFFER_TYPE_SPECS } from './offer-types';
import type { TemplateDoc } from './doc-types';
import { templateUsage } from './doc-types';
import { vehicleOffer } from './templates/vehicle-offer';
import { customOfferFields, customOfferDefaults } from './templates/custom-offer';
import {
  CUSTOM_DISCLAIMER_SLUGS,
  SHARED_DISCLAIMER_SLUGS,
  VEHICLE_DISCLAIMER_SLUGS,
} from './disclaimer-slugs';

/**
 * Offer KINDS — the registry of field schemas an ad can be built against.
 *
 * WHAT THIS REPLACES. There used to be exactly one schema:
 *
 *     export const SYSTEM_FIELDS: FieldSpec[] = vehicleOffer.fields;
 *
 * `blankTemplateDoc` stamped it into every doc at creation and the builder's
 * binding picker read it directly, so every template — including one started
 * "From scratch" with the offer kit switched off — carried all ~50 vehicle-offer
 * fields. That is the whole reason the generator only makes vehicle ads.
 *
 * The fix is NOT to reopen designer field authoring. The original reasoning
 * holds: a designer-invented key is inert in the offer engine, in OEM
 * compliance and in the disclaimer token engine. The fix is to stop having
 * exactly ONE schema. A kind bundles the four things that have to agree with
 * each other — the fields, the offer types, the disclaimer slugs, and which
 * automotive machinery applies — so they can't drift apart per template.
 *
 * Kinds are CODE-OWNED; templates are designer-owned. Each kind carries offer
 * math and capability flags that need code anyway, so an in-app kind builder
 * would only let someone create a half-configured kind whose offer block
 * silently renders nothing. See docs/ad-generator-offer-kinds.md §6, §10.
 *
 * TWO kinds, and that is the whole taxonomy: `vehicle` and `custom`.
 *
 * It was briefly heading for four (`vehicle`, `service`, `parts`, `general`).
 * Building the second and third showed the split was wrong — parts shares 100%
 * of service's offer math, and a hiring ad is a service offer with no offer. What
 * genuinely varied between them was the OFFER TYPE and which restrictions apply,
 * both already per-ad choices INSIDE a kind. So `service`, `parts` and `general`
 * collapsed into `custom`. See docs/ad-generator-offer-kinds.md §7.
 *
 * A kind is a heavy thing: its own schema, its own offer math, its own slug map,
 * its own capability row, and a choice the user must make before they can start.
 * Add one only when those genuinely differ — for `vehicle` they do (a VIN, a
 * make, an EVOX jellybean, unattended generation from a feed), and that is the
 * bar.
 */

/**
 * Machinery a kind opts into.
 *
 * DELIBERATELY MINIMAL. Only flags that are actually ENFORCED live here. An
 * unenforced capability is worse than no capability at all — whoever adds the
 * `service` kind would set it, see it in the type, and reasonably assume it took
 * effect. Add a flag in the same change that reads it, never ahead of it.
 */
export interface OfferKindCapabilities {
  /**
   * The year/make/model picker, the `_veh*` stash it writes, and the EVOX paint
   * swatches + jellybean lookup that hang off it.
   *
   * Narrowly the PICKER. It used to also stand for "manufacturer rules apply",
   * which conflated two different things — see `manufacturerRules`.
   */
  vehiclePicker: boolean;
  /**
   * Manufacturer rules apply: the make-specific disclaimer template, the OEM
   * required-field rule, and every co-op pack lookup.
   *
   * SEPARATE from `vehiclePicker` because a service offer has a make but no
   * VEHICLE. Manufacturer service co-op is real money with real prohibited
   * language and is keyed by brand, so fixed-ops advertising needs the checking
   * without the year/model/trim picker. The make falls back to the account's OEM,
   * which is what the creative page already does when no vehicle is chosen.
   *
   * Collapsing the two would force a choice between a service ad that asks for a
   * VIN and a service ad with no manufacturer checking at all.
   */
  manufacturerRules: boolean;
  /**
   * Supports a SECOND parallel offer (the `o2_*` question set).
   *
   * Gated per kind rather than on "has offer types" because the only thing that
   * can build one is `addFieldKit`, which merges the VEHICLE dual offer's fields.
   * A `service` kind will have offer types too, and without this flag its "Two
   * offers" button would inject the vehicle schema into a service template.
   */
  dualOffer: boolean;
  /**
   * Eligible for UNATTENDED generation.
   *
   * Automation's last resort is a brand fallback: any published template whose
   * `make` matches the vehicle. `usage` was added to stop a human-built plate
   * being picked for an automated OEM ad — this stops a template of the wrong
   * KIND being picked the same way. Without it a service template becomes a
   * candidate for a Mazda lease ad the moment a second kind exists.
   */
  automation: boolean;
}

export interface OfferKind {
  /** Stored in `TemplateDoc.offerKind`. Stable — it is persisted in doc JSON. */
  id: string;
  /** Picker label. */
  label: string;
  /** One line, shown where a designer chooses the kind. */
  description: string;
  /**
   * Label + description for when this kind is the ONLY one on offer.
   *
   * Kind copy is written for the PICKER, where each line's job is to tell this
   * kind apart from the others — so `custom` is named for what it is not (a
   * vehicle offer) and its examples are the fixed-ops ones a dealer would look
   * for. Neither reads right for an account that never sees the vehicle kind:
   * a marketing agency has no "custom offer" to distinguish from anything, and
   * naming parts and service tells them the tool is not for them.
   *
   * Only kinds that can be an account's sole choice need this — see
   * `offerKindsForIndustry`. Omitted ⇒ `label` / `description` are used.
   */
  soleChoiceCopy?: { label: string; description: string };
  /**
   * Compact name for the badge on an ad / template card — "Vehicle", not
   * "Vehicle offer". Rendered uppercase at 9px, so it has to survive being read
   * at a glance in a grid.
   *
   * A separate field rather than trimming `label`: stripping " offer" / " ad"
   * works today and breaks on the first kind that isn't named that way.
   */
  shortLabel: string;
  /**
   * Which of the card badge's colour tokens this kind uses. The tokens
   * themselves live with the component that draws them — a kind shouldn't carry
   * Tailwind classes — but the CHOICE is per kind, so adding a kind needs no
   * edit to the card. Reuse of a tone across kinds is allowed and just means
   * they share a colour.
   */
  tone: 'blue' | 'amber' | 'violet';
  /** The field schema. Was `SYSTEM_FIELDS`. */
  fields: FieldSpec[];
  /** Starter / preview values for those fields. */
  defaults: AdData;
  /** The offer types this kind offers, and how each assembles its block. */
  offerTypes: OfferTypeSpec[];
  /** Disclaimer `{slug}` tokens this kind's templates may use. */
  slugs: Record<string, string>;
  /**
   * A sentence appended to every composed disclaimer for this kind, unless the
   * body already speaks to it. Empty string = append nothing.
   *
   * Per KIND because the vehicle sentence is a claim about an advertised vehicle
   * price. Appending it to a service coupon would state something untrue about
   * the offer, and appending it to a general ad states something about a price
   * the ad does not have.
   */
  dealerFeeBoilerplate: string;
  capabilities: OfferKindCapabilities;
}

/**
 * The vehicle offer kind — everything the generator could make before kinds
 * existed.
 *
 * Its fields come from `vehicleOffer.fields` rather than a copy, so there is one
 * definition and it cannot drift from the code template that renders it.
 */
const vehicleKind: OfferKind = {
  id: 'vehicle',
  label: 'Vehicle offer',
  shortLabel: 'Vehicle',
  tone: 'blue',
  description: 'A vehicle with a lease, APR, discount or sale price — the offer the manufacturer programs run on.',
  fields: vehicleOffer.fields,
  defaults: {
    ...vehicleOffer.defaults,
    // The offer NUMBERS override the code template's own starter values with
    // obvious placeholders — NOT fake-real values like "299" — so a fresh canvas
    // never looks like a configured offer; the real numbers come from the client
    // at generation. They are non-numeric, so the offer engine passes them
    // straight through, and preflight derives its placeholder-leak guard from
    // exactly these entries.
    monthlyPayment: 'XXX',
    leaseTerm: 'XX',
    dueAtSigning: 'X,XXX',
    securityDeposit: 'XXX',
    aprRate: 'X.X',
    aprTerm: 'XX',
    costPerThousand: 'XX.XX',
    discountAmount: 'X,XXX',
    salePrice: 'XX,XXX',
    msrp: 'XX,XXX',
    price: '$X,XXX/mo',
    terms: '',
  },
  offerTypes: VEHICLE_OFFER_TYPE_SPECS,
  slugs: { ...SHARED_DISCLAIMER_SLUGS, ...VEHICLE_DISCLAIMER_SLUGS },
  // The sentence the vehicle-offer disclaimers have always carried.
  dealerFeeBoilerplate:
    'Advertised price includes all dealer-imposed fees. Excludes tax, title, and registration.',
  capabilities: { vehiclePicker: true, manufacturerRules: true, dualOffer: true, automation: true },
};

/**
 * The CUSTOM offer kind — everything that is not a vehicle offer: service,
 * parts and accessories, hiring, events, sell-us-your-car, sponsorships.
 *
 * The capability row, and why each value is what it is:
 *
 *   vehiclePicker      false — no year/model/trim. Turning it off is what stops
 *                      a Now Hiring ad being asked for a VIN.
 *   manufacturerRules  TRUE  — there is no vehicle but there IS a make, and
 *                      manufacturer service/parts co-op is keyed by brand. This
 *                      pair is the whole reason those two flags are separate.
 *                      A message-only ad carries no claim, so the creative page
 *                      additionally suppresses the checks for `no_offer` — that
 *                      is a per-AD fact, not a per-kind one.
 *   dualOffer          false — the `o2_*` kit is the vehicle dual offer's.
 *   automation         false — no feed publishes fixed-ops coupons or job ads.
 *
 * `dealerFeeBoilerplate` is empty on purpose: the vehicle sentence ("Advertised
 * price includes all dealer-imposed fees") is a statement about a vehicle price
 * and is simply wrong on an oil-change coupon or a hiring ad. The correct
 * fixed-ops sentence is legal text, so it is not invented here — it arrives as
 * template bodies from the Co-op team. See docs/ad-generator-offer-kinds.md §9.
 */
const customKind: OfferKind = {
  id: 'custom',
  label: 'Custom offer',
  shortLabel: 'Custom',
  tone: 'amber',
  description: 'Service, parts, hiring, events — a price, a percentage, dollars off, or no offer at all.',
  // What a non-vehicle account sees: this is simply "an ad" to them, and the
  // fixed-ops examples belong to the dealership reading of the same kind.
  soleChoiceCopy: {
    label: 'Ad',
    description: 'A headline, an image, and an optional offer — a price, a percentage, dollars off, or no offer at all.',
  },
  fields: customOfferFields,
  defaults: customOfferDefaults,
  offerTypes: CUSTOM_OFFER_TYPE_SPECS,
  slugs: { ...SHARED_DISCLAIMER_SLUGS, ...CUSTOM_DISCLAIMER_SLUGS },
  dealerFeeBoilerplate: '',
  capabilities: { vehiclePicker: false, manufacturerRules: true, dualOffer: false, automation: false },
};

/** Every registered kind, in picker order. */
export const OFFER_KINDS: OfferKind[] = [vehicleKind, customKind];

/**
 * The kind that owns an offer type VALUE, or undefined for an unknown one.
 *
 * Sound only because offer type values are globally unique (asserted in
 * `offer-kinds.test.ts`). This is how `composeDisclaimer` finds a kind's
 * boilerplate from `AdData` alone — the disclaimer engine, like `assembleOffer`,
 * only ever receives the data.
 */
export function kindForOfferType(value: string): OfferKind | undefined {
  const wanted = (value ?? '').trim();
  if (!wanted) return undefined;
  return OFFER_KINDS.find((k) => k.offerTypes.some((t) => t.value === wanted));
}

/**
 * Resolve a kind id to its kind.
 *
 * An UNKNOWN id resolves to `vehicle` rather than throwing. A doc's kind is
 * persisted JSON, so an id can outlive the kind that wrote it (a renamed or
 * withdrawn kind, or a doc restored from an older environment). Falling back
 * keeps that template renderable and editable; throwing would take the whole
 * library down with one bad row.
 */
export function offerKind(id?: string | null): OfferKind {
  const wanted = (id ?? '').trim();
  return OFFER_KINDS.find((k) => k.id === wanted) ?? vehicleKind;
}

/**
 * The offer kind a doc is built against when it doesn't say.
 *
 * Every template written before kinds existed was a vehicle offer — its fields
 * were stamped from the one fixed schema — so `undefined` genuinely means
 * `vehicle`. Same compatibility trick as `usage` and `templateSync`: nothing to
 * migrate, and no existing template changes behaviour.
 */
export const DEFAULT_OFFER_KIND = 'vehicle';

/** The kind ID a doc is built against. See {@link DEFAULT_OFFER_KIND}. */
export function docOfferKind(doc: Pick<TemplateDoc, 'offerKind'>): string {
  return doc.offerKind?.trim() || DEFAULT_OFFER_KIND;
}

/** The kind a doc is built against. `offerKind` undefined ⇒ `vehicle`. */
export function offerKindForDoc(doc: Pick<TemplateDoc, 'offerKind'>): OfferKind {
  return offerKind(docOfferKind(doc));
}

/** The field schema for a kind id. The per-template counterpart of
 *  `SYSTEM_FIELDS`, which is only ever the VEHICLE kind's schema. */
export function fieldsForKind(id?: string | null): FieldSpec[] {
  return offerKind(id).fields;
}

/**
 * Does this kind's `disclaimer` field come from the TOKEN ENGINE, or is it just
 * text a person types?
 *
 * The disclaimer engine exists to substitute offer figures into manufacturer
 * language and append the dealer-fee boilerplate. A kind with no offer types has
 * no figures to substitute, and the boilerplate is actively wrong — it asserts
 * something about an advertised vehicle price. Left as a DERIVED predicate rather
 * than another flag on the kind so it cannot fall out of step with `offerTypes`.
 *
 * When false the form shows a plain textarea instead of `DisclaimerField`.
 */
export function composesDisclaimer(kind: OfferKind): boolean {
  return kind.offerTypes.length > 0;
}

/**
 * Can this template be used by unattended OEM generation?
 *
 * Two independent gates, and both matter:
 *   - `usage` is INTENT — was this built for the feed or for a person.
 *   - the kind's `automation` capability is POSSIBILITY — a service offer has no
 *     feed to generate from, so no service template can ever be a candidate.
 *
 * Lives here rather than in `doc-types` because it now needs the registry.
 */
export function usableByAutomation(doc: Pick<TemplateDoc, 'usage' | 'offerKind'>): boolean {
  return templateUsage(doc) !== 'custom' && offerKindForDoc(doc).capabilities.automation;
}
