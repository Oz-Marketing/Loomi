/**
 * Vera's tools — the co-op specialist.
 *
 * Every one is READ-ONLY and every one is a thin wrapper over a store that already
 * exists and already has tests. That's deliberate: the specialist's job is to decide
 * WHICH question to ask of the co-op data and to explain what came back, not to
 * re-derive compliance in prose. Anything that could be computed deterministically
 * should be computed deterministically and merely reported here.
 *
 * Note what is NOT here: nothing writes. Vera cannot approve a template, record a
 * claim, or mark a pack verified. Advisory output must never silently become gating
 * input — see docs/specialist-agents.md, "Two grades of AI".
 *
 * ── Citations ──
 *
 * `search_guidelines` returns docId + page + the surrounding text, because a co-op
 * answer nobody can check is worth very little. The UI turns those into links into
 * the guideline reader, which already highlights a match on the page. The model is
 * told to carry them through into its answer.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { listGuidelineDocs, getGuidelineDoc } from '@/lib/ad-generator/guideline-docs';
import { loadAcceptedCoopPack, listCoopPacks } from '@/lib/ad-generator/coop-pack-store';
import { ruleScope } from '@/lib/ad-generator/coop-rules';
import { searchPages } from '@/lib/ad-generator/guideline-quotes';
import { listEventAssets, coversDate } from '@/lib/ad-generator/automation/event-assets';
import type { AgentToolResult } from '@/lib/ai/agent-runtime';

/** A citation the UI can turn into a link into the guideline reader. */
export interface CoopCitation {
  docId: string;
  make: string;
  title: string;
  page: number;
  /** The matched text plus surrounding context — what gets quoted back. */
  snippet: string;
  /** The section heading the match falls under, when the document has an outline. */
  section?: string;
  /**
   * Offsets into the ORIGINAL page text — what `matchBoxes` needs to draw the
   * highlight in the reader. Absent on citations that came from a rule's recorded
   * provenance rather than from a search.
   */
  start?: number;
  end?: number;
  /**
   * `loose` means the matcher bridged text interleaved INSIDE the match — a
   * pull-quote landing mid-sentence, routine in extracted PDF text. The passage is
   * real, but the highlighted span is wider than what was typed, so it gets
   * labelled rather than passed off as an exact hit.
   */
  matchType?: 'exact' | 'loose';
}

export const COOP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_guideline_docs',
    description:
      'List the manufacturer guideline documents on file, optionally for one make. ' +
      'Returns each document\'s id, make, title, page count, and whether it is current, ' +
      'recently replaced, or unreachable. Call this first when you need to know what ' +
      'evidence exists before answering.',
    input_schema: {
      type: 'object',
      properties: {
        make: {
          type: 'string',
          description: 'Manufacturer name, e.g. "Chevrolet". Omit to list every make.',
        },
      },
    },
  },
  {
    name: 'search_guidelines',
    description:
      'Full-text search across guideline documents. Returns matches with the document, ' +
      'page number and surrounding text — these are your CITATIONS and you should quote ' +
      'them. Scope to a make whenever you know it. Search the words a dealer would use ' +
      'AND the words a manufacturer would use: try several phrasings before concluding ' +
      'a topic is not covered.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find. Two characters minimum.' },
        make: { type: 'string', description: 'Restrict to one manufacturer.' },
        docId: { type: 'string', description: 'Restrict to a single document.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_guideline_pages',
    description:
      'Read the full text of specific pages of one document. Use after search_guidelines ' +
      'when a snippet is not enough context to answer accurately — for example when a rule ' +
      'continues past the end of the snippet, or when you need the surrounding conditions.',
    input_schema: {
      type: 'object',
      properties: {
        docId: { type: 'string' },
        pages: {
          type: 'array',
          items: { type: 'number' },
          description: '1-based page numbers. At most 6 at a time.',
        },
      },
      required: ['docId', 'pages'],
    },
  },
  {
    name: 'get_rule_pack',
    description:
      'The machine-checkable rules transcribed from a make\'s guidelines — what the Ad ' +
      'Generator actually enforces on generated ads. Use this when asked what is enforced ' +
      'automatically, or to compare what the system checks against what the document says. ' +
      'An UNVERIFIED pack has not been checked against its source by a human: say so.',
    input_schema: {
      type: 'object',
      properties: { make: { type: 'string' } },
      required: ['make'],
    },
  },
  {
    name: 'list_sales_events',
    description:
      'Manufacturer sales events (campaign marks) on file — the event logo and the window ' +
      'it must appear in. Ads generated inside a window pick the mark up automatically. ' +
      'Use for "is there an event running", "when does it end", "what has to be on the ad ' +
      'during it", and to warn when a window is about to close with nothing queued behind it.',
    input_schema: {
      type: 'object',
      properties: {
        make: { type: 'string', description: 'Restrict to one manufacturer.' },
      },
    },
  },
  {
    name: 'list_rule_pack_coverage',
    description:
      'Which makes have a transcribed rule pack, how many rules each has, whether it is ' +
      'verified, and how many of its rules lack a citation. Use for "which brands are ' +
      'covered" questions and to be honest about gaps.',
    input_schema: { type: 'object', properties: {} },
  },
];

/** Cap on hits returned to the model — enough to answer, not enough to flood context. */
const MAX_HITS_RETURNED = 12;
const MAX_PAGES_READ = 6;

function parsePages(doc: { pageText: string | null }): string[] {
  if (!doc.pageText) return [];
  try {
    const parsed = JSON.parse(doc.pageText);
    return Array.isArray(parsed) ? parsed.map((p) => (typeof p === 'string' ? p : '')) : [];
  } catch {
    return [];
  }
}

function parseSections(doc: { sections: string | null }): Array<{ page: number; title: string }> {
  if (!doc.sections) return [];
  try {
    const parsed = JSON.parse(doc.sections);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The heading a page falls under — the last section starting at or before it. */
function sectionForPage(
  sections: Array<{ page: number; title: string }>,
  page: number,
): string | undefined {
  let best: string | undefined;
  for (const s of sections) {
    if (s.page <= page) best = s.title;
    else break;
  }
  return best;
}


/**
 * Where a rule came from in the source document, when it says.
 *
 * Read defensively because it may not be there yet: the co-op drafting
 * branch adds `sourceDocId` / `sourcePage` / `sourceQuote` to `CoopRuleBase`, and
 * this must work whichever branch lands first. Absent on all three hand-transcribed
 * packs, which recorded only a free-text `citation` like "§4.2 p.11".
 *
 * Per-RULE rather than per-pack deliberately: a pack drafted from two documents —
 * Kia and Audi each have a reimbursement doc and a brand-identity doc in play — has
 * rules from both, and a single pack-level document id would send half of them to
 * the wrong page of the wrong PDF.
 */
function ruleProvenance(rule: unknown): { docId?: string; page?: number; quote?: string } {
  const r = rule as { sourceDocId?: unknown; sourcePage?: unknown; sourceQuote?: unknown };
  return {
    docId: typeof r.sourceDocId === 'string' ? r.sourceDocId : undefined,
    page: typeof r.sourcePage === 'number' ? r.sourcePage : undefined,
    quote: typeof r.sourceQuote === 'string' ? r.sourceQuote : undefined,
  };
}

function ok(text: string, emit?: CoopCitation[]): AgentToolResult<CoopCitation[]> {
  return { resultText: text, isError: false, ...(emit?.length ? { emit } : {}) };
}

function fail(text: string): AgentToolResult<CoopCitation[]> {
  return { resultText: text, isError: true };
}

export async function executeCoopTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<AgentToolResult<CoopCitation[]>> {
  try {
    switch (toolName) {
      case 'list_guideline_docs': {
        const make = typeof input.make === 'string' ? input.make : undefined;
        const docs = await listGuidelineDocs(make);
        if (!docs.length) {
          return ok(
            make
              ? `No guideline documents are on file for ${make}.`
              : 'No guideline documents are on file at all.',
          );
        }
        // Which documents are actually SEARCHABLE. Not every registered document has
        // extracted text — the .docx ones never went through the PDF pipeline — and
        // a brand whose only document can't be searched must not read as a brand
        // with no rules. `listGuidelineDocs` strips pageText from list payloads, so
        // ask the rows directly for the flag.
        const searchable = new Set(
          (
            await Promise.all(
              docs.map(async (d) => ((await getGuidelineDoc(d.id))?.pageText ? d.id : null)),
            )
          ).filter((id): id is string => !!id),
        );

        const lines = docs.map(
          (d) =>
            `- [${d.id}] ${d.make} — "${d.title}" (${d.pageCount ?? '?'} pages, ${d.state}` +
            (searchable.has(d.id) ? ', searchable' : ', NO TEXT EXTRACTED — cannot be searched') +
            ')' +
            (d.notes ? `\n    note: ${d.notes}` : ''),
        );
        const unsearchable = docs.length - searchable.size;
        const caveat = unsearchable
          ? `\n\n${unsearchable} of these has no extracted text, so searching will never ` +
            'return hits from it. Say so rather than reporting the topic as unaddressed; the ' +
            'document still exists and a person can open it.'
          : '';
        return ok(`${docs.length} document(s) on file:\n${lines.join('\n')}${caveat}`);
      }

      case 'search_guidelines': {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (query.length < 2) return fail('query must be at least 2 characters.');
        const make = typeof input.make === 'string' ? input.make : undefined;
        const docId = typeof input.docId === 'string' ? input.docId : undefined;

        // pageText is excluded from list payloads by default (it's megabytes across
        // the whole library), so fetch the full row per candidate document.
        const candidates = docId
          ? [await getGuidelineDoc(docId)].filter((d): d is NonNullable<typeof d> => !!d)
          : await Promise.all(
              (await listGuidelineDocs(make)).map((d) => getGuidelineDoc(d.id)),
            ).then((rows) => rows.filter((d): d is NonNullable<typeof d> => !!d));

        if (!candidates.length) {
          return ok(`No documents to search${make ? ` for ${make}` : ''}.`);
        }

        const citations: CoopCitation[] = [];
        const withoutText: string[] = [];
        for (const doc of candidates) {
          const pages = parsePages(doc);
          if (!pages.length) {
            withoutText.push(`${doc.make} — "${doc.title}"`);
            continue;
          }
          const sections = parseSections(doc);
          // `searchPages`, not plain substring matching. Extracted PDF text follows
          // glyph positions rather than reading order, so a sidebar callout lands
          // INSIDE a sentence — Mazda §5a extracts as "...must be used once and
          // should be(top placed prominently in the ad." Someone searching that
          // sentence as they'd READ it gets zero substring hits on a passage that is
          // definitely there. `limit` bounds the WORK, not just the result, so a
          // narrow cap doesn't scan all 60 pages.
          for (const hit of searchPages(pages, query, { limit: MAX_HITS_RETURNED })) {
            citations.push({
              docId: doc.id,
              make: doc.make,
              title: doc.title,
              page: hit.page,
              snippet: hit.snippet,
              section: sectionForPage(sections, hit.page),
              start: hit.start,
              end: hit.end,
              matchType: hit.matchType,
            });
          }
        }

        if (!citations.length) {
          const caveat = withoutText.length
            ? ` Note: no searchable text is stored for ${withoutText.join('; ')}, so those ` +
              'were not searched — say so rather than concluding the topic is unaddressed.'
            : '';
          return ok(`No matches for "${query}".${caveat}`);
        }

        const shown = citations.slice(0, MAX_HITS_RETURNED);
        const lines = shown.map(
          (c) =>
            `- ${c.make} "${c.title}" p.${c.page}${c.section ? ` (§ ${c.section})` : ''}` +
            (c.matchType === 'loose'
              ? ' [LOOSE MATCH — other text sits inside this passage; quote it carefully]'
              : '') +
            ` [${c.docId}]\n    …${c.snippet}…`,
        );
        const more =
          citations.length > shown.length
            ? `\n(${citations.length - shown.length} further matches not shown — narrow the query.)`
            : '';
        return ok(`${citations.length} match(es) for "${query}":\n${lines.join('\n')}${more}`, shown);
      }

      case 'read_guideline_pages': {
        const docId = typeof input.docId === 'string' ? input.docId : '';
        const requested = Array.isArray(input.pages) ? input.pages : [];
        if (!docId) return fail('docId is required.');
        const doc = await getGuidelineDoc(docId);
        if (!doc) return fail(`No document with id ${docId}.`);
        const pages = parsePages(doc);
        if (!pages.length) return ok(`No searchable text is stored for "${doc.title}".`);

        const wanted = requested
          .map((p) => (typeof p === 'number' ? Math.floor(p) : NaN))
          .filter((p) => Number.isFinite(p) && p >= 1 && p <= pages.length)
          .slice(0, MAX_PAGES_READ);
        if (!wanted.length) {
          return fail(`No valid pages requested. "${doc.title}" has ${pages.length} pages.`);
        }
        const blocks = wanted.map((p) => `--- ${doc.title}, page ${p} ---\n${pages[p - 1]}`);
        return ok(blocks.join('\n\n'));
      }

      case 'get_rule_pack': {
        const make = typeof input.make === 'string' ? input.make : '';
        if (!make) return fail('make is required.');
        // `loadAcceptedCoopPack` withholds unreviewed drafts AT THE SOURCE, so a
        // proposal can never reach this function to be described. That is stronger
        // than filtering here: the guarantee belongs to the loader, not to every
        // caller remembering to apply it.
        const loaded = await loadAcceptedCoopPack(make);
        if (!loaded) {
          return ok(
            `No rule pack has been transcribed for ${make}. The Ad Generator therefore ` +
              'enforces nothing automatically for this make — the guideline documents may ' +
              'still exist; search them.',
          );
        }
        const { pack, verified, version, proposedCount } = loaded;
        const accepted = pack.rules;
        // Taken from the accessor, NEVER derived as total − accepted: that folds
        // rejected rules into "awaiting review", overstating the queue and implying
        // a rule someone already declined might still come back.
        const pendingReview = proposedCount;

        const header =
          `${pack.make} rule pack, version ${version}` +
          (pack.source ? ` (from "${pack.source}")` : '') +
          (verified
            ? ' — VERIFIED against its source.'
            : ' — NOT VERIFIED against its source; findings are downgraded to warnings and ' +
              'you must say it is unverified when you rely on it.');
        const pending = pendingReview
          ? `\n\n${pendingReview} further rule(s) are DRAFTED BUT NOT YET REVIEWED by a person. ` +
            'They are withheld from this list and they do not evaluate. You may mention that ' +
            'they exist and are awaiting review; you must NOT state what they say or treat ' +
            'them as manufacturer requirements.'
          : '';
        // Rules that name a source document and page can be linked into the reader
        // exactly like a search hit. Resolve the (few) distinct documents once.
        const provenances = accepted.map(ruleProvenance);
        const docIds = [
          ...new Set(
            [...provenances.map((p) => p.docId), loaded.sourceDocId].filter(
              (d): d is string => !!d,
            ),
          ),
        ];
        const docsById = new Map(
          (await Promise.all(docIds.map((id) => getGuidelineDoc(id))))
            .filter((d): d is NonNullable<typeof d> => !!d)
            .map((d) => [d.id, d]),
        );

        const ruleCitations: CoopCitation[] = [];
        const rules = accepted.map((r, i) => {
          const prov = provenances[i];
          // Per-rule doc id first; the pack-level one is a derived convenience that
          // is only set when every drafted rule agrees on one document.
          const resolvedDocId = prov.docId ?? loaded.sourceDocId ?? undefined;
          const doc = resolvedDocId ? docsById.get(resolvedDocId) : undefined;
          if (doc && prov.page) {
            ruleCitations.push({
              docId: doc.id,
              make: doc.make,
              title: doc.title,
              page: prov.page,
              snippet: prov.quote ?? r.description,
            });
          }
          const cite = doc && prov.page
            ? ` [source: "${doc.title}" p.${prov.page}]`
            : r.citation
              ? ` [cited: ${r.citation}]`
              : ' [NO CITATION — cannot be audited]';
          // design rules are decided once per template; content rules run per ad.
          // Worth telling the model, because "why didn't this block my ad" usually
          // has that distinction as its answer.
          return `- (${r.severity}, ${ruleScope(r)}) ${r.id} [${r.kind}]: ${r.description}${cite}`;
        });
        if (!accepted.length) {
          return ok(
            `${header}\n\nNo REVIEWED rules — nothing is enforced automatically for ` +
              `${pack.make} today.${pending}`,
          );
        }
        return ok(
          `${header}\n${accepted.length} reviewed rule(s):\n${rules.join('\n')}${pending}`,
          ruleCitations,
        );
      }

      case 'list_sales_events': {
        const make = typeof input.make === 'string' ? input.make : undefined;
        const events = await listEventAssets(make);
        if (!events.length) {
          return ok(
            make
              ? `No sales events are on file for ${make}.`
              : 'No sales events are on file for any manufacturer.',
          );
        }
        const now = new Date();
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const lines = events.map((e) => {
          const live = coversDate(e, now);
          const scope = e.offerTypes.length ? e.offerTypes.join(', ') : 'all offer types';
          return (
            `- ${e.make} — "${e.name}" ${fmt(e.effectiveFrom)} to ${fmt(e.effectiveTo)}` +
            ` (${live ? 'LIVE NOW' : 'not currently running'}, ` +
            `${e.required ? 'mark REQUIRED' : 'mark optional'}, ${scope})`
          );
        });
        // Dates are the whole point of this tool, and a model has no clock.
        return ok(`Today is ${fmt(now)}.\n${events.length} sales event(s):\n${lines.join('\n')}`);
      }

      case 'list_rule_pack_coverage': {
        const packs = await listCoopPacks();
        if (!packs.length) {
          return ok('No rule packs have been transcribed for any make.');
        }
        const lines = packs.map(
          (p) =>
            `- ${p.make} v${p.version}: ${p.ruleCount} rules, ` +
            `${p.verified ? 'verified' : 'UNVERIFIED'}` +
            (p.uncitedRuleCount ? `, ${p.uncitedRuleCount} without a citation` : '') +
            (p.isActive ? '' : ', inactive'),
        );
        return ok(`${packs.length} rule pack(s):\n${lines.join('\n')}`);
      }

      default:
        return fail(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    // A tool failure is data for the model, not a crash: it can try another
    // approach or tell the user what it couldn't reach.
    return fail(err instanceof Error ? err.message : 'Tool failed.');
  }
}


/**
 * What a co-op tool call is doing, in a sentence a dealer would recognise.
 *
 * Written for the person waiting, not for a log: "Searching the guidelines" says
 * what is happening; "search_guidelines" says what function is running, which is
 * only interesting to us.
 */
export function describeCoopTool(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const make = typeof input.make === 'string' ? input.make : null;
  const query = typeof input.query === 'string' ? input.query : null;

  switch (toolName) {
    case 'list_guideline_docs':
      return make ? `Checking what's on file for ${make}` : "Checking which documents are on file";
    case 'search_guidelines':
      return query
        ? `Searching ${make ? `${make}'s guidelines` : 'the guidelines'} for “${query}”`
        : 'Searching the guidelines';
    case 'read_guideline_pages': {
      const pages = Array.isArray(input.pages) ? input.pages.length : 0;
      return pages ? `Reading ${pages} page${pages === 1 ? '' : 's'} in detail` : 'Reading the document';
    }
    case 'get_rule_pack':
      return make ? `Looking up what's enforced for ${make}` : 'Looking up the enforced rules';
    case 'list_rule_pack_coverage':
      return 'Checking which brands have enforced rules';
    case 'list_sales_events':
      return make ? `Checking ${make} sales events` : 'Checking sales events';
    default:
      return null;
  }
}
