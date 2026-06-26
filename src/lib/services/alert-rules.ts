// §9 — AlertRule config CRUD. The engine reads these rows; admins tune them
// (enable, thresholds, tier, cooldown) without a redeploy. Validation lives here
// so both the API route and the seed script reject bad config the same way.

import { prisma } from '@/lib/prisma';
import type { AlertRule } from '@prisma/client';
import { parseFireCondition } from '@/lib/alerts/rules';

const TIERS = new Set(['URGENT', 'FYI']);
const BASELINE_TYPES = new Set([
  'FIXED',
  'ROLLING_AVG_DEVIATION',
  'PERIOD_OVER_PERIOD',
  'CONSECUTIVE_DURATION',
]);

export async function listAlertRules(): Promise<AlertRule[]> {
  return prisma.alertRule.findMany({
    orderBy: [{ channel: 'asc' }, { tier: 'asc' }, { name: 'asc' }],
  });
}

export async function getAlertRule(id: string): Promise<AlertRule | null> {
  return prisma.alertRule.findUnique({ where: { id } });
}

/** The subset of fields an admin can tune from the Settings tab. */
export interface AlertRulePatch {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  tier?: string;
  cooldownHours?: number;
  minVolumeGate?: number | null;
  baselineParams?: string; // JSON object
  fireCondition?: string; // JSON FireCondition
}

function isPlainJsonObject(s: string): boolean {
  try {
    const o = JSON.parse(s);
    return !!o && typeof o === 'object' && !Array.isArray(o);
  } catch {
    return false;
  }
}

/**
 * Patch a rule's tunable fields. Throws on invalid input (the route maps that to
 * a 400). Structural fields (metric, resource, baselineType, channel) are NOT
 * editable here — they define what code path runs, so they're set at seed time.
 */
export async function updateAlertRule(
  id: string,
  patch: AlertRulePatch,
): Promise<AlertRule> {
  const data: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('name cannot be empty.');
    data.name = name;
  }
  if (patch.description !== undefined) {
    data.description = patch.description?.trim() || null;
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be a boolean.');
    data.enabled = patch.enabled;
  }
  if (patch.tier !== undefined) {
    if (!TIERS.has(patch.tier)) throw new Error('tier must be URGENT or FYI.');
    data.tier = patch.tier;
  }
  if (patch.cooldownHours !== undefined) {
    const n = Number(patch.cooldownHours);
    if (!Number.isInteger(n) || n < 0) throw new Error('cooldownHours must be a non-negative integer.');
    data.cooldownHours = n;
  }
  if (patch.minVolumeGate !== undefined) {
    if (patch.minVolumeGate === null) {
      data.minVolumeGate = null;
    } else {
      const n = Number(patch.minVolumeGate);
      if (!Number.isFinite(n) || n < 0) throw new Error('minVolumeGate must be a non-negative number or null.');
      data.minVolumeGate = n;
    }
  }
  if (patch.fireCondition !== undefined) {
    if (!parseFireCondition(patch.fireCondition)) {
      throw new Error('fireCondition must be valid JSON with a comparator.');
    }
    data.fireCondition = patch.fireCondition;
  }
  if (patch.baselineParams !== undefined) {
    if (!isPlainJsonObject(patch.baselineParams)) {
      throw new Error('baselineParams must be a JSON object.');
    }
    data.baselineParams = patch.baselineParams;
  }

  if (Object.keys(data).length === 0) {
    throw new Error('no editable fields supplied.');
  }
  return prisma.alertRule.update({ where: { id }, data });
}

export interface AlertRuleSeed {
  key: string;
  name: string;
  description?: string;
  channel: string;
  metric: string;
  resource: string;
  baselineType: string;
  baselineParams: string;
  fireCondition: string;
  tier: string;
  minVolumeGate?: number | null;
  cooldownHours: number;
  phase: number;
  enabled: boolean;
}

/**
 * Idempotently create a rule by its stable `key`, leaving an existing row's
 * admin-tuned fields (enabled, thresholds, tier, cooldown) untouched on re-seed.
 * Only the structural fields are kept in sync with the seed definition.
 */
export async function upsertAlertRuleByKey(seed: AlertRuleSeed): Promise<AlertRule> {
  if (!BASELINE_TYPES.has(seed.baselineType)) {
    throw new Error(`unknown baselineType: ${seed.baselineType}`);
  }
  if (!TIERS.has(seed.tier)) throw new Error(`unknown tier: ${seed.tier}`);
  if (!parseFireCondition(seed.fireCondition)) {
    throw new Error(`invalid fireCondition for ${seed.key}`);
  }
  return prisma.alertRule.upsert({
    where: { key: seed.key },
    // On re-seed: only re-sync structural fields + description; never clobber an
    // admin's tuning (enabled/tier/cooldown/thresholds/volume gate).
    update: {
      name: seed.name,
      description: seed.description ?? null,
      channel: seed.channel,
      metric: seed.metric,
      resource: seed.resource,
      baselineType: seed.baselineType,
      phase: seed.phase,
    },
    create: {
      key: seed.key,
      name: seed.name,
      description: seed.description ?? null,
      channel: seed.channel,
      metric: seed.metric,
      resource: seed.resource,
      baselineType: seed.baselineType,
      baselineParams: seed.baselineParams,
      fireCondition: seed.fireCondition,
      tier: seed.tier,
      minVolumeGate: seed.minVolumeGate ?? null,
      cooldownHours: seed.cooldownHours,
      phase: seed.phase,
      enabled: seed.enabled,
    },
  });
}
