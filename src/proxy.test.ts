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

const { getToken } = await import('next-auth/jwt');
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

describe('app icons', () => {
  // Regression: icon.png and apple-icon.png shipped without being added to
  // either exemption list, so both 307'd to /login in production. favicon.ico
  // kept working, which is exactly why it went unnoticed — tabs still showed
  // an icon and only the high-res and iOS home-screen variants were broken.
  const ICONS = ['/favicon.ico', '/icon.png', '/apple-icon.png'];

  it('serves every icon convention unrewritten on all three hosts', async () => {
    for (const host of ['studio.loomilm.com', 'reporting.loomilm.com', 'app.loomilm.com']) {
      for (const icon of ICONS) {
        expect(await resolved(host, icon)).toBe(icon);
      }
    }
  });

  it('serves them to a visitor with no session', async () => {
    // The browser asks for the <link rel="icon"> target while rendering the
    // LOGIN page, and iOS asks for apple-icon when a logged-out page is added
    // to the home screen. Neither caller has a token.
    for (const icon of ICONS) {
      vi.mocked(getToken).mockResolvedValueOnce(null);
      expect(await resolved('studio.loomilm.com', icon)).toBe(icon);
    }
  });

  it('still sends a signed-out visitor to login for everything else', async () => {
    // Guards the obvious way to "fix" the above: widening the exemption until
    // it swallows real routes.
    for (const path of ['/dashboard', '/icon-gallery', '/apple-icon-set']) {
      vi.mocked(getToken).mockResolvedValueOnce(null);
      expect(await resolved('studio.loomilm.com', path)).toBe('redirect:/login');
    }
  });
});
