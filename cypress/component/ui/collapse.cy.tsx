import { useState } from 'react';
import { Collapse } from '@/components/ui/collapse';

/**
 * The payoff of a real browser: jsdom has no layout, so it could never tell
 * you whether this actually animates height. Here the rendered height is real.
 */
function Harness({ unmountOnClose = false }: { unmountOnClose?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        Toggle
      </button>
      <Collapse open={open} unmountOnClose={unmountOnClose}>
        <div data-cy="panel" style={{ height: 120 }}>
          Details
        </div>
      </Collapse>
      <div data-cy="below">Below</div>
    </div>
  );
}

const wrapper = () => cy.get('.collapsible-wrapper');

describe('<Collapse>', () => {
  it('starts closed with zero height and opens to its content height', () => {
    cy.mount(<Harness />);

    wrapper().should('have.attr', 'data-open', 'false');
    wrapper().invoke('outerHeight').should('equal', 0);

    cy.contains('Toggle').click();
    wrapper().should('have.attr', 'data-open', 'true');
    // Waits out the 250ms transition — should() retries until it lands.
    wrapper().invoke('outerHeight').should('equal', 120);
  });

  it('closes back to zero height', () => {
    cy.mount(<Harness />);

    cy.contains('Toggle').click();
    wrapper().invoke('outerHeight').should('equal', 120);
    cy.contains('Toggle').click();
    wrapper().invoke('outerHeight').should('equal', 0);
  });

  it('keeps content mounted while closed by default', () => {
    cy.mount(<Harness />);

    cy.get('[data-cy="panel"]').should('exist');
  });

  it('unmounts content after the close transition when asked to', () => {
    cy.mount(<Harness unmountOnClose />);

    cy.get('[data-cy="panel"]').should('not.exist');
    cy.contains('Toggle').click();
    cy.get('[data-cy="panel"]').should('be.visible');
    cy.contains('Toggle').click();
    cy.get('[data-cy="panel"]').should('not.exist');
  });
});
