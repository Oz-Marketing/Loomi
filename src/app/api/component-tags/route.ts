import { NextResponse } from 'next/server';

/**
 * Legacy Maizzle component tag store. Stub kept so the editor's lazy-load
 * fetch resolves cleanly; returns an empty tag set.
 */
export async function GET() {
  return NextResponse.json({ tags: [], assignments: {} });
}

export async function PUT() {
  return NextResponse.json({ ok: true });
}
