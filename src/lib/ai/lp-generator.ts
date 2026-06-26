/**
 * AI landing-page generator for the Campaign Builder.
 *
 * Like email "code mode", the model writes a complete HTML page (body inner
 * HTML only — the public LP page owns the document shell). We inject the lead
 * form by telling the model to drop a `<div data-loomi-form="SENTINEL"></div>`
 * placeholder, then swap the sentinel for the real Form id server-side (so the
 * id can't be hallucinated). Branding is enforced from the account context;
 * uploaded landingPage/generic assets are offered for placement.
 */
import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';
import { isHtmlLandingPageTemplate, type LandingPageHtmlTemplate } from '@/lib/landing-pages/types';
import { assetsForKind } from '@/lib/campaigns/asset-matching';
import type { CampaignPlanAsset, CampaignPlanLandingPageSpec } from '@/lib/campaigns/types';

const FORM_SENTINEL = 'LOOMI_LEAD_FORM';

const LP_SYSTEM = [
  'You are an expert landing-page designer for local-business marketing campaigns (auto dealers, healthcare, services).',
  'Return ONLY valid JSON: {"html": "<the landing page BODY innerHTML>"}. No markdown fences, no commentary.',
  'The html is the BODY INNER HTML ONLY — do NOT include <html>, <head>, or <body> tags. A single <style> block at the top of the body is allowed and encouraged for layout and responsiveness.',
].join('\n');

function buildLpPrompt(
  spec: CampaignPlanLandingPageSpec,
  opts: { accountContext?: string; campaignSummary?: string; formId?: string; assets?: CampaignPlanAsset[] },
): string {
  const lines: string[] = [];
  lines.push('Build a complete, responsive marketing LANDING PAGE (body HTML) for this campaign.');
  if (opts.campaignSummary) lines.push(`Campaign: ${opts.campaignSummary}`);
  lines.push('');
  lines.push(`Purpose: ${spec.purpose}`);
  if (spec.headline) lines.push(`Hero headline: ${spec.headline}`);
  if (spec.sections?.length) {
    lines.push('Sections to include:');
    for (const s of spec.sections) lines.push(`  - ${s}`);
  }
  lines.push('');
  lines.push('ACCOUNT CONTEXT (use for branding):');
  lines.push(opts.accountContext || '(no account context provided)');

  const lpAssets = assetsForKind(opts.assets, 'landingPage');
  if (lpAssets.length > 0) {
    lines.push('');
    lines.push('Use these uploaded brand images — reference each by its EXACT URL in an <img src> tag:');
    for (const a of lpAssets) lines.push(`  - ${a.filename} (${a.url})`);
  }

  lines.push('');
  lines.push('BRANDING (MANDATORY — use the account context values verbatim):');
  lines.push('- Put the account LOGO (from the "Logos" line) in the header/hero, choosing the variant that reads on the background.');
  lines.push('- Use the "Brand Colors" hex values: primary for the hero band + primary CTA, accent for secondary accents/links, background for the canvas, text for body copy.');
  lines.push('- Use the "Brand Fonts" stacks verbatim. Never load a web font.');

  if (opts.formId) {
    lines.push('');
    lines.push(
      `LEAD FORM: place EXACTLY this placeholder where the lead-capture form belongs (e.g. in a prominent "claim the offer" / "get details" section): <div data-loomi-form="${FORM_SENTINEL}"></div>. Do NOT build your own <form> element — the placeholder is replaced with the real embedded form.`,
    );
  }

  lines.push('');
  lines.push('DESIGN — modern, bold, conversion-focused:');
  lines.push('- A strong hero (brand-colored band, logo, big headline, subhead, primary CTA that scrolls to the form).');
  lines.push('- An offer/value spotlight, supporting detail/social-proof sections, and a closing CTA.');
  lines.push('- Responsive (mobile-friendly stacking), generous spacing, brand-colored buttons, clean modern typography.');
  lines.push('');
  lines.push('COPY: confident, benefit-led. NEVER use emojis.');
  lines.push('Output the full body HTML now as JSON {"html": "..."}. Do not ask clarifying questions.');
  return lines.join('\n');
}

function fallbackLpHtml(spec: CampaignPlanLandingPageSpec, formId?: string): string {
  const headline = (spec.headline || spec.purpose || 'Welcome').replace(/</g, '&lt;');
  const formBlock = formId
    ? `<div style="max-width:560px;margin:0 auto;"><div data-loomi-form="${FORM_SENTINEL}"></div></div>`
    : '';
  return `<style>.loomi-lp{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;}</style><div class="loomi-lp"><section style="background:#1a1a1a;color:#fff;padding:64px 24px;text-align:center;"><h1 style="margin:0 0 12px;font-size:36px;line-height:1.2;">${headline}</h1><p style="margin:0;font-size:18px;opacity:.85;">${(spec.purpose || '').replace(/</g, '&lt;')}</p></section><section style="padding:48px 24px;max-width:720px;margin:0 auto;">${formBlock}</section></div>`;
}

export async function generateLandingPageForSpec(
  spec: CampaignPlanLandingPageSpec,
  opts: { accountContext?: string; campaignSummary?: string; formId?: string; assets?: CampaignPlanAsset[] } = {},
): Promise<{ content: LandingPageHtmlTemplate; name: string }> {
  let html = '';
  try {
    const client = getAnthropicClient();
    const res = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: LP_SYSTEM,
      messages: [{ role: 'user', content: buildLpPrompt(spec, opts) }],
      temperature: 0.4,
      max_tokens: 16000,
    });
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const parsed = parseAiJson(text) as { html?: unknown } | null;
    if (parsed && typeof parsed.html === 'string' && parsed.html.trim()) html = parsed.html;
  } catch {
    /* fall through to deterministic fallback */
  }

  if (!html.trim()) html = fallbackLpHtml(spec, opts.formId);

  // Swap the sentinel for the real form id, or strip the placeholder div.
  if (opts.formId) {
    html = html.split(FORM_SENTINEL).join(opts.formId);
  } else {
    html = html.replace(
      new RegExp(`<div[^>]*data-loomi-form\\s*=\\s*["']?${FORM_SENTINEL}["']?[^>]*>\\s*</div>`, 'gi'),
      '',
    );
  }

  const content: LandingPageHtmlTemplate = { version: '1', mode: 'html', html };
  return {
    content: isHtmlLandingPageTemplate(content)
      ? content
      : { version: '1', mode: 'html', html: fallbackLpHtml(spec, opts.formId) },
    name: spec.purpose || 'Landing page',
  };
}
