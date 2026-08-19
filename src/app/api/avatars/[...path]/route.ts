import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import fs from 'fs';
import path from 'path';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * GET /api/avatars/[filename]
 *
 * Serves locally-stored avatar files from data/avatars/.
 * Next.js doesn't serve files added to /public after build,
 * so this route handles avatar file serving.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const segments = await params;
  const filePath = segments.path;

  // Expect exactly [filename] — e.g. /api/avatars/userId-timestamp.png
  if (!filePath || filePath.length !== 1) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const [fileName] = filePath;

  // Sanitize — prevent directory traversal
  if (fileName.includes('..') || fileName.includes('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Try data/avatars first (new location), then fall back to public/avatars (legacy)
  const dataPath = path.join(process.cwd(), 'data', 'avatars', fileName);
  const publicPath = path.join(process.cwd(), 'public', 'avatars', fileName);

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

  const fileBuffer = fs.readFileSync(resolvedPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // PRIVATE, not public: this response is behind a session check, and a
      // shared cache (Cloudflare, a corporate proxy) is entitled to reuse a
      // `public` response for a different user. It's someone's face.
      //
      // `immutable` IS honest here — the filename carries an upload timestamp
      // (`<userId>-<ms>.jpg`), so a new avatar is a new URL and this bytestream
      // genuinely never changes. Contrast the logos route, whose filenames are
      // stable and which therefore must revalidate.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
