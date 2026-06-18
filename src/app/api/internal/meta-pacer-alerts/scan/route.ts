import { NextRequest, NextResponse } from 'next/server';
import { requireInternalJobAuth } from '@/lib/internal-jobs';
import { scanPacerAlerts } from '@/lib/notifications/service';
import { evaluateAlertRules } from '@/lib/alerts/engine';

/**
 * POST /api/internal/meta-pacer-alerts/scan
 *
 * Cron-triggered scan of the Meta Ads Pacer dataset. Runs two passes:
 *  - scanPacerAlerts(): the built-in operational alerts (due dates, approvals,
 *    stuck, dark, over-allocation, per-ad pacing) + per-recipient digest email.
 *  - evaluateAlertRules(): the §9 config-driven engine (account pace, budget
 *    burn — Google-metric rules join once §8 connects).
 * Both are idempotent within each alert's cooldown window, so daily runs don't
 * re-spam still-true conditions.
 */
export async function POST(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  try {
    const scan = await scanPacerAlerts();
    // The rules engine is independent — its failure must not sink the scan.
    let engine: Awaited<ReturnType<typeof evaluateAlertRules>> | { errors: string[] };
    try {
      engine = await evaluateAlertRules();
    } catch (err) {
      engine = { errors: [err instanceof Error ? err.message : 'alert engine failed'] };
    }
    const errorCount = scan.errors.length + (engine.errors?.length ?? 0);
    const status = errorCount > 0 ? 207 : 200;
    return NextResponse.json({ scan, engine }, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan pacer alerts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
