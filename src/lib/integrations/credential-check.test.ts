/**
 * The check exists because three integrations were silently unconfigured for
 * months, so the cases that matter are: does it stay quiet when it should, does
 * it speak up when it should, and does it ever leak a secret into the log.
 */
import { describe, it, expect } from 'vitest';
import {
  checkReportingCredentials,
  formatCredentialReport,
  REPORTING_CREDENTIALS,
  type EnvLike,
} from './credential-check';

/** Every credential present — the shape a fully-provisioned environment has. */
function fullEnv(): EnvLike {
  const env: EnvLike = {};
  for (const c of REPORTING_CREDENTIALS) {
    // A `|` spec needs only its first alternative.
    for (const spec of c.vars) env[spec.split('|')[0]] = 'set';
  }
  return env;
}

describe('checkReportingCredentials', () => {
  it('reports every integration configured when all vars are present', () => {
    const statuses = checkReportingCredentials(fullEnv());
    expect(statuses.every((s) => s.configured)).toBe(true);
    expect(formatCredentialReport(statuses)).toBeNull();
  });

  it('reproduces the production state that motivated this check', () => {
    // Verified 2026-08-16: Meta, Google Ads and StackAdapt set; the three that
    // needed a new Google credential absent.
    const statuses = checkReportingCredentials({
      META_SYSTEM_USER_TOKEN: 't',
      GOOGLE_ADS_DEVELOPER_TOKEN: 't',
      GOOGLE_ADS_CLIENT_ID: 't',
      GOOGLE_ADS_REFRESH_TOKEN: 't',
      STACKADAPT_API_KEY: 't',
    });
    const unconfigured = statuses.filter((s) => !s.configured).map((s) => s.label);
    expect(unconfigured).toEqual(['Website Analytics', 'Reputation', 'Business Profile']);
  });

  it('treats a partially-configured integration as unconfigured', () => {
    // Two of Google Ads' three vars — the report cannot run, so "configured"
    // would be a lie that hides a half-finished setup.
    const [gads] = checkReportingCredentials({
      GOOGLE_ADS_DEVELOPER_TOKEN: 't',
      GOOGLE_ADS_CLIENT_ID: 't',
    }).filter((s) => s.label === 'Google Ads');
    expect(gads.configured).toBe(false);
    expect(gads.missing).toEqual(['GOOGLE_ADS_REFRESH_TOKEN']);
  });

  it('accepts either name for the Places key', () => {
    const pick = (env: EnvLike) =>
      checkReportingCredentials(env).find((s) => s.label === 'Reputation')!.configured;
    expect(pick({ GOOGLE_MAPS_API_KEY: 'k' })).toBe(true);
    expect(pick({ GOOGLE_PLACES_API_KEY: 'k' })).toBe(true);
    expect(pick({})).toBe(false);
  });

  it('treats an empty or whitespace value as absent', () => {
    // A var set to "" in a .env is the classic half-configured deploy.
    const statuses = checkReportingCredentials({ META_SYSTEM_USER_TOKEN: '   ' });
    expect(statuses.find((s) => s.label === 'Meta Ads')!.configured).toBe(false);
  });
});

describe('formatCredentialReport', () => {
  it('names the variables to set but never a value', () => {
    const report = formatCredentialReport(
      checkReportingCredentials({ GA4_SERVICE_ACCOUNT_JSON: 'super-secret-key-material' }),
    )!;
    expect(report).toContain('GBP_CLIENT_ID');
    expect(report).not.toContain('super-secret-key-material');
    // The one that IS configured must not be named as missing.
    expect(report).not.toContain('GA4_SERVICE_ACCOUNT_JSON');
  });

  it('points at the doc that explains the fix', () => {
    const report = formatCredentialReport(checkReportingCredentials({}))!;
    expect(report).toContain('docs/odt-reporting-migration.md');
  });

  it('says what each missing integration costs the user', () => {
    const report = formatCredentialReport(checkReportingCredentials({}))!;
    expect(report).toContain('live ratings and review counts');
  });
});
