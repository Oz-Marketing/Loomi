/**
 * Loaded before every component spec.
 *
 * Deliberately does NOT import ./commands — those are e2e commands (cy.login
 * talks to NextAuth), and a component spec has no server to talk to.
 */
import { mount } from 'cypress/react';

// The app's real stylesheet: theme tokens, Tailwind, and the motion
// primitives (`collapsible-wrapper`, `animate-*`) components depend on.
import '../../src/app/globals.css';

declare global {
  namespace Cypress {
    interface Chainable {
      mount: typeof mount;
    }
  }
}

Cypress.Commands.add('mount', mount);
