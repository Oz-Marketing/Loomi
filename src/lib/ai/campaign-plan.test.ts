import { describe, it, expect } from 'vitest';
import { normalizeFlows } from './campaign-plan';

describe('normalizeFlows — what the planner half-describes becomes buildable nodes, or nothing', () => {
  it('keeps a well-formed drip, in order, with coerced delays', () => {
    const [flow] = normalizeFlows([
      {
        purpose: 'Service reminder drip',
        trigger: 'Customers 6 months past their last visit',
        steps: [
          { delayDays: '0', channel: 'email', purpose: 'Reminder', subject: 'Time for a check-up?' },
          { delayDays: 3, channel: 'sms', purpose: 'Nudge', message: 'Book this week and save. Txt STOP to opt out.' },
        ],
      },
    ]);
    expect(flow.key).toBe('fl1');
    expect(flow.trigger).toBe('Customers 6 months past their last visit');
    expect(flow.steps.map((s) => [s.delayDays, s.channel])).toEqual([[0, 'email'], [3, 'sms']]);
  });

  it('drops an SMS step with no copy and a step with no channel', () => {
    const [flow] = normalizeFlows([
      {
        purpose: 'x',
        steps: [
          { delayDays: 0, channel: 'email', purpose: 'a' },
          { delayDays: 1, channel: 'sms', purpose: 'empty' },
          { delayDays: 2, channel: 'carrier pigeon', purpose: 'b' },
          { delayDays: 2, channel: 'sms', purpose: 'c', message: 'Real copy' },
        ],
      },
    ]);
    expect(flow.steps).toHaveLength(2);
  });

  it('refuses a one-step "flow" — that is a touch, not a sequence', () => {
    expect(normalizeFlows([{ purpose: 'x', steps: [{ delayDays: 0, channel: 'email', purpose: 'a' }] }])).toEqual([]);
  });

  it('caps to one flow and tolerates garbage', () => {
    expect(normalizeFlows('nope')).toEqual([]);
    const two = normalizeFlows([
      { purpose: 'a', steps: [{ delayDays: 0, channel: 'email', purpose: 'a' }, { delayDays: 1, channel: 'email', purpose: 'b' }] },
      { purpose: 'b', steps: [{ delayDays: 0, channel: 'email', purpose: 'a' }, { delayDays: 1, channel: 'email', purpose: 'b' }] },
    ]);
    expect(two).toHaveLength(1);
  });
});
