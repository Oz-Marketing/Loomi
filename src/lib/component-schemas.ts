/**
 * Visual editor component schemas (v2 — react-email backed).
 *
 * Replaces the legacy Maizzle-based schemas. Same export shape so the editor
 * imports continue to resolve; what changed is the catalog of components and
 * their prop fields.
 *
 * Each schema defines props that show up in the right-hand sidebar of the
 * editor. The renderer (src/lib/email/render.ts) consumes the same props
 * to produce email-safe HTML via @react-email/render.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'url'
  | 'image'
  | 'icon'
  | 'select'
  | 'toggle'
  | 'number'
  | 'padding'
  | 'radius'
  | 'unit'
  | 'range';

export const IMAGE_PLACEHOLDER =
  'https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image placeholder.png';

export interface PropSchema {
  key: string;
  label: string;
  type: FieldType;
  default?: string;
  options?: { label: string; value: string }[];
  group?: string;
  required?: boolean;
  description?: string;
  half?: boolean;
  repeatableGroup?: string;
  placeholder?: string;
  conditionalOn?: string;
  buttonSet?: 'primary' | 'secondary';
  responsive?: boolean;
  separator?: boolean;
  sideScoped?: boolean;
  min?: number;
  max?: number;
  /** Show a range slider above the number input (Elementor-style) */
  slider?: boolean;
  /** When `slider` is true, override the slider track range (default 0–200) */
  sliderMax?: number;
}

export interface RepeatableGroup {
  key: string;
  label: string;
  maxItems: number;
  propsPerItem: string[];
}

export interface ComponentSchema {
  name: string;
  label: string;
  icon: string;
  props: PropSchema[];
  repeatableGroups?: RepeatableGroup[];
}

// ── Shared option lists ──

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

const FONT_WEIGHT_OPTIONS = [
  { label: '400 Normal', value: '400' },
  { label: '500 Medium', value: '500' },
  { label: '600 Semibold', value: '600' },
  { label: '700 Bold', value: '700' },
  { label: '800 Extra Bold', value: '800' },
];

const TEXT_TRANSFORM_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Uppercase', value: 'uppercase' },
  { label: 'Lowercase', value: 'lowercase' },
  { label: 'Capitalize', value: 'capitalize' },
];

const HEADING_LEVEL_OPTIONS = [
  { label: 'H1', value: '1' },
  { label: 'H2', value: '2' },
  { label: 'H3', value: '3' },
  { label: 'H4', value: '4' },
  { label: 'H5', value: '5' },
  { label: 'H6', value: '6' },
];

const BORDER_STYLE_OPTIONS = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
  { label: 'Double', value: 'double' },
];

const BG_SIZE_OPTIONS = [
  { label: 'Cover', value: 'cover' },
  { label: 'Contain', value: 'contain' },
  { label: 'Auto', value: 'auto' },
];

const BG_POSITION_OPTIONS = [
  { label: 'Top', value: 'center top' },
  { label: 'Center', value: 'center center' },
  { label: 'Bottom', value: 'center bottom' },
  { label: 'Left', value: 'left center' },
  { label: 'Right', value: 'right center' },
  { label: 'Top Left', value: 'left top' },
  { label: 'Top Right', value: 'right top' },
  { label: 'Bottom Left', value: 'left bottom' },
  { label: 'Bottom Right', value: 'right bottom' },
];

const BG_REPEAT_OPTIONS = [
  { label: 'No Repeat', value: 'no-repeat' },
  { label: 'Repeat', value: 'repeat' },
  { label: 'Repeat X', value: 'repeat-x' },
  { label: 'Repeat Y', value: 'repeat-y' },
];

const SOCIAL_VARIANT_OPTIONS = [
  { label: 'Color', value: 'color' },
  { label: 'White', value: 'mono-light' },
  { label: 'Black', value: 'mono-dark' },
];

// Email-safe font stacks (each value is the full CSS font-family stack so it
// degrades gracefully across email clients that don't have the primary font)
const FONT_FAMILY_OPTIONS = [
  { label: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Lucida Sans', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Palatino', value: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { label: 'Garamond', value: 'Garamond, "Apple Garamond", serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", "Courier New", monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
];

const SOCIAL_PLATFORM_OPTIONS = [
  { label: 'Facebook', value: 'facebook' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter / X', value: 'twitter' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'LinkedIn', value: 'linkedin' },
  { label: 'TikTok', value: 'tiktok' },
];

// ── Component schemas ──

export const componentSchemas: Record<string, ComponentSchema> = {
  section: {
    name: 'section',
    label: 'Section',
    icon: 'RectangleGroupIcon',
    props: [
      // Background
      { key: 'bgColor', label: 'Background Color', type: 'color', group: 'background' },
      { key: 'bgImage', label: 'Background Image', type: 'image', group: 'background' },
      { key: 'bgSize', label: 'Image Size', type: 'select', options: BG_SIZE_OPTIONS, default: 'cover', group: 'background' },
      { key: 'bgPosition', label: 'Image Position', type: 'select', options: BG_POSITION_OPTIONS, default: 'center center', group: 'background' },
      { key: 'bgRepeat', label: 'Image Repeat', type: 'select', options: BG_REPEAT_OPTIONS, default: 'no-repeat', group: 'background' },
      // Border
      { key: 'borderWidth', label: 'Border Width', type: 'number', default: '0', group: 'style', slider: true, sliderMax: 20 },
      { key: 'borderStyle', label: 'Border Style', type: 'select', options: BORDER_STYLE_OPTIONS, default: 'solid', group: 'style' },
      { key: 'borderColor', label: 'Border Color', type: 'color', group: 'style' },
      // Border radius (CornerBox auto-detected)
      { key: 'borderRadiusTopLeft', label: 'Top Left', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusTopRight', label: 'Top Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomRight', label: 'Bottom Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomLeft', label: 'Bottom Left', type: 'number', default: '0', group: 'style' },
      // Layout
      { key: 'align', label: 'Alignment', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'layout' },
      { key: 'gap', label: 'Gap (between blocks)', type: 'unit', default: '0', group: 'layout', slider: true, sliderMax: 80 },
      { key: 'minHeight', label: 'Min Height', type: 'number', group: 'layout', slider: true, sliderMax: 800 },
      // Padding
      { key: 'paddingTop', label: 'Padding Top', type: 'number', default: '32', group: 'spacing' },
      { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: '32', group: 'spacing' },
      { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: '32', group: 'spacing' },
      { key: 'paddingRight', label: 'Padding Right', type: 'number', default: '32', group: 'spacing' },
    ],
  },

  columns: {
    name: 'columns',
    label: 'Grid',
    icon: 'GridIcon',
    props: [
      // Background
      { key: 'bgColor', label: 'Background Color', type: 'color', group: 'background' },
      { key: 'bgImage', label: 'Background Image', type: 'image', group: 'background' },
      { key: 'bgSize', label: 'Image Size', type: 'select', options: BG_SIZE_OPTIONS, default: 'cover', group: 'background' },
      { key: 'bgPosition', label: 'Image Position', type: 'select', options: BG_POSITION_OPTIONS, default: 'center center', group: 'background' },
      { key: 'bgRepeat', label: 'Image Repeat', type: 'select', options: BG_REPEAT_OPTIONS, default: 'no-repeat', group: 'background' },
      // Border
      { key: 'borderWidth', label: 'Border Width', type: 'number', default: '0', group: 'style', slider: true, sliderMax: 20 },
      { key: 'borderStyle', label: 'Border Style', type: 'select', options: BORDER_STYLE_OPTIONS, default: 'solid', group: 'style' },
      { key: 'borderColor', label: 'Border Color', type: 'color', group: 'style' },
      // Border radius (CornerBox auto-detected)
      { key: 'borderRadiusTopLeft', label: 'Top Left', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusTopRight', label: 'Top Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomRight', label: 'Bottom Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomLeft', label: 'Bottom Left', type: 'number', default: '0', group: 'style' },
      // Layout
      {
        key: 'columnCount',
        label: 'Columns',
        type: 'select',
        options: [
          { label: '2 Columns', value: '2' },
          { label: '3 Columns', value: '3' },
        ],
        default: '2',
        group: 'layout',
      },
      {
        key: 'valign',
        label: 'Vertical Align',
        type: 'select',
        options: [
          { label: 'Top', value: 'top' },
          { label: 'Middle', value: 'middle' },
          { label: 'Bottom', value: 'bottom' },
        ],
        default: 'top',
        group: 'layout',
      },
      { key: 'gap', label: 'Gap Between Columns', type: 'unit', default: '16', group: 'layout', slider: true, sliderMax: 60 },
      { key: 'stackOnMobile', label: 'Stack on Mobile', type: 'toggle', default: 'true', group: 'layout', description: 'Each column becomes full width on small screens' },
      { key: 'minHeight', label: 'Min Height', type: 'number', group: 'layout', slider: true, sliderMax: 800 },
      // Padding
      { key: 'paddingTop', label: 'Padding Top', type: 'number', default: '16', group: 'spacing' },
      { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: '16', group: 'spacing' },
      { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: '16', group: 'spacing' },
      { key: 'paddingRight', label: 'Padding Right', type: 'number', default: '16', group: 'spacing' },
    ],
  },

  heading: {
    name: 'heading',
    label: 'Heading',
    icon: 'HeaderIcon',
    props: [
      { key: 'text', label: 'Text', type: 'textarea', default: 'Your headline here', group: 'content' },
      { key: 'level', label: 'Level', type: 'select', options: HEADING_LEVEL_OPTIONS, default: '1', half: true, group: 'content' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', half: true, group: 'content' },
      { key: 'color', label: 'Color', type: 'color', default: '#1a1a1a', group: 'typography' },
      { key: 'fontSize', label: 'Font Size', type: 'unit', default: '32', group: 'typography', slider: true, sliderMax: 80 },
      { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: '700', half: true, group: 'typography' },
      { key: 'lineHeight', label: 'Line Height', type: 'text', default: '1.2', group: 'typography' },
      { key: 'letterSpacing', label: 'Letter Spacing', type: 'unit', default: '0', group: 'typography' },
      { key: 'textTransform', label: 'Transform', type: 'select', options: TEXT_TRANSFORM_OPTIONS, default: 'none', group: 'typography' },
      { key: 'fontFamily', label: 'Font Family', type: 'select', options: FONT_FAMILY_OPTIONS, group: 'typography' },
      { key: 'marginTop', label: 'Margin Top', type: 'number', default: '0', group: 'spacing' },
      { key: 'marginRight', label: 'Margin Right', type: 'number', default: '0', group: 'spacing' },
      { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: '16', group: 'spacing' },
      { key: 'marginLeft', label: 'Margin Left', type: 'number', default: '0', group: 'spacing' },
    ],
  },

  text: {
    name: 'text',
    label: 'Text',
    icon: 'TextIcon',
    props: [
      { key: 'text', label: 'Text', type: 'textarea', default: 'Your message goes here.', group: 'content' },
      { key: 'allowHtml', label: 'Allow HTML', type: 'toggle', default: 'false', group: 'content', description: 'Permit inline HTML and merge tags inside the text.' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'content' },
      { key: 'color', label: 'Color', type: 'color', default: '#3a3a3a', group: 'typography' },
      { key: 'fontSize', label: 'Font Size', type: 'unit', default: '15', group: 'typography', slider: true, sliderMax: 60 },
      { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: '400', half: true, group: 'typography' },
      { key: 'lineHeight', label: 'Line Height', type: 'text', default: '1.6', group: 'typography' },
      { key: 'letterSpacing', label: 'Letter Spacing', type: 'unit', default: '0', group: 'typography' },
      { key: 'fontFamily', label: 'Font Family', type: 'select', options: FONT_FAMILY_OPTIONS, group: 'typography' },
      { key: 'marginTop', label: 'Margin Top', type: 'number', default: '0', group: 'spacing' },
      { key: 'marginRight', label: 'Margin Right', type: 'number', default: '0', group: 'spacing' },
      { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: '16', group: 'spacing' },
      { key: 'marginLeft', label: 'Margin Left', type: 'number', default: '0', group: 'spacing' },
    ],
  },

  image: {
    name: 'image',
    label: 'Image',
    icon: 'PhotoIcon',
    props: [
      { key: 'src', label: 'Image', type: 'image', group: 'content' },
      { key: 'alt', label: 'Alt Text', type: 'text', group: 'content' },
      { key: 'linkUrl', label: 'Link URL', type: 'url', group: 'content' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
      { key: 'width', label: 'Width (px)', type: 'number', group: 'layout' },
      { key: 'height', label: 'Height (px)', type: 'number', group: 'layout' },
      { key: 'borderRadiusTopLeft', label: 'Top Left', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusTopRight', label: 'Top Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomRight', label: 'Bottom Right', type: 'number', default: '0', group: 'style' },
      { key: 'borderRadiusBottomLeft', label: 'Bottom Left', type: 'number', default: '0', group: 'style' },
    ],
  },

  button: {
    name: 'button',
    label: 'Button',
    icon: 'ButtonIcon',
    props: [
      { key: 'text', label: 'Button Text', type: 'text', default: 'Click here', group: 'content' },
      { key: 'url', label: 'URL', type: 'url', default: '#', group: 'content' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'left', group: 'layout' },
      { key: 'fullWidth', label: 'Full Width', type: 'toggle', default: 'false', group: 'layout' },
      { key: 'bgColor', label: 'Background', type: 'color', default: '#1a1a1a', group: 'style' },
      { key: 'textColor', label: 'Text Color', type: 'color', default: '#ffffff', group: 'style' },
      { key: 'borderWidth', label: 'Border Width', type: 'number', default: '0', group: 'style', slider: true, sliderMax: 20 },
      { key: 'borderColor', label: 'Border Color', type: 'color', group: 'style' },
      // Border radius — 4 corners (auto-rendered as a linked CornerBox in the sidebar)
      { key: 'borderRadiusTopLeft', label: 'Top Left', type: 'number', default: '4', group: 'style' },
      { key: 'borderRadiusTopRight', label: 'Top Right', type: 'number', default: '4', group: 'style' },
      { key: 'borderRadiusBottomRight', label: 'Bottom Right', type: 'number', default: '4', group: 'style' },
      { key: 'borderRadiusBottomLeft', label: 'Bottom Left', type: 'number', default: '4', group: 'style' },
      // Padding — 4 sides (auto-rendered as a linked SpacingBox)
      { key: 'paddingTop', label: 'Padding Top', type: 'number', default: '14', group: 'spacing' },
      { key: 'paddingRight', label: 'Padding Right', type: 'number', default: '28', group: 'spacing' },
      { key: 'paddingBottom', label: 'Padding Bottom', type: 'number', default: '14', group: 'spacing' },
      { key: 'paddingLeft', label: 'Padding Left', type: 'number', default: '28', group: 'spacing' },
      { key: 'fontSize', label: 'Font Size', type: 'unit', default: '14', group: 'typography', slider: true, sliderMax: 40 },
      { key: 'fontWeight', label: 'Weight', type: 'select', options: FONT_WEIGHT_OPTIONS, default: '600', group: 'typography' },
      { key: 'textTransform', label: 'Transform', type: 'select', options: TEXT_TRANSFORM_OPTIONS, default: 'none', group: 'typography' },
      { key: 'letterSpacing', label: 'Letter Spacing', type: 'unit', default: '0', group: 'typography' },
    ],
  },

  spacer: {
    name: 'spacer',
    label: 'Spacer',
    icon: 'ArrowsUpDownIcon',
    props: [
      { key: 'height', label: 'Height (px)', type: 'number', default: '24', group: 'layout', slider: true, sliderMax: 200 },
      { key: 'bgColor', label: 'Background', type: 'color', group: 'style' },
    ],
  },

  divider: {
    name: 'divider',
    label: 'Divider',
    icon: 'MinusIcon',
    props: [
      { key: 'color', label: 'Color', type: 'color', default: '#e5e5e5', half: true, group: 'style' },
      { key: 'thickness', label: 'Thickness', type: 'number', default: '1', group: 'style', slider: true, sliderMax: 20 },
      { key: 'style', label: 'Style', type: 'select', options: BORDER_STYLE_OPTIONS, default: 'solid', group: 'style' },
      { key: 'width', label: 'Width', type: 'text', default: '100%', group: 'layout' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
      { key: 'marginTop', label: 'Margin Top', type: 'number', default: '16', half: true, group: 'spacing' },
      { key: 'marginBottom', label: 'Margin Bottom', type: 'number', default: '16', half: true, group: 'spacing' },
    ],
  },

  logo: {
    name: 'logo',
    label: 'Logo',
    icon: 'HeaderIcon',
    props: [
      { key: 'src', label: 'Logo', type: 'image', group: 'content' },
      { key: 'alt', label: 'Alt Text', type: 'text', group: 'content' },
      { key: 'linkUrl', label: 'Link URL', type: 'url', group: 'content' },
      { key: 'width', label: 'Width (px)', type: 'number', default: '140', half: true, group: 'layout' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', half: true, group: 'layout' },
    ],
  },

  social: {
    name: 'social',
    label: 'Social Links',
    icon: 'ChatBubbleLeftIcon',
    props: [
      { key: 'variant', label: 'Style', type: 'select', options: SOCIAL_VARIANT_OPTIONS, default: 'color', group: 'style' },
      { key: 'iconSize', label: 'Icon Size', type: 'number', default: '28', group: 'layout', slider: true, sliderMax: 64 },
      { key: 'spacing', label: 'Spacing', type: 'number', default: '8', group: 'layout', slider: true, sliderMax: 40 },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_OPTIONS, default: 'center', group: 'layout' },
      // Repeatable links — up to 6
      { key: 'link1-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, default: 'facebook', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link1-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link2-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, default: 'instagram', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link2-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link3-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, default: 'youtube', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link3-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link4-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link4-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link5-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link5-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link6-platform', label: 'Platform', type: 'select', options: SOCIAL_PLATFORM_OPTIONS, group: 'links', repeatableGroup: 'link', half: true },
      { key: 'link6-url', label: 'URL', type: 'url', group: 'links', repeatableGroup: 'link', half: true },
    ],
    repeatableGroups: [
      { key: 'link', label: 'Social Link', maxItems: 6, propsPerItem: ['link{n}-platform', 'link{n}-url'] },
    ],
  },
};

export function getComponentSchema(type: string): ComponentSchema | undefined {
  return componentSchemas[type];
}

export function getAvailableComponents(): ComponentSchema[] {
  return Object.values(componentSchemas);
}
