import type { TemplateDoc, DocElement } from './doc-types';
import { offerTypeShort } from './offer-type-style';

/**
 * WHAT WOULD RETIRING "SHOW FOR" COST — per template, as a fact rather than a
 * guess.
 *
 * Retiring `visibleWhen: { field: 'offerType' }` is the deletion Phase 4b is
 * about, and it is the one part of the rebuild that is not additive: a template
 * that switches per-type plate copies with Show For loses those plates the moment
 * the control goes. Which templates those are, and what replacing each would take,
 * is a question about the LIBRARY — so this answers it instead of estimating.
 *
 * The shape of the answer that matters: a design where every gated layer is one of
 * a per-type SET (a label, a figure and some terms, repeated four times, one set
 * per offer type) is replaced by a single offer plate, mechanically. A design where
 * the gating says something else — a lease-only legal line, an APR-only badge — is
 * not a plate, and deleting its gate would change what the ad says. The first is a
 * migration; the second is a decision.
 *
 * Pure: no DB, no network. Callers hand it docs from wherever they live.
 */

/** How a template's Show For usage is classified. */
export type ShowForVerdict =
  /** No `offerType` gating at all — Phase 4b costs it nothing. */
  | 'unaffected'
  /** Every gated layer belongs to a per-type plate set. One plate replaces them. */
  | 'plate_migration'
  /** Gating carries content that differs by type. Needs a person to decide. */
  | 'needs_decision';

export interface GatedLayer {
  id: string;
  name: string;
  /** Offer types it is shown for. */
  types: string[];
  /** What it renders — a binding key, or 'static text'. */
  shows: string;
  /**
   * True when this layer looks like part of a per-type plate: it renders an offer
   * figure, an offer label or offer terms, which is exactly what one plate does
   * for every type at once.
   */
  plateLike: boolean;
  /** Which offer slot it belongs to — 1, or 2 for an `o2_` binding. */
  slot: number;
}

export interface ShowForReport {
  templateId: string;
  name: string;
  verdict: ShowForVerdict;
  /** Every layer gated on offer type. */
  gated: GatedLayer[];
  /** Offer types the gating mentions. */
  types: string[];
  /**
   * Layers a single offer plate would replace. The plate count is how many plates
   * the migrated design needs — one per offer slot, not per type.
   */
  replaceable: number;
  /** Layers whose gating is about content, not plate switching. */
  contentGated: number;
  /** One line for a person reading a list of these. */
  summary: string;
}

/**
 * Field keys that mean "this layer is part of the offer plate".
 *
 * The computed tokens, plus the raw figures each offer type puts in the headline.
 * A layer bound to any of them is showing the offer itself, which is the thing a
 * plate renders for every type without a gate.
 */
const PLATE_KEYS = /^_(?:o\d+_)?offer|^(monthlyPayment|aprRate|discountAmount|salePrice|offerPrice|percentOff|dollarOff|offerPhrase)$/;

function layerShows(el: DocElement): { shows: string; keys: string[] } {
  const b = el.binding;
  if (b?.kind === 'field' || b?.kind === 'brand') return { shows: b.key, keys: [b.key] };
  if (b?.kind === 'static') {
    const keys = (b.value.match(/\{\{\s*([\w.]+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, ''));
    return { shows: keys.length ? `text with ${keys.join(', ')}` : 'static text', keys };
  }
  if (el.type === 'offer') return { shows: 'offer plate', keys: ['_offerMain'] };
  return { shows: el.type, keys: [] };
}

export function surveyShowFor(doc: TemplateDoc): ShowForReport {
  const gated: GatedLayer[] = [];
  const types = new Set<string>();

  for (const el of doc.elements) {
    const vw = el.visibleWhen;
    if (vw?.field !== 'offerType') continue;
    const { shows, keys } = layerShows(el);
    for (const t of vw.in) types.add(t);
    // `_o2_offerMain` is the second offer's figure — the prefix is how a dual
    // design's two plate sets tell themselves apart.
    const prefixed = keys.map((k) => k.match(/^_o(\d+)_/)).find(Boolean);
    gated.push({
      id: el.id,
      name: el.name || el.id,
      types: vw.in,
      shows,
      plateLike: keys.some((k) => PLATE_KEYS.test(k)),
      slot: prefixed ? Number(prefixed[1]) : 1,
    });
  }

  const replaceable = gated.filter((g) => g.plateLike).length;
  const contentGated = gated.length - replaceable;
  const verdict: ShowForVerdict =
    gated.length === 0 ? 'unaffected' : contentGated === 0 ? 'plate_migration' : 'needs_decision';

  // How many plates the migrated design needs: one per offer SLOT, not per type.
  const slots = new Set(gated.filter((g) => g.plateLike).map((g) => g.slot));

  const typeList = [...types].map(offerTypeShort).join(', ');
  const summary =
    verdict === 'unaffected'
      ? 'No offer-type gating. Nothing to migrate.'
      : verdict === 'plate_migration'
        ? `${gated.length} gated layers, all offer plate parts across ${typeList}. ${slots.size} offer plate${slots.size === 1 ? '' : 's'} replaces them.`
        : `${gated.length} gated layers: ${replaceable} are plate parts, ${contentGated} gate CONTENT (${gated
            .filter((g) => !g.plateLike)
            .map((g) => g.name)
            .join(', ')}). The plates migrate; the rest needs a call.`;

  return {
    templateId: doc.id,
    name: doc.name,
    verdict,
    gated,
    types: [...types],
    replaceable,
    contentGated,
    summary,
  };
}

/** The whole library, worst first — the order somebody would work through it. */
export function surveyLibrary(docs: TemplateDoc[]): ShowForReport[] {
  const rank: Record<ShowForVerdict, number> = { needs_decision: 0, plate_migration: 1, unaffected: 2 };
  return docs
    .map(surveyShowFor)
    .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.gated.length - a.gated.length);
}

/** What the library as a whole says about Phase 4b. */
export function summarizeLibrary(reports: ShowForReport[]): string {
  const n = (v: ShowForVerdict) => reports.filter((r) => r.verdict === v).length;
  const decide = n('needs_decision');
  const migrate = n('plate_migration');
  const clear = n('unaffected');
  return [
    `${reports.length} template${reports.length === 1 ? '' : 's'}`,
    `${clear} unaffected`,
    `${migrate} a mechanical plate migration`,
    `${decide} needing a decision`,
  ].join(', ');
}
