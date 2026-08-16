import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import * as tagService from '@/lib/services/tags';
import {
  assignmentsArrayToMap,
  assignmentsMapToArray,
  type TemplateTagsPayload,
} from '@/lib/template-tags-payload';

export async function GET() {
  const { error } = await requirePermission('studio.templates.view');
  if (error) return error;

  const tags = await tagService.getTags();
  const assignments = await tagService.getTagAssignments();

  const assignmentMap: Record<string, string[]> = {};
  for (const a of assignments) {
    const slug = a.template.slug;
    if (!assignmentMap[slug]) assignmentMap[slug] = [];
    assignmentMap[slug].push(a.tag.name);
  }

  return NextResponse.json({
    tags: tags.map((t) => t.name),
    assignments: assignmentsMapToArray(assignmentMap),
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await requirePermission('studio.templates.edit');
  if (error) return error;

  try {
    const body = await req.json() as TemplateTagsPayload;
    const tagNames = Array.isArray(body.tags)
      ? body.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [];
    const assignments = Array.isArray(body.assignments)
      ? assignmentsArrayToMap(body.assignments)
      : {};

    // Ensure all tags exist
    const existingTags = await tagService.getTags();
    const existingNames = new Set(existingTags.map((t) => t.name));

    for (const name of tagNames) {
      if (!existingNames.has(name)) {
        await tagService.createTag(name);
      }
    }

    // Remove tags that are no longer in the list
    for (const existing of existingTags) {
      if (!tagNames.includes(existing.name)) {
        await tagService.deleteTag(existing.id);
      }
    }

    // Update assignments
    if (assignments) {
      const { getTemplate } = await import('@/lib/services/templates');
      for (const [slug, tagList] of Object.entries(assignments)) {
        const template = await getTemplate(slug);
        if (template) {
          await tagService.setTagAssignments(template.id, tagList);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
