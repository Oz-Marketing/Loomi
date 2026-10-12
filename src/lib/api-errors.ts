/**
 * One shape for every API failure.
 *
 * Measured against the running app before writing this, because the audit
 * blamed Cloudflare and only half of that was right:
 *
 *   unhandled throw in a Route Handler  ->  500, NO content-type, EMPTY body
 *   request for an /api/* path with no route  ->  404, text/html, a full page
 *
 * Both break a caller doing `res.json()`. The empty body throws "Unexpected end
 * of JSON input" and carries no reason; the HTML one throws on the first `<`.
 * The second is the one that actually bit us — `/api/custom-values` was removed
 * and its caller kept parsing the 404 page as JSON behind a `.catch(() => ({}))`,
 * so a real breakage looked like an empty response for months.
 *
 * The envelope is deliberately small. `code` is for clients to branch on,
 * `message` is safe to show a person, `retryable` says whether trying again
 * could plausibly work, and `traceId` is what someone quotes in a bug report so
 * a log line can be found.
 */

import { NextResponse } from 'next/server';

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  traceId: string;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'not_configured'
  | 'upstream_error'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  // The account has not connected this integration. 503 rather than 404
  // because the route exists and the answer is "not yet", which is what the
  // reporting routes already do — this only names the convention.
  not_configured: 503,
  upstream_error: 502,
  internal_error: 500,
};

/** Codes where trying the same request again could plausibly succeed. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'rate_limited',
  'upstream_error',
  'internal_error',
]);

/**
 * Short, greppable, and unique enough to tie a user's screenshot to a log line.
 * Not a security boundary — it identifies a request, it does not authorize one.
 */
export function newTraceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  opts: { traceId?: string; status?: number; retryable?: boolean } = {},
): NextResponse<ApiErrorBody> {
  const traceId = opts.traceId ?? newTraceId();
  return NextResponse.json(
    {
      // `error` duplicates `message` on purpose: a lot of existing client code
      // reads `body.error`, and changing every caller to read `body.message`
      // would be a much larger change than this is worth.
      error: message,
      code,
      message,
      retryable: opts.retryable ?? RETRYABLE.has(code),
      traceId,
    },
    {
      status: opts.status ?? STATUS_BY_CODE[code],
      // These are error responses on a session-gated API. Nothing should keep
      // one, least of all a shared cache handing it to the next person.
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}

/**
 * Wrap a Route Handler so an unhandled throw becomes the envelope above
 * instead of an empty 500.
 *
 * Deliberately generic over the handler's own arguments: App Router handlers
 * are variously `(req)`, `(req, { params })`, or `()`, and a wrapper that
 * pinned one shape would not be adoptable across the routes that need it.
 *
 *   export const GET = withRouteErrors(async (req) => { ... });
 *
 * A handler that already returns its own error response is untouched — this
 * only catches what escapes.
 */
export function withRouteErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
  label?: string,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      const traceId = newTraceId();
      // The real error goes to the server log, never to the client — a stack
      // or a raw Postgres message is an information leak and is useless to the
      // person reading it anyway. The traceId is what joins the two.
      console.error(`[api:${label ?? 'route'}] ${traceId}`, err);
      return apiError(
        'internal_error',
        'Something went wrong handling this request.',
        { traceId },
      );
    }
  };
}

const DB_BUSY = /too many (database )?connections|remaining connection slots|timed out fetching a new connection|timeout exceeded when trying to connect|connection terminated/i;

/** A Prisma or Postgres driver error — never a message written for a person. */
function isDatabaseError(err: Error & { code?: unknown; severity?: unknown }): boolean {
  return (
    err.name.startsWith('PrismaClient') ||
    err.name === 'DriverAdapterError' ||
    err.name === 'DatabaseError' ||
    (typeof err.code === 'string' && /^P\d{4}$/.test(err.code)) ||
    err.message.includes('Invalid `prisma.')
  );
}

/**
 * The message a route may hand back for a caught error.
 *
 * Most routes end in `err instanceof Error ? err.message : '…'`, which is
 * right for the errors our own code throws ("accountKey is required") and
 * wrong for database ones: those put Prisma's invocation dump and Postgres
 * internals on screen ("Invalid `prisma.contact.findMany()` invocation: Too
 * many database connections opened…"). This keeps the first and replaces the
 * second, logging the real error under a trace id the person can quote.
 */
export function clientErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (!isDatabaseError(err)) return err.message;

  const traceId = newTraceId();
  console.error(`[api:db] ${traceId}`, err);
  return DB_BUSY.test(err.message)
    ? `The database is busy right now. Please try again in a moment. (ref ${traceId})`
    : `${fallback} (ref ${traceId})`;
}
