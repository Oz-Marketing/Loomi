import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';

// Body-copy variant generator for individual template blocks
// (heading / text / button). Returns N distinct rewrites informed by:
//   - the block's current text (the rewrite "seed")
//   - the surrounding template context (subject, preheader, other
//     blocks' text) so suggestions stay on-topic with the email
//   - optional brief: dealer brand voice, audience, tone, offer
//
// Different blocks get different length budgets so we don't ask Claude
// for a paragraph when the user wanted a 2-word button label.

type BlockKind = 'heading' | 'text' | 'button';

interface GenerateBlockCopyBody {
  blockType: BlockKind;
  currentText?: string;
  /** Verbatim email subject — gives Claude a top-line anchor for tone. */
  emailSubject?: string | null;
  emailPreheader?: string | null;
  /** Other text-bearing blocks in this template, in document order.
   *  Helps Claude stay consistent with surrounding copy. Capped server-
   *  side to keep prompts small. */
  otherBlocksText?: string[];
  /** Optional free-text brief: tone, audience, offer, dealer context. */
  brief?: string;
  /** 1-5. Defaults to 3. */
  count?: number;
}

const MAX_COUNT = 5;
const DEFAULT_COUNT = 3;
const MAX_OTHER_BLOCKS = 12;
const MAX_OTHER_BLOCK_CHARS = 240;

const LENGTH_RULES: Record<BlockKind, string> = {
  heading:
    'Headings are short and punchy: 4–10 words, no trailing punctuation, sentence or title case.',
  text:
    'Body text is conversational and scannable: 1–3 sentences (max ~60 words) unless the brief explicitly asks for more. Use line breaks rather than walls of text.',
  button:
    'Button labels are 1–4 words. Action-first verb ("Book Service", "See My Offer"). No trailing punctuation.',
};

const BLOCK_LABEL: Record<BlockKind, string> = {
  heading: 'heading',
  text: 'body-text block',
  button: 'button label',
};

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as GenerateBlockCopyBody;
    const { blockType, currentText, emailSubject, emailPreheader, brief } = body;

    if (blockType !== 'heading' && blockType !== 'text' && blockType !== 'button') {
      return NextResponse.json(
        { error: 'Invalid blockType — must be "heading", "text", or "button"' },
        { status: 400 },
      );
    }

    const requestedCount = Number.isFinite(body.count) ? Number(body.count) : DEFAULT_COUNT;
    const count = Math.max(1, Math.min(MAX_COUNT, requestedCount));

    const client = getAnthropicClient();

    const systemPrompt = [
      `You are an expert email copywriter. Generate ${count} distinct rewrites for an email ${BLOCK_LABEL[blockType]}.`,
      '',
      'Rules:',
      `- ${LENGTH_RULES[blockType]}`,
      '- Each option must take a meaningfully different angle (urgency, benefit, curiosity, social proof, specificity) — do not paraphrase the same idea.',
      '- Match the tone and topic implied by the surrounding template context — do not invent unrelated offers or change the message intent.',
      '- Do NOT use spammy language, all-caps, or excessive punctuation/emoji.',
      '- Preserve any mergetag placeholders ({{firstName}}, etc.) the user already had in the original — they may be omitted from a rewrite, but never invent new ones.',
      '- Return ONLY a JSON object: { "results": ["rewrite1", "rewrite2", ...] }',
      '- No markdown fences, no commentary, exactly the requested number of options.',
    ].join('\n');

    const userParts: string[] = [];
    if (currentText?.trim()) {
      userParts.push(`Current ${BLOCK_LABEL[blockType]} (the seed to rewrite):\n${currentText.slice(0, 1500)}`);
    } else {
      userParts.push(`There is no current ${BLOCK_LABEL[blockType]} yet — propose ${count} fresh options that fit the surrounding context.`);
    }
    if (emailSubject?.trim()) {
      userParts.push(`Email subject: ${emailSubject}`);
    }
    if (emailPreheader?.trim()) {
      userParts.push(`Email preview text: ${emailPreheader}`);
    }
    const others = Array.isArray(body.otherBlocksText) ? body.otherBlocksText : [];
    if (others.length > 0) {
      const capped = others
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_OTHER_BLOCKS)
        .map((t) => (t.length > MAX_OTHER_BLOCK_CHARS ? `${t.slice(0, MAX_OTHER_BLOCK_CHARS)}…` : t));
      if (capped.length > 0) {
        userParts.push(
          `Surrounding template copy (for context — don't rewrite these):\n- ${capped.join('\n- ')}`,
        );
      }
    }
    if (brief?.trim()) {
      userParts.push(`Brief / extra direction:\n${brief.slice(0, 500)}`);
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userParts.join('\n\n') }],
      temperature: 0.85,
      // Body text is the longest output we generate; cap covers ~3
      // 60-word paragraphs plus JSON wrapper.
      max_tokens: 1024,
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';
    if (!content) {
      return NextResponse.json({ error: 'AI response was empty' }, { status: 502 });
    }

    let parsed: { results?: unknown; result?: unknown };
    try {
      parsed = parseAiJson(content) as { results?: unknown; result?: unknown };
    } catch {
      return NextResponse.json({ error: 'AI response was not valid JSON' }, { status: 502 });
    }

    let results: string[] = [];
    if (Array.isArray(parsed.results)) {
      results = parsed.results
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.trim())
        .filter(Boolean);
    } else if (typeof parsed.result === 'string') {
      const trimmed = parsed.result.trim();
      if (trimmed) results = [trimmed];
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'AI returned no usable variants' }, { status: 502 });
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const r of results) {
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
      if (deduped.length >= count) break;
    }

    return NextResponse.json({ results: deduped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate block copy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
