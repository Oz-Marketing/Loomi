/**
 * Seed script: walks email-engine/src/templates/oem-html/{oem}/{workflow}/*.html
 * and upserts each as a Template row in the DB so they appear in the UI library.
 *
 * Path convention:
 *   email-engine/src/templates/oem-html/{oem-slug}/{workflow-slug}/{step-filename}.html
 *
 * Derived fields:
 *   slug       = "oem-{oem}-{workflow}-{step}"
 *   title      = "{Oem} — {Workflow Title}: {Step Title}"
 *   type       = "lifecycle"
 *   category   = first segment of workflow slug ("sales", "service", "lease", "loyalty")
 *   content    = raw file contents (pure HTML, no Maizzle frontmatter)
 *   preheader  = best-effort extracted from a hidden preheader div
 *
 * Usage (from repo root):
 *   npx tsx scripts/seed-oem-html-templates.ts
 *   npx tsx scripts/seed-oem-html-templates.ts --clean   # remove all oem-* slugs first
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const candidate = process.env.DATABASE_URL;
if (!candidate) {
  console.error('DATABASE_URL is not set. Make sure you have a .env or .env.local with DATABASE_URL defined.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: candidate });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const clean = process.argv.includes('--clean');

const OEM_HTML_ROOT = path.resolve(process.cwd(), 'src', 'templates', 'oem-html');

const KNOWN_CATEGORIES = new Set(['sales', 'service', 'lease', 'loyalty']);

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function deriveCategory(workflowSlug: string): string {
  const first = workflowSlug.split('-')[0]?.toLowerCase();
  return first && KNOWN_CATEGORIES.has(first) ? first : 'general';
}

function extractTitle(content: string, fallback: string): string {
  const match = content.match(/<title>([^<]+)<\/title>/i);
  return match ? match[1].trim() : fallback;
}

function extractPreheader(content: string): string | undefined {
  const re = /display:\s*none[\s\S]{0,400}?<\/div>/i;
  const block = content.match(re);
  if (!block) return undefined;
  const inner = block[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return inner.length > 0 && inner.length < 300 ? inner : undefined;
}

interface DiscoveredTemplate {
  slug: string;
  title: string;
  type: string;
  category: string;
  content: string;
  preheader?: string;
  filePath: string;
}

function walk(): DiscoveredTemplate[] {
  if (!fs.existsSync(OEM_HTML_ROOT)) {
    console.error(`OEM HTML root not found: ${OEM_HTML_ROOT}`);
    return [];
  }

  const results: DiscoveredTemplate[] = [];
  const oemDirs = fs
    .readdirSync(OEM_HTML_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const oemDir of oemDirs) {
    const oemSlug = oemDir.name;
    const oemPath = path.join(OEM_HTML_ROOT, oemSlug);
    const workflowDirs = fs
      .readdirSync(oemPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const workflowDir of workflowDirs) {
      const workflowSlug = workflowDir.name;
      const workflowPath = path.join(oemPath, workflowSlug);
      const htmlFiles = fs
        .readdirSync(workflowPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.html'));

      for (const htmlFile of htmlFiles) {
        const filePath = path.join(workflowPath, htmlFile.name);
        const stepSlug = htmlFile.name.replace(/\.html$/i, '');
        const slug = `oem-${oemSlug}-${workflowSlug}-${stepSlug}`;

        const content = fs.readFileSync(filePath, 'utf-8');
        const stepTitle = extractTitle(content, titleCase(stepSlug));
        const title = `${titleCase(oemSlug)} — ${titleCase(workflowSlug)}: ${stepTitle}`;
        const category = deriveCategory(workflowSlug);
        const preheader = extractPreheader(content);

        results.push({
          slug,
          title,
          type: 'lifecycle',
          category,
          content,
          preheader,
          filePath,
        });
      }
    }
  }

  return results;
}

async function main() {
  if (clean) {
    const deleted = await prisma.template.deleteMany({
      where: { slug: { startsWith: 'oem-' } },
    });
    console.log(`Cleaned ${deleted.count} existing oem-* template(s).`);
  }

  const discovered = walk();
  if (discovered.length === 0) {
    console.log('No OEM HTML templates found.');
    return;
  }

  let upserted = 0;
  for (const t of discovered) {
    await prisma.template.upsert({
      where: { slug: t.slug },
      update: {
        title: t.title,
        type: t.type,
        category: t.category,
        content: t.content,
        preheader: t.preheader ?? null,
      },
      create: {
        slug: t.slug,
        title: t.title,
        type: t.type,
        category: t.category,
        content: t.content,
        preheader: t.preheader ?? null,
      },
    });
    upserted++;
    console.log(`  + ${t.slug}  (${t.title})`);
  }

  console.log(`\nDone — ${upserted} OEM HTML template(s) upserted.`);
}

main()
  .catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
