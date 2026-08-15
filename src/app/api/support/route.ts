/**
 * Help desk submissions — `POST /api/support`.
 *
 * Takes the `/support` form and files it as an item on the Oz Tools Help Desk
 * monday board (see `@/lib/support/help-desk`). Authenticated: every Loomi user
 * can file, and the session — not the form — is the source of truth for who
 * they are and what role they hold, so a report can't be filed under someone
 * else's name.
 *
 * Body is multipart/form-data: a `payload` JSON part plus zero or more `file`
 * parts (screenshots). Attachments upload after the item exists, and a failed
 * upload does NOT fail the request — losing a screenshot is recoverable, losing
 * the report is not; the response reports which ones didn't make it.
 *
 * When monday isn't configured (no MONDAY_API_TOKEN) or the API is down, the
 * report is emailed to the dev team instead so nothing is silently dropped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/forms/rate-limit';
import {
  DEV_CONTACT,
  LIMITS,
  HELP_DESK_COLUMNS,
  SURFACE_TOOL_LABEL,
  buildColumnValues,
  buildDetailsBody,
  buildItemName,
  isRequestType,
  isSupportSurface,
  isUrgency,
  matchLocationLabel,
  type SupportRequestInput,
} from '@/lib/support/help-desk';
import {
  MondayError,
  addFileToHelpDeskItem,
  createHelpDeskItem,
  getHelpDeskLabels,
  isMondayConfigured,
} from '@/lib/support/monday';
import { escapeHtml, sendTransactionalEmail } from '@/lib/users/transactional-email';

export const runtime = 'nodejs';
// Attachment uploads are sequential network calls; the default budget is tight.
export const maxDuration = 60;

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Loose sanity check — real validity is proven by the reply reaching them. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const limit = checkRateLimit(`support:${session!.user.id}`);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `You've submitted several requests in a row. Try again in ${Math.ceil(
          limit.retryAfter / 60,
        )} minute(s), or call us at ${DEV_CONTACT.phone}.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form submission.' }, { status: 400 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(String(form.get('payload') ?? '')) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Malformed request payload.' }, { status: 400 });
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  const subject = clean(raw.subject, LIMITS.subject);
  const details = clean(raw.details, LIMITS.details);
  const name = clean(raw.name, LIMITS.name) || session!.user.name || '';
  const email = clean(raw.email, LIMITS.email) || session!.user.email || '';

  if (!subject) {
    return NextResponse.json({ error: 'Give your request a short summary.' }, { status: 400 });
  }
  if (details.length < 10) {
    return NextResponse.json(
      { error: 'Tell us a bit more about what happened (at least a sentence).' },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
  }
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!isRequestType(raw.requestType)) {
    return NextResponse.json({ error: 'Choose a type of request.' }, { status: 400 });
  }
  if (!isUrgency(raw.urgency)) {
    return NextResponse.json({ error: 'Choose an urgency level.' }, { status: 400 });
  }

  const input: SupportRequestInput = {
    subject,
    details,
    requestType: raw.requestType,
    urgency: raw.urgency,
    name,
    email,
    phone: clean(raw.phone, LIMITS.phone) || undefined,
    accountName: clean(raw.accountName, LIMITS.name) || undefined,
    surface: isSupportSurface(raw.surface) ? raw.surface : 'studio',
    pageUrl: clean(raw.pageUrl, LIMITS.pageUrl) || undefined,
    userAgent: clean(raw.userAgent, 400) || undefined,
    viewport: clean(raw.viewport, 40) || undefined,
    // Role comes from the session — a self-declared "developer" would be noise.
    userRole: session!.user.role ?? null,
    submittedAt: new Date().toISOString(),
  };

  const files = form
    .getAll('file')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .slice(0, LIMITS.attachmentCount);

  const oversized = files.find((f) => f.size > LIMITS.attachmentBytes);
  if (oversized) {
    return NextResponse.json(
      {
        error: `"${oversized.name}" is larger than ${Math.round(
          LIMITS.attachmentBytes / (1024 * 1024),
        )}MB. Attach a smaller file or email it to ${DEV_CONTACT.email}.`,
      },
      { status: 413 },
    );
  }

  // ── File it ───────────────────────────────────────────────────────────────
  if (!isMondayConfigured()) {
    return emailFallback(input, 'monday.com is not connected in this environment.');
  }

  let item: { id: string; url: string };
  try {
    const labels = await getHelpDeskLabels();
    const locationLabels = labels[HELP_DESK_COLUMNS.location] ?? [];
    const toolLabels = labels[HELP_DESK_COLUMNS.tool] ?? [];

    // Unmatched accounts file under "Other" (when the board offers it) rather
    // than minting a label — the real account name is in the details body.
    const matchedLocation = matchLocationLabel(input.accountName, locationLabels);
    const locationLabel =
      matchedLocation ?? locationLabels.find((l) => l.toLowerCase() === 'other') ?? null;

    const wantedTool = SURFACE_TOOL_LABEL[input.surface];
    const toolLabel = toolLabels.find((l) => l === wantedTool) ?? null;

    item = await createHelpDeskItem({
      itemName: buildItemName(input),
      columnValues: buildColumnValues(input, { locationLabel, toolLabel }),
    });
  } catch (err) {
    const message = err instanceof MondayError ? err.message : String(err);
    console.error('[support] monday item creation failed:', message);
    return emailFallback(input, message);
  }

  const failedUploads: string[] = [];
  for (const file of files) {
    try {
      await addFileToHelpDeskItem(item.id, file);
    } catch (err) {
      failedUploads.push(file.name);
      console.error(
        `[support] attachment "${file.name}" failed for item ${item.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    itemId: item.id,
    itemUrl: item.url,
    delivery: 'monday' as const,
    failedUploads,
  });
}

/**
 * Last-resort delivery: email the report to the dev team.
 *
 * Attachments are deliberately dropped here — the point is to not lose the
 * report, and the reply-to lets the team ask for the screenshot. If SMTP is
 * down too, we surface the phone number rather than pretending it went through.
 */
async function emailFallback(input: SupportRequestInput, reason: string) {
  const body = buildDetailsBody(input);
  const subject = `[Loomi Help Desk] ${input.urgency} · ${input.requestType} — ${input.subject}`;

  try {
    await sendTransactionalEmail({
      to: DEV_CONTACT.email,
      subject,
      text: `${body}\n\n(Filed by email because monday.com was unavailable: ${reason})`,
      html:
        `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(body)}</pre>` +
        `<p style="font:12px/1.5 sans-serif;color:#666">Filed by email because monday.com was unavailable: ${escapeHtml(reason)}</p>`,
      purpose: 'Help desk email fallback',
      replyTo: input.email,
    });
    return NextResponse.json({
      ok: true,
      delivery: 'email' as const,
      failedUploads: [] as string[],
    });
  } catch (err) {
    console.error(
      '[support] email fallback failed:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      {
        error:
          `We couldn't submit your request automatically. Please email ${DEV_CONTACT.email} ` +
          `or call ${DEV_CONTACT.phone} and we'll pick it up from there.`,
      },
      { status: 502 },
    );
  }
}
