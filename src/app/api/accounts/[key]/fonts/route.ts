import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as accountService from '@/lib/services/accounts';
import { uploadToS3, deleteFromS3, s3PublicUrl, s3KeyFromPublicUrl, isS3Configured } from '@/lib/s3';

/**
 * Custom font uploads for an account (e.g. OEM-required brand fonts).
 *
 * Mirrors the logos route: multipart upload → DO Spaces → the public URL is
 * appended to the Account's `customFonts` JSON ([{ family, weight, style, url }]).
 * Font MIME types are unreliable across browsers, so we validate by extension.
 *
 *   POST   body: file, family, [weight], [style]  → { font, customFonts }
 *   DELETE ?url=<publicUrl>                        → { customFonts }
 */

const FONT_EXT = ['woff2', 'woff', 'ttf', 'otf'] as const;
const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

interface CustomFont {
  family: string;
  weight: string;
  style: string;
  url: string;
}

function parseFonts(raw: string | null | undefined): CustomFont[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as CustomFont[]) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    if (!isS3Configured()) {
      return NextResponse.json({ error: 'Object storage is not configured on the server.' }, { status: 503 });
    }

    const { key } = await params;
    const account = await accountService.getAccount(key);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const family = (formData.get('family') as string | null)?.trim();
    const weight = ((formData.get('weight') as string | null)?.trim() || '400').replace(/[^0-9a-z]/gi, '');
    const style = (formData.get('style') as string | null)?.trim() === 'italic' ? 'italic' : 'normal';

    if (!file || !family) {
      return NextResponse.json({ error: 'Missing file or family name' }, { status: 400 });
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FONT_EXT.includes(ext as (typeof FONT_EXT)[number])) {
      return NextResponse.json({ error: 'Invalid font type. Allowed: woff2, woff, ttf, otf' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 5MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const s3Key = `fonts/${key}/${randomUUID().replace(/-/g, '')}.${ext}`;
    await uploadToS3(s3Key, buffer, MIME[ext] || 'application/octet-stream');
    const url = s3PublicUrl(s3Key);

    const fonts = parseFonts(account.customFonts);
    const font: CustomFont = { family, weight, style, url };
    fonts.push(font);
    await accountService.updateAccount(key, { customFonts: JSON.stringify(fonts) });

    return NextResponse.json({ font, customFonts: fonts });
  } catch (err) {
    console.error('Font upload error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { key } = await params;
    const account = await accountService.getAccount(key);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    const fonts = parseFonts(account.customFonts);
    const remaining = fonts.filter((f) => f.url !== url);
    await accountService.updateAccount(key, { customFonts: JSON.stringify(remaining) });

    const s3Key = s3KeyFromPublicUrl(url);
    if (s3Key) {
      try {
        await deleteFromS3(s3Key);
      } catch (delErr) {
        console.warn(`[fonts] could not delete object ${s3Key}:`, delErr);
      }
    }

    return NextResponse.json({ customFonts: remaining });
  } catch (err) {
    console.error('Font delete error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Delete failed' }, { status: 500 });
  }
}
