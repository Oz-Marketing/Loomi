import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as templateService from '@/lib/services/templates';
import * as accountEmailService from '@/lib/services/account-emails';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

// ── Helpers ──

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPreviewValues(
  html: string,
  previewValues?: Record<string, string>,
): string {
  if (!previewValues || Object.keys(previewValues).length === 0) return html;

  let output = html;
  for (const [rawKey, rawValue] of Object.entries(previewValues)) {
    if (rawValue === undefined || rawValue === null) continue;
    const key = rawKey.trim();
    if (!key) continue;
    const token = key.startsWith('{{') && key.endsWith('}}')
      ? key
      : `{{${key.replace(/^\{+|\}+$/g, '')}}}`;
    output = output.replace(new RegExp(escapeRegex(token), 'g'), String(rawValue));
  }
  return output;
}

/**
 * Compile any template content into rendered HTML.
 *  - v2 JSON  → react-email render
 *  - Pure HTML → returned as-is
 *
 * Legacy Maizzle <x-base> templates are no longer supported; they fall through
 * to the HTML pass-through path and render unmodified (raw markup visible).
 */
async function compileToHtml(content: string): Promise<string> {
  if (isV2Template(content)) {
    const tpl = parseV2Template(content);
    if (!tpl) throw new Error('Invalid v2 template JSON');
    return renderEmailTemplate(tpl);
  }
  return content;
}

// ── POST /api/preview — Editor preview ──

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const { html, previewValues } = await req.json();
    if (!html) {
      return NextResponse.json({ error: 'No HTML provided' }, { status: 400 });
    }

    const rendered = await compileToHtml(html);
    const resolved = applyPreviewValues(
      rendered,
      previewValues && typeof previewValues === 'object'
        ? (previewValues as Record<string, string>)
        : undefined,
    );
    return NextResponse.json({ html: resolved });
  } catch (err: any) {
    console.error('Preview error:', err);
    return NextResponse.json(
      { error: err.message || 'Preview compilation failed' },
      { status: 500 },
    );
  }
}

// ── GET /api/preview?design=slug|emailId=id — Listing / account email preview ──

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const design = req.nextUrl.searchParams.get('design');
    const emailId = req.nextUrl.searchParams.get('emailId');
    const wantsHtml = req.nextUrl.searchParams.get('format') === 'html';

    let html: string | null = null;
    let previewValues: Record<string, string> = {};

    if (emailId) {
      const accountEmail = await accountEmailService.getAccountEmail(emailId);
      if (!accountEmail) {
        return NextResponse.json({ error: 'Account email not found' }, { status: 404 });
      }
      html = accountEmail.content || accountEmail.template.content;

      if (accountEmail.account) {
        const account = accountEmail.account;
        previewValues['custom_values.dealer_name'] = account.dealer;
        if (account.oem) previewValues['custom_values.oem_name'] = account.oem;
        if (account.phone) previewValues['location.phone'] = account.phone;
        if (account.email) previewValues['location.email'] = account.email;
        if (account.address) previewValues['location.address'] = account.address;
        if (account.website) previewValues['location.website'] = account.website;
        if (account.customValues) {
          try {
            const cv = JSON.parse(account.customValues) as Record<string, { name: string; value: string }>;
            for (const [key, def] of Object.entries(cv)) {
              if (def.value) previewValues[`custom_values.${key}`] = def.value;
            }
          } catch {}
        }
      }
    } else if (design) {
      const template = await templateService.getTemplate(design);
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      html = template.content;
    } else {
      return NextResponse.json({ error: 'Provide design or emailId parameter' }, { status: 400 });
    }

    if (!html) {
      return NextResponse.json({ error: 'No template content' }, { status: 404 });
    }

    const rendered = await compileToHtml(html);
    const resolved = applyPreviewValues(rendered, previewValues);

    if (wantsHtml) {
      return new NextResponse(resolved, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ html: resolved });
  } catch (err: any) {
    console.error('Preview GET error:', err);
    return NextResponse.json(
      { error: err.message || 'Preview compilation failed' },
      { status: 500 },
    );
  }
}

// ── DELETE /api/preview — No-op kept for backwards compatibility ──

export async function DELETE() {
  const { error } = await requireAuth();
  if (error) return error;
  return NextResponse.json({ cleared: true });
}
