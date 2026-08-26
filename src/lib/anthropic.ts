import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Is a key configured?
 *
 * For callers that must DECIDE whether to use AI rather than assume it — an
 * unattended job can't let a missing key throw, and "no key" is a legitimate
 * environment (local dev, a self-hosted install) rather than an error.
 */
export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * The default model for every AI feature.
 *
 * Opus 5. Three things about this family that callers MUST honour, each of which
 * fails loudly (400) or silently (empty output) if ignored:
 *
 *  1. `temperature` / `top_p` / `top_k` are REJECTED. Steering is the prompt plus
 *     `output_config.effort` — there is no sampling knob any more.
 *  2. `budget_tokens` is REJECTED. Thinking is `{ type: 'adaptive' }`, and on Opus 5
 *     it is ON BY DEFAULT — omitting `thinking` still thinks, unlike Opus 4.7.
 *  3. Because thinking is on, `content[0]` is a THINKING block, not the answer.
 *     Read the reply with {@link lastTextBlock}; indexing content[0] yields '' and
 *     every downstream JSON parse fails with a misleading "response was empty".
 *
 * Thinking tokens count against `max_tokens`, so a caller that used to want ~500
 * tokens of JSON needs real headroom now — budget for the thinking, and use
 * `output_config.effort` to keep short mechanical calls cheap.
 */
export const ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * The model for tool-orchestrating assistants — the flow builder's Loomi AI, the
 * landing-page assistant — where one turn plans and executes several tool calls.
 *
 * Now the same model as {@link ANTHROPIC_MODEL}; kept as a separate export because
 * these callers are the ones we would move first if we ever wanted a different tier
 * for agentic work, and the call sites read better naming the intent.
 */
export const ANTHROPIC_FLOW_MODEL = 'claude-opus-5';

/**
 * The model's answer text, ignoring thinking blocks.
 *
 * The LAST non-empty text block, not the first: a turn can emit text before a tool
 * call and again after it, and it's the final one that is the reply. With thinking
 * enabled the first block is never the answer, which is why reading `content[0]`
 * broke everywhere when we moved off Sonnet 4.5.
 */
export function lastTextBlock(message: Anthropic.Message): string {
  let text = '';
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim()) text = block.text;
  }
  return text;
}

// Opus 5 for compliance drafting — transcribing manufacturer co-op guidelines into
// machine-checkable rules and disclaimer bodies. A SEPARATE constant from
// ANTHROPIC_MODEL on purpose: that one is shared with the ad copywriter, and the
// tradeoff here is the opposite of copy's. This runs a few dozen times ever, over
// dense legal prose, where a misread clause costs a brand its month of ads — so
// accuracy dominates and cost is irrelevant. Opus 5 rejects temperature/top_p and
// budget_tokens; use adaptive thinking + output_config.effort instead.
export const ANTHROPIC_COMPLIANCE_MODEL = 'claude-opus-5';

/** Attempt to parse JSON from an AI response, stripping markdown fences if needed. */
export function parseAiJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Claude sometimes wraps JSON in markdown fences despite instructions
    const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
    throw new Error('AI response was not valid JSON');
  }
}
