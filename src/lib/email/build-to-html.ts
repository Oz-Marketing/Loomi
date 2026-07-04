/**
 * Server-side bridge: AI assistant `templateBuild` → email-safe HTML.
 *
 * The template editor's AI assistant (`POST /api/ai/assistant`) returns a
 * `templateBuild` — either a flat array of visual components ({type, props})
 * or raw `code` HTML. Turning that into final HTML only existed CLIENT-SIDE in
 * the editor (`handleAiBuildTemplate` → `syncVisualToCode`). The AI Campaign
 * Builder needs the same compile on the server so it can persist a rendered
 * EmailCampaign draft without a round-trip through the editor.
 *
 * This faithfully reuses the editor's real pipeline:
 *   templateBuild.components
 *     → merge component-schema defaults   (mirrors handleAiBuildTemplate)
 *     → ParsedTemplate
 *     → serializeTemplate()               (the editor's v2 serializer)
 *     → v2 EmailTemplate JSON
 *     → renderEmailTemplate()             (react-email, the real send path)
 *
 * Returning the v2 `EmailTemplate` alongside the HTML lets the caller persist
 * the JSON so the generated email stays editable in the visual builder.
 */
import { componentSchemas } from '@/lib/component-schemas';
import { serializeTemplate } from '@/lib/template-serializer';
import type { ParsedComponent, ParsedTemplate } from '@/lib/template-parser';
import { parseV2Template, type EmailTemplate } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

/** A visual component in a `templateBuild`. Containers (section, columns) nest
 *  their content as `children` — the assistant emits the email this way, so
 *  preserving children is what keeps the body content (not just empty colored
 *  sections) in the rendered email. */
export interface TemplateBuildComponent {
  type: string;
  props: Record<string, string>;
  children?: TemplateBuildComponent[];
}

/** Mirror of the assistant route's `TemplateBuild` shape. */
export interface TemplateBuild {
  mode: 'visual' | 'code';
  components?: TemplateBuildComponent[];
  html?: string;
  frontmatter?: Record<string, string>;
  baseProps?: Record<string, string>;
}

export interface BuildToHtmlOptions {
  /** Authoritative subject — wins over anything in build.frontmatter. */
  subject?: string;
  /** Authoritative preview/preheader text — wins over build.frontmatter. */
  previewText?: string;
}

export interface RenderedEmail {
  html: string;
  textContent: string;
  /**
   * The v2 EmailTemplate JSON that produced the HTML, or null in code mode.
   * Persist this (e.g. in EmailCampaign.metadata) to keep the email editable
   * in the visual builder.
   */
  template: EmailTemplate | null;
}

/**
 * Map a visual `templateBuild` to a ParsedTemplate, merging each component's
 * schema defaults exactly like the editor's `handleAiBuildTemplate`.
 */
function componentToParsed(comp: TemplateBuildComponent): ParsedComponent {
  const schema = componentSchemas[comp.type];
  const defaultProps: Record<string, string> = {};
  if (schema) {
    for (const prop of schema.props) {
      if (prop.default) defaultProps[prop.key] = prop.default;
    }
  }
  const parsed: ParsedComponent = { type: comp.type, props: { ...defaultProps, ...comp.props } };
  if (comp.children && comp.children.length > 0) {
    parsed.children = comp.children.map(componentToParsed);
  }
  return parsed;
}

export function templateBuildToParsed(
  build: TemplateBuild,
  opts: BuildToHtmlOptions = {},
): ParsedTemplate {
  // Recurse so nested content (sections/columns and their children) is kept —
  // dropping children would leave only empty colored containers.
  const components: ParsedComponent[] = (build.components ?? []).map(componentToParsed);

  // serializeTemplate reads frontmatter.subject and frontmatter.preheader, so
  // normalize the assistant's `previewText` key onto `preheader` here.
  const frontmatter: Record<string, string> = { version: '2' };
  if (build.frontmatter?.subject) frontmatter.subject = build.frontmatter.subject;
  if (build.frontmatter?.previewText) frontmatter.preheader = build.frontmatter.previewText;
  if (opts.subject !== undefined) frontmatter.subject = opts.subject;
  if (opts.previewText !== undefined) frontmatter.preheader = opts.previewText;

  return {
    frontmatter,
    baseProps: { ...(build.baseProps ?? {}) },
    components,
    raw: '',
  };
}

/** Convert a visual `templateBuild` into a v2 EmailTemplate (null if not visual/empty). */
export function templateBuildToEmailTemplate(
  build: TemplateBuild,
  opts: BuildToHtmlOptions = {},
): EmailTemplate | null {
  if (build.mode !== 'visual' || !build.components || build.components.length === 0) {
    return null;
  }
  const parsed = templateBuildToParsed(build, opts);
  return parseV2Template(serializeTemplate(parsed));
}

/**
 * Render a `templateBuild` to final email HTML (+ plain text).
 *
 * - `mode: 'code'` → returns `build.html` as-is (already email-safe).
 * - `mode: 'visual'` → compiles via the v2 react-email renderer.
 *
 * Throws if no non-empty HTML could be produced, so a caller's per-asset
 * try/catch can surface the failure rather than persisting an empty email.
 */
export async function renderTemplateBuild(
  build: TemplateBuild,
  opts: BuildToHtmlOptions = {},
): Promise<RenderedEmail> {
  if (build.mode === 'code') {
    const html = (build.html ?? '').trim();
    if (!html) throw new Error('Code-mode templateBuild had no HTML');
    return { html, textContent: '', template: null };
  }

  const template = templateBuildToEmailTemplate(build, opts);
  if (!template || template.blocks.length === 0) {
    throw new Error('Visual templateBuild produced no renderable blocks');
  }

  const [html, textContent] = await Promise.all([
    renderEmailTemplate(template),
    renderEmailTemplate(template, { plainText: true }),
  ]);

  if (!html.trim()) throw new Error('Email render produced empty HTML');

  return { html, textContent, template };
}
