/**
 * Signed-in smoke pass over the main surfaces.
 *
 * Deliberately shallow: it does not assert what any page CONTAINS, because
 * that copy changes weekly and a smoke suite that fails on a reworded heading
 * teaches people to ignore it. What it does assert is the handful of ways a
 * page dies without anyone noticing — a non-2xx response (`cy.visit` fails on
 * those by default), a server component that throws into the error boundary,
 * a route that quietly stopped existing, and a guard that bounces you to
 * /login.
 *
 * Paths are the REAL ones. `/messaging` and `/email` are directories with no
 * index page; their landing routes are the ones listed below, and writing the
 * bare parent here just tests a 404.
 */

// Text rendered by src/app/error.tsx and src/app/not-found.tsx. Matched as
// regexes because both use a typographic apostrophe (&rsquo;).
const ERROR_BOUNDARY = /This page didn.t load/;
const NOT_FOUND = /We couldn.t find that page/;

const SURFACES: ReadonlyArray<{ name: string; path: string }> = [
  { name: 'Studio home', path: '/dashboard' },
  { name: 'Contacts', path: '/contacts' },
  { name: 'Messaging', path: '/messaging/campaigns' },
  { name: 'Email templates', path: '/email/templates' },
  { name: 'Flows', path: '/flows' },
  { name: 'Media library', path: '/media' },
  { name: 'Reporting', path: '/reporting' },
  { name: 'Profile', path: '/profile' },
];

describe('Signed-in surfaces', () => {
  beforeEach(() => {
    cy.login();
  });

  SURFACES.forEach(({ name, path }) => {
    it(`${name} renders`, () => {
      cy.visit(path);

      cy.location('pathname').should('not.eq', '/login');
      cy.contains(ERROR_BOUNDARY).should('not.exist');
      cy.contains(NOT_FOUND).should('not.exist');

      // A heading rather than the `main` landmark: /media renders outside the
      // shell that provides `<main>`, so that assertion would be testing a
      // convention the app doesn't hold to uniformly instead of liveness.
      //
      // The extra timeout is for `next dev` only. The page has already
      // answered 2xx by this point, so what is being waited on is the first
      // compile of a heavy route, not the app being slow — against the
      // production bundle CI runs, this resolves immediately.
      cy.get('h1, h2', { timeout: 90_000 }).should('exist');
    });
  });
});
