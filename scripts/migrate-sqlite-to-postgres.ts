import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

type Row = Record<string, unknown>;

const TABLE_ORDER = [
  'User',
  'Account',
  'Template',
  'TemplateTag',
  'EmailFolder',
  'CampaignEmailStats',
  'EspConnection',
  'EspOAuthConnection',
  'TemplateVersion',
  'TemplateTagAssignment',
  'AccountEmail',
  'Audience',
  'LoomiFlow',
  'SmsBlast',
  'SmsBlastRecipient',
  'EmailBlast',
  'EmailBlastRecipient',
  'UserInvite',
] as const;

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
const prismaAny = prisma as unknown as Record<
  string,
  {
    createMany: (args: { data: Row[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    deleteMany: () => Promise<{ count: number }>;
  }
>;

const sourcePathArg = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1];
const sourcePath = path.resolve(process.cwd(), sourcePathArg || process.env.SQLITE_SOURCE_PATH || 'prisma/dev.db');
const chunkSize = Number.parseInt(process.env.MIGRATION_CHUNK_SIZE || '250', 10);
const truncateTarget = (process.env.TRUNCATE_TARGET || '').trim().toLowerCase() === 'true';

function toDelegate(modelName: string): string {
  return `${modelName.slice(0, 1).toLowerCase()}${modelName.slice(1)}`;
}

function normalizeRow(row: Row): Row {
  const next: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      next[key] = null;
      continue;
    }

    if (key.endsWith('At') && typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        next[key] = parsed;
        continue;
      }
    }

    next[key] = value;
  }
  return next;
}

function readRowsFromSqlite(tableName: string): Row[] {
  try {
    const stdout = execFileSync(
      'sqlite3',
      ['-json', sourcePath, `SELECT * FROM "${tableName}";`],
      { encoding: 'utf8' },
    ).trim();
    if (!stdout) return [];
    return JSON.parse(stdout) as Row[];
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (e.code === 'ENOENT') {
      throw new Error('sqlite3 CLI is not installed. Install it before running this migration script.');
    }

    const stderr = String(e.stderr || '');
    if (stderr.includes('no such table')) return [];
    throw error;
  }
}

async function truncateTables() {
  console.log('Truncating target Postgres tables...');
  for (const tableName of [...TABLE_ORDER].reverse()) {
    const delegate = prismaAny[toDelegate(tableName)];
    if (!delegate) continue;
    await delegate.deleteMany();
  }
}

async function migrateTable(tableName: string) {
  const delegateName = toDelegate(tableName);
  const delegate = prismaAny[delegateName];
  if (!delegate) {
    throw new Error(`No Prisma delegate found for model ${tableName}`);
  }

  const sourceRows = readRowsFromSqlite(tableName);
  if (sourceRows.length === 0) {
    console.log(`- ${tableName}: 0 rows`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < sourceRows.length; i += chunkSize) {
    const chunk = sourceRows.slice(i, i + chunkSize).map(normalizeRow);
    const result = await delegate.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  console.log(`- ${tableName}: inserted ${inserted} / ${sourceRows.length}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required and must point to your Postgres database.');
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source file not found: ${sourcePath}`);
  }

  console.log(`Source SQLite: ${sourcePath}`);
  console.log(`Target Postgres: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':****@')}`);
  console.log(`Chunk size: ${chunkSize}`);
  if (truncateTarget) {
    console.log('TRUNCATE_TARGET=true -> target tables will be cleared before import.');
  }

  if (truncateTarget) {
    await truncateTables();
  }

  for (const tableName of TABLE_ORDER) {
    await migrateTable(tableName);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
