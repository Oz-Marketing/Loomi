import { useState } from 'react';
import { Select, type SelectOption } from '@/components/select';

const FIT: SelectOption[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'fill', label: 'Fill' },
];

/** Select is controlled — keep the value in state and expose it for asserts. */
function Controlled({
  options = FIT,
  initial = '',
  disabled,
  onChange,
}: {
  options?: SelectOption[];
  initial?: string;
  disabled?: boolean;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 240 }}>
      <Select
        value={value}
        options={options}
        disabled={disabled}
        ariaLabel="Image fit"
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <output data-cy="value">{value}</output>
    </div>
  );
}

const trigger = () => cy.get('button[aria-label="Image fit"]');
// The menu is portalled to <body>, outside the mount root.
const menu = () => cy.get('.glass-dropdown');

describe('<Select>', () => {
  it('shows the placeholder until something is picked', () => {
    cy.mount(<Controlled />);

    trigger().should('contain.text', 'Select…').and('have.attr', 'aria-expanded', 'false');
  });

  it('picks an option, closes, and shows its label', () => {
    const onChange = cy.spy().as('onChange');
    cy.mount(<Controlled onChange={onChange} />);

    trigger().click();
    trigger().should('have.attr', 'aria-expanded', 'true');
    menu().contains('button', 'Contain').click();

    cy.get('@onChange').should('have.been.calledOnceWith', 'contain');
    menu().should('not.exist');
    trigger().should('contain.text', 'Contain');
  });

  it('closes on Escape without changing the value', () => {
    cy.mount(<Controlled initial="fill" />);

    trigger().click();
    menu().should('be.visible');
    cy.get('body').type('{esc}');
    menu().should('not.exist');
    cy.get('[data-cy="value"]').should('have.text', 'fill');
  });

  it('closes when clicking outside', () => {
    cy.mount(<Controlled />);

    trigger().click();
    menu().should('be.visible');
    cy.get('body').click(700, 500);
    menu().should('not.exist');
  });

  it('does not open when disabled', () => {
    cy.mount(<Controlled disabled />);

    trigger().should('be.disabled').click({ force: true });
    menu().should('not.exist');
  });

  it('shows group headings', () => {
    cy.mount(
      <Controlled
        options={[
          { value: 'inter', label: 'Inter', group: 'Sans' },
          { value: 'lora', label: 'Lora', group: 'Serif' },
        ]}
      />,
    );

    trigger().click();
    menu().should('contain.text', 'Sans').and('contain.text', 'Serif');
  });

  // Past 12 options the list gets a search box, and you can type straight
  // away. It once never got focus: autoFocus fired while the menu was still
  // hidden (before it had measured where to sit), and browsers drop focus on
  // hidden elements.
  it('focuses the search box when a long list opens', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ value: `o${i}`, label: `Option ${i}` }));
    cy.mount(<Controlled options={many} />);

    trigger().click();
    cy.focused().should('have.attr', 'placeholder', 'Search…');
    cy.focused().type('7');
    menu().find('button').should('have.length', 1).and('contain.text', 'Option 7');
  });

  it('searches long lists and says when nothing matches', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ value: `o${i}`, label: `Option ${i}` }));
    cy.mount(<Controlled options={many} />);

    trigger().click();
    menu().find('input').should('be.focused').type('12');
    menu().find('button').should('have.length', 1).and('contain.text', 'Option 12');

    menu().find('input').clear().type('zzz');
    menu().should('contain.text', 'No matches');
  });

  it('does not show a search box on short lists', () => {
    cy.mount(<Controlled />);

    trigger().click();
    menu().find('input').should('not.exist');
  });
});
