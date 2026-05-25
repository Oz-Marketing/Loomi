/**
 * Block schemas for the forms visual editor.
 *
 * Same shape as src/lib/email/schemas.ts so the (copied) editor shell
 * can render these block configs unchanged. Layout block schemas
 * (section, columns, heading, text, image, divider, spacer) are kept
 * deliberately parallel to the email versions so the editor experience
 * is identical across both surfaces.
 *
 * The field_* blocks are new and form-specific.
 */

import type { FormBlockType } from './types';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'url'
  | 'image'
  | 'select'
  | 'toggle'
  | 'number'
  | 'range'
  | 'unit';

export interface PropSchema {
  key: string;
  label: string;
  type: FieldType;
  default?: string | number | boolean;
  options?: { label: string; value: string | number }[];
  group?: string;
  half?: boolean;
  placeholder?: string;
  description?: string;
  min?: number;
  max?: number;
  /** Render the number/range/unit input with an inline slider (Elementor pattern). */
  slider?: boolean;
  sliderMin?: number;
  sliderMax?: number;
}

export interface BlockSchema {
  type: FormBlockType;
  label: string;
  icon: string;
  description: string;
  defaults: Record<string, unknown>;
  props: PropSchema[];
  acceptsChildren?: boolean;
  /** Grouping bucket for the editor palette UI. */
  category: 'layout' | 'field' | 'cta';
}

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

const FONT_WEIGHT_OPTIONS = [
  { label: '400 (Normal)', value: 400 },
  { label: '500 (Medium)', value: 500 },
  { label: '600 (Semibold)', value: 600 },
  { label: '700 (Bold)', value: 700 },
  { label: '800 (Extra Bold)', value: 800 },
];

const TEXT_TRANSFORM_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Uppercase', value: 'uppercase' },
  { label: 'Lowercase', value: 'lowercase' },
  { label: 'Capitalize', value: 'capitalize' },
];

const HEADING_LEVEL_OPTIONS = [
  { label: 'H1', value: 1 },
  { label: 'H2', value: 2 },
  { label: 'H3', value: 3 },
  { label: 'H4', value: 4 },
  { label: 'H5', value: 5 },
  { label: 'H6', value: 6 },
];

const BORDER_STYLE_OPTIONS = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

const COLUMN_COUNT_OPTIONS = [
  { label: '2 columns', value: 2 },
  { label: '3 columns', value: 3 },
];

const VALIGN_OPTIONS = [
  { label: 'Top', value: 'top' },
  { label: 'Middle', value: 'middle' },
  { label: 'Bottom', value: 'bottom' },
];

const FIELD_WIDTH_OPTIONS = [
  { label: 'Full', value: 'full' },
  { label: 'Half', value: 'half' },
];

// Shared field-style defaults — applied to every input block so the
// "input" half of the form has a single source of truth.
const FIELD_STYLE_PROPS: PropSchema[] = [
  { key: 'inputBgColor', label: 'Input Background', type: 'color', default: '#ffffff', half: true, group: 'input-style' },
  { key: 'inputTextColor', label: 'Input Text', type: 'color', default: '#1a1a1a', half: true, group: 'input-style' },
  { key: 'inputBorderColor', label: 'Border', type: 'color', default: '#d4d4d4', half: true, group: 'input-style' },
  { key: 'inputBorderWidth', label: 'Border Width', type: 'number', default: 1, half: true, group: 'input-style' },
  { key: 'inputBorderRadius', label: 'Radius', type: 'number', default: 6, half: true, group: 'input-style' },
  { key: 'inputPaddingY', label: 'Padding Y', type: 'number', default: 10, half: true, group: 'input-style' },
  { key: 'inputPaddingX', label: 'Padding X', type: 'number', default: 12, half: true, group: 'input-style' },
  { key: 'inputFontSize', label: 'Font Size', type: 'number', default: 15, half: true, group: 'input-style' },
];

const LABEL_PROPS: PropSchema[] = [
  { key: 'label', label: 'Label', type: 'text', group: 'content' },
  { key: 'placeholder', label: 'Placeholder', type: 'text', group: 'content' },
  { key: 'helpText', label: 'Help Text', type: 'text', group: 'content' },
  { key: 'required', label: 'Required', type: 'toggle', default: false, half: true, group: 'content' },
  { key: 'width', label: 'Width', type: 'select', options: FIELD_WIDTH_OPTIONS, default: 'full', half: true, group: 'content' },
  { key: 'name', label: 'Field Name', type: 'text', group: 'advanced', description: 'Internal key used in submission data. Defaults to the block id.' },
  { key: 'labelColor', label: 'Label Color', type: 'color', default: '#1a1a1a', half: true, group: 'label-style' },
  { key: 'labelFontSize', label: 'Label Size', type: 'number', default: 14, half: true, group: 'label-style' },
  { key: 'labelFontWeight', label: 'Label Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 600, group: 'label-style' },
  { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 16, group: 'spacing' },
];

// ── Layout schemas (parity with email) ──

export const SECTION_SCHEMA: BlockSchema = {
  type: 'section',
  label: 'Section',
  icon: 'square-3-stack',
  description: 'Container for grouping blocks with shared background and padding.',
  acceptsChildren: true,
  category: 'layout',
  defaults: { paddingTop: 32, paddingBottom: 32, paddingLeft: 32, paddingRight: 32 },
  props: [
    { key: 'bgColor', label: 'Background', type: 'color', group: 'background' },
    { key: 'align', label: 'Alignment', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'layout' },
    { key: 'paddingTop', label: 'Padding Top', type: 'number', default: 32, half: true, group: 'spacing' },
    { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: 32, half: true, group: 'spacing' },
    { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: 32, half: true, group: 'spacing' },
    { key: 'paddingRight', label: 'Padding Right', type: 'number', default: 32, half: true, group: 'spacing' },
  ],
};

export const COLUMNS_SCHEMA: BlockSchema = {
  type: 'columns',
  label: 'Columns',
  icon: 'columns',
  description: 'Multi-column row for placing blocks side by side.',
  acceptsChildren: true,
  category: 'layout',
  defaults: {
    columnCount: 2,
    gap: 16,
    valign: 'top',
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    stackOnMobile: true,
  },
  props: [
    { key: 'columnCount', label: 'Columns', type: 'select', options: COLUMN_COUNT_OPTIONS, default: 2, half: true, group: 'layout' },
    { key: 'gap', label: 'Gap', type: 'number', default: 16, half: true, group: 'layout' },
    { key: 'valign', label: 'Vertical Align', type: 'select', options: VALIGN_OPTIONS, default: 'top', half: true, group: 'layout' },
    { key: 'stackOnMobile', label: 'Stack on Mobile', type: 'toggle', default: true, half: true, group: 'layout' },
    { key: 'bgColor', label: 'Background', type: 'color', group: 'background' },
    { key: 'paddingTop', label: 'Padding Top', type: 'number', default: 16, half: true, group: 'spacing' },
    { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: 16, half: true, group: 'spacing' },
    { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: 16, half: true, group: 'spacing' },
    { key: 'paddingRight', label: 'Padding Right', type: 'number', default: 16, half: true, group: 'spacing' },
  ],
};

export const HEADING_SCHEMA: BlockSchema = {
  type: 'heading',
  label: 'Heading',
  icon: 'h1',
  description: 'Text heading (H1–H6).',
  category: 'layout',
  defaults: { text: 'Your headline here', level: 1, color: '#1a1a1a', fontSize: 32, fontWeight: 700, align: 'left', marginBottom: 16 },
  props: [
    { key: 'text', label: 'Text', type: 'textarea', group: 'content' },
    { key: 'level', label: 'Level', type: 'select', options: HEADING_LEVEL_OPTIONS, default: 1, half: true, group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'content' },
    { key: 'color', label: 'Color', type: 'color', default: '#1a1a1a', group: 'typography' },
    { key: 'fontSize', label: 'Font Size', type: 'number', default: 32, half: true, group: 'typography' },
    { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 700, half: true, group: 'typography' },
    { key: 'lineHeight', label: 'Line Height', type: 'number', default: 1.2, half: true, group: 'typography' },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'text', default: 'normal', half: true, group: 'typography' },
    { key: 'textTransform', label: 'Transform', type: 'select', options: TEXT_TRANSFORM_OPTIONS, default: 'none', group: 'typography' },
    { key: 'fontFamily', label: 'Font Family', type: 'text', group: 'typography' },
    { key: 'marginTop', label: 'Margin Top', type: 'number', default: 0, half: true, group: 'spacing' },
    { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 16, half: true, group: 'spacing' },
  ],
};

export const TEXT_SCHEMA: BlockSchema = {
  type: 'text',
  label: 'Text',
  icon: 'paragraph',
  description: 'Paragraph of body text.',
  category: 'layout',
  defaults: { text: 'Your message goes here.', color: '#3a3a3a', fontSize: 15, lineHeight: 1.6, align: 'left', marginBottom: 16 },
  props: [
    { key: 'text', label: 'Text', type: 'textarea', group: 'content' },
    { key: 'allowHtml', label: 'Allow HTML', type: 'toggle', default: false, group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'content' },
    { key: 'color', label: 'Color', type: 'color', default: '#3a3a3a', group: 'typography' },
    { key: 'fontSize', label: 'Font Size', type: 'number', default: 15, half: true, group: 'typography' },
    { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 400, half: true, group: 'typography' },
    { key: 'lineHeight', label: 'Line Height', type: 'number', default: 1.6, half: true, group: 'typography' },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'text', default: 'normal', half: true, group: 'typography' },
    { key: 'fontFamily', label: 'Font Family', type: 'text', group: 'typography' },
    { key: 'marginTop', label: 'Margin Top', type: 'number', default: 0, half: true, group: 'spacing' },
    { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 16, half: true, group: 'spacing' },
  ],
};

export const IMAGE_SCHEMA: BlockSchema = {
  type: 'image',
  label: 'Image',
  icon: 'photo',
  description: 'Image, optionally wrapped in a link.',
  category: 'layout',
  defaults: { align: 'center', borderRadius: 0, maxWidth: '100%' },
  props: [
    { key: 'src', label: 'Image', type: 'image', group: 'content' },
    { key: 'alt', label: 'Alt Text', type: 'text', group: 'content' },
    { key: 'linkUrl', label: 'Link URL', type: 'url', group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
    { key: 'width', label: 'Width (px)', type: 'number', half: true, group: 'layout' },
    { key: 'height', label: 'Height (px)', type: 'number', half: true, group: 'layout' },
    { key: 'borderRadius', label: 'Border Radius', type: 'number', default: 0, group: 'style' },
  ],
};

export const SPACER_SCHEMA: BlockSchema = {
  type: 'spacer',
  label: 'Spacer',
  icon: 'arrows-up-down',
  description: 'Vertical empty space between blocks.',
  category: 'layout',
  defaults: { height: 24 },
  props: [
    { key: 'height', label: 'Height (px)', type: 'number', default: 24, group: 'layout' },
    { key: 'bgColor', label: 'Background', type: 'color', group: 'style' },
  ],
};

export const DIVIDER_SCHEMA: BlockSchema = {
  type: 'divider',
  label: 'Divider',
  icon: 'minus',
  description: 'Horizontal rule.',
  category: 'layout',
  defaults: { color: '#e5e5e5', thickness: 1, style: 'solid', marginTop: 16, marginBottom: 16 },
  props: [
    { key: 'color', label: 'Color', type: 'color', default: '#e5e5e5', half: true, group: 'style' },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 1, half: true, group: 'style' },
    { key: 'style', label: 'Style', type: 'select', options: BORDER_STYLE_OPTIONS, default: 'solid', group: 'style' },
    { key: 'width', label: 'Width', type: 'text', default: '100%', group: 'layout' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
    { key: 'marginTop', label: 'Margin Top', type: 'number', default: 16, half: true, group: 'spacing' },
    { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 16, half: true, group: 'spacing' },
  ],
};

// ── Field schemas ──

export const FIELD_TEXT_SCHEMA: BlockSchema = {
  type: 'field_text',
  label: 'Short Text',
  icon: 'pencil-square',
  description: 'Single-line text input.',
  category: 'field',
  defaults: { label: 'Name', placeholder: '', required: false, width: 'full', name: '', marginBottom: 16 },
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_EMAIL_SCHEMA: BlockSchema = {
  type: 'field_email',
  label: 'Email',
  icon: 'envelope',
  description: 'Email input. Submission upserts the Contact by this value.',
  category: 'field',
  defaults: { label: 'Email', placeholder: 'you@example.com', required: true, width: 'full', name: 'email', marginBottom: 16 },
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_PHONE_SCHEMA: BlockSchema = {
  type: 'field_phone',
  label: 'Phone',
  icon: 'phone',
  description: 'Phone-number input.',
  category: 'field',
  defaults: { label: 'Phone', placeholder: '(555) 555-5555', required: false, width: 'full', name: 'phone', marginBottom: 16 },
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_TEXTAREA_SCHEMA: BlockSchema = {
  type: 'field_textarea',
  label: 'Long Text',
  icon: 'bars-3-bottom-left',
  description: 'Multi-line text input.',
  category: 'field',
  defaults: { label: 'Message', placeholder: '', required: false, width: 'full', name: '', rows: 4, marginBottom: 16 },
  props: [
    ...LABEL_PROPS,
    { key: 'rows', label: 'Rows', type: 'number', default: 4, group: 'content' },
    ...FIELD_STYLE_PROPS,
  ],
};

export const FIELD_SELECT_SCHEMA: BlockSchema = {
  type: 'field_select',
  label: 'Dropdown',
  icon: 'chevron-up-down',
  description: 'Single-select dropdown.',
  category: 'field',
  defaults: {
    label: 'Choose one',
    required: false,
    width: 'full',
    name: '',
    options: [
      { label: 'Option 1', value: 'option-1' },
      { label: 'Option 2', value: 'option-2' },
    ],
    marginBottom: 16,
  },
  // Options are edited via a custom repeater UI, not a generic field.
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_CHECKBOX_SCHEMA: BlockSchema = {
  type: 'field_checkbox',
  label: 'Checkboxes',
  icon: 'check-circle',
  description: 'Multi-select checkbox group.',
  category: 'field',
  defaults: {
    label: 'Select all that apply',
    required: false,
    width: 'full',
    name: '',
    options: [
      { label: 'Option 1', value: 'option-1' },
      { label: 'Option 2', value: 'option-2' },
    ],
    marginBottom: 16,
  },
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_RADIO_SCHEMA: BlockSchema = {
  type: 'field_radio',
  label: 'Radio Buttons',
  icon: 'list-bullet',
  description: 'Single-select radio group.',
  category: 'field',
  defaults: {
    label: 'Choose one',
    required: false,
    width: 'full',
    name: '',
    options: [
      { label: 'Option 1', value: 'option-1' },
      { label: 'Option 2', value: 'option-2' },
    ],
    marginBottom: 16,
  },
  props: [...LABEL_PROPS, ...FIELD_STYLE_PROPS],
};

export const FIELD_CONSENT_SCHEMA: BlockSchema = {
  type: 'field_consent',
  label: 'Consent',
  icon: 'shield-check',
  description: 'Single checkbox for ToS / privacy / marketing opt-in.',
  category: 'field',
  defaults: {
    label: 'I agree to receive marketing communications.',
    required: true,
    width: 'full',
    name: 'consent',
    marginBottom: 16,
    labelColor: '#3a3a3a',
    labelFontSize: 13,
    labelFontWeight: 400,
  },
  props: [
    { key: 'label', label: 'Consent Text', type: 'textarea', group: 'content' },
    { key: 'required', label: 'Required', type: 'toggle', default: true, group: 'content' },
    { key: 'name', label: 'Field Name', type: 'text', default: 'consent', group: 'advanced' },
    { key: 'labelColor', label: 'Text Color', type: 'color', default: '#3a3a3a', half: true, group: 'label-style' },
    { key: 'labelFontSize', label: 'Font Size', type: 'number', default: 13, half: true, group: 'label-style' },
    { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 16, group: 'spacing' },
  ],
};

export const FIELD_HIDDEN_SCHEMA: BlockSchema = {
  type: 'field_hidden',
  label: 'Hidden Field',
  icon: 'eye-slash',
  description: 'Hidden value passed through with the submission (e.g. source, campaign id).',
  category: 'field',
  defaults: { name: '', value: '' },
  props: [
    { key: 'name', label: 'Field Name', type: 'text', group: 'content' },
    { key: 'value', label: 'Value', type: 'text', group: 'content' },
  ],
};

// ── CTA ──

export const SUBMIT_BUTTON_SCHEMA: BlockSchema = {
  type: 'submit_button',
  label: 'Submit Button',
  icon: 'cursor-arrow',
  description: 'Form submit button. One per form.',
  category: 'cta',
  defaults: {
    text: 'Submit',
    bgColor: '#1a1a1a',
    textColor: '#ffffff',
    paddingX: 28,
    paddingY: 14,
    borderRadius: 6,
    align: 'left',
    fullWidth: false,
    fontSize: 15,
    fontWeight: 600,
  },
  props: [
    { key: 'text', label: 'Button Text', type: 'text', group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'layout' },
    { key: 'fullWidth', label: 'Full Width', type: 'toggle', default: false, half: true, group: 'layout' },
    { key: 'bgColor', label: 'Background', type: 'color', default: '#1a1a1a', half: true, group: 'style' },
    { key: 'textColor', label: 'Text Color', type: 'color', default: '#ffffff', half: true, group: 'style' },
    { key: 'borderRadius', label: 'Radius', type: 'number', default: 6, half: true, group: 'style' },
    { key: 'borderWidth', label: 'Border Width', type: 'number', default: 0, half: true, group: 'style' },
    { key: 'borderColor', label: 'Border Color', type: 'color', group: 'style' },
    { key: 'paddingY', label: 'Padding Y', type: 'number', default: 14, half: true, group: 'spacing' },
    { key: 'paddingX', label: 'Padding X', type: 'number', default: 28, half: true, group: 'spacing' },
    { key: 'fontSize', label: 'Font Size', type: 'number', default: 15, half: true, group: 'typography' },
    { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 600, half: true, group: 'typography' },
    { key: 'textTransform', label: 'Transform', type: 'select', options: TEXT_TRANSFORM_OPTIONS, default: 'none', group: 'typography' },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'text', default: 'normal', group: 'typography' },
  ],
};

export const BLOCK_SCHEMAS: Record<FormBlockType, BlockSchema> = {
  section: SECTION_SCHEMA,
  columns: COLUMNS_SCHEMA,
  heading: HEADING_SCHEMA,
  text: TEXT_SCHEMA,
  image: IMAGE_SCHEMA,
  divider: DIVIDER_SCHEMA,
  spacer: SPACER_SCHEMA,
  field_text: FIELD_TEXT_SCHEMA,
  field_email: FIELD_EMAIL_SCHEMA,
  field_phone: FIELD_PHONE_SCHEMA,
  field_textarea: FIELD_TEXTAREA_SCHEMA,
  field_select: FIELD_SELECT_SCHEMA,
  field_checkbox: FIELD_CHECKBOX_SCHEMA,
  field_radio: FIELD_RADIO_SCHEMA,
  field_consent: FIELD_CONSENT_SCHEMA,
  field_hidden: FIELD_HIDDEN_SCHEMA,
  submit_button: SUBMIT_BUTTON_SCHEMA,
};

// Order matters — palette renders in this order, grouped by category.
export const ALL_BLOCK_SCHEMAS: BlockSchema[] = [
  // Fields first — the primary purpose of a form
  FIELD_TEXT_SCHEMA,
  FIELD_EMAIL_SCHEMA,
  FIELD_PHONE_SCHEMA,
  FIELD_TEXTAREA_SCHEMA,
  FIELD_SELECT_SCHEMA,
  FIELD_CHECKBOX_SCHEMA,
  FIELD_RADIO_SCHEMA,
  FIELD_CONSENT_SCHEMA,
  FIELD_HIDDEN_SCHEMA,
  // CTA
  SUBMIT_BUTTON_SCHEMA,
  // Layout
  HEADING_SCHEMA,
  TEXT_SCHEMA,
  IMAGE_SCHEMA,
  SECTION_SCHEMA,
  COLUMNS_SCHEMA,
  DIVIDER_SCHEMA,
  SPACER_SCHEMA,
];

export function getBlockSchema(type: FormBlockType): BlockSchema | undefined {
  return BLOCK_SCHEMAS[type];
}

export function getDefaultProps(type: FormBlockType): Record<string, unknown> {
  return { ...(BLOCK_SCHEMAS[type]?.defaults ?? {}) };
}

// ── Form metadata validators ──

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 80 && SLUG_REGEX.test(slug);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
