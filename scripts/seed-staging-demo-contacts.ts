/**
 * STAGING-ONLY demo data for exercising the contact page + suppression.
 *
 * Staging's DB is separate from prod and has almost no contacts, so the vehicle
 * garage, EVOX jellybean and history timeline can't be tested there. This seeds
 * a small, realistic set:
 *
 *   - Two contacts on a YAG rooftop with full vehicle data (garage + jellybean)
 *   - One of them owns TWO vehicles, with service/purchase events on each
 *     (multi-vehicle switcher + history timeline)
 *   - A third contact for the suppression cascade test
 *
 * Idempotent: re-running updates rather than duplicating.
 *
 *   npx tsx scripts/seed-staging-demo-contacts.ts
 *   npx tsx scripts/seed-staging-demo-contacts.ts --undo
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';

const UNDO = process.argv.includes('--undo');
const ACCOUNT = process.env.SEED_ACCOUNT_KEY || 'youngChevrolet';
const TAG = 'staging-demo'; // every seeded row carries this, so --undo is exact

const SIERRA = { vehicleYear: '2022', vehicleMake: 'GMC', vehicleModel: 'Sierra 1500', vehicleVin: '3GTU9DED4NG777001' };
const EQUINOX = { vehicleYear: '2019', vehicleMake: 'Chevrolet', vehicleModel: 'Equinox', vehicleVin: '2GNAXUEV6K6777002' };

async function main() {
  // Guard: never run against a database that looks like production.
  const contactCount = await prisma.contact.count();
  if (contactCount > 1000 && !process.env.SEED_FORCE) {
    console.error(
      `Refusing to seed: ${contactCount} contacts present — this looks like production.\n` +
        'Set SEED_FORCE=1 only if you are certain this is staging.',
    );
    process.exit(1);
  }

  const account = await prisma.account.findUnique({ where: { key: ACCOUNT }, select: { key: true } });
  if (!account) {
    console.error(`Account "${ACCOUNT}" not found. Set SEED_ACCOUNT_KEY to a real rooftop.`);
    process.exit(1);
  }

  if (UNDO) {
    const ev = await prisma.contactEvent.deleteMany({ where: { idempotencyKey: { startsWith: `${TAG}:` } } });
    const cs = await prisma.contact.deleteMany({
      where: { accountKey: ACCOUNT, email: { endsWith: '@staging-demo.test' } },
    });
    console.log(`Removed ${cs.count} contact(s), ${ev.count} event(s).`);
    return;
  }

  const people = [
    { email: 'garage.demo@staging-demo.test', firstName: 'Gabriela', lastName: 'Reyes', phone: '+18015550111',
      ...SIERRA, vehicleMileage: '31200', purchaseDate: new Date('2022-06-14'), lastServiceDate: new Date('2026-05-01'),
      customFields: { color: 'Summit White', deal_type: 'Purchase', crm: 'tekion' } },
    { email: 'single.demo@staging-demo.test', firstName: 'Marcus', lastName: 'Webb', phone: '+18015550222',
      ...EQUINOX, vehicleMileage: '58400', purchaseDate: new Date('2019-04-02'), lastServiceDate: new Date('2025-11-18'),
      customFields: { color: 'Nightfall Gray', deal_type: 'Lease', crm: 'cdk' } },
    { email: 'suppression.demo@staging-demo.test', firstName: 'Dana', lastName: 'Whitfield', phone: '+18015550333',
      customFields: { crm: 'cdk' } },
  ];

  const ids: Record<string, string> = {};
  for (const p of people) {
    const { email, ...rest } = p;
    const row = await prisma.contact.upsert({
      where: { accountKey_email: { accountKey: ACCOUNT, email } },
      update: rest,
      create: { accountKey: ACCOUNT, email, dateAdded: new Date(), source: 'staging-demo', tags: ['demo'], ...rest },
      select: { id: true },
    });
    ids[email] = row.id;
    console.log(`✓ contact ${email}`);
  }

  // Gabriela owns both vehicles — drives the garage switcher + timeline.
  const gabriela = ids['garage.demo@staging-demo.test'];
  const events = [
    { k: 'sale:equinox', type: 'sale', date: '2019-04-02', amount: 28400, ...EQUINOX, mileage: '10', ref: 'D-77001' },
    { k: 'svc:equinox:1', type: 'service', date: '2020-07-19', amount: 142, ...EQUINOX, mileage: '14980', ref: 'RO-88001' },
    { k: 'svc:equinox:2', type: 'service', date: '2021-08-23', amount: 486, ...EQUINOX, mileage: '29310', ref: 'RO-88002' },
    { k: 'sale:sierra', type: 'sale', date: '2022-06-14', amount: 61250, ...SIERRA, mileage: '12', ref: 'D-77002' },
    { k: 'svc:sierra:1', type: 'service', date: '2023-09-06', amount: 210, ...SIERRA, mileage: '9870', ref: 'RO-88003' },
    { k: 'svc:sierra:2', type: 'service', date: '2024-10-14', amount: 735, ...SIERRA, mileage: '19240', ref: 'RO-88004' },
    { k: 'svc:sierra:3', type: 'service', date: '2026-05-01', amount: 168, ...SIERRA, mileage: '31200', ref: 'RO-88005' },
  ];

  for (const e of events) {
    const key = `${TAG}:${e.k}`;
    const data = {
      accountKey: ACCOUNT, contactId: gabriela, type: e.type, eventDate: new Date(e.date), amount: e.amount,
      vehicleYear: e.vehicleYear, vehicleMake: e.vehicleMake, vehicleModel: e.vehicleModel,
      vehicleVin: e.vehicleVin, vehicleMileage: e.mileage, sourceCrm: 'tekion', reference: e.ref,
    };
    await prisma.contactEvent.upsert({ where: { idempotencyKey: key }, update: data, create: { idempotencyKey: key, ...data } });
    console.log(`✓ event ${e.k}`);
  }

  console.log(`\nSeeded into "${ACCOUNT}".`);
  console.log('Garage + timeline : garage.demo@staging-demo.test  (2 vehicles, 7 events)');
  console.log('Suppression test  : suppression.demo@staging-demo.test');
  console.log('\nRemove with: npx tsx scripts/seed-staging-demo-contacts.ts --undo');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
