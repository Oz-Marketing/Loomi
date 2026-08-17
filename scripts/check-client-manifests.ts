/**
 * Fail the build if a client page is missing from its own RSC client manifest.
 *
 * ── THE BUG THIS CATCHES ────────────────────────────────────────────────────
 * `/sales-trend` began returning 500 in production with:
 *
 *   Could not find the module "src/app/reporting/sales-trend/page.tsx#default"
 *   in the React Client Manifest.
 *
 * The page was unchanged, its structurally identical sibling `/service-trend`
 * worked, and a clean rebuild did not fix it. The difference was in the build
 * output: webpack had assigned that page module the ID `0`, and `0` is falsy in
 * JavaScript, so Next's client-reference-manifest generation dropped it. The
 * chunk was emitted; it just was not registered, leaving the server with no
 * client reference to serialize.
 *
 * That makes it a lottery. Exactly one module in a build gets ID 0, and which
 * one depends on the shape of the module graph — so an unrelated import added
 * anywhere can move the failure onto a different route, and the only signal is
 * a 500 for whoever opens that page. `next build` exits 0, typecheck passes,
 * and unit tests pass, because nothing about the source is wrong.
 *
 * ── WHY A BUILD CHECK RATHER THAN A FIX ─────────────────────────────────────
 * The defect is in Next's manifest generation, not in our source, so there is
 * nothing in the page to correct. We can perturb the graph to move a route off
 * ID 0, but that is luck rather than a fix and it silently re-arms.
 *
 * This turns a silent runtime 500 into a loud build failure. It does not
 * prevent the bug; it guarantees we never ship it again.
 *
 * Wired into BOTH `build` and `build:assets`. That is not belt-and-braces — CI
 * runs `build:assets` (see .github/workflows/deploy*.yml) and never runs
 * `build`, so gating only the latter left this inert on the one path that
 * actually ships. Whichever script a future workflow picks, the check runs.
 *
 *   npx tsx scripts/check-client-manifests.ts
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const APP_DIR = join(ROOT, 'src/app');
const BUILD_APP = join(ROOT, '.next/server/app');

function isClientModule(file: string): boolean {
  if (!existsSync(file)) return false;
  return /^\s*['"]use client['"]/m.test(readFileSync(file, 'utf8').slice(0, 200));
}

/**
 * The client modules a route is responsible for.
 *
 * A `'use client'` page is its own. A SERVER page is not itself a client
 * reference, but the client children it imports are — and one of those can land
 * on module id 0 just as easily. Checking only client pages would have missed
 * exactly the shape `/sales-trend` was moved to in order to dodge this bug, so
 * a server page's first-level relative imports are resolved and any client ones
 * are checked too.
 *
 * First level only, deliberately. The failure is about a route's ENTRY into
 * client-land; walking the whole graph would flag shared leaf components that
 * every route already registers.
 */
function clientEntriesFor(page: string): string[] {
  if (isClientModule(page)) return [page];

  const src = readFileSync(page, 'utf8');
  const dir = dirname(page);
  const entries: string[] = [];
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    for (const ext of ['.tsx', '.ts', '/index.tsx']) {
      const resolved = join(dir, m[1] + ext);
      if (isClientModule(resolved)) {
        entries.push(resolved);
        break;
      }
    }
  }
  return entries;
}

/** Every `page.tsx` under src/app, client or server. */
function findPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/**
 * The route path Next builds this page under — i.e. src/app/foo/page.tsx →
 * .next/server/app/foo. Route groups `(name)` are erased from the URL but NOT
 * from the build output path, so they are kept as-is.
 */
function buildDirFor(pagePath: string): string {
  const rel = relative(APP_DIR, pagePath).replace(/\/page\.tsx$/, '');
  return join(BUILD_APP, rel);
}

function main() {
  if (!existsSync(BUILD_APP)) {
    console.error('[client-manifests] No .next/server/app — run a build first.');
    process.exitCode = 1;
    return;
  }

  const pages = findPages(APP_DIR);
  const missing: { page: string; reason: string }[] = [];
  let checked = 0;

  for (const page of pages) {
    const entries = clientEntriesFor(page);
    if (entries.length === 0) continue; // pure server route — nothing to register

    const manifest = join(buildDirFor(page), 'page_client-reference-manifest.js');
    if (!existsSync(manifest)) {
      missing.push({ page: relative(ROOT, page), reason: 'no client-reference manifest emitted' });
      continue;
    }
    const text = readFileSync(manifest, 'utf8');
    for (const entry of entries) {
      checked++;
      // Keys are absolute build-machine paths, so match on the repo-relative
      // suffix rather than reconstructing the builder's cwd.
      const suffix = relative(ROOT, entry);
      if (!text.includes(suffix)) {
        missing.push({
          page: suffix,
          reason: `absent from ${relative(ROOT, page)}'s clientModules (likely webpack module id 0)`,
        });
      }
    }
  }

  if (missing.length === 0) {
    console.log(`[client-manifests] OK — ${checked} client route entries all registered.`);
    return;
  }

  console.error(
    `\n[client-manifests] ${missing.length} client page(s) missing from their own manifest.\n` +
      'These will build and deploy cleanly, then return 500 at runtime with\n' +
      '"Could not find the module ... in the React Client Manifest".\n',
  );
  for (const m of missing) console.error(`  ✗ ${m.page}\n      ${m.reason}`);
  console.error(
    '\nSee scripts/check-client-manifests.ts for the cause. The usual remedy is to\n' +
      'perturb that route\'s module graph (e.g. split the page body into a child\n' +
      'component) so webpack stops assigning it module id 0.\n',
  );
  process.exitCode = 1;
}

main();
