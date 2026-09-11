/**
 * AI Campaign Builder — the intake phase, before the plan.
 *
 * The builder used to take one paragraph and go. Everything it did not know it
 * either guessed or asked about afterwards, in the plan's `clarifications`,
 * where the answer arrives too late to shape the plan itself.
 *
 * So: one opening sentence from the person, then a short interview. Two to four
 * questions written for THIS goal and THIS account, plus one fixed question
 * about channels that we append ourselves — the answer to that one changes what
 * the planner is even allowed to propose, so it is never left to the model to
 * remember to ask.
 *
 * One model call for the whole set. A question per call would mean a spinner
 * between every tap, and the questions worth asking are all knowable up front.
 */
import { getAnthropicClient, ANTHROPIC_MODEL, lastTextBlock, parseAiJson } from '@/lib/anthropic';
import { PHASE_3_CHANNELS, type CampaignChannel } from '@/lib/campaigns/types';

/** Reserved key for the channel question we always append. */
export const CHANNEL_QUESTION_KEY = 'channels';

const MAX_MODEL_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export interface CampaignIntakeOption {
  /** Stable value stored in the answer. For the channel question, a CampaignChannel. */
  value: string;
  label: string;
  /** Optional half-line under the label. */
  hint?: string;
}

export interface CampaignIntakeQuestion {
  key: string;
  question: string;
  /** One line of context under the question. */
  help?: string;
  kind: 'single' | 'multi';
  options: CampaignIntakeOption[];
  /** Show a "Something else…" free-text box. */
  allowOther: boolean;
  /** Skippable — the plan is still buildable without it. */
  optional: boolean;
}

export interface CampaignIntake {
  questions: CampaignIntakeQuestion[];
}

const CHANNEL_LABEL: Record<CampaignChannel, { label: string; hint: string }> = {
  email: { label: 'Email', hint: 'One or a short sequence' },
  sms: { label: 'Text', hint: 'Short, with an opt-out' },
  landingPage: { label: 'Landing page', hint: 'Somewhere to send people' },
  form: { label: 'Form', hint: 'Capture the lead' },
  flow: { label: 'Flow', hint: 'An automated follow-up drip' },
};

/**
 * The channel question, appended to every intake. Not model-generated: its
 * answer narrows the planner's allowed channels, so it has to be there and it
 * has to use the real channel values.
 */
export function channelQuestion(channels: CampaignChannel[] = PHASE_3_CHANNELS): CampaignIntakeQuestion {
  return {
    key: CHANNEL_QUESTION_KEY,
    question: 'What should Loomi build?',
    help: 'Pick everything you want drafted. Leave it blank and Loomi decides.',
    kind: 'multi',
    options: channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c].label, hint: CHANNEL_LABEL[c].hint })),
    allowOther: false,
    optional: true,
  };
}

/**
 * The interview when the model is unavailable or unusable. The same four
 * things a strategist asks about before writing anything.
 */
export function fallbackIntake(channels: CampaignChannel[] = PHASE_3_CHANNELS): CampaignIntake {
  return {
    questions: [
      {
        key: 'audience',
        question: 'Who should this reach?',
        help: 'Loomi suggests a segment either way — this just points it at the right people.',
        kind: 'single',
        options: [
          { value: 'everyone', label: 'Everyone', hint: 'The whole contact list' },
          { value: 'past-customers', label: 'Past customers' },
          { value: 'lapsed', label: 'Lapsed customers', hint: 'Nobody has heard from them in a while' },
          { value: 'leads', label: 'Leads who never bought' },
        ],
        allowOther: true,
        optional: false,
      },
      {
        key: 'offer',
        question: 'Is there an offer or incentive?',
        help: 'Exact numbers matter here — Loomi never invents a price or a percentage.',
        kind: 'single',
        options: [
          { value: 'none', label: 'No offer', hint: 'Just the message' },
          { value: 'discount', label: 'A discount' },
          { value: 'free-add-on', label: 'Something free with a visit' },
          { value: 'event', label: 'An event or a date to show up' },
        ],
        allowOther: true,
        optional: false,
      },
      {
        key: 'timing',
        question: 'When does it run?',
        kind: 'single',
        options: [
          { value: 'asap', label: 'Start now' },
          { value: 'this-month', label: 'Sometime this month' },
          { value: 'fixed-date', label: 'Around a specific date' },
          { value: 'ongoing', label: 'Ongoing', hint: 'No end date — it keeps running' },
        ],
        allowOther: true,
        optional: false,
      },
      channelQuestion(channels),
    ],
  };
}

// ── Normalization ──────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

/** A slug usable as an answer key / option value. */
function slug(s: string, fallback: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return out || fallback;
}

function normalizeOptions(raw: unknown, qIndex: number): CampaignIntakeOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CampaignIntakeOption[] = [];
  for (const [i, o] of raw.entries()) {
    const obj = (o ?? {}) as Record<string, unknown>;
    const label = asString(obj.label).trim() || asString(o).trim();
    if (!label) continue;
    const value = slug(asString(obj.value).trim() || label, `q${qIndex}o${i}`);
    if (seen.has(value)) continue;
    seen.add(value);
    const hint = asString(obj.hint).trim();
    out.push({ value, label, ...(hint ? { hint } : {}) });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/**
 * Take whatever the model returned and make it renderable, then append the
 * channel question. Anything malformed is dropped rather than repaired — a
 * half-question is worse than one fewer question.
 */
export function normalizeIntake(raw: unknown, channels: CampaignChannel[] = PHASE_3_CHANNELS): CampaignIntake {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: CampaignIntakeQuestion[] = [];
  const seenKeys = new Set<string>([CHANNEL_QUESTION_KEY]);

  for (const [i, q] of rawQuestions.entries()) {
    const src = (q ?? {}) as Record<string, unknown>;
    const question = asString(src.question).trim();
    if (!question) continue;
    const options = normalizeOptions(src.options, i);
    if (options.length < MIN_OPTIONS) continue;

    const key = slug(asString(src.key).trim() || question, `q${i}`);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const help = asString(src.help).trim();
    questions.push({
      key,
      question,
      ...(help ? { help } : {}),
      kind: src.kind === 'multi' ? 'multi' : 'single',
      options,
      allowOther: src.allowOther !== false,
      optional: src.optional === true,
    });
    if (questions.length >= MAX_MODEL_QUESTIONS) break;
  }

  questions.push(channelQuestion(channels));
  return { questions };
}

function buildSystemPrompt(channels: CampaignChannel[]): string {
  return [
    "You are Loomi's campaign intake. A marketer has described, in one line, a campaign they want built for a local business. Before anything is drafted, you ask the few questions whose answers would most change what gets built.",
    '',
    `Ask 2-${MAX_MODEL_QUESTIONS} questions. Fewer is better when the description is already specific. Never ask something the description already answers, and never ask which channels to use — that question is asked separately.`,
    '',
    'A good question is one where a different answer produces a materially different campaign: who it targets, what the offer actually is, the date or deadline, which location or department, what you want the reader to do. A bad question is a preference the marketer has no reason to care about, or anything you could sensibly assume.',
    '',
    'Every question must be answerable by tapping one of the options you provide. Ground the options in the ACCOUNT CONTEXT — its real services, locations, and audiences — not generic marketing categories. Options are short: a few words, no sentences.',
    '',
    'Return ONLY a JSON object (no markdown fences, no prose):',
    '{',
    '  "questions": [ {',
    '     "key": string,          // short slug, e.g. "audience"',
    '     "question": string,     // the question, in plain words',
    '     "help": string,         // OPTIONAL one line of context under it, or ""',
    '     "kind": "single" | "multi",',
    `     "options": [ { "value": string, "label": string, "hint": string } ], // ${MIN_OPTIONS}-${MAX_OPTIONS}`,
    '     "allowOther": boolean,  // true if a free-text answer makes sense',
    '     "optional": boolean     // true if the campaign is buildable without it',
    '  } ]',
    '}',
    '',
    'RULES:',
    '- Put the question that most changes the campaign first.',
    '- Never ask for information you must not invent later (an exact price, a percentage, a legal disclaimer) as a multiple choice with invented numbers. Ask it with `allowOther: true` and options that are ranges or kinds, not fabricated specifics.',
    `- The channels available downstream are: ${channels.join(', ')}. Do not ask about them.`,
    '- No emojis anywhere.',
  ].join('\n');
}

/**
 * Ask for the interview. Never throws: an unusable answer falls back to the
 * fixed question set, because an intake that fails is a builder that will not
 * open.
 */
export async function generateCampaignIntake(input: {
  goal: string;
  accountContext?: string;
  channels?: CampaignChannel[];
}): Promise<CampaignIntake> {
  const channels = input.channels ?? PHASE_3_CHANNELS;
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: buildSystemPrompt(channels),
      messages: [
        {
          role: 'user',
          content: [
            'WHAT THEY WANT:',
            input.goal,
            '',
            'ACCOUNT CONTEXT:',
            input.accountContext || '(no account context provided)',
          ].join('\n'),
        },
      ],
      output_config: { effort: 'low' },
      max_tokens: 2000,
    });

    const content = lastTextBlock(response);
    if (!content) return fallbackIntake(channels);
    const intake = normalizeIntake(parseAiJson(content), channels);
    // Only the appended channel question survived — that is the fixed set's job.
    if (intake.questions.length <= 1) return fallbackIntake(channels);
    return intake;
  } catch {
    return fallbackIntake(channels);
  }
}

// ── Answers → brief ────────────────────────────────────────────────

/** One answered question, as the client sends it back: labels, not values. */
export interface CampaignIntakeAnswer {
  question: string;
  answers: string[];
}

/** The channels the person asked for, or all of them when they didn't say. */
export function channelsFromPicked(
  picked: unknown,
  allowed: CampaignChannel[] = PHASE_3_CHANNELS,
): CampaignChannel[] {
  const list = Array.isArray(picked) ? picked.filter((v): v is string => typeof v === 'string') : [];
  const kept = allowed.filter((c) => list.includes(c));
  return kept.length ? kept : allowed;
}

/** Trim the client's answer payload down to what is safe to put in a prompt. */
export function normalizeAnswers(raw: unknown): CampaignIntakeAnswer[] {
  if (!Array.isArray(raw)) return [];
  const out: CampaignIntakeAnswer[] = [];
  for (const item of raw) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const question = asString(obj.question).trim().slice(0, 300);
    const answers = (Array.isArray(obj.answers) ? obj.answers : [])
      .map((a) => asString(a).trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);
    if (!question || !answers.length) continue;
    out.push({ question, answers });
    if (out.length >= MAX_MODEL_QUESTIONS + 1) break;
  }
  return out;
}

/**
 * Fold the answers into the goal text the planner sees — and that the campaign
 * stores, so reopening it shows what was actually asked for rather than just
 * the opening line.
 */
export function composeBrief(goal: string, answers: CampaignIntakeAnswer[]): string {
  const lines = answers.map((a) => `- ${a.question} ${a.answers.join(', ')}`);
  return lines.length ? `${goal.trim()}\n\n${lines.join('\n')}` : goal.trim();
}
