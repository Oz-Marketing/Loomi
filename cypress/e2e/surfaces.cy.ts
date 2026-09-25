/**
 * Signed-in smoke pass over EVERY static page on the studio host.
 *
 * Deliberately shallow: it does not assert what any page CONTAINS, because
 * that copy changes weekly and a smoke suite that fails on a reworded heading
 * teaches people to ignore it. What it does assert is the handful of ways a
 * page dies without anyone noticing — a non-2xx response (`cy.visit` fails on
 * those by default), a server component that throws into the error boundary,
 * a route that quietly stopped existing, a guard that bounces you to /login,
 * and a redirect that stopped landing where it should.
 *
 * Coverage keeps itself honest: the first test lists every `page.tsx` under
 * src/app and fails unless each one is either in PAGES or in SKIPPED with a
 * reason. A new page therefore can't ship untested by being forgotten here.
 */

import { ERROR_BOUNDARY, NOT_FOUND } from '../support/page-markers';

interface Page {
  path: string;
  /** Where the page sends you. Asserted, so a redirect can't silently drift. */
  redirectsTo?: string;
  /** Set false for a page that legitimately renders no heading. */
  heading?: false;
}

const PAGES: ReadonlyArray<Page> = [
  { path: '/', redirectsTo: '/dashboard' },
  { path: '/dashboard' },
  { path: '/clients' },
  { path: '/changelog' },
  { path: '/profile' },
  { path: '/media' },
  { path: '/docs' },
  { path: '/playbooks' },

  { path: '/contacts' },
  { path: '/contacts/import' },
  { path: '/contacts/lists' },
  { path: '/contacts/segments' },
  // A form with no heading.
  { path: '/contacts/segments/new', heading: false },

  { path: '/campaign-builder' },
  { path: '/campaign-builder/new' },
  { path: '/campaign-builder/new/manual' },
  { path: '/campaigns', redirectsTo: '/messaging/blasts' },

  { path: '/messaging/blasts' },
  { path: '/messaging/campaigns', redirectsTo: '/messaging/blasts' },
  { path: '/messaging/blasts/schedule', redirectsTo: '/messaging/blasts' },
  // Lands on a settings tab that depends on the selected account.
  { path: '/messaging/settings' },

  { path: '/email/templates' },
  { path: '/emails', redirectsTo: '/email/templates' },
  { path: '/library', redirectsTo: '/email/templates' },
  { path: '/templates' },
  { path: '/templates/editor' },
  { path: '/templates/library', redirectsTo: '/email/templates' },

  { path: '/flows' },
  // Renders nothing until a single account is selected.
  { path: '/flows/analytics', heading: false },

  { path: '/websites/forms' },
  { path: '/websites/landing-pages' },
  { path: '/websites/snippets' },

  // Lands on the first tab.
  { path: '/settings' },
  { path: '/settings/users/new' },
  { path: '/subaccounts' },
  { path: '/users', redirectsTo: '/settings/users' },
  { path: '/users/new' },

  { path: '/ad-generator' },
  // A full-screen editor with no heading.
  { path: '/ad-generator/builder', heading: false },
  { path: '/ad-generator/automation', redirectsTo: '/settings/ad-automation' },
  { path: '/ad-generator/oem-assets', redirectsTo: '/settings/coop-guidelines' },
  { path: '/ad-generator/oem-rules', redirectsTo: '/settings/ad-oem-rules' },
  { path: '/ad-generator/sizes', redirectsTo: '/settings/ad-sizes' },
  { path: '/ad-generator/templates', redirectsTo: '/settings/ad-disclaimers' },

  // Reporting is its own host in production, but its pages are also served
  // on the studio host — which is how reporting-leakage.cy.ts reaches them.
  { path: '/reporting' },
  { path: '/reporting/acquisition' },
  { path: '/reporting/ad-meeting' },
  { path: '/reporting/ads/email', redirectsTo: '/reporting/ads/blasts' },
  { path: '/reporting/billboards' },
  { path: '/reporting/budget' },
  { path: '/reporting/business-profile' },
  { path: '/reporting/call-tracking' },
  { path: '/reporting/contacts' },
  { path: '/reporting/direct-mail' },
  { path: '/reporting/engagement', redirectsTo: '/reporting/ads/blasts' },
  { path: '/reporting/executive' },
  { path: '/reporting/heatmap' },
  { path: '/reporting/leads' },
  { path: '/reporting/lists' },
  { path: '/reporting/profile' },
  { path: '/reporting/reputation' },
  { path: '/reporting/sales-trend' },
  { path: '/reporting/service-retention' },
  { path: '/reporting/service-trend' },
  { path: '/reporting/settings' },
  { path: '/reporting/settings/users/new' },
  { path: '/reporting/websites' },
];

/** Pages deliberately not visited here, each with the reason. */
const SKIPPED: Readonly<Record<string, string>> = {
  '/login': 'public; auth.cy.ts covers it',
  '/forgot-password': 'public',
  '/reset-password': 'public; needs a token',
  '/onboarding': 'public; needs an invite token',
  '/marketing': 'public marketing site, served from marketing.localhost',

  // KNOWN BUGS. Each redirects to a path that only exists on the Reporting
  // host, so on the studio host it lands on the 404 page. Move them into
  // PAGES once fixed.
  '/campaigns/analytics': 'KNOWN BUG: redirects to /engagement, a 404 on the studio host',
  '/messaging/analytics': 'KNOWN BUG: redirects to /engagement, a 404 on the studio host',
  '/reporting/ads': 'KNOWN BUG: redirects to /ads/meta, a 404 on the studio host',
};

/**
 * The Projects surface (/app/*) is served from app.localhost, and a session
 * cookie doesn't cross hosts (see cypress.config.ts), so it can't be visited
 * signed in from here.
 */
const SKIPPED_PREFIX = { prefix: '/app', reason: 'Projects surface, on app.localhost' };

const isSkipped = (path: string) =>
  path in SKIPPED || path === SKIPPED_PREFIX.prefix || path.startsWith(`${SKIPPED_PREFIX.prefix}/`);

describe('Signed-in pages', () => {
  it('lists every page, or skips it with a reason', () => {
    cy.task<string[]>('listStaticPages').then((routes) => {
      const listed = new Set(PAGES.map((p) => p.path));
      const missing = routes.filter((r) => !listed.has(r) && !isSkipped(r));
      expect(missing, 'pages with no smoke entry: add each to PAGES or SKIPPED').to.deep.equal([]);

      // And the other way: an entry for a page that no longer exists.
      const known = new Set(routes);
      const stale = [...listed, ...Object.keys(SKIPPED)].filter((p) => !known.has(p));
      expect(stale, 'entries for pages that no longer exist').to.deep.equal([]);
    });
  });

  describe('as staff', () => {
    beforeEach(() => {
      cy.login();
    });

    PAGES.forEach(({ path, redirectsTo, heading }) => {
      it(`${path} loads`, () => {
        cy.visit(path);

        cy.location('pathname').should('not.eq', '/login');
        if (redirectsTo) cy.location('pathname').should('eq', redirectsTo);
        cy.contains(ERROR_BOUNDARY).should('not.exist');
        cy.contains(NOT_FOUND).should('not.exist');

        // A heading rather than the `main` landmark: /media renders outside
        // the shell that provides `<main>`, so that assertion would be testing
        // a convention the app doesn't hold to uniformly instead of liveness.
        //
        // The extra timeout is for `next dev` only. The page has already
        // answered 2xx by this point, so what is being waited on is the first
        // compile of a heavy route, not the app being slow — against the
        // production bundle CI runs, this resolves immediately.
        if (heading !== false) cy.get('h1, h2', { timeout: 90_000 }).should('exist');
      });
    });
  });
});
