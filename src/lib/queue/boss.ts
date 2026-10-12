import { PgBoss } from 'pg-boss';

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to start the job queue');
  }

  bossPromise = (async () => {
    const boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      monitorIntervalSeconds: 30,
      // pg-boss keeps its own pool, separate from Prisma's, and defaults it
      // to 10. The web app only enqueues, so 2 is plenty; the worker, which
      // polls and completes jobs, raises it in ecosystem.config.js. See
      // dbPoolMax() in src/lib/prisma.ts for the whole connection budget.
      max: Number(process.env.PGBOSS_POOL_MAX) || 2,
    });
    boss.on('error', (err: unknown) => {
      console.error('[pg-boss] error', err);
    });
    await boss.start();
    return boss;
  })();

  // If startup fails (e.g. a transient DB outage on first use), don't cache
  // the rejected promise — clear it so the next getBoss() retries instead of
  // returning the same permanent rejection for the life of the process.
  // (The current caller still receives this rejection.)
  bossPromise.catch(() => {
    bossPromise = null;
  });

  return bossPromise;
}

export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  await boss.stop({ graceful: true });
  bossPromise = null;
}
