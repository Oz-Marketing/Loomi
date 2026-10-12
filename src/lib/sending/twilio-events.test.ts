import { beforeEach, describe, expect, it, vi } from 'vitest';

// Which Twilio signals become opt-outs. Only a fact about the NUMBER may
// suppress it across the group; a STOP must be recorded even when its event
// was already logged (the earlier write may have failed after the log).

const recordSmsOptOut = vi.fn();
const eventCreate = vi.fn();
const recipientFindFirst = vi.fn();

vi.mock('@/lib/sending/opt-outs', () => ({
  recordSmsOptOut: (...a: unknown[]) => recordSmsOptOut(...a),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    smsEvent: { create: (...a: unknown[]) => eventCreate(...a) },
    smsBlastRecipient: {
      findFirst: (...a: unknown[]) => recipientFindFirst(...a),
      update: vi.fn(async () => ({})),
    },
    smsBlast: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    contact: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

const { processTwilioStatusCallback, processTwilioInbound } = await import('./twilio-events');

beforeEach(() => {
  recordSmsOptOut.mockReset().mockResolvedValue({});
  eventCreate.mockReset().mockResolvedValue({});
  recipientFindFirst.mockReset().mockResolvedValue({ id: 'r1', campaignId: 'c1', status: 'sent' });
});

const undelivered = (code: string) => ({
  MessageSid: `SM${code}`,
  MessageStatus: 'undelivered',
  To: '+18015550101',
  ErrorCode: code,
  accountKey: 'young-chev',
});

describe('Twilio status callbacks', () => {
  it('suppresses a number Twilio says is unknown or a landline', async () => {
    await processTwilioStatusCallback(undelivered('30005'));
    await processTwilioStatusCallback(undelivered('30006'));
    expect(recordSmsOptOut).toHaveBeenCalledTimes(2);
    expect(recordSmsOptOut.mock.calls[0][0]).toMatchObject({ reason: 'undelivered', phone: '+18015550101' });
  });

  it('does not suppress for carrier filtering or an unreachable phone', async () => {
    await processTwilioStatusCallback(undelivered('30007'));
    await processTwilioStatusCallback(undelivered('30003'));
    expect(recordSmsOptOut).not.toHaveBeenCalled();
  });
});

describe('Twilio inbound STOP', () => {
  const stop = { MessageSid: 'SMstop', From: '+18015550101', Body: 'STOP', accountKey: 'young-chev' };

  it('records the opt-out', async () => {
    const result = await processTwilioInbound(stop);
    expect(result.suppressed).toBe(true);
    expect(recordSmsOptOut.mock.calls[0][0]).toMatchObject({ reason: 'stop', source: 'twilio' });
  });

  it('records it even when the event was already logged', async () => {
    eventCreate.mockRejectedValue(new Error('Unique constraint failed'));
    const result = await processTwilioInbound(stop);
    expect(result.logged).toBe(false);
    expect(recordSmsOptOut).toHaveBeenCalledTimes(1);
  });

  it('ignores an ordinary reply', async () => {
    await processTwilioInbound({ ...stop, MessageSid: 'SMhi', Body: 'Thanks!' });
    expect(recordSmsOptOut).not.toHaveBeenCalled();
  });
});
