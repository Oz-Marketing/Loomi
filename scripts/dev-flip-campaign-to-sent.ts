// Dev-only helper: flip a draft email campaign to "completed" so the
// sent-campaign detail drawer has something to render against. Usage:
//
//   npx tsx scripts/dev-flip-campaign-to-sent.ts            # lists candidates
//   npx tsx scripts/dev-flip-campaign-to-sent.ts <id>       # flips that campaign
//
// Never run against production. The script aborts if DATABASE_URL doesn't
// point at a local loopback host.

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local', override: true });

import { prisma } from '../src/lib/prisma';

async function main() {
  const url = process.env.DATABASE_URL || '';
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(`Refusing to run — DATABASE_URL does not look local: ${url}`);
  }

  const targetId = process.argv[2];

  if (!targetId) {
    const rows = await prisma.emailBlast.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        sentCount: true,
        completedAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });
    console.log('Recent email campaigns:\n');
    for (const r of rows) {
      console.log(
        `  ${r.status.padEnd(11)} ${r.id}  ${r.name || '(unnamed)'}`,
      );
    }
    console.log('\nRun again with an id to flip that campaign to completed.');
    return;
  }

  const campaign = await prisma.emailBlast.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, status: true, totalRecipients: true },
  });
  if (!campaign) {
    throw new Error(`No campaign with id ${targetId}`);
  }

  const totalRecipients = Math.max(campaign.totalRecipients, 50);
  const sentCount = totalRecipients - 2;

  const now = new Date();
  await prisma.emailBlast.update({
    where: { id: campaign.id },
    data: {
      status: 'completed',
      totalRecipients,
      sentCount,
      failedCount: totalRecipients - sentCount,
      startedAt: now,
      completedAt: now,
    },
  });

  console.log(
    `Flipped "${campaign.name || campaign.id}" → completed (sent=${sentCount}/${totalRecipients}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
