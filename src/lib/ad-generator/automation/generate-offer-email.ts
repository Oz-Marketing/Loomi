import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { renderEmailTemplate } from '@/lib/email/render';
import { createDraftEmailBlast, updateEmailBlastDraft } from '@/lib/services/email-blasts';
import { upsertCampaignEmailTemplate } from '@/lib/services/campaigns';
import type { AdData } from '../types';
import { assembleOffer } from '../offer-text';
import type { GeneratedAd } from './generate-ads';
import {
  type OfferEmailInput,
  type OfferEmailVehicle,
} from './offer-email-doc';
import {
  buildDocForShell,
  resolveEmailShellSlug,
  reusableTemplateSlug,
  type OfferEmailMetadata,
} from './offer-email-shell';

/**
 * Phase 4b — the companion offer email.
 *
 * Closes the half of `docs/ad-generator-campaign-launch.md` ("The direction
 * beyond this") the paid pipeline left open: one OEM programme producing ads
 * AND an email, pointed at the same offers, with the disclaimer resolved once
 * and reused rather than re-derived.
 *
 * Shape, and why:
 *
 * - **One email per RUN, not per offer.** An OEM drop routinely covers six
 *   models; six sends to one dealer list is how a database gets burned. The
 *   featured offers are exactly the ones that produced ads, so the email can
 *   never advertise something the paid side isn't running.
 * - **Always a DRAFT.** There is deliberately no `mode: 'ready'` equivalent
 *   here. The ads' auto-publish path creates PAUSED campaigns; email has no
 *   pause, and a wrong send is permanent — so a person always presses send.
 * - **Idempotent on the offer set.** Re-running over unchanged offers updates
 *   the one draft; a new offer produces a new key and a new draft. Mirrors
 *   `AdCreative.offerFingerprint`.
 *
 * Server-only.
 */

export interface OfferEmailResult {
  accountKey: string;
  /** Null when nothing was produced — see `reason`. */
  blastId: string | null;
  campaignId: string | null;
  /** How many offers the email features. */
  offers: number;
  /** True when this run updated an existing draft rather than creating one. */
  updated: boolean;
  /** Set when no email was produced, for the run log. */
  reason: string | null;
  warnings: string[];
}

export const OFFER_EMAIL_CONFIG_SELECT = {
  accountKey: true,
  offerTypePriority: true,
  emailEnabled: true,
  emailTemplateId: true,
  emailAudienceId: true,
  emailMaxOffers: true,
} as const;

export interface OfferEmailConfigRow {
  accountKey: string;
  offerTypePriority: string;
  emailEnabled: boolean;
  emailTemplateId: string | null;
  emailAudienceId: string | null;
  emailMaxOffers: number;
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Thousands separators, matching how the ad renders money. */
function money(raw: string | undefined): string {
  const n = Number((raw ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * The offer line, from the ad's own filled fields.
 *
 * Deliberately built from `AdData` rather than re-formatted from the raw
 * incentive: these are the exact numbers that went onto the creative, and an
 * email whose payment disagrees with the ad beside it is worse than no email.
 */
export function offerHeadline(data: AdData): { headline: string; subhead: string } {
  const type = data.offerType ?? '';
  switch (type) {
    case 'lease': {
      const pay = money(data.monthlyPayment);
      const term = (data.leaseTerm ?? '').trim();
      const due = money(data.dueAtSigning);
      return {
        headline: pay ? `$${pay}/mo${term ? ` · ${term} months` : ''}` : 'Lease offer',
        subhead: due ? `$${due} due at signing` : '',
      };
    }
    case 'apr': {
      const rate = (data.aprRate ?? '').trim();
      const term = (data.aprTerm ?? '').trim();
      return {
        headline: rate ? `${rate}% APR${term ? ` for ${term} months` : ''}` : 'Financing offer',
        subhead: data.financialInstitution?.trim()
          ? `Financing through ${data.financialInstitution.trim()}`
          : '',
      };
    }
    case 'discount': {
      const amt = money(data.discountAmount);
      const style = data.discountLabelStyle === 'cash_back' ? 'cash back' : 'off MSRP';
      return { headline: amt ? `$${amt} ${style}` : 'Cash offer', subhead: '' };
    }
    case 'sales_price': {
      const price = money(data.salePrice);
      const msrp = money(data.msrp);
      return {
        headline: price ? `$${price}` : 'Special price',
        subhead: msrp ? `MSRP $${msrp}` : '',
      };
    }
    default:
      return { headline: (data.price ?? '').trim() || 'Current offer', subhead: (data.terms ?? '').trim() };
  }
}

/**
 * Stable key over the SET of offers featured.
 *
 * Sorted, so the same offers in a different order are the same email — the
 * generate loop's iteration order isn't a contract, and keying on it would
 * produce a fresh draft on a run that found nothing new.
 */
export function offerEmailKey(accountKey: string, fingerprints: string[]): string {
  const digest = createHash('sha256')
    .update([...fingerprints].sort().join('|'))
    .digest('hex')
    .slice(0, 16);
  return `adgen:${accountKey}:${digest}`;
}

/** Order offers by the account's configured offer-type preference, then cap. */
export function rankOffers<T extends { offerType: string }>(
  items: T[],
  priority: string[],
  cap: number,
): T[] {
  const rank = (t: string) => {
    const i = priority.indexOf(t);
    return i === -1 ? priority.length : i;
  };
  return [...items]
    .sort((a, b) => rank(a.offerType) - rank(b.offerType))
    .slice(0, Math.max(1, cap));
}

/**
 * Build and persist the companion email for one generate run.
 *
 * `generated` is the run's output — pass it straight through from
 * `generateForAccount`.
 */
export async function generateOfferEmail(
  config: OfferEmailConfigRow,
  generated: GeneratedAd[],
  opts: { runId?: string | null } = {},
): Promise<OfferEmailResult> {
  const base: OfferEmailResult = {
    accountKey: config.accountKey,
    blastId: null,
    campaignId: null,
    offers: 0,
    updated: false,
    reason: null,
    warnings: [],
  };

  if (!config.emailEnabled) return { ...base, reason: 'email_disabled' };
  if (!generated.length) return { ...base, reason: 'no_offers' };

  const account = await prisma.account.findUnique({
    where: { key: config.accountKey },
    select: { key: true, dealer: true, branding: true, logos: true, website: true },
  });
  if (!account) return { ...base, reason: 'account_missing' };

  // ── the offers, as they were put onto the creatives ──
  const creatives = await prisma.adCreative.findMany({
    where: { id: { in: generated.map((g) => g.creativeId) } },
    select: { id: true, data: true, offerFingerprint: true },
  });
  const dataById = new Map(creatives.map((c) => [c.id, safeJson<AdData>(c.data) ?? {}]));

  // OEM prose lives on the snapshot, not the creative — the fingerprint
  // deliberately excludes it (the feed rewords the same programme between
  // refreshes), so it is looked up rather than derived.
  // The BARE fingerprints, not `offerFingerprint` — that is a composite
  // (`vehicle-slug:print`) and the snapshot table is keyed on the bare hash, so
  // matching on it found nothing and every email shipped without the OEM prose
  // this lookup exists to recover. Falls back to the composite for a caller that
  // predates `offerPrints`, which matches nothing but cannot throw.
  const fingerprints = generated.flatMap((g) => g.offerPrints ?? [g.offerFingerprint]).filter(Boolean);
  const snapshots = await prisma.oemOfferSnapshot.findMany({
    where: { accountKey: config.accountKey, fingerprint: { in: fingerprints } },
    select: { fingerprint: true, payload: true },
  });
  const incentiveByFingerprint = new Map<string, MarketCheckIncentive>();
  for (const s of snapshots) {
    const inc = safeJson<MarketCheckIncentive>(s.payload);
    if (inc && !incentiveByFingerprint.has(s.fingerprint)) {
      incentiveByFingerprint.set(s.fingerprint, inc);
    }
  }

  // ── one row per OFFER, not per design ──
  //
  // The offer fan-out builds a design per template for the same offer, and every
  // sibling carries the same `offerFingerprint` by construction — that shared key
  // is what groups them in the UI. Mapping straight over `generated` would put
  // the same vehicle and payment into the email once per design, so the
  // recommended sibling stands for the group. Falls back to the first row when
  // resolution recommended nothing, which is a real state (see planVariants).
  const oneAdPerOffer = new Map<string, GeneratedAd>();
  for (const g of generated) {
    const seen = oneAdPerOffer.get(g.offerFingerprint);
    if (!seen || (g.recommended && !seen.recommended)) oneAdPerOffer.set(g.offerFingerprint, g);
  }

  const candidates = [...oneAdPerOffer.values()].map((g) => {
    const data = dataById.get(g.creativeId) ?? {};
    // First of the ad's prints that resolves — a dual ad leads with slot 1, whose
    // program is the one the email headline describes.
    const inc =
      (g.offerPrints ?? []).map((p) => incentiveByFingerprint.get(p)).find(Boolean) ?? null;
    const { headline, subhead } = offerHeadline(data);
    // The PLATE's own three-part offer, from the same `assembleOffer` the
    // creative renders through. `offerHeadline` above still supplies the prose
    // form for the subject and preview text — a sentence wants "3.9% APR for 60
    // months", a card wants the figure and its label stacked — but the figures
    // on screen now come from one formatter, so the email and the ad cannot
    // round or abbreviate differently.
    const block = assembleOffer(data);
    const vehicle: OfferEmailVehicle = {
      name: (data.vehicleName ?? '').trim() || g.vehicle,
      imageUrl: (data.vehicleImageUrl ?? '').trim() || null,
      offerType: (data.offerType ?? '').trim(),
      headline,
      subhead,
      offerLabel: block?.label || undefined,
      offerMain: block?.main || undefined,
      offerTerms: block?.terms || undefined,
      programName: inc?.programName?.trim() || null,
      description: inc?.description?.trim() || null,
      offerDetails: inc?.offerDetails?.trim() || null,
      eligibility: inc?.eligibility?.trim() || null,
      disclaimer: (data.disclaimer ?? '').trim(),
      expiration: (data.expiration ?? '').trim() || null,
    };
    return { ...vehicle, fingerprint: g.offerFingerprint };
  });

  // An offer with no resolved disclaimer must not be emailed. Preflight already
  // gates the ad; this is the same gate for the email, and it fails the OFFER
  // rather than the whole send so one bad row can't silence the rest.
  const usable = candidates.filter((c) => {
    if (c.disclaimer) return true;
    base.warnings.push(`${c.name}: no resolved disclaimer — left out of the email.`);
    return false;
  });
  if (!usable.length) return { ...base, reason: 'no_disclaimer' };

  const ranked = rankOffers(usable, jsonArray(config.offerTypePriority), config.emailMaxOffers);

  // Own branding only — deliberately NOT the inherited chain the playbooks audit
  // walks. `generate-ads` resolves the creative's colours the same way, and an
  // email whose brand colour disagrees with the ad sitting next to it is worse
  // than one that inherits nothing.
  const branding = safeJson<{ colors?: Record<string, string> }>(account.branding ?? null);
  const logos = safeJson<Record<string, string>>(account.logos ?? null);
  const input: OfferEmailInput = {
    dealerName: account.dealer,
    accentColor: branding?.colors?.primary || '#1a1a1a',
    logoUrl: logos?.light || logos?.dark || null,
    ctaUrl: account.website?.trim() || null,
    ctaLabel: 'View inventory',
    vehicles: ranked,
  };

  // ── document: the account's shell, which a playbook presets ──
  //
  // ONE shell per run, not one per plate. The fan-out builds a design per
  // template, but a dealer's list gets a single send carrying every offer — so
  // the email does not correspond to any one plate and cannot follow the
  // dealer's design choice. The shell comes from `AdAutomationConfig`, which the
  // creative playbook presets alongside the plates it names. Null composes a
  // standalone document from the account's branding.
  const shellSlug = resolveEmailShellSlug(config.emailTemplateId);
  const doc = await buildDocForShell(input, shellSlug);
  if (!doc) {
    return {
      ...base,
      reason: shellSlug ? 'shell_template_no_placeholder' : 'shell_template_missing',
    };
  }

  const subject = `${account.dealer} — current offers`;
  const previewText = ranked
    .map((v) => `${v.name}: ${v.headline}`)
    .join(' · ')
    .slice(0, 150);
  doc.subject = subject;
  doc.preheader = previewText;

  const html = await renderEmailTemplate(doc);
  const textContent = await renderEmailTemplate(doc, { plainText: true });

  // ── audience ──
  //
  // The draft is pre-targeted at the configured segment. When none is set the
  // draft lands with no recipients, which is a safe state: it cannot send.
  let sourceAudienceId: string | null = null;
  let sourceFilter: string | null = null;
  if (config.emailAudienceId) {
    const audience = await prisma.audience.findUnique({
      where: { id: config.emailAudienceId },
      select: { id: true, accountKey: true, filters: true },
    });
    if (audience && audience.accountKey === config.accountKey) {
      sourceAudienceId = audience.id;
      sourceFilter = audience.filters;
    } else {
      // Wrong-account or deleted audience: leave the draft untargeted rather
      // than silently mailing another rooftop's list.
      base.warnings.push('Configured audience is missing or belongs to another account.');
    }
  }

  const automationKey = offerEmailKey(config.accountKey, ranked.map((v) => v.fingerprint));
  const existing = await prisma.emailBlast.findUnique({
    where: { automationKey },
    select: { id: true, status: true, campaignId: true },
  });

  // Never touch a draft that has left the draft state — a person has scheduled
  // or sent it, and rewriting its body underneath them is not a refresh.
  if (existing && existing.status !== 'draft') {
    return {
      ...base,
      blastId: existing.id,
      campaignId: existing.campaignId,
      offers: ranked.length,
      reason: 'already_sent',
    };
  }

  // Reuse the template row this draft already owns. A run that refreshes an
  // existing draft (unchanged offers, new numbers) must not leave a second
  // "Offers" template behind every time it fires.
  let priorSlug: string | null = null;
  if (existing) {
    const prior = await prisma.emailBlast
      .findUnique({ where: { id: existing.id }, select: { metadata: true } })
      .catch(() => null);
    try {
      priorSlug = prior?.metadata
        ? ((JSON.parse(prior.metadata) as { templateSlug?: string }).templateSlug ?? null)
        : null;
    } catch {
      priorSlug = null;
    }
  }
  // Same shell guard as `restyleOfferEmail`: the generated body must never be
  // written over the shell it was built from.
  const reuseSlug = reusableTemplateSlug(priorSlug, shellSlug);
  const templateSlug = await upsertCampaignEmailTemplate(reuseSlug, {
    accountKey: config.accountKey,
    title: subject,
    content: JSON.stringify(doc),
    previewText,
  });

  // The container the ads and the email share — the `Campaign` link
  // `AdCreative.campaignId` was reserved for.
  let campaignId = existing?.campaignId ?? null;
  if (!campaignId) {
    const container = await prisma.campaign.create({
      data: {
        name: subject,
        accountKey: config.accountKey,
        status: 'ready',
        source: 'automation',
        goal: `OEM offer run${opts.runId ? ` (${opts.runId})` : ''}`,
      },
      select: { id: true },
    });
    campaignId = container.id;
  }

  let blastId: string;
  let updated = false;
  if (existing) {
    blastId = existing.id;
    updated = true;
  } else {
    const draft = await createDraftEmailBlast({
      name: subject,
      accountKeys: [config.accountKey],
    });
    blastId = draft.id;
    await prisma.emailBlast.update({ where: { id: blastId }, data: { automationKey } });
  }

  await updateEmailBlastDraft(blastId, {
    subject,
    previewText,
    htmlContent: html,
    textContent,
    sourceType: 'template-library',
    sourceAudienceId,
    sourceFilter,
    // `offerInput` is what makes a later design pick able to re-splice this
    // email through a different shell without re-deriving the offers.
    metadata: JSON.stringify({
      templateSlug,
      runId: opts.runId ?? null,
      offers: ranked.length,
      offerInput: input,
      shellSlug,
    } satisfies OfferEmailMetadata),
  });
  await prisma.emailBlast.update({ where: { id: blastId }, data: { campaignId } });

  // Hang the run's ads off the same container.
  await prisma.adCreative.updateMany({
    where: { id: { in: generated.map((g) => g.creativeId) } },
    data: { campaignId },
  });

  return {
    accountKey: config.accountKey,
    blastId,
    campaignId,
    offers: ranked.length,
    updated,
    reason: null,
    warnings: base.warnings,
  };
}
