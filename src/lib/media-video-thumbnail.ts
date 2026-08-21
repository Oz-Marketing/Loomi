import sharp from 'sharp';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isFfmpegAvailable, runFfmpeg } from '@/lib/render/ffmpeg';
import { getPresignedUrl } from '@/lib/s3';
import type { ThumbnailResult } from '@/lib/media-thumbnails';

/**
 * Poster thumbnails for video assets.
 *
 * Kept apart from `media-thumbnails.ts` for two reasons. That module is pure
 * sharp and safe to import anywhere; this one shells out to ffmpeg and reaches
 * for S3 credentials. And the WORK is different in kind: an image thumbnail
 * resizes bytes we already hold, while a video thumbnail must never hold the
 * bytes at all — a 200MB clip pulled into memory on a small box is how a media
 * upload takes the whole app down.
 *
 * So the source is read in place: ffmpeg is pointed at a presigned URL and fetches
 * only the range around the frame it wants. That's the same trick the ad
 * generator's still export uses, and it means the size of the clip stops
 * mattering.
 *
 * Best-effort throughout: a library without ffmpeg, or a file ffmpeg can't read,
 * yields no thumbnail rather than a failed upload. The tile falls back to a film
 * icon, which is what it did before this existed.
 *
 * Server-only.
 */

const THUMB_MAX = 400;

/** Video containers worth trying. Anything `video/*`, in practice — ffmpeg reads
 *  far more than the browser plays, and a poster is useful even for a source the
 *  builder itself couldn't preview. */
export function isVideoMime(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').toLowerCase().startsWith('video/');
}

/**
 * Where in the clip to take the poster from.
 *
 * A second in, not frame zero: video very often opens on black or on a fade, and
 * a library of black tiles is no more use than a library of film icons. Falls back
 * to the first frame when the clip is shorter than that.
 */
const POSTER_SECONDS = [1, 0];

/** Can this server produce video posters at all? */
export function videoThumbnailsAvailable(): Promise<boolean> {
  return isFfmpegAvailable();
}

export interface VideoThumbnailSource {
  /** Preferred: the object's S3 key, read in place via a presigned URL. */
  s3Key?: string;
  /** For the buffered upload path, where the bytes are already in hand. */
  buffer?: Buffer;
}

/**
 * Extract a frame and return it as the same {@link ThumbnailResult} an image
 * thumbnail produces — so every caller stores it identically (WebP, ≤400px, with
 * the SOURCE's dimensions, which for a video is its real pixel size).
 */
export async function generateVideoThumbnail(
  source: VideoThumbnailSource,
  mimeType: string,
): Promise<ThumbnailResult | null> {
  if (!isVideoMime(mimeType)) return null;
  if (!(await videoThumbnailsAvailable())) return null;

  const dir = await mkdtemp(join(tmpdir(), 'loomi-vthumb-'));
  try {
    let input: string;
    if (source.buffer) {
      input = join(dir, 'source');
      await writeFile(input, source.buffer);
    } else if (source.s3Key) {
      // 10 minutes is ample for one frame grab and short enough that the URL is
      // useless if it leaks into a log.
      input = await getPresignedUrl(source.s3Key, 600);
    } else {
      return null;
    }

    for (const at of POSTER_SECONDS) {
      const frame = join(dir, `frame-${at}.png`);
      try {
        await runFfmpeg(
          [
            // Input seeking: ffmpeg jumps to the frame instead of decoding up to
            // it, which over HTTP means a range request rather than a download.
            ...(at > 0 ? ['-ss', String(at)] : []),
            '-i',
            input,
            '-frames:v',
            '1',
            frame,
          ],
          { timeoutMs: 60_000 },
        );
        const png = await readFile(frame);
        const image = sharp(png);
        const meta = await image.metadata();
        const thumb = await image
          .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        return {
          buffer: thumb.data,
          width: thumb.info.width,
          height: thumb.info.height,
          originalWidth: meta.width || 0,
          originalHeight: meta.height || 0,
        };
      } catch {
        // Seek past the end of a very short clip lands here; try frame zero.
        continue;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}
