// The API error envelope, and the wrapper that produces it from a throw.
//
// Measured behaviour this exists to prevent regressing: an unhandled throw in a
// Route Handler returns 500 with NO content-type and an EMPTY body, which a
// caller cannot parse and a user cannot report.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiError, withRouteErrors, newTraceId } from './api-errors';

afterEach(() => vi.restoreAllMocks());

describe('apiError', () => {
  it('maps each code to its status', async () => {
    const cases = [
      ['bad_request', 400], ['unauthorized', 401], ['forbidden', 403],
      ['not_found', 404], ['conflict', 409], ['unprocessable', 422],
      ['rate_limited', 429], ['not_configured', 503],
      ['upstream_error', 502], ['internal_error', 500],
    ] as const;
    for (const [code, status] of cases) {
      expect(apiError(code, 'x').status, code).toBe(status);
    }
  });

  it('returns a parseable JSON envelope', async () => {
    const body = await apiError('bad_request', 'Missing accountKey').json();
    expect(body).toMatchObject({
      error: 'Missing accountKey',
      code: 'bad_request',
      message: 'Missing accountKey',
      retryable: false,
    });
    expect(body.traceId).toMatch(/^[a-z0-9]+$/);
  });

  it('marks only the codes worth retrying as retryable', async () => {
    for (const code of ['rate_limited', 'upstream_error', 'internal_error'] as const) {
      expect((await apiError(code, 'x').json()).retryable, code).toBe(true);
    }
    for (const code of ['bad_request', 'forbidden', 'not_found', 'not_configured'] as const) {
      expect((await apiError(code, 'x').json()).retryable, code).toBe(false);
    }
  });

  it('never lets an error response be cached', () => {
    expect(apiError('internal_error', 'x').headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps `error` alongside `message` so existing callers still work', async () => {
    // A lot of client code reads body.error; changing every caller would be a
    // much larger change than this envelope is worth.
    const body = await apiError('forbidden', 'Nope').json();
    expect(body.error).toBe(body.message);
  });
});

describe('withRouteErrors', () => {
  it('passes a successful response straight through', async () => {
    const handler = withRouteErrors(async () => new Response('ok', { status: 200 }));
    const res = await handler();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('leaves a handler that returns its OWN error response untouched', async () => {
    // The wrapper catches escapes; it must not second-guess a deliberate 403.
    const handler = withRouteErrors(async () => apiError('forbidden', 'Not yours'));
    const res = await handler();
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('Not yours');
  });

  it('turns a throw into a parseable 500 rather than an empty body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withRouteErrors(async () => {
      throw new Error('boom');
    });
    const res = await handler();
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.code).toBe('internal_error');
    expect(body.retryable).toBe(true);
    expect(body.traceId).toBeTruthy();
  });

  it('does not leak the thrown message to the client, but does log it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withRouteErrors(async () => {
      throw new Error('relation "Secret" does not exist');
    }, 'probe');
    const body = await (await handler()).json();

    expect(body.message).not.toContain('Secret');
    expect(JSON.stringify(body)).not.toContain('does not exist');
    // ...but the operator can still find it, joined by the traceId.
    expect(spy).toHaveBeenCalledOnce();
    const logged = spy.mock.calls[0].join(' ');
    expect(logged).toContain('probe');
    expect(logged).toContain(body.traceId);
  });

  it('catches a synchronous throw, not just a rejected promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withRouteErrors((() => {
      throw new Error('sync boom');
    }) as () => Response);
    expect((await handler()).status).toBe(500);
  });

  it('forwards every argument the App Router passes', async () => {
    // Handlers are variously (req), (req, { params }), or () — a wrapper that
    // dropped the second argument would break every dynamic route.
    const seen: unknown[] = [];
    const handler = withRouteErrors(async (...args: unknown[]) => {
      seen.push(...args);
      return new Response('ok');
    });
    const ctx = { params: Promise.resolve({ id: '1' }) };
    await handler('REQ' as never, ctx as never);
    expect(seen).toEqual(['REQ', ctx]);
  });
});

describe('newTraceId', () => {
  it('is short, url-safe, and not obviously colliding', () => {
    const ids = new Set(Array.from({ length: 500 }, newTraceId));
    expect(ids.size).toBeGreaterThan(495);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{1,10}$/);
  });
});
