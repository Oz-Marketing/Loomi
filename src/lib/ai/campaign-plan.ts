/**
 * AI Campaign Builder — the "plan" phase.
 *
 * Given a natural-language goal + account context, Claude proposes a
 * structured multi-channel build plan (subjects, cadence, SMS copy, suggested
 * audience) plus any genuinely-needed clarifying questions. The user reviews /
 * edits the plan, then it's generated into draft assets.
 *
 * Phase 1 channels: email + sms. The plan shape carries landingPages/forms/
 * flows arrays for forward-compat; the planner leaves them empty for now.
 */
import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';
import {
  CAMPAIGN_PLAN_VERSION,
  SMS_MAX_CHARS,
  type CampaignChannel,
  type CampaignPlan,
  type CampaignPlanEmailSpec,
  type CampaignPlanSmsSpec,
  type CampaignPlanFormSpec,
  type CampaignPlanLandingPageSpec,
  type CampaignPlanClarification,
} from '@/lib/campaigns/types';

const MAX_EMAILS = 6;
const MAX_SMS = 4;
const MAX_CLARIFICATIONS = 3;
const MAX_FORMS = 1;
const MAX_LANDING_PAGES = 1;

function buildSystemPrompt(channels: CampaignChannel[]): string {
  const channelList = channels.join(', ');
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  return [
    "You are Loomi's campaign planner — an expert multi-channel marketing strategist for local businesses (auto dealers, healthcare, services, etc.).",
    '',
    `Today's date is ${todayStr} (current year ${year}). When the user gives a date without a year (e.g. "June 23rd"), assume ${year} — or the next upcoming occurrence if that date has already passed this year. NEVER use a past year in the campaign name, summary, subjects, or copy.`,
    '',
    'Given a goal and an account (brand) context, produce a concise, sendable campaign PLAN: a sequence of touchpoints across the allowed channels. This is a PLAN, not the final content — emails are described (subject + key points), not fully written. SMS messages, however, ARE the final send-ready copy.',
    '',
    `ALLOWED CHANNELS for this plan: ${channelList}. Do NOT plan any channel outside this list.`,
    '',
    'Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:',
    '{',
    '  "name": string,                      // short campaign title, e.g. "Memorial Day Service Sale"',
    '  "summary": string,                   // one sentence describing the whole campaign',
    '  "audience": { "description": string },// who this should reach, plain English (SUGGESTION ONLY)',
    '  "clarifications": [ { "question": string } ], // 0-3, ONLY for critical missing info',
    '  "emails": [ {',
    '     "purpose": string,                // role of this email in the sequence',
    '     "subject": string,                // punchy subject line',
    '     "previewText": string,            // inbox preview text',
    '     "tone": string,                   // e.g. "celebratory", "helpful"',
    '     "keyPoints": [string],            // 3-5 bullets the email should cover',
    '     "sendOffsetDays": number          // cadence offset from campaign start (0 = day 1)',
    '  } ],',
    '  "sms": [ {',
    '     "purpose": string,',
    '     "message": string,                // FINAL send-ready SMS body, <= 320 chars ideal',
    '     "sendOffsetDays": number',
    '  } ],',
    '  "forms": [ {                          // ONLY if a lead form is warranted (usually 0 or 1)',
    '     "key": string,                     // e.g. "f1"',
    '     "purpose": string,',
    '     "fields": [string]                 // plain field labels, 3-5, e.g. ["Full name","Email","Phone"]',
    '  } ],',
    '  "landingPages": [ {                    // ONLY if a landing page is warranted (usually 0 or 1)',
    '     "key": string,                     // e.g. "lp1"',
    '     "purpose": string,',
    '     "headline": string,                // the hero headline',
    '     "sections": [string],              // short labels of the sections the page should have',
    '     "embeddedFormKey": string          // the forms[].key of the lead form to embed (if any)',
    '  } ]',
    '}',
    '',
    'RULES:',
    '- Ground everything in the account context (brand voice, location, services). Never invent specific prices, percentages, or dates. If such a detail is essential and absent, add a clarification question (max 3) — otherwise proceed with sensible, generic copy and merge tags like {{location.name}}.',
    `- If "email" is allowed, include 1-${MAX_EMAILS} emails forming a coherent sequence. Vary purpose (announce, value/proof, last-chance).`,
    `- If "sms" is allowed, include 0-${MAX_SMS} short SMS touches. Promotional SMS MUST end with an opt-out like "Txt STOP to opt out." Keep each under ${SMS_MAX_CHARS} characters.`,
    '- If "landingPage" is allowed AND the goal implies lead capture (book, register, RSVP, request a quote, claim an offer, get details), propose EXACTLY ONE landing page and EXACTLY ONE form, and set the landing page\'s embeddedFormKey to that form\'s key. Keep the form to 3-5 fields (name, email, phone, + at most one goal-specific field). Do NOT propose a landing page or form for a pure announcement/newsletter goal — leave both arrays empty.',
    '- Order touches by sendOffsetDays (0, 2, 5, ...). Keep the cadence realistic.',
    '- Prefer fewer, higher-quality touches over many. Do not pad.',
    '- Keep clarifications empty when the goal is already actionable.',
    '- EMOJIS: never use emojis in the campaign name, email subjects, email preview text, or email key points. For SMS, use emojis only sparingly and only when one genuinely fits the tone and audience — default to none. Never use decorative emoji sequences (e.g. number emojis).',
  ].join('\n');
}

function buildUserContent(goal: string, accountContext: string | undefined): string {
  return [
    'CAMPAIGN GOAL:',
    goal,
    '',
    'ACCOUNT CONTEXT:',
    accountContext || '(no account context provided)',
  ].join('\n');
}

// ── Normalization ──────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, max);
}

function asOffset(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function normalizeEmails(raw: unknown): CampaignPlanEmailSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .slice(0, MAX_EMAILS)
    .map((e, i): CampaignPlanEmailSpec => ({
      key: `e${i + 1}`,
      purpose: asString(e.purpose, 'Marketing email'),
      subject: asString(e.subject, 'Your update from {{location.name}}'),
      previewText: asString(e.previewText) || undefined,
      tone: asString(e.tone) || undefined,
      keyPoints: asStringArray(e.keyPoints, 6),
      sendOffsetDays: asOffset(e.sendOffsetDays),
      mode: e.mode === 'code' ? 'code' : 'visual',
    }));
}

function normalizeSms(raw: unknown): CampaignPlanSmsSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .slice(0, MAX_SMS)
    .map((s, i): CampaignPlanSmsSpec => {
      const message = asString(s.message).trim().slice(0, SMS_MAX_CHARS);
      return {
        key: `s${i + 1}`,
        purpose: asString(s.purpose, 'SMS touch'),
        message,
        sendOffsetDays: asOffset(s.sendOffsetDays),
        mediaUrls: [],
      };
    })
    .filter((s) => s.message.length > 0);
}

function normalizeClarifications(raw: unknown): CampaignPlanClarification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c, i): CampaignPlanClarification | null => {
      const question =
        typeof c === 'string' ? c : c && typeof c === 'object' ? asString((c as Record<string, unknown>).question) : '';
      if (!question.trim()) return null;
      return { id: `c${i + 1}`, question: question.trim(), answer: null };
    })
    .filter((c): c is CampaignPlanClarification => c !== null)
    .slice(0, MAX_CLARIFICATIONS);
}

function normalizeForms(raw: unknown): CampaignPlanFormSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .slice(0, MAX_FORMS)
    .map((f, i): CampaignPlanFormSpec => ({
      key: `f${i + 1}`,
      purpose: asString(f.purpose, 'Lead form'),
      fields: asStringArray(f.fields, 6),
    }));
}

function normalizeLandingPages(raw: unknown): CampaignPlanLandingPageSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((lp): lp is Record<string, unknown> => Boolean(lp) && typeof lp === 'object')
    .slice(0, MAX_LANDING_PAGES)
    .map((lp, i): CampaignPlanLandingPageSpec => ({
      key: `lp${i + 1}`,
      purpose: asString(lp.purpose, 'Landing page'),
      headline: asString(lp.headline) || undefined,
      sections: asStringArray(lp.sections, 8),
      embeddedFormKey: asString(lp.embeddedFormKey) || undefined,
    }));
}

export interface GeneratedCampaignPlan {
  name: string;
  plan: CampaignPlan;
}

function normalizePlan(raw: unknown, channels: CampaignChannel[]): GeneratedCampaignPlan {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const allow = new Set(channels);

  const emails = allow.has('email') ? normalizeEmails(obj.emails) : [];
  const sms = allow.has('sms') ? normalizeSms(obj.sms) : [];
  const forms = allow.has('form') ? normalizeForms(obj.forms) : [];
  const landingPages = allow.has('landingPage') ? normalizeLandingPages(obj.landingPages) : [];

  // Reconcile the LP's embedded-form reference: if it points at a missing form
  // key (or none), default it to the single generated form (if any).
  const formKeys = new Set(forms.map((f) => f.key));
  for (const lp of landingPages) {
    if (!lp.embeddedFormKey || !formKeys.has(lp.embeddedFormKey)) {
      lp.embeddedFormKey = forms[0]?.key;
    }
  }

  const audienceRaw = (obj.audience && typeof obj.audience === 'object' ? obj.audience : {}) as Record<string, unknown>;

  const summary = asString(obj.summary, 'Multi-channel campaign');
  const name = asString(obj.name).trim() || summary.slice(0, 60) || 'New campaign';

  const plan: CampaignPlan = {
    version: CAMPAIGN_PLAN_VERSION,
    summary,
    emailFormat: 'html',
    audience: {
      description: asString(audienceRaw.description) || undefined,
      suggestedListId: null,
      suggestedAudienceId: null,
      estimatedSizeNote: asString(audienceRaw.estimatedSizeNote) || undefined,
    },
    clarifications: normalizeClarifications(obj.clarifications),
    emails,
    sms,
    landingPages,
    forms,
    flows: [],
  };

  return { name, plan };
}

/**
 * Generate a campaign build plan from a goal. Throws if the model returns no
 * usable JSON or an empty plan (no assets across the allowed channels).
 */
export async function generateCampaignPlan(input: {
  goal: string;
  accountContext?: string;
  channels: CampaignChannel[];
}): Promise<GeneratedCampaignPlan> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    system: buildSystemPrompt(input.channels),
    messages: [{ role: 'user', content: buildUserContent(input.goal, input.accountContext) }],
    temperature: 0.5,
    max_tokens: 2048,
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
  if (!content) throw new Error('Campaign planner returned an empty response');

  let parsed: unknown;
  try {
    parsed = parseAiJson(content);
  } catch {
    throw new Error('Campaign planner response was not valid JSON');
  }

  const result = normalizePlan(parsed, input.channels);
  if (result.plan.emails.length === 0 && result.plan.sms.length === 0) {
    throw new Error('Campaign planner produced no touchpoints');
  }
  return result;
}
