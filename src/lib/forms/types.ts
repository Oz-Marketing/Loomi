/**
 * Loomi form template format (v1) — JSON, block-based.
 *
 * Mirrors the v2 email template shape in src/lib/email/types.ts so the
 * drag-and-drop editor can be reused with a swapped block registry.
 *
 * Storage: `Form.schema` is a JSON column holding a `FormTemplate`.
 * Rendering: `FormTemplate` -> React tree of form components -> plain
 * browser HTML (no react-email — forms render in the browser, not in
 * an email client).
 */

export type FormBlockType =
  // Layout blocks (visual parity with the email builder)
  | 'section'
  | 'columns'
  | 'heading'
  | 'text'
  | 'image'
  | 'divider'
  | 'spacer'
  // Form fields
  | 'field_text'
  | 'field_email'
  | 'field_phone'
  | 'field_textarea'
  | 'field_select'
  | 'field_checkbox'
  | 'field_radio'
  | 'field_consent'
  | 'field_hidden'
  // CTA
  | 'submit_button';

export interface Block {
  id: string;
  type: FormBlockType;
  props: Record<string, unknown>;
  /** Only used for `section` and `columns` blocks. */
  children?: Block[];
}

export interface FormSettings {
  bodyBg: string;        // outer page background (around the form container)
  contentBg: string;     // form container background
  contentWidth: number;  // pixels, default 640
  /** Inner padding of the form container — per-side, in px. Drives
   *  the space between the form card edge and its content. Defaults
   *  to 32 on every side; use 0 for an edge-to-edge layout. */
  contentPaddingTop: number;
  contentPaddingRight: number;
  contentPaddingBottom: number;
  contentPaddingLeft: number;
  /** Outer spacing around the form container — per-side, in px.
   *  Drives the gap between the form card and the page edges.
   *  Defaults to 32 on every side. */
  contentMarginTop: number;
  contentMarginRight: number;
  contentMarginBottom: number;
  contentMarginLeft: number;
  /** Corner radius of the form container, in px. Default 12. */
  contentBorderRadius: number;
  fontFamily: string;    // default font stack
  textColor: string;     // default body text color
  // Whether the public page strips outer chrome (used by ?embed=1 and
  // iframe rendering). Kept as a setting rather than purely query-driven
  // so we can also support a "always embed-style" preview mode later.
  embedMode?: boolean;
}

export interface FormTemplate {
  version: '1';
  title?: string;
  settings: FormSettings;
  blocks: Block[];
}

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  bodyBg: '#f5f5f5',
  contentBg: '#ffffff',
  contentWidth: 640,
  contentPaddingTop: 32,
  contentPaddingRight: 32,
  contentPaddingBottom: 32,
  contentPaddingLeft: 32,
  contentMarginTop: 32,
  contentMarginRight: 32,
  contentMarginBottom: 32,
  contentMarginLeft: 32,
  contentBorderRadius: 12,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  textColor: '#1a1a1a',
};

export function isV1FormTemplate(content: unknown): content is FormTemplate {
  if (!content || typeof content !== 'object') return false;
  const c = content as Record<string, unknown>;
  return c.version === '1' && Array.isArray(c.blocks) && typeof c.settings === 'object';
}

export function parseFormTemplate(raw: unknown): FormTemplate | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return isV1FormTemplate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isV1FormTemplate(raw) ? raw : null;
}

export function emptyFormTemplate(): FormTemplate {
  return {
    version: '1',
    settings: { ...DEFAULT_FORM_SETTINGS },
    blocks: [],
  };
}

/**
 * Walk a form template and return every field block (anything whose type
 * starts with `field_` or is `submit_button`). Used by the submission
 * pipeline to validate POST bodies against the form's declared fields.
 */
export function collectFieldBlocks(template: FormTemplate): Block[] {
  const out: Block[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type.startsWith('field_') || block.type === 'submit_button') {
        out.push(block);
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(template.blocks);
  return out;
}

/**
 * The field-block prop key that names the submitted field in form data.
 * Form fields carry a `name` prop (defaulted to the block id at insert
 * time) so submissions remain stable even when the block id changes.
 */
export function getFieldName(block: Block): string {
  const name = block.props?.name;
  return typeof name === 'string' && name.length > 0 ? name : block.id;
}
