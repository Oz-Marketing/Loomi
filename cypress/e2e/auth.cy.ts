/**
 * The sign-in gate. This is the only spec that types into the login form —
 * everywhere else uses `cy.login()`, which talks to NextAuth directly.
 */
describe('Authentication', () => {
  // Cypress 16 serves env vars through a chainable rather than a synchronous
  // `Cypress.env()`, so the seed identity is resolved in a hook and read from
  // these by the tests below.
  let email = '';
  let password = '';

  before(() => {
    cy.env<{ LOGIN_EMAIL: string; LOGIN_PASSWORD: string }>([
      'LOGIN_EMAIL',
      'LOGIN_PASSWORD',
    ]).then((vars) => {
      email = vars.LOGIN_EMAIL;
      password = vars.LOGIN_PASSWORD;
    });
  });

  it('sends a signed-out visitor to the login form', () => {
    cy.visit('/dashboard');
    // src/proxy.ts redirects to a bare /login — no callbackUrl on this path.
    cy.location('pathname').should('eq', '/login');
    cy.get('#email').should('be.visible');
  });

  it('answers an unauthenticated API call with 401 rather than a redirect', () => {
    // The proxy branches on `/api/` before it builds the login redirect. A
    // regression here turns every signed-out fetch into an HTML login page,
    // which client code parses as JSON and reports as a nonsense error.
    cy.request({ url: '/api/contacts', failOnStatusCode: false })
      .its('status')
      .should('eq', 401);
  });

  it('rejects a wrong password and stays put', () => {
    cy.visit('/login');
    cy.get('#email').type(email);
    cy.get('#password').type('not-the-password', { log: false });
    cy.get('button[type="submit"]').click();

    cy.contains('Invalid email or password').should('be.visible');
    cy.location('pathname').should('eq', '/login');
    cy.getCookie('next-auth.session-token').should('not.exist');
  });

  it('signs in through the form and lands on the studio home', () => {
    cy.visit('/login');
    cy.get('#email').type(email);
    cy.get('#password').type(password, { log: false });
    cy.get('button[type="submit"]').click();

    cy.location('pathname').should('eq', '/dashboard');
    cy.contains('h1', 'Welcome back').should('be.visible');
  });

  it('resolves the root path to the studio home for a staff session', () => {
    // `/` is a server redirect that branches on role: staff to /dashboard,
    // the client tier to /campaign-builder (src/app/page.tsx).
    cy.login();
    cy.visit('/');
    cy.location('pathname').should('eq', '/dashboard');
  });
});
