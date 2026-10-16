import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { downloadFromS3 } from '@/lib/s3';
import { approvedCreativeBytes, type DraftAsset } from './assets';
import { READ_REPLY_SCHEMA, toReading, type ReadReply } from './extraction';
import { DRAFTING_MODEL, structuredCall } from './model';
import type { CreativeReading } from './reading';

/**
 * EXTRACT + CLASSIFY (docs/email-drafting.md §4, stage 3): one vision pass
 * over the approved creative, producing the reading every later stage trusts.
 *
 * It sees the creative and nothing else — not the request. The conflict check
 * compares the two, and a reader that had seen "1.9% APR" in the request would
 * be inclined to read it off the image too.
 *
 * Each image goes in twice: whole, for layout and what's featured, then as
 * overlapping full-width strips top to bottom. The API scales an image down to
 * about 1,568px on its long edge, which turns a 600×1800 email creative's 6pt
 * disclaimer into a smudge; a strip keeps it near native size.
 */

/** The API's own long-edge target; anything larger is scaled down before the model sees it. */
const LONG_EDGE = 1568;
const STRIP_WIDTH = 1400;
const STRIP_HEIGHT = 900;
const STRIP_OVERLAP = 120;
/** Per image. Past this the strips get taller rather than more numerous. */
const MAX_STRIPS = 6;

interface Prepared {
  overview: Buffer;
  strips: Buffer[];
}

const jpeg = (img: sharp.Sharp) => img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();

export async function prepareImage(bytes: Buffer): Promise<Prepared> {
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("The creative isn't an image Loomi can read.");

  const overview = await jpeg(sharp(bytes).resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true }));

  // Strips only when the overview lost resolution.
  if (Math.max(width, height) <= LONG_EDGE) return { overview, strips: [] };
  const scale = Math.min(1, STRIP_WIDTH / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const scaled = await sharp(bytes).resize(w, h).png().toBuffer();
  const count = Math.min(MAX_STRIPS, Math.max(1, Math.ceil((h - STRIP_OVERLAP) / (STRIP_HEIGHT - STRIP_OVERLAP))));
  const stripH = Math.min(h, Math.ceil((h + STRIP_OVERLAP * (count - 1)) / count));
  const strips: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.min(h - stripH, Math.max(0, i * (stripH - STRIP_OVERLAP)));
    strips.push(await jpeg(sharp(scaled).extract({ left: 0, top, width: w, height: stripH })));
  }
  return { overview, strips };
}

/** The creative's bytes: from Spaces when Loomi kept a copy, else from monday again. */
export async function creativeBytes(asset: DraftAsset): Promise<Buffer> {
  if (asset.s3Key) return downloadFromS3(asset.s3Key);
  return approvedCreativeBytes(asset.mondayAssetId);
}

export const READ_SYSTEM = `You transcribe what an approved automotive marketing graphic says, so an email can be drafted around it. A person compares your reading with the image, and code checks every number in the email against it — so what you report must be exactly what is printed.

TRANSCRIBE, NEVER INFER.
- Report only text printed on the image. Never calculate a value, complete a partial one, or fill one in from what such offers usually say.
- Keep values as printed: "$299/mo", "1.9% APR", "72 months", "Offer ends 10/31/2026". Keep symbols and units.
- confidence "high" only when every character is clear. If any character is uncertain, use "low" — a low reading is useful; a confident wrong one is the worst outcome.
- Text you can see but not make out goes in \`unreadable\` as a short description ("second line of the disclaimer, bottom right"), not as a guess.

FIELDS — one entry per distinct statement, using only these keys:
headline, subhead, vehicle (year/make/model/trim as printed), offer (an offer line that is none of the specific keys, e.g. a service special or event offer), payment, term, apr, dueAtSigning, msrp, price, savings, rebate, services (services or parts featured), expiration, cta (button or call-to-action wording), dealer (the dealership name as printed), logos (whose logos appear, described, e.g. "Mazda logo, Young Mazda logo"), other (any other printed text worth knowing).
A line like "1.9% APR for 72 months" is two fields: apr "1.9% APR" and term "72 months". Give \`image\` as the number of the image the field was read from.

THE DISCLAIMER is legal text and goes into the email word for word.
- Transcribe ALL of it, exactly: every word, number, symbol (®, ™, *, †), and punctuation mark, in order. Do not fix typos, expand abbreviations, or tidy spacing within a line.
- Keep paragraph breaks as newlines; join lines that only wrap.
- If several images carry the same disclaimer, give it once. If none carries one, return null.
- If any part is unreadable, transcribe what you can, mark it "low", and describe the gap in \`unreadable\`.

CLASSIFY the request type:
model_offer — a vehicle sales offer: lease, APR/finance, cash or price on a model.
service_special — service, parts or tire specials.
sales_event — a named sale or VIP event without an RSVP.
event_invite — an event to attend (grand opening, open house), with a date and place.
announcement — a survey, notice, closure, cancellation or informational message.
conquest — aimed at owners of another brand.
other — anything else.
offerType: lease, finance, cash or other for a vehicle offer; null otherwise. vehicle: the one featured vehicle, or null when there is none or several.

Several images may be sizes of the same creative. Each comes first whole, then as detail strips from top to bottom of that same image, for reading small print.`;

export async function readCreative(assets: DraftAsset[]): Promise<CreativeReading> {
  const images = assets.filter((a) => a.contentType.startsWith('image/'));
  if (images.length === 0) throw new Error('There is no image to read.');

  const content: Anthropic.ContentBlockParam[] = [];
  const block = (b: Buffer): Anthropic.ImageBlockParam => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') },
  });
  for (const [i, asset] of images.entries()) {
    const prepared = await prepareImage(await creativeBytes(asset));
    content.push({ type: 'text', text: `Image ${i + 1} — "${asset.name}", whole:` }, block(prepared.overview));
    prepared.strips.forEach((strip, s) => {
      content.push({ type: 'text', text: `Image ${i + 1}, detail ${s + 1} of ${prepared.strips.length} (top to bottom):` }, block(strip));
    });
  }
  content.push({ type: 'text', text: 'Read this creative.' });

  const reply = await structuredCall<ReadReply>({
    system: READ_SYSTEM,
    content,
    schema: READ_REPLY_SCHEMA as unknown as Record<string, unknown>,
    effort: 'high',
    task: 'reading the creative',
  });
  return toReading(reply, {
    model: DRAFTING_MODEL,
    readAt: new Date().toISOString(),
    assetIds: images.map((a) => a.mondayAssetId),
  });
}
