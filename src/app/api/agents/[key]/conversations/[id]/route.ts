import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  getConversation,
  renameConversation,
  deleteConversation,
  truncateAfter,
} from '@/lib/ai/conversation-store';

/** One conversation: read it, rename it, delete it. Always the caller's own. */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const conversation = await getConversation(session!.user.id, id);
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ conversation });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  if (typeof body.title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const ok = await renameConversation(session!.user.id, id, body.title);
  // A blank title is a bad request; a missing conversation is a 404. Collapsing
  // both into one status would make an empty rename look like someone else's thread.
  if (!ok && !body.title.trim()) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
  }
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const ok = await deleteConversation(session!.user.id, id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

/**
 * Rewind: discard every message after the one named.
 *
 * A POST rather than a DELETE because it takes a body naming the anchor, and
 * because it isn't deleting the resource this route addresses — the conversation
 * survives, shorter.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { truncateAfterMessageId?: string };
  if (typeof body.truncateAfterMessageId !== 'string') {
    return NextResponse.json({ error: 'truncateAfterMessageId is required' }, { status: 400 });
  }
  const removed = await truncateAfter(session!.user.id, id, body.truncateAfterMessageId);
  return NextResponse.json({ removed });
}
