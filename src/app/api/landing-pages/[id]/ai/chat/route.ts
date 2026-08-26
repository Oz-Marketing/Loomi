import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { getLandingPage } from '@/lib/services/landing-pages';
import { buildAccountContextForKey } from '@/lib/campaigns/account-context';
import {
  runLpAssistant,
  LpAssistantError,
  type LpAssistantResponse,
  type LpConversationMessage,
} from '@/lib/ai/lp-assistant';

interface ChatRequestBody {
  /** Conversation so far, in order. Last entry must be the new user turn. */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Current page body HTML — Loomi AI's view of what's on the page right now. */
  html?: string;
}

/**
 * POST /api/landing-pages/[id]/ai/chat
 *
 * Loomi AI for the landing-page builder. Verifies the caller can access the page,
 * pulls the account's brand context server-side (trusted, derived from the page
 * row — not the client), and returns Loomi AI's structured reply + optional HTML.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.landing_pages.edit');
  if (error) return error;

  const { id } = await context.params;
  // Gate on access before letting Loomi AI touch the page. The client also sends the
  // current HTML, but the account scope (for branding) is derived from the row.
  const page = await getLandingPage(id, getAccountScope(session!));
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
    return NextResponse.json(
      { error: 'The last message must be a non-empty user message' },
      { status: 400 },
    );
  }

  const accountContext = page.accountKey
    ? await buildAccountContextForKey(page.accountKey)
    : undefined;

  try {
    const result: LpAssistantResponse = await runLpAssistant({
      prompt: last.content,
      currentHtml: typeof body.html === 'string' ? body.html : '',
      history: messages.slice(0, -1) as LpConversationMessage[],
      accountContext,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LpAssistantError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : 'Failed to run Loomi AI';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
