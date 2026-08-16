/**
 * Which reporting integrations have server credentials — checked once at boot.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three ported reports (Website Analytics, Reputation, Business Profile) had
 * never been given credentials in ANY environment, and nobody noticed for
 * months. Each one degrades politely — `getGa4Config()` returns null, the route
 * answers 503 `not_configured`, the page renders a tidy "not configured on the
 * server yet" card. That politeness is the problem: a missing credential looks
 * exactly like a feature that is switched off on purpose, so the only person
 * who ever finds out is a client opening an empty report.
 *
 * A missing credential is an operational fact about the deploy, so it belongs
 * in the boot log next to the other things that are true about the deploy.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not throw, and it must never start refusing to boot. Not every
 * environment is meant to have every integration — a review app or a local
 * checkout legitimately runs with none of them, and a server that won't start
 * because Reputation is unconfigured is a worse failure than the one being
 * fixed here.
 *
 * It does not check whether a credential WORKS. Presence is cheap, local and
 * deterministic; validity means a network call per integration on every boot,
 * which turns a vendor outage into a slow or noisy startup. Presence catches
 * the failure that actually happened.
 *
 * It never logs a value, only whether the name is set.
 */

export interface IntegrationCredential {
  /** Report or surface this powers, as a user would name it. */
  label: string;
  /** Env vars that must ALL be present for the integration to configure. */
  vars: string[];
  /** What is unavailable without it — one short clause. */
  impact: string;
}

/**
 * Reporting integrations that authenticate as the AGENCY.
 *
 * Per-account credentials are out of scope: Business Profile stores a refresh
 * token per rooftop, so "configured" there is a property of the account row,
 * not the server. Its OAuth *client* is a server credential though, and that is
 * what is listed here.
 */
export const REPORTING_CREDENTIALS: IntegrationCredential[] = [
  {
    label: 'Meta Ads',
    vars: ['META_SYSTEM_USER_TOKEN'],
    impact: 'Meta reporting and the ad pacer',
  },
  {
    label: 'Google Ads',
    vars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_REFRESH_TOKEN'],
    impact: 'Google Ads reporting',
  },
  {
    label: 'StackAdapt',
    vars: ['STACKADAPT_API_KEY'],
    impact: 'OTT / CTV reporting',
  },
  {
    label: 'Website Analytics',
    vars: ['GA4_SERVICE_ACCOUNT_JSON'],
    impact: 'the GA4 report (and its key events)',
  },
  {
    label: 'Reputation',
    // Either name works — google-places.ts accepts both.
    vars: ['GOOGLE_MAPS_API_KEY|GOOGLE_PLACES_API_KEY'],
    impact: 'live ratings and review counts',
  },
  {
    label: 'Business Profile',
    vars: ['GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'GBP_REDIRECT_URI'],
    impact: 'connecting a rooftop to Google Business Profile',
  },
];

export interface CredentialStatus {
  label: string;
  configured: boolean;
  /** Names that are absent — never values. */
  missing: string[];
  impact: string;
}

/**
 * Just a name → value lookup, NOT `NodeJS.ProcessEnv`: the repo augments that
 * type to require NODE_ENV, which would force every caller and test to supply
 * a variable this has no interest in. `process.env` satisfies this.
 */
export type EnvLike = Record<string, string | undefined>;

/** A `|`-joined spec is satisfied by ANY of its alternatives. */
function isPresent(spec: string, env: EnvLike): boolean {
  return spec.split('|').some((name) => Boolean(env[name]?.trim()));
}

/** Pure, and takes the environment, so it can be tested without touching process.env. */
export function checkReportingCredentials(
  env: EnvLike = process.env,
): CredentialStatus[] {
  return REPORTING_CREDENTIALS.map(({ label, vars, impact }) => {
    const missing = vars.filter((spec) => !isPresent(spec, env));
    return { label, configured: missing.length === 0, missing, impact };
  });
}

/**
 * Render the boot line(s). Returns null when everything is configured — a
 * healthy deploy should add nothing to the log, or the message stops being
 * read.
 */
export function formatCredentialReport(statuses: CredentialStatus[]): string | null {
  const missing = statuses.filter((s) => !s.configured);
  if (missing.length === 0) return null;

  const lines = [
    `[reporting] ${missing.length} of ${statuses.length} integrations have no server credential.`,
    '[reporting] These reports will answer 503 not_configured and render an empty state:',
    ...missing.map((s) => `[reporting]   • ${s.label} — unavailable: ${s.impact}`),
    // `A|B` means either satisfies it — spell that out rather than printing
    // a pipe, which reads as a typo in a line someone is meant to act on.
    `[reporting]   set: ${missing
      .flatMap((s) => s.missing)
      .map((spec) => spec.split('|').join(' or '))
      .join(', ')}`,
    '[reporting] See docs/odt-reporting-migration.md §1.1.',
  ];
  return lines.join('\n');
}

/**
 * Log the report. Call once, from the instrumentation hook.
 *
 * `warn` rather than `error`: an unconfigured integration is a deployment
 * choice in some environments, and error level would train people to ignore it
 * in exactly the environments where it is routine.
 */
export function logReportingCredentials(env: EnvLike = process.env): void {
  const report = formatCredentialReport(checkReportingCredentials(env));
  if (report) console.warn(report);
}
