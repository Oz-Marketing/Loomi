import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { listConversations, createConversation, titleFromPrompt } from '@/lib/ai/conversation-store';

/**
 * A user's conversations with one agent.
 *
 * Ownership is the ONLY authorization here, and it lives in the store: every query
 * filters on the session's own userId rather than fetching by id and checking
 * afterwards. There is no "read someone else's thread" path to get wrong.
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { key } = await ctx.params;
  const conversations = await listConversations(session!.user.id, key);
  return NextResponse.json({ conversations });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { key } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    firstPrompt?: string;
    accountKey?: string | null;
  };

  // Title from the user's own first sentence rather than a generated summary —
  // see titleFromPrompt for why.
  const title = body.title?.trim() || titleFromPrompt(body.firstPrompt ?? '');
  const id = await createConversation({
    userId: session!.user.id,
    agentKey: key,
    title,
    accountKey: body.accountKey ?? null,
  });
  return NextResponse.json({ id, title });
}
