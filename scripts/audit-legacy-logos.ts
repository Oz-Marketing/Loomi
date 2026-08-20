/**
 * Audit brand-asset references that still point at the RELEASE FILESYSTEM.
 *
 * Logos, storefront photos, custom fonts and user avatars used to be written to
 * `data/logos/<key>/<file>` (and `data/avatars/<file>`) on the box, with a
 * root-relative `/logos/...` URL recorded on the row. Uploads go to S3 now, but
 * the old URLs are still in the database — and `data/` lives INSIDE the release
 * directory, which the blue/green deploy replaces wholesale every time. So every
 * one of those files was destroyed by the first deploy after it was uploaded.
 *
 * The two exceptions are `public/logos/` and `public/avatars/`, which are part of
 * the repo and therefore part of the build. Anything there still resolves. The
 * serving route (`src/app/api/logos/[...path]/route.ts`) tries `data/` first and
 * falls back to `public/`, and this script checks the same two places in the same
 * order so its verdict matches what a browser actually gets.
 *
 * READ-ONLY. It writes nothing and deletes nothing — the point is to size the
 * damage before deciding between re-upload and clearing the dead references.
 *
 * Run it ON the droplet, against the running release, or the filesystem half of
 * the answer is meaningless:
 *
 *   ssh loomi-prod
 *   cd /var/www/loomi-studio/current
 *   DATABASE_URL="$(tr ' ' '\n' < /proc/$(pgrep -f 'next-server' | head -1)/environ \
 *     | grep '^DATABASE_URL=' | cut -d= -f2-)" \
 *     npx tsx scripts/audit-legacy-logos.ts
 *
 * Flags:
 *   --json          machine-readable output instead of the report
 *   --check-remote  HEAD each https:// reference too, to catch S3 objects that
 *                   were deleted out from under a perfectly valid-looking URL
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';

const asJson = process.argv.includes('--json');
const checkRemote = process.argv.includes('--check-remote');

// Where the serving routes look, in their order. `process.cwd()` is the release
// root when this runs from `/var/www/loomi-studio/current`.
const ROOTS = [
  { label: 'data', dir: path.join(process.cwd(), 'data') },
  { label: 'public', dir: path.join(process.cwd(), 'public') },
];

type Verdict =
  | 's3' // absolute URL — survives deploys
  | 'legacy-present' // release-relative, file still on disk (i.e. in public/)
  | 'legacy-missing' // release-relative, file GONE — this is the data loss
  | 'remote-missing' // absolute URL that 404s (only with --check-remote)
  | 'unrecognized'; // shape we don't know how to resolve

interface Finding {
  owner: string; // account key or user id
  ownerLabel: string; // dealer name or email
  kind: 'logo' | 'storefront' | 'font' | 'avatar';
  variant: string;
  url: string;
  verdict: Verdict;
  resolvedFrom?: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Resolve one reference the way the serving route would.
 *
 * `/logos/x/y.png` and `/avatars/y.png` are rewritten to `/api/logos/...` and
 * `/api/avatars/...` by next.config.js, and those routes read from disk. Any
 * other root-relative path is served straight out of `public/` by Next.
 */
function classify(url: string): { verdict: Verdict; resolvedFrom?: string } {
  if (/^https?:\/\//i.test(url)) return { verdict: 's3' };
  if (url.startsWith('data:')) return { verdict: 's3' }; // inlined, nothing to lose
  if (!url.startsWith('/')) return { verdict: 'unrecognized' };

  const rel = url.split('?')[0].replace(/^\/+/, '');
  // Guard against a stored path escaping the release root.
  if (rel.split('/').includes('..')) return { verdict: 'unrecognized' };

  for (const root of ROOTS) {
    const candidate = path.join(root.dir, rel);
    if (fs.existsSync(candidate)) {
      return { verdict: 'legacy-present', resolvedFrom: `${root.label}/${rel}` };
    }
  }
  return { verdict: 'legacy-missing' };
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const findings: Finding[] = [];

  const accounts = await prisma.account.findMany({
    select: { key: true, dealer: true, logos: true, customValues: true, customFonts: true },
    orderBy: { dealer: 'asc' },
  });

  for (const account of accounts) {
    const owner = account.key;
    const ownerLabel = account.dealer || account.key;

    const logos = parseJson<Record<string, string>>(account.logos, {});
    for (const [variant, url] of Object.entries(logos)) {
      if (typeof url !== 'string' || !url.trim()) continue;
      findings.push({ owner, ownerLabel, kind: 'logo', variant, url, ...classify(url) });
    }

    // The storefront photo lives in customValues rather than `logos` — a quirk
    // of how it was added, but it uploaded to the same doomed directory.
    const customValues = parseJson<Record<string, { value?: string }>>(
      account.customValues,
      {},
    );
    const storefront = customValues.storefront_image?.value;
    if (typeof storefront === 'string' && storefront.trim()) {
      findings.push({
        owner, ownerLabel, kind: 'storefront', variant: 'storefront_image',
        url: storefront, ...classify(storefront),
      });
    }

    const fonts = parseJson<{ family?: string; url?: string }[]>(account.customFonts, []);
    for (const font of Array.isArray(fonts) ? fonts : []) {
      if (!font?.url?.trim()) continue;
      findings.push({
        owner, ownerLabel, kind: 'font', variant: font.family || '(unnamed)',
        url: font.url, ...classify(font.url),
      });
    }
  }

  // User avatars have the identical history: data/avatars/ inside the release.
  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, email: true, avatarUrl: true },
  });
  for (const user of users) {
    const url = user.avatarUrl!;
    if (!url.trim()) continue;
    findings.push({
      owner: user.id, ownerLabel: user.email || user.id, kind: 'avatar',
      variant: 'avatarUrl', url, ...classify(url),
    });
  }

  if (checkRemote) {
    const remote = findings.filter((f) => f.verdict === 's3' && /^https?:/i.test(f.url));
    // Small pool — this is an audit, not a load test on our own CDN.
    const POOL = 8;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(POOL, remote.length) }, async () => {
        while (cursor < remote.length) {
          const item = remote[cursor++];
          if (!(await headOk(item.url))) item.verdict = 'remote-missing';
        }
      }),
    );
  }

  if (asJson) {
    console.log(JSON.stringify({ findings }, null, 2));
    return;
  }

  // ── Report ──

  const by = (v: Verdict) => findings.filter((f) => f.verdict === v);
  const missing = by('legacy-missing');
  const present = by('legacy-present');
  const remoteMissing = by('remote-missing');
  const unknown = by('unrecognized');

  console.log('\nLegacy brand-asset audit');
  console.log('='.repeat(72));
  console.log(`release root      ${process.cwd()}`);
  console.log(`references found  ${findings.length}`);
  console.log(`  on S3/absolute  ${by('s3').length}`);
  console.log(`  legacy, intact  ${present.length}   (still in public/, survives deploys)`);
  console.log(`  LEGACY, GONE    ${missing.length}   <- destroyed by a deploy`);
  if (checkRemote) console.log(`  remote 404      ${remoteMissing.length}`);
  if (unknown.length) console.log(`  unrecognized    ${unknown.length}`);

  const report = (title: string, rows: Finding[]) => {
    if (rows.length === 0) return;
    console.log(`\n${title}`);
    console.log('-'.repeat(72));
    const grouped = new Map<string, Finding[]>();
    for (const f of rows) {
      const list = grouped.get(f.ownerLabel) ?? [];
      list.push(f);
      grouped.set(f.ownerLabel, list);
    }
    for (const [label, rowsForOwner] of [...grouped].sort()) {
      console.log(`\n  ${label}  [${rowsForOwner[0].owner}]`);
      for (const f of rowsForOwner) {
        const from = f.resolvedFrom ? `  <- ${f.resolvedFrom}` : '';
        console.log(`    ${f.kind}/${f.variant}`.padEnd(38) + f.url + from);
      }
    }
  };

  report('UNRECOVERABLE — file no longer exists on the release filesystem', missing);
  report('Intact, but still release-relative (migrate to S3 before it rots)', present);
  if (checkRemote) report('Absolute URL that does not resolve', remoteMissing);
  report('Unrecognized reference shape — inspect by hand', unknown);

  console.log('\n' + '='.repeat(72));
  if (missing.length > 0) {
    const owners = new Set(missing.map((f) => f.owner)).size;
    console.log(
      `${missing.length} reference(s) across ${owners} owner(s) point at files that are gone.\n` +
      'Those bytes are not recoverable from the droplet — the deploy replaced the\n' +
      'directory they lived in. Each one needs the asset re-uploaded (which writes to\n' +
      'S3 now) or the reference cleared so the UI falls back instead of 404ing.',
    );
  } else {
    console.log('No dead release-relative references. Nothing to recover.');
  }
  console.log();
}

main()
  .catch((err) => {
    console.error('Audit failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
