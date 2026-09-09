import type { AdData } from './types';

/**
 * Did a person change the OFFER, as opposed to anything else on the ad?
 *
 * Generation fills an ad's numbers from the manufacturer's program and composes
 * its disclaimer from the same source. A client may then adjust those numbers —
 * that is a deliberate product decision, not a loophole — but the resulting ad
 * is no longer stating what the OEM published, and nothing downstream could tell.
 * `_oemApplied` looks like it would answer this and does not: it is written once
 * at generation and read by nothing.
 *
 * So the edit is RECORDED as an event (`AdCreative.offerEditedAt`), mirroring
 * `docEditedAt` on the design side. Deliberately an event rather than derived
 * state: if someone edits a payment and later edits it back, a derived
 * comparison says "unedited" while the honest answer for compliance is "a person
 * has been in here". Derived state is right for status; provenance wants the
 * event.
 *
 * Pure and client-safe.
 */

/**
 * The fields that carry the OFFER, per slot.
 *
 * Taken from what `incentiveToFieldPatch` writes, minus its bookkeeping keys
 * (`_oemApplied`, `_oemSelectedKey`, `_oemZip`) and the vehicle identity — a
 * different trim or a corrected vehicle name is not a change to the terms.
 *
 * `expiration` is included and is shared rather than per-slot: moving the date
 * an offer runs to is as much a change to what is being advertised as moving the
 * payment.
 */
const PER_SLOT_FIELDS = [
  'offerType',
  'monthlyPayment',
  'leaseTerm',
  'dueAtSigning',
  'aprRate',
  'aprTerm',
  'costPerThousand',
  'discountAmount',
  'msrp',
] as const;

const SHARED_FIELDS = ['expiration'] as const;

/** Every key an offer edit could touch, both slots plus the shared ones. */
export function offerFieldKeys(): string[] {
  return [
    ...PER_SLOT_FIELDS,
    ...PER_SLOT_FIELDS.map((k) => `o2_${k}`),
    ...SHARED_FIELDS,
  ];
}

/** Absent, null and empty string all mean "not set" — and must compare equal,
 *  or clearing an already-empty field would read as an edit. */
function norm(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/**
 * True when any offer-bearing value differs between two versions of an ad's data.
 *
 * Compares only the keys above. The form autosaves as you type and posts the
 * whole data blob, so testing "did anything change" would stamp the ad on every
 * keystroke — the same distinction `docEditedAt` draws by comparing design
 * hashes rather than trusting that a doc was sent.
 */
export function offerValuesChanged(prev: AdData | null, next: AdData): boolean {
  if (!prev) return false; // nothing to compare against — treat as untouched
  return offerFieldKeys().some((k) => norm(prev[k]) !== norm(next[k]));
}

/**
 * The offer fields that actually differ, for the note left on the ad.
 *
 * Naming them matters: "the offer was edited" sends a reviewer diffing two
 * screens, while "monthlyPayment, expiration" tells them where to look.
 */
export function changedOfferFields(prev: AdData | null, next: AdData): string[] {
  if (!prev) return [];
  return offerFieldKeys().filter((k) => norm(prev[k]) !== norm(next[k]));
}
