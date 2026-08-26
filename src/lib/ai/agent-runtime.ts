/**
 * The agent loop, once, for every specialist.
 *
 * A "specialist" is an assistant that owns one realm of Loomi — the flow builder's
 * Iris, the co-op expert, the email producer. They differ in their brief, their
 * tools and how hard they think; they do NOT differ in how the tool-use loop runs.
 * That loop lived inline in the flow builder's route, which meant the second
 * specialist would have copied it, and the third would have copied a copy.
 *
 * What a caller supplies is an {@link AgentSpec}: a system prompt, a tool list, and
 * an executor. What it gets back is the reply plus whatever the executor chose to
 * emit — graph edits for the flow builder, citations for the co-op specialist.
 * The runtime never knows what those are, which is the point: `TEmit` is the seam
 * that lets one loop serve specialists that produce completely different artifacts.
 *
 * Three things are deliberately handled HERE rather than per specialist, because
 * each is easy to get wrong once per copy:
 *
 *  - **Caching.** The system prompt and tool list are the stable prefix of every
 *    turn, so the runtime marks them cacheable. Anything volatile (the account, the
 *    page, today's date) belongs in the MESSAGES, after the breakpoint — a
 *    specialist that interpolates the date into its system prompt silently pays
 *    full price on every call. See docs/specialist-agents.md.
 *  - **Reading the reply.** Thinking is on by default on this model family, so the
 *    answer is the last text block, never `content[0]`.
 *  - **Bounding the spend.** A runaway model that keeps calling tools is capped by
 *    iteration count, and usage is summed so cost is attributable per specialist
 *    rather than arriving as one line on the Anthropic bill.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, ANTHROPIC_MODEL } from '@/lib/anthropic';

/** Effort levels the SDK accepts today. Higher = deeper thinking, more tokens. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'max';

/**
 * One tool call's outcome.
 *
 * `resultText` is what the MODEL sees next turn; `emit` is what the USER's client
 * sees. They are separate because the useful thing to tell the model ("node added")
 * is rarely the useful thing to hand the UI (the actual node).
 */
export interface AgentToolResult<TEmit = never> {
  /** Returned to the model as the tool_result content. */
  resultText: string;
  /** True when the tool reported an error; the model sees `is_error: true`. */
  isError: boolean;
  /** Surfaced to the caller alongside the reply. Omit for read-only tools. */
  emit?: TEmit;
}

/**
 * Something the agent just did, as it happens.
 *
 * The point is honesty: a spinner that says "Thinking..." for twenty seconds is
 * indistinguishable from a hang, and it tells the user nothing about whether the
 * answer is going to be any good. A trail of "searching the Chevrolet guidelines
 * for 'brandmark'" is both a progress bar and a preview of the reasoning — and
 * when the answer is wrong, it's the first clue why.
 *
 * These describe REAL tool calls, never invented flavour text.
 */
export type AgentProgressEvent =
  | { type: 'thinking' }
  | { type: 'tool'; label: string }
  | { type: 'writing' };

export interface AgentSpec<TEmit = never> {
  /** Stable identifier, used for logging and cost attribution. */
  key: string;
  /** Defaults to {@link ANTHROPIC_MODEL}. */
  model?: string;
  /**
   * How hard this specialist thinks. Co-op and other advisory specialists want
   * 'high'; mechanical ones want 'low'. Omit to leave the API default.
   */
  effort?: AgentEffort;
  maxTokens?: number;
  /**
   * Cap on request round-trips. A specialist that builds things needs more than one
   * that answers questions; both need a ceiling.
   */
  maxIterations?: number;
  /** The brief. Must be STABLE across turns — see the caching note above. */
  systemPrompt: string;
  tools: Anthropic.Tool[];
  /**
   * Run one tool call. May be async: most specialists' tools read Postgres.
   *
   * Every implementation is responsible for its own permission and account-scope
   * checks. The runtime deliberately does not do this for you — it has no idea what
   * a given tool touches, and a check it can't understand is a check it would get
   * wrong.
   */
  execute(
    toolName: string,
    input: Record<string, unknown>,
  ): AgentToolResult<TEmit> | Promise<AgentToolResult<TEmit>>;
  /**
   * The reply to use when the model ends its turn having said nothing — it happens
   * when a turn is entirely tool calls. Gets what was emitted so the fallback can be
   * specific ("applied 3 changes") rather than apologetic.
   */
  fallbackReply?(emitted: TEmit[]): string;
  /**
   * One short phrase for a tool call, in the user's language — "Searching the
   * guidelines for 'lease'", not "search_guidelines({query:'lease'})".
   *
   * On the SPEC rather than the runtime because only the specialist knows what its
   * own tools mean. Omit it and the trail simply shows nothing for that call.
   */
  describeToolCall?(toolName: string, input: Record<string, unknown>): string | null;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentRunResult<TEmit> {
  reply: string;
  emitted: TEmit[];
  /** Round-trips used. Equal to `maxIterations` means the loop was truncated. */
  iterations: number;
  /** True when the answer is INCOMPLETE — see {@link AgentRunResult.truncationReason}. */
  truncated: boolean;
  /**
   * Why the run ended early, when it did.
   *
   * `iterations` — the loop hit its cap with the model still calling tools.
   * `max_tokens` — the model ran out of room mid-answer. Thinking tokens count
   * against `max_tokens`, so this is easy to hit on a specialist set to high
   * effort with a modest cap, and it surfaces downstream as mangled output rather
   * than as an error. Callers must not treat a truncated reply as a complete one.
   */
  truncationReason?: 'iterations' | 'max_tokens';
  usage: AgentUsage;
}

/**
 * An upstream failure talking to Claude, as distinct from a bug in a tool.
 *
 * Routes map this to a 502: the caller's request was fine, our dependency wasn't.
 * Mirrors `EmailAssistantError`.
 */
export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunError';
  }
}

const DEFAULT_MAX_ITERATIONS = 16;
const DEFAULT_MAX_TOKENS = 16000;

/**
 * The last non-empty text block — the reply.
 *
 * Not `content[0]`: with thinking enabled the first block is a thinking block, and
 * a turn may emit text both before and after a tool call, where the final one wins.
 */
function replyText(content: Anthropic.ContentBlock[], current: string): string {
  let reply = current;
  for (const block of content) {
    if (block.type === 'text' && block.text.trim()) reply = block.text;
  }
  return reply;
}

export async function runAgent<TEmit = never>(
  spec: AgentSpec<TEmit>,
  messages: Anthropic.MessageParam[],
  onEvent?: (event: AgentProgressEvent) => void,
): Promise<AgentRunResult<TEmit>> {
  const client = getAnthropicClient();
  const maxIterations = spec.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // The running conversation: user turns, assistant turns (which may carry
  // tool_use blocks), and tool_result user turns. Cloned so a caller's array is
  // never mutated underneath it.
  const conversation: Anthropic.MessageParam[] = [...messages];
  const emitted: TEmit[] = [];
  const usage: AgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  let reply = '';
  let iterations = 0;
  let truncated = false;
  let truncationReason: AgentRunResult<TEmit>['truncationReason'];

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    onEvent?.({ type: 'thinking' });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: spec.model ?? ANTHROPIC_MODEL,
        max_tokens: spec.maxTokens ?? DEFAULT_MAX_TOKENS,
        // Adaptive is the only on-mode for this family. Display is left at its
        // default ("omitted") — we don't surface reasoning to users yet.
        thinking: { type: 'adaptive' },
        ...(spec.effort ? { output_config: { effort: spec.effort } } : {}),
        // Marked cacheable: this block plus `tools` is the stable prefix of every
        // turn in the conversation, and re-reading it is ~10% the cost of re-sending
        // it. Volatile context must live in `messages`, after this point.
        system: [
          {
            type: 'text',
            text: spec.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: spec.tools,
        messages: conversation,
      });
    } catch (err) {
      throw new AgentRunError(err instanceof Error ? err.message : 'AI call failed');
    }

    usage.inputTokens += response.usage.input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens ?? 0;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;

    // Append the assistant turn verbatim: the next (tool_result) turn references
    // the tool_use blocks inside it by id, so nothing here may be reshaped.
    conversation.push({ role: 'assistant', content: response.content });
    reply = replyText(response.content, reply);

    if (response.stop_reason !== 'tool_use') {
      onEvent?.({ type: 'writing' });
      // Ran out of room mid-answer. Reported rather than swallowed: a half-written
      // reply is indistinguishable from a complete one to everything downstream.
      if (response.stop_reason === 'max_tokens') {
        truncated = true;
        truncationReason = 'max_tokens';
      }
      break;
    }

    // Every tool_use in this turn runs, and ALL results go back in a single user
    // turn — splitting them across turns is malformed, and teaches the model to
    // stop calling tools in parallel.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const label = spec.describeToolCall?.(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
      );
      // Announced BEFORE the call runs: a tool that takes two seconds should show
      // what it's doing while it does it, not after it finishes.
      if (label) onEvent?.({ type: 'tool', label });
      const result = await spec.execute(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
      );
      if (result.emit !== undefined) emitted.push(result.emit);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.resultText,
        is_error: result.isError,
      });
    }
    conversation.push({ role: 'user', content: toolResults });

    // Ran the last iteration and the model still wants tools: say so rather than
    // returning a half-finished turn as if it were complete.
    if (iter === maxIterations - 1) {
      truncated = true;
      truncationReason = 'iterations';
    }
  }

  if (!reply) {
    reply =
      spec.fallbackReply?.(emitted) ??
      "I'm not sure what to do with that. Could you say more?";
  }

  return { reply, emitted, iterations, truncated, truncationReason, usage };
}
