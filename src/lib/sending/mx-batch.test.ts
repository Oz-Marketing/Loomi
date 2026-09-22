import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `resolveDomainMx` is what put the MX check on the send path, so what it
// must never do matters more than what it does: it must collapse an audience
// to its distinct domains (a DNS round-trip per recipient would add minutes
// to a large blast), and it must fail open (a resolver hiccup that read as
// "dead" would silently cut real customers off from their dealership).
const resolveMx = vi.fn<(domain: string) => Promise<{ exchange: string }[]>>();
const resolve = vi.fn<(domain: string) => Promise<string[]>>();

vi.mock('node:dns', () => ({
  promises: {
    resolveMx: (domain: string) => resolveMx(domain),
    resolve: (domain: string) => resolve(domain),
  },
}));

import { resolveDomainMx, clearMxCache } from './mx-check';

beforeEach(() => {
  clearMxCache();
  resolveMx.mockReset();
  resolve.mockReset();
});

afterEach(() => {
  clearMxCache();
});

function notFound(): Error {
  return Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
}

describe('resolveDomainMx', () => {
  it('looks up each domain once, however many recipients share it', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.example' }]);

    const audience = Array.from({ length: 500 }, (_, i) => `person${i}@gmail.com`);
    const verdicts = await resolveDomainMx([...audience, 'someone@yahoo.com']);

    // 500 recipients on one domain is one query, not 500.
    expect(resolveMx).toHaveBeenCalledTimes(2);
    expect(verdicts.get('gmail.com')).toBe('has-mx');
    expect(verdicts.get('yahoo.com')).toBe('has-mx');
  });

  it('reports a domain with no MX and no A record as dead', async () => {
    resolveMx.mockRejectedValue(notFound());
    resolve.mockRejectedValue(notFound());

    const verdicts = await resolveDomainMx(['someone@ziprider.con']);
    expect(verdicts.get('ziprider.con')).toBe('no-mx');
  });

  it('keeps a domain that has an A record but no MX — implicit MX is real', async () => {
    resolveMx.mockRejectedValue(notFound());
    resolve.mockResolvedValue(['203.0.113.10']);

    const verdicts = await resolveDomainMx(['someone@oldschool.example']);
    expect(verdicts.get('oldschool.example')).toBe('has-mx');
  });

  it('fails OPEN when the resolver is unwell', async () => {
    // SERVFAIL, timeout, resolver unreachable: we learned nothing. The send
    // path only skips on a definitive 'no-mx', so `unknown` means send.
    resolveMx.mockRejectedValue(Object.assign(new Error('servfail'), { code: 'SERVFAIL' }));

    const verdicts = await resolveDomainMx(['real.customer@theirdealership.com']);
    expect(verdicts.get('theirdealership.com')).toBe('unknown');
  });

  it('ignores addresses with no parseable domain', async () => {
    const verdicts = await resolveDomainMx(['', null, undefined, 'not-an-address']);
    expect(resolveMx).not.toHaveBeenCalled();
    expect(verdicts.size).toBe(0);
  });

  it('returns no entry for an unseen domain, which reads as unknown', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.example' }]);
    const verdicts = await resolveDomainMx(['a@gmail.com']);
    // The send path checks `=== 'no-mx'`, so a missing key can never be
    // mistaken for a dead domain.
    expect(verdicts.get('never-asked.com')).toBeUndefined();
  });
});
