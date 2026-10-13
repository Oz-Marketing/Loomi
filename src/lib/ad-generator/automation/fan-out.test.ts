import { describe, it, expect } from 'vitest';
import { effectiveFanOut } from './fan-out';

describe('effectiveFanOut', () => {
  it('is empty — unconstrained — when the config names no set', () => {
    // The default for a rooftop that never picked designs, and what the fan-out
    // did when it shipped: every published template in scope.
    expect(effectiveFanOut({ adTemplateId: 'tpl_offer', fanOutTemplateIds: [] })).toEqual([]);
    expect(effectiveFanOut({})).toEqual([]);
  });

  it('returns exactly the named set', () => {
    expect(
      effectiveFanOut({ adTemplateId: 'a', fanOutTemplateIds: ['a', 'b'] }).sort(),
    ).toEqual(['a', 'b']);
  });

  it('unions the recommended design in when it was left out', () => {
    // A config whose lead sits outside its own set would recommend a design the
    // run then refuses to build, and the dealer's row would lead with nothing.
    expect(effectiveFanOut({ adTemplateId: 'lead', fanOutTemplateIds: ['b'] }).sort()).toEqual([
      'b',
      'lead',
    ]);
  });

  it('does not invent a constraint from a lead alone', () => {
    // Naming a recommended design must not silently narrow the run to it.
    expect(effectiveFanOut({ adTemplateId: 'lead', fanOutTemplateIds: [] })).toEqual([]);
  });
});
