/**
 * Files a person attaches to a question.
 *
 * Shared between the panel and the routes so the two can't drift on what counts
 * as attachable — a client that offers a 10 MB PNG the server then rejects is
 * worse than one that never offered it.
 *
 * Images ride as base64 `image` content blocks; text files ride as text blocks
 * labelled with their filename. Neither is inlined into the composer: an attached
 * file is a THING the message carries, not a wall of characters the user has to
 * scroll past to reach their own sentence.
 */

export type AttachmentKind = 'text' | 'image';

export interface Attachment {
  /** Client-side id, for keying the chip list and removing one. */
  id: string;
  kind: AttachmentKind;
  name: string;
  /** Bytes of the original file — shown on the chip. */
  size: number;
  /** Populated for `text`. */
  text?: string;
  /** Populated for `image`: base64 WITHOUT the `data:` prefix. */
  data?: string;
  /** Populated for `image`, e.g. `image/png`. */
  mediaType?: string;
}

/** What the Messages API accepts. Anything else is rejected before upload. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log', '.tsv', '.yml', '.yaml'];

/** The `accept` string for the file picker — images plus the text formats. */
export const ACCEPT = [...IMAGE_TYPES, ...TEXT_EXTENSIONS, 'text/*'].join(',');

/**
 * Per-file ceilings.
 *
 * The image cap is the API's own 5 MB limit with headroom for base64's ~33%
 * inflation. The text cap is far lower on purpose: a 5 MB CSV is ~1.5M tokens,
 * which would blow the context window and cost a fortune to say "that's a lot of
 * rows". Big data files want a different feature, not a bigger paperclip.
 */
export const MAX_IMAGE_BYTES = 3_500_000;
export const MAX_TEXT_BYTES = 500_000;
/** Total across one message, so five images can't do what one large one can't. */
export const MAX_ATTACHMENTS = 5;

export function isImageType(type: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

/** Human file size for the chip. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How an attachment is sent. Deliberately narrower than {@link Attachment}: the
 * client's `id` and `size` are presentation, and the server has no use for them.
 */
export type WireAttachment =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'image'; name: string; mediaType: string; data: string };

export function toWire(a: Attachment): WireAttachment | null {
  if (a.kind === 'image' && a.data && a.mediaType) {
    return { kind: 'image', name: a.name, mediaType: a.mediaType, data: a.data };
  }
  if (a.kind === 'text' && typeof a.text === 'string') {
    return { kind: 'text', name: a.name, text: a.text };
  }
  return null;
}

/**
 * Attachments → content blocks, in the order the model reads best: files first,
 * then the person's own words.
 *
 * Returning `unknown[]` rather than importing the SDK's block types keeps this
 * module usable from the client, which must not pull the Anthropic SDK into the
 * browser bundle.
 */
export function attachmentBlocks(attachments: WireAttachment[]): unknown[] {
  const blocks: unknown[] = [];
  for (const a of attachments) {
    if (a.kind === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mediaType, data: a.data },
      });
      // Images carry no filename of their own once they're bytes; say what it was
      // so the model can refer to it the way the user will.
      blocks.push({ type: 'text', text: `(attached image: ${a.name})` });
    } else {
      blocks.push({ type: 'text', text: `--- attached file: ${a.name} ---\n${a.text}` });
    }
  }
  return blocks;
}
