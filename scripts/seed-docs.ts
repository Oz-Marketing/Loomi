/**
 * Load `content/docs/**.md` into `DocArticle`.
 *
 * This is a SEED, not a mirror, and the difference is the whole design:
 *
 *   new file            → create
 *   file changed        → update, unless the row has been edited in the app
 *   file unchanged      → no-op (hash match)
 *   row edited in app   → left alone forever after
 *   file deleted        → row left alone (deleting an article is a decision
 *                         someone makes in Loomi, not a side effect of a rebase)
 *
 * The `editedInApp` latch exists because this script runs on every deploy. Without
 * it, a typo somebody fixed in the UI at 4pm would silently revert at the next
 * merge, and they'd fix it again, and conclude the docs page is broken.
 *
 * Run: npx tsx scripts/seed-docs.ts
 * Also runs as part of build / deploy:prepare.
 */
try { require('dotenv/config'); } catch { /* production sets env vars directly */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { loadDocFiles } from '../src/lib/docs/source';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

const pool = new pg.Pool({
  connectionString: connectionString
    .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
    .replace(/\?$/, ''),
  ...(connectionString.includes('sslmode=require') && { ssl: { rejectUnauthorized: false } }),
});

const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const { files, errors } = loadDocFiles();

  for (const { sourceKey, error } of errors) {
    // A malformed article must not fail the build — a deploy that can't ship
    // because of a missing colon in a doc is a worse outcome than a missing
    // article — but it has to be visible on the run page.
    console.warn(`::warning::Docs seed skipped ${sourceKey}: ${error}`);
  }

  if (files.length === 0) {
    console.log('Docs seed: no article files found, nothing to do.');
    return;
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let preserved = 0;

  for (const file of files) {
    const existing = await prisma.docArticle.findUnique({
      where: { sourceKey: file.sourceKey },
      select: { id: true, sourceHash: true, editedInApp: true },
    });

    const fields = {
      slug: file.slug,
      title: file.title,
      summary: file.summary,
      body: file.body,
      sector: file.sector,
      category: file.category,
      audience: file.audience,
      status: file.status,
      order: file.order,
      covers: file.covers,
      sourceHash: file.hash,
    };

    if (!existing) {
      await prisma.docArticle.create({
        data: {
          ...fields,
          sourceKey: file.sourceKey,
          // A freshly seeded article is confirmed against the tree it shipped
          // with, so the drift job starts counting from here rather than
          // flagging every article on its first run.
          reviewedSha: process.env.GITHUB_SHA ?? null,
          reviewedAt: new Date(),
        },
      });
      created++;
      continue;
    }

    if (existing.sourceHash === file.hash) {
      unchanged++;
      continue;
    }

    if (existing.editedInApp) {
      preserved++;
      console.log(
        `Docs seed: ${file.sourceKey} changed on disk but the article was edited in Loomi — left as it is.`,
      );
      continue;
    }

    await prisma.docArticle.update({
      where: { id: existing.id },
      data: {
        ...fields,
        // The file just answered for itself, so any outstanding drift flag is
        // settled. Whoever changed the doc is asserting it is current.
        needsReview: false,
        reviewNote: null,
        reviewedSha: process.env.GITHUB_SHA ?? null,
        reviewedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(
    `Docs seed: ${created} created, ${updated} updated, ${unchanged} unchanged, ` +
      `${preserved} preserved (edited in Loomi), ${errors.length} skipped.`,
  );
}

main()
  .catch((err) => {
    console.error('Docs seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
