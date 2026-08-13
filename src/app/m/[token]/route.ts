import { NextRequest, NextResponse } from 'next/server';
import { downloadFromS3 } from '@/lib/s3';
import { recordPublicLinkAccess, resolvePublicLink } from '@/lib/services/media-public-links';

/**
 * GET /m/[token] — serve an asset to someone with no Loomi account.
 *
 * Short path on purpose: these get pasted into emails and chat, and
 * `/api/media/public-link/<token>` would wrap twice as much noise around the
 * only part that matters.
 *
 * ── Proxied, not redirected ──
 *
 * The obvious cheap implementation is a 302 to the S3 URL. It's rejected: once
 * someone follows a redirect they hold the bucket URL forever, so revoking the
 * link would change nothing for them and the Revoke button would be a lie.
 * Proxying keeps the token as the only handle a recipient ever sees, which is
 * what makes revocation mean something.
 *
 * ── The honest limit ──
 *
 * Objects are uploaded public-read, so the direct bucket URL is world-readable
 * to anyone who already has it. This is a convenience and audit boundary for the
 * people you share links with — NOT an access-control boundary. Making it one
 * means locking the bucket to private reads and routing every media URL through
 * the app, which is a much larger change than this route.
 *
 * Every failure is an identical 404. Distinguishing revoked from expired from
 * never-existed would confirm to a prober that a token was once real.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const link = await resolvePublicLink(token);
  if (!link) {
    return new NextResponse('Not found', { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await downloadFromS3(link.asset.s3Key);
  } catch {
    // The row is valid but the object is gone. Still a 404 to the caller —
    // there's nothing they can do with the distinction.
    return new NextResponse('Not found', { status: 404 });
  }

  recordPublicLinkAccess(token);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': link.asset.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      // Inline so an image previews in the browser rather than downloading —
      // most of these are pasted into a message for someone to look at.
      'Content-Disposition': `inline; filename="${link.asset.filename.replace(/"/g, '')}"`,
      // Short cache, not immutable: a revoked link that stays served from a CDN
      // for a year defeats the point. Five minutes is enough to survive a page
      // with the image on it twice.
      'Cache-Control': 'public, max-age=300',
      // These are shared outward; keep them out of search results.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
