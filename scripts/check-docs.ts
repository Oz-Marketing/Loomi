/**
 * Validate the doc library without a database.
 *
 * Catches the three things that are invisible until somebody opens the page:
 * frontmatter that won't parse, an internal `/docs/...` link pointing at a slug
 * that doesn't exist, and an article whose body renders to nothing.
 *
 * Exits non-zero on any of them, so it works as a pre-commit or CI check.
 *
 * Run: npx tsx scripts/check-docs.ts
 */
import { loadDocFiles } from '../src/lib/docs/source';
import { renderMarkdown } from '../src/lib/docs/markdown';

const { files, errors } = loadDocFiles();

let failures = errors.length;
for (const e of errors) console.error(`  ✗ ${e.sourceKey}: ${e.error}`);

const slugs = new Set(files.map((f) => f.slug));

for (const file of files) {
  for (const match of file.body.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)) {
    if (!slugs.has(match[1])) {
      console.error(`  ✗ ${file.sourceKey}: link to /docs/${match[1]}, which does not exist`);
      failures++;
    }
  }
  if (!renderMarkdown(file.body).html.trim()) {
    console.error(`  ✗ ${file.sourceKey}: body renders to nothing`);
    failures++;
  }
}

const bySector = new Map<string, number>();
for (const f of files) bySector.set(f.sector, (bySector.get(f.sector) ?? 0) + 1);

console.log(
  `${files.length} articles: ` +
    [...bySector].map(([s, n]) => `${s} ${n}`).join(', ') +
    ` — ${files.filter((f) => f.status === 'draft').length} draft, ` +
    `${files.filter((f) => f.audience === 'staff').length} staff-only, ` +
    `${files.filter((f) => f.covers.length === 0).length} without \`covers\``,
);

if (failures > 0) {
  console.error(`\n${failures} problem(s).`);
  process.exitCode = 1;
} else {
  console.log('No problems.');
}
