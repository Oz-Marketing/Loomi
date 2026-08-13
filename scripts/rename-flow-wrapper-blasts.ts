/**
 * Give the flow engine's wrapper campaigns human-readable names.
 *
 * Each flow email/SMS step gets one wrapper row in EmailBlast / SmsBlast
 * so SendGrid + Twilio events land in the tables the rest of the app
 * already understands. Those rows used to take the raw key as their
 * display name — "Flow:cmsquhfpr0018y6tsxbludq9e/Node:cmsqulwes001cy…" —
 * which is what surfaced in the Blasts list.
 *
 * The key now lives only in `flowNodeKey` (unique, never rewritten) and
 * `name` is free to be legible: "Welcome series · Thanks for reaching
 * out". The send path refreshes the name on every send, so this script
 * only exists to fix wrappers whose flow hasn't sent since the change.
 *
 * Idempotent: rows already carrying a rendered name are left alone.
 * Safe to leave in the deploy pipeline — a no-op once every wrapper has
 * been renamed.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

/** Parse "Flow:<flowId>/Node:<nodeId>" back into its two ids. */
function parseKey(key: string): { flowId: string; nodeId: string } | null {
  const match = /^Flow:([^/]+)\/Node:(.+)$/.exec(key);
  if (!match) return null;
  return { flowId: match[1], nodeId: match[2] };
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Mirrors stepLabelForNode + flowWrapperDisplayName in
 *  src/lib/services/loomi-flows.ts. Kept as a local copy so this script
 *  stays a standalone tsx entry point with no app-module imports. */
function displayName(
  flowName: string,
  config: Record<string, unknown>,
  fallback: string,
): string {
  const explicit = String(config.label || config.title || '').trim();
  const subject = String(config.subject || config.message || '').trim();
  const step = (explicit || subject || fallback).slice(0, 60);
  const flow = flowName.trim() || 'Untitled flow';
  return step ? `${flow} · ${step}` : flow;
}

async function main() {
  const [emails, texts] = await Promise.all([
    prisma.emailBlast.findMany({
      where: { flowNodeKey: { not: null } },
      select: { id: true, name: true, flowNodeKey: true },
    }),
    prisma.smsBlast.findMany({
      where: { flowNodeKey: { not: null } },
      select: { id: true, name: true, flowNodeKey: true },
    }),
  ]);

  const wrappers = [
    ...emails.map((r) => ({ ...r, channel: 'email' as const })),
    ...texts.map((r) => ({ ...r, channel: 'sms' as const })),
  ];

  if (wrappers.length === 0) {
    console.log('[rename-flow-wrapper-blasts] no flow wrappers found — nothing to do.');
    return;
  }

  // Only rows still displaying the raw key need work.
  const stale = wrappers.filter((r) => (r.name || '').startsWith('Flow:'));
  if (stale.length === 0) {
    console.log(
      `[rename-flow-wrapper-blasts] all ${wrappers.length} wrapper(s) already named — no-op.`,
    );
    return;
  }

  // Resolve every referenced flow + node in two queries rather than
  // per-row lookups.
  const parsed = stale
    .map((r) => ({ row: r, ids: parseKey(r.flowNodeKey!) }))
    .filter((e): e is { row: (typeof stale)[number]; ids: { flowId: string; nodeId: string } } =>
      e.ids !== null,
    );

  const [flows, nodes] = await Promise.all([
    prisma.loomiFlow.findMany({
      where: { id: { in: [...new Set(parsed.map((e) => e.ids.flowId))] } },
      select: { id: true, name: true },
    }),
    prisma.loomiFlowNode.findMany({
      where: { id: { in: [...new Set(parsed.map((e) => e.ids.nodeId))] } },
      select: { id: true, config: true },
    }),
  ]);
  const flowById = new Map(flows.map((f) => [f.id, f.name]));
  const configById = new Map(nodes.map((n) => [n.id, parseConfig(n.config)]));

  let renamed = 0;
  let orphaned = 0;
  for (const { row, ids } of parsed) {
    const flowName = flowById.get(ids.flowId);
    if (flowName === undefined) {
      // The flow was hard-deleted but its wrapper survived (EmailBlast
      // has no FK to LoomiFlow). Leave the raw key so the row stays
      // traceable rather than inventing a name for a flow that's gone.
      orphaned += 1;
      continue;
    }
    const name = displayName(
      flowName,
      configById.get(ids.nodeId) ?? {},
      row.channel === 'sms' ? 'SMS step' : 'Email step',
    );
    if (row.channel === 'sms') {
      await prisma.smsBlast.update({ where: { id: row.id }, data: { name } });
    } else {
      await prisma.emailBlast.update({ where: { id: row.id }, data: { name } });
    }
    renamed += 1;
  }

  console.log(
    `[rename-flow-wrapper-blasts] renamed ${renamed} wrapper(s); ` +
      `${orphaned} left as-is (flow deleted); ` +
      `${wrappers.length - stale.length} already named.`,
  );
}

main()
  .catch((err) => {
    console.error('[rename-flow-wrapper-blasts] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
