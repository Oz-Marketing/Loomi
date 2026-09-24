/**
 * Node-side helpers for the e2e suite, registered as `cy.task`s in
 * cypress.config.ts. These run in Cypress's Node process, not the browser.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

// ── Page discovery ──────────────────────────────────────────────────────────

/**
 * Every STATIC page route under src/app, as a URL path ("/contacts/lists").
 *
 * surfaces.cy.ts checks its route list against this, so a page added to the
 * app without being added to the smoke list fails the suite instead of going
 * untested. Dynamic segments (`[id]`) are skipped: they need real ids.
 */
export function listStaticPages(): string[] {
  const root = path.resolve(__dirname, '../src/app');
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('[') || entry.name.startsWith('_') || entry.name === 'api') continue;
        // `(group)` folders don't appear in the URL.
        const next = /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name];
        walk(path.join(dir, entry.name), next);
      } else if (entry.name === 'page.tsx') {
        routes.push('/' + segments.join('/'));
      }
    }
  };
  walk(root, []);
  return routes.sort();
}

// ── Test data ───────────────────────────────────────────────────────────────

/**
 * Fixed ids, so seeding is an upsert and a run that died halfway leaves
 * nothing a re-run can't overwrite. Prefixed so a stray row is obviously a
 * test's in any database it lands in.
 */
export const CLIENT_FIXTURES = {
  accountKey: 'youngHondaOgden', // the seeded client's only account (prisma/seed.ts)
  automationCampaignId: 'e2e-client-automation-campaign',
  manualCampaignId: 'e2e-client-manual-campaign',
  adId: 'e2e-client-automation-ad',
} as const;

/**
 * Plain SQL through `pg` rather than the Prisma client: this file is
 * typechecked by `npm run verify:e2e`, and the component-test job runs that
 * without `prisma generate`, so importing the generated client would fail it.
 *
 * DATABASE_URL comes from the environment in CI. Locally it falls back to
 * `.env`, which is also what `next dev` reads, so the rows land in the same
 * database the server under test is using.
 */
async function withDb<T>(fn: (client: import('pg').Client) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) await import('dotenv/config');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; the e2e data tasks need the app database.');
  const { default: pg } = await import('pg');
  const needsSsl = /[?&]sslmode=require/.test(url);
  const client = new pg.Client({
    connectionString: url.replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, ''),
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * One automation campaign (with one ad in it) and one manual campaign on the
 * client's account. The client may see the first and must never see the
 * second: `automationOnly` limits the client tier to automation campaigns.
 */
export async function seedClientCampaigns(): Promise<typeof CLIENT_FIXTURES> {
  const f = CLIENT_FIXTURES;
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO "Campaign" (id, name, "accountKey", source, status, "createdAt", "updatedAt")
       VALUES ($1, 'E2E automation campaign', $3, 'automation', 'ready', now(), now()),
              ($2, 'E2E manual campaign',     $3, 'manual',     'draft', now(), now())
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, "accountKey" = EXCLUDED."accountKey", source = EXCLUDED.source,
             status = EXCLUDED.status, "archivedAt" = NULL, "updatedAt" = now()`,
      [f.automationCampaignId, f.manualCampaignId, f.accountKey],
    );
    // templateId is free text: the editor falls back to the first template
    // when it doesn't resolve, which is all this ad needs to open.
    await db.query(
      `INSERT INTO "AdCreative" (id, "accountKey", name, "templateId", data, "campaignId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E offer ad', 'e2e-template', '{}', $3, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET "campaignId" = EXCLUDED."campaignId", "archivedAt" = NULL, "updatedAt" = now()`,
      [f.adId, f.accountKey, f.automationCampaignId],
    );
  });
  return f;
}

export async function removeClientCampaigns(): Promise<null> {
  const f = CLIENT_FIXTURES;
  await withDb(async (db) => {
    await db.query(`DELETE FROM "AdCreative" WHERE id = $1`, [f.adId]);
    await db.query(`DELETE FROM "Campaign" WHERE id = ANY($1)`, [[f.automationCampaignId, f.manualCampaignId]]);
  });
  // cy.task must resolve to something other than undefined.
  return null;
}
