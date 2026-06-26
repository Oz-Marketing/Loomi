/**
 * Shared email-assistant core.
 *
 * The template-editor assistant route (`POST /api/ai/assistant`) and the AI
 * Campaign Builder both need to ask Claude to build/edit an email and parse
 * the structured `templateBuild` response. This module is the single
 * implementation both consume — the route is a thin HTTP wrapper, the campaign
 * generator calls it server-side per email spec.
 */
import {
  getAssistantSystemPrompt,
  buildAccountContext,
  type AccountContextInput,
} from '@/lib/ai-knowledge';
import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';
import { componentSchemas } from '@/lib/component-schemas';
import type { TemplateBuild, TemplateBuildComponent } from '@/lib/email/build-to-html';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResponsePayload {
  reply: string;
  suggestions: string[];
  componentEdits: Array<{ componentIndex?: number; key: string; value: string; reason?: string }>;
  templateBuild: TemplateBuild | null;
  clarification: string | null;
}

const VALID_COMPONENT_TYPES = new Set(Object.keys(componentSchemas));

/** Validate + normalize one component, RECURSING into children so nested
 *  content (sections/columns and what they contain) is preserved. */
function normalizeComponent(raw: unknown): TemplateBuildComponent | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.type !== 'string' || !VALID_COMPONENT_TYPES.has(c.type)) return null;

  const props: Record<string, string> = {};
  if (c.props && typeof c.props === 'object') {
    for (const [k, v] of Object.entries(c.props as Record<string, unknown>)) {
      if (typeof v === 'string') props[k] = v;
      else if (v !== null && v !== undefined) props[k] = String(v);
    }
  }

  const comp: TemplateBuildComponent = { type: c.type, props };
  if (Array.isArray(c.children)) {
    const kids = c.children
      .map(normalizeComponent)
      .filter((k): k is TemplateBuildComponent => k !== null);
    if (kids.length > 0) comp.children = kids;
  }
  return comp;
}

export function normalizeTemplateBuild(raw: unknown): TemplateBuild | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const mode = obj.mode;
  if (mode !== 'visual' && mode !== 'code') return null;

  const result: TemplateBuild = { mode };

  if (mode === 'visual' && Array.isArray(obj.components)) {
    result.components = obj.components
      .map(normalizeComponent)
      .filter((c): c is TemplateBuildComponent => c !== null);
    if (result.components.length === 0) return null;
  } else if (mode === 'code' && typeof obj.html === 'string' && obj.html.trim()) {
    result.html = obj.html;
  } else {
    return null;
  }

  if (obj.frontmatter && typeof obj.frontmatter === 'object') {
    const fm: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.frontmatter as Record<string, unknown>)) {
      if (typeof v === 'string') fm[k] = v;
    }
    if (Object.keys(fm).length > 0) result.frontmatter = fm;
  }

  if (obj.baseProps && typeof obj.baseProps === 'object') {
    const bp: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.baseProps as Record<string, unknown>)) {
      if (typeof v === 'string') bp[k] = v;
    }
    if (Object.keys(bp).length > 0) result.baseProps = bp;
  }

  return result;
}

export function normalizeAssistantResponse(
  raw: unknown,
  opts?: { preferBuild?: boolean },
): AssistantResponsePayload {
  if (!raw || typeof raw !== 'object') {
    return { reply: '', suggestions: [], componentEdits: [], templateBuild: null, clarification: null };
  }

  const row = raw as Record<string, unknown>;
  const reply = typeof row.reply === 'string' ? row.reply : '';
  const suggestions = Array.isArray(row.suggestions)
    ? row.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 12)
    : [];
  const componentEdits = Array.isArray(row.componentEdits)
    ? row.componentEdits
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          componentIndex: typeof item.componentIndex === 'number' ? item.componentIndex : undefined,
          key: typeof item.key === 'string' ? item.key : '',
          value:
            typeof item.value === 'string'
              ? item.value
              : typeof item.value === 'number'
                ? String(item.value)
                : '',
          reason: typeof item.reason === 'string' ? item.reason : undefined,
        }))
        .filter((item) => item.key && item.value)
        .slice(0, 50)
    : [];

  const rawClarification =
    typeof row.clarification === 'string' && row.clarification.trim()
      ? row.clarification.trim()
      : null;

  // Normally a clarification suppresses templateBuild. In preferBuild mode
  // (the non-interactive campaign builder) we keep any returned build and drop
  // the clarification — there's no user to answer it.
  const preferBuild = !!opts?.preferBuild;
  const templateBuild = rawClarification && !preferBuild ? null : normalizeTemplateBuild(row.templateBuild);
  const clarification = preferBuild && templateBuild ? null : rawClarification;

  return { reply, suggestions, componentEdits, templateBuild, clarification };
}

function buildAssistantUserContent(prompt: string, context: Record<string, unknown>): string {
  return [
    'USER REQUEST:',
    prompt,
    '',
    'EDITOR CONTEXT JSON:',
    JSON.stringify(context),
    '',
    'IMPORTANT:',
    '- Match your output to the active editor context.',
    '- If EDITOR CONTEXT JSON.mode is "code" or EDITOR CONTEXT JSON.htmlOnlyBuilder is true, return templateBuild.mode="code" and do not return drag-and-drop component arrays unless the user explicitly asks for visual components.',
    '- Read the current email context before asking clarifying questions.',
    '- Infer details already present in the email and ask only about missing or conflicting information.',
    '- Use the account context for branding, logos, custom values, and business/profile details.',
  ].join('\n');
}

/** Thrown for AI-layer failures so callers can map to the right HTTP status. */
export class EmailAssistantError extends Error {
  constructor(
    message: string,
    public readonly kind: 'empty' | 'invalid-json' = 'empty',
  ) {
    super(message);
    this.name = 'EmailAssistantError';
  }
}

/**
 * Run the email assistant: build the system + user messages, call Claude, parse
 * and normalize the structured response. Shared by the editor route and the
 * campaign generator.
 *
 * Pass a pre-built `accountContext` string, or an `AccountContextInput` to have
 * it built here. `context` is the editor-context JSON forwarded to the model
 * (e.g. `{ mode: 'visual' }`).
 */
export async function runEmailAssistant(input: {
  prompt: string;
  context?: Record<string, unknown>;
  history?: ConversationMessage[];
  accountContext?: string;
  account?: AccountContextInput;
  /** Non-interactive mode: never clarify, always return a templateBuild.
   *  Used by the AI Campaign Builder where there's no user to answer. */
  forceBuild?: boolean;
  /** Output token cap. Full from-scratch emails need more headroom than the
   *  editor's default to avoid truncated (invalid) JSON. Defaults to 4096. */
  maxTokens?: number;
}): Promise<AssistantResponsePayload> {
  const client = getAnthropicClient();

  const accountContext =
    input.accountContext ?? (input.account ? buildAccountContext(input.account) : undefined);
  const systemPrompt = await getAssistantSystemPrompt(accountContext, { forceBuild: input.forceBuild });

  const context = input.context || {};
  const userContent = buildAssistantUserContent(input.prompt, context);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const history = Array.isArray(input.history) ? input.history.slice(-10) : [];
  for (const msg of history) {
    if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: userContent });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    system: systemPrompt,
    messages,
    temperature: 0.4,
    max_tokens: input.maxTokens ?? 4096,
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
  if (!content) throw new EmailAssistantError('AI response was empty', 'empty');

  let parsed: unknown;
  try {
    parsed = parseAiJson(content);
  } catch {
    throw new EmailAssistantError('AI response was not valid JSON', 'invalid-json');
  }

  return normalizeAssistantResponse(parsed, { preferBuild: input.forceBuild });
}
