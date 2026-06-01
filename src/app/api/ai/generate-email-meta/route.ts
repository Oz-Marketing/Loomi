import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';

// Subject / preview-text variant generator. Returns N candidates so
// the UI can show a picker — single-result calls (the original
// contract) still work because `result` is populated with the first
// variant for back-compat.

interface GenerateEmailMetaBody {
  field: 'subject' | 'previewText';
  emailTextContent?: string;
  currentSubject?: string;
  currentPreviewText?: string;
  /** 1-5. Defaults to 3. Callers asking for 1 get the legacy single-
   *  result UX without thinking about it. */
  count?: number;
  /** Optional free-text brief: tone, audience, offer, dealer context.
   *  Threaded into the system prompt verbatim. */
  brief?: string;
}

const MAX_COUNT = 5;
const DEFAULT_COUNT = 3;

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as GenerateEmailMetaBody;
    const { field, emailTextContent, currentSubject, currentPreviewText, brief } = body;

    if (field !== 'subject' && field !== 'previewText') {
      return NextResponse.json({ error: 'Invalid field — must be "subject" or "previewText"' }, { status: 400 });
    }

    const requestedCount = Number.isFinite(body.count) ? Number(body.count) : DEFAULT_COUNT;
    const count = Math.max(1, Math.min(MAX_COUNT, requestedCount));

    const client = getAnthropicClient();

    const fieldLabel = field === 'subject' ? 'subject line' : 'preview text';
    const lengthRule =
      field === 'subject'
        ? 'Subject lines should be 6–10 words, attention-grabbing, and relevant to the content.'
        : 'Preview text should be 40–90 characters, complement the subject line, and entice the reader to open.';

    const systemPrompt = [
      `You are an expert email marketer. Generate ${count} distinct ${fieldLabel} option${count === 1 ? '' : 's'} for the email described below.`,
      '',
      'Rules:',
      `- ${lengthRule}`,
      '- Each option must take a meaningfully different angle (urgency, benefit, curiosity, social proof, specificity) — do not paraphrase the same idea.',
      '- Do NOT use spammy language, all-caps, or excessive punctuation/emoji.',
      '- Return ONLY a JSON object: { "results": ["option1", "option2", ...] }',
      '- No markdown fences, no commentary, exactly the requested number of options.',
    ].join('\n');

    const userParts: string[] = [];
    if (emailTextContent?.trim()) {
      userParts.push(`Email content:\n${emailTextContent.slice(0, 3000)}`);
    }
    if (currentSubject?.trim()) {
      userParts.push(`Current subject line: ${currentSubject}`);
    }
    if (currentPreviewText?.trim()) {
      userParts.push(`Current preview text: ${currentPreviewText}`);
    }
    if (brief?.trim()) {
      userParts.push(`Brief / extra direction:\n${brief.slice(0, 500)}`);
    }
    if (userParts.length === 0) {
      userParts.push('No email content provided — generate generic professional email options.');
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userParts.join('\n\n') }],
      temperature: 0.85,
      // Variants are short; cap is generous to allow for the JSON wrapper.
      max_tokens: 512,
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

    // Accept both new ({results:[...]}) and the legacy ({result:"..."})
    // shapes so we tolerate Claude returning either format on a tail
    // miss. The single-result fallback wraps into an array.
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

    // Deduplicate (case-insensitive) and cap to requested count. AI
    // occasionally returns near-duplicates; surfacing them as separate
    // options is noise.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const r of results) {
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
      if (deduped.length >= count) break;
    }

    return NextResponse.json({
      results: deduped,
      // Back-compat with the original `result` contract; first variant.
      result: deduped[0],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate email meta';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
