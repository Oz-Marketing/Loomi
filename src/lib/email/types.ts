/**
 * New Loomi email template format (v2) — JSON-based, react-email rendered.
 *
 * Replaces the legacy Maizzle x-base/x-core scaffold format.
 *
 * Storage: `Template.content` is a JSON-stringified `EmailTemplate`.
 * Rendering: `EmailTemplate` -> React tree (react-email components) -> HTML string.
 */

export type BlockType =
  | 'section'
  | 'columns'
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'spacer'
  | 'divider'
  | 'logo'
  | 'social';

export interface Block {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
  /** Only used for `section` blocks (and future `columns` block) */
  children?: Block[];
}

export interface EmailSettings {
  bodyBg: string;        // outer page bg (around the 600px container)
  contentBg: string;     // container bg
  contentWidth: number;  // pixels, default 600
  fontFamily: string;    // default font stack for the email
  textColor: string;     // default body text color
}

export interface EmailTemplate {
  version: '2';
  title?: string;
  subject?: string;
  preheader?: string;
  settings: EmailSettings;
  blocks: Block[];
}

export const DEFAULT_SETTINGS: EmailSettings = {
  bodyBg: '#f5f5f5',
  contentBg: '#ffffff',
  contentWidth: 600,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  textColor: '#1a1a1a',
};

export function isV2Template(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed?.version === '2' && Array.isArray(parsed?.blocks);
  } catch {
    return false;
  }
}

/**
 * Returns true if the template content is editable in the visual drag-and-drop builder.
 * Only v2 JSON templates qualify — legacy Maizzle scaffolds are no longer supported.
 */
export function isVisualEditableTemplate(content: string | null | undefined): boolean {
  if (!content) return false;
  return isV2Template(content);
}

export function parseV2Template(content: string): EmailTemplate | null {
  if (!isV2Template(content)) return null;
  try {
    return JSON.parse(content) as EmailTemplate;
  } catch {
    return null;
  }
}

export function emptyTemplate(): EmailTemplate {
  return {
    version: '2',
    subject: '',
    preheader: '',
    settings: { ...DEFAULT_SETTINGS },
    blocks: [],
  };
}
