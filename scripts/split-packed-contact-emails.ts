/**
 * Repair contacts whose `email` column holds several addresses at once
 * ("bluejenkins1@yahoo.com;donald.jenkins@gmail.com").
 *
 * The dealer feeds — powersports especially — pack every address they hold for
 * a person into one field. `normaliseEmail` only trimmed and lowercased, so the
 * whole string was stored as if it were one address. That value is the send
 * target, the (accountKey, email) dedup key AND what a segment CSV export
 * prints, which is where it was noticed.
 *
 * `normaliseEmail` now keeps the first usable address and banks the rest under
 * customFields.additionalEmails. This script applies the same treatment to the
 * rows already written.
 *
 * COLLISIONS ARE REPORTED, NOT MERGED. Where the extracted address is already
 * held by another contact in the same account, the packed row is left exactly
 * as it is — that pair is the duplicate the bug created, and choosing which
 * row's history, list memberships and events survive is not a decision this
 * script should make silently. The list it prints is the input to that call.
 *
 * Dry run (default — prints what it would change, writes nothing):
 *   npx tsx scripts/split-packed-contact-emails.ts
 *
 * Apply:
 *   npx tsx scripts/split-packed-contact-emails.ts --apply
 */

import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  ADDITIONAL_EMAILS_FIELD,
  isAmbiguousEmailCell,
  parseEmailCell,
} from '../src/lib/contacts/normalize';

const candidate = process.env.DATABASE_URL;
if (!candidate) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: candidate });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const apply = process.argv.includes('--apply');

/** Existing customFields Json read back as an object we can spread into. */
function existingCustomFields(value: unknown): Record<string, Prisma.InputJsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.InputJsonValue>)
    : {};
}

async function main() {
  // Only the packed rows. A single junk value like "none" is also wrong, but
  // nulling it changes which contacts have any identity at all — a separate
  // decision, deliberately out of scope here.
  const packed = await prisma.contact.findMany({
    where: {
      OR: [
        { email: { contains: ';' } },
        { email: { contains: ',' } },
        { email: { contains: '|' } },
      ],
    },
    select: { id: true, accountKey: true, email: true, phone: true, customFields: true },
    orderBy: [{ accountKey: 'asc' }, { email: 'asc' }],
  });

  if (packed.length === 0) {
    console.log('Nothing to repair — no contact holds more than one address in `email`.');
    return;
  }

  const fixable: {
    id: string;
    accountKey: string;
    from: string;
    to: string;
    extras: string[];
    customFields: Record<string, Prisma.InputJsonValue>;
  }[] = [];
  const collisions: { id: string; accountKey: string; from: string; to: string; holder: string }[] =
    [];
  const unusable: { id: string; accountKey: string; from: string; phone: string | null }[] = [];
  const ambiguous: {
    id: string;
    accountKey: string;
    from: string;
    would: string;
    junk: string[];
    phone: string | null;
  }[] = [];

  for (const c of packed) {
    const raw = c.email ?? '';
    const cell = parseEmailCell(raw);
    const addresses = cell.addresses;

    if (addresses.length === 0) {
      // Packed, but not one part was an address. Leave it — see the scope note.
      unusable.push({ id: c.id, accountKey: c.accountKey, from: raw, phone: c.phone });
      continue;
    }

    if (isAmbiguousEmailCell(cell)) {
      ambiguous.push({
        id: c.id,
        accountKey: c.accountKey,
        from: raw,
        would: addresses[0],
        junk: cell.dropped,
        phone: c.phone,
      });
      continue;
    }

    const primary = addresses[0];
    if (primary === raw) continue; // already clean

    const holder = await prisma.contact.findFirst({
      where: { accountKey: c.accountKey, email: primary, id: { not: c.id } },
      select: { id: true },
    });

    if (holder) {
      collisions.push({
        id: c.id,
        accountKey: c.accountKey,
        from: raw,
        to: primary,
        holder: holder.id,
      });
      continue;
    }

    fixable.push({
      id: c.id,
      accountKey: c.accountKey,
      from: raw,
      to: primary,
      extras: addresses.slice(1),
      customFields: existingCustomFields(c.customFields),
    });
  }

  console.log(`Contacts holding a packed email: ${packed.length}\n`);

  if (fixable.length > 0) {
    console.log(`Repairable (${fixable.length}):`);
    for (const f of fixable) {
      const kept = f.extras.length > 0 ? ` [+${f.extras.join(', ')} → customFields]` : '';
      console.log(`  ${f.accountKey.padEnd(28)} ${f.from}\n      → ${f.to}${kept}`);
    }
    console.log();
  }

  if (collisions.length > 0) {
    console.log(
      `Collisions — NOT changed (${collisions.length}). The extracted address is already\n` +
        'held by another contact in the same account; these pairs are duplicates the bug\n' +
        'created and need a merge decision (which row keeps the events and lists):',
    );
    for (const c of collisions) {
      console.log(`  ${c.accountKey.padEnd(28)} ${c.from}\n      → ${c.to} already on ${c.holder}`);
    }
    console.log();
  }

  if (ambiguous.length > 0) {
    console.log(
      `Ambiguous — NOT changed (${ambiguous.length}). A delimiter sits next to text that is\n` +
        'not an address, which usually means it landed INSIDE one address rather than\n' +
        'between two. Taking the valid-looking half would invent a different address,\n' +
        'so these need eyes on the source record:',
    );
    for (const a of ambiguous) {
      console.log(
        `  ${a.accountKey.padEnd(28)} ${a.from}\n` +
          `      would become ${a.would}, discarding "${a.junk.join('", "')}"` +
          ` (phone=${a.phone ?? '—'})`,
      );
    }
    console.log();
  }

  if (unusable.length > 0) {
    console.log(
      `Packed but holding no valid address — NOT changed (${unusable.length}). ` +
        'Clearing these would\nleave some contacts with no identity at all:',
    );
    for (const u of unusable) {
      console.log(`  ${u.accountKey.padEnd(28)} ${u.from} (phone=${u.phone ?? '—'})`);
    }
    console.log();
  }

  if (fixable.length === 0) {
    console.log('No row can be repaired without a merge decision. Nothing to apply.');
    return;
  }

  if (!apply) {
    console.log(`Dry run — nothing written. Re-run with --apply to update ${fixable.length} row(s).`);
    return;
  }

  let updated = 0;
  for (const f of fixable) {
    const customFields: Record<string, Prisma.InputJsonValue> = { ...f.customFields };
    // Never overwrite a value that is already there under this key.
    if (f.extras.length > 0 && !(ADDITIONAL_EMAILS_FIELD in customFields)) {
      customFields[ADDITIONAL_EMAILS_FIELD] = f.extras.join('; ');
    }
    try {
      await prisma.contact.update({
        where: { id: f.id },
        data: {
          email: f.to,
          ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        },
      });
      updated += 1;
    } catch (err) {
      // A racing sync could have taken the address between the check and here.
      console.error(
        `  FAILED ${f.accountKey} ${f.from} → ${f.to}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  console.log(`Repaired ${updated} of ${fixable.length} contact(s).`);
  if (collisions.length > 0) {
    console.log(`${collisions.length} collision(s) still need a merge decision (listed above).`);
  }
  if (ambiguous.length > 0) {
    console.log(`${ambiguous.length} ambiguous cell(s) still need a human read (listed above).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
