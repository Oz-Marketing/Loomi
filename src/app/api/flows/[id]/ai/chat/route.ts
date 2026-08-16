import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { requirePermission } from '@/lib/permissions/require';
import { getFlow } from '@/lib/services/loomi-flows';
import { ANTHROPIC_FLOW_MODEL, getAnthropicClient } from '@/lib/anthropic';
import {
  FLOW_AI_SYSTEM_PROMPT,
  FLOW_AI_TOOLS,
  createWorkingGraph,
  executeFlowTool,
  type FlowAiAction,
  type FlowSnapshot,
} from '@/lib/ai/flow-tools';

// Cap the tool-use loop so a runaway model can't burn the budget. In
// practice "build a 5-step flow" lands in 8-10 iterations; we cushion
// past that without going wild.
const MAX_LOOP_ITERATIONS = 16;

interface ChatRequestBody {
  /** Conversation so far, in the order the user typed it. */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Current builder state — used as the AI's view of the graph. */
  snapshot?: FlowSnapshot;
}

interface ChatResponseBody {
  reply: string;
  actions: FlowAiAction[];
}

function accountScope(session: {
  user: { role: string; accountKeys?: string[] };
}): string[] | null {
  if (session.user.role === 'client' || session.user.role === 'admin') {
    return session.user.accountKeys ?? [];
  }
  return null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.flows.edit');
  if (error) return error;

  const { id } = await context.params;
  // Verify the caller can see this flow at all before we let the AI
  // touch it. We don't trust the client snapshot beyond this gate —
  // the user can still describe graphs that contradict the snapshot,
  // but they can only act on a flow they're allowed to act on.
  const existing = await getFlow(id, accountScope(session!));
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }
  if (!body.snapshot || typeof body.snapshot !== 'object') {
    return NextResponse.json({ error: 'snapshot is required' }, { status: 400 });
  }

  // Anchor the working snapshot to this flow's real id + status, even if
  // the client's payload says otherwise.
  const snapshot: FlowSnapshot = {
    flowId: id,
    status: existing.status,
    accountKey: existing.accountKey,
    nodes: Array.isArray(body.snapshot.nodes) ? body.snapshot.nodes : [],
    edges: Array.isArray(body.snapshot.edges) ? body.snapshot.edges : [],
    triggers: Array.isArray(body.snapshot.triggers) ? body.snapshot.triggers : [],
  };

  const graph = createWorkingGraph(snapshot);
  const actions: FlowAiAction[] = [];

  const client = getAnthropicClient();

  // Conversation is the running `messages` array we send to Claude. We
  // append (a) the user's text turns, (b) assistant turns (which may
  // contain tool_use blocks), and (c) tool_result user turns. The model
  // sees the same shape across iterations of the loop.
  const conversation: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalReply = '';

  for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
    let response;
    try {
      response = await client.messages.create({
        model: ANTHROPIC_FLOW_MODEL,
        max_tokens: 16000,
        // Opus 4.7 supports adaptive thinking but only with display: "summarized"
        // if we want to surface it. We don't surface thinking to the user (yet),
        // so leave the default — keeps response bytes small.
        thinking: { type: 'adaptive' },
        system: FLOW_AI_SYSTEM_PROMPT,
        tools: FLOW_AI_TOOLS,
        messages: conversation,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI call failed';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Append the assistant turn verbatim so subsequent iterations carry the
    // tool_use blocks the next user (tool_result) turn references.
    conversation.push({ role: 'assistant', content: response.content });

    // Collect any text the model emitted this iteration — last non-empty wins
    // as `finalReply`. Tool-only turns leave it untouched.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        finalReply = block.text;
      }
    }

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    // Execute every tool_use in this turn, in order, and feed all results
    // back in a single user turn — that's the shape the API expects.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const result = executeFlowTool(
        graph,
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
      );
      if (result.action) actions.push(result.action);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.resultText,
        is_error: result.isError,
      });
    }

    conversation.push({ role: 'user', content: toolResults });
  }

  if (!finalReply) {
    finalReply = actions.length
      ? `Done — applied ${actions.length} change${actions.length === 1 ? '' : 's'}.`
      : "I'm not sure what to do with that. Could you say more?";
  }

  const payload: ChatResponseBody = { reply: finalReply, actions };
  return NextResponse.json(payload);
}
