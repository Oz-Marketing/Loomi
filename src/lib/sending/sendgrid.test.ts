import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { account: {} } }));
vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

import {
  clearSendGridSuppression,
  sendEmailViaSendGrid,
  SendGridError,
} from './sendgrid';
import { UNSUBSCRIBE_TOKEN } from './unsubscribe-footer';

const BASE = {
  apiKey: 'SG.test',
  from: { email: 'sales@youngchevy.com' },
  to: { email: 'buyer@example.com' },
  subject: 'August deals',
  html: '<p>Deals</p>',
};

function accepted() {
  return {
    status: 202,
    headers: new Headers({ 'x-message-id': 'msg-1' }),
    json: async () => ({}),
  } as unknown as Response;
}

function failure(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: new Headers(headers),
    json: async () => ({ errors: [{ message: `boom ${status}` }] }),
  } as unknown as Response;
}

/** The JSON body of the Nth fetch call. */
function sentBody(call = 0) {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendEmailViaSendGrid — subscription tracking payload', () => {
  it('sends substitution_tag ALONE, never alongside text/html', async () => {
    // The regression: passing text/html together with substitution_tag made
    // SendGrid silently discard the footer (it documents substitution_tag as
    // overriding both), so the CAN-SPAM postal address never shipped. The
    // footer now lives in the body; this payload must stay minimal.
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(accepted());

    await sendEmailViaSendGrid({
      ...BASE,
      unsubscribe: { substitutionTag: UNSUBSCRIBE_TOKEN },
    });

    const tracking = sentBody().tracking_settings.subscription_tracking;
    expect(tracking.enable).toBe(true);
    expect(tracking.substitution_tag).toBe(UNSUBSCRIBE_TOKEN);
    expect(tracking).not.toHaveProperty('html');
    expect(tracking).not.toHaveProperty('text');
  });

  it('omits subscription_tracking entirely for transactional sends', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(accepted());

    await sendEmailViaSendGrid(BASE);

    expect(sentBody().tracking_settings).not.toHaveProperty(
      'subscription_tracking',
    );
  });
});

describe('sendEmailViaSendGrid — retries', () => {
  it('retries a 429 and succeeds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValueOnce(accepted());

    const promise = sendEmailViaSendGrid(BASE);
    await vi.runAllTimersAsync();

    expect((await promise).messageId).toBe('msg-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and succeeds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(failure(503))
      .mockResolvedValueOnce(accepted());

    const promise = sendEmailViaSendGrid(BASE);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({ messageId: 'msg-1' });
  });

  it('gives up after 3 attempts and surfaces the error', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(failure(429));

    const promise = sendEmailViaSendGrid(BASE);
    const assertion = expect(promise).rejects.toBeInstanceOf(SendGridError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a 400 — a bad payload will never succeed', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(failure(400));

    await expect(sendEmailViaSendGrid(BASE)).rejects.toThrow('boom 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 401 — the key is wrong, not busy', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(failure(401));

    await expect(sendEmailViaSendGrid(BASE)).rejects.toThrow('boom 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a network error — the mail may already be queued', async () => {
    // Retrying an ambiguous failure risks sending a real customer the same
    // blast twice, which is worse than a failed row the user can re-run.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(sendEmailViaSendGrid(BASE)).rejects.toThrow('socket hang up');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After on a 429', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(failure(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(accepted());

    const promise = sendEmailViaSendGrid(BASE);

    // Still waiting one tick before the advertised delay elapses.
    await vi.advanceTimersByTimeAsync(1_900);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('clearSendGridSuppression', () => {
  // Deleting only the local row left SendGrid still dropping the mail, so
  // the operator saw "sent" while the customer got nothing.
  function noContent() {
    return { status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response;
  }

  function calledUrl(call = 0) {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls[call][0] as string;
  }

  it('clears the global list for an unsubscribe', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(noContent());

    const out = await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'unsubscribe',
    });

    expect(out.errors).toEqual([]);
    expect(calledUrl()).toContain('/asm/suppressions/global/buyer%40example.com');
  });

  it('clears the bounces list for a bounce', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(noContent());

    await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'bounce',
    });

    expect(calledUrl()).toContain('/suppression/bounces/');
  });

  it('clears the spam_reports list for a spam report', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(noContent());

    await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'spamreport',
    });

    expect(calledUrl()).toContain('/suppression/spam_reports/');
  });

  it('makes no call for a manual row — it never existed upstream', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    const out = await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'manual',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.errors).toEqual([]);
  });

  it('treats 404 as already-cleared, not an error', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(failure(404));

    const out = await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'unsubscribe',
    });

    expect(out.errors).toEqual([]);
    expect(out.cleared).toHaveLength(1);
  });

  it('reports an error instead of throwing, so the local removal survives', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(failure(500));

    const out = await clearSendGridSuppression({
      apiKey: 'SG.x',
      email: 'buyer@example.com',
      reason: 'unsubscribe',
    });

    expect(out.cleared).toEqual([]);
    expect(out.errors[0]).toContain('500');
  });
});
