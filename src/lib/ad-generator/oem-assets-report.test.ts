import { describe, it, expect } from 'vitest';
import { classifyEvents, EVENT_EXPIRY_WARN_DAYS, type EventRow } from './oem-assets-report';

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
