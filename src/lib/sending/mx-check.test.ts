import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dead-domain check skips recipients, so a wrong "no-mx" silently cuts a
// real customer off. Only a DEFINITIVE answer may produce it.

const resolveMx = vi.fn();
const resolve4 = vi.fn();
const resolve6 = vi.fn();

vi.mock('node:dns', () => ({
  promises: {
    resolveMx: (...a: unknown[]) => resolveMx(...a),
    resolve4: (...a: unknown[]) => resolve4(...a),
    resolve6: (...a: unknown[]) => resolve6(...a),
  },
}));

const { checkMx } = await import('./mx-check');

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

let n = 0;
/** A fresh domain per test — verdicts are cached. */
const domain = () => `case-${++n}-${Date.now()}.example-test.com`;

beforeEach(() => {
  resolveMx.mockReset();
  resolve4.mockReset();
  resolve6.mockReset();
});

describe('checkMx', () => {
  it('trusts a published MX', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]);
    expect(await checkMx(domain())).toBe('has-mx');
  });

  it('accepts an implicit MX from an A record', async () => {
    resolveMx.mockRejectedValue(dnsError('ENODATA'));
    resolve4.mockResolvedValue(['203.0.113.7']);
    expect(await checkMx(domain())).toBe('has-mx');
  });

  it('accepts an IPv6-only domain', async () => {
    resolveMx.mockRejectedValue(dnsError('ENODATA'));
    resolve4.mockRejectedValue(dnsError('ENODATA'));
    resolve6.mockResolvedValue(['2001:db8::7']);
    expect(await checkMx(domain())).toBe('has-mx');
  });

  it('learns nothing when the fallback lookup fails transiently', async () => {
    resolveMx.mockRejectedValue(dnsError('ENOTFOUND'));
    resolve4.mockRejectedValue(dnsError('ESERVFAIL'));
    expect(await checkMx(domain())).toBe('unknown');
  });

  it('calls a domain dead only when every lookup says it does not exist', async () => {
    resolveMx.mockRejectedValue(dnsError('ENOTFOUND'));
    resolve4.mockRejectedValue(dnsError('ENOTFOUND'));
    resolve6.mockRejectedValue(dnsError('ENOTFOUND'));
    expect(await checkMx(domain())).toBe('no-mx');
  });

  it('learns nothing from a failed MX lookup', async () => {
    resolveMx.mockRejectedValue(dnsError('ETIMEOUT'));
    expect(await checkMx(domain())).toBe('unknown');
  });
});
