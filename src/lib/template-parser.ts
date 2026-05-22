import { isV2Template, parseV2Template, type Block, type EmailTemplate } from './email/types';

export interface ParsedComponent {
  type: string;
  props: Record<string, string>;
  content?: string;
  raw?: string;
  /** v2 only: stable id for the block */
  id?: string;
  /** v2 only: nested blocks (currently only used by Section / Columns) */
  children?: ParsedComponent[];
}

export interface ParsedTemplate {
  frontmatter: Record<string, string>;
  baseProps: Record<string, string>;
  components: ParsedComponent[];
  raw: string;
}

/**
 * Parse a template into the editor's working data shape.
 * v2 JSON only — legacy Maizzle <x-base> scaffold is no longer supported.
 */
export function parseTemplate(fileContent: string): ParsedTemplate {
  if (isV2Template(fileContent)) {
    const tpl = parseV2Template(fileContent);
    if (tpl) return v2ToParsed(tpl, fileContent);
  }
  // Non-v2 content (pure HTML, plain text, etc.) — return an empty parsed shape
  // so the editor falls back to code mode rather than crashing.
  return { frontmatter: {}, baseProps: {}, components: [], raw: fileContent };
}

// ── v2 → ParsedTemplate ────────────────────────────────────────────

function v2ToParsed(tpl: EmailTemplate, raw: string): ParsedTemplate {
  const frontmatter: Record<string, string> = { version: '2' };
  if (tpl.title) frontmatter.title = tpl.title;
  if (tpl.subject) frontmatter.subject = tpl.subject;
  if (tpl.preheader) frontmatter.preheader = tpl.preheader;

  const baseProps: Record<string, string> = {
    'body-bg': tpl.settings.bodyBg,
    'content-bg': tpl.settings.contentBg,
    'content-width': String(tpl.settings.contentWidth),
    'font-family': tpl.settings.fontFamily,
    'text-color': tpl.settings.textColor,
  };

  const components = tpl.blocks.map(blockToComponent);

  return { frontmatter, baseProps, components, raw };
}

function blockToComponent(block: Block): ParsedComponent {
  const props = stringifyProps(block.props);
  const result: ParsedComponent = {
    type: block.type,
    props,
    id: block.id,
  };
  if (Array.isArray(block.children) && block.children.length > 0) {
    result.children = block.children.map(blockToComponent);
  }
  return result;
}

/**
 * Convert v2 props (which can be any shape) to flat string-keyed props for
 * the editor model. Objects/arrays get JSON-stringified into a single
 * key so the original data round-trips on save.
 */
function stringifyProps(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (typeof value === 'string') {
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}
