/**
 * Rebuild every derived brand asset from the source marks.
 *
 * Changing the logo or the favicon means replacing the five source files and
 * running this — not hand-exporting a dozen sizes and hoping they match. Every
 * output below is derived, so the only thing a human has to get right is the
 * source art.
 *
 *   npx tsx scripts/build-brand-assets.ts                 # rebuild from design/brand
 *   npx tsx scripts/build-brand-assets.ts ~/Downloads/new # ingest new art, then rebuild
 *   npx tsx scripts/build-brand-assets.ts --check         # verify outputs are current (CI-friendly)
 *
 * Passing a directory copies the sources into design/brand first, so the art
 * that produced the committed assets is always in version control and anyone
 * can regenerate in a year without hunting for the originals.
 *
 * Source files, matched by BASENAME with any image extension (.png .webp .svg
 * .jpg). Naming is how the script knows which mark is which — it cannot look
 * at them:
 *
 *   loomi-favicon             square app mark  -> favicon set
 *   loomi-logo-black          "loomi", dark ink   -> light theme
 *   loomi-logo-white          "loomi", light ink  -> dark theme
 *   loomi-studio-logo-black   "loomi studio", dark ink  -> light theme
 *   loomi-studio-logo-white   "loomi studio", light ink -> dark theme
 *
 * Why the outputs look the way they do:
 *
 *   PNG, not WebP. WebP is smaller in general, but measured on these
 *   flat-colour wordmarks a palette PNG lands within ~0.2KB of it — and the
 *   same file is embedded in email HTML, where Outlook cannot render WebP at
 *   all. One asset for both surfaces beats a <picture> fallback to keep in sync.
 *
 *   600px wide. Two times the largest on-screen use (login, max-w-[210px]) and
 *   two times the 172px the email template asks for.
 *
 *   Favicon at 256, not 512. The gradient does not palette-quantize, so 512
 *   cost 2.4x the bytes for pixels no browser requests.
 *
 *   Plain Lanczos downscaling. Sharpening was tried at 16 and 32 and put dark
 *   halos around the thin stroke, which is worse than soft.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const REPO = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO, 'design', 'brand');
const BRAND_OUT = path.join(REPO, 'public', 'brand');
const APP_DIR = path.join(REPO, 'src', 'app');

const SOURCE_EXTS = ['.png', '.webp', '.svg', '.jpg', '.jpeg'];

/** Source basename -> the public/brand PNG it produces. */
const WORDMARKS: Record<string, string> = {
  'loomi-studio-logo-black': 'loomi-studio-black.png',
  'loomi-studio-logo-white': 'loomi-studio-white.png',
  'loomi-logo-black': 'loomi-black.png',
  'loomi-logo-white': 'loomi-white.png',
};
const MARK = 'loomi-favicon';

const WORDMARK_WIDTH = 600;
const ICON_SIZE = 256;
const APPLE_SIZE = 180;
const ICO_SIZES = [16, 32, 48];
/** iOS composites onto opaque corners, so a round mark needs a fill behind it. */
const APPLE_BACKDROP = '#ffffff';

const check = process.argv.includes('--check');
const ingestFrom = process.argv.slice(2).find((a) => !a.startsWith('--'));

function findSource(dir: string, basename: string): string | null {
  for (const ext of SOURCE_EXTS) {
    const p = path.join(dir, basename + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ingest(from: string): void {
  const dir = path.resolve(from.replace(/^~/, process.env.HOME ?? '~'));
  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  const wanted = [MARK, ...Object.keys(WORDMARKS)];
  const missing: string[] = [];

  for (const basename of wanted) {
    const found = findSource(dir, basename);
    if (!found) {
      missing.push(basename);
      continue;
    }
    // Keep the source's real extension, and clear any stale one for this mark
    // so a switch from .png to .svg doesn't leave both behind.
    for (const ext of SOURCE_EXTS) {
      const stale = path.join(SOURCE_DIR, basename + ext);
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }
    const dest = path.join(SOURCE_DIR, basename + path.extname(found).toLowerCase());
    fs.copyFileSync(found, dest);
    console.log(`  ingested  ${path.basename(dest)}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing source file(s) in ${dir}:\n` +
        missing.map((m) => `  ${m}.(png|webp|svg|jpg)`).join('\n') +
        `\n\nRename the exports to match — the script identifies each mark by ` +
        `filename, since it cannot look at the art.`,
    );
  }
}

/** ICO container with PNG payloads (supported since Vista). sharp has no encoder. */
function buildIco(pngs: Buffer[], sizes: number[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = pngs.map((png, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0);
    e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

const written: { file: string; bytes: number; changed: boolean }[] = [];

function emit(target: string, buf: Buffer): void {
  const rel = path.relative(REPO, target);
  const changed = !fs.existsSync(target) || !fs.readFileSync(target).equals(buf);
  if (changed && !check) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  written.push({ file: rel, bytes: buf.length, changed });
}

async function main() {
  if (ingestFrom) {
    console.log(`\nIngesting sources from ${ingestFrom}`);
    ingest(ingestFrom);
  }

  const markSrc = findSource(SOURCE_DIR, MARK);
  if (!markSrc) {
    throw new Error(
      `No ${MARK}.* in ${path.relative(REPO, SOURCE_DIR)}.\n` +
        `Pass a directory to ingest from: npx tsx scripts/build-brand-assets.ts ~/Downloads/new-logos`,
    );
  }

  // ── Wordmarks ──
  for (const [basename, out] of Object.entries(WORDMARKS)) {
    const src = findSource(SOURCE_DIR, basename);
    if (!src) throw new Error(`Missing source ${basename}.* in design/brand`);
    emit(
      path.join(BRAND_OUT, out),
      await sharp(src, { density: 900 })
        .resize({ width: WORDMARK_WIDTH })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer(),
    );
  }

  // ── Favicon set (App Router metadata file conventions) ──
  emit(
    path.join(APP_DIR, 'icon.png'),
    await sharp(markSrc, { density: 900 }).resize(ICON_SIZE, ICON_SIZE).png({ compressionLevel: 9 }).toBuffer(),
  );
  emit(
    path.join(APP_DIR, 'apple-icon.png'),
    await sharp(markSrc, { density: 900 })
      .resize(APPLE_SIZE, APPLE_SIZE)
      .flatten({ background: APPLE_BACKDROP })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  const icoPngs = await Promise.all(
    ICO_SIZES.map((s) => sharp(markSrc, { density: 900 }).resize(s, s).png().toBuffer()),
  );
  emit(path.join(APP_DIR, 'favicon.ico'), buildIco(icoPngs, ICO_SIZES));

  // ── Report ──
  const changed = written.filter((w) => w.changed);
  console.log(`\n${check ? 'Checked' : 'Built'} ${written.length} assets from ${path.relative(REPO, SOURCE_DIR)}\n`);
  for (const w of written) {
    const mark = w.changed ? (check ? 'STALE' : 'wrote') : '  ok ';
    console.log(`  ${mark}  ${w.file.padEnd(38)} ${(w.bytes / 1024).toFixed(1)}KB`);
  }

  if (check && changed.length > 0) {
    console.error(
      `\n${changed.length} asset(s) do not match the sources in design/brand.\n` +
        `Run: npx tsx scripts/build-brand-assets.ts`,
    );
    process.exitCode = 1;
    return;
  }
  if (!check) {
    console.log(
      changed.length === 0
        ? '\nAlready up to date.\n'
        : `\n${changed.length} changed. Review them, then commit.\n`,
    );
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
});
