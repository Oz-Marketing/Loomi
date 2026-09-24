import { useState } from 'react';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';

const TEAM: MultiSelectOption[] = [
  { value: 'ana', label: 'Ana' },
  { value: 'ben', label: 'Ben' },
  { value: 'cam', label: 'Cam' },
];

/** MultiSelect is controlled — keep the values in state and expose them. */
function Controlled({
  options = TEAM,
  initial = [],
}: {
  options?: MultiSelectOption[];
  initial?: string[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 280 }}>
      <MultiSelect value={value} onChange={setValue} options={options} />
      <output data-cy="value">{JSON.stringify(value)}</output>
    </div>
  );
}

const expectValue = (expected: string[]) =>
  cy.get('[data-cy="value"]').should(($out) => {
    expect(JSON.parse($out.text())).to.deep.equal(expected);
  });

// The trigger is a div with role="button" so the pill buttons can nest in it.
const trigger = () => cy.get('[role="button"]').first();
// The menu is portalled to <body>, outside the mount root.
const menu = () => cy.get('[data-builder-popout-portal]');

describe('<MultiSelect>', () => {
  it('adds options in the order they are clicked', () => {
    cy.mount(<Controlled />);

    trigger().should('contain.text', 'Select…').click();
    menu().contains('button', 'Cam').click();
    menu().contains('button', 'Ana').click();

    expectValue(['cam', 'ana']);
    // It stays open: picking several is the point.
    menu().should('be.visible');
  });

  it('removes an option when it is clicked again', () => {
    cy.mount(<Controlled initial={['ana', 'ben']} />);

    trigger().click();
    menu().contains('button', 'Ana').click();
    expectValue(['ben']);
  });

  it('removes a pill with its × button without opening', () => {
    cy.mount(<Controlled initial={['ana', 'ben']} />);

    cy.get('[aria-label="Remove Ben"]').click();
    expectValue(['ana']);
    menu().should('not.exist');
  });

  it('opens from the keyboard and closes on Escape', () => {
    cy.mount(<Controlled />);

    trigger().focus().type('{enter}');
    menu().should('be.visible');
    menu().type('{esc}');
    menu().should('not.exist');
    trigger().should('be.focused');
  });

  it('closes when clicking outside', () => {
    cy.mount(<Controlled />);

    trigger().click();
    menu().should('be.visible');
    cy.get('body').click(700, 500);
    menu().should('not.exist');
  });

  // From 8 options on, the menu gets a search box.
  it('searches by label or value on long lists', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `user-${i}`, label: `Person ${i}` }));
    cy.mount(<Controlled options={many} />);

    trigger().click();
    menu().find('input').should('be.focused').type('Person 3');
    menu().find('li button').should('have.length', 1);

    menu().find('input').clear().type('user-5');
    menu().find('li button').should('have.length', 1).and('contain.text', 'Person 5');

    menu().find('input').clear().type('nobody');
    menu().should('contain.text', 'No matches');
  });
});
