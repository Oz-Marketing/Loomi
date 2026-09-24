/**
 * What a CLIENT (a dealer) can and can't reach in Studio.
 *
 * The client tier enters Studio for one job: reviewing the OEM offer
 * campaigns the nightly automation builds for their account (CLAUDE.md,
 * "Permissions and scope"). Everything here is a way that bound has slipped,
 * or could slip, and each would show a dealer something that isn't theirs:
 * a manual blast, an internal tool, the agency's settings.
 *
 * The seed has no campaigns, so this spec makes its own through a cy.task
 * (cypress/tasks.ts): one automation campaign with one ad in it, and one
 * manual campaign, both on the client's only account. They are removed again
 * at the end.
 */

import { ERROR_BOUNDARY, NOT_FOUND } from '../support/page-markers';

interface Fixtures {
  accountKey: string;
  automationCampaignId: string;
  manualCampaignId: string;
  adId: string;
}

interface ClientCredentials {
  CLIENT_EMAIL: string;
  CLIENT_PASSWORD: string;
}

describe('Client access to Studio', () => {
  let f: Fixtures;

  before(() => {
    cy.task<Fixtures>('seedClientCampaigns').then((fixtures) => {
      f = fixtures;
    });
  });

  after(() => {
    cy.task('removeClientCampaigns');
  });

  // Without this, every "the client can't see X" test below would also pass
  // if X had simply failed to be created.
  describe('as staff', () => {
    beforeEach(() => cy.login());

    it('can open both test campaigns', () => {
      cy.request(`/api/campaigns/${f.automationCampaignId}`).its('status').should('eq', 200);
      cy.request(`/api/campaigns/${f.manualCampaignId}`).its('status').should('eq', 200);
    });
  });

  describe('as a client', () => {
    beforeEach(() => {
      cy.env<ClientCredentials>(['CLIENT_EMAIL', 'CLIENT_PASSWORD']).then((vars) => {
        cy.login(vars.CLIENT_EMAIL, vars.CLIENT_PASSWORD);
      });
    });

    // Without this, a fallback to the staff identity would pass every test
    // below while proving nothing.
    it('is signed in as the client tier', () => {
      cy.request('/api/auth/session').its('body.user').should((user) => {
        expect(user.role).to.eq('client');
        expect(user.accountKeys).to.deep.equal([f.accountKey]);
      });
    });

    it('lands on Campaigns when opening the Ad Generator', () => {
      cy.visit('/ad-generator');
      cy.location('pathname').should('eq', '/campaign-builder');
    });

    it('sees automation campaigns, never manual ones', () => {
      cy.request('/api/campaigns').its('body.campaigns').should((campaigns: Array<{ id: string; source: string }>) => {
        const ids = campaigns.map((c) => c.id);
        expect(ids).to.include(f.automationCampaignId);
        expect(ids).not.to.include(f.manualCampaignId);
        expect(campaigns.every((c) => c.source === 'automation'), 'every campaign is an automation one').to.eq(true);
      });

      cy.visit('/campaign-builder');
      cy.contains('E2E automation campaign').should('be.visible');
      cy.contains('E2E manual campaign').should('not.exist');
    });

    it('gets "not found" for a manual campaign', () => {
      cy.request({ url: `/api/campaigns/${f.manualCampaignId}`, failOnStatusCode: false })
        .its('status')
        .should('eq', 404);

      cy.visit(`/campaign-builder/${f.manualCampaignId}`);
      cy.contains('Campaign not found').should('be.visible');
      cy.contains('E2E manual campaign').should('not.exist');
    });

    // The ad link must be the bare /ad-generator/<id>: there is no
    // /subaccount/[slug]/ad-generator route, so an account-prefixed link 404s
    // for every client. It did, until 2026-09-10.
    it('opens an ad from its campaign', () => {
      cy.visit(`/campaign-builder/${f.automationCampaignId}`);
      cy.contains('E2E automation campaign').should('be.visible');

      // A plain click raises the editor in a sheet over the campaign (an
      // iframe of the same URL with ?embed=1) rather than navigating away.
      cy.get(`a[href="/ad-generator/${f.adId}"]`).first().click();
      cy.contains('button', 'Back to campaign').should('be.visible');
      cy.get('iframe[name="loomi-embed"]').should('have.attr', 'src', `/ad-generator/${f.adId}?embed=1`);

      // And the editor itself answers at that address.
      cy.visit(`/ad-generator/${f.adId}`);
      cy.contains(NOT_FOUND).should('not.exist');
      cy.contains(ERROR_BOUNDARY).should('not.exist');
      cy.location('pathname').should('eq', `/ad-generator/${f.adId}`);
    });

    it('has no Projects switch and no Agency Settings', () => {
      cy.visit('/campaign-builder');
      // Wait for the shell to render before asserting what's absent from it.
      cy.contains('E2E automation campaign').should('be.visible');

      cy.get('[aria-label="Agency Settings"]').should('not.exist');
      cy.contains('a, button', /^Projects$/).should('not.exist');
    });

    it('is sent away from the Projects surface', () => {
      cy.visit('/app/projects');
      cy.location('pathname').should('eq', '/campaign-builder');
    });
  });
});
