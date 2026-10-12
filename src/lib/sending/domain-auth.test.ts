import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkSenderDomainAuth,
  clearDomainAuthCache,
  DOMAIN_AUTH_CACHE_TTL_MS,
  evaluateDomainAuth,
} from './domain-auth';

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

beforeEach(() => {
  clearDomainAuthCache();
});

describe('evaluateDomainAuth', () => {
  it('accepts an exact, valid match', () => {
    const result = evaluateDomainAuth('mktg.audilayton.com', [
      { domain: 'mktg.audilayton.com', valid: true },
    ]);
    expect(result.status).toBe('authenticated');
    expect(result.authenticatedDomain).toBe('mktg.audilayton.com');
  });

  it('calls an exact match whose DNS does not validate invalid', () => {
    expect(evaluateDomainAuth('audilayton.com', [{ domain: 'audilayton.com', valid: false }]).status).toBe(
      'invalid',
    );
  });

  // Observed, not documented: mail From communications@send.youngchev.com with
  // only youngchev.com authenticated arrived d=youngchev.com, dmarc=pass.
  it('lets a valid parent domain cover a subdomain, as SendGrid actually signs it', () => {
    const result = evaluateDomainAuth('send.youngchev.com', [
      { domain: 'youngchev.com', valid: true },
      { domain: 'youngtoyota.com', valid: true, default: true },
    ]);
    expect(result.status).toBe('authenticated');
    expect(result.authenticatedDomain).toBe('youngchev.com');
  });

  it('picks the most specific valid parent', () => {
    const result = evaluateDomainAuth('a.mail.audilayton.com', [
      { domain: 'audilayton.com', valid: true },
      { domain: 'mail.audilayton.com', valid: true },
    ]);
    expect(result.authenticatedDomain).toBe('mail.audilayton.com');
  });

  it('does not let an invalid parent cover a subdomain', () => {
    expect(
      evaluateDomainAuth('send.youngchev.com', [{ domain: 'youngchev.com', valid: false }]).status,
    ).toBe('not_authenticated');
  });

  it('does not let a child domain cover its parent unless it is the default', () => {
    const result = evaluateDomainAuth('audilayton.com', [{ domain: 'mail.audilayton.com', valid: true }]);
    expect(result.status).toBe('not_authenticated');
    expect(result.detail).toContain('mail.audilayton.com');
  });

  it("accepts the account's DEFAULT domain when it shares the organization", () => {
    const result = evaluateDomainAuth('mail.audilayton.com', [
      { domain: 'audilayton.com', valid: true, default: true },
    ]);
    expect(result.status).toBe('authenticated');
    expect(result.authenticatedDomain).toBe('audilayton.com');
  });

  it('does not accept an unrelated default domain', () => {
    expect(
      evaluateDomainAuth('audilayton.com', [{ domain: 'youngchevrolet.com', valid: true, default: true }]).status,
    ).toBe('not_authenticated');
  });

  it('does not treat a suffix collision as the same organization', () => {
    expect(
      evaluateDomainAuth('notaudilayton.com', [{ domain: 'audilayton.com', valid: true, default: true }]).status,
    ).toBe('not_authenticated');
  });

  it('compares case-insensitively and ignores junk records', () => {
    expect(
      evaluateDomainAuth('audilayton.com', [{ domain: 'AudiLayton.com.', valid: true }, { valid: true }, {}]).status,
    ).toBe('authenticated');
  });
});

describe('checkSenderDomainAuth', () => {
  it('asks SendGrid with the account key and answers for the From domain', async () => {
    const { impl, calls } = fakeFetch(respond(200, [{ domain: 'mktg.audilayton.com', valid: true }]));
    const result = await checkSenderDomainAuth({
      apiKey: 'SG.key',
      fromEmail: 'Offers@MKTG.AudiLayton.com',
      fetchImpl: impl,
    });
    expect(result.status).toBe('authenticated');
    expect(result.fromDomain).toBe('mktg.audilayton.com');
    expect(calls[0]).toContain('https://api.sendgrid.com/v3/whitelabel/domains');
    const init = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SG.key');
  });

  it('pages through a long domain list', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ domain: `d${i}.example.com`, valid: true }));
    const { impl, calls } = fakeFetch(
      respond(200, page),
      respond(200, [{ domain: 'audilayton.com', valid: true }]),
    );
    const result = await checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'a@audilayton.com', fetchImpl: impl });
    expect(result.status).toBe('authenticated');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('offset=50');
  });

  it('maps a rejected key, a missing permission and an outage to their own statuses', async () => {
    expect(
      (await checkSenderDomainAuth({ apiKey: 'a', fromEmail: 'x@d.com', fetchImpl: fakeFetch(respond(401, {})).impl })).status,
    ).toBe('key_rejected');
    expect(
      (await checkSenderDomainAuth({ apiKey: 'b', fromEmail: 'x@d.com', fetchImpl: fakeFetch(respond(403, {})).impl })).status,
    ).toBe('no_permission');
    expect(
      (await checkSenderDomainAuth({ apiKey: 'c', fromEmail: 'x@d.com', fetchImpl: fakeFetch(respond(503, {})).impl })).status,
    ).toBe('unreachable');
    expect(
      (await checkSenderDomainAuth({ apiKey: 'd', fromEmail: 'x@d.com', fetchImpl: fakeFetch(new TypeError('fetch failed')).impl })).status,
    ).toBe('unreachable');
    expect(
      (await checkSenderDomainAuth({ apiKey: 'e', fromEmail: 'x@d.com', fetchImpl: fakeFetch(respond(200, { oops: 1 })).impl })).status,
    ).toBe('unreachable');
  });

  it('gives up after its timeout instead of hanging preflight', async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn((_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      ) as unknown as typeof fetch;
      const pending = checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: hanging });
      await vi.advanceTimersByTimeAsync(8_000);
      const result = await pending;
      expect(result.status).toBe('unreachable');
      expect(result.detail).toContain('in time');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches a definitive answer for ten minutes per key and domain', async () => {
    let now = 1_000_000;
    const { impl, calls } = fakeFetch(
      respond(200, [{ domain: 'd.com', valid: true }]),
      respond(200, [{ domain: 'd.com', valid: false }]),
    );
    const check = () => checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: impl, now: () => now });
    expect((await check()).status).toBe('authenticated');
    now += DOMAIN_AUTH_CACHE_TTL_MS - 1;
    expect((await check()).status).toBe('authenticated');
    expect(calls).toHaveLength(1);
    now += 2;
    expect((await check()).status).toBe('invalid');
    expect(calls).toHaveLength(2);
  });

  it('retries an outage soon rather than caching it for ten minutes', async () => {
    let now = 0;
    const { impl, calls } = fakeFetch(respond(503, {}), respond(200, [{ domain: 'd.com', valid: true }]));
    const check = () => checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: impl, now: () => now });
    expect((await check()).status).toBe('unreachable');
    now += 61_000;
    expect((await check()).status).toBe('authenticated');
    expect(calls).toHaveLength(2);
  });

  it('bypasses the cache when asked for a fresh answer, and stores it', async () => {
    const { impl, calls } = fakeFetch(
      respond(200, [{ domain: 'd.com', valid: false }]),
      respond(200, [{ domain: 'd.com', valid: true }]),
    );
    await checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: impl });
    const fresh = await checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: impl, fresh: true });
    expect(fresh.status).toBe('authenticated');
    const cached = await checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'x@d.com', fetchImpl: impl });
    expect(cached.status).toBe('authenticated');
    expect(calls).toHaveLength(2);
  });

  it('needs a From address and a key', async () => {
    expect((await checkSenderDomainAuth({ apiKey: 'k', fromEmail: 'nope' })).status).toBe('not_authenticated');
    expect((await checkSenderDomainAuth({ apiKey: '', fromEmail: 'x@d.com' })).status).toBe('key_rejected');
  });
});
