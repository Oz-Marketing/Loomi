/**
 * Configure autonomous ad generation for one sub-account.
 *
 *   npx tsx scripts/setup-young-chev-automation.ts [accountKey] [--enable] [--publish-template]
 *
 * Defaults to `youngChev`. Idempotent — safe to re-run; it upserts rather than
 * duplicating, and never clears a value someone has since tuned in the UI beyond
 * the ones it owns.
 *
 * WHAT IT SETS UP
 *   • the dealer's VLA inventory feed (Young publishes CSV in the Google/Meta
 *     Vehicle Listing Ads schema despite the `/feed/vla/` URL suggesting XML)
 *   • an AdAutomationConfig pointed at the Momentum template
 *
 * Left OFF by default. Enabling starts the daily chain for this rooftop, which
 * begins writing drafts — that should be a deliberate act, not a side effect of
 * running a setup script. Pass `--enable` when you mean it.
 *
 * The template must be PUBLISHED for automation to resolve it (the query filters
 * on status), so `--publish-template` flips it in the same pass.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const FEED_URL = 'https://ozreports.com/feed/vla/MP8376_VLA_Primary';
const FEED_NAME = 'Young Chev VLA';
const TEMPLATE_ID = 'momentum-offer-v1';

async function main() {
  const args = process.argv.slice(2);
  const accountKey = args.find((a) => !a.startsWith('--')) ?? 'youngChev';
  const enable = args.includes('--enable');
  const publishTemplate = args.includes('--publish-template');

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true, oem: true, category: true },
  });
  if (!account) {
    // Fail loudly with the available keys — guessing at a key would silently
    // configure automation for the wrong rooftop.
    const keys = await prisma.account.findMany({ select: { key: true, dealer: true }, take: 40 });
    console.error(`No sub-account with key "${accountKey}". Available:`);
    for (const k of keys) console.error(`  ${k.key.padEnd(24)} ${k.dealer}`);
    process.exit(1);
  }
  console.log(`account: ${account.key} — ${account.dealer} (${account.oem ?? 'no OEM'} / ${account.category ?? 'no industry'})`);

  const template = await prisma.adTemplateDoc.findUnique({
    where: { id: TEMPLATE_ID },
    select: { id: true, name: true, status: true },
  });
  if (!template) {
    console.error(`Template ${TEMPLATE_ID} is missing — run scripts/seed-momentum-template.ts first.`);
    process.exit(1);
  }
  if (publishTemplate && template.status !== 'published') {
    await prisma.adTemplateDoc.update({ where: { id: TEMPLATE_ID }, data: { status: 'published' } });
    console.log(`template: ${TEMPLATE_ID} → published`);
  } else {
    console.log(`template: ${TEMPLATE_ID} (${template.status})`);
    if (template.status !== 'published') {
      console.log('   ⚠ automation only resolves PUBLISHED templates — pass --publish-template');
    }
  }

  const existingFeed = await prisma.inventoryFeed.findFirst({ where: { accountKey, url: FEED_URL } });
  const feed = existingFeed
    ? await prisma.inventoryFeed.update({
        where: { id: existingFeed.id },
        data: { name: FEED_NAME, format: 'vla_csv', isActive: true },
      })
    : await prisma.inventoryFeed.create({
        data: { accountKey, url: FEED_URL, name: FEED_NAME, format: 'vla_csv', isActive: true },
      });
  console.log(`feed: ${feed.name} (${feed.format}) — ${existingFeed ? 'updated' : 'created'}`);

  const existing = await prisma.adAutomationConfig.findFirst({ where: { accountKey } });
  const settings = {
    // Empty `makes` means "whatever the inventory feed contains", which is right
    // for a single-franchise rooftop and survives them adding a model line.
    makes: '[]',
    focusModels: '[]',
    excludeModels: '[]',
    zip: '84401',
    radius: 75,
    offerTypePriority: JSON.stringify(['lease', 'apr', 'cash']),
    maxAdsPerRun: 10,
    // Judge offers against the month the ad will RUN, not today — the fix for the
    // month-boundary case where every current offer has expired and next month's
    // haven't published, which yields zero ads from an otherwise healthy setup.
    runWindowMode: 'next_month',
    rollingDays: 30,
    minStock: 1,
    templateMap: JSON.stringify({ all: TEMPLATE_ID }),
    // Drafts only. `ready` additionally needs a VERIFIED co-op pack, and none are
    // verified, so this is the honest setting rather than an aspirational one.
    mode: 'draft',
  };

  const config = existing
    ? await prisma.adAutomationConfig.update({
        where: { id: existing.id },
        data: { ...settings, ...(enable ? { enabled: true } : {}) },
      })
    : await prisma.adAutomationConfig.create({ data: { accountKey, ...settings, enabled: enable } });

  console.log(`config: ${existing ? 'updated' : 'created'} — enabled=${config.enabled} mode=${config.mode}`);
  if (!config.enabled) {
    console.log('\nNot enabled. Re-run with --enable, or flip it on the automation page,');
    console.log('when you want the 06:30 UTC job to start producing drafts.');
  } else {
    console.log('\nENABLED. The daily chain will sync inventory (05:30), poll offers (06:00)');
    console.log('and generate drafts (06:30 UTC). Everything lands as a draft for review.');
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('setup failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
