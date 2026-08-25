import type { TemplateDoc, DocElement, DocLayoutBox } from './doc-types';
import type { AdSize } from './types';
import type { OemOfferRule } from './compliance';
import { requiredFieldsFor, FIELD_LABELS } from './compliance';
import { offerKindForDoc } from './offer-kinds';
import { offerTokenFields, primaryOfferField } from './offer-text';
import { offerTypeShort } from './offer-type-style';
import { sizeFitOf } from './size-scope';

/**
 * THE DESIGN AUDIT — is this TEMPLATE fit to make ads, before it makes any?
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE CO-OP ENGINE ──
 *
 * The co-op engine answers "does this satisfy Mazda's advertising rules", and it
 * can only answer that where somebody has transcribed Mazda's document. Most makes
 * have no pack, so for most templates every co-op check is a no-op — and a
 * template with no disclaimer on the 300×250 sails through as compliant because
 * there was nothing to check it against.
 *
 * These are the checks that hold with no pack at all: the house minimum. A
 * manufacturer might demand a disclaimer at 1.4% of the short edge; nobody has to
 * tell us that a disclaimer rendered at eleven pixels is not a disclaimer.
 *
 * ── WHY DESIGN TIME ──
 *
 * Every finding here is a property of the DESIGN, identical for every ad off the
 * template. Discovered per ad, it surfaces as "generation produced nothing this
 * morning" and sends the wrong person to the wrong place. Discovered on the
 * template, it says "the disclaimer is illegible on the Google board" to the one
 * person who can move it. Same reasoning as `coop-template-check.ts`, which is the
 * pack-driven half of the same idea.
 *
 * ── WHAT IT WILL AND WILL NOT CLAIM ──
 *
 * Only what the doc PROVES. There is no browser here, so nothing measures a glyph:
 * a text box's height in pixels is a hard ceiling on how tall one line of it can
 * be, and a declared font size is a fact. Findings rest on one of those two, which
 * is why an error here means *impossible*, not *probably bad*. Anything softer is a
 * warning, and anything needing measurement belongs to the proof sheet's eyes.
 *
 * Pure: no DB, no network, no clock.
 */

/** Text under this cannot be read by anyone, on any board. */
export const LEGIBILITY_FLOOR_PX = 10;

/**
 * What a disclaimer should be able to render at, ON THIS BOARD.
 *
 * A share of the short edge rather than one number, because one number cannot be
 * right for both a 1080 square and a 300×250: 22px is a comfortable legal line on
 * the square and a tenth of the whole board on the rectangle. Manufacturer co-op
 * packs state their own minimums the same way (Mazda's is 1.4% of the short edge);
 * 2.2% sits above every pack in the library, with 11px as the floor under it.
 *
 * THE ARCHETYPE IMPORTS THIS. Its disclaimer is the one slot that holds a type
 * size rather than fitting its box, and the size it holds is this number — so the
 * layout and the audit cannot disagree about what legible means. Before that they
 * did: the layout capped at the renderer's default 16px while this file wanted a
 * flat 22, so an archetype design failed its own audit on every board.
 */
export function disclaimerTargetPx(size: Pick<AdSize, 'width' | 'height'>): number {
  return Math.round(Math.min(26, Math.max(11, Math.min(size.width, size.height) * 0.022)));
}

export type AuditCheck =
  /** No element anywhere renders the disclaimer. */
  | 'disclaimer_absent'
  /** The disclaimer exists but is not on every board. */
  | 'disclaimer_off_board'
  /** The disclaimer cannot render legibly in the space it has. */
  | 'disclaimer_illegible'
  /** A required offer figure is not shown anywhere in the design. */
  | 'required_field_unplaced'
  /** Nothing identifies the dealer. */
  | 'dealer_unidentified'
  /** An element's box hangs off the edge of a board. */
  | 'element_off_board'
  /** A text element is given less room than a readable line needs. */
  | 'text_illegible';

export interface AuditFinding {
  check: AuditCheck;
  severity: 'error' | 'warning';
  /** What is wrong, in one sentence, in the terms a designer works in. */
  message: string;
  /** What to do about it, where that is not obvious from the message. */
  fix?: string;
  /** Boards it was observed on. Empty means the whole design. */
  sizes: string[];
  /** Offer types it applies to. Empty means every type. */
  offerTypes: string[];
  /** The element at fault, where there is one. */
  elementId?: string;
}

export interface AuditInput {
  doc: TemplateDoc;
  /** The make's OEM rule, if any — it widens what counts as a required field. */
  oemRule?: OemOfferRule | null;
  /** Boards to audit. Defaults to every size the doc defines. */
  sizeIds?: string[];
}

/**
 * The field keys an element actually renders — a direct binding, or the
 * `{{tokens}}` inside typed static content.
 *
 * Was a private helper in the builder page, which is why nothing else could ask
 * the question. `boundFieldKeys` in `doc-types.ts` answers a nearby but different
 * one (every key the doc touches, conditions included); this is per element and
 * counts what a reader of the ad would actually SEE.
 */
export function elementFieldRefs(el: DocElement): string[] {
  const b = el.binding;
  if (b?.kind === 'field' || b?.kind === 'brand') return [b.key];
  if (b?.kind === 'static')
    return (b.value.match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, ''));
  return [];
}

/** Whether this element renders for an ad of `offerType`. */
function shownFor(el: DocElement, offerType: string): boolean {
  const vw = el.visibleWhen;
  if (vw?.field !== 'offerType') return true;
  return vw.in.includes(offerType);
}

/**
 * Every required field this design SURFACES for one offer type — directly, through
 * a computed offer token, or through the disclaimer's fine print.
 *
 * Lifted out of a `useMemo` in the builder page so the audit, the proof sheet and
 * any server-side gate reach the same verdict as the builder's own chip. One claim,
 * one implementation.
 */
export function surfacedFields(doc: TemplateDoc, offerType: string, required: string[]): Set<string> {
  const surfaced = new Set<string>();
  let hasDisclaimer = false;
  for (const el of doc.elements) {
    if (!shownFor(el, offerType)) continue;
    // A plate renders the label, the figure and the terms of its own offer, so it
    // surfaces everything that offer type's tokens read.
    if (el.type === 'offer') {
      for (const keys of Object.values(offerTokenFields(offerType))) for (const f of keys) surfaced.add(f);
      continue;
    }
    for (const key of elementFieldRefs(el)) {
      if (key === 'disclaimer') {
        hasDisclaimer = true;
        surfaced.add('disclaimer');
      } else if (/^_(?:o2_)?offer/.test(key)) {
        for (const f of offerTokenFields(offerType)[key.replace(/^_o2_/, '_')] ?? []) surfaced.add(f);
      } else {
        surfaced.add(key);
      }
    }
  }
  // A disclaimer element discloses the fine-print fields — everything the OEM
  // disclaimer composes — except the headline amount, which has to be shown on its
  // own or the ad has no offer on it.
  if (hasDisclaimer) {
    const headline = primaryOfferField(offerType);
    for (const k of required) if (k !== headline) surfaced.add(k);
  }
  return surfaced;
}

/** The disclaimer elements in a design — by binding, or by archetype role. */
function disclaimerElements(doc: TemplateDoc): DocElement[] {
  return doc.elements.filter(
    (el) => el.role === 'disclaimer' || elementFieldRefs(el).includes('disclaimer'),
  );
}

/**
 * The largest a single line of this text CAN be on this board.
 *
 * Both limits bind, and the smaller wins. The box's height is a hard ceiling —
 * auto-fitted text cannot be taller than the box holding it. A declared size is a
 * CAP the fitter starts from and shrinks below when the box is smaller, so a 5px
 * strip declaring 11px type renders 5px, not 11.
 *
 * Taking only the declared size (the first version of this) let a design declare
 * its way out of the check: an unreadable strip passed because the number written
 * on it was fine.
 */
function lineCeilingPx(box: DocLayoutBox, size: AdSize): { px: number; declared: boolean } {
  const fromBox = box.h * size.height;
  const declared = box.fontSize ?? 0;
  if (declared > 0 && declared < fromBox) return { px: declared, declared: true };
  return { px: fromBox, declared: false };
}

/**
 * "a lease ad", "an APR ad" — the offer type as it reads mid-sentence.
 *
 * The pill wants `Lease` capitalised; a sentence does not, unless the label is an
 * acronym. And the article follows the label, not the type id: `An APR ad` is
 * right and `A APR ad` is what the first draft of this file said.
 */
function offerTypePhrase(value: string): string {
  const label = offerTypeShort(value);
  const name = label === label.toUpperCase() ? label : label[0].toLowerCase() + label.slice(1);
  return `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name}`;
}

/** Is a text element expected to carry words a reader has to read? */
function isReadableText(el: DocElement): boolean {
  return el.type === 'text' || el.type === 'offer';
}

export function auditTemplate({ doc, oemRule, sizeIds }: AuditInput): AuditFinding[] {
  const wanted = sizeIds?.length ? new Set(sizeIds) : null;
  const sizes = doc.sizes.filter((s) => !wanted || wanted.has(s.id));
  const findings: AuditFinding[] = [];
  const add = (f: Omit<AuditFinding, 'sizes' | 'offerTypes'> & Partial<Pick<AuditFinding, 'sizes' | 'offerTypes'>>) =>
    findings.push({ sizes: [], offerTypes: [], ...f });

  // ── 1. The disclaimer ──
  // Not optional, and not shed. An ad whose legal line cannot be read is one
  // nobody can run, whatever else is right about it.
  const disclaimers = disclaimerElements(doc);
  if (disclaimers.length === 0) {
    add({
      check: 'disclaimer_absent',
      severity: 'error',
      message: 'Nothing in this design renders the disclaimer.',
      fix: 'Add a text layer bound to Disclaimer. Every manufacturer requires one, and an offer ad without it cannot be published.',
    });
  } else {
    const missingOn: string[] = [];
    const illegible: { sizeId: string; px: number; declared: boolean }[] = [];
    const belowTarget: { sizeId: string; px: number; target: number }[] = [];
    for (const size of sizes) {
      // On the board at all? A slot the layout sheds has no box here — and the
      // disclaimer is the one slot that may never be shed.
      const boxes = disclaimers
        .map((el) => doc.layouts?.[size.id]?.[el.id])
        .filter((b): b is DocLayoutBox => !!b && !b.hidden);
      if (boxes.length === 0) {
        missingOn.push(size.id);
        continue;
      }
      // The roomiest disclaimer box wins: a design may carry two and show one.
      const best = boxes
        .map((b) => lineCeilingPx(b, size))
        .sort((a, b) => b.px - a.px)[0];
      const target = disclaimerTargetPx(size);
      if (best.px < LEGIBILITY_FLOOR_PX) illegible.push({ sizeId: size.id, ...best });
      else if (best.px < target) belowTarget.push({ sizeId: size.id, px: best.px, target });
    }
    if (missingOn.length) {
      add({
        check: 'disclaimer_off_board',
        severity: 'error',
        sizes: missingOn,
        elementId: disclaimers[0].id,
        message: `The disclaimer is not on ${missingOn.length === 1 ? 'one board' : `${missingOn.length} boards`}.`,
        fix: 'Place it on every size. A board too small to carry a legible disclaimer is a board this template should not offer.',
      });
    }
    for (const i of illegible) {
      add({
        check: 'disclaimer_illegible',
        severity: 'error',
        sizes: [i.sizeId],
        elementId: disclaimers[0].id,
        message: i.declared
          ? `The disclaimer is set to ${Math.round(i.px)}px — under the ${LEGIBILITY_FLOOR_PX}px nobody can read.`
          : `The disclaimer has ${Math.round(i.px)}px of height to render in, so no line of it can clear ${LEGIBILITY_FLOOR_PX}px.`,
        fix: 'Give it more height, or drop this board from the template.',
      });
    }
    if (belowTarget.length) {
      add({
        check: 'disclaimer_illegible',
        severity: 'warning',
        sizes: belowTarget.map((b) => b.sizeId),
        elementId: disclaimers[0].id,
        message: `The disclaimer is smaller than this board can carry on ${belowTarget.length === 1 ? 'one board' : `${belowTarget.length} boards`} (${belowTarget.map((b) => `${Math.round(b.px)}px where ${b.target}px fits`).join(', ')}).`,
        fix: "A disclaimer wants about 2.2% of the board's short edge — above every manufacturer minimum in the library, and legible on a phone at arm's length.",
      });
    }
  }

  // ── 2. Required offer figures ──
  // The engine already knows what each offer type intrinsically needs, and the
  // make's rule widens it. This asks whether the DESIGN has anywhere to put them:
  // a value with no layer to render it is a value nobody sees.
  for (const spec of offerKindForDoc(doc).offerTypes) {
    if (spec.noOffer) continue;
    const required = requiredFieldsFor(spec.value, oemRule ?? null);
    if (!required.length) continue;
    const surfaced = surfacedFields(doc, spec.value, required);
    const unplaced = required.filter((k) => !surfaced.has(k));
    if (unplaced.length) {
      add({
        check: 'required_field_unplaced',
        severity: 'error',
        offerTypes: [spec.value],
        message: `${offerTypePhrase(spec.value)} ad off this template never shows ${unplaced.map((k) => FIELD_LABELS[k] ?? k).join(', ')}.`,
        fix: 'Add a layer for each, or leave this offer type out of the template.',
      });
    }
  }

  // ── 3. Dealer identification ──
  // Every co-op document in the library requires it, so it is a house rule rather
  // than one manufacturer's. A warning, not an error: a template may be one board
  // of a set where another carries the identity.
  const identifies = doc.elements.some((el) => {
    const keys = elementFieldRefs(el);
    return keys.includes('logoUrl') || keys.includes('dealerName');
  });
  if (!identifies) {
    add({
      check: 'dealer_unidentified',
      severity: 'warning',
      message: 'Nothing identifies the dealer — no logo, and no dealership name.',
      fix: 'Bind a layer to the account logo or the dealer name. Manufacturer co-op programs require the dealer be identifiable.',
    });
  }

  // ── 4. Geometry ──
  for (const size of sizes) {
    const layout = doc.layouts?.[size.id] ?? {};
    for (const el of doc.elements) {
      const box = layout[el.id];
      if (!box || box.hidden) continue;

      // Off the board. A little bleed is a technique — a backdrop is MEANT to hang
      // over the edge — so only a box whose whole start is outside counts, plus
      // anything that overhangs by more than a fifth of its own extent.
      const overRight = box.x + box.w - 1;
      const overBottom = box.y + box.h - 1;
      const badX = box.x < -0.001 || overRight > 0.001;
      const badY = box.y < -0.001 || overBottom > 0.001;
      // `sizeFitOf().bleed` is the codebase's own answer to "is this element's
      // overflow a crop or a cut" — a cover photo hanging off the board is the
      // technique, not a fault. Asking it here rather than re-deciding keeps the
      // audit and the geometry engine of one mind.
      const isBackdrop = el.role === 'backdrop' || el.type === 'background' || sizeFitOf(el).bleed;
      if (!isBackdrop && (badX || badY)) {
        const overhang = Math.max(
          -box.x,
          -box.y,
          overRight / Math.max(box.w, 0.001),
          overBottom / Math.max(box.h, 0.001),
        );
        if (overhang > 0.2) {
          add({
            check: 'element_off_board',
            severity: 'warning',
            sizes: [size.id],
            elementId: el.id,
            message: `${el.name || el.id} hangs off the edge of the ${size.label} board.`,
            fix: 'Move it back inside, or mark it as bleed if the overhang is deliberate.',
          });
        }
      }

      // Text with nowhere to render. Same ceiling rule as the disclaimer, applied
      // to every readable layer — this is what caught an 11px legal line and a
      // six-pixel expiration date on boards nobody had opened.
      if (!isReadableText(el)) continue;
      if (el.role === 'disclaimer' || elementFieldRefs(el).includes('disclaimer')) continue; // said above
      const { px, declared } = lineCeilingPx(box, size);
      if (px < LEGIBILITY_FLOOR_PX) {
        add({
          check: 'text_illegible',
          severity: 'error',
          sizes: [size.id],
          elementId: el.id,
          message: declared
            ? `${el.name || el.id} is set to ${Math.round(px)}px on the ${size.label} board.`
            : `${el.name || el.id} has ${Math.round(px)}px of height on the ${size.label} board — too little for a readable line.`,
          fix: `Nothing under ${LEGIBILITY_FLOOR_PX}px can be read. Give it height, or shed it on this board rather than shipping it invisible.`,
        });
      }
    }
  }

  return findings;
}

/** True when nothing at `error` severity was found — the template can make ads. */
export function auditPassed(findings: AuditFinding[]): boolean {
  return !findings.some((f) => f.severity === 'error');
}

/** One line for a chip or a log: "2 blocking, 3 to look at". */
export function summarizeAudit(findings: AuditFinding[]): string {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (!findings.length) return 'no design faults';
  const parts: string[] = [];
  if (errors) parts.push(`${errors} blocking`);
  if (warnings) parts.push(`${warnings} to look at`);
  return parts.join(', ');
}
