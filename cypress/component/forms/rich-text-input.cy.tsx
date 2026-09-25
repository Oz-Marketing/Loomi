import { useState } from 'react';
import { RichTextInput } from '@/lib/forms/editor/RichTextInput';
import { FieldConsent } from '@/lib/forms/components/fields';

const inputClass = 'w-full px-3 py-2 text-sm border rounded-md';

/** RichTextInput is controlled — hold the value so edits round-trip. */
function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 380 }}>
      <RichTextInput value={value} onChange={setValue} inputClass={inputClass} />
      <pre data-cy="value">{value}</pre>
    </div>
  );
}

const editor = () => cy.get('[contenteditable="true"]');
const saved = () => cy.get('[data-cy="value"]');
const dialog = () => cy.get('[role="dialog"][aria-modal="true"]');
const colorMenu = () => cy.get('[role="dialog"][aria-label="Text color"]');

/**
 * The editor writes its content in an effect AFTER it mounts, so the
 * contenteditable exists a beat before its text does. Anything that reads or
 * types into that text has to wait for it; a bare `.then` runs once and never
 * retries, and on slower timing (the interactive runner) it read an empty
 * editor and failed with "parameter 1 is not of type 'Node'".
 */
const editorWith = (text: string) => editor().should('contain.text', text);

/** Select characters [start, end) of the editor's first text node (or of `within`). */
function selectText(start: number, end: number, within?: string) {
  const target = ($el: JQuery<HTMLElement>) => (within ? $el[0].querySelector(within) : $el[0])?.firstChild;
  editor()
    .should(($el) => {
      expect(target($el), `text inside ${within ?? 'the editor'}`).to.exist;
    })
    .then(($el) => {
      const text = target($el)!;
      // The editor's own document, not whichever one the spec runs in.
      const doc = $el[0].ownerDocument;
      const range = doc.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
}

describe('<RichTextInput>', () => {
  it('shows authored links as links in the Text view', () => {
    cy.mount(<Controlled initial={'See our <a href="https://ex.com/privacy">Privacy Policy</a>.'} />);
    editor().find('a[href="https://ex.com/privacy"]').should('have.text', 'Privacy Policy');
    editor().should('not.contain.text', '<a');
  });

  it('links the selected words through the dialog, showing them as the display text', () => {
    cy.mount(<Controlled initial="See our Privacy Policy." />);
    selectText(8, 22);
    cy.get('button[title^="Link"]').click();
    dialog().find('input[name="linkText"]').should('have.value', 'Privacy Policy');
    dialog().find('input[name="linkUrl"]').should('be.focused').type('ex.com/privacy{enter}');
    dialog().should('not.exist');
    saved().should('contain.text', 'See our <a href="https://ex.com/privacy">Privacy Policy</a>.');
  });

  it('inserts a new link with its own display text and color at the caret', () => {
    cy.mount(<Controlled initial="Read the " />);
    editorWith('Read the').click().type('{moveToEnd}');
    cy.get('button[title^="Link"]').click();
    dialog().find('input[name="linkText"]').should('be.focused').type('Terms');
    dialog().find('input[name="linkUrl"]').type('https://ex.com/terms');
    dialog().find('input[placeholder="#000000"]').type('#197cc2');
    dialog().contains('button', 'Add link').click();
    editor()
      .find('a[href="https://ex.com/terms"]')
      .should('have.text', 'Terms')
      .and('have.css', 'color', 'rgb(25, 124, 194)');
    saved().should('contain.text', 'href="https://ex.com/terms"').and('contain.text', 'color:');
  });

  it('edits and removes an existing link', () => {
    cy.mount(<Controlled initial={'See our <a href="https://ex.com/old">Privacy</a> page.'} />);
    selectText(2, 2, 'a');
    cy.get('button[title^="Link"]').click();
    dialog().contains('Edit link');
    dialog().find('input[name="linkUrl"]').should('have.value', 'https://ex.com/old').clear().type('ex.com/new');
    dialog().find('input[name="linkText"]').clear().type('Privacy Policy');
    dialog().contains('button', 'Save').click();
    saved().should('contain.text', '<a href="https://ex.com/new">Privacy Policy</a>');

    selectText(2, 2, 'a');
    cy.get('button[title^="Link"]').click();
    dialog().contains('button', 'Remove link').click();
    saved().should('not.contain.text', '<a').and('contain.text', 'See our Privacy Policy page.');
  });

  it('refuses an unsafe URL and keeps the dialog open', () => {
    cy.mount(<Controlled initial="x" />);
    cy.get('button[title^="Link"]').click();
    dialog().find('input[name="linkUrl"]').type('javascript:alert(1){enter}');
    dialog().should('contain.text', 'Enter a web address');
    dialog().contains('button', 'Cancel').click();
    dialog().should('not.exist');
    saved().should('have.text', 'x');
  });

  it('colors the selected text from the dropdown swatches', () => {
    cy.mount(<Controlled initial="Msg and data rates may apply." />);
    selectText(0, 3);
    cy.get('button[title="Text color"]').click();
    colorMenu().find('button[title="#ef4444"]').click();
    colorMenu().should('not.exist');
    saved().should('contain.text', '<span style="color: rgb(239, 68, 68)">Msg</span>');

    selectText(0, 3, 'span');
    cy.get('button[title="Text color"]').click();
    colorMenu().contains('button', 'Reset color').click();
    saved().should('not.contain.text', 'color');
  });

  it('applies a custom hex color from the dropdown', () => {
    cy.mount(<Controlled initial="Msg and data rates may apply." />);
    selectText(0, 3);
    cy.get('button[title="Text color"]').click();
    colorMenu().find('input[aria-label="Hex color"]').type('#197cc2{enter}');
    saved().should('contain.text', '<span style="color: rgb(25, 124, 194)">Msg</span>');
  });

  it('opens the color dropdown over the text box and closes it on an outside click', () => {
    cy.mount(<Controlled initial="Msg" />);
    cy.get('button[title="Text color"]').click();
    // Overlays the editor rather than pushing it down.
    editor().then(($ed) => {
      const before = $ed[0].getBoundingClientRect().top;
      colorMenu().should('be.visible');
      editor().should(($after) => expect($after[0].getBoundingClientRect().top).to.eq(before));
    });
    cy.get('body').click('bottomRight');
    colorMenu().should('not.exist');
  });

  it('round-trips hand-written markup through the Code view', () => {
    cy.mount(<Controlled initial="Hello" />);
    cy.get('button[title="Code view"]').click();
    cy.get('textarea')
      .should('have.value', 'Hello')
      .clear()
      .type('Read the <a href="https://ex.com/terms">Terms</a>', { parseSpecialCharSequences: false });
    cy.get('button[title="Text view"]').click();
    editor().find('a[href="https://ex.com/terms"]').should('have.text', 'Terms');
  });

  it('keeps Enter as a line break instead of a dropped <div>', () => {
    cy.mount(<Controlled initial="one" />);
    editorWith('one').click().type('{moveToEnd}{enter}two');
    saved().should('contain.text', 'one<br>two');
  });
});

describe('<FieldConsent> links', () => {
  it('renders an authored link color and an underline despite the CSS reset', () => {
    cy.mount(
      <FieldConsent
        label={'See our <a style="color:#197cc2" href="https://ex.com/privacy">Privacy Policy</a>.'}
      />,
    );
    cy.get('a[href="https://ex.com/privacy"]')
      .should('have.css', 'color', 'rgb(25, 124, 194)')
      .and('have.css', 'text-decoration-line', 'underline')
      .and('have.attr', 'target', '_blank');
  });
});
