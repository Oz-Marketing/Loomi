import { NextRequest, NextResponse } from 'next/server';
import { requireInternalJobAuth } from '@/lib/internal-jobs';
import { scanPacerAlerts } from '@/lib/notifications/service';
import { evaluateAlertRules } from '@/lib/alerts/engine';
import { refreshLinkedAccountsForAlerts } from '@/lib/alerts/refresh';

/**
 * POST /api/internal/meta-pacer-alerts/scan
 *
 * Cron-triggered scan of the Meta Ads Pacer dataset. Runs:
 *  - refreshLinkedAccountsForAlerts(): step 0 — pull fresh Meta spend for every
 *    linked account's live month so both passes evaluate current numbers, not
 *    stored data that's stale for accounts nobody has opened.
 *  - scanPacerAlerts(): the built-in operational alerts (due dates, approvals,
 *    stuck, dark, over-allocation, per-ad pacing) + per-recipient digest email.
 *  - evaluateAlertRules(): the §9 config-driven engine (account pace, budget
 *    burn — Google-metric rules join once §8 connects).
 * Both scan passes are idempotent within each alert's cooldown window, so daily
 * runs don't re-spam still-true conditions.
 */
export async function POST(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  try {
    // Step 0: freshen stored spend from Meta before evaluating. Independent —
    // its failure (or a single account's) must not sink the scan; errors are
    // surfaced via the 207 partial-success status.
    let presync: Awaited<ReturnType<typeof refreshLinkedAccountsForAlerts>> | { errors: string[] };
    try {
      presync = await refreshLinkedAccountsForAlerts();
    } catch (err) {
      presync = { errors: [err instanceof Error ? err.message : 'pre-sync failed'] };
    }

    const scan = await scanPacerAlerts();
    // The rules engine is independent — its failure must not sink the scan.
    let engine: Awaited<ReturnType<typeof evaluateAlertRules>> | { errors: string[] };
    try {
      engine = await evaluateAlertRules();
    } catch (err) {
      engine = { errors: [err instanceof Error ? err.message : 'alert engine failed'] };
    }
    const errorCount =
      (presync.errors?.length ?? 0) + scan.errors.length + (engine.errors?.length ?? 0);
    const status = errorCount > 0 ? 207 : 200;
    return NextResponse.json({ presync, scan, engine }, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan pacer alerts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
