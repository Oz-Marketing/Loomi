import type { ParsedTemplate, ParsedComponent } from './template-parser';
import type { Block, EmailTemplate, BlockType } from './email/types';
import { DEFAULT_SETTINGS } from './email/types';

/**
 * Serialize a ParsedTemplate back to v2 JSON. Legacy Maizzle scaffold output
 * is no longer supported — pure HTML or v2 only.
 */
export function serializeTemplate(template: ParsedTemplate): string {
  const tpl: EmailTemplate = {
    version: '2',
    ...(template.frontmatter.title ? { title: template.frontmatter.title } : {}),
    subject: template.frontmatter.subject || '',
    preheader: template.frontmatter.preheader || '',
    settings: {
      bodyBg: template.baseProps['body-bg'] || DEFAULT_SETTINGS.bodyBg,
      contentBg: template.baseProps['content-bg'] || DEFAULT_SETTINGS.contentBg,
      contentWidth:
        parseInt(template.baseProps['content-width'] || '600', 10) ||
        DEFAULT_SETTINGS.contentWidth,
      fontFamily: template.baseProps['font-family'] || DEFAULT_SETTINGS.fontFamily,
      textColor: template.baseProps['text-color'] || DEFAULT_SETTINGS.textColor,
    },
    blocks: template.components.map(componentToBlock),
  };
  return JSON.stringify(tpl, null, 2);
}

function componentToBlock(component: ParsedComponent): Block {
  const block: Block = {
    id: component.id || generateId(),
    type: component.type as BlockType,
    props: parseProps(component.props),
  };
  if (Array.isArray(component.children) && component.children.length > 0) {
    block.children = component.children.map(componentToBlock);
  }
  return block;
}

/**
 * Reverse the parser's stringify step: coerce string-typed props back to
 * numbers / booleans / objects where the original v2 prop had richer types.
 */
function parseProps(props: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(props)) {
    out[key] = coerceValue(raw);
  }
  return out;
}

function coerceValue(raw: string): unknown {
  if (raw === '') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}

function generateId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}`;
}
