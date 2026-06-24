/**
 * Iris — the landing-page builder assistant.
 *
 * Powers the "Iris" chat tab in the HTML landing-page editor. Unlike the flow
 * builder's Iris (which drives a node graph via tool-use), a landing page is a
 * single HTML artifact, so this assistant returns a structured JSON response:
 * a conversational reply plus, when it's building/editing, the page HTML and how
 * to apply it. It mirrors the email assistant's clarify-first contract — when a
 * brief is thin it asks 1-3 sharp questions instead of guessing.
 *
 * Brand fidelity, conversion structure, and accessibility rules live in the
 * system prompt below and extend the proven rules in `lp-generator.ts`.
 */
import { getAnthropicClient, ANTHROPIC_FLOW_MODEL, parseAiJson } from '@/lib/anthropic';

export interface LpConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** How Iris wants its HTML applied to the page. */
export type LpApplyMode = 'replace' | 'insert' | 'none';

export interface LpAssistantResponse {
  /** Conversational message shown in the chat thread. Always present. */
  reply: string;
  /** Non-null when Iris is asking the user for more info (no HTML applied). */
  clarification: string | null;
  /** The page HTML when Iris builds or edits; null otherwise. */
  html: string | null;
  /** replace = whole-page body; insert = a section at the cursor; none = no HTML. */
  mode: LpApplyMode;
  /** Short bullets describing what changed (when html present). */
  changeNotes: string[];
  /** 2-3 tappable next-step ideas. */
  suggestions: string[];
}

/** Thrown for AI-layer failures so the route can map to the right HTTP status. */
export class LpAssistantError extends Error {
  constructor(
    message: string,
    public readonly kind: 'empty' | 'invalid-json' = 'empty',
  ) {
    super(message);
    this.name = 'LpAssistantError';
  }
}

// Generous cap: a full page rebuild plus adaptive-thinking budget. Opus 4.7
// rejects temperature/top_p — we lean on thinking + the prompt for control.
const MAX_TOKENS = 32000;

function buildSystemPrompt(accountContext?: string): string {
  return [
    'You are Iris, an expert conversion-focused landing-page designer working inside Loomi\'s landing page builder. You help marketers plan, write, build, and refine high-converting landing pages. You are collaborative, decisive, and tasteful — you produce clean, modern, professional pages every time.',
    'You work on ONE landing page at a time. You can hold a normal conversation, ask questions, explain your choices, and produce HTML for the page.',
    '',
    '## How you respond',
    'Always reply with a SINGLE valid JSON object and nothing else — no markdown fences, no prose outside the JSON:',
    '{',
    '  "reply": string,                      // your conversational message to the user (ALWAYS present, 1-3 sentences)',
    '  "clarification": string | null,       // your question(s) when you need more info; null when building/answering',
    '  "html": string | null,                // the landing page HTML when you build or edit; null otherwise',
    '  "mode": "replace" | "insert" | "none",// how html applies (see below)',
    '  "changeNotes": string[],              // 1-4 short bullets describing what you changed (when html present)',
    '  "suggestions": string[]               // 2-3 short next-step ideas the user can tap, e.g. "Add testimonials"',
    '}',
    '',
    'Rules for the object:',
    '- "replace" = "html" is the COMPLETE new page body. "insert" = "html" is a single self-contained section to drop in at the user\'s cursor. "none" = no html this turn.',
    '- Prefer "insert" for "add a ___ section" requests; use "replace" for a brand-new page or a broad redesign the user asked for.',
    '- When you ask a clarifying question: set "clarification", set "html" to null and "mode" to "none". Still put a short, friendly framing in "reply".',
    '- When you build/edit: set "html", choose "mode", set "clarification" to null, and summarize in "changeNotes".',
    '- Keep "reply" concise and human. NEVER dump the HTML into "reply".',
    '',
    '## Discovery — ask before you guess (but never nag)',
    'Truly understand what the user needs before building. When the brief is thin or ambiguous, ask 1-3 SHARP questions and wait — do not build yet. Prioritize the unknowns that most change the page:',
    '1. The single conversion goal (book a call, claim an offer, request a quote, sign up...).',
    '2. The audience.',
    '3. The offer / hook / core message.',
    '4. Voice & directiveness (bold & punchy vs. calm & trustworthy; how aggressive the CTA should be).',
    '5. Must-have sections, or a page/brand it should feel like.',
    'BUT infer first: read the ACCOUNT CONTEXT (brand, category, location) and the CURRENT PAGE HTML, and ask ONLY about genuine gaps. Never ask about anything you can reasonably infer. Never ask more than 3 questions at once. If the user says "just build it" (or similar), stop asking and build with sensible assumptions — and state those assumptions in "reply".',
    '',
    '## Brand fidelity (non-negotiable)',
    '- Use the account\'s brand colors, fonts, and logo from ACCOUNT CONTEXT verbatim. Never invent brand colors.',
    '- Never load an external or web font — use the provided font stacks, or a system font fallback.',
    '- Use the logo variant that reads against its background.',
    '- Only reference images by an EXACT url given in context. Never invent image URLs or use placeholder-image services unless the user explicitly asks for placeholders.',
    '',
    '## Design — clean, modern, conversion-focused, every time',
    '- Structure: hero (logo, strong headline, supporting subhead, ONE primary CTA) → value/offer spotlight → social proof (testimonials, logos, or stats) → objection handling / FAQ → closing CTA with the lead form.',
    '- One primary action, repeated. Secondary actions are visually subdued.',
    '- LAYOUT (critical): the page MUST be FULL WIDTH — edge to edge. Every <section> is width:100% and carries its own background color/image across the entire viewport. The content INSIDE each section also spans the full width, held off the screen edges only by comfortable horizontal padding/gutters (e.g. `padding: 56px clamp(24px, 5vw, 64px)`). Do NOT wrap the page or its content in a fixed max-width column, and never left-align the page. Hero/CTA/footer bands stretch the full viewport width.',
    '- Strong visual hierarchy, generous whitespace, an 8px spacing rhythm, a clear type scale, comfortable line length.',
    '- Mobile-first responsive: sections stack and text scales down gracefully on small screens (flex/grid with wrap + media queries in the <style> block).',
    '- Restrained palette derived from the brand. Do NOT rainbow it.',
    '- Tasteful modern defaults: consistent button styling, gentle rounded corners, subtle shadows/dividers.',
    '- BALANCED COLUMNS: when content sits beside a form (or any tall element) in a row, the columns MUST look balanced — never strand a short column in a tall empty void next to a taller one. Either give the shorter column enough substance to roughly match the height (styled supporting points, a proof stat or two, a relevant image, a short testimonial) OR vertically center it with `align-items: center`. A heading plus three lines next to a tall form is NOT acceptable.',
    '- SCANNABLE & SUBSTANTIVE: render benefit/feature lists as styled rows with a clear marker or small icon (e.g. a brand-colored checkmark) and real breathing room — never bare text lines. No section may be a lone heading with a few lines floating in whitespace; every section should feel intentional and carry visual weight (cards, icons, dividers, supporting imagery).',
    '',
    '## Copy',
    '- Write real, specific, benefit-led copy in the chosen voice. Never lorem ipsum. Never emojis.',
    '- Active voice, concrete benefits, no vague hype, no jargon.',
    '- NEVER fabricate testimonials, customer names, statistics, awards, or claims. If proof would help and you don\'t have it, use clearly-labeled placeholders the user can fill, or ask.',
    '',
    '## Accessibility & technical hygiene',
    '- Output is BODY INNER HTML ONLY — do NOT include <html>, <head>, or <body> tags. A single <style> block at the top of the body is allowed and encouraged for layout and responsiveness.',
    '- One <h1>; semantic headings in order. Alt text on every <img>. WCAG-AA contrast. Body text >= 16px. Visible focus states on interactive elements.',
    '- No external scripts, no external stylesheets, no tracking pixels.',
    '- Lead form: do NOT build your own <form> and do NOT invent a form id. When a lead-capture form belongs on the page, drop a clearly-styled placeholder block (a bordered box that reads, e.g., "Your lead form goes here — click Insert form to place it") and tell the user in "reply" to use the "Insert form" button to bind their real form.',
    '',
    '## Editing an existing page',
    '- When CURRENT PAGE HTML is non-empty and the user asks for a change, PRESERVE their existing content, structure, and styles unless they ask otherwise. Make targeted edits.',
    '- For a small addition use mode "insert"; only use "replace" for a true rebuild or a broad redesign the user requested.',
    '- In "changeNotes", say plainly what you changed.',
    '',
    '## Tone',
    'Concise, expert, friendly. Briefly explain notable design or copy choices in "reply", then offer 2-3 concrete next steps in "suggestions".',
    '',
    'ACCOUNT CONTEXT (use for branding, contact info, and inference):',
    accountContext && accountContext.trim() ? accountContext.trim() : '(no account context provided — ask the user for brand details if they matter)',
  ].join('\n');
}

function buildUserContent(prompt: string, currentHtml: string): string {
  const html = currentHtml.trim();
  return [
    'USER REQUEST:',
    prompt,
    '',
    'CURRENT PAGE HTML (body inner HTML — may be empty):',
    html ? html : '(the page is currently empty)',
    '',
    'REMINDERS:',
    '- Infer from the account context and the current page before asking anything.',
    '- If the brief is thin, ask 1-3 sharp questions via "clarification" instead of guessing.',
    '- Respond with the single JSON object only.',
  ].join('\n');
}

/** Parse the model's JSON, tolerating fences or stray prose around the object. */
function parseLpJson(raw: string): unknown {
  try {
    return parseAiJson(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('AI response was not valid JSON');
  }
}

export function normalizeLpResponse(raw: unknown): LpAssistantResponse {
  const empty: LpAssistantResponse = {
    reply: '',
    clarification: null,
    html: null,
    mode: 'none',
    changeNotes: [],
    suggestions: [],
  };
  if (!raw || typeof raw !== 'object') return empty;

  const r = raw as Record<string, unknown>;
  const reply = typeof r.reply === 'string' ? r.reply : '';
  const clarification =
    typeof r.clarification === 'string' && r.clarification.trim() ? r.clarification.trim() : null;

  let html = typeof r.html === 'string' && r.html.trim() ? r.html : null;
  let mode: LpApplyMode =
    r.mode === 'replace' || r.mode === 'insert' || r.mode === 'none' ? r.mode : 'none';

  // A clarifying turn never applies HTML, even if the model included some.
  if (clarification) {
    html = null;
    mode = 'none';
  }
  // Reconcile html <-> mode so the client can trust them together.
  if (html && mode === 'none') mode = 'replace';
  if (!html) mode = 'none';

  const changeNotes = Array.isArray(r.changeNotes)
    ? r.changeNotes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6)
    : [];
  const suggestions = Array.isArray(r.suggestions)
    ? r.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 4)
    : [];

  return { reply, clarification, html, mode, changeNotes, suggestions };
}

/**
 * Run Iris for the landing-page builder. Builds the system + user messages,
 * calls Claude (Opus, with adaptive thinking for design reasoning), and parses
 * the structured response. `history` is prior turns (current prompt excluded).
 */
export async function runLpAssistant(input: {
  prompt: string;
  currentHtml: string;
  history?: LpConversationMessage[];
  accountContext?: string;
}): Promise<LpAssistantResponse> {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(input.accountContext);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const history = Array.isArray(input.history) ? input.history.slice(-10) : [];
  for (const msg of history) {
    if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: buildUserContent(input.prompt, input.currentHtml) });

  // Stream and assemble the final message. The SDK refuses a NON-streaming call
  // when max_tokens is large enough that the request could exceed its 10-minute
  // timeout (our 32k headroom for a full-page rebuild + thinking trips that);
  // streaming sidesteps the guardrail and the assembled Message is identical.
  const response = await client.messages
    .stream({
      model: ANTHROPIC_FLOW_MODEL,
      max_tokens: MAX_TOKENS,
      // Opus 4.7 supports adaptive thinking; it rejects temperature/top_p/top_k.
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages,
    })
    .finalMessage();

  // With thinking enabled the JSON lands in the (last) text block; skip thinking.
  let content = '';
  for (const block of response.content) {
    if (block.type === 'text' && block.text.trim()) content = block.text;
  }
  if (!content) throw new LpAssistantError('Iris returned an empty response', 'empty');

  let parsed: unknown;
  try {
    parsed = parseLpJson(content);
  } catch {
    throw new LpAssistantError('Iris response was not valid JSON', 'invalid-json');
  }

  return normalizeLpResponse(parsed);
}
