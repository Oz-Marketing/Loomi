import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

// One fake `messages.create` shared by every test; each test queues the turns it
// wants the model to "return". Mocking at the module boundary keeps the runtime
// under test unmodified — no injectable-client seam invented just for tests.
const create = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create } }),
  ANTHROPIC_MODEL: 'test-model',
}));

const { runAgent, AgentRunError } = await import('./agent-runtime');

/** A finished turn: some text, no tool calls. */
function textTurn(text: string, usage: Partial<Anthropic.Usage> = {}) {
  return {
    content: [
      // Thinking block FIRST — this family thinks by default, and reading
      // content[0] instead of the last text block is the bug this guards.
      { type: 'thinking', thinking: 'reasoning...' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0, ...usage },
  };
}

/** A turn that calls one or more tools. */
function toolTurn(calls: Array<{ id: string; name: string; input?: unknown }>) {
  return {
    content: calls.map((c) => ({
      type: 'tool_use',
      id: c.id,
      name: c.name,
      input: c.input ?? {},
    })),
    stop_reason: 'tool_use',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

const NO_TOOLS: Anthropic.Tool[] = [];

function spec(overrides: Record<string, unknown> = {}) {
  return {
    key: 'test',
    systemPrompt: 'You are a test specialist.',
    tools: NO_TOOLS,
    execute: () => ({ resultText: 'ok', isError: false }),
    ...overrides,
  } as Parameters<typeof runAgent>[0];
}

beforeEach(() => create.mockReset());

describe('runAgent', () => {
  it('reads the reply from the last text block, not content[0]', async () => {
    create.mockResolvedValueOnce(textTurn('the answer'));
    const run = await runAgent(spec(), [{ role: 'user', content: 'hi' }]);
    expect(run.reply).toBe('the answer');
  });

  it('prefers a later text block over an earlier one in the same turn', async () => {
    create.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'let me check that' },
        { type: 'text', text: 'here is what I found' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const run = await runAgent(spec(), [{ role: 'user', content: 'hi' }]);
    expect(run.reply).toBe('here is what I found');
  });

  it('runs the tool loop and collects what the executor emits', async () => {
    create
      .mockResolvedValueOnce(toolTurn([{ id: 't1', name: 'add_thing' }]))
      .mockResolvedValueOnce(textTurn('added it'));

    const run = await runAgent(
      spec({
        execute: () => ({ resultText: 'added', isError: false, emit: { kind: 'added' } }),
      }),
      [{ role: 'user', content: 'add a thing' }],
    );

    expect(run.reply).toBe('added it');
    expect(run.emitted).toEqual([{ kind: 'added' }]);
    expect(run.iterations).toBe(2);
    expect(run.truncated).toBe(false);
  });

  it('returns every tool_result from one turn in a SINGLE user message', async () => {
    create
      .mockResolvedValueOnce(
        toolTurn([
          { id: 't1', name: 'a' },
          { id: 't2', name: 'b' },
        ]),
      )
      .mockResolvedValueOnce(textTurn('done'));

    await runAgent(spec(), [{ role: 'user', content: 'go' }]);

    // Second request carries: original user turn, the assistant turn, then ONE
    // user turn holding both results. Splitting them is malformed and teaches
    // the model to stop calling tools in parallel.
    const secondCall = create.mock.calls[1][0];
    const toolResultTurns = secondCall.messages.filter(
      (m: Anthropic.MessageParam) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b: { type: string }) => b.type === 'tool_result'),
    );
    expect(toolResultTurns).toHaveLength(1);
    expect(toolResultTurns[0].content).toHaveLength(2);
    expect(toolResultTurns[0].content.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual([
      't1',
      't2',
    ]);
  });

  it('passes tool errors back to the model rather than throwing', async () => {
    create
      .mockResolvedValueOnce(toolTurn([{ id: 't1', name: 'boom' }]))
      .mockResolvedValueOnce(textTurn('recovered'));

    const run = await runAgent(
      spec({ execute: () => ({ resultText: 'no such node', isError: true }) }),
      [{ role: 'user', content: 'go' }],
    );

    // Locate the tool_result turn by shape, not position: the conversation array
    // is passed by reference, so by assertion time it also holds the final
    // assistant turn.
    const sent = create.mock.calls[1][0].messages;
    const resultBlock = sent
      .flatMap((m: Anthropic.MessageParam) =>
        Array.isArray(m.content) ? m.content : [],
      )
      .find((b: { type: string }) => b.type === 'tool_result');
    expect(resultBlock.is_error).toBe(true);
    expect(resultBlock.content).toBe('no such node');
    expect(run.reply).toBe('recovered');
  });

  it('caps the loop and reports truncation', async () => {
    // Always wants another tool call — the runaway case the cap exists for.
    create.mockResolvedValue(toolTurn([{ id: 't1', name: 'again' }]));

    const run = await runAgent(spec({ maxIterations: 3 }), [
      { role: 'user', content: 'go' },
    ]);

    expect(create).toHaveBeenCalledTimes(3);
    expect(run.iterations).toBe(3);
    expect(run.truncated).toBe(true);
    expect(run.truncationReason).toBe('iterations');
  });

  it('reports a reply cut short by max_tokens rather than passing it off as complete', async () => {
    // Thinking counts against max_tokens, so a high-effort specialist with a modest
    // cap hits this — and downstream it looks like a normal (mangled) answer.
    create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Chevrolet requires that the brandmark be' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const run = await runAgent(spec(), [{ role: 'user', content: 'go' }]);
    expect(run.truncated).toBe(true);
    expect(run.truncationReason).toBe('max_tokens');
  });

  it('does not mark a normally-finished run as truncated', async () => {
    create.mockResolvedValueOnce(textTurn('all done'));
    const run = await runAgent(spec(), [{ role: 'user', content: 'go' }]);
    expect(run.truncated).toBe(false);
    expect(run.truncationReason).toBeUndefined();
  });

  it('uses the fallback reply when the model ends without saying anything', async () => {
    create.mockResolvedValueOnce({
      content: [{ type: 'text', text: '   ' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const run = await runAgent(
      spec({ fallbackReply: (emitted: unknown[]) => `applied ${emitted.length}` }),
      [{ role: 'user', content: 'go' }],
    );
    expect(run.reply).toBe('applied 0');
  });

  it('marks the system prompt cacheable and sends tools on every turn', async () => {
    create.mockResolvedValueOnce(textTurn('hi'));
    await runAgent(spec(), [{ role: 'user', content: 'hi' }]);

    const req = create.mock.calls[0][0];
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.system[0].text).toBe('You are a test specialist.');
    expect(req.tools).toBe(NO_TOOLS);
  });

  it('sums usage across every iteration, including cache tokens', async () => {
    create
      .mockResolvedValueOnce({
        ...toolTurn([{ id: 't1', name: 'a' }]),
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 7,
        },
      })
      .mockResolvedValueOnce(textTurn('done', { input_tokens: 3, output_tokens: 2 }));

    const run = await runAgent(spec(), [{ role: 'user', content: 'go' }]);

    expect(run.usage).toEqual({
      inputTokens: 13,
      outputTokens: 7,
      cacheReadTokens: 100,
      cacheWriteTokens: 7,
    });
  });

  it("never mutates the caller's messages array", async () => {
    create
      .mockResolvedValueOnce(toolTurn([{ id: 't1', name: 'a' }]))
      .mockResolvedValueOnce(textTurn('done'));

    const messages = [{ role: 'user' as const, content: 'go' }];
    await runAgent(spec(), messages);
    expect(messages).toHaveLength(1);
  });

  it('awaits async executors — most specialists read the database', async () => {
    create
      .mockResolvedValueOnce(toolTurn([{ id: 't1', name: 'lookup' }]))
      .mockResolvedValueOnce(textTurn('done'));

    const run = await runAgent(
      spec({
        execute: async () => {
          await Promise.resolve();
          return { resultText: 'from db', isError: false, emit: 'row' };
        },
      }),
      [{ role: 'user', content: 'go' }],
    );
    expect(run.emitted).toEqual(['row']);
  });

  it('wraps upstream API failures in AgentRunError', async () => {
    create.mockRejectedValueOnce(new Error('overloaded'));
    await expect(
      runAgent(spec(), [{ role: 'user', content: 'go' }]),
    ).rejects.toBeInstanceOf(AgentRunError);
  });
});
