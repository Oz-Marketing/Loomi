/**
 * Host-based routing, specifically: which paths must NOT be rewritten.
 *
 * The App and Reporting hosts rewrite everything into `/app/*` and `/reporting/*`
 * so one Next app can serve three surfaces. A path that belongs to all three has
 * to be exempt, and the failure mode when it isn't is a 404 on two hosts out of
 * three — which nobody notices until a link is shared.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// The auth gate runs after the host-rewrite block. Stubbing it as "signed in"
// keeps these tests about routing rather than about redirects to /login.
vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ role: 'developer', email: 'dev@example.test' })),
}));

const { proxy } = await import('./proxy');

function request(host: string, pathname: string): NextRequest {
  return new NextRequest(`http://${host}${pathname}`, { headers: { host } });
}

/** The path Next will actually render: the rewrite target, or the original. */
async function resolved(host: string, pathname: string): Promise<string> {
  const res = await proxy(request(host, pathname));
  const rewritten = res.headers.get('x-middleware-rewrite');
  const location = res.headers.get('location');
  if (location) return `redirect:${new URL(location, 'http://x').pathname}`;
  return rewritten ? new URL(rewritten).pathname : pathname;
}

describe('host routing', () => {
  it('rewrites ordinary paths into each host tree', async () => {
    expect(await resolved('reporting.loomilm.com', '/contacts')).toBe('/reporting/contacts');
    expect(await resolved('app.loomilm.com', '/projects')).toBe('/app/projects');
  });

  it('leaves /docs alone on every host', async () => {
    // The docs are opened from the help button on all three surfaces, and their
    // URLs get pasted into chat by people who have no idea which host they were
    // standing on. /docs/segments must be the same page everywhere.
    for (const host of ['studio.loomilm.com', 'reporting.loomilm.com', 'app.loomilm.com']) {
      expect(await resolved(host, '/docs')).toBe('/docs');
      expect(await resolved(host, '/docs/lists-and-segments')).toBe('/docs/lists-and-segments');
    }
  });

  it('does not exempt a path that merely starts with the same letters', async () => {
    // `/docs` is exempt; `/documents` would be a different route and must still
    // follow its host.
    expect(await resolved('reporting.loomilm.com', '/documents')).toBe('/reporting/documents');
  });
});
