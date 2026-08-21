import { withRouteErrors } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  type AppearancePrefs,
} from '@/lib/appearance/presets';

function toPrefs(row: {
  theme: string;
  accent: string;
  accentCustom: string;
  fontFamily: string;
  density: string;
  reduceTransparency: boolean;
  reduceMotion: boolean;
}): AppearancePrefs {
  return normalizeAppearance(row);
}

/**
 * GET /api/appearance
 *
 * Returns the signed-in user's stored appearance, plus a `stored` flag telling
 * the client whether a row actually exists. The client needs that distinction:
 * "no row yet" means seed the server from this browser's cookie, whereas an
 * existing row is the cross-device truth and overwrites local state.
 */
async function handleGet() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const row = await prisma.userAppearancePreference.findUnique({
    where: { userId: session!.user.id },
  });

  return NextResponse.json({
    stored: row !== null,
    appearance: row ? toPrefs(row) : DEFAULT_APPEARANCE,
  });
}

/**
 * PUT /api/appearance
 *
 * Body: a full or partial AppearancePrefs. Values are normalized against the
 * preset catalog, so an unknown accent/font/density falls back to its default
 * instead of persisting a value no CSS block can render.
 */
async function handlePut(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const existing = await prisma.userAppearancePreference.findUnique({
    where: { userId: session!.user.id },
  });

  // Merge onto what's stored so a partial body patches rather than resets.
  const prefs = normalizeAppearance({
    ...(existing ? toPrefs(existing) : DEFAULT_APPEARANCE),
    ...(body as Record<string, unknown>),
  });

  const row = await prisma.userAppearancePreference.upsert({
    where: { userId: session!.user.id },
    create: { userId: session!.user.id, ...prefs },
    update: prefs,
  });

  return NextResponse.json({ stored: true, appearance: toPrefs(row) });
}

// Wrapped so an unhandled throw returns the JSON error envelope instead of
// a 500 with an empty body, which a caller cannot parse or report.
export const GET = withRouteErrors(handleGet, 'appearance');
export const PUT = withRouteErrors(handlePut, 'appearance');
