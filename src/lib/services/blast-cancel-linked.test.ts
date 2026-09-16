import { beforeEach, describe, expect, it, vi } from 'vitest';

// A multi-channel blast is two rows — an EmailBlast and an SmsBlast linked
// through metadata — but the Blasts list COLLAPSES the pair into a single row
// anchored on the email and drops the SMS row entirely.
//
// That makes the cascade load-bearing rather than a nicety: cancel only the
// row the user clicked and the texts keep going, with no row left anywhere in
// the UI to stop them from.

const cancelEmail = vi.fn();
const cancelSms = vi.fn();
const getEmail = vi.fn();
const getSms = vi.fn();

vi.mock('./email-blasts', () => ({
  cancelEmailBlast: (...a: unknown[]) => cancelEmail(...a),
  getEmailBlast: (...a: unknown[]) => getEmail(...a),
}));

vi.mock('./sms-blasts', () => ({
  cancelSmsBlast: (...a: unknown[]) => cancelSms(...a),
  getSmsBlast: (...a: unknown[]) => getSms(...a),
}));

const { cancelBlastWithLinkedChannels } = await import('./blast-cancel');

const LINKED_EMAIL_META = JSON.stringify({
  multiChannel: true,
  linkedSmsBlastId: 'sms-1',
});
const LINKED_SMS_META = JSON.stringify({
  multiChannel: true,
  linkedEmailBlastId: 'email-1',
});

beforeEach(() => {
  for (const fn of [cancelEmail, cancelSms, getEmail, getSms]) fn.mockReset();
  cancelEmail.mockResolvedValue({ id: 'email-1', status: 'canceled' });
  cancelSms.mockResolvedValue({ id: 'sms-1', status: 'canceled' });
});

describe('cancelBlastWithLinkedChannels', () => {
  it('cancels the linked text blast when the email half is canceled', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: LINKED_EMAIL_META });
    getSms.mockResolvedValue({ id: 'sms-1', status: 'scheduled' });

    const result = await cancelBlastWithLinkedChannels('email', 'email-1');

    expect(cancelEmail).toHaveBeenCalledWith('email-1');
    expect(cancelSms).toHaveBeenCalledWith('sms-1');
    expect(result.canceledChannels).toEqual(['email', 'sms']);
    expect(result.partnerError).toBeUndefined();
  });

  it('cancels the linked email blast when the text half is canceled', async () => {
    getSms.mockResolvedValue({ id: 'sms-1', metadata: LINKED_SMS_META });
    getEmail.mockResolvedValue({ id: 'email-1', status: 'processing' });

    const result = await cancelBlastWithLinkedChannels('sms', 'sms-1');

    expect(cancelSms).toHaveBeenCalledWith('sms-1');
    expect(cancelEmail).toHaveBeenCalledWith('email-1');
    expect(result.canceledChannels).toEqual(['sms', 'email']);
  });

  it('leaves a single-channel blast alone', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: null });

    const result = await cancelBlastWithLinkedChannels('email', 'email-1');

    expect(cancelSms).not.toHaveBeenCalled();
    expect(result.canceledChannels).toEqual(['email']);
  });

  it('ignores a linked id on metadata that is not multi-channel', async () => {
    // Only multiChannel:true means the pair is one logical send. A stray
    // linked id without it must not reach across and cancel someone else's
    // blast.
    getEmail.mockResolvedValue({
      id: 'email-1',
      metadata: JSON.stringify({ linkedSmsBlastId: 'sms-1' }),
    });

    const result = await cancelBlastWithLinkedChannels('email', 'email-1');

    expect(cancelSms).not.toHaveBeenCalled();
    expect(result.canceledChannels).toEqual(['email']);
  });

  it('survives unparseable metadata', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: '{not json' });

    await expect(
      cancelBlastWithLinkedChannels('email', 'email-1'),
    ).resolves.toMatchObject({ canceledChannels: ['email'] });
  });

  it('skips a partner that is already canceled', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: LINKED_EMAIL_META });
    getSms.mockResolvedValue({ id: 'sms-1', status: 'canceled' });

    const result = await cancelBlastWithLinkedChannels('email', 'email-1');

    expect(cancelSms).not.toHaveBeenCalled();
    // Still reported as stopped — it is.
    expect(result.canceledChannels).toEqual(['email', 'sms']);
  });

  it('reports a partner failure without pretending the whole cancel failed', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: LINKED_EMAIL_META });
    getSms.mockResolvedValue({ id: 'sms-1', status: 'completed' });
    cancelSms.mockRejectedValue(new Error('already finished sending'));

    const result = await cancelBlastWithLinkedChannels('email', 'email-1');

    // The email really is canceled, so throwing here would be a lie. The
    // half that didn't stop comes back for the UI to say out loud.
    expect(result.canceledChannels).toEqual(['email']);
    expect(result.partnerError).toMatch(/already finished sending/);
  });

  it('propagates a failure on the blast the caller actually named', async () => {
    getEmail.mockResolvedValue({ id: 'email-1', metadata: LINKED_EMAIL_META });
    cancelEmail.mockRejectedValue(new Error('already finished sending'));

    await expect(
      cancelBlastWithLinkedChannels('email', 'email-1'),
    ).rejects.toThrow(/already finished sending/);
    expect(cancelSms).not.toHaveBeenCalled();
  });
});
