import { describe, it, expect, vi } from 'vitest';

// These modules pull in prisma, the queue and the sending stack at import
// time. The functions under test are pure arithmetic over a counts object, so
// stub the world and keep the test a unit test.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/queue/boss', () => ({ getBoss: vi.fn() }));

import { resolveBlastStatus, type BlastCounts } from './email-blasts';
import { resolveSmsBlastStatus, type SmsBlastCounts } from './sms-blasts';

/**
 * There is no "Sent with errors". A blast that reached anyone is 'completed';
 * recipients it could not reach are bad addresses, counted and suppressed, and
 * never raised to the reader as an error. The only failure a blast reports is
 * one where nothing went out at all.
 */

function emailCounts(over: Partial<BlastCounts> = {}): BlastCounts {
  return {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    skipped: 0,
    firstError: '',
    ...over,
  };
}

function smsCounts(over: Partial<SmsBlastCounts> = {}): SmsBlastCounts {
  return {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    undelivered: 0,
    skipped: 0,
    firstError: '',
    ...over,
  };
}

describe('resolveBlastStatus — bounces are not send errors', () => {
  it('completes a blast that dispatched everything and bounced on some', () => {
    // Connor's screenshot, in numbers: 4,781 recipients, 1,132 bounced,
    // nothing failed to dispatch.
    expect(
      resolveBlastStatus(emailCounts({ total: 4781, sent: 3649, bounced: 1132 })),
    ).toBe('completed');
  });

  it('completes even when every single recipient bounced', () => {
    // Still not a send error — the messages all left. It is a dead list, which
    // the audience-risk preflight is the right place to shout about.
    expect(resolveBlastStatus(emailCounts({ total: 500, sent: 0, bounced: 500 }))).toBe(
      'completed',
    );
  });

  it('completes a blast where some recipients could not be dispatched', () => {
    // 27 of 4,781 — the drawer used to call this "Sent with errors".
    expect(
      resolveBlastStatus(emailCounts({ total: 4781, sent: 4754, failed: 27 })),
    ).toBe('completed');
  });

  it('completes a mix of failures and bounces', () => {
    expect(
      resolveBlastStatus(emailCounts({ total: 100, sent: 80, failed: 5, bounced: 15 })),
    ).toBe('completed');
  });

  it('still fails a blast where nothing could be dispatched at all', () => {
    expect(resolveBlastStatus(emailCounts({ total: 10, failed: 10 }))).toBe('failed');
  });

  it('keeps processing while anything is pending', () => {
    // Bounces from an earlier warm-up slice must not end a blast early.
    expect(
      resolveBlastStatus(emailCounts({ total: 100, pending: 40, sent: 50, bounced: 10 })),
    ).toBe('processing');
  });

  it('completes a blast whose audience was entirely skipped', () => {
    expect(resolveBlastStatus(emailCounts({ total: 30, skipped: 30 }))).toBe('completed');
  });
});

describe('resolveSmsBlastStatus — carrier refusals are not send errors', () => {
  it('completes a blast that sent and had numbers refuse it', () => {
    expect(
      resolveSmsBlastStatus(smsCounts({ total: 200, sent: 180, undelivered: 20 })),
    ).toBe('completed');
  });

  it('completes a blast where Twilio would not take some messages', () => {
    expect(resolveSmsBlastStatus(smsCounts({ total: 10, sent: 9, failed: 1 }))).toBe(
      'completed',
    );
  });

  it('still fails a blast where nothing could be sent', () => {
    expect(resolveSmsBlastStatus(smsCounts({ total: 10, failed: 10 }))).toBe('failed');
  });

  it('keeps processing while quiet-hours holds are pending', () => {
    expect(
      resolveSmsBlastStatus(
        smsCounts({ total: 100, pending: 30, sent: 60, undelivered: 10 }),
      ),
    ).toBe('processing');
  });
});
