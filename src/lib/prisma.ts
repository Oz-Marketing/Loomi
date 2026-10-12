import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Connections this process may hold for Prisma. Every process's pools share
 * one server-wide cap on the managed database, and running out surfaces in
 * the app as "remaining connection slots are reserved for roles with the
 * SUPERUSER attribute" on whatever query is unlucky. pg's default is 10 per
 * pool and nothing used to set it, so web + worker, each also running a
 * pg-boss pool, could ask for ~40 — ~60 during a blue/green deploy, when two
 * web slots overlap and the deploy-prep scripts connect too.
 *
 * Budget: web 8 + 2 (pg-boss), worker 8 + 4 (set in ecosystem.config.js)
 * = 22 steady, ~32 while a deploy overlaps two web slots. Requests beyond
 * the pool queue for a free connection instead of failing. Raise this only
 * alongside the database's own limit.
 */
function dbPoolMax(): number {
  return Number(process.env.PG_POOL_MAX) || 8;
}

function createPool(connectionString: string) {
  const needsSsl = /[?&]sslmode=require/.test(connectionString);
  // Strip sslmode from URL so pg doesn't override our ssl config with verify-full
  const cleanUrl = connectionString.replace(/[?&]sslmode=require/, (m) =>
    m.startsWith('?') ? '?' : '',
  ).replace(/\?$/, '');
  // Optional bounds, set per process through the environment (the worker sets
  // them in ecosystem.config.js; the web app doesn't). Without them a
  // half-open connection after a managed-database failover leaves a query
  // waiting forever — in the worker, that one hung call stalls the whole send
  // sweep behind its overlap guard, silently, while pm2 reports it healthy.
  const statementTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 0;
  const connectTimeout = Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 0;
  return new pg.Pool({
    connectionString: cleanUrl,
    max: dbPoolMax(),
    keepAlive: true,
    ...(connectTimeout > 0 && { connectionTimeoutMillis: connectTimeout }),
    ...(statementTimeout > 0 && {
      statement_timeout: statementTimeout,
      // Client-side backstop for when the server never answers at all.
      query_timeout: statementTimeout + 10_000,
    }),
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });
}

function createPrismaClient() {
  const candidate =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';
  if (!/^postgres(ql)?:\/\//.test(candidate)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL (postgresql://...)');
  }
  const pool = createPool(candidate);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
