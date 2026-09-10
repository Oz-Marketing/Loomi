/**
 * Campaign container service (AI Campaign Builder).
 *
 * A Campaign groups the channel assets a user generates (emails, SMS, and —
 * in later phases — landing pages, forms, flows) into one named, reviewable
 * unit. The container is purely organizational: each asset keeps its own
 * lifecycle and is edited/sent through its existing per-channel surface.
 *
 * Status model: only `building` and `archived` are written to the row.
 * `draft | ready | partial` are DERIVED at read time from the linked assets'
 * own statuses (see {@link deriveCampaignStatus}) so the container status can
 * never drift from reality.
 *
 * IMPORTANT: nothing here ever sends or publishes. The generator persists
 * drafts via the existing `createDraft*` / `updateDraft*` services; this layer
 * only creates the container and links assets to it.
 */
import { prisma } from '@/lib/prisma';
import * as templateService from '@/lib/services/templates';
import { parseLandingPageContent, isHtmlLandingPageTemplate } from '@/lib/landing-pages/types';
import { parseFormTemplate, collectFieldBlocks } from '@/lib/forms/types';
import type {
  CampaignAssetCounts,
  CampaignAssetKind,
  CampaignAssetSummary,
  CampaignDetail,
  CampaignPlan,
  CampaignSource,
  CampaignStatus,
  CampaignSummary,
} from '@/lib/campaigns/types';

/** Parse a JSON string, returning `fallback` on any error. Never throws. */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Status derivation ──────────────────────────────────────────────

/** Is this asset still in its draft-equivalent state (not yet sent/published/live)? */
function isAssetDraft(kind: CampaignAssetKind, status: string): boolean {
  switch (kind) {
    case 'email':
    case 'sms':
      return status === 'draft';
    case 'landingPage':
    case 'form':
      return status !== 'published';
    case 'flow':
      return status === 'draft';
    case 'ad':
      // An ad never leaves "draft" through its own status: it goes live only
      // through an AdLaunch, so its status column says nothing the campaign
      // badge could honestly report. Named here so the default branch below
      // stops being load-bearing for the one kind that reaches it every time.
      return true;
    default:
      return true;
  }
}

interface RawAsset {
  kind: CampaignAssetKind;
  status: string;
}

/**
 * Derive the container status shown in the UI. `building` and `archived` are
 * authoritative (persisted); everything else is computed from the assets.
 */
export function deriveCampaignStatus(
  row: { status: string; archivedAt: Date | null },
  assets: RawAsset[],
): CampaignStatus {
  if (row.archivedAt) return 'archived';
  if (row.status === 'building') return 'building';
  if (assets.length === 0) return 'draft';
  const leftDraft = assets.filter((a) => !isAssetDraft(a.kind, a.status)).length;
  return leftDraft === 0 ? 'ready' : 'partial';
}

// ── Selects ────────────────────────────────────────────────────────

// Light asset selects for rollup + overview. Email/SMS carry `metadata`
// (JSON) where the generator stamps the plan key; LP/Form/Flow either lack
// metadata or don't need it for Phase 1.
const emailAssetSelect = { id: true, name: true, subject: true, status: true, metadata: true, htmlContent: true } as const;
const smsAssetSelect = { id: true, name: true, message: true, status: true, metadata: true } as const;
const lpAssetSelect = { id: true, name: true, status: true, schema: true } as const;
const formAssetSelect = { id: true, name: true, status: true, schema: true } as const;
const flowAssetSelect = { id: true, name: true, status: true, metadata: true } as const;
// Ads carry no `metadata`, so there is no plan key to read — they are not planned
// by the AI builder, they arrive from an OEM offer run. `thumbnailUrl` stands in
// for the inline preview the other kinds get from their own content.
const adAssetSelect = {
  id: true,
  name: true,
  status: true,
  thumbnailUrl: true,
  archivedAt: true,
  selectedAt: true,
} as const;

const campaignWithAssetsInclude = {
  emailBlasts: { select: emailAssetSelect },
  smsBlasts: { select: smsAssetSelect },
  landingPages: { select: lpAssetSelect },
  forms: { select: formAssetSelect },
  flows: { select: flowAssetSelect },
  // Ads from an OEM offer run. Archived ones are filtered in `collectAssets`
  // rather than here: a run that produced six designs and had five archived on
  // the pick should read as one ad, not six.
  adCreatives: { select: adAssetSelect },
} as const;

function planKeyFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  const parsed = parseJson<{ campaignPlanKey?: string }>(metadata, {});
  return parsed?.campaignPlanKey ?? null;
}

// ── Mappers ────────────────────────────────────────────────────────

type CampaignWithAssets = Awaited<ReturnType<typeof loadCampaignWithAssets>>;

function loadCampaignWithAssets(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: campaignWithAssetsInclude,
  });
}

function collectAssets(row: NonNullable<CampaignWithAssets>): CampaignAssetSummary[] {
  const assets: CampaignAssetSummary[] = [];
  for (const e of row.emailBlasts) {
    assets.push({
      kind: 'email',
      id: e.id,
      name: e.name || e.subject || 'Untitled email',
      status: e.status,
      planKey: planKeyFromMetadata(e.metadata),
      renderedHtml: e.htmlContent || null,
    });
  }
  for (const s of row.smsBlasts) {
    assets.push({
      kind: 'sms',
      id: s.id,
      name: s.name || (s.message ? s.message.slice(0, 40) : 'Untitled SMS'),
      status: s.status,
      planKey: planKeyFromMetadata(s.metadata),
      smsMessage: s.message || null,
      smsMediaUrls: parseJson<{ mediaUrls?: string[] }>(s.metadata, {}).mediaUrls ?? [],
    });
  }
  for (const lp of row.landingPages) {
    const content = parseLandingPageContent(lp.schema);
    const lpHtml = content && isHtmlLandingPageTemplate(content) ? content.html : null;
    assets.push({ kind: 'landingPage', id: lp.id, name: lp.name, status: lp.status, lpHtml });
  }
  for (const f of row.forms) {
    const tpl = parseFormTemplate(f.schema);
    const formFields = tpl
      ? collectFieldBlocks(tpl)
          .filter((b) => b.type.startsWith('field_'))
          .map((b) => ({
            label: typeof b.props.label === 'string' ? b.props.label : b.type.replace('field_', ''),
            type: b.type.replace('field_', ''),
            required: b.props.required === true,
          }))
      : null;
    assets.push({ kind: 'form', id: f.id, name: f.name, status: f.status, formFields });
  }
  for (const fl of row.flows) {
    assets.push({
      kind: 'flow',
      id: fl.id,
      name: fl.name,
      status: fl.status,
      planKey: planKeyFromMetadata(fl.metadata),
    });
  }
  for (const ad of row.adCreatives) {
    // Archived designs are the ones a pick put away — the offer fan-out builds a
    // design per template and archives the losers. Counting them would report a
    // run that produced one usable ad as having produced six.
    if (ad.archivedAt) continue;
    assets.push({
      kind: 'ad',
      id: ad.id,
      name: ad.name,
      status: ad.status,
      adThumbnailUrl: ad.thumbnailUrl,
      adSelected: !!ad.selectedAt,
    });
  }
  return assets;
}

function countAssets(assets: CampaignAssetSummary[]): CampaignAssetCounts {
  const counts: CampaignAssetCounts = { email: 0, sms: 0, landingPage: 0, form: 0, flow: 0, ad: 0, total: assets.length };
  for (const a of assets) counts[a.kind] += 1;
  return counts;
}

function toDetail(row: NonNullable<CampaignWithAssets>): CampaignDetail {
  const assets = collectAssets(row);
  return {
    id: row.id,
    name: row.name,
    accountKey: row.accountKey,
    status: deriveCampaignStatus(row, assets),
    source: row.source as CampaignSource,
    goal: row.goal,
    assetCounts: countAssets(assets),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    plan: parseJson<CampaignPlan | null>(row.plan, null),
    assets,
  };
}

// ── Public API ─────────────────────────────────────────────────────

export async function createCampaign(input: {
  name: string;
  accountKey: string;
  source: CampaignSource;
  goal?: string | null;
  plan?: CampaignPlan | null;
  contextSnapshot?: string | null;
  createdByUserId?: string | null;
  createdByRole?: string | null;
}): Promise<CampaignDetail> {
  const created = await prisma.campaign.create({
    data: {
      name: input.name.trim() || 'Untitled campaign',
      accountKey: input.accountKey,
      source: input.source,
      status: 'draft',
      goal: input.goal ?? null,
      plan: input.plan ? JSON.stringify(input.plan) : null,
      contextSnapshot: input.contextSnapshot ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdByRole: input.createdByRole ?? null,
    },
    include: campaignWithAssetsInclude,
  });
  return toDetail(created);
}

/** Full container + linked assets + derived status. Null if not found. */
export async function getCampaignWithAssets(id: string): Promise<CampaignDetail | null> {
  const row = await loadCampaignWithAssets(id);
  return row ? toDetail(row) : null;
}

/** Raw row accessor for auth checks (accountKey) without loading assets. */
export async function getCampaignRow(id: string) {
  return prisma.campaign.findUnique({ where: { id } });
}

export async function listCampaigns(options?: {
  accountKeys?: string[] | null;
  includeArchived?: boolean;
  limit?: number;
  /**
   * Restrict to machine-generated OEM runs.
   *
   * Set for the CLIENT tier, whose entitlement is the offers built for them and
   * nothing else. It is enforced here rather than in the list component because
   * a UI filter is not an entitlement — the route would still hand a dealer
   * every manual blast, flow and landing page on their account if they asked it
   * directly.
   */
  automationOnly?: boolean;
}): Promise<CampaignSummary[]> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50));
  const scope = options?.accountKeys;
  const where: Record<string, unknown> = {};
  if (!options?.includeArchived) where.archivedAt = null;
  // scope `null` (developer/super_admin) or `[]` (unrestricted admin) = no filter.
  if (scope && scope.length > 0) where.accountKey = { in: scope };
  if (options?.automationOnly) where.source = 'automation';

  const rows = await prisma.campaign.findMany({
    where,
    include: campaignWithAssetsInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => {
    const detail = toDetail(row);
    // List view doesn't need the full plan/assets payload.
    const { plan: _plan, assets: _assets, ...summary } = detail;
    return summary;
  });
}

/** Replace the persisted build plan (whole-object). */
export async function updateCampaignPlan(id: string, plan: CampaignPlan): Promise<void> {
  await prisma.campaign.update({ where: { id }, data: { plan: JSON.stringify(plan) } });
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; status?: CampaignStatus; contextSnapshot?: string | null },
): Promise<CampaignDetail | null> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim() || 'Untitled campaign';
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.contextSnapshot !== undefined) data.contextSnapshot = patch.contextSnapshot;
  await prisma.campaign.update({ where: { id }, data });
  return getCampaignWithAssets(id);
}

/** Persist the authoritative `building`/`archived` status (or reset to draft). */
export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<void> {
  await prisma.campaign.update({ where: { id }, data: { status } });
}

export async function archiveCampaign(id: string): Promise<void> {
  await prisma.campaign.update({
    where: { id },
    data: { status: 'archived', archivedAt: new Date() },
  });
}

/** Un-archive a campaign. Status resets to 'draft'; the derived status recomputes. */
export async function restoreCampaign(id: string): Promise<void> {
  await prisma.campaign.update({
    where: { id },
    data: { status: 'draft', archivedAt: null },
  });
}

/**
 * Hard-delete a campaign AND every asset it generated, so the pieces disappear
 * from their channel surfaces too (Email & SMS, Landing Pages, Forms). The
 * asset FKs are SetNull (which would only orphan them), so we delete the assets
 * explicitly. Child rows (recipients, form submissions, LP events) cascade via
 * their own FKs. Auto-created email Templates (referenced by each email's
 * metadata.templateSlug, one per campaign email, not shared) are removed too.
 */
export async function deleteCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      emailBlasts: { select: { id: true, metadata: true } },
      smsBlasts: { select: { id: true } },
      landingPages: { select: { id: true } },
      forms: { select: { id: true } },
    },
  });
  if (!campaign) return;

  const templateSlugs = campaign.emailBlasts
    .map((e) => parseJson<{ templateSlug?: string }>(e.metadata, {}).templateSlug)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  await prisma.$transaction(async (tx) => {
    if (campaign.emailBlasts.length) {
      await tx.emailBlast.deleteMany({ where: { id: { in: campaign.emailBlasts.map((e) => e.id) } } });
    }
    if (campaign.smsBlasts.length) {
      await tx.smsBlast.deleteMany({ where: { id: { in: campaign.smsBlasts.map((s) => s.id) } } });
    }
    if (campaign.landingPages.length) {
      await tx.landingPage.deleteMany({ where: { id: { in: campaign.landingPages.map((l) => l.id) } } });
    }
    if (campaign.forms.length) {
      await tx.form.deleteMany({ where: { id: { in: campaign.forms.map((f) => f.id) } } });
    }
    await tx.campaign.delete({ where: { id } });
  });

  // Best-effort (outside the txn so an FK edge case can't block the delete):
  // remove the auto-generated email templates this campaign created.
  if (templateSlugs.length) {
    await prisma.template.deleteMany({ where: { slug: { in: templateSlugs } } }).catch(() => {});
  }
}

/**
 * Attach a freshly-created asset draft to a campaign container by stamping its
 * `campaignId` FK. Used by both the generator and the manual wizard.
 */
/**
 * Create an account-scoped Template from a campaign email's content and return
 * its slug. Backing each campaign email with a real Template (not just rendered
 * HTML on the EmailBlast) is what makes the messaging template step preview
 * render and the editor open — that step keys off metadata.templateSlug.
 *
 * Pass v2 JSON content for a visually-editable email, or HTML for a code-mode
 * one. Used by both the AI generator and the manual wizard.
 */
/**
 * `Template.type` for a body a campaign generated, as opposed to one a designer
 * authored. Excluded from library listings by `buildWhere`.
 */
export const CAMPAIGN_TEMPLATE_TYPE = 'campaign';

export async function createCampaignEmailTemplate(input: {
  accountKey: string;
  title: string;
  content: string;
  previewText?: string;
  createdByUserId?: string;
}): Promise<string> {
  const safe =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'email';
  const base = `${input.accountKey}-${safe}`;

  // Find a free slug (mirrors findAvailableSlug in the templates route), then
  // create with a P2002 retry to cover a concurrent-generation race.
  let slug = base;
  let n = 1;
  while (await templateService.getTemplate(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await templateService.createTemplate({
        slug,
        title: input.title,
        // NOT 'design'. A generated body is per-campaign scratch that backs the
        // blast editor (that step keys off `metadata.templateSlug`) and is
        // deleted with the campaign — it is not a library artifact. Typing it
        // apart keeps it out of the Templates page AND out of the shell pickers
        // in `preview-offer-email` and `shadow-report`, which list account-owned
        // `design` rows as candidates a run could splice offers into.
        type: CAMPAIGN_TEMPLATE_TYPE,
        content: input.content,
        preheader: input.previewText || undefined,
        createdByUserId: input.createdByUserId,
        accountKey: input.accountKey,
      });
      return slug;
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        n += 1;
        slug = `${base}-${n}`;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not allocate a unique template slug');
}

/**
 * Write the generated offer-email body to a template, REUSING the row when one
 * already exists.
 *
 * `createCampaignEmailTemplate` above always mints a fresh slug
 * (`acct-offers`, `-2`, `-3`, …) because it was written for the AI builder,
 * where each generated email genuinely is a new asset. The OEM offer email is
 * the opposite: ONE recurring send whose body is rebuilt every month, and again
 * whenever a dealer picks a different design. Minting a row per rebuild filled
 * the Templates page with near-identical "Offers" entries — 12 a year per
 * account before anyone touches a design, and one more per pick.
 *
 * So the caller records the slug it got and hands it back; we update in place.
 * `snapshot: false` — the body is machine-generated and regenerated on a
 * schedule, so a version per rebuild is churn, not history. Falls through to a
 * create when the recorded row has been deleted.
 */
export async function upsertCampaignEmailTemplate(
  existingSlug: string | null | undefined,
  input: {
    accountKey: string;
    title: string;
    content: string;
    previewText?: string;
    createdByUserId?: string;
  },
): Promise<string> {
  if (existingSlug) {
    const prior = await prisma.template
      .findUnique({ where: { slug: existingSlug }, select: { accountKey: true, published: true } })
      .catch(() => null);

    // NEVER overwrite a shared library template. A generated body and the SHELL
    // it was built from are different things, and a caller that confuses them
    // writes the rendered email over the shell — destroying its `{{offers}}`
    // marker and breaking every future run with `shell_template_no_placeholder`.
    // That is not hypothetical: it happened the first time this reuse existed.
    // Generated rows are account-scoped and unpublished; a library shell is
    // account-less or published, so the shapes separate cleanly.
    const isLibraryTemplate = prior !== null && (prior.accountKey === null || prior.published);

    if (prior && !isLibraryTemplate) {
      try {
        // Title is deliberately NOT passed. `updateTemplate` no longer
        // re-derives the slug — the slug is frozen at creation — but a
        // generated row's title is not the campaign's to overwrite either, and
        // reuse only needs the content.
        await templateService.updateTemplate(
          existingSlug,
          { content: input.content, preheader: input.previewText || undefined },
          false,
          input.createdByUserId,
        );
        return existingSlug;
      } catch {
        // Deleted mid-flight. Fall through and make a new one.
      }
    }
  }
  return createCampaignEmailTemplate(input);
}

export async function linkAssetToCampaign(
  kind: CampaignAssetKind,
  assetId: string,
  campaignId: string,
): Promise<void> {
  switch (kind) {
    case 'email':
      await prisma.emailBlast.update({ where: { id: assetId }, data: { campaignId } });
      return;
    case 'sms':
      await prisma.smsBlast.update({ where: { id: assetId }, data: { campaignId } });
      return;
    case 'landingPage':
      await prisma.landingPage.update({ where: { id: assetId }, data: { campaignId } });
      return;
    case 'form':
      await prisma.form.update({ where: { id: assetId }, data: { campaignId } });
      return;
    case 'flow':
      await prisma.loomiFlow.update({ where: { id: assetId }, data: { campaignId } });
      return;
  }
}
