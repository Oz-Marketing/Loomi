/**
 * Seed the §9 alert-rule config rows. Idempotent by `key`: on re-seed only the
 * STRUCTURAL fields (name/description/channel/metric/resource/baselineType/phase)
 * are re-synced — an admin's tuning (enabled, tier, cooldown, thresholds, volume
 * gate) is never clobbered. Safe to leave in the deploy pipeline; a no-op once
 * the rows exist and match.
 *
 * Today only Meta FIXED rules are evaluable (account pace, budget burn). Google
 * rules get added here as more rows once the Google Ads API is connected (§8).
 *
 * Keep these definitions in sync with the engine's metric switch
 * (src/lib/alerts/engine.ts) and the AlertRuleSeed shape
 * (src/lib/services/alert-rules.ts).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

interface Seed {
  key: string;
  name: string;
  description: string;
  channel: string;
  metric: string;
  resource: string;
  baselineType: string;
  baselineParams: string;
  fireCondition: string;
  tier: string;
  minVolumeGate: number | null;
  cooldownHours: number;
  phase: number;
  enabled: boolean;
}

const SEEDS: Seed[] = [
  {
    key: 'meta-account-monthly-pace',
    name: 'Account pacing off-target',
    description:
      'Live-month account pace is outside the 85–110% band of expected-to-date (the §7 pacing rollup, eligible ads only).',
    channel: 'meta',
    metric: 'account_monthly_pace',
    resource: 'account',
    baselineType: 'FIXED',
    baselineParams: '{}',
    fireCondition: JSON.stringify({ comparator: 'outside', low: 85, high: 110 }),
    tier: 'FYI',
    minVolumeGate: 50, // skip accounts with < $50 expected-to-date — too thin to act on
    cooldownHours: 20,
    phase: 1,
    enabled: true,
  },
  {
    key: 'meta-campaign-budget-burn',
    name: 'Campaign budget burning early',
    description:
      'A campaign has spent ≥90% of its monthly allocation with more than 5 flight-days left, so it may exhaust early.',
    channel: 'meta',
    metric: 'campaign_budget_burn',
    resource: 'campaign',
    baselineType: 'FIXED',
    baselineParams: JSON.stringify({ minDaysLeft: 5 }),
    fireCondition: JSON.stringify({ comparator: 'gte', value: 90 }),
    tier: 'URGENT',
    minVolumeGate: null, // any budgeted campaign
    cooldownHours: 20,
    phase: 1,
    enabled: true,
  },
  // ── Google channel (§8) — seeded DISABLED until the Google Ads API is
  // connected. The engine is channel-ready: enabling these makes them pace over
  // the account's Google lines. Google-METRIC rules (QS, impression share, PMax,
  // conversions — the non-FIXED baseline types) are added once §8 supplies the
  // metric history; these two reuse the channel-agnostic FIXED metrics.
  {
    key: 'google-account-monthly-pace',
    name: 'Google account pacing off-target',
    description:
      'Live-month Google account pace is outside the 85–110% band of expected-to-date (Google lines only). Disabled until the Google Ads API is connected (§8).',
    channel: 'google',
    metric: 'account_monthly_pace',
    resource: 'account',
    baselineType: 'FIXED',
    baselineParams: '{}',
    fireCondition: JSON.stringify({ comparator: 'outside', low: 85, high: 110 }),
    tier: 'FYI',
    minVolumeGate: 50,
    cooldownHours: 20,
    phase: 1,
    enabled: false,
  },
  {
    key: 'google-campaign-budget-burn',
    name: 'Google campaign budget burning early',
    description:
      'A Google campaign has spent ≥90% of its monthly allocation with more than 5 flight-days left. Disabled until the Google Ads API is connected (§8).',
    channel: 'google',
    metric: 'campaign_budget_burn',
    resource: 'campaign',
    baselineType: 'FIXED',
    baselineParams: JSON.stringify({ minDaysLeft: 5 }),
    fireCondition: JSON.stringify({ comparator: 'gte', value: 90 }),
    tier: 'URGENT',
    minVolumeGate: null,
    cooldownHours: 20,
    phase: 1,
    enabled: false,
  },
];

async function main() {
  let created = 0;
  let synced = 0;
  for (const s of SEEDS) {
    const existing = await prisma.alertRule.findUnique({
      where: { key: s.key },
      select: { key: true },
    });
    await prisma.alertRule.upsert({
      where: { key: s.key },
      update: {
        // structural only — never clobber admin tuning
        name: s.name,
        description: s.description,
        channel: s.channel,
        metric: s.metric,
        resource: s.resource,
        baselineType: s.baselineType,
        phase: s.phase,
      },
      create: {
        key: s.key,
        name: s.name,
        description: s.description,
        channel: s.channel,
        metric: s.metric,
        resource: s.resource,
        baselineType: s.baselineType,
        baselineParams: s.baselineParams,
        fireCondition: s.fireCondition,
        tier: s.tier,
        minVolumeGate: s.minVolumeGate,
        cooldownHours: s.cooldownHours,
        phase: s.phase,
        enabled: s.enabled,
      },
    });
    if (existing) synced += 1;
    else created += 1;
  }
  console.log(`[backfill-alert-rules] created ${created}, re-synced ${synced}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[backfill-alert-rules] failed', e);
    process.exit(1);
  });
