import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const candidate =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';
if (!/^postgres(ql)?:\/\//.test(candidate)) {
  throw new Error('DATABASE_URL must be a PostgreSQL URL (postgresql://...)');
}
const needsSsl = /[?&]sslmode=require/.test(candidate);
const cleanUrl = candidate.replace(/[?&]sslmode=require/, (m) =>
  m.startsWith('?') ? '?' : '',
).replace(/\?$/, '');
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashedPassword = await bcryptjs.hash('admin123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'connor@ozmktg.com' },
    update: {},
    create: {
      name: 'Connor Kelly',
      email: 'connor@ozmktg.com',
      password: hashedPassword,
      role: 'developer',
      accountKeys: '[]',
    },
    select: {
      email: true,
    },
  });

  console.log('Seeded developer user:', user.email);

  // ── Seed test accounts ──
  const accounts = [
    {
      key: 'youngHondaOgden',
      slug: 'young-honda-ogden',
      dealer: 'Young Honda Ogden',
      category: 'Automotive',
      oem: 'Honda',
      oems: JSON.stringify(['Honda']),
      email: 'info@younghondaogden.com',
      phone: '(801) 555-1001',
      city: 'Ogden',
      state: 'UT',
      postalCode: '84401',
      website: 'https://younghondaogden.com',
      timezone: 'US/Mountain',
    },
    {
      key: 'ridersEdgePowersports',
      slug: 'riders-edge-powersports',
      dealer: "Rider's Edge Powersports",
      category: 'Powersports',
      oem: 'Kawasaki',
      oems: JSON.stringify(['Kawasaki', 'Yamaha', 'Can-Am']),
      email: 'sales@ridersedgeps.com',
      phone: '(385) 555-2020',
      city: 'Draper',
      state: 'UT',
      postalCode: '84020',
      website: 'https://ridersedgepowersports.com',
      timezone: 'US/Mountain',
    },
    {
      key: 'peakOutdoorGear',
      slug: 'peak-outdoor-gear',
      dealer: 'Peak Outdoor Gear',
      category: 'Ecommerce',
      email: 'support@peakoutdoorgear.com',
      phone: '(801) 555-3030',
      website: 'https://peakoutdoorgear.com',
      timezone: 'US/Mountain',
    },
  ];

  for (const account of accounts) {
    const result = await prisma.account.upsert({
      where: { key: account.key },
      update: {},
      create: account,
      select: {
        dealer: true,
        category: true,
      },
    });
    console.log(`Seeded account: ${result.dealer} (${result.category})`);
  }

  // ── Seed client test users ──
  const clientPassword = await bcryptjs.hash('client123', 12);
  const clientUsers = [
    {
      name: 'Alex Rivera',
      title: 'Service Manager',
      email: 'alex.client@ozmktg.com',
      accountKeys: [accounts[0].key],
    },
    {
      name: 'Jamie Brooks',
      title: 'Marketing Coordinator',
      email: 'jamie.client@ozmktg.com',
      accountKeys: [accounts[1].key],
    },
  ];

  for (const clientUser of clientUsers) {
    const result = await prisma.user.upsert({
      where: { email: clientUser.email },
      update: {
        name: clientUser.name,
        title: clientUser.title,
        password: clientPassword,
        role: 'client',
        accountKeys: JSON.stringify(clientUser.accountKeys),
      },
      create: {
        name: clientUser.name,
        title: clientUser.title,
        email: clientUser.email,
        password: clientPassword,
        role: 'client',
        accountKeys: JSON.stringify(clientUser.accountKeys),
      },
      select: {
        email: true,
      },
    });
    console.log(`Seeded client user: ${result.email} -> ${clientUser.accountKeys.join(', ')}`);
  }

  console.log('Client seed password: client123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
