import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { uploadToS3, deleteFromS3, s3PublicUrl, s3KeyFromPublicUrl } from '@/lib/s3';

/**
 * User avatar storage on object storage (DO Spaces).
 *
 * Avatars previously lived under data/avatars on the release filesystem. That
 * survived deploys only via a shared-dir symlink, which doesn't work on an
 * ephemeral, multi-instance host (DO App Platform). They now live in Spaces;
 * the public URL is stored on User.avatarUrl.
 */

export const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB

/** Map an allowed image mime type to a file extension, or null if unsupported. */
export function avatarExtFromMime(mimeType: string): string | null {
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  };
  return extensions[mimeType] || null;
}

/** Best-effort delete of a previously-stored avatar object (ignores non-S3 URLs). */
async function deletePreviousAvatar(previousUrl: string | null | undefined): Promise<void> {
  const key = s3KeyFromPublicUrl(previousUrl);
  if (!key) return;
  try {
    await deleteFromS3(key);
  } catch (err) {
    console.warn(`[avatars] could not delete previous object ${key}:`, err);
  }
}

/** Upload a new avatar, point the user at it, and clean up the old object. */
export async function setUserAvatar(
  userId: string,
  buffer: Buffer,
  ext: string,
  contentType: string,
): Promise<string> {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });

  // Unique key per upload so the immutable-cached URL always changes.
  const s3Key = `avatars/${userId}-${randomUUID().replace(/-/g, '')}.${ext}`;
  await uploadToS3(s3Key, buffer, contentType);
  const avatarUrl = s3PublicUrl(s3Key);

  await prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
  await deletePreviousAvatar(current?.avatarUrl);
  return avatarUrl;
}

/** Clear a user's avatar and delete the stored object. */
export async function clearUserAvatar(userId: string): Promise<void> {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  await deletePreviousAvatar(current?.avatarUrl);
}
