import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { playbooksAllowed } from '@/lib/playbooks/access';
import {
  listPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
} from '@/lib/playbooks/library';
import { parseDefinition } from '@/lib/playbooks/creative';

/**
 * The agency-wide creative playbook library (docs/playbooks.md §5).
 *
 * Reading is `agency.subaccounts.view` — the same guard as the audit, since the
 * account settings picker has to list them. Writing is
 * `agency.platform.configure`: a playbook is platform configuration that reaches
 * every rooftop following it, so it sits a tier above reading.
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('agency.subaccounts.view');
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // The account picker asks for published only; the library screen wants
    // drafts too.
    const publishedOnly = req.nextUrl.searchParams.get('published') === '1';
    return NextResponse.json({ playbooks: await listPlaybooks({ publishedOnly }) });
  } catch (err) {
    console.error('[api/playbooks/library] GET failed:', err);
    return NextResponse.json({ error: 'Could not load the playbook library' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('agency.platform.configure');
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const body = (await req.json()) as {
      id?: string;
      name?: string;
      scopeValue?: string | null;
      definition?: unknown;
      publish?: boolean;
      delete?: boolean;
    };

    if (body.delete) {
      if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
      await deletePlaybook(body.id);
      return NextResponse.json({ ok: true });
    }

    // Re-parse rather than trusting the client's shape: this is the same
    // normalization the stored definition gets, so a hand-rolled request can't
    // put a zero offer cap or a non-string size id into the library.
    const definition =
      body.definition !== undefined
        ? parseDefinition(JSON.stringify(body.definition))
        : undefined;

    if (body.id) {
      const updated = await updatePlaybook(body.id, {
        name: body.name,
        scopeValue: body.scopeValue,
        definition,
        publish: body.publish,
      });
      if (!updated) return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
      return NextResponse.json({ playbook: updated });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'A name is required' }, { status: 400 });
    }
    const created = await createPlaybook({
      name: body.name,
      scopeValue: body.scopeValue,
      definition: definition ?? parseDefinition(null),
      publish: body.publish,
      userId: session?.user?.id ?? null,
    });
    return NextResponse.json({ playbook: created });
  } catch (err) {
    console.error('[api/playbooks/library] POST failed:', err);
    return NextResponse.json({ error: 'Could not save the playbook' }, { status: 500 });
  }
}
