/**
 * JSON 404 for any /api/* path with no route behind it.
 *
 * Without this, Next answers an unmatched API path with the app's HTML
 * not-found PAGE — `text/html`, a full document, the whole font stylesheet.
 * A caller doing `res.json()` throws on the first `<`, and if it swallows that
 * (`.catch(() => ({}))`, which is common) a route that no longer exists is
 * indistinguishable from one returning nothing. That is exactly how
 * `/api/custom-values` stayed broken without anyone noticing.
 *
 * A root-level catch-all is the lowest-precedence match in the App Router, so
 * every real route — static, dynamic, and the nested `[...nextauth]` catch-all —
 * still wins. This only answers what nothing else claimed.
 */

import { apiError } from '@/lib/api-errors';

function notFound() {
  return apiError('not_found', 'No such API endpoint.');
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
