// Route ↔ step mapping for the blast builder (Recipients → Message → Schedule).
//
// WHY THIS IS ITS OWN MODULE
// ──────────────────────────
// This path list used to be inlined in components/layout-shell.tsx, three
// times over: once to decide whether the builder chrome renders, once to work
// out which step is current, and once for the channel. The Campaigns → Blasts
// rename updated the first copy and missed the other two, so the step matcher
// silently matched nothing and fell through to its `recipients` default — the
// progress nav pinned itself to step 1 on every step, for every channel, and
// stayed that way because nothing failed loudly.
//
// One exported list, one place to change, and unit tests that fail the moment
// a route folder is renamed without updating it.

export const BUILDER_STEPS = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'message', label: 'Message' },
  { key: 'schedule', label: 'Schedule' },
] as const;

export type BuilderStepKey = (typeof BUILDER_STEPS)[number]['key'];
export type BuilderChannel = 'email' | 'sms' | 'multi';

/** Root the builder routes live under. Rename the folder, change this. */
const BUILDER_ROOT = '/messaging/blasts';

/**
 * The email builder's middle step is routed as `template` (it's the template
 * picker/editor) but presented as "Message" so all three channels read the
 * same in the nav.
 */
const EMAIL_MESSAGE_SEGMENT = 'template';

/** Drop a leading /subaccount/<slug> so one pattern set serves both scopes. */
export function stripBuilderPrefix(path: string): string {
  return path.replace(/^\/subaccount\/[^/]+/, '');
}

/** The /subaccount/<slug> prefix on a path, or '' at agency scope. */
export function builderPrefix(path: string): string {
  const match = path.match(/^\/subaccount\/[^/]+/);
  return match ? match[0] : '';
}

const MULTI_RE = new RegExp(
  `^${BUILDER_ROOT}/multi/([^/]+)/(recipients|message|schedule)$`,
);
const SMS_RE = new RegExp(
  `^${BUILDER_ROOT}/sms/([^/]+)/(recipients|message|schedule)$`,
);
const EMAIL_RE = new RegExp(
  `^${BUILDER_ROOT}/([^/]+)/(recipients|${EMAIL_MESSAGE_SEGMENT}|schedule)$`,
);

interface ParsedBuilderPath {
  channel: BuilderChannel;
  step: BuilderStepKey;
  id: string;
}

/**
 * Parse a builder path, or null when `path` isn't a builder step at all.
 *
 * Order matters: the email pattern's `[^/]+` id segment would otherwise
 * happily match the literal `sms` / `multi` segments, so the specific
 * channels are tested first.
 */
export function parseBuilderPath(path: string): ParsedBuilderPath | null {
  const stripped = stripBuilderPrefix(path);

  const multi = stripped.match(MULTI_RE);
  if (multi) {
    return { channel: 'multi', id: multi[1], step: multi[2] as BuilderStepKey };
  }

  const sms = stripped.match(SMS_RE);
  if (sms) {
    return { channel: 'sms', id: sms[1], step: sms[2] as BuilderStepKey };
  }

  const email = stripped.match(EMAIL_RE);
  if (email) {
    const segment = email[2];
    return {
      channel: 'email',
      id: email[1],
      step:
        segment === EMAIL_MESSAGE_SEGMENT
          ? 'message'
          : (segment as BuilderStepKey),
    };
  }

  return null;
}

/** True when this path is one of the builder's full-screen step surfaces. */
export function isBuilderPath(path: string): boolean {
  return parseBuilderPath(path) !== null;
}

/** Current step, defaulting to the first for non-builder paths. */
export function builderStep(path: string): BuilderStepKey {
  return parseBuilderPath(path)?.step ?? 'recipients';
}

/** Current channel, defaulting to email for non-builder paths. */
export function builderChannel(path: string): BuilderChannel {
  return parseBuilderPath(path)?.channel ?? 'email';
}

/** Blast id from a builder path, or '' when the path isn't one. */
export function builderBlastId(path: string): string {
  return parseBuilderPath(path)?.id ?? '';
}

/**
 * Href for a given step of the blast this path belongs to, preserving any
 * sub-account prefix. Returns `path` unchanged when it isn't a builder path,
 * so a caller can't accidentally navigate somewhere nonsensical.
 */
export function builderStepHref(
  path: string,
  channel: BuilderChannel,
  step: BuilderStepKey,
): string {
  const parsed = parseBuilderPath(path);
  if (!parsed) return path;

  const segment =
    channel === 'email' && step === 'message' ? EMAIL_MESSAGE_SEGMENT : step;
  const base =
    channel === 'email'
      ? `${BUILDER_ROOT}/${parsed.id}`
      : `${BUILDER_ROOT}/${channel}/${parsed.id}`;

  return `${builderPrefix(path)}${base}/${segment}`;
}

export interface BuilderCompletion {
  /** An audience has been saved (any mode stamps accountKeys). */
  hasRecipients: boolean;
  /** There is something to send. */
  hasMessage: boolean;
}

/**
 * Which steps the user may jump to.
 *
 * "Anything you've satisfied, plus where you stand" — never a forward jump
 * over an unfilled prerequisite, because the send is gated server-side on the
 * same two facts. Reaching Schedule early would only present a dead button.
 */
export function reachableSteps(
  completion: BuilderCompletion,
): Set<BuilderStepKey> {
  const reachable = new Set<BuilderStepKey>(['recipients']);
  if (completion.hasRecipients) reachable.add('message');
  if (completion.hasRecipients && completion.hasMessage) {
    reachable.add('schedule');
  }
  return reachable;
}
