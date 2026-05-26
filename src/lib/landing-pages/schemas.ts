/**
 * Block schemas for the landing-page visual editor.
 *
 * Same shape as src/lib/forms/schemas.ts so the (copied) editor shell
 * can render these block configs unchanged. Each block has:
 *   - defaults: the prop bag used when a new instance is inserted
 *   - props:    schema entries that drive the right-hand property panel
 *   - category: palette grouping ('layout' | 'content' | 'marketing' | 'embed')
 *
 * The real React components for each block live under
 * src/lib/landing-pages/components/ and are wired up in PR2.
 */

import type { LandingPageBlockType } from './types';

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
  | 'unit'
  | 'form-picker' // LP-specific: dropdown of the account's Forms
  | 'item-array'; // ordered list of objects (FeatureGrid items, FAQ items, etc.)

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
  slider?: boolean;
  sliderMin?: number;
  sliderMax?: number;
  /** For `item-array` props: schema for each item's fields. */
  itemSchema?: PropSchema[];
  /** For `item-array` props: defaults applied when "Add item" is
   *  clicked. */
  itemDefault?: Record<string, unknown>;
  /** For `item-array` props: which item field to use as the
   *  collapsed-item summary label. Defaults to 'heading' or
   *  'question'. */
  itemLabelKey?: string;
  /** For `item-array` props: noun used in the "Add <noun>" button. */
  itemNoun?: string;
}

export interface BlockSchema {
  type: LandingPageBlockType;
  label: string;
  icon: string;
  description: string;
  defaults: Record<string, unknown>;
  props: PropSchema[];
  acceptsChildren?: boolean;
  category: 'layout' | 'content' | 'marketing' | 'embed';
}

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

const HEADING_LEVEL_OPTIONS = [
  { label: 'H1', value: 1 },
  { label: 'H2', value: 2 },
  { label: 'H3', value: 3 },
  { label: 'H4', value: 4 },
];

const FONT_WEIGHT_OPTIONS = [
  { label: '400 (Normal)', value: 400 },
  { label: '500 (Medium)', value: 500 },
  { label: '600 (Semibold)', value: 600 },
  { label: '700 (Bold)', value: 700 },
  { label: '800 (Extra Bold)', value: 800 },
];

const BUTTON_STYLE_OPTIONS = [
  { label: 'Solid', value: 'solid' },
  { label: 'Outline', value: 'outline' },
  { label: 'Ghost', value: 'ghost' },
];

const HERO_LAYOUT_OPTIONS = [
  { label: 'Centered', value: 'centered' },
  { label: 'Left aligned', value: 'left' },
  { label: 'Split (image right)', value: 'split-right' },
  { label: 'Split (image left)', value: 'split-left' },
];

const FEATURE_LAYOUT_OPTIONS = [
  { label: 'Icon top', value: 'icon-top' },
  { label: 'Icon left', value: 'icon-left' },
];

// ── Layout primitives ──────────────────────────────────────────────

export const SECTION_SCHEMA: BlockSchema = {
  type: 'section',
  label: 'Section',
  icon: 'rectangle-stack',
  description: 'Horizontal container with background + padding. Drop other blocks inside.',
  category: 'layout',
  acceptsChildren: true,
  defaults: {
    backgroundColor: 'transparent',
    paddingTop: 64,
    paddingBottom: 64,
    paddingLeft: 24,
    paddingRight: 24,
    maxWidth: 1140,
    align: 'center',
  },
  props: [
    { key: 'backgroundColor', label: 'Background', type: 'color', default: 'transparent', group: 'style' },
    { key: 'paddingTop', label: 'Padding Top', type: 'number', default: 64, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 200 },
    { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: 64, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 200 },
    { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: 24, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 120 },
    { key: 'paddingRight', label: 'Padding Right', type: 'number', default: 24, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 120 },
    { key: 'maxWidth', label: 'Inner Max Width', type: 'number', default: 1140, group: 'layout', slider: true, sliderMin: 480, sliderMax: 1440 },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
  ],
};

export const COLUMNS_SCHEMA: BlockSchema = {
  type: 'columns',
  label: 'Columns',
  icon: 'view-columns',
  description: 'Two-or-more column row. Each column accepts any block.',
  category: 'layout',
  acceptsChildren: true,
  defaults: {
    columnCount: 2,
    gap: 24,
    verticalAlign: 'top',
  },
  props: [
    { key: 'columnCount', label: 'Columns', type: 'number', default: 2, min: 2, max: 4, group: 'layout' },
    { key: 'gap', label: 'Gap', type: 'number', default: 24, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 80 },
    {
      key: 'verticalAlign', label: 'Vertical Align', type: 'select', default: 'top', group: 'layout',
      options: [{ label: 'Top', value: 'top' }, { label: 'Middle', value: 'middle' }, { label: 'Bottom', value: 'bottom' }],
    },
  ],
};

export const SPACER_SCHEMA: BlockSchema = {
  type: 'spacer',
  label: 'Spacer',
  icon: 'arrows-up-down',
  description: 'Empty vertical space.',
  category: 'layout',
  defaults: { height: 48 },
  props: [
    { key: 'height', label: 'Height', type: 'number', default: 48, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 240 },
  ],
};

export const DIVIDER_SCHEMA: BlockSchema = {
  type: 'divider',
  label: 'Divider',
  icon: 'minus',
  description: 'Horizontal rule.',
  category: 'layout',
  defaults: { color: '#e5e7eb', thickness: 1, marginY: 24 },
  props: [
    { key: 'color', label: 'Color', type: 'color', default: '#e5e7eb', group: 'style' },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 1, min: 1, max: 8, group: 'style' },
    { key: 'marginY', label: 'Vertical Margin', type: 'number', default: 24, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 96 },
  ],
};

// ── Content primitives ─────────────────────────────────────────────

export const HEADING_SCHEMA: BlockSchema = {
  type: 'heading',
  label: 'Heading',
  icon: 'h1',
  description: 'Section heading. H1-H4 with full typography controls.',
  category: 'content',
  defaults: { text: 'A great headline', level: 2, align: 'left', fontWeight: 700, color: '' },
  props: [
    { key: 'text', label: 'Text', type: 'text', default: 'A great headline', group: 'content' },
    { key: 'level', label: 'Level', type: 'select', options: HEADING_LEVEL_OPTIONS, default: 2, half: true, group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'content' },
    { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: 700, half: true, group: 'style' },
    { key: 'color', label: 'Color', type: 'color', default: '', half: true, group: 'style' },
  ],
};

export const TEXT_SCHEMA: BlockSchema = {
  type: 'text',
  label: 'Text',
  icon: 'bars-3-bottom-left',
  description: 'Paragraph body copy.',
  category: 'content',
  defaults: { text: 'Add a sentence or two of supporting copy here.', align: 'left', fontSize: 16, lineHeight: 1.6, color: '' },
  props: [
    { key: 'text', label: 'Text', type: 'textarea', default: 'Add a sentence or two of supporting copy here.', group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'content' },
    { key: 'fontSize', label: 'Font Size', type: 'number', default: 16, half: true, group: 'style', slider: true, sliderMin: 12, sliderMax: 24 },
    { key: 'lineHeight', label: 'Line Height', type: 'number', default: 1.6, group: 'style' },
    { key: 'color', label: 'Color', type: 'color', default: '', group: 'style' },
  ],
};

export const IMAGE_SCHEMA: BlockSchema = {
  type: 'image',
  label: 'Image',
  icon: 'photo',
  description: 'Single image with optional link and caption.',
  category: 'content',
  defaults: {
    src: '',
    alt: '',
    width: 800,
    align: 'center',
    borderRadius: 8,
    href: '',
  },
  props: [
    { key: 'src', label: 'Image URL', type: 'image', default: '', group: 'content' },
    { key: 'alt', label: 'Alt Text', type: 'text', default: '', group: 'content' },
    { key: 'width', label: 'Width', type: 'number', default: 800, group: 'layout', slider: true, sliderMin: 100, sliderMax: 1400 },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', half: true, group: 'layout' },
    { key: 'borderRadius', label: 'Radius', type: 'number', default: 8, half: true, group: 'style' },
    { key: 'href', label: 'Link URL', type: 'url', default: '', group: 'behavior' },
  ],
};

// ── Marketing blocks ───────────────────────────────────────────────

export const HERO_SCHEMA: BlockSchema = {
  type: 'hero',
  label: 'Hero',
  icon: 'sparkles',
  description: 'Big headline, sub-copy, CTA button. Optional split with image or background.',
  category: 'marketing',
  defaults: {
    layout: 'centered',
    eyebrow: '',
    heading: 'Your big promise, plainly stated.',
    subheading: 'One or two sentences that explain what this page is about and why a visitor should care.',
    primaryCtaLabel: 'Get started',
    primaryCtaHref: '#',
    secondaryCtaLabel: '',
    secondaryCtaHref: '',
    imageSrc: '',
    backgroundColor: '',
    textColor: '',
    minHeight: 480,
  },
  props: [
    { key: 'layout', label: 'Layout', type: 'select', options: HERO_LAYOUT_OPTIONS, default: 'centered', group: 'layout' },
    { key: 'eyebrow', label: 'Eyebrow', type: 'text', default: '', group: 'content', placeholder: 'OPTIONAL TAG' },
    { key: 'heading', label: 'Heading', type: 'text', default: 'Your big promise, plainly stated.', group: 'content' },
    { key: 'subheading', label: 'Subheading', type: 'textarea', default: 'One or two sentences that explain what this page is about and why a visitor should care.', group: 'content' },
    { key: 'primaryCtaLabel', label: 'Primary CTA Label', type: 'text', default: 'Get started', half: true, group: 'cta' },
    { key: 'primaryCtaHref', label: 'Primary CTA URL', type: 'url', default: '#', half: true, group: 'cta' },
    { key: 'secondaryCtaLabel', label: 'Secondary CTA Label', type: 'text', default: '', half: true, group: 'cta' },
    { key: 'secondaryCtaHref', label: 'Secondary CTA URL', type: 'url', default: '', half: true, group: 'cta' },
    { key: 'imageSrc', label: 'Image (split layouts)', type: 'image', default: '', group: 'media' },
    { key: 'backgroundColor', label: 'Background', type: 'color', default: '', half: true, group: 'style' },
    { key: 'textColor', label: 'Text Color', type: 'color', default: '', half: true, group: 'style' },
    { key: 'minHeight', label: 'Min Height', type: 'number', default: 480, group: 'layout', slider: true, sliderMin: 240, sliderMax: 800 },
  ],
};

export const FEATURE_ROW_SCHEMA: BlockSchema = {
  type: 'feature_row',
  label: 'Feature Row',
  icon: 'square-3-stack-3d',
  description: 'Single feature: icon/image + heading + body. Pair with Columns for multi-feature layouts.',
  category: 'marketing',
  defaults: {
    layout: 'icon-top',
    iconSrc: '',
    heading: 'A feature worth highlighting',
    body: 'Explain the benefit in one or two sentences.',
    align: 'left',
  },
  props: [
    { key: 'layout', label: 'Layout', type: 'select', options: FEATURE_LAYOUT_OPTIONS, default: 'icon-top', group: 'layout' },
    { key: 'iconSrc', label: 'Icon / Image URL', type: 'image', default: '', group: 'media' },
    { key: 'heading', label: 'Heading', type: 'text', default: 'A feature worth highlighting', group: 'content' },
    { key: 'body', label: 'Body', type: 'textarea', default: 'Explain the benefit in one or two sentences.', group: 'content' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'content' },
  ],
};

export const FEATURE_GRID_SCHEMA: BlockSchema = {
  type: 'feature_grid',
  label: 'Feature Grid',
  icon: 'squares-2x2',
  description: 'Pre-built 3-column feature grid. Add or remove cells via the editor.',
  category: 'marketing',
  defaults: {
    columns: 3,
    heading: 'Everything you need',
    subheading: '',
    items: [
      { heading: 'Fast', body: 'Built for speed and clarity.', iconSrc: '' },
      { heading: 'Flexible', body: 'Drop into any page in seconds.', iconSrc: '' },
      { heading: 'Trusted', body: 'Used by teams who care about polish.', iconSrc: '' },
    ],
  },
  props: [
    { key: 'columns', label: 'Columns', type: 'number', default: 3, min: 2, max: 4, group: 'layout' },
    { key: 'heading', label: 'Heading', type: 'text', default: 'Everything you need', group: 'content' },
    { key: 'subheading', label: 'Subheading', type: 'textarea', default: '', group: 'content' },
    {
      key: 'items',
      label: 'Features',
      type: 'item-array',
      group: 'items',
      itemNoun: 'feature',
      itemLabelKey: 'heading',
      itemDefault: { heading: 'New feature', body: 'Describe it here.', iconSrc: '' },
      itemSchema: [
        { key: 'heading', label: 'Heading', type: 'text', default: '' },
        { key: 'body', label: 'Body', type: 'textarea', default: '' },
        { key: 'iconSrc', label: 'Icon / Image URL', type: 'image', default: '' },
      ],
    },
  ],
};

export const CTA_SCHEMA: BlockSchema = {
  type: 'cta',
  label: 'CTA',
  icon: 'megaphone',
  description: 'Call-to-action band — heading, supporting text, single button.',
  category: 'marketing',
  defaults: {
    heading: 'Ready to get started?',
    body: 'Sign up in under a minute. No credit card required.',
    ctaLabel: 'Get started',
    ctaHref: '#',
    buttonStyle: 'solid',
    align: 'center',
    backgroundColor: '',
    textColor: '',
  },
  props: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Ready to get started?', group: 'content' },
    { key: 'body', label: 'Body', type: 'textarea', default: 'Sign up in under a minute. No credit card required.', group: 'content' },
    { key: 'ctaLabel', label: 'Button Label', type: 'text', default: 'Get started', half: true, group: 'cta' },
    { key: 'ctaHref', label: 'Button URL', type: 'url', default: '#', half: true, group: 'cta' },
    { key: 'buttonStyle', label: 'Button Style', type: 'select', options: BUTTON_STYLE_OPTIONS, default: 'solid', half: true, group: 'style' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', half: true, group: 'style' },
    { key: 'backgroundColor', label: 'Background', type: 'color', default: '', half: true, group: 'style' },
    { key: 'textColor', label: 'Text Color', type: 'color', default: '', half: true, group: 'style' },
  ],
};

export const TESTIMONIAL_SCHEMA: BlockSchema = {
  type: 'testimonial',
  label: 'Testimonial',
  icon: 'chat-bubble-left-right',
  description: 'Customer quote with name, role, and optional avatar.',
  category: 'marketing',
  defaults: {
    quote: '"This is exactly what we were looking for."',
    authorName: 'Jane Doe',
    authorRole: 'Marketing Director, Acme Co',
    avatarSrc: '',
    align: 'center',
  },
  props: [
    { key: 'quote', label: 'Quote', type: 'textarea', default: '"This is exactly what we were looking for."', group: 'content' },
    { key: 'authorName', label: 'Author Name', type: 'text', default: 'Jane Doe', half: true, group: 'content' },
    { key: 'authorRole', label: 'Author Role', type: 'text', default: 'Marketing Director, Acme Co', half: true, group: 'content' },
    { key: 'avatarSrc', label: 'Avatar', type: 'image', default: '', group: 'media' },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'style' },
  ],
};

export const FAQ_SCHEMA: BlockSchema = {
  type: 'faq',
  label: 'FAQ',
  icon: 'question-mark-circle',
  description: 'Accordion of frequently-asked questions.',
  category: 'marketing',
  defaults: {
    heading: 'Frequently asked questions',
    items: [
      { question: 'What does this do?', answer: 'It does the thing.' },
      { question: 'How much does it cost?', answer: 'Reasonable amounts.' },
      { question: 'How do I get started?', answer: 'Click the button at the top of the page.' },
    ],
  },
  props: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Frequently asked questions', group: 'content' },
    {
      key: 'items',
      label: 'Questions',
      type: 'item-array',
      group: 'items',
      itemNoun: 'question',
      itemLabelKey: 'question',
      itemDefault: { question: 'New question?', answer: 'Type the answer here.' },
      itemSchema: [
        { key: 'question', label: 'Question', type: 'text', default: '' },
        { key: 'answer', label: 'Answer', type: 'textarea', default: '' },
      ],
    },
  ],
};

export const VIDEO_SCHEMA: BlockSchema = {
  type: 'video',
  label: 'Video',
  icon: 'play-circle',
  description: 'YouTube or Vimeo embed.',
  category: 'marketing',
  defaults: {
    url: '',
    aspectRatio: '16:9',
    autoplay: false,
  },
  props: [
    { key: 'url', label: 'Video URL', type: 'url', default: '', group: 'content', placeholder: 'https://youtube.com/watch?v=…' },
    {
      key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', default: '16:9', group: 'layout',
      options: [
        { label: '16:9', value: '16:9' },
        { label: '4:3', value: '4:3' },
        { label: '1:1', value: '1:1' },
        { label: '9:16 (portrait)', value: '9:16' },
      ],
    },
    { key: 'autoplay', label: 'Autoplay (muted)', type: 'toggle', default: false, group: 'behavior' },
  ],
};

export const LOGO_STRIP_SCHEMA: BlockSchema = {
  type: 'logo_strip',
  label: 'Logo Strip',
  icon: 'building-storefront',
  description: 'Horizontal row of customer/partner logos.',
  category: 'marketing',
  defaults: {
    heading: 'Trusted by teams everywhere',
    logos: [] as { src: string; alt: string; href?: string }[],
    grayscale: true,
  },
  props: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Trusted by teams everywhere', group: 'content' },
    { key: 'grayscale', label: 'Grayscale', type: 'toggle', default: true, group: 'style' },
    {
      key: 'logos',
      label: 'Logos',
      type: 'item-array',
      group: 'items',
      itemNoun: 'logo',
      itemLabelKey: 'alt',
      itemDefault: { src: '', alt: 'New logo', href: '' },
      itemSchema: [
        { key: 'src', label: 'Logo URL', type: 'image', default: '' },
        { key: 'alt', label: 'Alt text', type: 'text', default: '' },
        { key: 'href', label: 'Link URL (optional)', type: 'url', default: '' },
      ],
    },
  ],
};

// ── Embed blocks ───────────────────────────────────────────────────

export const EMBEDDED_FORM_SCHEMA: BlockSchema = {
  type: 'embedded_form',
  label: 'Embedded Form',
  icon: 'document-text',
  description: 'Render one of your forms inline. Submissions go to the form, not the LP.',
  category: 'embed',
  defaults: {
    formId: '',
    maxWidth: 640,
    align: 'center',
  },
  props: [
    { key: 'formId', label: 'Form', type: 'form-picker', default: '', group: 'content' },
    { key: 'maxWidth', label: 'Max Width', type: 'number', default: 640, group: 'layout', slider: true, sliderMin: 320, sliderMax: 1140 },
    { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
  ],
};

export const HTML_SCHEMA: BlockSchema = {
  type: 'html',
  label: 'Custom HTML',
  icon: 'code-bracket',
  description: 'Drop in raw HTML. Sanitized at render time to strip dangerous tags.',
  category: 'embed',
  defaults: { html: '' },
  props: [
    { key: 'html', label: 'HTML', type: 'textarea', default: '', group: 'content', placeholder: '<div>...</div>' },
  ],
};

// ── Universal spacing props ────────────────────────────────────────
//
// Every block gets paddingTop/Right/Bottom/Left + marginTop/Right/
// Bottom/Left from this list. They're applied at the renderer/canvas
// wrapper layer (see RenderedBlock in render.tsx and EditableBlock in
// Canvas.tsx) so individual block components don't need to read them
// — the wrapper takes care of layout-level spacing for every block
// uniformly.
//
// Section is the one exception: it already declares its own
// paddingTop/Right/Bottom/Left to wrap its children with the
// section's background color visible in the padded area, so we
// dedupe by `key` when merging.
const SPACING_PROPS: PropSchema[] = [
  { key: 'marginTop', label: 'Margin Top', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'marginRight', label: 'Margin Right', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'marginLeft', label: 'Margin Left', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'paddingTop', label: 'Padding Top', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'paddingRight', label: 'Padding Right', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
  { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: 0, half: true, group: 'spacing', slider: true, sliderMin: 0, sliderMax: 160 },
];

function withSpacing(schema: BlockSchema): BlockSchema {
  const existingKeys = new Set(schema.props.map((p) => p.key));
  const additions = SPACING_PROPS.filter((p) => !existingKeys.has(p.key));
  if (additions.length === 0) return schema;
  return { ...schema, props: [...schema.props, ...additions] };
}

// ── Registry ───────────────────────────────────────────────────────

export const ALL_BLOCK_SCHEMAS: BlockSchema[] = [
  SECTION_SCHEMA,
  COLUMNS_SCHEMA,
  SPACER_SCHEMA,
  DIVIDER_SCHEMA,
  HEADING_SCHEMA,
  TEXT_SCHEMA,
  IMAGE_SCHEMA,
  HERO_SCHEMA,
  FEATURE_ROW_SCHEMA,
  FEATURE_GRID_SCHEMA,
  CTA_SCHEMA,
  TESTIMONIAL_SCHEMA,
  FAQ_SCHEMA,
  VIDEO_SCHEMA,
  LOGO_STRIP_SCHEMA,
  EMBEDDED_FORM_SCHEMA,
  HTML_SCHEMA,
].map(withSpacing);

export const BLOCK_SCHEMA_BY_TYPE: Record<LandingPageBlockType, BlockSchema> = ALL_BLOCK_SCHEMAS.reduce(
  (acc, schema) => {
    acc[schema.type] = schema;
    return acc;
  },
  {} as Record<LandingPageBlockType, BlockSchema>,
);

export function getDefaultProps(type: LandingPageBlockType): Record<string, unknown> {
  const schema = BLOCK_SCHEMA_BY_TYPE[type];
  return schema ? { ...schema.defaults } : {};
}

// ── Slug helpers (parity with forms) ───────────────────────────────

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug);
}
