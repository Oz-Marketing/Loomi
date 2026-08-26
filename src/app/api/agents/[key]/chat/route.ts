import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { requirePermission } from '@/lib/permissions/require';
import { anthropicConfigured } from '@/lib/anthropic';
import {
  runAgent,
  AgentRunError,
  type AgentSpec,
  type AgentProgressEvent,
} from '@/lib/ai/agent-runtime';
import { getSpecialist } from '@/lib/ai/specialists/registry';
import { agentIdentity } from '@/lib/ai/specialists/identity';
import { appendMessage } from '@/lib/ai/conversation-store';
import { attachmentBlocks, type WireAttachment } from '@/lib/ai/attachments';
import { suggestFollowUps } from '@/lib/ai/follow-ups';

/**
 * One route for every specialist.
 *
 * The specialist is chosen by URL segment and looked up in the code registry — a
 * client cannot describe a specialist, only name one that exists. That matters more
 * than it looks: the registry is where a specialist's PERMISSION lives, so an
 * unknown key must 404 rather than fall through to some default agent.
 *
 * The flow builder keeps its own route (api/flows/[id]/ai/chat) because its tools
 * mutate a per-request working graph that arrives in the request body. Everything
 * whose tools read shared state belongs here.
 */

interface ChatRequestBody {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Images and text files attached to the LAST user turn. */
  attachments?: WireAttachment[];
  /**
   * Persist this turn into a saved conversation. Optional: the panel can run
   * unsaved, and a failure to persist must never cost the user their answer.
   */
  conversationId?: string;
  /** Where the user is. Volatile, so it goes in the MESSAGES, never the system
   *  prompt — the system prompt is the cached prefix. */
  context?: { page?: string; accountKey?: string | null; accountName?: string | null };
}

const MAX_HISTORY = 20;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;
  const specialist = getSpecialist(key);
  if (!specialist) {
    return NextResponse.json({ error: 'No such specialist' }, { status: 404 });
  }

  const { session, error } = await requirePermission(specialist.permission);
  if (error) return error;

  if (!anthropicConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured in this environment.' },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
  const history = Array.isArray(body.messages) ? body.messages.slice(-MAX_HISTORY) : [];
  if (!history.length) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  const identity = agentIdentity(specialist.key);

  // Profiles are Phase 2; until then the code default is the profile. The seam is
  // here so that switching to a DB row is a one-line change.
  const profile = specialist.defaultProfile;

  const spec: AgentSpec<unknown> = {
    key: specialist.key,
    effort: specialist.effort,
    maxIterations: specialist.maxIterations,
    systemPrompt: specialist.buildSystemPrompt(profile),
    tools: specialist.tools,
    execute: specialist.execute,
    describeToolCall: specialist.describeToolCall,
    fallbackReply: () => `I couldn't find an answer to that. Could you rephrase it?`,
  };

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Attachments belong to the LAST user turn, and go BEFORE its text: the model
  // reads a document then the question about it far better than the reverse.
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachments.length) {
    const last = messages[messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : '';
    last.content = [
      ...(attachmentBlocks(attachments) as Anthropic.ContentBlockParam[]),
      // A turn can be attachment-only ("what's wrong with this ad?" is often just
      // the ad), and an empty text block is a 400.
      ...(text ? [{ type: 'text' as const, text }] : []),
    ];
  }

  // Volatile context rides as a system-role message in the conversation rather than
  // in `system`, so it can change every turn without invalidating the cached prefix.
  const where = body.context?.accountName
    ? `The user is on ${body.context.page ?? 'a Loomi page'}, working in the ${body.context.accountName} account.`
    : `The user is on ${body.context?.page ?? 'a Loomi page'}.`;
  messages.splice(messages.length - 1, 0, { role: 'user', content: where });

  // NDJSON rather than a single JSON body: the progress trail is only worth
  // anything if it arrives WHILE the agent works. One object per line, terminated
  // by a `done` — simpler than SSE and enough for a one-way stream.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

      const onEvent = (event: AgentProgressEvent) => send(event);

      try {
        const run = await runAgent(spec, messages, onEvent);
        const citations = run.emitted.flat();
        // Handed back so the client can anchor a rewind at an exact turn.
        let userMessageId: string | null = null;
        let assistantMessageId: string | null = null;

        // Persist AFTER the answer exists, and never let a storage failure surface
        // as a failed request: the user has their answer either way, and losing it
        // to a logging problem would be the worse outcome by far.
        if (body.conversationId) {
          const userTurn = history[history.length - 1];
          try {
            userMessageId = await appendMessage({
              userId: session!.user.id,
              conversationId: body.conversationId,
              role: 'user',
              // Note the attachments in the saved copy: a thread reopened later
              // that shows a question with no sign of the image it was about is
              // a thread nobody can interpret.
              content: attachments.length
                ? `${userTurn.content}\n\n[attached: ${attachments.map((a) => a.name).join(', ')}]`
                : userTurn.content,
            });
            assistantMessageId = await appendMessage({
              userId: session!.user.id,
              conversationId: body.conversationId,
              role: 'assistant',
              content: run.reply,
              citations,
              usage: run.usage,
              truncatedReason: run.truncationReason ?? null,
            });
          } catch (err) {
            console.warn('[agents] failed to persist conversation turn:', err);
          }
        }

        send({
          type: 'done',
          userMessageId,
          assistantMessageId,
          reply: run.reply,
          emitted: citations,
          agent: { key: identity.key, name: identity.name },
          truncated: run.truncated,
          truncationReason: run.truncationReason,
          usage: run.usage,
        });

        // AFTER `done`, deliberately: the answer is already on screen by the time
        // this runs, so its latency costs the user nothing and its failure costs
        // them nothing either.
        const followUps = await suggestFollowUps(
          history[history.length - 1].content,
          run.reply,
        );
        if (followUps.length) send({ type: 'suggestions', items: followUps });
      } catch (err) {
        // The stream has already started, so a failure can't become an HTTP
        // status — it has to travel as a message the client knows to read.
        send({
          type: 'error',
          error:
            err instanceof AgentRunError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Request failed',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Proxies that buffer would defeat the whole point of streaming this.
      'X-Accel-Buffering': 'no',
    },
  });
}
