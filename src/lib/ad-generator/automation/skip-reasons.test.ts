import { describe, expect, it } from 'vitest';
import { SKIP_REASON, skipReasonFix, skipReasonLabel, summarizeSkips, type SkipReason } from './skip-reasons';

const ALL: SkipReason[] = [
  'stock_gate',
  'no_eligible_offer',
  'no_template',
  'no_vehicle_imagery',
  'no_event_slot',
  'preflight_failed',
  'render_failed',
  'cap_reached',
];

describe('SKIP_REASON', () => {
  it('covers every reason the generator can record', () => {
    for (const reason of ALL) {
      expect(SKIP_REASON[reason]?.label, reason).toBeTruthy();
      expect(SKIP_REASON[reason]?.fix, reason).toBeTruthy();
    }
  });

  it('has no reason left reading as its raw code', () => {
    for (const reason of ALL) expect(SKIP_REASON[reason].label).not.toContain('_');
  });
});

describe('skipReasonLabel', () => {
  it('labels a known reason', () => {
    expect(skipReasonLabel('preflight_failed')).toBe('Template check failed');
  });

  it('falls back to a readable form for a reason it does not know', () => {
    // A run recorded by a newer build must not render blank.
    expect(skipReasonLabel('some_new_reason')).toBe('some new reason');
  });
});

describe('skipReasonFix', () => {
  it('points at where to fix a known reason', () => {
    expect(skipReasonFix('no_template')).toContain('Settings');
  });

  it('offers nothing rather than guessing for an unknown reason', () => {
    expect(skipReasonFix('some_new_reason')).toBeNull();
  });
});

describe('summarizeSkips', () => {
  it('is empty for no skips', () => {
    expect(summarizeSkips([])).toBe('');
  });

  it('names a single reason without a count', () => {
    expect(summarizeSkips([{ reason: 'preflight_failed' }])).toBe('Template check failed');
  });

  it('counts repeats and leads with the most common', () => {
    const summary = summarizeSkips([
      { reason: 'no_template' },
      { reason: 'preflight_failed' },
      { reason: 'preflight_failed' },
    ]);
    expect(summary).toBe('Template check failed (2), No template');
  });
});
