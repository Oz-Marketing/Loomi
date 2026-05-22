/**
 * Seed changelog entries and template library data into the database.
 * Uses upsert to avoid duplicates — safe to run multiple times.
 *
 * Run: npx tsx scripts/seed-changelog-entries.ts
 * Also runs as part of the build step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

const pool = new pg.Pool({
  connectionString: connectionString.replace(/[?&]sslmode=require/, (m) =>
    m.startsWith('?') ? '?' : '',
  ).replace(/\?$/, ''),
  ...(connectionString.includes('sslmode=require') && { ssl: { rejectUnauthorized: false } }),
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface Entry {
  id: string;
  title: string;
  content: string;
  type: string;
  createdBy: string;
  publishedAt: Date;
}

const entries: Entry[] = [
  // ── 2026-02-22: Template editor overhaul ──
  {
    id: 'changelog_split_component_20260222',
    title: 'New Split Component',
    content:
      'Added a new 2-column split layout component for email templates. Features text on one side and an image on the other with support for dual buttons, cover/auto image fit modes, gradient backgrounds, and full mobile responsiveness.',
    type: 'feature',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:00:00Z'),
  },
  {
    id: 'changelog_media_picker_20260222',
    title: 'Media Picker Modal',
    content:
      'New media picker modal for browsing, searching, and uploading images directly from the media library. Includes drag-and-drop upload, search filtering, and cursor-based pagination.',
    type: 'feature',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:01:00Z'),
  },
  {
    id: 'changelog_hero_subheadline_20260222',
    title: 'Hero Subheadline Support',
    content:
      'The hero component now supports a subheadline field with dedicated typography controls for font size, weight, color, and mobile overrides.',
    type: 'feature',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:02:00Z'),
  },
  {
    id: 'changelog_section_bg_20260222',
    title: 'Section Background Colors',
    content:
      'Vehicle card, CTA (button), and divider components now support section-level background colors, allowing full-width color bands behind the component content.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:03:00Z'),
  },
  {
    id: 'changelog_svg_icons_20260222',
    title: 'Inline SVG Social Icons',
    content:
      'Footer social icons for Facebook, Instagram, YouTube, and TikTok are now rendered as inline SVGs instead of hosted images. This enables dynamic coloring via the icon color prop with no external image dependencies.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:04:00Z'),
  },
  {
    id: 'changelog_mobile_stats_20260222',
    title: 'Mobile Stat Stacking',
    content:
      'Vehicle card stats (e.g. mileage and price) now stack vertically on mobile screens for improved readability instead of cramming side-by-side.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:05:00Z'),
  },
  {
    id: 'changelog_ai_light_mode_20260222',
    title: 'AI Assistant Light Mode',
    content:
      'The template editor AI assistant panel now fully supports light mode with dedicated theming for backgrounds, text, borders, accents, and interactive states.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:06:00Z'),
  },
  {
    id: 'changelog_preview_cache_20260222',
    title: 'Preview Caching',
    content:
      'Email preview rendering now uses server-side disk caching for significantly faster re-renders. Cache invalidates automatically when the engine version or template content changes.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:07:00Z'),
  },
  {
    id: 'changelog_scoped_css_20260222',
    title: 'Scoped Responsive CSS',
    content:
      'All email components now use scoped CSS classes to prevent mobile style collisions between multiple instances of the same component in a single template.',
    type: 'improvement',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:08:00Z'),
  },
  {
    id: 'changelog_border_fix_20260222',
    title: 'Border Editing Fix',
    content:
      'Fixed a bug where changing border settings on any component would not persist. The root cause was a stale closure that dropped intermediate property updates when multiple border fields changed simultaneously.',
    type: 'fix',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T12:09:00Z'),
  },
  // ── 2026-02-22: Production preview fix ──
  {
    id: 'fix_preview_email_engine_deps_20260222',
    title: 'Fix Template Preview on Production',
    content:
      'Fixed an issue where the email template preview failed on production with a missing @maizzle/framework error. The root cause was that email-engine dependencies were not installed during the production build. The build script now installs email-engine packages before building the Next.js app.',
    type: 'fix',
    createdBy: 'Connor',
    publishedAt: new Date('2026-02-22T18:00:00Z'),
  },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      await prisma.changelogEntry.upsert({
        where: { id: entry.id },
        update: {}, // no-op on existing entries
        create: {
          id: entry.id,
          title: entry.title,
          content: entry.content,
          type: entry.type,
          createdBy: entry.createdBy,
          publishedAt: entry.publishedAt,
        },
      });
      created++;
    } catch (e) {
      skipped++;
      console.warn(`  Skipped "${entry.title}":`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`Changelog seed: ${created} upserted, ${skipped} skipped.`);

  // ── Seed template library ──
  await seedTemplates();
}

async function seedTemplates() {
  const dataDir = path.join(__dirname, 'data');
  let tCreated = 0;
  let tSkipped = 0;

  // Service Reminder ("Test Template")
  try {
    const contentFile = path.join(dataDir, 'test-template-content.html');
    const content = fs.existsSync(contentFile) ? fs.readFileSync(contentFile, 'utf-8') : '';
    if (content) {
      await prisma.template.upsert({
        where: { slug: 'test-template' },
        update: { content },
        create: {
          slug: 'test-template',
          title: 'Service Reminder',
          type: 'design',
          content,
          preheader: '',
        },
      });
      tCreated++;
    }
  } catch (e) {
    tSkipped++;
    console.warn('  Skipped template "Service Reminder":', e instanceof Error ? e.message : e);
  }

  console.log(`Template seed: ${tCreated} upserted, ${tSkipped} skipped.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    // Don't fail the build if seeding fails
    process.exit(0);
  })
  .finally(() => pool.end());
