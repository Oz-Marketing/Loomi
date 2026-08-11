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

export const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';

// Opus 4.7 for the flow builder's "Iris" assistant — the model
// orchestrates multi-tool graph edits (add node → connect → configure)
// in a single turn, where the extra reasoning headroom is worth it.
// Note: Opus 4.7 rejects temperature/top_p/top_k and budget_tokens —
// callers must use adaptive thinking + effort instead.
export const ANTHROPIC_FLOW_MODEL = 'claude-opus-4-7';

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
