/**
 * Shared types for the AI Campaign Builder.
 *
 * These are the cross-cutting shapes both the AI plan generator
 * (`src/lib/ai/campaign-plan.ts`) and the Campaign service
 * (`src/lib/services/campaigns.ts`) depend on, kept here so neither has to
 * import the other (avoids a runtime cycle — this module is types-only +
 * small constants).
 */

// ── Container status ──
// Mirrors the `Campaign.status` column comment in schema.prisma. Only
// `building` and `archived` are persisted; `draft | ready | partial` are
// derived at read time from the linked assets' own statuses.
export type CampaignStatus =
  | 'draft'
  | 'building'
  | 'ready'
  | 'partial'
  | 'archived';

/**
 * Who created the container.
 *
 * `automation` is written by the OEM offer run (`generateOfferEmail`) and was
 * missing here for as long as that code has existed — `toDetail` casts the
 * column with `as CampaignSource`, so the type never objected and every run
 * displayed as "Manual" through a two-way `source === 'ai' ? 'AI' : 'Manual'`
 * check. Naming the third value is what makes those checks answerable.
 */
export type CampaignSource = 'ai' | 'manual' | 'automation';

/** Label for each source, so the two places that show it cannot disagree. */
export const CAMPAIGN_SOURCE_LABEL: Record<CampaignSource, string> = {
  ai: 'AI',
  manual: 'Manual',
  automation: 'Automated',
};

// ── Channels ──
export type CampaignChannel = 'email' | 'sms' | 'landingPage' | 'form' | 'flow';

/** Channels the builder can actually generate today (Phase 1). */
export const PHASE_1_CHANNELS: CampaignChannel[] = ['email', 'sms'];

/** Phase 2 adds landing pages + lead forms. */
export const PHASE_2_CHANNELS: CampaignChannel[] = ['email', 'sms', 'landingPage', 'form'];

/** Phase 3 adds flows — the planner fills the `flows` slot the plan always had. */
export const PHASE_3_CHANNELS: CampaignChannel[] = ['email', 'sms', 'landingPage', 'form', 'flow'];

/** Twilio single-segment-friendly cap mirrored from the SMS campaign service. */
export const SMS_MAX_CHARS = 640;

// ── Build plan ──
// The JSON the AI returns in the "plan" phase, persisted on `Campaign.plan`
// and edited by the user before generation. Versioned so a future shape
// change is detectable.
export const CAMPAIGN_PLAN_VERSION = 1;

export interface CampaignPlanEmailSpec {
  /** Stable within the plan; stamped into the generated asset's metadata so
   *  a later regenerate can map plan → asset. */
  key: string;
  purpose: string;
  subject: string;
  previewText?: string;
  tone?: string;
  keyPoints?: string[];
  /** Informational cadence only — NEVER schedules a send. */
  sendOffsetDays?: number;
  /** Hint to the email generator: 'visual' (block JSON) or 'code' (raw html). */
  mode?: 'visual' | 'code';
}

export interface CampaignPlanSmsSpec {
  key: string;
  purpose: string;
  message: string;
  sendOffsetDays?: number;
  mediaUrls?: string[];
}

// P2/P3 specs — present in the type so the plan shape is forward-compatible;
// the Phase 1 planner leaves these arrays empty.
export interface CampaignPlanLandingPageSpec {
  key: string;
  purpose: string;
  headline?: string;
  sections?: string[];
  /** Plan-local key of the form to embed (references a CampaignPlanFormSpec.key). */
  embeddedFormKey?: string;
}

export interface CampaignPlanFormSpec {
  key: string;
  purpose: string;
  /** Plain field labels the planner proposes, e.g. ["Full name","Email","Phone"]. */
  fields?: string[];
}

/** One step of a planned drip: wait `delayDays` after the previous step, then send. */
export interface CampaignPlanFlowStep {
  /** Days after the previous step (0 = immediately). The first step's delay is from enrollment. */
  delayDays: number;
  channel: 'email' | 'sms';
  purpose: string;
  /** Email steps: the subject; the body is generated at build time. */
  subject?: string;
  /** SMS steps: the final, send-ready message. */
  message?: string;
}

/**
 * A planned automation — an ongoing sequence a contact moves through, as
 * opposed to a campaign's one-off touches. Built as a Loomi Flow: trigger →
 * (wait →) step → …, every step a draft node the person finishes in the flow
 * builder. `trigger` is a plain-English suggestion; the flow's real trigger is
 * set in the builder.
 */
export interface CampaignPlanFlowSpec {
  key: string;
  purpose: string;
  /** Plain English: who should enter this flow and when. Suggestion only. */
  trigger?: string;
  steps: CampaignPlanFlowStep[];
}

export interface CampaignPlanAudience {
  /** Plain-English description of who this should reach. Suggestion only —
   *  the builder never resolves contacts or drives a send from this. */
  description?: string;
  suggestedListId?: string | null;
  suggestedAudienceId?: string | null;
  estimatedSizeNote?: string;
}

export interface CampaignPlanClarification {
  id: string;
  question: string;
  /** Filled by the user in the confirm step; fed back into generation. */
  answer?: string | null;
}

/** An image the user uploaded for the campaign, for the AI to place. `kind`
 *  (derived from the filename, user-overridable) routes it to the right medium. */
export interface CampaignPlanAsset {
  url: string;
  filename: string;
  kind: 'email' | 'landingPage' | 'form' | 'generic';
  altText?: string;
}

export interface CampaignPlan {
  version: number;
  summary: string;
  /** How emails are generated: 'html' (complete HTML, code editor) or 'blocks'
   *  (drag-and-drop visual builder). Defaults to 'html'. User-toggleable. */
  emailFormat?: 'html' | 'blocks';
  /** User-uploaded brand images the AI should place, routed by `kind`. */
  assets?: CampaignPlanAsset[];
  audience: CampaignPlanAudience;
  clarifications: CampaignPlanClarification[];
  emails: CampaignPlanEmailSpec[];
  sms: CampaignPlanSmsSpec[];
  landingPages: CampaignPlanLandingPageSpec[];
  forms: CampaignPlanFormSpec[];
  flows: CampaignPlanFlowSpec[];
}

// ── Asset summaries (overview / list) ──
/**
 * What a campaign can CONTAIN — a superset of what the builder can generate.
 *
 * `ad` is deliberately not a `CampaignChannel`: channels are what the AI planner
 * knows how to produce, and it does not plan ads. Ad creatives arrive in a
 * campaign the other way round — the OEM offer run creates the container and
 * puts its designs and its offer email in it — so they belong here and nowhere
 * near `PHASE_1_CHANNELS`.
 */
export type CampaignAssetKind = CampaignChannel | 'ad';

export interface CampaignAssetSummary {
  kind: CampaignAssetKind;
  id: string;
  name: string;
  status: string;
  /** Plan key stamped into the asset's metadata at generation time. */
  planKey?: string | null;
  /** Inline-preview payload (overview). Email: rendered HTML. SMS: message + media. */
  renderedHtml?: string | null;
  smsMessage?: string | null;
  smsMediaUrls?: string[];
  /** Landing page: rendered HTML body for an iframe preview. */
  lpHtml?: string | null;
  /** Form: field summary for an inline preview. */
  formFields?: Array<{ label: string; type: string; required: boolean }> | null;
  /** Ad: the square preview the generator rendered. */
  adThumbnailUrl?: string | null;
  /** Ad: whether a person has chosen this design out of its offer group. */
  adSelected?: boolean;
}

export interface CampaignAssetCounts {
  email: number;
  sms: number;
  landingPage: number;
  form: number;
  flow: number;
  /** Ad designs from an OEM offer run. See CampaignAssetKind. */
  ad: number;
  total: number;
}

export interface CampaignSummary {
  id: string;
  name: string;
  accountKey: string | null;
  /** Derived container status (see {@link CampaignStatus}). */
  status: CampaignStatus;
  source: CampaignSource;
  goal: string | null;
  assetCounts: CampaignAssetCounts;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignDetail extends CampaignSummary {
  plan: CampaignPlan | null;
  assets: CampaignAssetSummary[];
}

// ── Live-build SSE events ──
// Emitted by POST /api/campaigns/[id]/generate and consumed by
// CampaignLiveBuild on the client.
export type CampaignBuildEvent =
  | { type: 'plan_started'; total: number }
  | { type: 'asset_started'; kind: CampaignAssetKind; key: string; label: string }
  | { type: 'asset_done'; kind: CampaignAssetKind; key: string; assetId: string; name: string }
  | { type: 'asset_error'; kind: CampaignAssetKind; key: string; message: string }
  | { type: 'complete'; campaignId: string; status: CampaignStatus }
  | { type: 'error'; message: string };
