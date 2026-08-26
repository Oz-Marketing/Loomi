import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { requirePermission } from '@/lib/permissions/require';
import { getFlow } from '@/lib/services/loomi-flows';
import { ANTHROPIC_FLOW_MODEL } from '@/lib/anthropic';
import { runAgent, AgentRunError, type AgentSpec } from '@/lib/ai/agent-runtime';
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

  // The working graph is per-request state the tools mutate, so the spec is built
  // here rather than hoisted to module scope: each caller gets its own graph, and
  // two concurrent flow edits can never share one.
  const graph = createWorkingGraph(snapshot);

  const spec: AgentSpec<FlowAiAction> = {
    key: 'flow-builder',
    model: ANTHROPIC_FLOW_MODEL,
    maxTokens: 16000,
    maxIterations: MAX_LOOP_ITERATIONS,
    systemPrompt: FLOW_AI_SYSTEM_PROMPT,
    tools: FLOW_AI_TOOLS,
    execute: (toolName, input) => {
      const result = executeFlowTool(graph, toolName, input);
      return {
        resultText: result.resultText,
        isError: result.isError,
        emit: result.action,
      };
    },
    fallbackReply: (actions) =>
      actions.length
        ? `Done — applied ${actions.length} change${actions.length === 1 ? '' : 's'}.`
        : "I'm not sure what to do with that. Could you say more?",
  };

  const conversation: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const run = await runAgent(spec, conversation);
    const payload: ChatResponseBody = { reply: run.reply, actions: run.emitted };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AgentRunError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
