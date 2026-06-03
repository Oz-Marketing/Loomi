import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { isS3Configured } from '@/lib/s3';
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_SIZE,
  avatarExtFromMime,
  setUserAvatar,
  clearUserAvatar,
} from '@/lib/services/avatars';

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: 'Object storage is not configured on the server. Missing S3 credentials or bucket.' },
        { status: 503 },
      );
    }

    const userId = session.user.id;
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file upload' }, { status: 400 });
    }
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: PNG, JPG, WebP' }, { status: 400 });
    }
    if (file.size > AVATAR_MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5MB' }, { status: 400 });
    }

    const ext = avatarExtFromMime(file.type);
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported image format' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const avatarUrl = await setUserAvatar(userId, buffer, ext, file.type);

    return NextResponse.json({ avatarUrl });
  } catch (err) {
    console.error('Avatar upload failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    await clearUserAvatar(session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Avatar delete failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    );
  }
}
