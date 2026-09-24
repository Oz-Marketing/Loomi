import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';

const icon = <span>•</span>;

describe('<BulkActionDock>', () => {
  // The dock is fixed and offset for the app sidebar, so it needs a
  // desktop-width viewport to sit fully on screen.
  beforeEach(() => cy.viewport(1440, 900));

  it('says how many items are selected', () => {
    cy.mount(<BulkActionDock count={3} itemLabel="contacts" actions={[]} onClose={() => {}} />);

    cy.contains('3 contacts selected').should('be.visible');
  });

  it('runs an action when it is clicked', () => {
    const onDelete = cy.spy().as('onDelete');
    const actions: BulkActionDockItem[] = [
      { id: 'tag', label: 'Tag', icon, onClick: () => {} },
      { id: 'delete', label: 'Delete', icon, onClick: onDelete, danger: true },
    ];
    cy.mount(<BulkActionDock count={2} itemLabel="contacts" actions={actions} onClose={() => {}} />);

    cy.contains('button', 'Delete').click();
    cy.get('@onDelete').should('have.been.calledOnce');
  });

  it('closes from its × button', () => {
    const onClose = cy.spy().as('onClose');
    cy.mount(<BulkActionDock count={1} itemLabel="contact" actions={[]} onClose={onClose} />);

    cy.get('[aria-label="Close bulk actions"]').click();
    cy.get('@onClose').should('have.been.calledOnce');
  });

  // An unavailable action is hidden rather than shown grayed out — except
  // "select all", which stays visible (disabled) so the dock doesn't reflow
  // when everything is already selected.
  it('hides disabled actions, except select all', () => {
    const actions: BulkActionDockItem[] = [
      { id: 'select-all', label: 'Select all', icon, onClick: () => {}, disabled: true },
      { id: 'export', label: 'Export', icon, onClick: () => {}, disabled: true },
      { id: 'tag', label: 'Tag', icon, onClick: () => {} },
    ];
    cy.mount(<BulkActionDock count={5} itemLabel="contacts" actions={actions} onClose={() => {}} />);

    cy.contains('button', 'Select all').should('be.visible').and('be.disabled');
    cy.contains('button', 'Export').should('not.exist');
    cy.contains('button', 'Tag').should('be.enabled');
  });
});
