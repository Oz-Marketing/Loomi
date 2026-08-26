/**
 * Agent portraits: one hand-made source per character, two derived assets.
 *
 * The source art is a full figure — bun, head, neck, collar — in portrait aspect,
 * cropped edge to edge. That is right for a large display and wrong for a 24px
 * avatar twice over: the face ends up a few pixels tall, and any rounded mask
 * cuts the art (measured: a circular crop of Vera's source removes 33% of her).
 *
 * So this derives:
 *
 *   <key>.webp       square, cropped to the HEAD, padded until the whole head
 *                    fits inside the inscribed circle. Safe in a circle, a
 *                    squircle, or a plain square. Used everywhere at 24-44px.
 *   <key>-full.webp  the source figure, resized. For anywhere with real room.
 *
 * Deriving rather than hand-cropping means the next eleven characters cost one
 * line each, and the framing rule stays identical across all of them.
 *
 * Usage: node scripts/build-agent-avatars.mjs <slug> <source.png>
 *
 * Writes into public/agents/library/ and prints the AVATAR_LIBRARY line to paste
 * into src/lib/ai/specialists/avatar-library.ts.
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const [key, srcPath] = process.argv.slice(2);
if (!key || !srcPath) {
  console.error('usage: node scripts/build-agent-avatars.mjs <key> <source.png>');
  process.exit(1);
}

const AVATAR = 512;
const FULL_H = 640;
/** Breathing room inside the inscribed circle. */
const PAD = 1.04;
/** Alpha above which a pixel counts as the character rather than the surround. */
const OPAQUE = 16;

const { data, info } = await sharp(srcPath).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const alpha = (x, y) => data[(y * W + x) * C + 3];

/** Opaque width of each row — the silhouette's profile down the figure. */
const rowWidth = new Array(H).fill(0);
for (let y = 0; y < H; y++) {
  let min = -1, max = -1;
  for (let x = 0; x < W; x++) {
    if (alpha(x, y) > OPAQUE) { if (min < 0) min = x; max = x; }
  }
  if (min >= 0) rowWidth[y] = max - min + 1;
}

/**
 * The neck: the narrow waist BETWEEN the head and the collar.
 *
 * Found as a local minimum, not a global one — the collar is an ellipse whose
 * bottom row tapers to a point, so scanning for the narrowest row overall finds
 * the hem instead and keeps the whole figure.
 */
function findNeck() {
  const first = rowWidth.findIndex((w) => w > 0);
  const last = H - 1 - [...rowWidth].reverse().findIndex((w) => w > 0);
  const span = last - first;
  // The head occupies roughly the top half; look for the minimum in the band
  // below it but above the collar's widest point.
  const from = first + Math.round(span * 0.5);
  const to = first + Math.round(span * 0.85);
  let y = from, best = Infinity;
  for (let i = from; i <= to; i++) {
    if (rowWidth[i] > 0 && rowWidth[i] < best) { best = rowWidth[i]; y = i; }
  }
  return { neckY: y, neckWidth: best, first, last };
}

const { neckY, neckWidth, first, last } = findNeck();
console.log(`figure y=${first}..${last}; neck at y=${neckY} (${neckWidth}px wide)`);

// Head pixels, and the tightest circle containing them. Measured against real
// pixels rather than the bounding box, whose corners are empty — using the box
// would pad far more than needed and shrink the face.
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
const px = [];
for (let y = 0; y < neckY; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha(x, y) <= OPAQUE) continue;
    px.push(x, y);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
}
const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
let radius = 0;
for (let i = 0; i < px.length; i += 2) {
  const d = Math.hypot(px[i] - cx, px[i + 1] - cy);
  if (d > radius) radius = d;
}
const side = Math.round(radius * 2 * PAD);
console.log(`head ${x1 - x0 + 1}x${y1 - y0 + 1}; enclosing radius ${Math.round(radius)} -> ${side}px square`);

const left = Math.round(cx - side / 2), top = Math.round(cy - side / 2);
await mkdir('public/agents/library', { recursive: true });

// Extract, padding with transparency wherever the square runs off the source, so
// the head stays centred rather than being shoved inward by a clamp.
//
// TWO PIPELINES, deliberately. sharp orders its operations internally as
// extract -> resize -> extend, NOT in the order you chain them, so padding and
// resizing in one pass adds the padding to the ALREADY-RESIZED image: the
// source-pixel margins land on a 512px canvas and the output comes out
// 732x564 instead of square. Materialising the padded square first makes the
// two steps independent of sharp's ordering.
// The square we want, in source coordinates, clamped to what actually exists —
// then padded by exactly how much each edge was clipped. Deriving the padding
// from the clamp (rather than from `side` directly) is what keeps the result
// square when the region overruns one edge but not the opposite one.
const wantLeft = left, wantTop = top;
const wantRight = left + side, wantBottom = top + side;
const srcLeft = Math.max(0, wantLeft), srcTop = Math.max(0, wantTop);
const srcRight = Math.min(W, wantRight), srcBottom = Math.min(H, wantBottom);

const squared = await sharp(srcPath)
  .extract({
    left: srcLeft,
    top: srcTop,
    width: srcRight - srcLeft,
    height: srcBottom - srcTop,
  })
  .extend({
    left: srcLeft - wantLeft,
    top: srcTop - wantTop,
    right: wantRight - srcRight,
    bottom: wantBottom - srcBottom,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const squaredMeta = await sharp(squared).metadata();
if (squaredMeta.width !== squaredMeta.height) {
  throw new Error(`padded head is ${squaredMeta.width}x${squaredMeta.height}, expected a square`);
}

await sharp(squared)
  .resize(AVATAR, AVATAR, { fit: 'fill' })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(`public/agents/library/${key}.webp`);

await sharp(srcPath)
  .resize({ height: FULL_H, fit: 'inside' })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(`public/agents/library/${key}-full.webp`);

/**
 * The accent behind the avatar, taken from the character's HAIR.
 *
 * Bucketed by hue over opaque, saturated pixels. A plain average would fold in
 * the pale face and land on a washed-out lilac that reads as no colour at all;
 * sharp's own `dominant` counts the transparent surround as black.
 */
const avatar = await sharp(`public/agents/library/${key}.webp`).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const buckets = new Map();
for (let i = 0; i < avatar.data.length; i += avatar.info.channels) {
  const [r, g, b, a] = [avatar.data[i], avatar.data[i + 1], avatar.data[i + 2], avatar.data[i + 3]];
  if (a < 240) continue;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 40 || (max - min) / max < 0.35) continue;
  let h;
  if (max === min) h = 0;
  else if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
  else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
  else h = 60 * ((r - g) / (max - min) + 4);
  if (h < 0) h += 360;
  const k = Math.round(h / 10) * 10;
  const acc = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
  acc.n++; acc.r += r; acc.g += g; acc.b += b;
  buckets.set(k, acc);
}
const [, top1] = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)[0];
const accent = '#' + [top1.r, top1.g, top1.b]
  .map((v) => Math.round(v / top1.n).toString(16).padStart(2, '0')).join('');
console.log(`accent ${accent}`);
console.log(
  `add to AVATAR_LIBRARY:  { slug: '${key}', name: '${key[0].toUpperCase()}${key.slice(1)}', url: '/agents/library/${key}.webp', accent: '${accent}' },`,
);
