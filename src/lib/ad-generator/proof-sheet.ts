import type { AdData, AdSize } from './types';
import type { TemplateDoc } from './doc-types';
import type { OemOfferRule } from './compliance';
import type { CoopRulePack } from './coop-rules';
import { renderDoc } from './doc-renderer';
import { mergeRenderData } from './render-creative';
import { enrichOfferFields } from './offer-text';
import { offerKindForDoc } from './offer-kinds';
import { offerTypeAccent, offerTypeShort } from './offer-type-style';
import { preflight, type CoopDesignVerdict, type PreflightIssue } from './preflight';
import { auditTemplate, type AuditFinding } from './template-audit';

/**
 * THE PROOF SHEET — every offer type this template claims to serve, on every board
 * it defines, drawn by the real renderer and checked by the real compliance gate.
 *
 * ── WHY A SHEET AND NOT TABS ──
 *
 * The builder's preview tabs answer "what does this look like as a lease ad, on
 * this board" — one cell of a grid, one at a time, from memory. The question a
 * designer actually has to answer before publishing is the whole grid: does this
 * design hold for four offer types across five channels, and would compliance let
 * any of those twenty ads out the door. Tabs make that twenty clicks and a memory
 * test, which is why templates shipped with a lease board nobody had looked at.
 *
 * Showing them all at once also makes a specific class of fault visible that no
 * single preview can: the plate that reads beautifully for a lease and overflows
 * for a sale price, the board where the disclaimer is legible for three types and
 * eleven pixels for the fourth. Those are the faults the archetype work was for,
 * so this is the sheet that proves it.
 *
 * ── PURE ──
 *
 * No DB, no network, no clock. The caller supplies the OEM rule, the co-op pack
 * and the design verdict exactly as the preflight endpoint does, so the sheet and
 * the pipeline cannot disagree about the same template. That also means this file
 * is testable arithmetic-and-strings: the tests render real docs and assert on the
 * markup and the issues, with nothing stubbed.
 */

export interface ProofBoard {
  sizeId: string;
  label: string;
  width: number;
  height: number;
  /** A complete HTML document, for an iframe `srcdoc`. */
  html: string;
  /** Issues observed on THIS board (a size-scoped subset of the row's issues). */
  issues: PreflightIssue[];
}

export interface ProofRow {
  offerType: string;
  /** "Lease", "APR" — the short name, for a pill. */
  label: string;
  /** The type's own accent, shared with the builder's pills and tabs. */
  accent: string;
  boards: ProofBoard[];
  /** Every issue for this offer type, board-scoped or not. */
  issues: PreflightIssue[];
  /** True when nothing at `error` severity fired for this offer type. */
  ok: boolean;
}

/**
 * A fault in the TEMPLATE, stated once.
 *
 * The design-time co-op verdict is replayed into every ad, so a sheet that filed
 * these per row printed the same handful of design faults twenty times over — a
 * hundred lines of warning that were really five. Worse, it filed them next to the
 * ad that happened to be checked, when the fix is in the design and belongs to the
 * designer. So they are hoisted here, deduplicated by rule, carrying the offer
 * types each was observed under.
 */
export interface ProofTemplateFault {
  ruleId: string;
  description: string;
  severity: 'error' | 'warning';
  citation?: string;
  /** Offer types this fault was observed under. Empty means every type. */
  offerTypes: string[];
  /** Boards it was observed on. Empty means every board. */
  sizes: string[];
  /**
   * The measurement per board — `{ 'ksl-320x50': '2px' }`. A fault collapsed across
   * boards fails by a different amount on each, and the amount is what says how far
   * the layer has to move. Shown on the board chip rather than in the sentence.
   */
  sizeDetail?: Record<string, string>;
  /** What to do about it, where the fault itself doesn't say. */
  fix?: string;
  /**
   * Where the fault came from: a manufacturer's transcribed rules, or Loomi's own
   * design audit. Worth saying, because a reader treats "Mazda says so" and "this
   * disclaimer is nine pixels tall" differently — and only one of them has a
   * citation to check.
   */
  source: 'coop' | 'audit';
}

/**
 * One line of "what you need to know to read this sheet honestly".
 *
 * Typed rather than plain prose because a reader should not have to parse a
 * paragraph to find out which of these stops an ad shipping. `blocking` is a fact
 * about export; `caution` is a limit on what was checked; `context` explains
 * something that LOOKS wrong and is not.
 */
export interface ProofNote {
  tone: 'blocking' | 'caution' | 'context';
  /** A short label for the badge — two or three words. */
  label: string;
  text: string;
}

export interface ProofSheet {
  rows: ProofRow[];
  sizes: AdSize[];
  /** Design faults, one line each — see {@link ProofTemplateFault}. */
  templateFaults: ProofTemplateFault[];
  /** True when every row is ok — this template can ship for every type it claims. */
  ok: boolean;
  errorCount: number;
  warningCount: number;
  /**
   * What the reader should know to read the sheet honestly: that no co-op pack
   * exists for the make, that a pack is unverified, that the design's own photo
   * and logo come from the account. Ordered by severity, so what blocks an export
   * is read first.
   */
  notes: ProofNote[];
}

export interface ProofSheetInput {
  doc: TemplateDoc;
  /**
   * Values over the template's own defaults — the account's brand colour, logo and
   * fonts, and a sample vehicle. Absent, the sheet draws the template's defaults,
   * which is a legitimate view of the DESIGN and an unhelpful one of a real ad.
   */
  data?: AdData;
  /** The make's OEM rule, if any. */
  oemRule?: OemOfferRule | null;
  /** The make's co-op pack, if one has been transcribed. */
  coopPack?: CoopRulePack | null;
  /** The stored design-time verdict, replayed rather than recomputed. */
  coopDesign?: CoopDesignVerdict | null;
  /**
   * Offer types to draw. Defaults to every type the doc's KIND offers — not every
   * type the doc's `visibleWhen` conditions declare, which is what the co-op design
   * check uses. The difference is the point of the sheet: an archetype-built design
   * gates nothing, so it claims to serve all four, and the sheet is where that
   * claim gets tested rather than assumed.
   */
  offerTypes?: string[];
  /** Boards to draw. Defaults to every size the doc defines, in doc order. */
  sizeIds?: string[];
}

/**
 * Offer types a proof sheet draws for a doc.
 *
 * `no_offer` is excluded: a message-only ad has no offer to prove, and drawing it
 * would put an empty plate in the grid next to four full ones as if that were a
 * finding. Every other type the kind offers is drawn, including the free-text one.
 */
export function proofOfferTypes(doc: TemplateDoc): string[] {
  return offerKindForDoc(doc)
    .offerTypes.filter((s) => !s.noOffer)
    .map((s) => s.value);
}

/** The data one row renders with: defaults, then the caller's, then the type. */
export function proofRowData(doc: TemplateDoc, data: AdData | undefined, offerType: string): AdData {
  return enrichOfferFields({ ...mergeRenderData(doc, data ?? {}), offerType });
}

export function buildProofSheet(input: ProofSheetInput): ProofSheet {
  const { doc, data, oemRule, coopPack, coopDesign } = input;

  const wanted = input.sizeIds?.length ? new Set(input.sizeIds) : null;
  const sizes = doc.sizes.filter((s) => !wanted || wanted.has(s.id));
  const types = input.offerTypes?.length ? input.offerTypes : proofOfferTypes(doc);

  const rows: ProofRow[] = types.map((offerType) => {
    // One data set per row, used for BOTH the render and the check — so an issue
    // reported under a cell is an issue with the ad drawn in that cell.
    const rowData = proofRowData(doc, data, offerType);

    // Preflight enriches internally, so it takes the merged-but-unenriched data.
    // Passing the enriched set would be harmless but dishonest about the contract.
    const result = preflight({
      doc,
      data: { ...mergeRenderData(doc, data ?? {}), offerType },
      oemRule,
      coopPack,
      coopDesign,
      sizeIds: sizes.map((s) => s.id),
    });

    // Design faults are the template's, and identical for every row — they are
    // collected once, below, rather than repeated under each ad.
    const adIssues = result.issues.filter((i) => i.scope !== 'design');

    const boards: ProofBoard[] = sizes.map((size) => ({
      sizeId: size.id,
      label: size.label,
      width: size.width,
      height: size.height,
      // `preview: false` — the sheet is a proof, so it draws what the exporter
      // draws. Preview mode paints placeholder chrome for empty bindings, which
      // would hide exactly the hole this sheet exists to reveal.
      html: renderDoc(doc, rowData, size, { preview: false }),
      issues: adIssues.filter((i) => i.sizes?.includes(size.id)),
    }));

    return {
      offerType,
      label: offerTypeShort(offerType),
      accent: offerTypeAccent(offerType),
      boards,
      issues: adIssues,
      // `ok` still reflects the FULL result: a design fault blocks an ad of this
      // type just as hard for being the template's fault, and a row that read
      // "clears" while the design blocked it would be a lie.
      ok: result.ok,
    };
  });

  // Both halves of the design-time answer, in one list: the manufacturer's rules
  // where a pack exists, and the house audit, which holds whether one does or not.
  const templateFaults = [
    ...collectTemplateFaults(coopDesign),
    ...auditAsFaults(auditTemplate({ doc, oemRule, sizeIds: sizes.map((s) => s.id) })),
  ];
  const all = [
    ...rows.flatMap((r) => r.issues),
    // Counted once each, matching what the reader is shown.
    ...templateFaults,
  ];
  return {
    rows,
    sizes,
    templateFaults,
    // A blocking DESIGN fault fails the sheet even when every row's data checks
    // out: a template with no disclaimer makes nothing shippable, and preflight
    // would never say so because there is no ad-level value at fault.
    ok: rows.every((r) => r.ok) && !templateFaults.some((f) => f.severity === 'error'),
    errorCount: all.filter((i) => i.severity === 'error').length,
    warningCount: all.filter((i) => i.severity === 'warning').length,
    notes: proofNotes({ doc, coopPack, coopDesign, rows, templateFaults }),
  };
}

/**
 * The design verdict's findings, one line per rule.
 *
 * Read from the verdict rather than out of preflight's issues: the verdict carries
 * the rule, the citation and the offer type as separate fields, where preflight has
 * already composed them into a sentence for a per-ad reader. Same facts, in the
 * shape a template-level list needs.
 */
function collectTemplateFaults(coopDesign?: CoopDesignVerdict | null): ProofTemplateFault[] {
  if (!coopDesign?.findings.length) return [];
  const by = new Map<string, ProofTemplateFault>();
  for (const f of coopDesign.findings) {
    // Keyed on rule AND wording: one rule can fail for more than one reason.
    // `JSON.stringify` rather than joining on a separator byte — a raw NUL in a
    // key literal makes the whole FILE read as binary, and grep then skips it
    // silently (`meta-ads-pacer.ts` is invisible to search for exactly that).
    const key = JSON.stringify([f.ruleId, f.description]);
    const seen = by.get(key);
    const type = f.offerType && f.offerType !== 'any' ? f.offerType : '';
    if (seen) {
      // An error under any offer type makes the fault an error.
      if (f.severity === 'error') seen.severity = 'error';
      if (type && !seen.offerTypes.includes(type)) seen.offerTypes.push(type);
    } else {
      by.set(key, {
        ruleId: f.ruleId,
        description: f.description,
        severity: f.severity,
        citation: f.citation,
        offerTypes: type ? [type] : [],
        // A design rule is geometry, so it holds on every board the verdict
        // covered — the verdict does not carry a board list.
        sizes: [],
        source: 'coop',
      });
    }
  }
  return [...by.values()];
}

/**
 * What a reader needs in order not to over-trust the sheet.
 *
 * A clean sheet means different things depending on which checks were in force,
 * and the difference between "passes Chevrolet's co-op rules" and "no Chevrolet
 * rules have been transcribed yet" is the whole value of saying so out loud.
 */
function proofNotes(args: {
  doc: TemplateDoc;
  coopPack?: CoopRulePack | null;
  coopDesign?: CoopDesignVerdict | null;
  rows: ProofRow[];
  templateFaults: ProofTemplateFault[];
}): ProofNote[] {
  const { doc, coopPack, coopDesign, rows, templateFaults } = args;
  const notes: ProofNote[] = [];
  const make = (doc.make ?? '').trim();

  if (!coopPack) {
    notes.push({
      tone: 'caution',
      label: 'Not checked',
      text: make
        ? `No ${make} co-op rule pack is on file, so no manufacturer advertising rules were checked. A clean sheet here is not a compliance sign-off.`
        : 'This template names no make, so no manufacturer advertising rules were checked.',
    });
  } else if (!coopPack.verified) {
    notes.push({
      tone: 'caution',
      label: 'Unverified pack',
      text: `The ${make || coopPack.make} co-op pack is unverified — its rules report as warnings rather than blocking, so an error you would expect may appear as a warning below.`,
    });
  }
  if (coopDesign?.stale) {
    notes.push({
      tone: 'caution',
      label: 'Out of date',
      text: 'The design-time co-op verdict predates the current design or rule pack, so its findings are replayed as warnings. Re-run the template check for a definite answer.',
    });
  }

  // The two things that are always the account's rather than the template's, and
  // so are always missing from a design viewed on its own.
  const missing: string[] = [];
  if (!doc.defaults?.vehicleImageUrl) missing.push('vehicle photo');
  if (!doc.defaults?.logoUrl) missing.push('dealer logo');
  if (missing.length) {
    // Capitalised: it is a sentence, and it read as a fragment before.
    const what = missing.join(' and ');
    notes.push({
      tone: 'context',
      label: 'Blank on purpose',
      text: `${what[0].toUpperCase()}${what.slice(1)} come from the account, not the template — ${missing.length > 1 ? 'they are' : 'it is'} blank here unless a sample was supplied.`,
    });
  }

  if (templateFaults.length) {
    const errs = templateFaults.filter((f) => f.severity === 'error').length;
    const oem = templateFaults.filter((f) => f.source === 'coop').length;
    // Name the source in the count: "3 rules the design fails" reads as
    // manufacturer authority, and half of these are our own legibility bar.
    const where = oem === templateFaults.length
      ? 'manufacturer rules'
      : oem === 0
        ? 'design checks'
        : `checks (${oem} of them a manufacturer's)`;
    notes.push({
      tone: errs ? 'blocking' : 'caution',
      label: 'Design faults',
      text: `${templateFaults.length} ${where} the DESIGN fails${errs ? `, ${errs} of them blocking` : ''}. Listed once below — they apply to every ad off this template, so they are the designer's to fix, not the data's.`,
    });
  }

  const failing = rows.filter((r) => !r.ok).map((r) => r.label);
  if (failing.length) {
    notes.push({
      tone: 'blocking',
      label: 'Cannot export',
      text: `Blocked for ${failing.join(', ')}. An ad of ${failing.length > 1 ? 'those types' : 'that type'} cannot be exported off this template until the errors below are cleared.`,
    });
  }

  // Severity order, not the order the checks happen to run in: what stops an ad
  // shipping is the first thing a reader needs.
  const rank = { blocking: 0, caution: 1, context: 2 } as const;
  return notes.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/**
 * The house audit's findings, in the shape the faults list already renders.
 *
 * The audit is not a manufacturer's rule, so it has no citation — and saying so
 * plainly is better than borrowing the authority of one. `check` stands in for
 * `ruleId`: it is stable, and it is what a bug report should name.
 */
function auditAsFaults(findings: AuditFinding[]): ProofTemplateFault[] {
  return findings.map((f) => ({
    ruleId: f.check,
    description: f.message,
    severity: f.severity,
    offerTypes: f.offerTypes,
    sizes: f.sizes,
    sizeDetail: f.sizeDetail,
    fix: f.fix,
    source: 'audit' as const,
  }));
}

/** One line for a header or a page title: "4 offer types × 5 boards". */
export function proofSheetSummary(sheet: ProofSheet): string {
  const t = sheet.rows.length;
  const b = sheet.sizes.length;
  return `${t} offer type${t === 1 ? '' : 's'} × ${b} board${b === 1 ? '' : 's'} — ${t * b} ad${t * b === 1 ? '' : 's'}`;
}
