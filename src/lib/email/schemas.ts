/**
 * Component schemas for the visual editor.
 * Each schema declares which props are editable, their input types, defaults, and grouping.
 *
 * Format follows the existing PropSchema shape from src/lib/component-schemas.ts so the
 * editor sidebar can render these without changes.
 */

import type { BlockType } from './types';

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
}

export interface BlockSchema {
  type: BlockType;
  label: string;
  icon: string;
  description: string;
  /** Default props for a freshly-inserted block */
  defaults: Record<string, unknown>;
  props: PropSchema[];
  /** Whether the block accepts nested children (only `section` for now) */
  acceptsChildren?: boolean;
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

const SOCIAL_VARIANT_OPTIONS = [
  { label: 'Color', value: 'color' },
  { label: 'White', value: 'mono-light' },
  { label: 'Black', value: 'mono-dark' },
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

// ── Schemas ──

export const SECTION_SCHEMA: BlockSchema = {
  type: 'section',
  label: 'Section',
  icon: 'square-3-stack',
  description: 'Container for grouping blocks with shared background and padding.',
  acceptsChildren: true,
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
  defaults: { text: 'Your message goes here.', color: '#3a3a3a', fontSize: 15, lineHeight: 1.6, align: 'left', marginBottom: 16 },
  props: [
    { key: 'text', label: 'Text', type: 'textarea', group: 'content' },
    { key: 'allowHtml', label: 'Allow HTML', type: 'toggle', default: false, group: 'content', description: 'Permit inline HTML and merge tags inside the text.' },
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

export const BUTTON_SCHEMA: BlockSchema = {
  type: 'button',
  label: 'Button',
  icon: 'cursor-arrow',
  description: 'Call-to-action button.',
  defaults: { text: 'Click here', url: '#', bgColor: '#1a1a1a', textColor: '#ffffff', paddingX: 28, paddingY: 14, borderRadius: 4, align: 'left' },
  props: [
    { key: 'text', label: 'Button Text', type: 'text', group: 'content' },
    { key: 'url', label: 'URL', type: 'url', group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'layout' },
    { key: 'fullWidth', label: 'Full Width', type: 'toggle', default: false, half: true, group: 'layout' },
    { key: 'bgColor', label: 'Background', type: 'color', default: '#1a1a1a', half: true, group: 'style' },
    { key: 'textColor', label: 'Text Color', type: 'color', default: '#ffffff', half: true, group: 'style' },
    { key: 'borderRadius', label: 'Radius', type: 'number', default: 4, half: true, group: 'style' },
    { key: 'borderWidth', label: 'Border Width', type: 'number', default: 0, half: true, group: 'style' },
    { key: 'borderColor', label: 'Border Color', type: 'color', group: 'style' },
    { key: 'paddingY', label: 'Padding Y', type: 'number', default: 14, half: true, group: 'spacing' },
    { key: 'paddingX', label: 'Padding X', type: 'number', default: 28, half: true, group: 'spacing' },
    { key: 'fontSize', label: 'Font Size', type: 'number', default: 14, half: true, group: 'typography' },
    { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 600, half: true, group: 'typography' },
    { key: 'textTransform', label: 'Transform', type: 'select', options: TEXT_TRANSFORM_OPTIONS, default: 'none', group: 'typography' },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'text', default: 'normal', group: 'typography' },
  ],
};

export const SPACER_SCHEMA: BlockSchema = {
  type: 'spacer',
  label: 'Spacer',
  icon: 'arrows-up-down',
  description: 'Vertical empty space between blocks.',
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

export const LOGO_SCHEMA: BlockSchema = {
  type: 'logo',
  label: 'Logo',
  icon: 'building-storefront',
  description: 'Logo image, sized for header use.',
  defaults: { width: 140, align: 'center' },
  props: [
    { key: 'src', label: 'Logo', type: 'image', group: 'content' },
    { key: 'alt', label: 'Alt Text', type: 'text', group: 'content' },
    { key: 'linkUrl', label: 'Link URL', type: 'url', group: 'content' },
    { key: 'width', label: 'Width (px)', type: 'number', default: 140, half: true, group: 'layout' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', half: true, group: 'layout' },
  ],
};

export const SOCIAL_SCHEMA: BlockSchema = {
  type: 'social',
  label: 'Social Links',
  icon: 'share',
  description: 'Row of social media icons.',
  defaults: {
    links: [
      { platform: 'facebook', url: '' },
      { platform: 'instagram', url: '' },
      { platform: 'youtube', url: '' },
    ],
    iconSize: 28,
    spacing: 8,
    align: 'center',
    variant: 'color',
  },
  props: [
    { key: 'variant', label: 'Style', type: 'select', options: SOCIAL_VARIANT_OPTIONS, default: 'color', group: 'style' },
    { key: 'iconSize', label: 'Icon Size', type: 'number', default: 28, half: true, group: 'layout' },
    { key: 'spacing', label: 'Spacing', type: 'number', default: 8, half: true, group: 'layout' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
    // Note: `links` is edited via a custom repeater UI in the editor, not a single field.
  ],
};

export const BLOCK_SCHEMAS: Record<BlockType, BlockSchema> = {
  section: SECTION_SCHEMA,
  columns: COLUMNS_SCHEMA,
  heading: HEADING_SCHEMA,
  text: TEXT_SCHEMA,
  image: IMAGE_SCHEMA,
  button: BUTTON_SCHEMA,
  spacer: SPACER_SCHEMA,
  divider: DIVIDER_SCHEMA,
  logo: LOGO_SCHEMA,
  social: SOCIAL_SCHEMA,
};

export const ALL_BLOCK_SCHEMAS: BlockSchema[] = [
  LOGO_SCHEMA,
  HEADING_SCHEMA,
  TEXT_SCHEMA,
  IMAGE_SCHEMA,
  BUTTON_SCHEMA,
  SECTION_SCHEMA,
  COLUMNS_SCHEMA,
  DIVIDER_SCHEMA,
  SPACER_SCHEMA,
  SOCIAL_SCHEMA,
];

export function getBlockSchema(type: BlockType): BlockSchema | undefined {
  return BLOCK_SCHEMAS[type];
}

export function getDefaultProps(type: BlockType): Record<string, unknown> {
  return { ...(BLOCK_SCHEMAS[type]?.defaults ?? {}) };
}
