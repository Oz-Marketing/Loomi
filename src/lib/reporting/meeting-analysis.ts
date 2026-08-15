/**
 * The written analysis on the Ad Meeting deliverable.
 *
 * Oz Dealer Tools had the same idea (`POST ad-meeting/analyze`): a paragraph or
 * two a rep can read before walking into a client meeting, written from the
 * numbers rather than by them.
 *
 * ── MODEL CHOICE ────────────────────────────────────────────────────────────
 * Opus, not the app-wide `ANTHROPIC_MODEL` (Sonnet). This output is read aloud
 * to a paying client and is the one part of the deliverable nobody proofreads
 * against a source — the quality difference is worth the tokens on a document
 * generated a handful of times a month, not per request.
 *
 * The installed SDK (0.78.0) predates this model, but `Model` ends in
 * `(string & {})` so the ID passes through fine — the same reason
 * `ANTHROPIC_FLOW_MODEL` already works. What the old SDK does NOT carry is
 * typed `stop_details` or the server-side `fallbacks` parameter, so a refusal
 * is handled here by hand (below) instead of being retried on a fallback model
 * by the API. Bumping the SDK is what unlocks that.
 *
 * ── PARAMETERS ──────────────────────────────────────────────────────────────
 * Adaptive thinking, no sampling parameters — this model family rejects
 * `temperature`/`top_p`/`top_k` and `budget_tokens` outright. `max_tokens` caps
 * thinking AND prose together, so it carries headroom well beyond the ~600
 * words we actually want back, and the call streams so the large ceiling can't
 * trip the SDK's HTTP timeout.
 *
 * ── PROMPTING ───────────────────────────────────────────────────────────────
 * Three instructions below exist because of documented behaviour in this model
 * family, not as boilerplate: it writes longer than asked unless told
 * otherwise, it widens scope unless the boundary is stated, and it will happily
 * verify its own work at length if invited to — so nothing here asks it to
 * double-check anything.
 */
import { getAnthropicClient } from '@/lib/anthropic';
import type { ReportDoc } from './report-doc';

/**
 * Opus for the client-facing narrative. Kept local rather than added to
 * lib/anthropic.ts because it is this report's editorial choice, not an
 * app-wide default.
 */
export const MEETING_ANALYSIS_MODEL = 'claude-opus-5';

/** Thinking shares this ceiling with the prose, hence the headroom. */
const MAX_TOKENS = 8_000;

export class AnalysisUnavailable extends Error {
  constructor(
    message: string,
    public code: 'not_configured' | 'refused' | 'empty' | 'error',
  ) {
    super(message);
    this.name = 'AnalysisUnavailable';
  }
}

const SYSTEM = `You write the opening analysis for a car dealership's monthly marketing review. An account manager reads it minutes before sitting down with the dealer.

Ground every claim in the figures you are given. Never state a number that is not in the data, never estimate one that is missing, and never describe a channel that is not listed. If the data is too thin to support a point, leave the point out.

Lead with what actually happened this period. Then what is working, what is not, and what you would do next. Name specific channels and figures rather than talking in generalities.

Write 3 to 5 short paragraphs of plain prose. No headings, no bullet points, no markdown, no preamble, no sign-off — the first sentence is the first thing the reader sees. Keep it tight enough to read in under a minute: pick the few things that matter rather than covering everything.

Write for a dealer, not a marketer. Spell out jargon or drop it. Be straight about disappointing results — this is read by someone who already knows how their month went, and a report that only finds good news is one they stop trusting.

Some sources may be missing from the data; the document says which. Do not speculate about what they would have shown, and do not treat a missing channel as a channel that performed badly.`;

/**
 * Everything the model is allowed to see. Deliberately the finished document
 * rather than the raw platform payloads: whatever reaches the client is exactly
 * what the analysis was written from, so the prose can never cite a figure the
 * reader cannot find on the page.
 */
function userPrompt(doc: ReportDoc): string {
  return [
    `Account: ${doc.title}`,
    doc.subtitle ? `Period: ${doc.subtitle}` : '',
    '',
    'Headline figures:',
    ...(doc.kpis ?? []).map(
      (k) => `- ${k.label}: ${k.value}${k.secondary ? ` (${k.secondary})` : ''}`,
    ),
    '',
    ...doc.sections.flatMap((s) => [
      `${s.title}:`,
      s.columns.map((c) => c.header).join(' | '),
      ...s.rows.map((r) => r.map((cell) => String(cell)).join(' | ')),
      '',
    ]),
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

export async function generateMeetingAnalysis(doc: ReportDoc): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnalysisUnavailable(
      'Claude is not configured on the server (set ANTHROPIC_API_KEY).',
      'not_configured',
    );
  }

  // Don't spend a call on a document with nothing in it — an analysis of an
  // empty report is exactly the kind of confident nothing this must not emit.
  const hasContent = doc.sections.some(
    (s) => s.title !== 'Not included' && s.rows.length > 0,
  );
  if (!hasContent) {
    throw new AnalysisUnavailable(
      'There is not enough data in this range to write an analysis.',
      'empty',
    );
  }

  const client = getAnthropicClient();

  let message;
  try {
    // Streaming because MAX_TOKENS is high enough that a non-streaming request
    // can outlive the SDK's HTTP timeout — the same reason lp-assistant streams.
    const stream = client.messages.stream({
      model: MEETING_ANALYSIS_MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive only. This family rejects budget_tokens and every sampling
      // parameter, so the prompt is the whole steering surface.
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(doc) }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw new AnalysisUnavailable(
      err instanceof Error ? err.message : 'Claude could not be reached.',
      'error',
    );
  }

  // Check the stop reason BEFORE reading content: a refusal can arrive with an
  // empty or partial content array, and indexing it would surface as a blank
  // analysis rather than as the refusal it is.
  if (message.stop_reason === 'refusal') {
    throw new AnalysisUnavailable(
      'Claude declined to write this analysis. Export the document without it.',
      'refused',
    );
  }

  // With thinking on, the prose is in the text blocks — thinking blocks come
  // first and must not be concatenated into the output.
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new AnalysisUnavailable(
      message.stop_reason === 'max_tokens'
        ? 'The analysis ran out of room before any prose was written.'
        : 'Claude returned an empty analysis.',
      'empty',
    );
  }

  return text;
}
