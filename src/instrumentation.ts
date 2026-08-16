/**
 * Next.js instrumentation hook — runs once per server process, before the
 * first request is handled.
 *
 * Kept deliberately thin. Everything here delays the first response and runs in
 * every environment including build-time probes, so it is for facts about the
 * DEPLOY that are cheap to establish locally. Anything needing a network call,
 * a database, or a vendor belongs in a health check, not here.
 */

export async function register() {
  // `nodejs` | `edge`. The edge runtime gets its own process with a different
  // env, and warning twice per boot would train people to skim the warning.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { logReportingCredentials } = await import('./lib/integrations/credential-check');
  logReportingCredentials();
}
