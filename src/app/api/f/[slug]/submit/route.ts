import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitForm, FormSubmitError } from '@/lib/forms/submit';
import { FormValidationError } from '@/lib/forms/validate';
import { checkRateLimit } from '@/lib/forms/rate-limit';

// Public endpoint — no auth. Receives form submissions from the hosted
// /f/[slug] page AND from iframes/JS-embed snippets on customer sites.
// Cross-origin POSTs are allowed (forms get embedded everywhere) so we
// emit permissive CORS headers.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(body), {
    ...init,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  // Resolve the form first. We don't reuse the admin getForm() because
  // this path is unauthenticated — go straight to Prisma.
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form || form.status !== 'published') {
    return jsonResponse({ ok: false, error: 'Form not found' }, { status: 404 });
  }

  // Rate limit on (IP, slug) so a single IP filling out multiple forms
  // doesn't trip on each other. `x-forwarded-for` is set by every PaaS
  // proxy we're likely to run behind; fall back to a fixed key so dev
  // localhost doesn't break.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = checkRateLimit(`form:${slug}:${ip}`);
  if (!limit.ok) {
    return jsonResponse(
      { ok: false, error: 'Too many submissions. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfter) },
      },
    );
  }

  // Parse body — accept JSON OR form-data so the form works both with
  // our fetch-based client component AND with a vanilla <form method=POST>
  // submission (no-JS fallback).
  const rawData = await readBody(req);

  try {
    const result = await submitForm({
      form,
      rawData,
      context: {
        ipAddress: ip,
        userAgent: req.headers.get('user-agent'),
        referrer: req.headers.get('referer'),
      },
    });

    // For non-JS form posts, browsers expect a redirect after submit
    // when there's a redirectUrl configured. Return 200 with the URL
    // and let the client-side handler do `window.location = url` —
    // simpler than juggling 303 redirects that browsers handle differently
    // depending on whether fetch or a real form POST initiated them.
    return jsonResponse({
      ok: true,
      submissionId: result.submissionId,
      redirectUrl: result.redirectUrl,
      successMessage: result.successMessage,
    });
  } catch (err) {
    if (err instanceof FormValidationError) {
      return jsonResponse(
        { ok: false, error: 'Please fix the highlighted fields.', errors: err.errors },
        { status: 400 },
      );
    }
    if (err instanceof FormSubmitError) {
      return jsonResponse(
        { ok: false, error: err.message, errors: err.errors },
        { status: err.status },
      );
    }
    console.error('[forms/submit] unexpected error', err);
    return jsonResponse(
      { ok: false, error: 'Submission failed. Please try again.' },
      { status: 500 },
    );
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  // form-data or url-encoded — collect into a plain object.
  // Multi-value fields (checkbox groups) come through as repeated
  // entries; collapse them into arrays.
  const formData = await req.formData();
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map((v) => (typeof v === 'string' ? v : String(v)));
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}
