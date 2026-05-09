import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as templateService from '@/lib/services/templates';
import { resolveAdapterAndCredentials, isResolveError } from '@/lib/esp/route-helpers';
import { prisma } from '@/lib/prisma';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

async function compileToHtml(content: string): Promise<string> {
  if (isV2Template(content)) {
    const tpl = parseV2Template(content);
    if (!tpl) throw new Error('Invalid v2 template JSON');
    return renderEmailTemplate(tpl);
  }
  return content;
}

/**
 * POST /api/templates/clone-to-accounts
 *
 * Compiles a Maizzle library template and creates ESP templates
 * for each of the specified account keys.
 *
 * Body: { sourceDesign: string, accountKeys: string[] }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { sourceDesign, accountKeys } = await req.json();

    if (!sourceDesign || !Array.isArray(accountKeys) || accountKeys.length === 0) {
      return NextResponse.json(
        { error: 'sourceDesign and accountKeys[] are required' },
        { status: 400 },
      );
    }

    // Load the library template
    const template = await templateService.getTemplate(sourceDesign);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Compile any-format source → final HTML (v2 / pure HTML / legacy scaffold)
    const compiledHtml = await compileToHtml(template.content);

    // Create an ESP template for each account
    const created: string[] = [];
    const errors: { accountKey: string; error: string }[] = [];

    await Promise.all(
      accountKeys.map(async (accountKey: string) => {
        try {
          // Best-effort provider resolution
          let providerName = 'unknown';
          const resolved = await resolveAdapterAndCredentials(accountKey, {});
          if (!isResolveError(resolved)) {
            providerName = resolved.adapter.provider;
          }

          await prisma.espTemplate.create({
            data: {
              accountKey,
              provider: providerName,
              name: template.title,
              html: compiledHtml,
              source: `library:${sourceDesign}`,
              status: 'draft',
            },
          });
          created.push(accountKey);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push({ accountKey, error: msg });
        }
      }),
    );

    return NextResponse.json({
      success: true,
      created: created.length,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clone to accounts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
