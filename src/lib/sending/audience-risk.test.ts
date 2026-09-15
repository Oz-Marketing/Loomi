import { describe, expect, it } from 'vitest';
import {
  audienceRiskIssues,
  isHardBounceError,
  AUDIENCE_RISK_CODES,
  type AudienceRisk,
} from './audience-risk';

/** A settled domain, nothing interesting, for tests to vary one field of. */
function risk(overrides: Partial<AudienceRisk> = {}): AudienceRisk {
  return {
    total: 1000,
    suppressed: 0,
    sendable: 1000,
    withHistory: 1000,
    neverMailed: 0,
    priorHardBounces: 0,
    historicalBounceRate: 0,
    unprovenShare: 0,
    warmupDay: null,
    warmupTotalDays: 14,
    ...overrides,
  };
}

describe('isHardBounceError', () => {
  // Strings taken verbatim from production rows.
  it('recognizes permanent failures', () => {
    expect(
      isHardBounceError(
        "bounce: 550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address",
      ),
    ).toBe(true);
    expect(isHardBounceError('bounce: 550 5.1.1 Not our Customer')).toBe(true);
    expect(isHardBounceError('bounce: 550 5.7.1 Relaying denied')).toBe(true);
    expect(
      isHardBounceError(
        'bounce: unable to get mx info: failed to get IPs from PTR record: lookup <nil>: unrecognized address',
      ),
    ).toBe(true);
    expect(isHardBounceError("bounce: 501 #5.1.3 Invalid character ('!') in username.")).toBe(true);
  });

  it('recognizes a reasonless hard bounce', () => {
    // The exact string maybeUpdateRecipientStatus writes when SendGrid sends
    // no reason: there is no SMTP code to match on.
    expect(isHardBounceError('bounce (hard)')).toBe(true);
  });

  it('does not count transient failures', () => {
    expect(
      isHardBounceError(
        "bounce: 452 4.2.2 The recipient's inbox is out of storage space. Please direct the recipient to https://support.google.com/mail/",
      ),
    ).toBe(false);
    expect(isHardBounceError('bounce: 421 4.7.0 Try again later')).toBe(false);
  });

  it('treats a full mailbox as soft even when it carries a 5.x.x code', () => {
    // 552 5.2.2 is a full inbox, not a dead address. Undercounting is the
    // safe direction for a check that can block a send.
    expect(
      isHardBounceError(
        "bounce: 552 5.2.2 The recipient's inbox is out of storage space and inactive.",
      ),
    ).toBe(false);
  });

  it('never counts a send-time infrastructure failure as a bounce', () => {
    // Production carries 254 of these from a connection-pool exhaustion. The
    // message never left; that says nothing about the address.
    expect(
      isHardBounceError(
        'Invalid `prisma.emailBlastRecipient.update()` invocation:\n\nToo many database connections opened: remaining connection slots are',
      ),
    ).toBe(false);
    expect(isHardBounceError('connect ETIMEDOUT')).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isHardBounceError(null)).toBe(false);
    expect(isHardBounceError(undefined)).toBe(false);
    expect(isHardBounceError('   ')).toBe(false);
  });
});

describe('audienceRiskIssues — measured bounce rate', () => {
  it('blocks a rotten list', () => {
    const issues = audienceRiskIssues(
      risk({ priorHardBounces: 200, historicalBounceRate: 0.2 }),
      'audiLayton',
    );
    const found = issues.find((i) => i.code === AUDIENCE_RISK_CODES.BOUNCE_RATE);
    expect(found?.severity).toBe('blocker');
  });

  it('warns rather than blocks at a merely bad rate', () => {
    const issues = audienceRiskIssues(
      risk({ priorHardBounces: 80, historicalBounceRate: 0.08 }),
      'audiLayton',
    );
    expect(issues.find((i) => i.code === AUDIENCE_RISK_CODES.BOUNCE_RATE)?.severity).toBe(
      'warning',
    );
  });

  it('is stricter while the domain is warming', () => {
    const modest = { priorHardBounces: 30, historicalBounceRate: 0.03 };
    // Settled: 3% is under the 5% bar, so nothing is said.
    expect(
      audienceRiskIssues(risk(modest), 'audiLayton').some(
        (i) => i.code === AUDIENCE_RISK_CODES.BOUNCE_RATE,
      ),
    ).toBe(false);
    // Warming: the same 3% clears the 2% bar.
    expect(
      audienceRiskIssues(risk({ ...modest, warmupDay: 7 }), 'audiLayton').some(
        (i) => i.code === AUDIENCE_RISK_CODES.BOUNCE_RATE,
      ),
    ).toBe(true);
  });

  it('says nothing when there is too little history to mean anything', () => {
    // historicalBounceRate is null below MIN_HISTORY_FOR_RATE — one bounce
    // out of three addresses is not a 33% bounce rate.
    const issues = audienceRiskIssues(
      risk({ withHistory: 3, priorHardBounces: 1, historicalBounceRate: null }),
      'audiLayton',
    );
    expect(issues.some((i) => i.code === AUDIENCE_RISK_CODES.BOUNCE_RATE)).toBe(false);
  });
});

describe('audienceRiskIssues — unproven audience', () => {
  // The Audi Layton shape: 4,781 addresses nobody had mailed, day 7 of 14.
  const audi = risk({
    total: 4781,
    sendable: 4781,
    withHistory: 0,
    neverMailed: 4781,
    historicalBounceRate: null,
    unprovenShare: 1,
    warmupDay: 7,
  });

  it('warns on a large untested list sent from a warming domain', () => {
    const found = audienceRiskIssues(audi, 'audiLayton').find(
      (i) => i.code === AUDIENCE_RISK_CODES.UNPROVEN_ON_WARMUP,
    );
    expect(found?.severity).toBe('warning');
    expect(found?.message).toContain('day 7 of 14');
  });

  it('never blocks it — every list is unproven once', () => {
    expect(audienceRiskIssues(audi, 'audiLayton').every((i) => i.severity === 'warning')).toBe(
      true,
    );
  });

  it('stays quiet once the domain has graduated', () => {
    expect(
      audienceRiskIssues({ ...audi, warmupDay: null }, 'audiLayton').some(
        (i) => i.code === AUDIENCE_RISK_CODES.UNPROVEN_ON_WARMUP,
      ),
    ).toBe(false);
  });

  it('stays quiet for a small send', () => {
    // Seeding a warming domain with a small batch is the RECOMMENDED move,
    // so warning about it would train people to ignore the warning.
    expect(
      audienceRiskIssues(
        { ...audi, total: 100, sendable: 100, neverMailed: 100 },
        'audiLayton',
      ).some((i) => i.code === AUDIENCE_RISK_CODES.UNPROVEN_ON_WARMUP),
    ).toBe(false);
  });
});

describe('audienceRiskIssues — suppressed share', () => {
  it('flags a list that is mostly dead weight', () => {
    const issues = audienceRiskIssues(
      risk({ total: 1000, suppressed: 400, sendable: 600, withHistory: 600 }),
      'audiLayton',
    );
    expect(issues.find((i) => i.code === AUDIENCE_RISK_CODES.MOSTLY_SUPPRESSED)?.severity).toBe(
      'warning',
    );
  });

  it('says nothing about a healthy list', () => {
    expect(
      audienceRiskIssues(risk({ total: 1000, suppressed: 20, sendable: 980, withHistory: 980 }), 'x'),
    ).toEqual([]);
  });
});
