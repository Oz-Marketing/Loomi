import { HelpTip } from '@/components/ui/help-tip';

// The popover is portalled to <body>, outside the mount root.
const popover = () => cy.get('[role="dialog"]');

describe('<HelpTip>', () => {
  it('opens its popover on click', () => {
    cy.mount(
      <HelpTip title="Send window">
        <p>Messages only go out between these hours.</p>
      </HelpTip>,
    );

    popover().should('not.exist');
    cy.get('[aria-label="Help: Send window"]').click().should('have.attr', 'aria-expanded', 'true');
    popover().should('be.visible').and('contain.text', 'Send window').and('contain.text', 'between these hours');
  });

  it('closes on Escape and returns focus to its button', () => {
    cy.mount(<HelpTip title="Send window">Body</HelpTip>);

    cy.get('[aria-label="Help: Send window"]').click();
    popover().should('be.visible');
    cy.get('body').type('{esc}');
    popover().should('not.exist');
    cy.get('[aria-label="Help: Send window"]').should('be.focused');
  });

  it('stays open when clicking inside, closes outside', () => {
    cy.mount(<HelpTip title="Send window">Body text</HelpTip>);

    cy.get('[aria-label="Help: Send window"]').click();
    popover().contains('Body text').click();
    popover().should('be.visible');

    cy.get('body').click(700, 500);
    popover().should('not.exist');
  });

  it('falls back to "More info" when it has no title', () => {
    cy.mount(<HelpTip>Body</HelpTip>);

    cy.get('[aria-label="More info"]').should('exist');
  });
});
