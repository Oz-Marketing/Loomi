import { describe, it, expect } from 'vitest';
import {
  CHANNEL_QUESTION_KEY,
  channelsFromPicked,
  composeBrief,
  fallbackIntake,
  normalizeAnswers,
  normalizeIntake,
} from './campaign-intake';

describe('normalizeIntake — a half-formed question is dropped, never repaired', () => {
  it('keeps a well-formed question and always appends the channel question', () => {
    const { questions } = normalizeIntake({
      questions: [
        {
          key: 'audience',
          question: 'Who should this reach?',
          help: 'Points it at the right people.',
          kind: 'single',
          options: [{ value: 'lapsed', label: 'Lapsed customers', hint: 'Not seen in a while' }, { label: 'Everyone' }],
          allowOther: true,
          optional: false,
        },
      ],
    });

    expect(questions).toHaveLength(2);
    expect(questions[0].key).toBe('audience');
    expect(questions[0].options.map((o) => o.value)).toEqual(['lapsed', 'everyone']);
    expect(questions[0].options[0].hint).toBe('Not seen in a while');
    expect(questions.at(-1)!.key).toBe(CHANNEL_QUESTION_KEY);
  });

  it('drops a question with no text, and one with fewer than two usable options', () => {
    const { questions } = normalizeIntake({
      questions: [
        { question: '', options: [{ label: 'a' }, { label: 'b' }] },
        { question: 'Only one choice?', options: [{ label: 'a' }] },
        { question: 'No options at all?' },
        { question: 'Real one?', options: [{ label: 'a' }, { label: 'b' }] },
      ],
    });
    expect(questions.map((q) => q.question)).toEqual(['Real one?', 'What should Loomi build?']);
  });

  it('caps the model at four questions, so the interview is never longer than five', () => {
    const { questions } = normalizeIntake({
      questions: Array.from({ length: 9 }, (_, i) => ({
        question: `Q${i}`,
        options: [{ label: 'a' }, { label: 'b' }],
      })),
    });
    expect(questions).toHaveLength(5);
    expect(questions.at(-1)!.key).toBe(CHANNEL_QUESTION_KEY);
  });

  it('refuses a duplicate key and a key colliding with the channel question', () => {
    const { questions } = normalizeIntake({
      questions: [
        { key: 'timing', question: 'When?', options: [{ label: 'a' }, { label: 'b' }] },
        { key: 'timing', question: 'When again?', options: [{ label: 'a' }, { label: 'b' }] },
        { key: CHANNEL_QUESTION_KEY, question: 'Which channels?', options: [{ label: 'a' }, { label: 'b' }] },
      ],
    });
    expect(questions.map((q) => q.question)).toEqual(['When?', 'What should Loomi build?']);
  });

  it('returns just the channel question when the model returns junk', () => {
    expect(normalizeIntake(null).questions.map((q) => q.key)).toEqual([CHANNEL_QUESTION_KEY]);
    expect(normalizeIntake({ questions: 'nope' }).questions).toHaveLength(1);
  });

  it('narrows the channel question to the channels actually allowed', () => {
    const { questions } = normalizeIntake({ questions: [] }, ['email', 'sms']);
    expect(questions[0].options.map((o) => o.value)).toEqual(['email', 'sms']);
  });
});

describe('fallbackIntake — the interview still opens when the model does not', () => {
  it('asks the four fixed things, ending on channels', () => {
    const { questions } = fallbackIntake();
    expect(questions.map((q) => q.key)).toEqual(['audience', 'offer', 'timing', CHANNEL_QUESTION_KEY]);
    expect(questions.every((q) => q.options.length >= 2)).toBe(true);
  });
});

describe('channelsFromPicked — an empty answer means all of them, not none', () => {
  it('keeps what was picked, in the allowed order', () => {
    expect(channelsFromPicked(['sms', 'email'])).toEqual(['email', 'sms']);
  });

  it('falls back to every channel when nothing was picked or nothing matches', () => {
    expect(channelsFromPicked([])).toEqual(['email', 'sms', 'landingPage', 'form', 'flow']);
    expect(channelsFromPicked(['carrier-pigeon'])).toEqual(['email', 'sms', 'landingPage', 'form', 'flow']);
    expect(channelsFromPicked(undefined)).toEqual(['email', 'sms', 'landingPage', 'form', 'flow']);
  });

  it('cannot widen past the allowed list', () => {
    expect(channelsFromPicked(['email', 'flow'], ['email', 'sms'])).toEqual(['email']);
  });
});

describe('normalizeAnswers / composeBrief — the answers become the goal the campaign keeps', () => {
  it('drops an answer with no question or no values', () => {
    expect(
      normalizeAnswers([
        { question: 'Who?', answers: ['Lapsed customers'] },
        { question: '', answers: ['x'] },
        { question: 'When?', answers: [] },
        { question: 'What?', answers: ['', '  '] },
      ]),
    ).toEqual([{ question: 'Who?', answers: ['Lapsed customers'] }]);
  });

  it('is the goal alone when nothing was answered', () => {
    expect(composeBrief('  Spring service push  ', [])).toBe('Spring service push');
  });

  it('appends one line per answered question', () => {
    expect(
      composeBrief('Spring service push', [
        { question: 'Who should this reach?', answers: ['Lapsed customers'] },
        { question: 'Is there an offer?', answers: ['A discount', '$30 off an oil change'] },
      ]),
    ).toBe(
      'Spring service push\n\n- Who should this reach? Lapsed customers\n- Is there an offer? A discount, $30 off an oil change',
    );
  });

  it('ignores a non-array payload', () => {
    expect(normalizeAnswers('nope')).toEqual([]);
    expect(normalizeAnswers(undefined)).toEqual([]);
  });
});
