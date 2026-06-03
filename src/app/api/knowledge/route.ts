import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { getSetting, setSetting, KNOWLEDGE_SETTING_KEY } from '@/lib/services/app-settings';

// The AI knowledge base. Previously stored at loomi-knowledge.md on the
// release filesystem, which was rebuilt from `git archive` on every deploy
// (so edits were silently reverted). Now persisted in Postgres via AppSetting.

export async function GET() {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const content = await getSetting(KNOWLEDGE_SETTING_KEY);
    return NextResponse.json({ content: content ?? '' });
  } catch {
    return NextResponse.json({ content: '' });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { content } = await req.json();
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content must be a string' }, { status: 400 });
    }

    await setSetting(KNOWLEDGE_SETTING_KEY, content);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
