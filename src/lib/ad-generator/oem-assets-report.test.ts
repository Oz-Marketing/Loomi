import { describe, it, expect } from 'vitest';
import { classifyEvents, countBySeverity, EVENT_EXPIRY_WARN_DAYS, type EventRow } from './oem-assets-report';
import type { CoopRule } from './coop-rules';

function ev(over: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    name: 'Presidents Day Event',
    logoUrl: 'https://cdn/e.png',
    effectiveFrom: '2026-02-14',
    effectiveTo: '2026-02-28',
    required: true,
    offerTypes: [],
    isActive: true,
    phase: 'live',
    daysRemaining: 8,
    ...over,
  };
}

describe('classifyEvents', () => {
  it('reports none when nothing is on file', () => {
    const r = classifyEvents([]);
    expect(r.state).toBe('none');
    expect(r.summary).toContain('none queued');
  });

  it('reports upcoming when only a future event exists', () => {
    const r = classifyEvents([ev({ phase: 'future', daysRemaining: null, effectiveFrom: '2026-03-01' })]);
    expect(r.state).toBe('upcoming');
    expect(r.summary).toContain('starts 2026-03-01');
  });

  it('reports covered for a live event with plenty of runway', () => {
    const r = classifyEvents([ev({ daysRemaining: 40 })]);
    expect(r.state).toBe('covered');
  });

  it('warns when a live event ends soon with nothing queued', () => {
    // The case that matters: ads keep generating and quietly lose a mandated mark.
    const r = classifyEvents([ev({ daysRemaining: 3 })]);
    expect(r.state).toBe('ending_soon');
    expect(r.summary).toContain('nothing follows it');
  });

  it('does NOT warn when a successor is queued', () => {
    const r = classifyEvents(
      [ev({ daysRemaining: 3 }), ev({ id: 'e2', name: 'Spring Event', phase: 'future', daysRemaining: null })],
    );
    expect(r.state).toBe('covered');
    expect(r.summary).toContain('1 queued');
  });

  it('warns exactly at the horizon boundary', () => {
    expect(classifyEvents([ev({ daysRemaining: EVENT_EXPIRY_WARN_DAYS })]).state).toBe('ending_soon');
    expect(classifyEvents([ev({ daysRemaining: EVENT_EXPIRY_WARN_DAYS + 1 })]).state).toBe('covered');
  });

  it('ignores past events entirely', () => {
    const r = classifyEvents([ev({ phase: 'past', daysRemaining: null })]);
    expect(r.state).toBe('none');
  });

  it('ignores deactivated events', () => {
    const r = classifyEvents([ev({ isActive: false })]);
    expect(r.state).toBe('none');
  });

  it('picks the soonest-ending live event when several overlap', () => {
    const r = classifyEvents(
      [ev({ id: 'long', name: 'Q1', daysRemaining: 30 }), ev({ id: 'short', name: 'Presidents', daysRemaining: 2 })],
    );
    expect(r.state).toBe('ending_soon');
    expect(r.summary).toContain('Presidents');
  });
});

describe('countBySeverity', () => {
  const accepted = (pattern: string): CoopRule => ({
    id: pattern,
    kind: 'banned_phrase',
    severity: 'error',
    description: 'No political content.',
    citation: 'SAF §10a, p.47',
    pattern,
    reviewState: 'accepted',
  });

  it('counts an accepted error rule as one that can block', () => {
    expect(countBySeverity([accepted('political|sexual')], { verified: false })).toEqual({
      errorCount: 1,
      warningCount: 0,
    });
  });

  // The engine only reports it as "Not checked", so "can block" would be a claim
  // about enforcement that isn't happening.
  it('does NOT count a rule whose pattern cannot compile as able to block', () => {
    expect(countBySeverity([accepted('(?i)political|sexual')], { verified: true })).toEqual({
      errorCount: 0,
      warningCount: 1,
    });
  });
});
