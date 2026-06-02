import fs from 'fs';
import path from 'path';
import { componentSchemas } from './component-schemas';
import { prisma } from './prisma';

// ── Paths ──
const STUDIO_ROOT = process.cwd();
const KNOWLEDGE_FILE = path.join(STUDIO_ROOT, 'loomi-knowledge.md');

// ── Read files safely ──
function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ── Build dynamic data snapshot ──
async function buildDynamicData(): Promise<string> {
  const sections: string[] = [];

  // 1. Components — names, labels, key content props, and defaults
  const componentEntries = Object.values(componentSchemas);
  if (componentEntries.length > 0) {
    const lines = componentEntries.map((schema) => {
      // Split props into essential (content/text/buttons) vs design (layout/border/tracking)
      const designGroups = new Set(['border', 'tracking']);
      const essential = schema.props
        .filter((p) => !p.repeatableGroup && !designGroups.has(p.group || ''))
        .map((p) => {
          const parts = [`\`${p.key}\``];
          if (p.type !== 'text' && p.type !== 'textarea') parts.push(`(${p.type})`);
          if (p.default) parts.push(`= "${p.default}"`);
          if (p.required) parts.push('[required]');
          return parts.join(' ');
        });
      const repeatable = schema.repeatableGroups
        ? schema.repeatableGroups.map((g) => `${g.label} (up to ${g.maxItems})`).join(', ')
        : '';
      return [
        `- **${schema.label}** (\`${schema.name}\`) — ${schema.props.length} total props`,
        `  Essential props: ${essential.slice(0, 12).join(', ')}${essential.length > 12 ? ', ...' : ''}`,
        repeatable ? `  Repeatable: ${repeatable}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    });
    sections.push(`### Available Components (${componentEntries.length})\n\n${lines.join('\n\n')}`);
  }

  // 2. Template tags from DB
  try {
    const tags = await prisma.templateTag.findMany({ orderBy: { name: 'asc' } });
    if (tags.length > 0) {
      sections.push(`### Template Style Tags\n\nAvailable styles: ${tags.map((t) => t.name).join(', ')}`);
    }
  } catch {
    // DB not available, skip
  }

  // 4. Template categories from DB
  try {
    const templates = await prisma.template.findMany({
      where: { category: { not: null } },
      select: { slug: true, category: true },
    });
    const catMap: Record<string, string[]> = {};
    for (const t of templates) {
      if (!t.category) continue;
      if (!catMap[t.category]) catMap[t.category] = [];
      catMap[t.category].push(t.slug);
    }
    if (Object.keys(catMap).length > 0) {
      const lines = Object.entries(catMap).map(
        ([cat, designs]) => `- **${cat}:** ${designs.join(', ')}`,
      );
      sections.push(`### Template Design Categories\n\n${lines.join('\n')}`);
    }
  } catch {
    // DB not available, skip
  }

  if (sections.length === 0) return '';

  return `\n\n---\n\n## DYNAMIC DATA (auto-generated from current platform state)\n\n${sections.join('\n\n')}`;
}

// ── Build the full knowledge context ──
export async function buildKnowledgeContext(): Promise<string> {
  const knowledgeBase = readFileOrEmpty(KNOWLEDGE_FILE);
  const dynamicData = await buildDynamicData();

  if (!knowledgeBase && !dynamicData) {
    return 'You are an AI assistant for Loomi Studio, an email template management platform by Oz Marketing.';
  }

  return `${knowledgeBase}${dynamicData}`;
}

// ── Build account context for AI prompts ──
export interface AccountContextInput {
  name?: string | null;
  branding?: {
    colors?: Record<string, string | undefined>;
    fonts?: Record<string, string | undefined>;
  } | null;
  logos?:
    | Array<{ name?: string; url?: string }>
    | Record<string, string | undefined>
    | null;
  customValues?: Record<string, string> | null;
  identity?: {
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    address?: string | null;
    postalCode?: string | null;
    website?: string | null;
  } | null;
  business?: {
    category?: string | null;
    email?: string | null;
    timezone?: string | null;
    storefrontImage?: string | null;
    salesPhone?: string | null;
    servicePhone?: string | null;
    partsPhone?: string | null;
  } | null;
}

export function buildAccountContext(account: AccountContextInput): string {
  const lines: string[] = [];

  if (account.name) {
    lines.push(`Account: ${account.name}`);
  }

  if (account.identity) {
    const { city, state, phone, address, postalCode, website } = account.identity;
    const location = [city, state].filter(Boolean).join(', ');
    if (location) lines.push(`Location: ${location}`);
    if (address) lines.push(`Address: ${address}`);
    if (postalCode) lines.push(`Postal Code: ${postalCode}`);
    if (phone) lines.push(`Phone: ${phone}`);
    if (website) lines.push(`Website: ${website}`);
  }

  if (account.business) {
    const {
      category,
      email,
      timezone,
      storefrontImage,
      salesPhone,
      servicePhone,
      partsPhone,
    } = account.business;
    if (category) lines.push(`Category: ${category}`);
    if (email) lines.push(`Email: ${email}`);
    if (timezone) lines.push(`Timezone: ${timezone}`);

    const departmentPhones = [
      salesPhone ? `sales: ${salesPhone}` : null,
      servicePhone ? `service: ${servicePhone}` : null,
      partsPhone ? `parts: ${partsPhone}` : null,
    ].filter(Boolean);
    if (departmentPhones.length > 0) {
      lines.push(`Department Phones: ${departmentPhones.join(', ')}`);
    }

    if (storefrontImage) lines.push(`Storefront Image: ${storefrontImage}`);
  }

  if (account.branding?.colors) {
    const colorEntries = Object.entries(account.branding.colors)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`);
    if (colorEntries.length > 0) {
      lines.push(`Brand Colors: ${colorEntries.join(', ')}`);
    }
  }

  if (account.branding?.fonts) {
    const fontEntries = Object.entries(account.branding.fonts)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`);
    if (fontEntries.length > 0) {
      lines.push(`Brand Fonts: ${fontEntries.join(', ')}`);
    }
  }

  if (account.logos) {
    const logoEntries = Array.isArray(account.logos)
      ? account.logos
          .filter((logo) => logo.url)
          .map((logo) => (logo.name ? `${logo.name}: ${logo.url}` : logo.url!))
      : Object.entries(account.logos)
          .filter(([, url]) => url)
          .map(([name, url]) => `${name}: ${url}`);
    const logoList = logoEntries.join(', ');
    if (logoList) lines.push(`Logos: ${logoList}`);
  }

  if (account.customValues) {
    const cvEntries = Object.entries(account.customValues)
      .filter(([, v]) => v)
      .slice(0, 15) // Limit to avoid token bloat
      .map(([k, v]) => `${k} = ${v}`);
    if (cvEntries.length > 0) {
      lines.push(`Custom Values: ${cvEntries.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ── System prompt for the global chat assistant ──
export async function getChatSystemPrompt(): Promise<string> {
  const knowledge = await buildKnowledgeContext();

  return [
    'You are Iris, a friendly and knowledgeable AI assistant for Loomi Studio.',
    '',
    'KNOWLEDGE BASE:',
    knowledge,
    '',
    'BEHAVIOR RULES:',
    '- Be concise, helpful, and conversational.',
    '- Use short paragraphs.',
    '- If you don\'t know something specific about their data, say so and suggest where to look.',
    '- Never make up template names, account details, or component names that aren\'t in the knowledge base.',
    '- Use the dynamic data section for accurate, up-to-date information about components, variables, and templates.',
    '',
    'CONTEXT:',
    'You will receive context about the user\'s current page, selected account, role, and name. Use this to give relevant, personalized answers.',
    '',
    'RESPONSE FORMAT:',
    'CRITICAL: Return ONLY valid JSON. No markdown fences, no text before or after the JSON.',
    '{"reply":"string","suggestions":["string"]}',
    '- reply: Your answer in plain text (no markdown fences, keep concise).',
    '- suggestions: 0-3 short follow-up questions the user might want to ask next.',
  ].join('\n');
}

// ── System prompt for the template editor assistant ──
export async function getAssistantSystemPrompt(accountContext?: string): Promise<string> {
  const knowledge = await buildKnowledgeContext();

  const sections = [
    'You are Iris, an expert email production assistant for the Loomi Studio template editor.',
    'You help users build complete emails, edit component props, write subject lines, improve copy, and answer questions about the template system.',
    '',
    'KNOWLEDGE BASE:',
    knowledge,
  ];

  if (accountContext) {
    sections.push('', 'CURRENT ACCOUNT CONTEXT:', accountContext);
  }

  sections.push(
    '',
    'CAPABILITIES:',
    '1. **Answer questions** about the template editor, components, variables, and email best practices.',
    '2. **Edit component props** when the user asks to change a specific property of the currently selected component.',
    '3. **Build complete emails** when the user requests a full email. Match the active editor: use Loomi components in visual mode, and generate branded HTML with creative freedom in code/HTML mode.',
    '4. **Ask clarifying questions** when the user\'s request is too vague to generate a good email (unclear purpose, missing key details).',
    '',
    'BEHAVIOR RULES:',
    '- Keep reply concise and actionable.',
    '- When revising an existing email, read the currentEmail context first: subject, previewText, textContent, headings, ctas, componentOutline, and selectedSection.',
    '- Infer details already present in the current email before asking follow-up questions. Do not ask again for details that are explicit in the email, especially the offer/incentive, promoted model or product, CTA, deadline or urgency, or existing tone.',
    '- Ask clarifying questions only for true gaps, conflicts, or strategic choices not already answered by the current email context.',
    '- When suggesting prop edits, use real prop keys from the component schemas in the knowledge base.',
    '- Before generating any full email, silently follow a best-practice plan: identify the goal/audience/offer, write subject + preview text, choose the right structure, build the message hierarchy, place a strong primary CTA, support it with useful proof/details, and finish with brand/business/footer details.',
    '- Always match the active editor context. If the editor context says mode="code" or htmlOnlyBuilder=true, return templateBuild.mode="code" unless the user explicitly asks for Loomi visual components.',
    '- In visual mode, follow the component ordering conventions and schema-aware prop usage from the knowledge base.',
    '- In code/HTML mode, you are NOT limited to Loomi drag-and-drop components or <x-core.*> tags. You may create custom email-safe HTML tailored to the request.',
    '- In code/HTML mode, prefer proven email patterns: hidden preheader text, table-based structure, a centered max-width container, inline styles, accessible alt text, bulletproof CTA styling, mobile-friendly stacking, and a footer with business/contact/compliance details when appropriate.',
    '- The visual editor uses a v2 JSON template format rendered with @react-email/components. Available block types: section, columns (Grid), heading, text, image, button, spacer, divider, logo, social. Containers (section, columns) hold child blocks; the rest are leaf content blocks. Block props include common things like fontSize, fontWeight, color, padding{Top|Right|Bottom|Left}, borderRadius{TopLeft|TopRight|BottomRight|BottomLeft}, gap, bgColor, bgImage, etc. — see the component schemas in the knowledge base.',
    '- Apply account branding (colors, fonts) when available. Use the actual account brand colors and fonts instead of generic defaults.',
    '- Use the CURRENT ACCOUNT CONTEXT and the account object in EDITOR CONTEXT JSON as the source of truth for branding, logos, custom values, and business details.',
    '- Use a real sub-account logo from the current account context when available. Choose the logo variant that fits the background. Fall back to {{custom_values.logo_url}} only if no account logo URL is available.',
    '- Read and incorporate relevant business details from the sub-account profile when useful: business name, category, address, city/state/postal code, phone numbers, website, email, timezone, and custom values.',
    '- If imagery is needed and no specific asset was provided, use the placeholder URL: https://loomi-media.sfo3.digitaloceanspaces.com/media/_admin/69fa3adf4ae444edaadd1d0d7fee4b87/image placeholder.png',
    '- Use template variables ({{contact.first_name}}, {{location.name}}, etc.) for personalization.',
    '- Only include props that differ from schema defaults. The system auto-fills defaults for omitted props.',
    '- If unsure about the email purpose, audience, or content after reading the current email context, ask a clarifying question BEFORE generating.',
    '- In code mode, return plain email-safe HTML. The legacy Maizzle <x-base> / <x-core> scaffold is NO LONGER supported — never emit those tags.',
    '',
    'RESPONSE FORMAT:',
    'CRITICAL: Return ONLY valid JSON. No markdown fences, no text before or after the JSON object.',
    'The response MUST be parseable by JSON.parse().',
    '',
    '{',
    '  "reply": "Your conversational response explaining what you did or are asking",',
    '  "suggestions": ["0-4 short follow-up suggestions or questions"],',
    '  "componentEdits": [{"componentIndex": 0, "key": "prop-key", "value": "new value", "reason": "optional"}],',
    '  "templateBuild": null or {',
    '    "mode": "visual" or "code",',
    '    "components": [{"type": "block-type", "props": {"key": "value"}, "children": [...]}],',
    '    "html": "raw email-safe HTML (code mode only — no <x-base> tags)",',
    '    "frontmatter": {"subject": "...", "previewText": "..."},',
    '    "baseProps": {"body-bg": "#ffffff", "body-width": "600px", "font-family": "Arial, sans-serif"}',
    '  },',
    '  "clarification": null or "Your question to the user before generating"',
    '}',
    '',
    'RULES FOR CHOOSING RESPONSE FIELDS:',
    '- For questions/help: Set reply + suggestions. Leave componentEdits=[], templateBuild=null, clarification=null.',
    '- For prop edits: Set reply + componentEdits. Each edit MUST include "componentIndex" matching the component\'s index from the components array in context. You can edit multiple components at once by including edits with different componentIndex values. Leave templateBuild=null.',
    '- For full email generation (visual mode): Set reply + templateBuild with mode="visual" and components array. ALWAYS include frontmatter.subject and frontmatter.previewText with compelling, relevant copy.',
    '- For full email generation (code/HTML mode): Set reply + templateBuild with mode="code" and html string. ALWAYS include frontmatter.subject and frontmatter.previewText with compelling, relevant copy.',
    '- For clarification needed: Set reply + clarification with your question. Only do this after using the current email context to infer all details already present. Leave templateBuild=null.',
    '- NEVER set both templateBuild and clarification in the same response.',
    '- componentEdits is for editing existing component props (one or many components). Use componentIndex to target each component. templateBuild is for generating a FULL EMAIL from scratch.',
    '- When the editor is in code/HTML mode, do not return a visual components array unless the user explicitly asks to switch to visual-mode components.',
    '- When the user asks to change something across all components (e.g. "make all buttons black"), include edits for EVERY matching component using their componentIndex.',
    '- The context includes a "components" array with index, type, label, and current props for each component. Use this to find the right componentIndex values.',
  );

  return sections.join('\n');
}
