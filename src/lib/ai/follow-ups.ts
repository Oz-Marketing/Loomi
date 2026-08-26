/**
 * Suggested follow-up questions, generated after an answer lands.
 *
 * A separate, cheap call rather than something the specialist emits itself, for
 * three reasons:
 *
 *  - The specialist answers in markdown so it can be read. Wrapping that in JSON to
 *    carry a suggestions array would mean parsing prose out of a structure, and a
 *    malformed wrapper would cost the user the whole answer rather than three chips.
 *  - It runs AFTER the answer is already on screen, so its latency is invisible.
 *  - Haiku is the right size for "read this and propose three next questions", at a
 *    fraction of the cost of the model that did the actual work.
 *
 * Failure is silent by design: no suggestions is a normal state, and an error here
 * must never surface as a problem with an answer that was perfectly good.
 */

import { getAnthropicClient, anthropicConfigured, lastTextBlock, parseAiJson } from '@/lib/anthropic';

/** Cheap and fast — this is a formatting task, not a reasoning one. */
const FOLLOW_UP_MODEL = 'claude-haiku-4-5';
const MAX_SUGGESTIONS = 3;
/** Long enough to be a real question, short enough to read as a chip. */
const MAX_CHARS = 60;

const SYSTEM = `You propose follow-up questions for a user talking to a specialist assistant inside a marketing platform.

Rules:
- Return 2-3 questions the USER would plausibly ask NEXT, written in the user's voice ("Can I...", "What about...", "Show me...").
- Each must be answerable by the same assistant, and must follow naturally from what was just said — pick up on specifics it mentioned (a make, a document, a gap it flagged), never generic filler like "Tell me more".
- Under 60 characters each. No numbering, no trailing whitespace.
- If the answer was a refusal, an error, or left nothing worth pursuing, return an empty array.

Return ONLY a JSON array of strings. No prose, no code fences.`;

export async function suggestFollowUps(
  question: string,
  answer: string,
): Promise<string[]> {
  if (!anthropicConfigured()) return [];
  // Nothing worth building on — and an empty answer usually means something failed.
  if (answer.trim().length < 40) return [];

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: FOLLOW_UP_MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `They asked:\n${question}\n\nThe assistant answered:\n${answer.slice(0, 4000)}`,
        },
      ],
    });

    const raw = lastTextBlock(response);
    if (!raw) return [];
    const parsed = parseAiJson(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= MAX_CHARS)
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    // See the header: no suggestions is a normal outcome.
    return [];
  }
}
