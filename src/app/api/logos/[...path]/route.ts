import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import fs from 'fs';
import path from 'path';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * GET /api/logos/[key]/[filename]
 *
 * Serves locally-stored logo files from data/logos/.
 * Next.js doesn't serve files added to /public after build,
 * so this route handles local fallback logos.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Require authentication (logos are behind auth)
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const segments = await params;
  const filePath = segments.path;

  // Expect exactly [key, filename] — e.g. /api/logos/myAccount/light.png
  if (!filePath || filePath.length !== 2) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const [key, fileName] = filePath;

  // Sanitize — prevent directory traversal
  if (key.includes('..') || fileName.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Try data/logos first (new location), then fall back to public/logos (legacy)
  const dataPath = path.join(process.cwd(), 'data', 'logos', key, fileName);
  const publicPath = path.join(process.cwd(), 'public', 'logos', key, fileName);

  const resolvedPath = fs.existsSync(dataPath)
    ? dataPath
    : fs.existsSync(publicPath)
      ? publicPath
      : null;

  if (!resolvedPath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ext = path.extname(fileName).slice(1).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Unlike avatars, logo filenames are STABLE — every account's light variant is
  // `light.png` forever. The old header here was
  // `public, max-age=31536000, immutable`, which told every browser that this
  // exact URL would never change again: re-upload a rooftop's logo and nobody
  // who had already loaded it would see the new one for a year, with no way to
  // bust it short of renaming the file.
  //
  // So: revalidate every time, but make revalidating free. An ETag off the
  // file's size and mtime turns the common case into a bodyless 304 instead of
  // re-sending the image.
  //
  // `private` for the same reason as the avatars route — this response is
  // behind a session check and must not land in a shared cache.
  const stat = fs.statSync(resolvedPath);
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const cacheHeaders = {
    'Cache-Control': 'private, max-age=0, must-revalidate',
    ETag: etag,
  };

  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  const fileBuffer = fs.readFileSync(resolvedPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      ...cacheHeaders,
    },
  });
}
