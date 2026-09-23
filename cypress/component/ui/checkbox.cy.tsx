import { useState } from 'react';
import { Checkbox, type CheckboxProps } from '@/components/ui/checkbox';

/** Checkbox is controlled — wrap it so clicks actually toggle it. */
function Controlled(props: Partial<CheckboxProps> & { initial?: boolean }) {
  const { initial = false, onChange, ...rest } = props;
  const [checked, setChecked] = useState(initial);
  return (
    <Checkbox
      {...rest}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
}

// The input is visually hidden (sr-only) by design, so it is found by type
// rather than by what's painted.
const box = () => cy.get<HTMLInputElement>('input[type="checkbox"]');

describe('<Checkbox>', () => {
  it('toggles when its label is clicked and reports the new value', () => {
    const onChange = cy.spy().as('onChange');
    cy.mount(<Controlled label="Email opt-in" onChange={onChange} />);

    box().should('not.be.checked');
    cy.contains('Email opt-in').click();
    box().should('be.checked');
    cy.get('@onChange').should('have.been.calledOnceWith', true);

    cy.contains('Email opt-in').click();
    box().should('not.be.checked');
    cy.get('@onChange').should('have.been.calledWith', false);
  });

  it('toggles from the keyboard, because the real input is still there', () => {
    cy.mount(<Controlled aria-label="Select row" />);

    box().focus().type(' ');
    box().should('be.checked');
  });

  it('ignores clicks when disabled', () => {
    const onChange = cy.spy().as('onChange');
    cy.mount(<Controlled label="Locked" disabled onChange={onChange} />);

    cy.contains('Locked').click({ force: true });
    box().should('not.be.checked');
    cy.get('@onChange').should('not.have.been.called');
  });

  it('announces the indeterminate state as mixed', () => {
    cy.mount(<Controlled aria-label="Select all" indeterminate />);

    box().should('have.attr', 'aria-checked', 'mixed');
  });

  it('keeps the click from reaching a clickable parent row', () => {
    const onRowClick = cy.spy().as('onRowClick');
    cy.mount(
      <div onClick={onRowClick}>
        <Controlled label="Row" stopPropagation />
      </div>,
    );

    cy.contains('Row').click();
    box().should('be.checked');
    cy.get('@onRowClick').should('not.have.been.called');
  });
});
