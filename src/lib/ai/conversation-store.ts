/**
 * Saved conversations with an agent.
 *
 * Everything here is scoped to ONE user: every read takes a userId and filters on
 * it, rather than fetching by id and checking ownership afterwards. A conversation
 * is private to the person who had it — a co-op question is often "am I about to
 * get this wrong", which people ask far less freely if a colleague can read it.
 *
 * Deliberately NOT a compliance record; see the schema comment on
 * `AgentConversation`. People rename and delete their own threads freely.
 */

import { prisma } from '@/lib/prisma';

export interface ConversationSummary {
  id: string;
  title: string;
  agentKey: string;
  messageCount: number;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: unknown[] | null;
  truncatedReason: string | null;
  createdAt: string;
}

/** Longest a generated title runs before it stops being a glance and starts being a paragraph. */
const TITLE_MAX = 60;

/**
 * A title from the first thing someone asked.
 *
 * Their own words, trimmed at a word boundary — not a model-generated summary. A
 * summary costs a request and a wait to produce something the user recognises less
 * well than the sentence they typed. They can rename it in one click if it's wrong.
 */
export function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function listConversations(
  userId: string,
  agentKey: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const rows = await prisma.agentConversation.findMany({
    where: { userId, agentKey },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: { _count: { select: { messages: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    agentKey: r.agentKey,
    messageCount: r._count.messages,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** One conversation's turns, or null when it isn't this user's. */
export async function getConversation(
  userId: string,
  id: string,
): Promise<{ id: string; title: string; agentKey: string; messages: StoredMessage[] } | null> {
  const row = await prisma.agentConversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    agentKey: row.agentKey,
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      citations: m.citations ? safeParse(m.citations) : null,
      truncatedReason: m.truncatedReason,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

function safeParse(raw: string): unknown[] | null {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export async function createConversation(args: {
  userId: string;
  agentKey: string;
  title: string;
  accountKey?: string | null;
}): Promise<string> {
  const row = await prisma.agentConversation.create({
    data: {
      userId: args.userId,
      agentKey: args.agentKey,
      title: args.title.slice(0, 200),
      accountKey: args.accountKey ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Append one turn.
 *
 * Touches the parent's `updatedAt` in the same transaction, because the
 * conversation list is ordered by it — a thread that gained a message today but
 * still sorts by its creation date reads as stale and gets lost.
 */
export async function appendMessage(args: {
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: unknown[] | null;
  usage?: unknown;
  truncatedReason?: string | null;
}): Promise<string | null> {
  const owned = await prisma.agentConversation.findFirst({
    where: { id: args.conversationId, userId: args.userId },
    select: { id: true },
  });
  if (!owned) return null;

  const [created] = await prisma.$transaction([
    prisma.agentMessage.create({
      data: {
        conversationId: args.conversationId,
        role: args.role,
        content: args.content,
        citations: args.citations?.length ? JSON.stringify(args.citations) : null,
        usage: args.usage ? JSON.stringify(args.usage) : null,
        truncatedReason: args.truncatedReason ?? null,
      },
    }),
    prisma.agentConversation.update({
      where: { id: args.conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return created.id;
}

/**
 * Discard every message after `messageId` — what "rewind to here" means on disk.
 *
 * Without this, rewinding would only change what the user is LOOKING at: the saved
 * thread would keep the turns they just discarded, and reopening it later would
 * resurrect them. A conversation that disagrees with itself depending on when you
 * read it is worse than one that isn't saved at all.
 *
 * Ordered by `createdAt` rather than id, matching how the thread is read back.
 */
export async function truncateAfter(
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<number> {
  const owned = await prisma.agentConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!owned) return 0;

  const anchor = await prisma.agentMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { createdAt: true },
  });
  if (!anchor) return 0;

  const res = await prisma.agentMessage.deleteMany({
    where: { conversationId, createdAt: { gt: anchor.createdAt } },
  });
  return res.count;
}

export async function renameConversation(
  userId: string,
  id: string,
  title: string,
): Promise<boolean> {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return false;
  const res = await prisma.agentConversation.updateMany({
    where: { id, userId },
    data: { title: clean },
  });
  return res.count > 0;
}

/** Hard delete. Messages go with it via the cascade on the relation. */
export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const res = await prisma.agentConversation.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
