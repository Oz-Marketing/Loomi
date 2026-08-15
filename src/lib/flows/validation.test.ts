import { describe, it, expect } from 'vitest';
import {
  validateTriggersForPublish,
  collectConditionFieldKeys,
  collectListIds,
  validateFlowGraph,
  EXECUTABLE_NODE_TYPES,
  type TriggerForValidation,
  type NodeType,
} from './validation';

const errs = (t: TriggerForValidation[]) =>
  validateTriggersForPublish(t).filter((i) => (i.severity ?? 'error') === 'error');

describe('validateTriggersForPublish', () => {
  it('errors when there is no enabled trigger', () => {
    expect(errs([])).toHaveLength(1);
    expect(errs([{ type: 'tag_added', enabled: false, config: { tag: 'x' } }])).toHaveLength(1);
  });

  it('errors when an enabled trigger is missing required config', () => {
    expect(errs([{ type: 'tag_added', enabled: true, config: {} }])).toHaveLength(1);
    expect(errs([{ type: 'date_reminder', enabled: true, config: {} }])).toHaveLength(1);
    expect(errs([{ type: 'list', enabled: true, config: {} }])).toHaveLength(1);
    expect(errs([{ type: 'audience', enabled: true, config: {} }])).toHaveLength(1);
  });

  it('passes a properly-configured enabled trigger', () => {
    expect(errs([{ type: 'tag_added', enabled: true, config: { tag: 'loomi-yag-purchased' } }])).toHaveLength(0);
    expect(errs([{ type: 'date_reminder', enabled: true, config: { field: 'last_purchase_date', offsetDays: 365 } }])).toHaveLength(0);
  });

  it('treats manual + birthday as always-valid (no required config)', () => {
    expect(errs([{ type: 'manual', enabled: true, config: {} }])).toHaveLength(0);
    expect(errs([{ type: 'birthday', enabled: true, config: {} }])).toHaveLength(0);
  });

  it('ignores disabled triggers when at least one enabled+valid exists', () => {
    expect(
      errs([
        { type: 'list', enabled: false, config: {} }, // disabled, malformed — ignored
        { type: 'tag_added', enabled: true, config: { tag: 'x' } },
      ]),
    ).toHaveLength(0);
  });
});

describe('collectConditionFieldKeys', () => {
  const node = (type: NodeType, config: Record<string, unknown>) => ({ type, config });

  it('pulls field keys from condition branch rules, deduped', () => {
    const keys = collectConditionFieldKeys([
      node('condition', {
        branches: [
          { id: 'a', rules: [{ field: 'deal_type', operator: 'is_one_of', value: 'Purchase' }, { field: 'tags', operator: 'excludes', value: 'x' }] },
          { id: 'b', rules: [{ field: 'deal_type', operator: 'is_one_of', value: 'Lease' }] },
        ],
      }),
      node('email', { subject: 'hi' }),
    ]);
    expect(keys.sort()).toEqual(['deal_type', 'tags']);
  });

  it('returns nothing for graphs with no condition nodes', () => {
    expect(collectConditionFieldKeys([node('email', {}), node('wait', { ms: 1 })])).toEqual([]);
  });
});

describe('collectListIds', () => {
  const node = (type: NodeType, config: Record<string, unknown>) => ({ type, config });

  it('collects ids from both list ops, deduped, ignoring blanks', () => {
    expect(
      collectListIds([
        node('add_to_list', { listId: 'list-a' }),
        node('remove_from_list', { listId: 'list-a' }),
        node('add_to_list', { listId: 'list-b' }),
        node('add_to_list', { listId: '  ' }),
        node('add_tag', { tag: 'list-c' }),
      ]).sort(),
    ).toEqual(['list-a', 'list-b']);
  });
});

// Graph-level config checks for the contact-ops steps that became
// executable. Each builds a minimal trigger → step graph so the only
// issues that surface are the ones under test.
describe('validateFlowGraph — contact-ops steps', () => {
  const graph = (type: NodeType, config: Record<string, unknown>) => ({
    nodes: [
      { id: 't', type: 'trigger' as NodeType, config: {} },
      { id: 'n', type, config },
    ],
    edges: [{ fromNodeId: 't', toNodeId: 'n', branch: null }],
  });
  const errorsFor = (type: NodeType, config: Record<string, unknown>) =>
    validateFlowGraph(graph(type, config)).issues.filter(
      (i) => (i.severity ?? 'error') === 'error',
    );

  it('treats the newly-shipped steps as publishable', () => {
    for (const type of ['add_to_list', 'remove_from_list', 'update_field', 'create_task'] as NodeType[]) {
      expect(EXECUTABLE_NODE_TYPES.has(type)).toBe(true);
    }
    // add_note stays on the roadmap — no Contact note relation exists.
    expect(EXECUTABLE_NODE_TYPES.has('add_note')).toBe(false);
    expect(errorsFor('add_note', { note: 'hi' }).map((i) => i.message)).toContain(
      '"add_note" step can\'t be published yet — execution support is on the roadmap.',
    );
  });

  it('requires a list on add_to_list / remove_from_list', () => {
    expect(errorsFor('add_to_list', {})).toHaveLength(1);
    expect(errorsFor('remove_from_list', { listId: '' })).toHaveLength(1);
    expect(errorsFor('add_to_list', { listId: 'list-a' })).toHaveLength(0);
  });

  it('rejects update_field targets a flow may not write', () => {
    expect(errorsFor('update_field', {})).toHaveLength(1);
    // Identity columns carry per-account unique constraints.
    expect(errorsFor('update_field', { field: 'email', value: 'x@y.com' })).toHaveLength(1);
    expect(errorsFor('update_field', { field: 'phone', value: '555' })).toHaveLength(1);
    expect(errorsFor('update_field', { field: 'firstName', value: 'Dana' })).toHaveLength(0);
    expect(errorsFor('update_field', { field: 'custom:tier', value: 'gold' })).toHaveLength(0);
    // An empty value is legal — it clears the field.
    expect(errorsFor('update_field', { field: 'source', value: '' })).toHaveLength(0);
  });

  // Regression: the per-node config checks used to sit behind the
  // "has an outgoing edge" gate, so the LAST step in a flow published
  // with its config unvalidated. Flows end implicitly at any leaf, so
  // that's the single most common shape (trigger → email).
  it('validates the config of a leaf step (implicit end of flow)', () => {
    expect(errorsFor('email', {}).map((i) => i.message)).toContain(
      'Pick a template or set inline HTML.',
    );
    expect(errorsFor('email', { templateId: 'tpl-1' })).toHaveLength(0);
    expect(errorsFor('wait', { ms: 0 })).toHaveLength(1);
  });

  it('does not restate branch-wiring errors on an unconnected condition', () => {
    // The brancher already gets "no outgoing connection" — one message,
    // not one per branch plus a missing-else.
    const issues = errorsFor('condition', {
      branches: [{ id: 'a', label: 'Opened', rules: [{ field: 'tags', operator: 'includes', value: 'x' }] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('This step has no outgoing connection.');
  });

  it('requires a title and validates optional fields on create_task', () => {
    expect(errorsFor('create_task', {})).toHaveLength(1);
    expect(errorsFor('create_task', { title: 'Call {{firstName}}' })).toHaveLength(0);
    expect(errorsFor('create_task', { title: 'x', priority: 'sometime' })).toHaveLength(1);
    expect(errorsFor('create_task', { title: 'x', priority: 'urgent' })).toHaveLength(0);
    expect(errorsFor('create_task', { title: 'x', dueInDays: 'soon' })).toHaveLength(1);
    expect(errorsFor('create_task', { title: 'x', dueInDays: 3 })).toHaveLength(0);
    expect(errorsFor('create_task', { title: 'x', dueInDays: '' })).toHaveLength(0);
  });
});
