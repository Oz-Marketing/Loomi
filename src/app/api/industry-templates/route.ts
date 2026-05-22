import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { INDUSTRY_TEMPLATES, type IndustryDefaults } from '@/data/industry-defaults';

const KEY_PREFIX = '_industryTemplate:';

type TemplateEntry = {
  name: string;
  fields: IndustryDefaults;
  builtin: boolean;
};

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Read all user-created industry templates from the DB.
 */
async function readCustomTemplates(): Promise<Record<string, TemplateEntry>> {
  const rows = await prisma.account.findMany({
    where: { key: { startsWith: KEY_PREFIX } },
    select: { key: true, dealer: true, customValues: true },
  });

  const result: Record<string, TemplateEntry> = {};
  for (const row of rows) {
    const name = row.dealer;
    let fields: IndustryDefaults = {};
    try {
      fields = row.customValues ? JSON.parse(row.customValues) : {};
    } catch { /* ignore */ }
    result[name] = { name, fields, builtin: false };
  }
  return result;
}

/**
 * GET /api/industry-templates
 *
 * Returns all industry templates (builtin + user-created).
 * Built-in templates can be overridden in DB; the DB version takes
 * precedence for fields while preserving the builtin flag.
 */
export async function GET() {
  const { error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  const customTemplates = await readCustomTemplates();

  // Merge: builtins first, then overlay DB overrides, then add custom-only
  const templates: Record<string, TemplateEntry> = {};
  for (const [name, fields] of Object.entries(INDUSTRY_TEMPLATES)) {
    const override = customTemplates[name];
    templates[name] = { name, fields: override ? override.fields : fields, builtin: true };
  }
  for (const [name, entry] of Object.entries(customTemplates)) {
    if (!templates[name]) {
      templates[name] = entry;
    }
  }

  return NextResponse.json({ templates });
}

/**
 * POST /api/industry-templates
 *
 * Create a new user-defined industry template.
 * Body: { name: string, fields: Record<string, { name: string; value: string }> }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  try {
    const { name, fields } = await req.json() as { name: string; fields: IndustryDefaults };

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Industry name is required' }, { status: 400 });
    }
    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'At least one field is required' }, { status: 400 });
    }

    // Disallow overriding builtins
    if (INDUSTRY_TEMPLATES[name.trim()]) {
      return NextResponse.json({ error: `"${name.trim()}" is a built-in industry and cannot be overridden` }, { status: 409 });
    }

    const slug = slugify(name);
    const key = `${KEY_PREFIX}${slug}`;

    await prisma.account.upsert({
      where: { key },
      update: { dealer: name.trim(), customValues: JSON.stringify(fields) },
      create: { key, slug: `_industry-${slug}`, dealer: name.trim(), customValues: JSON.stringify(fields) },
    });

    return NextResponse.json({ name: name.trim(), fields, builtin: false }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PUT /api/industry-templates
 *
 * Update an industry template (built-in or user-defined).
 * Built-in overrides are stored in the DB alongside custom templates.
 * Body: { name: string, fields: Record<string, { name: string; value: string }>, newName?: string }
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  try {
    const { name, fields, newName } = await req.json() as { name: string; fields: IndustryDefaults; newName?: string };

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Industry name is required' }, { status: 400 });
    }

    const isBuiltin = !!INDUSTRY_TEMPLATES[name];
    const slug = slugify(name);
    const key = `${KEY_PREFIX}${slug}`;
    const displayName = newName?.trim() || name;

    // Upsert: creates a DB row for built-in overrides, or updates existing custom entry
    await prisma.account.upsert({
      where: { key },
      update: { dealer: displayName, customValues: JSON.stringify(fields) },
      create: { key, slug: `_industry-${slug}`, dealer: displayName, customValues: JSON.stringify(fields) },
    });

    return NextResponse.json({ name: displayName, fields, builtin: isBuiltin });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/industry-templates
 *
 * Delete a user-defined industry template.
 * Body: { name: string }
 */
export async function DELETE(req: NextRequest) {
  const { error } = await requireRole('developer', 'super_admin');
  if (error) return error;

  try {
    const { name } = await req.json() as { name: string };

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Industry name is required' }, { status: 400 });
    }

    if (INDUSTRY_TEMPLATES[name]) {
      return NextResponse.json({ error: `"${name}" is a built-in industry and cannot be deleted` }, { status: 403 });
    }

    const slug = slugify(name);
    const key = `${KEY_PREFIX}${slug}`;
    const existing = await prisma.account.findUnique({ where: { key } });
    if (!existing) {
      return NextResponse.json({ error: `Industry "${name}" not found` }, { status: 404 });
    }

    await prisma.account.delete({ where: { key } });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
