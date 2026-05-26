/**
 * One-off: reset the dev developer-user password to admin123.
 * The seed's upsert has `update: {}` so re-running the seed doesn't
 * touch an existing row's password. Run this when the local row has
 * drifted away from the seed password.
 *
 *   set -a && source .env.local && set +a && npx tsx scripts/reset-dev-password.ts
 */
import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const url = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

(async () => {
  const password = await bcryptjs.hash('admin123', 12);
  const updated = await prisma.user.update({
    where: { email: 'connor@ozmktg.com' },
    data: { password },
    select: { email: true },
  });
  console.log(`Password reset for ${updated.email} → admin123`);
  await prisma.$disconnect();
  await pool.end();
})();
