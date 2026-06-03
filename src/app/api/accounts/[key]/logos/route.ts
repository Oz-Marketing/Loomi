import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as accountService from '@/lib/services/accounts';
import { uploadToS3, deleteFromS3, s3PublicUrl, s3KeyFromPublicUrl, isS3Configured } from '@/lib/s3';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const VARIANTS = ['light', 'dark', 'white', 'black', 'storefront'] as const;

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

/**
 * POST /api/accounts/[key]/logos
 *
 * Upload a logo for an account to object storage (DO Spaces). The file used to
 * be written to data/logos/[key]/ on the release filesystem, which was wiped
 * on every deploy. The resulting public URL is stored on the Account
 * (logos JSON, or customValues for the storefront image).
 *
 * Body: multipart/form-data with `file` (image) and `variant`
 * (light|dark|white|black|storefront).
 * Returns: { url: string, source: 's3' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: 'Object storage is not configured on the server. Missing S3 credentials or bucket.' },
        { status: 503 },
      );
    }

    const { key } = await params;
    const account = await accountService.getAccount(key);
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const variant = formData.get('variant') as string | null;

    if (!file || !variant) {
      return NextResponse.json({ error: 'Missing file or variant' }, { status: 400 });
    }
    if (!VARIANTS.includes(variant as (typeof VARIANTS)[number])) {
      return NextResponse.json(
        { error: 'Invalid variant. Must be light, dark, white, black, or storefront' },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: PNG, JPG, SVG, WebP' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 5MB' }, { status: 400 });
    }

    const ext = EXT_MAP[file.type] || 'png';
    const buffer = Buffer.from(await file.arrayBuffer());

    // Unique key per upload so the immutable-cached CDN URL always changes
    // when a logo is replaced (no stale-cache problem).
    const s3Key = `logos/${key}/${variant}-${randomUUID().replace(/-/g, '')}.${ext}`;
    await uploadToS3(s3Key, buffer, file.type);
    const url = s3PublicUrl(s3Key);

    // ── Update account data via Prisma, and best-effort delete the old object ──
    let previousUrl: string | undefined;
    if (variant === 'storefront') {
      let customValues: Record<string, { name?: string; value?: string }> = {};
      if (account.customValues) {
        try {
          customValues = JSON.parse(account.customValues);
        } catch {
          customValues = {};
        }
      }
      previousUrl = customValues.storefront_image?.value;
      customValues.storefront_image = {
        name: customValues.storefront_image?.name || 'Storefront Image',
        value: url,
      };
      await accountService.updateAccount(key, { customValues: JSON.stringify(customValues) });
    } else {
      let logos: Record<string, string> = {};
      if (account.logos) {
        try {
          logos = JSON.parse(account.logos);
        } catch {
          logos = {};
        }
      }
      previousUrl = logos[variant];
      logos[variant] = url;
      await accountService.updateAccount(key, { logos: JSON.stringify(logos) });
    }

    const previousKey = s3KeyFromPublicUrl(previousUrl);
    if (previousKey && previousKey !== s3Key) {
      try {
        await deleteFromS3(previousKey);
      } catch (delErr) {
        console.warn(`[logos] could not delete previous object ${previousKey}:`, delErr);
      }
    }

    return NextResponse.json({ url, source: 's3' });
  } catch (err) {
    console.error('Logo upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 },
    );
  }
}
