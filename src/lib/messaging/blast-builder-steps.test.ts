import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_CONFIRMED_KEY,
  builderBlastId,
  builderChannel,
  builderCompletion,
  builderStep,
  builderStepHref,
  isAudienceConfirmed,
  isBuilderPath,
  isEditableBlastStatus,
  lockedBlastMessage,
  parseBuilderPath,
  reachableSteps,
} from './blast-builder-steps';

// These tests exist because of a specific regression: the builder routes were
// renamed from /messaging/campaigns/... to /messaging/blasts/... and the step
// matcher wasn't updated, so it matched nothing, fell through to its default,
// and pinned the progress nav to "Recipients" on every step. It failed
// silently — no error, no type error, just a wrong-looking header. A rename
// that skips this module now fails here instead.

describe('parseBuilderPath', () => {
  it('reads the email builder steps', () => {
    expect(parseBuilderPath('/messaging/blasts/abc123/recipients')).toEqual({
      channel: 'email',
      id: 'abc123',
      step: 'recipients',
    });
    // Routed as `template`, presented as "Message".
    expect(parseBuilderPath('/messaging/blasts/abc123/template')).toEqual({
      channel: 'email',
      id: 'abc123',
      step: 'message',
    });
    expect(parseBuilderPath('/messaging/blasts/abc123/schedule')).toEqual({
      channel: 'email',
      id: 'abc123',
      step: 'schedule',
    });
  });

  it('reads the sms builder steps', () => {
    expect(parseBuilderPath('/messaging/blasts/sms/s1/message')).toEqual({
      channel: 'sms',
      id: 's1',
      step: 'message',
    });
  });

  it('reads the multi builder steps', () => {
    expect(parseBuilderPath('/messaging/blasts/multi/m1/schedule')).toEqual({
      channel: 'multi',
      id: 'm1',
      step: 'schedule',
    });
  });

  // The email pattern's id segment is [^/]+, which would match the literal
  // "sms"/"multi" segments if the channel patterns weren't tested first.
  it('does not mistake a channel segment for a blast id', () => {
    expect(parseBuilderPath('/messaging/blasts/sms/s1/recipients')?.channel)
      .toBe('sms');
    expect(parseBuilderPath('/messaging/blasts/multi/m1/recipients')?.channel)
      .toBe('multi');
  });

  it('handles the sub-account prefix', () => {
    expect(
      parseBuilderPath('/subaccount/audi-layton/messaging/blasts/abc/template'),
    ).toEqual({ channel: 'email', id: 'abc', step: 'message' });
  });

  it('returns null for non-builder paths', () => {
    expect(parseBuilderPath('/messaging/blasts')).toBeNull();
    expect(parseBuilderPath('/messaging/blasts/abc')).toBeNull();
    expect(parseBuilderPath('/messaging/blasts/abc/analytics')).toBeNull();
    expect(parseBuilderPath('/contacts')).toBeNull();
    // The pre-rename path must NOT match — if the folders ever move back,
    // that's a deliberate change and this list has to move with them.
    expect(parseBuilderPath('/messaging/campaigns/abc/template')).toBeNull();
  });
});

describe('builderStep', () => {
  it('reports the real step rather than defaulting to recipients', () => {
    expect(builderStep('/messaging/blasts/abc/template')).toBe('message');
    expect(builderStep('/messaging/blasts/abc/schedule')).toBe('schedule');
    expect(builderStep('/messaging/blasts/sms/s1/schedule')).toBe('schedule');
  });

  it('falls back to recipients off the builder', () => {
    expect(builderStep('/contacts')).toBe('recipients');
  });
});

describe('builderChannel', () => {
  it('classifies each channel', () => {
    expect(builderChannel('/messaging/blasts/abc/template')).toBe('email');
    expect(builderChannel('/messaging/blasts/sms/s1/message')).toBe('sms');
    expect(builderChannel('/messaging/blasts/multi/m1/message')).toBe('multi');
  });
});

describe('builderBlastId', () => {
  it('extracts the id per channel', () => {
    expect(builderBlastId('/messaging/blasts/abc/template')).toBe('abc');
    expect(builderBlastId('/messaging/blasts/sms/s1/message')).toBe('s1');
    expect(builderBlastId('/subaccount/x/messaging/blasts/abc/schedule')).toBe('abc');
  });

  it('is empty off the builder', () => {
    expect(builderBlastId('/contacts')).toBe('');
  });
});

describe('isBuilderPath', () => {
  it('gates the full-screen chrome on real step routes only', () => {
    expect(isBuilderPath('/messaging/blasts/abc/recipients')).toBe(true);
    expect(isBuilderPath('/messaging/blasts')).toBe(false);
  });
});

describe('builderStepHref', () => {
  it('maps the email message step back onto /template', () => {
    expect(
      builderStepHref('/messaging/blasts/abc/schedule', 'email', 'message'),
    ).toBe('/messaging/blasts/abc/template');
  });

  it('round-trips every email step', () => {
    const from = '/messaging/blasts/abc/template';
    expect(builderStepHref(from, 'email', 'recipients'))
      .toBe('/messaging/blasts/abc/recipients');
    expect(builderStepHref(from, 'email', 'schedule'))
      .toBe('/messaging/blasts/abc/schedule');
  });

  it('keeps sms and multi on their own segment', () => {
    expect(builderStepHref('/messaging/blasts/sms/s1/schedule', 'sms', 'message'))
      .toBe('/messaging/blasts/sms/s1/message');
    expect(
      builderStepHref('/messaging/blasts/multi/m1/recipients', 'multi', 'schedule'),
    ).toBe('/messaging/blasts/multi/m1/schedule');
  });

  it('preserves the sub-account prefix', () => {
    expect(
      builderStepHref(
        '/subaccount/audi-layton/messaging/blasts/abc/recipients',
        'email',
        'schedule',
      ),
    ).toBe('/subaccount/audi-layton/messaging/blasts/abc/schedule');
  });

  it('returns the path unchanged when it is not a builder path', () => {
    expect(builderStepHref('/contacts', 'email', 'schedule')).toBe('/contacts');
  });
});

describe('reachableSteps', () => {
  it('locks everything past recipients on a fresh draft', () => {
    const r = reachableSteps({ hasRecipients: false, hasMessage: false });
    expect([...r]).toEqual(['recipients']);
  });

  it('unlocks message once an audience is saved', () => {
    const r = reachableSteps({ hasRecipients: true, hasMessage: false });
    expect(r.has('message')).toBe(true);
    expect(r.has('schedule')).toBe(false);
  });

  it('unlocks schedule only when both prerequisites are met', () => {
    const r = reachableSteps({ hasRecipients: true, hasMessage: true });
    expect([...r].sort()).toEqual(['message', 'recipients', 'schedule']);
  });

  // Guards the forward-jump rule: a message with no audience must not open
  // Schedule, since the server would reject the send for missing recipients.
  it('does not unlock schedule from a message alone', () => {
    const r = reachableSteps({ hasRecipients: false, hasMessage: true });
    expect(r.has('schedule')).toBe(false);
    expect(r.has('message')).toBe(false);
  });
});

// The Recipients step used to count as done the moment a draft had an
// account — which is at creation — so the header let you skip straight past
// it, and an untouched draft resolves to the whole account. These pin the
// replacement signal.
describe('isAudienceConfirmed', () => {
  const confirmed = JSON.stringify({ [AUDIENCE_CONFIRMED_KEY]: true });
  const base = { accountKeys: ['acct'], metadata: confirmed };

  it('is false for a fresh draft that only has its account stamped', () => {
    expect(isAudienceConfirmed({ accountKeys: ['acct'], metadata: '' })).toBe(false);
    expect(
      isAudienceConfirmed({ accountKeys: ['acct'], metadata: JSON.stringify({ multiChannel: true }) }),
    ).toBe(false);
  });

  it('is true once the Recipients step saved "All Contacts"', () => {
    expect(isAudienceConfirmed(base)).toBe(true);
  });

  it('is true for a saved list, segment, or hand-picked contacts', () => {
    expect(isAudienceConfirmed({ ...base, sourceListId: 'l1' })).toBe(true);
    expect(isAudienceConfirmed({ ...base, sourceContactIds: '["c1"]' })).toBe(true);
    expect(
      isAudienceConfirmed({
        ...base,
        sourceFilter: JSON.stringify({ version: 1, groups: [] }),
      }),
    ).toBe(true);
  });

  it('is false for an empty hand-picked selection even with the flag', () => {
    expect(isAudienceConfirmed({ ...base, sourceContactIds: '[]' })).toBe(false);
  });

  it('is false for a segment that cannot be read (it resolves to nobody)', () => {
    expect(isAudienceConfirmed({ ...base, sourceFilter: 'not json' })).toBe(false);
  });

  it('is false without an account, or with the flag set to anything but true', () => {
    expect(isAudienceConfirmed({ accountKeys: [], metadata: confirmed })).toBe(false);
    expect(
      isAudienceConfirmed({ accountKeys: ['a'], metadata: JSON.stringify({ [AUDIENCE_CONFIRMED_KEY]: 'yes' }) }),
    ).toBe(false);
    expect(isAudienceConfirmed(null)).toBe(false);
  });
});

describe('builderCompletion', () => {
  const audience = { accountKeys: ['a'], metadata: JSON.stringify({ [AUDIENCE_CONFIRMED_KEY]: true }) };

  it('needs a subject AND a body for email', () => {
    expect(builderCompletion('email', { ...audience, subject: 'Hi', htmlContent: '' }).hasMessage).toBe(false);
    expect(builderCompletion('email', { ...audience, subject: ' ', htmlContent: '<p>x</p>' }).hasMessage).toBe(false);
    expect(builderCompletion('multi', { ...audience, subject: 'Hi', htmlContent: '<p>x</p>' })).toEqual({
      hasRecipients: true,
      hasMessage: true,
    });
  });

  it('needs the message for a text', () => {
    expect(builderCompletion('sms', { ...audience, message: '  ' }).hasMessage).toBe(false);
    expect(builderCompletion('sms', { ...audience, message: 'Sale!' }).hasMessage).toBe(true);
  });

  it('reports recipients only when confirmed', () => {
    expect(builderCompletion('sms', { accountKeys: ['a'], message: 'x' }).hasRecipients).toBe(false);
  });
});

describe('isEditableBlastStatus', () => {
  it('only lets a draft change', () => {
    expect(isEditableBlastStatus('draft')).toBe(true);
    for (const s of ['queued', 'scheduled', 'processing', 'completed', 'partial', 'failed', 'canceled', '', undefined]) {
      expect(isEditableBlastStatus(s)).toBe(false);
    }
  });
});

describe('lockedBlastMessage', () => {
  it('offers Cancel only while there is still a send to cancel', () => {
    expect(lockedBlastMessage('scheduled')).toMatch(/Cancel it to make changes/);
    expect(lockedBlastMessage('processing')).toMatch(/Cancel it/);
    expect(lockedBlastMessage('canceled')).not.toMatch(/Cancel it/);
    expect(lockedBlastMessage('completed')).toMatch(/Duplicate it/);
  });
});
