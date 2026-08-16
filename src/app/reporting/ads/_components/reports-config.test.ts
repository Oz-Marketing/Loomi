/**
 * `visibleReports` decides whether a client sees a report AT ALL, as opposed to
 * the lens deciding how much of one they see. That makes it permission-shaped,
 * and the failure mode is silent: adding a cross-account report without the
 * `internal` flag exposes every other account's activity to one client, and
 * nothing about the UI would look wrong.
 */
import { describe, it, expect } from 'vitest';
import { DIGITAL_ADS_REPORTS, visibleReports, findReport } from './reports-config';

describe('visibleReports', () => {
  it('gives agency users every report', () => {
    expect(visibleReports(false)).toHaveLength(DIGITAL_ADS_REPORTS.length);
  });

  it('withholds internal reports from clients', () => {
    const keys = visibleReports(true).map((r) => r.key);
    expect(keys).not.toContain('ad-templates');
  });

  it('still gives clients the platform reports', () => {
    const keys = visibleReports(true).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['meta', 'google', 'stackadapt', 'blasts']));
  });

  it('drops exactly the reports flagged internal, no more', () => {
    const internal = DIGITAL_ADS_REPORTS.filter((r) => r.internal).map((r) => r.key);
    const withheld = DIGITAL_ADS_REPORTS.map((r) => r.key).filter(
      (k) => !visibleReports(true).some((r) => r.key === k),
    );
    expect(withheld).toEqual(internal);
  });

  it('flags the cross-account template report as internal', () => {
    // It ranks template usage across EVERY account, so one client seeing it
    // would learn the shape of the agency's work for all the others.
    expect(findReport('ad-templates')?.internal).toBe(true);
  });

  it('leaves single-account platform reports un-flagged', () => {
    for (const key of ['meta', 'google', 'stackadapt', 'blasts']) {
      expect(findReport(key)?.internal).toBeFalsy();
    }
  });
});
