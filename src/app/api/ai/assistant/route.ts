import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import type { AccountContextInput } from '@/lib/ai-knowledge';
import {
  runEmailAssistant,
  EmailAssistantError,
  type ConversationMessage,
} from '@/lib/ai/email-assistant';

interface AssistantRequestBody {
  prompt?: string;
  context?: Record<string, unknown>;
  history?: ConversationMessage[];
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as AssistantRequestBody;
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const account = body.context?.account as AccountContextInput | undefined;

    const normalized = await runEmailAssistant({
      prompt,
      context: body.context || {},
      history: body.history,
      account,
    });

    if (
      !normalized.reply &&
      normalized.suggestions.length === 0 &&
      normalized.componentEdits.length === 0 &&
      !normalized.templateBuild &&
      !normalized.clarification
    ) {
      normalized.reply = 'No suggestions generated. Try a more specific prompt.';
    }

    return NextResponse.json(normalized);
  } catch (err: unknown) {
    if (err instanceof EmailAssistantError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : 'Failed to run AI assistant';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
