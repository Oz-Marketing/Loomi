import { NextResponse } from 'next/server';

/**
 * Legacy Maizzle component folder store. Stub returns an empty list.
 */
export async function GET() {
  return NextResponse.json([]);
}

export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function PUT() {
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
