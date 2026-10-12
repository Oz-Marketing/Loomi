/**
 * An in-memory stand-in for the tables opt-outs touch — EmailSuppression,
 * SmsSuppression, Contact, Account — for tests that mock `@/lib/prisma`.
 *
 * It answers the subset of Prisma's API those paths use (createMany with
 * skipDuplicates, updateMany, deleteMany, findMany, count, the compound
 * unique lookups) and interprets their `where` clauses — equality, `in`, `OR`,
 * `contains` — so a test asserts on the rows that end up stored rather than
 * on the shape of the calls that put them there. Unsupported filters throw,
 * so a query this can't model fails loudly instead of matching everything.
 */

import { Prisma } from '@prisma/client';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const filter = cond as Record<string, unknown>;
      if ('in' in filter) {
        if (!(filter.in as unknown[]).includes(value)) return false;
      } else if ('contains' in filter) {
        if (typeof value !== 'string' || !value.includes(String(filter.contains))) return false;
      } else if ('equals' in filter) {
        if (value !== filter.equals) return false;
      } else {
        throw new Error(`suppression-db: unsupported filter on ${key}: ${JSON.stringify(cond)}`);
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function project(row: Row, select: Record<string, boolean> | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, on] of Object.entries(select)) if (on) out[key] = row[key];
  return out;
}

let nextId = 1;

export class FakeSuppressionTable {
  rows: Row[] = [];
  /** Every statement, in order, for asserting how much work a call did. */
  ops: { op: string; size?: number }[] = [];

  constructor(private readonly addressField: 'email' | 'phone') {}

  /** Seed a row as if an earlier writer had stored it. */
  seed(row: { accountKey: string; reason: string; source: string; raw?: string | null } & Row): Row {
    const stored: Row = {
      id: `sup_${nextId++}`,
      raw: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...row,
    };
    this.rows.push(stored);
    return stored;
  }

  /** The rows for an address, keyed by account, for compact assertions. */
  byAccount(address: string): Record<string, { reason: string; source: string }> {
    const out: Record<string, { reason: string; source: string }> = {};
    for (const row of this.rows) {
      if (row[this.addressField] !== address) continue;
      out[String(row.accountKey)] = { reason: String(row.reason), source: String(row.source) };
    }
    return out;
  }

  private exists(accountKey: unknown, address: unknown): boolean {
    return this.rows.some((r) => r.accountKey === accountKey && r[this.addressField] === address);
  }

  createMany = async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
    this.ops.push({ op: 'createMany', size: data.length });
    let count = 0;
    for (const entry of data) {
      if (this.exists(entry.accountKey, entry[this.addressField])) {
        if (!skipDuplicates) throw new Error('Unique constraint failed');
        continue;
      }
      this.seed(entry as { accountKey: string; reason: string; source: string } & Row);
      count += 1;
    }
    return { count };
  };

  updateMany = async ({ where, data }: { where: Where; data: Row }) => {
    this.ops.push({ op: 'updateMany' });
    let count = 0;
    for (const row of this.rows) {
      if (!matches(row, where)) continue;
      Object.assign(row, data, { updatedAt: new Date() });
      count += 1;
    }
    return { count };
  };

  deleteMany = async ({ where }: { where: Where }) => {
    this.ops.push({ op: 'deleteMany' });
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, where));
    return { count: before - this.rows.length };
  };

  findMany = async ({ where, select }: { where?: Where; select?: Record<string, boolean> } = {}) => {
    this.ops.push({ op: 'findMany' });
    return this.rows.filter((row) => matches(row, where)).map((row) => project(row, select));
  };

  count = async ({ where }: { where?: Where } = {}) => {
    this.ops.push({ op: 'count' });
    return this.rows.filter((row) => matches(row, where)).length;
  };

  groupBy = async ({ by, where }: { by: string[]; where?: Where }) => {
    const groups = new Map<string, { key: Row; count: number }>();
    for (const row of this.rows.filter((r) => matches(r, where))) {
      const key: Row = {};
      for (const field of by) key[field] = row[field];
      const id = JSON.stringify(key);
      const group = groups.get(id) ?? { key, count: 0 };
      group.count += 1;
      groups.set(id, group);
    }
    return [...groups.values()].map((g) => ({ ...g.key, _count: { _all: g.count } }));
  };

  findUnique = async ({ where }: { where: Record<string, Row> }) => {
    const key = Object.values(where)[0];
    const row = this.rows.find(
      (r) => r.accountKey === key.accountKey && r[this.addressField] === key[this.addressField],
    );
    return row ? { ...row } : null;
  };
}

export class FakeContactTable {
  rows: Row[] = [];

  seed(row: { id: string; accountKey: string } & Row): Row {
    const stored: Row = { email: null, phone: null, dnd: null, tags: [], customFields: null, ...row };
    this.rows.push(stored);
    return stored;
  }

  get(id: string): Row | undefined {
    return this.rows.find((r) => r.id === id);
  }

  findFirst = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
    const row = this.rows.find((r) => matches(r, where));
    return row ? project(row, select) : null;
  };

  findMany = async ({ where, select }: { where?: Where; select?: Record<string, boolean> } = {}) =>
    this.rows.filter((r) => matches(r, where)).map((r) => project(r, select));

  findUnique = async ({ where, select }: { where: Record<string, Row>; select?: Record<string, boolean> }) => {
    const [field, key] = Object.entries(where)[0];
    const row =
      field === 'id'
        ? this.rows.find((r) => r.id === key)
        : this.rows.find((r) =>
            Object.entries(key).every(([k, v]) => r[k] === v),
          );
    return row ? project(row, select) : null;
  };

  findUniqueOrThrow = async (args: { where: Record<string, Row>; select?: Record<string, boolean> }) => {
    const row = await this.findUnique(args);
    if (!row) throw new Error('Contact not found');
    return row;
  };

  update = async ({ where, data, select }: { where: { id: string }; data: Row; select?: Record<string, boolean> }) => {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error('Contact not found');
    for (const [key, value] of Object.entries(data)) {
      // Prisma.DbNull is a marker object; the column reads back as null.
      row[key] = value === Prisma.DbNull ? null : value;
    }
    return project(row, select);
  };

  create = async ({ data, select }: { data: Row; select?: Record<string, boolean> }) => {
    // `account: { connect: { key } }` is how the contacts API names the account.
    const { account, ...rest } = data as Row & { account?: { connect?: { key?: string } } };
    const accountKey = (rest.accountKey as string | undefined) ?? account?.connect?.key ?? '';
    const taken = this.rows.some(
      (r) =>
        r.accountKey === accountKey &&
        ((rest.email && r.email === rest.email) || (rest.phone && r.phone === rest.phone)),
    );
    if (taken) throw new Error('Unique constraint failed on the fields: (`accountKey`,`email`)');
    const row = this.seed({ id: `contact_${nextId++}`, ...rest, accountKey });
    for (const [key, value] of Object.entries(row)) if (value === Prisma.DbNull) row[key] = null;
    return project(row, select);
  };
}

/** The account hierarchy as `getRelatedAccountKeys` would see it. */
export interface FakeDb {
  emailSuppression: FakeSuppressionTable;
  smsSuppression: FakeSuppressionTable;
  contact: FakeContactTable;
  accounts: Set<string>;
}

export function createFakeDb(): FakeDb {
  return {
    emailSuppression: new FakeSuppressionTable('email'),
    smsSuppression: new FakeSuppressionTable('phone'),
    contact: new FakeContactTable(),
    accounts: new Set(),
  };
}

/**
 * The client object a test hands to `vi.mock('@/lib/prisma')`. `$transaction`
 * runs the callback against the same tables — enough for these paths, which
 * only need the callback to see its own writes.
 */
export function prismaFor(db: FakeDb) {
  const client = {
    emailSuppression: db.emailSuppression,
    smsSuppression: db.smsSuppression,
    contact: db.contact,
    account: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        db.accounts.has(where.key) ? { key: where.key } : null,
    },
    contactCustomField: { findMany: async () => [] },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
  };
  return client;
}
