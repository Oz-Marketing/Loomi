'use client';

/**
 * The ads a generate run produced, folded into the offers they advertise.
 *
 * WHY THIS EXISTS SEPARATELY from the plain tile grid it replaces. The offer
 * fan-out builds one design per published template against the same offer, so a
 * run of two offers and four templates is eight `AdCreative` rows. Rendered flat
 * those read as eight ads a dealer has to approve, when they are two decisions.
 * This folds them back: one tile per OFFER, with "Compare N designs" when there
 * is a choice to make.
 *
 * WHY IT LIVES ON CAMPAIGNS. A dealer's Studio surface is Campaigns — the ads
 * and the offer email are one deliverable and this is the only place they sit
 * together. Picking a design here also settles the EMAIL: the pick re-splices
 * the run's offer email through the shell paired with the winning ad template
 * (`AdTemplateDoc.emailTemplateSlug`), so the plate and the send always match.
 *
 * It reads the ad-generator APIs rather than the campaign payload because the
 * compare modal needs each design's full doc + data to render a true preview,
 * and fattening `CampaignAssetSummary` with every ad's document would load that
 * onto the campaign LIST too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { groupVariants } from '@/lib/ad-generator/variant-groups';
import { VariantCompareModal, type CompareVariant } from '@/components/ad-generator/variant-compare-modal';
import { AdPreviewThumb } from '@/components/ad-generator/ad-preview-thumb';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData, AdTemplate } from '@/lib/ad-generator/types';

/** The subset of the creatives payload this surface needs. */
type Creative = {
  id: string;
  name: string;
  templateId: string;
  status: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  doc?: TemplateDoc | null;
  data: AdData;
  offerGroupKey?: string | null;
  recommended?: boolean;
  selectedAt?: string | null;
  reviewNotes?: string | null;
  archivedAt?: string | null;
  campaignId?: string | null;
};

export function CampaignOfferDesigns({
  adIds,
  accountKey,
  editorHref,
  onChanged,
}: {
  /** The campaign's ad asset ids — the run's output, archived ones excluded. */
  adIds: string[];
  accountKey: string | null;
  /** Builds the ad-editor link for one design. */
  editorHref: (id: string) => string;
  /** Called after a pick lands, so the campaign payload can refetch. */
  onChanged?: () => void;
}) {
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [templates, setTemplates] = useState<AdTemplate[]>([]);
  const [branding, setBranding] = useState<Record<string, unknown> | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountKey) return;
    try {
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/ad-generator/creatives?accountKey=${encodeURIComponent(accountKey)}`),
        fetch(`/api/ad-generator/templates-doc?accountKey=${encodeURIComponent(accountKey)}`),
      ]);
      const cJson = cRes.ok ? await cRes.json() : { creatives: [] };
      const tJson = tRes.ok ? await tRes.json() : { templates: [], branding: null };
      setCreatives(Array.isArray(cJson.creatives) ? cJson.creatives : []);
      setTemplates(Array.isArray(tJson.templates) ? tJson.templates : []);
      setBranding(tJson.branding ?? null);
    } catch {
      // The tiles below fall back to "no designs loaded" rather than throwing —
      // the campaign's email half must still render.
      setCreatives([]);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** This campaign's designs only, folded into offer groups. */
  const groups = useMemo(() => {
    if (!creatives) return null;
    const mine = new Set(adIds);
    const rows = creatives.filter((c) => mine.has(c.id) && !c.archivedAt);
    return groupVariants(rows);
  }, [creatives, adIds]);

  const compareGroup = useMemo(
    () => groups?.find((g) => g.key === compareKey) ?? null,
    [groups, compareKey],
  );

  async function pick(id: string, undo = false) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ad-generator/creatives/${id}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(undo ? { undo: true } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || 'Could not save that choice');
        return;
      }
      // The pick may also re-point the run's offer email at the winning
      // template's shell — but only when that template has a paired shell and
      // the blast is still a draft. Say so only when it actually happened;
      // claiming the email changed when it did not is worse than saying nothing.
      toast.success(
        undo
          ? 'Choice undone'
          : json?.emailRestyled
            ? 'Design selected — the offer email now matches it'
            : 'Design selected',
      );
      await load();
      onChanged?.();
    } catch {
      toast.error('Could not save that choice');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Apply one template to every offer in the run.
   *
   * Sequential, not `Promise.all`: each pick archives siblings and kicks off the
   * deferred size renders, and firing seven of those at once is how the render
   * queue gets starved. A run is a handful of offers, so the wait is short and
   * the ordering is worth more than the parallelism.
   *
   * Offers that already use this template, or have no variant built from it, are
   * skipped rather than reported as failures — a playbook can permit a design
   * that a particular offer could not be built on.
   */
  async function pickAll(templateId: string) {
    if (!groups) return;
    const targets = groups
      .filter((g) => g.selected?.templateId !== templateId)
      .map((g) => g.variants.find((v) => v.templateId === templateId))
      .filter((v): v is Creative => !!v);
    if (targets.length === 0) return;

    setBusyId(targets[0].id);
    let done = 0;
    try {
      for (const v of targets) {
        setBusyId(v.id);
        const res = await fetch(`/api/ad-generator/creatives/${v.id}/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) done += 1;
      }
      toast.success(
        done === targets.length
          ? `Using this template for ${done} offer${done === 1 ? '' : 's'}`
          : `Applied to ${done} of ${targets.length} offers`,
      );
      setCompareKey(null);
      await load();
      onChanged?.();
    } catch {
      toast.error('Could not apply that template everywhere');
    } finally {
      setBusyId(null);
    }
  }

  if (groups === null) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading designs…</p>;
  }
  if (groups.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No designs loaded.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((group) => {
          const lead = group.selected ?? group.lead;
          const choice = group.variants.length > 1 && !group.selected;
          return (
            <div
              key={group.key}
              className={`group relative flex flex-col overflow-hidden rounded-xl border transition-colors ${
                choice
                  ? 'border-[var(--primary)]/50 hover:border-[var(--primary)]'
                  : 'border-[var(--border)] hover:border-[var(--primary)]'
              }`}
            >
              <Link href={editorHref(lead.id)} className="block">
                {/* Three sources, in order of fidelity. The stored thumbnail is
                    the real render but only exists AFTER a pick — the deferred
                    sizes are what produce it — so a run that nobody has decided
                    yet has none, which is exactly when a dealer most needs to
                    see the plate. Falling back to a live render off the ad's own
                    doc + data (the same thing the compare modal draws) means the
                    grid shows the design from the moment it is generated. */}
                {lead.thumbnailUrl ? (
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-[var(--muted)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lead.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : lead.doc ? (
                  <AdPreviewThumb
                    template={adTemplateFromDoc(lead.id, lead.doc)}
                    data={lead.data}
                    branding={branding as Parameters<typeof AdPreviewThumb>[0]['branding']}
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-[var(--muted)]">
                    <span className="px-3 text-center text-[11px] text-[var(--muted-foreground)]">
                      No preview yet
                    </span>
                  </div>
                )}
              </Link>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <span className="truncate text-xs font-medium text-[var(--foreground)]">
                  {group.name}
                </span>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
                  {group.selected && <span className="text-emerald-500">In use</span>}
                  <span>{lead.status}</span>
                </div>
                {group.variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCompareKey(group.key)}
                    className="mt-0.5 inline-flex items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                  >
                    <Squares2X2Icon className="h-3 w-3" />
                    {group.selected ? 'Change template' : 'Select a template'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <VariantCompareModal
        open={!!compareGroup}
        offerName={compareGroup?.name ?? ''}
        variants={(compareGroup?.variants ?? []) as CompareVariant[]}
        templates={templates}
        branding={branding as Parameters<typeof VariantCompareModal>[0]['branding']}
        busyId={busyId}
        onPick={(id) => void pick(id)}
        onPickAll={(templateId) => void pickAll(templateId)}
        otherOfferCount={Math.max(0, (groups?.filter((g) => g.variants.length > 1).length ?? 1) - 1)}
        onUndo={(id) => void pick(id, true)}
        onOpenEditor={(id) => {
          window.location.href = editorHref(id);
        }}
        onClose={() => setCompareKey(null)}
      />
    </>
  );
}
