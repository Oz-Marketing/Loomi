/**
 * Custom commands. Loaded for every spec via cypress/support/e2e.ts.
 */

/** The env vars cypress.config.ts seeds, and any environment can override. */
interface SeedCredentials {
  LOGIN_EMAIL: string;
  LOGIN_PASSWORD: string;
}

/**
 * NextAuth prefixes its cookies with `__Secure-` only when NEXTAUTH_URL is
 * https (src/lib/auth.ts). Deriving the name from the origin under test keeps
 * this command working unchanged when it is pointed at staging.
 */
function sessionCookieName(): string {
  const secure = (Cypress.config('baseUrl') ?? '').startsWith('https://');
  return `${secure ? '__Secure-' : ''}next-auth.session-token`;
}

/**
 * Sign in through NextAuth's credentials endpoint rather than the form.
 *
 * A spec about contacts shouldn't spend its budget re-testing the login form
 * — auth.cy.ts owns that, and it is the only place the form is typed into.
 * cy.session() caches the cookie across specs, so the handshake runs once per
 * run instead of once per test.
 */
Cypress.Commands.add('login', (email?: string, password?: string) => {
  // Cypress 16 removed the synchronous `Cypress.env()`; env vars now arrive
  // through a chainable, so the defaults resolve inside the command rather
  // than in the parameter list.
  cy.env<SeedCredentials>(['LOGIN_EMAIL', 'LOGIN_PASSWORD']).then((vars) => {
    const user = email ?? vars.LOGIN_EMAIL;
    const secret = password ?? vars.LOGIN_PASSWORD;

    cy.session(
      ['loomi', user],
      () => {
        // NextAuth refuses a credentials POST whose CSRF token doesn't match
        // the cookie. This GET issues the pair; Cypress carries the cookie
        // into the POST below.
        cy.request('/api/auth/csrf')
          .its('body.csrfToken')
          .then((csrfToken: string) => {
            cy.request({
              method: 'POST',
              url: '/api/auth/callback/credentials',
              form: true,
              body: { csrfToken, email: user, password: secret, json: true },
            });
          });

        cy.getCookie(sessionCookieName()).should('exist');
      },
      {
        /**
         * Assert the SESSION, not the status code. A wrong password still
         * answers 200 with a redirect back to /login, so a status check would
         * happily cache an anonymous session — and every spec would then fail
         * somewhere far away from the actual cause.
         */
        validate() {
          cy.request('/api/auth/session').its('body.user.email').should('eq', user);
        },
        cacheAcrossSpecs: true,
      }
    );
  });
});

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Sign in via the NextAuth credentials endpoint and cache the session.
       * Defaults to the seed identity configured in cypress.config.ts.
       */
      login(email?: string, password?: string): Chainable<void>;
    }
  }
}

export {};
