import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/api-auth';
import { getChatSystemPrompt } from '@/lib/ai-knowledge';
import { getAnthropicClient, ANTHROPIC_MODEL, lastTextBlock, parseAiJson } from '@/lib/anthropic';
import { attachmentBlocks, type WireAttachment } from '@/lib/ai/attachments';

type MessageParam = Anthropic.MessageParam;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  prompt?: string;
  context?: {
    page?: string;
    accountKey?: string | null;
    accountName?: string | null;
    userRole?: string | null;
    userName?: string | null;
    isAdmin?: boolean;
  };
  history?: ConversationMessage[];
  /** Images and text files attached to this question. */
  attachments?: WireAttachment[];
}

interface ChatResponsePayload {
  reply: string;
  suggestions: string[];
}

function normalizeResponse(raw: unknown): ChatResponsePayload {
  if (!raw || typeof raw !== 'object') {
    return { reply: '', suggestions: [] };
  }

  const row = raw as Record<string, unknown>;
  const reply = typeof row.reply === 'string' ? row.reply : '';
  const suggestions = Array.isArray(row.suggestions)
    ? row.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 4)
    : [];

  return { reply, suggestions };
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as ChatRequestBody;
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const client = getAnthropicClient();

    const requestContext = body.context || {};
    const accountKey = requestContext.accountKey ?? null;
    const accountName = requestContext.accountName ?? null;
    const userContent = JSON.stringify({
      prompt,
      context: {
        ...requestContext,
        accountKey,
        accountName,
      },
    });

    // Build message array with conversation history (last 10 messages)
    const systemPrompt = await getChatSystemPrompt();
    const messages: MessageParam[] = [];

    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    for (const msg of history) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }

    // Same shape as the specialist route: attachments first, question last.
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    messages.push(
      attachments.length
        ? {
            role: 'user',
            content: [
              ...(attachmentBlocks(attachments) as Anthropic.ContentBlockParam[]),
              { type: 'text', text: userContent },
            ],
          }
        : { role: 'user', content: userContent },
    );

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: systemPrompt,
      messages,
      // Opus 5 rejects temperature; effort is the steering knob now. A chat reply
      // is short, but thinking counts against max_tokens — hence the headroom.
      output_config: { effort: 'low' },
      max_tokens: 8000,
    });

    const content = lastTextBlock(response);
    if (!content) {
      return NextResponse.json({ error: 'AI response was empty' }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = parseAiJson(content);
    } catch {
      return NextResponse.json({ error: 'AI response was not valid JSON' }, { status: 502 });
    }

    const normalized = normalizeResponse(parsed);
    if (!normalized.reply && normalized.suggestions.length === 0) {
      normalized.reply = 'No response generated. Try rephrasing your question.';
    }

    return NextResponse.json(normalized);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to run AI chat';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
