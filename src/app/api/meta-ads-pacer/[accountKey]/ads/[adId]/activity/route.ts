import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer, decorateActivityEntry } from '@/lib/meta-ads-pacer';
import { uploadToS3 } from '@/lib/s3';
import { clientErrorMessage } from '@/lib/api-errors';

const PACER_ACTIVITY_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function buildAttachmentKey(
  accountKey: string,
  adId: string,
  entryId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `meta-pacer/${accountKey}/${adId}/activity/${entryId}/${safeName}`;
}

/**
 * POST /api/meta-ads-pacer/[accountKey]/ads/[adId]/activity
 *
 * Accepts either:
 *   - application/json with { text }
 *   - multipart/form-data with `text` (string) and optional `file`
 *
 * On file upload, attachment is stored in S3 and metadata saved on the entry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string; adId: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey, adId } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const ad = await prisma.metaAdsPacerAd.findUnique({
    where: { id: adId },
    select: { plan: { select: { accountKey: true } } },
  });
  if (!ad || ad.plan.accountKey !== accountKey) {
    return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
  }

  const contentType = req.headers.get('content-type') || '';
  let text = '';
  let file: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }
    text = (formData.get('text') as string | null)?.trim() ?? '';
    file = (formData.get('file') as File | null) ?? null;
  } else {
    const body = (await req.json().catch(() => null)) as { text?: string } | null;
    text = body?.text?.trim() ?? '';
  }

  // Allow empty text only when a file is attached
  if (!text && !file) {
    return NextResponse.json(
      { error: 'Comment text or attachment is required' },
      { status: 400 },
    );
  }

  if (file && file.size > PACER_ACTIVITY_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${PACER_ACTIVITY_MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
      },
      { status: 413 },
    );
  }

  const entryId = randomUUID().replace(/-/g, '');
  let attachmentKey: string | null = null;
  let attachmentFilename: string | null = null;
  let attachmentMimeType: string | null = null;
  let attachmentSize: number | null = null;

  if (file) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const key = buildAttachmentKey(accountKey, adId, entryId, file.name);
    try {
      await uploadToS3(key, buffer, mime);
    } catch (err) {
      const message = clientErrorMessage(err, 'Upload failed');
      return NextResponse.json({ error: message }, { status: 500 });
    }
    attachmentKey = key;
    attachmentFilename = file.name;
    attachmentMimeType = mime;
    attachmentSize = file.size;
  }

  const entry = await prisma.metaAdsPacerActivityLog.create({
    data: {
      id: entryId,
      adId,
      text,
      attachmentKey,
      attachmentFilename,
      attachmentMimeType,
      attachmentSize,
      authorUserId: session!.user.id,
    },
  });
  return NextResponse.json(decorateActivityEntry(entry), { status: 201 });
}
