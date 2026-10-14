import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic';

/**
 * The one model call shape drafting uses: streamed, adaptive thinking,
 * structured output, and every way a reply can come back unusable turned into
 * an error a person can act on before anything parses it.
 *
 * Streamed because the SDK refuses a non-streaming request whose max_tokens
 * could outrun its HTTP ceiling, and reading a tall creative at high effort can.
 */

/**
 * Opus 5.5 for both passes. Reading 6pt legal text off a JPEG and writing copy
 * that survives the fact check are both accuracy-bound, and a draft is made a
 * handful of times a day. A separate constant from ANTHROPIC_MODEL so moving
 * drafting doesn't move the ad copywriter. Like Opus 5: no temperature, no
 * budget_tokens, and the first content block is thinking, not the answer.
 */
export const DRAFTING_MODEL = 'claude-opus-5-5';

/** Thinking is billed against this same ceiling. */
const MAX_REPLY_TOKENS = 32000;

export async function structuredCall<T>(input: {
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  effort: 'medium' | 'high';
  /** For error messages: "reading the creative". */
  task: string;
}): Promise<T> {
  const message = await getAnthropicClient()
    .messages.stream(
      {
        model: DRAFTING_MODEL,
        max_tokens: MAX_REPLY_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: input.effort, format: { type: 'json_schema', schema: input.schema } },
        system: input.system,
        messages: [{ role: 'user', content: input.content }],
      },
      { timeout: 10 * 60 * 1000 },
    )
    .finalMessage();

  if (message.stop_reason === 'max_tokens') {
    throw new Error(`The model ran out of room while ${input.task} (thinking counts toward the ceiling).`);
  }
  if (message.stop_reason === 'refusal') {
    throw new Error(`The model declined while ${input.task}.`);
  }
  // Never content[0]: thinking is on, so the first block is a thinking block.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error(`The model returned nothing while ${input.task}.`);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`The model's reply while ${input.task} wasn't valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Short and stable, for `DraftVersion.promptHash`. */
export function promptHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}
