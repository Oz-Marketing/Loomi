import { describe, it, expect } from 'vitest';
import {
  validateTriggersForPublish,
  collectConditionFieldKeys,
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
