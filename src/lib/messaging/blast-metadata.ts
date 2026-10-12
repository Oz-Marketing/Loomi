// The `metadata` JSON blob on EmailBlast / SmsBlast, read and merged the same
// way everywhere.
//
// WHY MERGE ON THE SERVER
// ───────────────────────
// Every builder step keeps something in this one column — the template slug,
// the confirmed audience, UTM and follow-up settings, the remembered send time,
// the multi-channel link, MMS media, the quiet-hours choice — and each step
// used to write it whole: read the blob when the page loaded, change a key,
// PATCH the lot back. Any two writers then raced. The Schedule step's
// unmount-flush landing just after the Recipients page loaded was enough for
// the Recipients save to put the old send time back, and the text Message step
// rebuilt the blob from scratch, silently dropping the schedule and the
// quiet-hours flag whenever someone added an image.
//
// The PATCH routes now accept `metadataPatch` — just the keys a step owns — and
// merge it into the stored blob themselves. Pure and client-safe so the routes
// and the pages share one definition of "merge".

/** The blob as an object; anything unreadable reads as empty. */
export function parseBlastMetadata(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Apply `patch` on top of `raw`: each key is set to its value, and a `null`
 * value removes the key. `undefined` values are ignored, so a caller can build
 * a patch from optional fields without deleting what it didn't mean to touch.
 */
export function mergeBlastMetadata(
  raw: string | null | undefined,
  patch: Record<string, unknown>,
): string {
  const next = parseBlastMetadata(raw);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return JSON.stringify(next);
}

/**
 * Read a `metadataPatch` off a request body. Only a plain object counts — an
 * array or a string here is a caller bug, and treating it as "no patch" is
 * safer than guessing at what it meant.
 */
export function readMetadataPatch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The template a blast's email was built from, or '' when none is recorded. */
export function readTemplateSlug(raw: string | null | undefined): string {
  const slug = parseBlastMetadata(raw).templateSlug;
  return typeof slug === 'string' ? slug : '';
}

/** The text half of an email + text pair, from the email half's metadata. */
export function readLinkedSmsId(raw: string | null | undefined): string | null {
  const value = parseBlastMetadata(raw).linkedSmsBlastId;
  return typeof value === 'string' && value ? value : null;
}
