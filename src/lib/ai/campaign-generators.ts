/**
 * Per-asset content generators for the AI Campaign Builder.
 *
 * The orchestrator (POST /api/campaigns/[id]/generate) iterates the confirmed
 * plan and calls these to produce each asset's content:
 *   - emails  → a full design via the shared email assistant
 *   - sms     → the confirmed plan message (no extra AI call; respects edits)
 *
 * Nothing here persists or sends — callers wire the result into the existing
 * draft services.
 */
import { runEmailAssistant } from '@/lib/ai/email-assistant';
import type { TemplateBuild } from '@/lib/email/build-to-html';
import {
  SMS_MAX_CHARS,
  type CampaignPlanAsset,
  type CampaignPlanEmailSpec,
  type CampaignPlanSmsSpec,
} from '@/lib/campaigns/types';
import { assetsForKind } from '@/lib/campaigns/asset-matching';

export interface EmailGenResult {
  templateBuild: TemplateBuild | null;
  reply: string;
  /** Set if the assistant declined to build and asked for more info instead. */
  clarification: string | null;
}

function buildEmailPrompt(
  spec: CampaignPlanEmailSpec,
  campaignSummary?: string,
  assets?: CampaignPlanAsset[],
): string {
  const lines: string[] = [];
  lines.push('Build a complete, ready-to-send marketing email from scratch.');
  if (campaignSummary) lines.push(`This email is part of a campaign: ${campaignSummary}`);
  lines.push('');
  lines.push(`Purpose of THIS email: ${spec.purpose}`);
  if (spec.subject) lines.push(`Subject line: ${spec.subject}`);
  if (spec.previewText) lines.push(`Preview text: ${spec.previewText}`);
  if (spec.tone) lines.push(`Tone: ${spec.tone}`);
  if (spec.keyPoints?.length) {
    lines.push('Key points to cover:');
    for (const point of spec.keyPoints) lines.push(`  - ${point}`);
  }

  // Uploaded brand images for this medium (email + generic).
  const emailAssets = assetsForKind(assets, 'email');
  if (emailAssets.length > 0) {
    lines.push('');
    lines.push(
      'Use these uploaded brand images in the email — reference each by its EXACT URL in an <img src> tag, choosing placement from the filename hint (e.g. a "hero"/"banner" image in the hero):',
    );
    for (const a of emailAssets) {
      lines.push(`  - ${a.filename} (${a.url})${a.altText ? ` — alt: ${a.altText}` : ''}`);
    }
  }

  lines.push('');
  lines.push('BRANDING (MANDATORY — use the CURRENT ACCOUNT CONTEXT values verbatim):');
  lines.push(
    '- Place the account LOGO in the email header/hero using the actual URL from the "Logos" line in the account context. Pick the variant that reads on the background (light/white logo on a dark/brand-colored band, dark/black logo on a light band). Only fall back to {{custom_values.logo_url}} if there is no Logos line.',
  );
  lines.push(
    '- Use the account "Brand Colors" hex values: primary for the hero band and the primary CTA button, accent for secondary accents/links, background for the canvas, text for body copy. Do NOT invent generic colors when brand hexes exist.',
  );
  lines.push(
    '- Use the account "Brand Fonts" stacks verbatim (heading stack for headings, body stack for body). They are already email-safe — never load a web font.',
  );
  lines.push('');
  lines.push('DESIGN — make this look like a premium, modern, high-impact marketing email, NOT a plain newsletter:');
  lines.push(
    '- BOLD HERO: a full-width band in the brand PRIMARY color (or a deep dark band) with the logo at top, then a large punchy headline (36-48px, heavy weight), a one-line subhead, and a prominent CTA button. High contrast, lots of presence.',
  );
  lines.push(
    '- OFFER SPOTLIGHT: render the core offer/deal as a visually striking, scannable element — e.g. a multi-column row of bold value cards or badges (each with a large value/number + a short label), or a high-contrast highlighted "deal" banner. Use the brand ACCENT color, generous padding, rounded corners (8-16px), and borders/dividers so the offer truly pops. Make the savings/benefit unmistakable.',
  );
  lines.push(
    '- URGENCY: a contrasting strip stating the deadline / limited-time framing (e.g. "Ends June 30").',
  );
  lines.push(
    '- RHYTHM + DEPTH: alternate section background bands (brand color / light tint / white) for visual rhythm; generous spacing between sections; clear hierarchy (eyebrow → headline → subhead → body).',
  );
  lines.push(
    '- CTA: at least one LARGE, high-contrast, bulletproof button in the brand primary color, centered, with generous padding (16-20px), bold label, rounded corners. Repeat the CTA near the bottom.',
  );
  lines.push(
    '- TYPE + LAYOUT: modern type scale (large bold headlines; body 15-16px / line-height ~1.6), centered ~600px container, mobile-friendly stacking. Clean and uncluttered — bold but tasteful.',
  );
  lines.push(
    '- FOOTER: business name, address, city/state/postal, phone(s), website, and an unsubscribe placeholder — from the account context, in muted styling.',
  );
  lines.push('');
  lines.push('COPY & VOICE:');
  lines.push(
    '- NEVER use emojis anywhere — not in the subject, preview text, headings, body, or buttons. No exceptions.',
  );
  lines.push(
    '- Write confident, energetic, benefit-led copy. Lead with the offer/value; avoid generic filler and corporate fluff.',
  );
  lines.push(
    'Do NOT ask clarifying questions — produce the full email now using sensible, on-brand defaults and merge tags (e.g. {{contact.first_name}}, {{location.name}}) where specifics are unknown.',
  );
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deterministic fallback email built straight from the plan spec, used only if
 * the model (despite force-build mode) returns no usable templateBuild. This
 * guarantees the campaign never silently ends up with zero emails — a draft is
 * always produced and lands in the overview for the user to refine.
 */
function fallbackEmailBuild(spec: CampaignPlanEmailSpec): TemplateBuild {
  const heading = escapeHtml(spec.subject || spec.purpose);
  const points = (spec.keyPoints ?? []).filter(Boolean);
  const body =
    (points.length
      ? points
      : [spec.purpose]
    )
      .map(
        (p) =>
          `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3a3a3a;">${escapeHtml(p)}</p>`,
      )
      .join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${heading}</title></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:24px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;"><tr><td style="padding:40px;"><h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#1a1a1a;">${heading}</h1>${body}<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td style="background:#1a1a1a;border-radius:6px;"><a href="{{location.website}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Learn More</a></td></tr></table></td></tr></table></td></tr></table></body></html>`;
  return {
    mode: 'code',
    html,
    frontmatter: { subject: spec.subject || spec.purpose, previewText: spec.previewText || '' },
  };
}

/**
 * Generate a complete email design for a plan spec. Returns the structured
 * `templateBuild` (visual blocks or code HTML) for the caller to render +
 * persist as an EmailBlast draft.
 *
 * Runs the assistant in force-build mode (never clarifies) and falls back to a
 * deterministic spec-based email if the model still returns no build, so an
 * email draft is always produced.
 */
export async function generateEmailForSpec(
  spec: CampaignPlanEmailSpec,
  opts: {
    accountContext?: string;
    campaignSummary?: string;
    mode?: 'visual' | 'code';
    assets?: CampaignPlanAsset[];
  },
): Promise<EmailGenResult> {
  // Campaign-level format wins; fall back to the per-spec hint, else code/HTML.
  const mode = opts.mode ?? (spec.mode === 'code' ? 'code' : 'visual');
  try {
    const payload = await runEmailAssistant({
      prompt: buildEmailPrompt(spec, opts.campaignSummary, opts.assets),
      accountContext: opts.accountContext,
      forceBuild: true,
      // Full emails are large — give generous headroom so the JSON isn't
      // truncated (which would otherwise throw and lose the email).
      maxTokens: 16000,
      // Signals the assistant to build from scratch in the requested mode.
      context: { mode, task: 'campaign-builder', surface: 'campaign' },
    });
    return {
      templateBuild: payload.templateBuild ?? fallbackEmailBuild(spec),
      reply: payload.reply,
      clarification: payload.clarification,
    };
  } catch (err) {
    // The assistant call failed entirely (truncated/invalid JSON, empty
    // response, transient API error). Never let that drop the email — fall
    // back to a deterministic on-spec draft so the build always succeeds.
    return {
      templateBuild: fallbackEmailBuild(spec),
      reply: '',
      clarification: err instanceof Error ? err.message : null,
    };
  }
}

/**
 * Finalize an SMS body from a plan spec. The plan already carries the
 * (user-editable, confirmed) message, so there's no extra AI round-trip — we
 * just trim and clamp to the Twilio-friendly cap, preserving the user's edits.
 */
export function finalizeSmsMessage(spec: CampaignPlanSmsSpec): string {
  const message = (spec.message || '').trim();
  return message.length > SMS_MAX_CHARS ? message.slice(0, SMS_MAX_CHARS) : message;
}
