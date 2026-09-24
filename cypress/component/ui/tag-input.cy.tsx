import { useState } from 'react';
import { TagInput, tagColorClass } from '@/components/ui/tag-input';

/** TagInput is controlled — keep the tags in state and expose them for asserts. */
function Controlled({ initial = [], disabled }: { initial?: string[]; disabled?: boolean }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <TagInput value={tags} onChange={setTags} disabled={disabled} />
      <output data-cy="tags">{JSON.stringify(tags)}</output>
    </>
  );
}

/** Retries until the committed tags match — `should` with a callback re-runs. */
const expectTags = (expected: string[]) =>
  cy.get('[data-cy="tags"]').should(($out) => {
    expect(JSON.parse($out.text())).to.deep.equal(expected);
  });

describe('<TagInput>', () => {
  it('adds a tag on Enter and on comma', () => {
    cy.mount(<Controlled />);

    cy.get('input').type('lease{enter}q3,');
    expectTags(['lease', 'q3']);
    cy.get('input').should('have.value', '');
  });

  it('splits a pasted comma list and drops case-insensitive duplicates', () => {
    cy.mount(<Controlled initial={['Lease']} />);

    // A real paste, not per-key typing: the comma handler would otherwise
    // commit each part as it went and the split path would never run.
    cy.get('input').then(($el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call($el[0], ' lease, q3 , launch, Q3 ');
      $el[0].dispatchEvent(new Event('input', { bubbles: true }));
    });
    cy.get('input').type('{enter}');

    expectTags(['Lease', 'q3', 'launch']);
  });

  it('commits a typed tag on blur so it is not lost', () => {
    cy.mount(<Controlled />);

    cy.get('input').type('unsaved').blur();
    expectTags(['unsaved']);
  });

  it('removes the last pill on Backspace in an empty field', () => {
    cy.mount(<Controlled initial={['a', 'b', 'c']} />);

    cy.get('input').type('{backspace}');
    expectTags(['a', 'b']);
  });

  it('removes a specific pill from its button', () => {
    cy.mount(<Controlled initial={['a', 'b', 'c']} />);

    cy.get('[aria-label="Remove b"]').click();
    expectTags(['a', 'c']);
  });

  it('hides remove buttons when disabled', () => {
    cy.mount(<Controlled initial={['a']} disabled />);

    cy.get('button').should('not.exist');
    cy.get('input').should('be.disabled');
  });

  it('colors the same tag the same way regardless of case or spacing', () => {
    expect(tagColorClass('Lease')).to.equal(tagColorClass('  lease '));

    cy.mount(<Controlled initial={['Lease']} />);
    cy.contains('span', 'Lease').parent().should('have.class', tagColorClass('lease').split(' ')[0]);
  });
});
