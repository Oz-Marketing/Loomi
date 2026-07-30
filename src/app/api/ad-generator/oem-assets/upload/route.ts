/**
 * Upload a co-op guideline document — POST /api/ad-generator/oem-assets/upload
 *
 * Multipart, so it lives in its own route rather than branching the JSON action
 * handler next door on content-type.
 *
 * Does three things as one operation, because doing them separately is how a
 * register entry ends up pointing at nothing:
 *   1. puts the file in the Loomi media library (category "oem"), so agency staff
 *      can open the source a citation refers to;
 *   2. hashes the bytes;
 *   3. registers or updates the `AdGuidelineDoc` with that hash and the asset.
 *
 * Uploading a NEW version of an already-registered document is the normal way a
 * reissue enters the system — most manufacturer portals sit behind a login and
 * can't be polled, so the daily re-fetch only covers documents with a public URL.
 * `registerGuidelineDoc` deliberately leaves `reviewedHash` alone, so a re-upload
 * flips the entry to CHANGED instead of quietly resetting the baseline.
 *
 * Admin-only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { registerGuidelineDoc } from '@/lib/ad-generator/guideline-docs';
import { buildS3Key, isS3Configured, s3PublicUrl, uploadToS3 } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 80 MB. The media library caps account uploads at 25 MB, which is right for
 * images but wrong here: the real guideline library includes a 66 MB Yamaha
 * manual and a 45 MB Mazda deck. These are admin-only reference documents, not
 * user-facing assets, so they get their own ceiling.
 */
const MAX_BYTES = 80 * 1024 * 1024;

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const make = String(form.get('make') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  const file = form.get('file') as File | null;

  if (!make || !title) return NextResponse.json({ error: 'make and title are required' }, { status: 400 });
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `${(file.size / 1048576).toFixed(1)} MB exceeds the ${MAX_BYTES / 1048576} MB limit for guideline documents.`,
      },
      { status: 413 },
    );
  }

  const mimeType = file.type || 'application/pdf';
  if (!ALLOWED.has(mimeType)) {
    return NextResponse.json(
      { error: `${mimeType} is not a document type this register accepts (PDF or Word).` },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentHash = createHash('sha256').update(bytes).digest('hex');

  // Short-circuit a re-upload of the SAME bytes that we ALREADY have stored.
  // Without this, re-uploading an identical copy would churn a fresh S3 object and
  // asset row for no gain and report an update where nothing changed.
  //
  // The `sourceAssetId` half of the condition matters: when the hash matches but no
  // asset is on file — S3 unconfigured, or an upload that failed after the hash was
  // recorded — the right move is to proceed and try storing it again, not to report
  // success on a document Loomi cannot actually open.
  const existing = await prisma.adGuidelineDoc
    .findUnique({
      where: { make_title: { make, title } },
      select: { contentHash: true, sourceAssetId: true, sourceUrl: true },
    })
    .catch(() => null);
  if (existing?.contentHash === contentHash && existing.sourceAssetId) {
    return NextResponse.json({
      ok: true,
      unchanged: true,
      message: 'Identical to the document already on file — nothing changed.',
    });
  }

  let sourceAssetId = existing?.sourceAssetId ?? null;
  let sourceUrl = existing?.sourceUrl ?? null;

  if (isS3Configured()) {
    try {
      const assetId = randomUUID().replace(/-/g, '');
      const s3Key = buildS3Key(null, assetId, file.name);
      await uploadToS3(s3Key, Buffer.from(bytes), mimeType);
      await prisma.mediaAsset.create({
        data: {
          id: assetId,
          accountKey: null,
          s3Key,
          filename: file.name,
          mimeType,
          size: bytes.byteLength,
          category: 'oem',
          uploadedBy: (session.user as { id?: string }).id ?? null,
        },
      });
      sourceAssetId = assetId;
      sourceUrl = s3PublicUrl(s3Key);
    } catch (err) {
      console.error('[api/adgen/oem-assets/upload] S3 upload failed:', err);
      return NextResponse.json({ error: 'Could not store the document' }, { status: 500 });
    }
  }

  const row = await registerGuidelineDoc({
    make,
    title,
    sourceUrl,
    sourceAssetId,
    bytes,
    createdBy: (session.user as { id?: string }).id ?? null,
  });
  if (!row) return NextResponse.json({ error: 'Could not register the document' }, { status: 500 });

  return NextResponse.json({
    ok: true,
    doc: row,
    // Registration works without S3 — the hash is what drives change detection — so
    // say plainly when the file itself wasn't kept, rather than implying it was.
    stored: isS3Configured(),
    ...(isS3Configured()
      ? {}
      : { warning: 'S3 is not configured here, so the hash was recorded but the file was not stored.' }),
  });
}
