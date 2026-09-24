import { useState } from 'react';
import { DatePicker, type DateRange, type IsoDate } from '@/components/ui/date-picker';

// Every test pins its dates in March 2026 rather than using "today", so the
// calendar it opens on — and so which day buttons exist — never changes.
// March 1, 2026 is a Sunday: the grid has no leading February days, and
// days 12–31 appear exactly once.

function Single({ initial = null }: { initial?: IsoDate | null }) {
  const [value, setValue] = useState<IsoDate | null>(initial);
  return (
    <div style={{ width: 260 }}>
      <DatePicker value={value} onChange={setValue} />
      <output data-cy="value">{JSON.stringify(value)}</output>
    </div>
  );
}

function Range({ initial = { start: null, end: null } }: { initial?: DateRange }) {
  const [value, setValue] = useState<DateRange>(initial);
  return (
    <div style={{ width: 260 }}>
      <DatePicker mode="range" value={value} onChange={setValue} />
      <output data-cy="value">{JSON.stringify(value)}</output>
    </div>
  );
}

const expectValue = (expected: unknown) =>
  cy.get('[data-cy="value"]').should(($out) => {
    expect(JSON.parse($out.text())).to.deep.equal(expected);
  });

const trigger = () => cy.get('[data-cy-root] button').first();
// The popover is portalled to <body>, outside the mount root.
const popover = () => cy.get('[data-datepicker-popover]');
const day = (n: number) => popover().contains('[role="grid"] button', new RegExp(`^${n}$`));

describe('<DatePicker>', () => {
  it('shows the selected date in the trigger', () => {
    cy.mount(<Single initial="2026-03-10" />);

    trigger().should('contain.text', 'Mar 10, 2026');
  });

  it('picks a day and closes', () => {
    cy.mount(<Single initial="2026-03-10" />);

    trigger().click();
    day(15).click();

    expectValue('2026-03-15');
    popover().should('not.exist');
  });

  it('picks the focused day with the arrow keys and Enter', () => {
    cy.mount(<Single initial="2026-03-10" />);

    trigger().click();
    popover().find('[role="grid"]').focus().type('{rightarrow}{rightarrow}{downarrow}{enter}');

    // 10 → 11 → 12, then down a week → 19.
    expectValue('2026-03-19');
  });

  it('moves between months', () => {
    cy.mount(<Single initial="2026-03-10" />);

    trigger().click();
    popover().find('select').first().should('have.value', '2');
    popover().find('[aria-label="Next month"]').click();
    popover().find('select').first().should('have.value', '3');
  });

  it('closes on Escape without changing the date', () => {
    cy.mount(<Single initial="2026-03-10" />);

    trigger().click();
    cy.get('body').type('{esc}');
    popover().should('not.exist');
    expectValue('2026-03-10');
  });

  it('clears the date from the trigger without opening', () => {
    cy.mount(<Single initial="2026-03-10" />);

    cy.get('[aria-label="Clear date"]').click();
    expectValue(null);
    popover().should('not.exist');
    trigger().should('contain.text', 'Select date');
  });

  it('picks a range in either click order', () => {
    cy.mount(<Range initial={{ start: '2026-03-01', end: null }} />);

    trigger().click();
    // Later day first: the picker swaps them so start comes before end.
    day(20).click();
    day(12).click();

    expectValue({ start: '2026-03-12', end: '2026-03-20' });
    popover().should('not.exist');
    trigger().should('contain.text', 'Mar 12 – Mar 20');
  });

  it('picks a one-day range by clicking a day twice', () => {
    cy.mount(<Range initial={{ start: '2026-03-01', end: null }} />);

    trigger().click();
    day(14).click();
    day(14).click();

    expectValue({ start: '2026-03-14', end: '2026-03-14' });
    trigger().should('contain.text', 'Mar 14').and('not.contain.text', '–');
  });
});
