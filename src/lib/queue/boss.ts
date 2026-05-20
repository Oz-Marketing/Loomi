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
    });
    boss.on('error', (err: unknown) => {
      console.error('[pg-boss] error', err);
    });
    await boss.start();
    return boss;
  })();

  return bossPromise;
}

export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  await boss.stop({ graceful: true });
  bossPromise = null;
}
