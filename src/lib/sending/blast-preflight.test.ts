import { beforeEach, describe, expect, it, vi } from 'vitest';

// Preflight reads Account rows and decrypts the stored SendGrid key. Both are
// stubbed so these tests stay pure — the logic under test is the rule set, not
// Prisma or AES.
const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (value: string) => {
    if (value === 'CORRUPT') throw new Error('bad ciphertext');
    return `plain:${value}`;
  },
  encryptToken: (value: string) => value,
}));

const { PREFLIGHT_CODES, checkTextPart, formatPreflightBlockers, preflightEmailBlast } =
  await import('./blast-preflight');

/** A fully compliant account — the baseline each test degrades from. */
function readyAccount(overrides?: Record<string, unknown>) {
  return {
    key: 'audi-layton',
    dealer: 'Audi Layton',
    senderEmail: 'marketing@mktg.audilayton.com',
    sendgridApiKey: 'ENCRYPTED',
    sendgridFromDomain: 'mktg.audilayton.com',
    address: '1234 N Main St',
    city: 'Layton',
    state: 'UT',
    postalCode: '84041',
    ...overrides,
  };
}

const GOOD_CONTENT = {
  subject: 'August lease offers',
  htmlContent: '<p>Hi {{contact.first_name}}</p><a href="{{unsubscribe_link}}">Unsub</a>',
  textContent: 'Hi',
  accountKeys: ['audi-layton'],
};

function codes(issues: { code: string; severity: string }[], severity?: string) {
  return issues
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.code);
}

beforeEach(() => {
  findMany.mockReset();
});

describe('preflightEmailBlast — the happy path', () => {
  it('passes a fully configured account', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a From address on a subdomain of the authenticated domain', async () => {
    findMany.mockResolvedValue([
      readyAccount({
        senderEmail: 'marketing@mail.audilayton.com',
        sendgridFromDomain: 'audilayton.com',
      }),
    ]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
  });
});

describe('preflightEmailBlast — deliverability blockers', () => {
  // This is the exact configuration that sent a real blast to the spam folder:
  // no per-account key, so the send fell through to shared SMTP.
  it('blocks an account with no SendGrid key', async () => {
    findMany.mockResolvedValue([readyAccount({ sendgridApiKey: null })]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.NO_SENDGRID_KEY,
    );
  });

  it('blocks a key that will not decrypt', async () => {
    findMany.mockResolvedValue([readyAccount({ sendgridApiKey: 'CORRUPT' })]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.BAD_SENDGRID_KEY,
    );
  });

  it('blocks an account with no From address', async () => {
    findMany.mockResolvedValue([readyAccount({ senderEmail: '' })]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.NO_SENDER_EMAIL,
    );
  });

  it('blocks a From domain outside the authenticated one — DKIM cannot align', async () => {
    findMany.mockResolvedValue([
      readyAccount({
        senderEmail: 'marketing@gmail.com',
        sendgridFromDomain: 'mktg.audilayton.com',
      }),
    ]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.SENDER_DOMAIN_MISMATCH,
    );
  });

  // A near-match must not pass: "notaudilayton.com" ends with neither
  // "audilayton.com" nor ".audilayton.com" under the subdomain rule.
  it('does not treat a domain suffix collision as authenticated', async () => {
    findMany.mockResolvedValue([
      readyAccount({
        senderEmail: 'marketing@notaudilayton.com',
        sendgridFromDomain: 'audilayton.com',
      }),
    ]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.SENDER_DOMAIN_MISMATCH,
    );
  });

  it('warns — but does not block — when no authenticated domain is recorded', async () => {
    findMany.mockResolvedValue([readyAccount({ sendgridFromDomain: null })]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toContain(
      PREFLIGHT_CODES.NO_FROM_DOMAIN,
    );
  });
});

describe('preflightEmailBlast — CAN-SPAM address', () => {
  it('blocks when the mailing address is missing entirely', async () => {
    findMany.mockResolvedValue([
      readyAccount({ address: null, city: null, state: null, postalCode: null }),
    ]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.NO_PHYSICAL_ADDRESS,
    );
  });

  // The dangerous case: the footer builder joins whatever is present, so a
  // partial address renders and looks deliberate while still being illegal.
  it('blocks a partially filled address', async () => {
    findMany.mockResolvedValue([readyAccount({ postalCode: '' })]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.NO_PHYSICAL_ADDRESS,
    );
  });
});

describe('preflightEmailBlast — content', () => {
  it('blocks a missing subject', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({ ...GOOD_CONTENT, subject: '   ' });
    expect(codes(result.issues, 'blocker')).toContain(PREFLIGHT_CODES.NO_SUBJECT);
  });

  it('blocks a missing body', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({ ...GOOD_CONTENT, htmlContent: '' });
    expect(codes(result.issues, 'blocker')).toContain(PREFLIGHT_CODES.NO_BODY);
  });

  // A typo'd tag ships to the inbox as literal braces — the failure this whole
  // effort started from.
  it('blocks an unrecognized merge tag', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Hi {{contact.frist_name}}</p>',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === PREFLIGHT_CODES.UNKNOWN_MERGETAG,
    );
    expect(issue?.message).toContain('{{contact.frist_name}}');
  });

  it('catches a bad tag in the subject too', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      subject: 'Deal for {{contact.nope}}',
    });
    expect(codes(result.issues, 'blocker')).toContain(
      PREFLIGHT_CODES.UNKNOWN_MERGETAG,
    );
  });

  // Custom fields are per-contact, so preflight genuinely cannot verify them
  // from the account alone — blocking would be a false positive.
  it('allows custom_values.* tags it cannot verify', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Tier: {{custom_values.loyalty_tier}}</p>',
    });
    expect(result.ok).toBe(true);
  });

  it('names the intended tag when the namespace is wrong', async () => {
    // The real report that prompted this: {{email.unsubscribe_link}} is a
    // habit from other ESPs, and "check the variable picker" was not enough
    // to find the fix.
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<a href="{{email.unsubscribe_link}}">Unsub</a>',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unknown_mergetag');
    expect(issue?.remedy).toContain('{{email.unsubscribe_link}} → {{unsubscribe_link}}');
  });

  it('suggests the snake_case spelling for a camelCase tag', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Hi {{contact.firstName}}</p>',
    });
    const issue = result.issues.find((i) => i.code === 'unknown_mergetag');
    expect(issue?.remedy).toContain('{{contact.first_name}}');
  });

  it('falls back to generic advice when nothing is close', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>{{completely_made_up_thing}}</p>',
    });
    const issue = result.issues.find((i) => i.code === 'unknown_mergetag');
    expect(issue?.remedy).not.toContain('Did you mean');
    expect(issue?.remedy).toContain('variable picker');
  });

  it('accepts the tags the editor advertises', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent:
        '<p>{{contact.first_name}} {{contact.vehicle_make}} {{location.name}}</p>'
        + '<a href="{{unsubscribe_link}}">Unsub</a>',
    });
    expect(result.ok).toBe(true);
  });
});

describe('preflightEmailBlast — multiple accounts', () => {
  it('reports the offending account and passes the compliant one', async () => {
    findMany.mockResolvedValue([
      readyAccount(),
      readyAccount({
        key: 'vw-layton',
        dealer: 'VW Layton',
        sendgridApiKey: null,
      }),
    ]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      accountKeys: ['audi-layton', 'vw-layton'],
    });
    expect(result.ok).toBe(false);
    const blockers = result.issues.filter((i) => i.severity === 'blocker');
    expect(blockers).toHaveLength(1);
    expect(blockers[0].accountKey).toBe('vw-layton');
    expect(blockers[0].message).toContain('VW Layton');
  });

  it('blocks when a requested account no longer exists', async () => {
    findMany.mockResolvedValue([]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      accountKeys: ['ghost'],
    });
    expect(result.ok).toBe(false);
  });
});

describe('formatPreflightBlockers', () => {
  it('joins blockers and omits warnings', async () => {
    findMany.mockResolvedValue([
      readyAccount({ sendgridApiKey: null, sendgridFromDomain: null }),
    ]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    const text = formatPreflightBlockers(result);
    expect(text).toContain('SendGrid API key');
    expect(text).not.toContain('SPF/DKIM alignment');
  });

  it('is empty when nothing blocks', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(formatPreflightBlockers(result)).toBe('');
  });
});

describe('checkTextPart', () => {
  it('warns when no plaintext part is stored', () => {
    const issue = checkTextPart('<p>Hi</p>', '');
    expect(issue?.severity).toBe('warning');
    expect(issue?.code).toBe(PREFLIGHT_CODES.NO_TEXT_PART);
  });

  it('is silent when one exists', () => {
    expect(checkTextPart('<p>Hi</p>', 'Hi')).toBeNull();
  });

  it('is silent when there is no HTML either', () => {
    expect(checkTextPart('', '')).toBeNull();
  });
});
