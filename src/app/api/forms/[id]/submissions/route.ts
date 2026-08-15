import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import {
  FormServiceError,
  listFormSubmissions,
  type FormSubmissionRow,
} from '@/lib/services/forms';

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function submissionToCsvRow(row: FormSubmissionRow): string {
  const contactLabel =
    row.contact?.fullName ||
    row.contact?.email ||
    row.contact?.phone ||
    row.contactId ||
    '';
  return [
    row.createdAt,
    row.id,
    row.contactId,
    contactLabel,
    JSON.stringify(row.data),
    // Embed metadata (`meta_*` params from the host page). Serialized
    // like `data` — the leading `{` also keeps a hostile value from
    // being read as a spreadsheet formula.
    JSON.stringify(row.metadata),
    row.ipAddress,
    row.referrer,
  ].map(escapeCsvCell).join(',');
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const page = Number(req.nextUrl.searchParams.get('page') || 1);
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') || 25);

  try {
    const result = await listFormSubmissions({
      formId: id,
      accountKeys: getAccountScope(session!),
      page,
      pageSize: req.nextUrl.searchParams.get('format') === 'csv' ? 10_000 : pageSize,
    });

    if (req.nextUrl.searchParams.get('format') === 'csv') {
      const header = [
        'timestamp',
        'submissionId',
        'contactId',
        'contact',
        'data',
        'metadata',
        'ipAddress',
        'referrer',
      ].join(',');
      const csv = [header, ...result.submissions.map(submissionToCsvRow)].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="form-${id}-submissions.csv"`,
        },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
