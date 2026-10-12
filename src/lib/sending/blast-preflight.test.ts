import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Preflight reads Account rows, contact custom-field definitions and keys,
// the footer config, decrypts the stored SendGrid key and asks SendGrid about
// the From domain. All of it is stubbed so these tests stay pure — the logic
// under test is the rule set, not Prisma, AES or the network.
const findMany = vi.fn();
const fieldDefinitions = vi.fn();
const contactFieldKeys = vi.fn();
const resolveAccountFooters = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: { findMany: (...args: unknown[]) => findMany(...args) },
    contactCustomField: { findMany: (...args: unknown[]) => fieldDefinitions(...args) },
    $queryRaw: (...args: unknown[]) => contactFieldKeys(...args),
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (value: string) => {
    if (value === 'CORRUPT') throw new Error('bad ciphertext');
    return `plain:${value}`;
  },
  encryptToken: (value: string) => value,
}));

vi.mock('@/lib/sending/account-footer', () => ({
  resolveAccountFooters: (...args: unknown[]) => resolveAccountFooters(...args),
}));

const { PREFLIGHT_CODES, checkTextPart, formatPreflightBlockers, preflightEmailBlast } =
  await import('./blast-preflight');
const { clearDomainAuthCache } = await import('./domain-auth');
const { DEFAULT_FOOTER_CONFIG } = await import('./unsubscribe-footer');

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

/** What SendGrid's authenticated-domain list answers, for every key. */
let sendgridDomains: () => Promise<Response>;
function sendgridAnswers(domains: { domain: string; valid: boolean; default?: boolean }[]) {
  sendgridDomains = async () => new Response(JSON.stringify(domains), { status: 200 });
}
function sendgridStatus(status: number) {
  sendgridDomains = async () => new Response('{}', { status });
}

beforeEach(() => {
  findMany.mockReset();
  fieldDefinitions.mockReset().mockResolvedValue([]);
  contactFieldKeys.mockReset().mockResolvedValue([]);
  resolveAccountFooters.mockReset().mockResolvedValue(new Map());
  clearDomainAuthCache();
  sendgridAnswers([{ domain: 'mktg.audilayton.com', valid: true }]);
  vi.stubGlobal('fetch', vi.fn(() => sendgridDomains()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preflightEmailBlast — the happy path', () => {
  it('passes a fully configured account', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts a subdomain From when SendGrid signs it with the account's default domain", async () => {
    findMany.mockResolvedValue([
      readyAccount({
        senderEmail: 'marketing@mail.audilayton.com',
        sendgridFromDomain: 'audilayton.com',
      }),
    ]);
    sendgridAnswers([{ domain: 'audilayton.com', valid: true, default: true }]);
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
});

describe('preflightEmailBlast — SendGrid domain authentication', () => {
  // The recorded "authenticated domain" was only ever compared as text; now
  // SendGrid is asked, with the account's own key.
  it('asks SendGrid with the account key', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    await preflightEmailBlast(GOOD_CONTENT);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain('/v3/whitelabel/domains');
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer plain:ENCRYPTED' });
  });

  it('blocks a From domain SendGrid has not authenticated, even when the recorded domain matches', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    sendgridAnswers([{ domain: 'othersite.com', valid: true }]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.SENDER_DOMAIN_UNAUTHENTICATED);
    expect(issue?.severity).toBe('blocker');
    expect(issue?.message).toContain('mktg.audilayton.com');
    expect(issue?.remedy).toContain('Sender Authentication');
  });

  it('blocks a domain whose DNS records no longer validate', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    sendgridAnswers([{ domain: 'mktg.audilayton.com', valid: false }]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.SENDER_DOMAIN_UNAUTHENTICATED);
    expect(issue?.message).toContain("DNS records don't validate");
  });

  // SendGrid's documented rule: subdomains don't inherit authentication.
  it('blocks a subdomain From covered only by a non-default parent', async () => {
    findMany.mockResolvedValue([
      readyAccount({ senderEmail: 'marketing@mail.audilayton.com', sendgridFromDomain: 'audilayton.com' }),
    ]);
    sendgridAnswers([{ domain: 'audilayton.com', valid: true }]);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(codes(result.issues, 'blocker')).toContain(PREFLIGHT_CODES.SENDER_DOMAIN_UNAUTHENTICATED);
  });

  it('blocks a key SendGrid rejects outright', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    sendgridStatus(401);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(codes(result.issues, 'blocker')).toContain(PREFLIGHT_CODES.BAD_SENDGRID_KEY);
  });

  it('only warns when SendGrid cannot be reached', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    sendgridStatus(503);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toEqual([PREFLIGHT_CODES.DOMAIN_AUTH_UNVERIFIED]);
  });

  it('only warns when the key cannot read Sender Authentication', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    sendgridStatus(403);
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.DOMAIN_AUTH_UNVERIFIED);
    expect(issue?.remedy).toContain('read access');
  });

  describe('falling back to the recorded domain when SendGrid is unreachable', () => {
    beforeEach(() => sendgridStatus(503));

    it('blocks a From domain outside the recorded one — DKIM cannot align', async () => {
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

  // H5: the preview text and the follow-up subject reach inboxes too, and
  // nothing checked them.
  it('catches a bad tag in the preview text', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      previewText: 'Just for you, {{contact.firstname}}',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.UNKNOWN_MERGETAG);
    expect(issue?.message).toContain('{{contact.firstname}} (preview text)');
    expect(issue?.remedy).toContain('{{contact.first_name}}');
  });

  it('catches a bad tag in the follow-up subject and says where to fix it', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      resendSubject: 'Still thinking it over, {{contact.first_name | shout}}?',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.MERGETAG_FILTER);
    expect(issue?.message).toContain('(follow-up subject');
    expect(issue?.remedy).toContain('Schedule step');
  });

  it('blocks an unsupported filter, which would otherwise ship literally', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Hi {{contact.first_name | shout}}</p>',
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.MERGETAG_FILTER);
    expect(issue?.severity).toBe('blocker');
    expect(issue?.message).toContain('"shout" is not a filter Loomi supports');
    expect(issue?.remedy).toContain('default: "fallback text"');
  });

  it('blocks a default whose fallback is not quoted', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Hi {{contact.first_name | default: there}}</p>',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.MERGETAG_FILTER);
    expect(issue?.message).toContain('the default needs one fallback, in quotes');
  });

  it('accepts supported filters, including escaped quotes from the renderer', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent:
        '<p>Hi {{contact.first_name | default: &quot;there&quot; | title}}, {{location.name | upper}}</p>',
    });
    expect(result.ok).toBe(true);
  });

  it('blocks template syntax Loomi does not run', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '{{#if vip}}<p>VIP</p>{{/if}}',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.UNKNOWN_MERGETAG);
    expect(issue?.message).toContain('{{#if vip}}');
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

describe('preflightEmailBlast — custom values', () => {
  const TIER = { ...GOOD_CONTENT, htmlContent: '<p>Tier: {{custom_values.loyalty_tier}}</p>' };

  // C1: the preview filled these from the account; the send from the contact
  // only. A tag nothing can fill is almost always a typo, and every recipient
  // would see a blank where the copy expects a value.
  it('blocks a custom value no account defines and no contact carries', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast(TIER);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.UNRESOLVED_CUSTOM_VALUE);
    expect(issue?.severity).toBe('blocker');
    expect(issue?.message).toContain('{{custom_values.loyalty_tier}}');
    expect(issue?.remedy).toContain('default:');
  });

  it("accepts one the account defines — matched regardless of the key's spelling", async () => {
    findMany.mockResolvedValue([
      readyAccount({ customValues: JSON.stringify({ 'Loyalty Tier': { name: 'Tier', value: 'Gold' } }) }),
    ]);
    const result = await preflightEmailBlast(TIER);
    expect(result.ok).toBe(true);
    expect(fieldDefinitions).not.toHaveBeenCalled();
  });

  it('accepts the account-derived standard values', async () => {
    findMany.mockResolvedValue([readyAccount({ servicePhone: '(801) 555-0102' })]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Call {{custom_values.service_phone}}</p>',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a defined contact custom field without scanning contacts', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    fieldDefinitions.mockResolvedValue([{ accountKey: 'audi-layton', key: 'loyalty_tier', label: 'Loyalty Tier' }]);
    const result = await preflightEmailBlast(TIER);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(contactFieldKeys).not.toHaveBeenCalled();
  });

  it('warns when only some contacts carry it (a raw CSV column)', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    contactFieldKeys.mockResolvedValue([{ accountKey: 'audi-layton', key: 'Loyalty Tier' }]);
    const result = await preflightEmailBlast(TIER);
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toEqual([PREFLIGHT_CODES.CUSTOM_VALUE_PARTIAL]);
  });

  it('skips the check when every use has a fallback', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Tier: {{custom_values.loyalty_tier | default: "Member"}}</p>',
    });
    expect(result.ok).toBe(true);
    expect(fieldDefinitions).not.toHaveBeenCalled();
  });

  it('warns about the one account in a group blast that lacks the value', async () => {
    findMany.mockResolvedValue([
      readyAccount({ servicePhone: '(801) 555-0102' }),
      readyAccount({ key: 'vw-layton', dealer: 'VW Layton', servicePhone: null }),
    ]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<p>Call {{custom_values.service_phone}}</p>',
      accountKeys: ['audi-layton', 'vw-layton'],
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.CUSTOM_VALUE_MISSING);
    expect(issue?.accountKey).toBe('vw-layton');
    expect(issue?.message).toContain('VW Layton');
  });

  it('checks custom values in the subject and preview text too', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({ ...GOOD_CONTENT, previewText: 'Your {{custom_values.loyalty_tier}} perks' });
    expect(codes(result.issues, 'blocker')).toContain(PREFLIGHT_CODES.UNRESOLVED_CUSTOM_VALUE);
  });

  it("only warns when the contact lookup itself fails — it can't prove a typo", async () => {
    findMany.mockResolvedValue([readyAccount()]);
    contactFieldKeys.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflightEmailBlast(TIER);
    spy.mockRestore();
    expect(result.ok).toBe(true);
    expect(codes(result.issues, 'warning')).toContain(PREFLIGHT_CODES.UNRESOLVED_CUSTOM_VALUE);
  });
});

describe('preflightEmailBlast — content hygiene', () => {
  it('warns about images hosted on GoHighLevel', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent:
        '<img src="https://assets.cdn.filesafe.space/LsN8m/media/logo.png">'
        + '<img src="https://storage.googleapis.com/msgsndr/abc/media/hero.jpg">'
        + '<img src="https://cdn.loomi/fine.png">',
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.GHL_HOSTED_IMAGE);
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('2 images are hosted on GoHighLevel');
    expect(issue?.remedy).toContain('Loomi media library');
  });

  it("warns when an account's own logo still points at GoHighLevel", async () => {
    findMany.mockResolvedValue([
      readyAccount({ logos: JSON.stringify({ light: 'https://assets.cdn.filesafe.space/x/logo.png' }) }),
    ]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<img src="{{custom_values.logo_url}}" alt="logo">',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.GHL_HOSTED_IMAGE);
    expect(issue?.accountKey).toBe('audi-layton');
    expect(issue?.message).toContain('filesafe.space');
  });

  it('warns about links to GoHighLevel-hosted pages', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<a href="https://api.leadconnectorhq.com/widget/booking/abc">Book</a>',
    });
    expect(codes(result.issues, 'warning')).toContain(PREFLIGHT_CODES.GHL_HOSTED_LINK);
  });

  it('warns about the editor placeholder image and placeholder services', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent:
        '<img src="https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image%20placeholder.png">'
        + '<img src="https://via.placeholder.com/600x200">',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.PLACEHOLDER_IMAGE);
    expect(issue?.message).toContain('2 images still show');
  });

  it('warns about buttons that go nowhere', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<a href="#">Book now</a><a href="">Call</a><a href="#map">Map</a>',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.EMPTY_LINK);
    expect(issue?.message).toContain('2 buttons or links go nowhere');
  });

  it('warns when a link tag is empty for an account', async () => {
    findMany.mockResolvedValue([readyAccount({ website: null })]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<a href="{{location.website}}">Visit us</a>',
    });
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.EMPTY_LINK);
    expect(issue?.accountKey).toBe('audi-layton');
    expect(issue?.message).toContain('{{location.website}}');
  });

  it('is quiet about a link tag the account fills', async () => {
    findMany.mockResolvedValue([readyAccount({ website: 'audilayton.com' })]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent: '<a href="{{location.website}}">Visit us</a>',
    });
    expect(result.issues).toEqual([]);
  });

  it('warns about a leftover offers placeholder', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    const result = await preflightEmailBlast({
      ...GOOD_CONTENT,
      htmlContent:
        '<div>This month\u{2019}s offers appear here</div><div>One card per offer \u{2014} vehicle, payment, program terms and disclosure \u{2014} plus the button to your inventory.</div>',
    });
    expect(codes(result.issues, 'warning')).toContain(PREFLIGHT_CODES.OFFERS_PLACEHOLDER);
  });
});

describe('preflightEmailBlast — footer legibility', () => {
  it('warns when the footer text would disappear into its background', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    resolveAccountFooters.mockResolvedValue(
      new Map([
        ['audi-layton', { config: { ...DEFAULT_FOOTER_CONFIG, textColor: '#ffffff' }, sourceAccountKey: 'audi-layton', inherited: false }],
      ]),
    );
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.code === PREFLIGHT_CODES.FOOTER_LOW_CONTRAST);
    expect(issue?.accountKey).toBe('audi-layton');
    expect(issue?.message).toContain('text color');
    expect(issue?.remedy).toContain('Email Footer');
  });

  it('is quiet about a legible footer', async () => {
    findMany.mockResolvedValue([readyAccount()]);
    resolveAccountFooters.mockResolvedValue(
      new Map([['audi-layton', { config: DEFAULT_FOOTER_CONFIG, sourceAccountKey: null, inherited: false }]]),
    );
    const result = await preflightEmailBlast(GOOD_CONTENT);
    expect(result.issues).toEqual([]);
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
  // It warned on essentially every blast and pointed at a field the Message
  // step doesn't have. The worker now generates a real text part.
  it('no longer warns: the text part is generated properly', () => {
    expect(checkTextPart('<p>Hi</p>', '')).toBeNull();
    expect(checkTextPart('<p>Hi</p>', 'Hi')).toBeNull();
    expect(checkTextPart('', '')).toBeNull();
  });
});
