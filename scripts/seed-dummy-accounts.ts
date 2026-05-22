import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

type CityState = {
  city: string;
  state: string;
  timezone: string;
};

const CITY_STATE_LIBRARY: CityState[] = [
  { city: 'Layton', state: 'UT', timezone: 'US/Mountain' },
  { city: 'Ogden', state: 'UT', timezone: 'US/Mountain' },
  { city: 'Salt Lake City', state: 'UT', timezone: 'US/Mountain' },
  { city: 'Boise', state: 'ID', timezone: 'US/Mountain' },
  { city: 'Phoenix', state: 'AZ', timezone: 'US/Arizona' },
  { city: 'Denver', state: 'CO', timezone: 'US/Mountain' },
  { city: 'Dallas', state: 'TX', timezone: 'US/Central' },
  { city: 'Austin', state: 'TX', timezone: 'US/Central' },
  { city: 'Houston', state: 'TX', timezone: 'US/Central' },
  { city: 'Oklahoma City', state: 'OK', timezone: 'US/Central' },
  { city: 'Kansas City', state: 'MO', timezone: 'US/Central' },
  { city: 'Chicago', state: 'IL', timezone: 'US/Central' },
  { city: 'Nashville', state: 'TN', timezone: 'US/Central' },
  { city: 'Atlanta', state: 'GA', timezone: 'US/Eastern' },
  { city: 'Orlando', state: 'FL', timezone: 'US/Eastern' },
  { city: 'Charlotte', state: 'NC', timezone: 'US/Eastern' },
  { city: 'Pittsburgh', state: 'PA', timezone: 'US/Eastern' },
  { city: 'New York', state: 'NY', timezone: 'US/Eastern' },
  { city: 'Seattle', state: 'WA', timezone: 'US/Pacific' },
  { city: 'Portland', state: 'OR', timezone: 'US/Pacific' },
  { city: 'San Diego', state: 'CA', timezone: 'US/Pacific' },
  { city: 'Los Angeles', state: 'CA', timezone: 'US/Pacific' },
  { city: 'Sacramento', state: 'CA', timezone: 'US/Pacific' },
  { city: 'San Jose', state: 'CA', timezone: 'US/Pacific' },
  { city: 'Las Vegas', state: 'NV', timezone: 'US/Pacific' },
  { city: 'Albuquerque', state: 'NM', timezone: 'US/Mountain' },
  { city: 'Minneapolis', state: 'MN', timezone: 'US/Central' },
  { city: 'St. Louis', state: 'MO', timezone: 'US/Central' },
  { city: 'Detroit', state: 'MI', timezone: 'US/Eastern' },
  { city: 'Columbus', state: 'OH', timezone: 'US/Eastern' },
  { city: 'Richmond', state: 'VA', timezone: 'US/Eastern' },
  { city: 'Birmingham', state: 'AL', timezone: 'US/Central' },
  { city: 'New Orleans', state: 'LA', timezone: 'US/Central' },
  { city: 'Tulsa', state: 'OK', timezone: 'US/Central' },
  { city: 'Anchorage', state: 'AK', timezone: 'US/Alaska' },
  { city: 'Honolulu', state: 'HI', timezone: 'Pacific/Honolulu' },
];

const CATEGORY_LIBRARY = [
  'Automotive',
  'Powersports',
  'Ecommerce',
  'Healthcare',
  'Real Estate',
  'Hospitality',
  'Retail',
  'General',
] as const;

function parseCountFromArgv(defaultCount: number): number {
  const args = process.argv.slice(2);

  const explicitCountFlagIndex = args.findIndex((arg) => arg === '--count' || arg === '-c');
  if (explicitCountFlagIndex >= 0) {
    const raw = args[explicitCountFlagIndex + 1];
    const parsed = Number.parseInt(raw || '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  if (args.length > 0) {
    const parsed = Number.parseInt(args[0], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return defaultCount;
}

function buildAccountKey(index: number): string {
  return `demoAccount${String(index).padStart(3, '0')}`;
}

async function main() {
  const count = parseCountFromArgv(30);
  const candidate =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

  if (!/^postgres(ql)?:\/\//.test(candidate)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL (postgresql://...)');
  }

  const needsSsl = /[?&]sslmode=require/.test(candidate);
  const cleanUrl = candidate
    .replace(/[?&]sslmode=require/, (match) => (match.startsWith('?') ? '?' : ''))
    .replace(/\?$/, '');

  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const desiredKeys = Array.from({ length: count }, (_, index) => buildAccountKey(index + 1));
    const existingRows = await prisma.account.findMany({
      where: { key: { in: desiredKeys } },
      select: { key: true },
    });
    const existingKeys = new Set(existingRows.map((row) => row.key));

    const toCreate = desiredKeys
      .filter((key) => !existingKeys.has(key))
      .map((key, index) => {
        const sequence = Number.parseInt(key.replace('demoAccount', ''), 10);
        const location = CITY_STATE_LIBRARY[index % CITY_STATE_LIBRARY.length];
        const category = CATEGORY_LIBRARY[index % CATEGORY_LIBRARY.length];
        const dealer = `Demo Account ${String(sequence).padStart(3, '0')}`;
        const websiteSlug = key.toLowerCase();

        const slug = dealer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return {
          key,
          slug,
          dealer,
          category,
          email: `hello+${websiteSlug}@example.com`,
          phone: `(555) 01${String((sequence % 1000)).padStart(2, '0')}-${String((sequence * 7) % 10000).padStart(4, '0')}`,
          city: location.city,
          state: location.state,
          postalCode: String(10000 + ((sequence * 37) % 89999)),
          website: `https://${websiteSlug}.example.com`,
          timezone: location.timezone,
        };
      });

    if (toCreate.length > 0) {
      await prisma.account.createMany({ data: toCreate });
    }

    const totalAfter = await prisma.account.count();
    console.log(`Dummy account seed complete.`);
    console.log(`Requested: ${count}`);
    console.log(`Created:   ${toCreate.length}`);
    console.log(`Skipped:   ${existingKeys.size}`);
    console.log(`Total accounts in DB: ${totalAfter}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
