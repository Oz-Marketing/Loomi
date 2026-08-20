import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => {
    if (v === 'CORRUPT') throw new Error('bad ciphertext');
    return `plain:${v}`;
  },
  encryptToken: (v: string) => v,
}));

const {
  SMS_PREFLIGHT_CODES,
  formatSmsPreflightBlockers,
  hasOptOutLanguage,
  preflightSmsBlast,
  segmentCount,
} = await import('./sms-preflight');

/** A fully compliant rooftop — the baseline each test degrades from. */
function readyAccount(overrides?: Record<string, unknown>) {
  return {
    key: 'audi-layton',
    dealer: 'Audi Layton',
    timezone: 'America/Denver',
    twilioAccountSid: 'ENCRYPTED_SID',
    twilioAuthToken: 'ENCRYPTED_TOKEN',
    twilioPhoneNumber: '+18015550100',
    twilioMessagingServiceSid: 'MG1234567890',
    ...overrides,
  };
}

// 2026-06-15T18:00:00Z = 12pm Denver / 2pm New York / 11am Los Angeles —
// comfortably inside the window everywhere in the lower 48.
const MIDDAY = new Date('2026-06-15T18:00:00Z');
// 2026-06-15T12:00:00Z = 6am Denver — a quiet-hours violation.
const EARLY = new Date('2026-06-15T12:00:00Z');

const GOOD = {
  message: 'August lease offers at Audi Layton. Reply STOP to opt out.',
  accountKeys: ['audi-layton'],
  recipients: [{ phone: '+18015550123' }],
  sendAt: MIDDAY,
};

function codes(
  issues: { code: string; severity: string }[],
  severity?: string,
) {
  return issues
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.code);
}

beforeEach(() => {
  findMany.mockReset();
  delete process.env.APP_PUBLIC_URL;
  process.env.NEXTAUTH_URL = 'https://studio.loomilm.com';
});

describe('hasOptOutLanguage', () => {
  it('accepts the common phrasings', () => {
    expect(hasOptOutLanguage('Deal! Reply STOP to opt out.')).toBe(true);
    expect(hasOptOutLanguage('Txt STOP to cancel')).toBe(true);
    expect(hasOptOutLanguage('Reply stop 2 end')).toBe(true);
    expect(hasOptOutLanguage('Click to unsubscribe')).toBe(true);
    expect(hasOptOutLanguage('You may opt-out anytime')).toBe(true);
  });

  it('rejects a message with no opt-out at all', () => {
    expect(hasOptOutLanguage('20% off oil changes through May!')).toBe(false);
  });

  // Guards the word boundary: "nonstop" must not read as an opt-out.
  it('does not match STOP inside another word', () => {
    expect(hasOptOutLanguage('Nonstop savings all month')).toBe(false);
  });
});

describe('segmentCount', () => {
  it('counts GSM-7 at 160 per segment', () => {
    expect(segmentCount('')).toBe(0);
    expect(segmentCount('a'.repeat(160))).toBe(1);
    expect(segmentCount('a'.repeat(161))).toBe(2);
  });

  it('drops to 70 per segment once there is a non-ASCII character', () => {
    expect(segmentCount('X' + 'a'.repeat(68) + 'é')).toBe(1);
    expect(segmentCount('é' + 'a'.repeat(70))).toBe(2);
  });
});

describe('preflightSmsBlast — the happy path', () => {
  it('passes a compliant blast from a configured rooftop', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast(GOOD);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.heldByQuietHours).toBe(0);
  });
});

describe('preflightSmsBlast — transport', () => {
  it('blocks a rooftop with no Twilio credentials', async () => {
    findMany.mockResolvedValue([
      readyAccount({ twilioAccountSid: null, twilioAuthToken: null }),
    ]);
    const result = await preflightSmsBlast(GOOD);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(SMS_PREFLIGHT_CODES.NO_TWILIO);
  });

  it('blocks credentials that will not decrypt', async () => {
    findMany.mockResolvedValue([readyAccount({ twilioAuthToken: 'CORRUPT' })]);
    const result = await preflightSmsBlast(GOOD);
    expect(codes(result.issues, 'blocker')).toContain(SMS_PREFLIGHT_CODES.BAD_TWILIO);
  });

  it('blocks when there is no number and no Messaging Service', async () => {
    findMany.mockResolvedValue([
      readyAccount({ twilioPhoneNumber: null, twilioMessagingServiceSid: null }),
    ]);
    const result = await preflightSmsBlast(GOOD);
    expect(codes(result.issues, 'blocker')).toContain(SMS_PREFLIGHT_CODES.NO_SENDER);
  });

  // A2P 10DLC registration attaches to a Messaging Service, but toll-free and
  // short-code setups legitimately lack one — so this informs rather than blocks.
  it('warns about a bare long code with no Messaging Service', async () => {
    findMany.mockResolvedValue([readyAccount({ twilioMessagingServiceSid: null })]);
    const result = await preflightSmsBlast(GOOD);
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toContain(
      SMS_PREFLIGHT_CODES.NO_MESSAGING_SERVICE,
    );
  });

  it('warns when no public URL exists for delivery receipts', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    delete process.env.NEXTAUTH_URL;
    const result = await preflightSmsBlast(GOOD);
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toContain(
      SMS_PREFLIGHT_CODES.NO_STATUS_CALLBACK,
    );
  });
});

describe('preflightSmsBlast — carrier compliance', () => {
  it('blocks an empty message', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({ ...GOOD, message: '   ' });
    expect(codes(result.issues, 'blocker')).toContain(SMS_PREFLIGHT_CODES.NO_MESSAGE);
  });

  it('blocks a message with no opt-out disclosure', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message: '20% off oil changes through May!',
    });
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(SMS_PREFLIGHT_CODES.NO_OPT_OUT);
  });

  it('warns about a message billed as many segments', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message: `Reply STOP to opt out. ${'a'.repeat(500)}`,
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find(
      (i) => i.code === SMS_PREFLIGHT_CODES.MANY_SEGMENTS,
    );
    expect(issue?.message).toContain('4 segments');
  });
});

describe('preflightSmsBlast — merge tags', () => {
  it('blocks an unrecognized tag', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message: 'Hi {{contact.frist_name}} — reply STOP to opt out.',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === SMS_PREFLIGHT_CODES.UNKNOWN_MERGETAG,
    );
    expect(issue?.message).toContain('{{contact.frist_name}}');
  });

  it('accepts valid contact tags', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message:
        'Hi {{contact.first_name}}, your {{contact.vehicle_make}} is due. Reply STOP to opt out.',
    });
    expect(result.ok).toBe(true);
  });

  // Carried over from the email editor, this tag is meaningless in SMS.
  it('blocks {{unsubscribe_link}} with SMS-specific advice', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message: 'Deals! {{unsubscribe_link}}',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) =>
      i.message.includes('{{unsubscribe_link}} does not work in SMS'),
    );
    expect(issue?.remedy).toContain('Reply STOP');
  });

  it('allows custom_values tags it cannot verify', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      message: 'Tier {{custom_values.loyalty_tier}}. Reply STOP to opt out.',
    });
    expect(result.ok).toBe(true);
  });
});

describe('preflightSmsBlast — TCPA quiet hours', () => {
  it('blocks a 6am send', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({ ...GOOD, sendAt: EARLY });
    expect(result.ok).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === SMS_PREFLIGHT_CODES.QUIET_HOURS,
    );
    expect(issue?.severity).toBe('blocker');
    expect(issue?.message).toContain('TCPA');
    // And it offers a compliant time to switch to.
    expect(result.suggestedSendAt).not.toBeNull();
    expect(result.heldByQuietHours).toBe(1);
  });

  it('downgrades to a warning once deferral is accepted', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightSmsBlast({
      ...GOOD,
      sendAt: EARLY,
      deferOutsideQuietHours: true,
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find(
      (i) => i.code === SMS_PREFLIGHT_CODES.QUIET_HOURS,
    );
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('held until 8am');
  });

  // The multi-timezone case: legal for part of the list, not the rest.
  it('blocks when only part of a multi-timezone list is inside the window', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    // 14:00Z = 10am New York (fine), 7am Los Angeles (violation).
    const result = await preflightSmsBlast({
      ...GOOD,
      recipients: [{ phone: '+12125550123' }, { phone: '+14155550123' }],
      sendAt: new Date('2026-06-15T14:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.heldByQuietHours).toBe(1);
    const issue = result.issues.find(
      (i) => i.code === SMS_PREFLIGHT_CODES.QUIET_HOURS,
    );
    expect(issue?.message).toContain('1 of 2');
  });

  it('warns when a recipient timezone cannot be determined', async () => {
    findMany.mockResolvedValue([readyAccount({ timezone: null })]);
    const result = await preflightSmsBlast({
      ...GOOD,
      recipients: [{ phone: '+447911123456' }],
    });
    expect(codes(result.issues, 'warning')).toContain(
      SMS_PREFLIGHT_CODES.UNKNOWN_TIMEZONE,
    );
    // Unknown zones don't block — see isWithinQuietHours.
    expect(result.ok).toBe(true);
  });

  it('falls back to the rooftop timezone for an unknown area code', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    // 12:00Z is 6am in Denver, so the account fallback catches this.
    const result = await preflightSmsBlast({
      ...GOOD,
      recipients: [{ phone: '+19995550123' }],
      sendAt: EARLY,
    });
    expect(result.heldByQuietHours).toBe(1);
    expect(codes(result.issues, 'blocker')).toContain(
      SMS_PREFLIGHT_CODES.QUIET_HOURS,
    );
  });
});

describe('preflightSmsBlast — multiple rooftops', () => {
  it('names the offending rooftop and passes the compliant one', async () => {
    findMany.mockResolvedValue([
      readyAccount(),
      readyAccount({
        key: 'vw-layton',
        dealer: 'VW Layton',
        twilioAccountSid: null,
        twilioAuthToken: null,
      }),
    ]);
    const result = await preflightSmsBlast({
      ...GOOD,
      accountKeys: ['audi-layton', 'vw-layton'],
    });
    expect(result.ok).toBe(false);
    const blockers = result.issues.filter((i) => i.severity === 'blocker');
    expect(blockers).toHaveLength(1);
    expect(blockers[0].accountKey).toBe('vw-layton');
    expect(blockers[0].message).toContain('VW Layton');
  });

  it('blocks a rooftop that no longer exists', async () => {
    findMany.mockResolvedValue([]);
    const result = await preflightSmsBlast({ ...GOOD, accountKeys: ['ghost'] });
    expect(result.ok).toBe(false);
  });
});

describe('formatSmsPreflightBlockers', () => {
  it('joins blockers and omits warnings', async () => {
    findMany.mockResolvedValue([
      readyAccount({
        twilioAccountSid: null,
        twilioAuthToken: null,
        twilioMessagingServiceSid: null,
      }),
    ]);
    const result = await preflightSmsBlast(GOOD);
    const text = formatSmsPreflightBlockers(result);
    expect(text).toContain('Twilio credentials');
    expect(text).not.toContain('A2P 10DLC');
  });

  it('is empty when nothing blocks', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    expect(formatSmsPreflightBlockers(await preflightSmsBlast(GOOD))).toBe('');
  });
});
