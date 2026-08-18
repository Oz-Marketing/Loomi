import { describe, it, expect } from 'vitest';
import {
  periodKey,
  resolveAutomationTemplate,
  scheduleCovers,
  type TemplateCandidate,
} from './resolve-automation-template';
import type { TemplateDoc } from '../doc-types';

const RUN = new Date('2026-08-01T00:00:00Z');

function tpl(
  id: string,
  over: {
    name?: string;
    accountKey?: string | null;
    make?: string;
    schedule?: { start?: string | null; end?: string | null };
    updatedAt?: string;
    usage?: 'oem' | 'custom' | 'both';
  } = {},
): TemplateCandidate {
  const doc = {
    id,
    name: over.name ?? id,
    sizes: [{ id: 'square', label: 'Square', width: 1080, height: 1080 }],
    fields: [],
    elements: [],
    layouts: { square: {} },
    defaults: {},
    ...(over.make ? { make: over.make } : {}),
    ...(over.schedule ? { schedule: over.schedule } : {}),
    ...(over.usage ? { usage: over.usage } : {}),
  } as TemplateDoc;
  return {
    id,
    name: over.name ?? id,
    accountKey: over.accountKey ?? null,
    doc,
    updatedAt: new Date(over.updatedAt ?? '2026-01-01T00:00:00Z'),
  };
}

const BASE = { accountKey: 'youngChev', offerType: 'lease', make: 'Chevrolet', runDate: RUN };

describe('periodKey', () => {
  it('formats yyyy-MM in UTC', () => {
    expect(periodKey(RUN)).toBe('2026-08');
    expect(periodKey(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12');
  });
});

describe('scheduleCovers', () => {
  const withSchedule = (s: { start?: string | null; end?: string | null }) => tpl('t', { schedule: s }).doc;

  it('is true inside the window', () => {
    expect(scheduleCovers(withSchedule({ start: '2026-07-25', end: '2026-08-10' }), RUN)).toBe(true);
  });

  it('is inclusive on both bounds', () => {
    expect(scheduleCovers(withSchedule({ start: '2026-08-01', end: '2026-08-01' }), RUN)).toBe(true);
  });

  it('is false before and after', () => {
    expect(scheduleCovers(withSchedule({ start: '2026-09-01' }), RUN)).toBe(false);
    expect(scheduleCovers(withSchedule({ end: '2026-07-31' }), RUN)).toBe(false);
  });

  it('treats an open-ended bound as covering that direction', () => {
    expect(scheduleCovers(withSchedule({ start: '2026-01-01' }), RUN)).toBe(true);
    expect(scheduleCovers(withSchedule({ end: '2026-12-31' }), RUN)).toBe(true);
  });

  it('is false with no schedule, and false for an empty window', () => {
    expect(scheduleCovers(tpl('t').doc, RUN)).toBe(false);
    expect(scheduleCovers(withSchedule({}), RUN)).toBe(false);
  });
});

describe('precedence', () => {
  it('a monthly pin beats everything', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('pinned'), tpl('seasonal', { schedule: { start: '2026-07-01', end: '2026-08-31' } })],
      templateMap: { lease: 'seasonal' },
      monthlyPins: { '2026-08': 'pinned' },
    });
    expect(r.reason).toBe('monthly_pin');
    expect(r.template?.id).toBe('pinned');
  });

  it('a schedule window beats a mapped default', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('normal'), tpl('seasonal', { schedule: { start: '2026-07-25', end: '2026-08-10' } })],
      templateMap: { lease: 'normal' },
    });
    expect(r.reason).toBe('schedule_window');
    expect(r.template?.id).toBe('seasonal');
    expect(r.explanation).toContain('2026-08-01');
  });

  it('an expired schedule stops winning without any config change', () => {
    // The point of reusing TemplateDoc.schedule: seasonal creative takes over and
    // then steps aside on its own.
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('normal'), tpl('seasonal', { schedule: { start: '2026-06-01', end: '2026-07-04' } })],
      templateMap: { lease: 'normal' },
    });
    expect(r.reason).toBe('offer_type_default');
    expect(r.template?.id).toBe('normal');
  });

  it('an offer-type default beats the all-types default', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('forLease'), tpl('forAll')],
      templateMap: { lease: 'forLease', all: 'forAll' },
    });
    expect(r.reason).toBe('offer_type_default');
    expect(r.template?.id).toBe('forLease');
  });

  it('falls back to the all-types default for an unmapped offer type', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      offerType: 'discount',
      candidates: [tpl('forLease'), tpl('forAll')],
      templateMap: { lease: 'forLease', all: 'forAll' },
    });
    expect(r.reason).toBe('all_types_default');
    expect(r.template?.id).toBe('forAll');
  });

  it('falls back to a make-matched template when nothing is mapped', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('ford', { make: 'Ford' }), tpl('chev', { make: 'Chevrolet' })],
    });
    expect(r.reason).toBe('brand_fallback');
    expect(r.template?.id).toBe('chev');
  });

  it('matches the make case-insensitively', () => {
    const r = resolveAutomationTemplate({ ...BASE, candidates: [tpl('chev', { make: 'chevrolet' })] });
    expect(r.template?.id).toBe('chev');
  });
});

describe('refusing to guess', () => {
  it('returns none when nothing matches, and says what to do', () => {
    const r = resolveAutomationTemplate({ ...BASE, candidates: [tpl('ford', { make: 'Ford' })] });
    expect(r.template).toBeNull();
    expect(r.reason).toBe('none');
    expect(r.explanation).toContain('Map one');
  });

  it('returns none when there are no candidates at all', () => {
    const r = resolveAutomationTemplate({ ...BASE, candidates: [] });
    expect(r.template).toBeNull();
    expect(r.explanation).toContain('No published templates');
  });

  it('refuses rather than substituting when a pin points at a deleted template', () => {
    // Substituting would silently run the offer through a design nobody chose.
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('other'), tpl('chev', { make: 'Chevrolet' })],
      templateMap: { lease: 'other' },
      monthlyPins: { '2026-08': 'deleted-id' },
    });
    expect(r.template).toBeNull();
    expect(r.explanation).toContain('no longer available');
  });

  it('ignores a mapped id that no longer exists and continues down the chain', () => {
    // A stale MAP entry is ordinary config drift, unlike an explicit pin.
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [tpl('chev', { make: 'Chevrolet' })],
      templateMap: { lease: 'gone' },
    });
    expect(r.reason).toBe('brand_fallback');
  });
});

describe('determinism — the property idempotency depends on', () => {
  const candidates = [
    tpl('a', { make: 'Chevrolet', updatedAt: '2026-05-01T00:00:00Z' }),
    tpl('b', { make: 'Chevrolet', updatedAt: '2026-05-01T00:00:00Z' }), // identical timestamp
    tpl('c', { make: 'Chevrolet', updatedAt: '2026-04-01T00:00:00Z' }),
  ];

  it('returns the same template across repeated calls', () => {
    const first = resolveAutomationTemplate({ ...BASE, candidates });
    for (let i = 0; i < 10; i++) {
      expect(resolveAutomationTemplate({ ...BASE, candidates }).template?.id).toBe(first.template?.id);
    }
  });

  it('is unaffected by candidate input order', () => {
    const forward = resolveAutomationTemplate({ ...BASE, candidates }).template?.id;
    const reversed = resolveAutomationTemplate({ ...BASE, candidates: [...candidates].reverse() }).template?.id;
    expect(reversed).toBe(forward);
  });

  it('breaks equal timestamps by id, so the order is total', () => {
    // Without the id tiebreak the sort is unstable and a retry could pick 'b'
    // where the first run picked 'a', defeating the unique constraint.
    expect(resolveAutomationTemplate({ ...BASE, candidates }).template?.id).toBe('a');
  });

  it('prefers an account-owned template over a global one', () => {
    const r = resolveAutomationTemplate({
      ...BASE,
      candidates: [
        tpl('global', { make: 'Chevrolet', updatedAt: '2026-06-01T00:00:00Z' }),
        tpl('mine', { make: 'Chevrolet', accountKey: 'youngChev', updatedAt: '2026-01-01T00:00:00Z' }),
      ],
    });
    // Ownership outranks recency.
    expect(r.template?.id).toBe('mine');
  });
});


describe('usage filtering', () => {
  const base = { candidates: [] as TemplateCandidate[], accountKey: 'acct', offerType: 'lease', make: 'Mazda', runDate: RUN };

  // The hazard this closes: automation's last resort is a make match, so a plate
  // a designer built for a person to fill was already a candidate for unattended
  // ads of the same brand.
  it('will not brand-fallback onto a custom-only template', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('custom-mazda', { make: 'Mazda', usage: 'custom' })],
    });
    expect(r.template).toBeNull();
    expect(r.reason).toBe('none');
    expect(r.explanation).toContain('all are marked custom-only');
  });

  it('brand-falls back onto an oem template', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('oem-mazda', { make: 'Mazda', usage: 'oem' })],
    });
    expect(r.template?.id).toBe('oem-mazda');
    expect(r.reason).toBe('brand_fallback');
  });

  it("treats 'both' as usable", () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('shared', { make: 'Mazda', usage: 'both' })],
    });
    expect(r.template?.id).toBe('shared');
  });

  // Existing templates predate the field and must keep working.
  it('treats an unset usage as usable', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('legacy', { make: 'Mazda' })],
    });
    expect(r.template?.id).toBe('legacy');
  });

  it('skips a custom-only template and picks the oem one beside it', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [
        tpl('custom-newer', { make: 'Mazda', usage: 'custom', updatedAt: '2026-07-01T00:00:00Z' }),
        tpl('oem-older', { make: 'Mazda', usage: 'oem', updatedAt: '2026-01-01T00:00:00Z' }),
      ],
    });
    // Without the filter the newer custom plate would have won the sort.
    expect(r.template?.id).toBe('oem-older');
  });

  // An explicit pin is the strongest signal in the module, and it still must not
  // reach a custom plate — but the refusal has to say WHY, or it reads as a
  // deleted template.
  it('refuses a pin onto a custom-only template, distinctly from a missing one', () => {
    const custom = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('pinned-custom', { usage: 'custom' })],
      monthlyPins: { '2026-08': 'pinned-custom' },
    });
    expect(custom.template).toBeNull();
    expect(custom.explanation).toContain('marked custom-only');

    const missing = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('something-else', { usage: 'oem' })],
      monthlyPins: { '2026-08': 'deleted-id' },
    });
    expect(missing.template).toBeNull();
    expect(missing.explanation).toContain('no longer available');
  });

  it('will not use a custom-only template even when mapped as the default', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('mapped-custom', { usage: 'custom' })],
      templateMap: { lease: 'mapped-custom' },
    });
    expect(r.template).toBeNull();
  });

  it('will not use a custom-only template even inside its schedule window', () => {
    const r = resolveAutomationTemplate({
      ...base,
      candidates: [tpl('seasonal-custom', { usage: 'custom', schedule: { start: '2026-07-01', end: '2026-09-01' } })],
    });
    expect(r.template).toBeNull();
  });

  it('reports no templates in scope differently from all-custom', () => {
    const r = resolveAutomationTemplate({ ...base, candidates: [] });
    expect(r.explanation).toContain('No published templates are in scope');
  });
});
