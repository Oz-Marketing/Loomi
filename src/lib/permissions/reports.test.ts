import { describe, it, expect } from 'vitest';
import {
  CLIENT_ELIGIBLE_REPORTS,
  REPORTS,
  isClientEligible,
  reportDefinition,
  resolveClientReports,
} from './reports';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './registry';

describe('report registry', () => {
  it('gives every report a permission that exists', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const report of REPORTS) {
      expect(known.has(report.permission), `${report.key} → ${report.permission}`).toBe(true);
    }
  });

  it('has no duplicate keys', () => {
    const keys = REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * The load-bearing one. `reporting.client` is the only role a dealer can
   * hold, so anything it can reach is client-visible — and the allowlist UI
   * only offers `CLIENT_ELIGIBLE_REPORTS`. If Budget or Executive ever became
   * eligible, an account manager could tick a box and hand a dealer internal
   * figures.
   */
  it('keeps Budget and Executive out of reach of clients', () => {
    const clientPerms = new Set(ROLE_PERMISSIONS['reporting.client']);

    for (const key of ['budget', 'executive'] as const) {
      const report = reportDefinition(key)!;
      expect(clientPerms.has(report.permission), `${key} permission`).toBe(false);
      expect(isClientEligible(key), `${key} eligibility`).toBe(false);
      expect(report.defaultForClients, `${key} default`).toBe(false);
    }

    // And every eligible report must be one reporting.client actually holds.
    for (const report of CLIENT_ELIGIBLE_REPORTS) {
      expect(clientPerms.has(report.permission), `${report.key} is offered to clients`).toBe(
        true,
      );
    }
  });

  it('offers only reporting.report.view reports to clients', () => {
    for (const report of CLIENT_ELIGIBLE_REPORTS) {
      expect(report.permission).toBe('reporting.report.view' satisfies Permission);
    }
  });
});

describe('resolveClientReports', () => {
  it('falls back to the registry default when there is no row', () => {
    // Asserted against the registry rather than a hard-coded expectation, so
    // this keeps testing the fallback itself even if a default ever changes.
    const resolved = resolveClientReports([]);
    for (const report of CLIENT_ELIGIBLE_REPORTS) {
      expect(resolved.has(report.key), report.key).toBe(report.defaultForClients);
    }
  });

  it('lets an explicit row override the default in both directions', () => {
    expect(
      resolveClientReports([{ reportKey: 'call_tracking', enabled: true }]).has(
        'call_tracking',
      ),
    ).toBe(true);
  });

  it('lets an explicit row switch a default-on report off', () => {
    const resolved = resolveClientReports([{ reportKey: 'ads', enabled: false }]);
    expect(resolved.has('ads')).toBe(false);
  });

  // A row for a report clients can never hold must not smuggle it in.
  it('ignores a row enabling an ineligible report', () => {
    const resolved = resolveClientReports([
      { reportKey: 'budget', enabled: true },
      { reportKey: 'executive', enabled: true },
    ]);
    expect(resolved.has('budget' as never)).toBe(false);
    expect(resolved.has('executive' as never)).toBe(false);
  });

  it('ignores a row for a report key that no longer exists', () => {
    const resolved = resolveClientReports([{ reportKey: 'retired_report', enabled: true }]);
    expect([...resolved]).not.toContain('retired_report');
  });
});

describe('deploying the allowlist changes nothing', () => {
  /**
   * The allowlist is opt-OUT. An account with no stored rows must resolve to
   * exactly what its clients can see today, or shipping this quietly removes
   * reports from live dealers — and "Call Tracking vanished" is not a symptom
   * anyone would trace back to a permissions release.
   */
  it('shows every client-eligible report when no rows are stored', () => {
    const resolved = resolveClientReports([]);
    for (const report of CLIENT_ELIGIBLE_REPORTS) {
      expect(resolved.has(report.key), `${report.key} must default to visible`).toBe(true);
    }
    expect(resolved.size).toBe(CLIENT_ELIGIBLE_REPORTS.length);
  });

  it('still lets an explicit row turn one off', () => {
    const resolved = resolveClientReports([
      { reportKey: 'call_tracking', enabled: false },
    ]);
    expect(resolved.has('call_tracking')).toBe(false);
    expect(resolved.has('ads')).toBe(true);
  });
});
