'use client';

/**
 * Ad Template Builder — Phase 2 (shell + live canvas).
 *
 * Designers lay out a TemplateDoc visually. The canvas renders the doc with the
 * SAME `renderDoc` the export pipeline uses (WYSIWYG by construction), scaled to
 * fit. An overlay draws each element's box so they can be selected; drag/resize
 * + property editing land in the next phases.
 *
 * Seeded with the Vehicle Offer doc so there's a real template to lay out.
 * Branding (logo / color / name) is pulled from the active account so the
 * preview looks on-brand. Behind AD_GENERATOR_ENABLED (404 in prod).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Squares2X2Icon,
  PhotoIcon,
  Bars3BottomLeftIcon,
  BuildingStorefrontIcon,
  RectangleGroupIcon,
  ArrowLeftIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { renderDoc } from '@/lib/ad-generator/doc-renderer';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox } from '@/lib/ad-generator/doc-types';

const CANVAS_MAX = 560; // px the canvas fits within (longest edge)

const TYPE_ICON: Record<DocElementType, typeof PhotoIcon> = {
  text: Bars3BottomLeftIcon,
  image: PhotoIcon,
  logo: BuildingStorefrontIcon,
  shape: RectangleGroupIcon,
};

/** Friendly display name for an element (its binding, falling back to id). */
function elName(el: DocElement): string {
  const b = el.binding;
  if (!b) return el.id;
  if (b.kind === 'static') return b.value || el.id;
  return b.key;
}

function bindingDescription(el: DocElement): string {
  const b = el.binding;
  if (!b) return el.type;
  if (b.kind === 'field') return `Field · ${b.key}`;
  if (b.kind === 'brand') return `Brand · ${b.key}`;
  return `Static`;
}

export default function AdBuilderPage() {
  const { accountData } = useAccount();

  // Seed from the Vehicle Offer doc (cloned so future edits don't mutate the source).
  const [doc] = useState<TemplateDoc>(() => structuredClone(vehicleOfferDoc));
  const [sizeId, setSizeId] = useState(doc.sizes[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOutlines, setShowOutlines] = useState(true);

  const size = useMemo(() => doc.sizes.find((s) => s.id === sizeId) ?? doc.sizes[0], [doc, sizeId]);

  // Merge active-account branding so the preview is on-brand.
  const previewData = useMemo(
    () => ({
      ...vehicleOfferPreviewData,
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
      ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
    }),
    [accountData],
  );

  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);

  const scale = Math.min(CANVAS_MAX / size.width, CANVAS_MAX / size.height);
  const frameW = size.width * scale;
  const frameH = size.height * scale;

  const layout = doc.layouts[size.id] ?? {};
  // Elements placed in this size (z-ordered), with their box for the overlay.
  const placed = useMemo(
    () =>
      doc.elements
        .map((el) => ({ el, box: layout[el.id] }))
        .filter((x): x is { el: DocElement; box: DocLayoutBox } => Boolean(x.box))
        .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0)),
    [doc.elements, layout],
  );

  const selected = selectedId ? doc.elements.find((e) => e.id === selectedId) ?? null : null;
  const selectedBox = selectedId ? layout[selectedId] : undefined;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <Squares2X2Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Template Builder</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Lay out an ad template visually — the canvas is the exact renderer that exports.
            </p>
          </div>
        </div>
        <Link
          href="/tools/ad-generator"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Generator
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left: element list + selection readout */}
        <div className="space-y-4">
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Elements
              </h2>
              <span className="text-[11px] text-[var(--muted-foreground)]">{placed.length}</span>
            </div>
            <div className="space-y-1">
              {/* Top of the list = top of the z-stack, so reverse for a natural reading order. */}
              {[...placed].reverse().map(({ el, box }) => {
                const Icon = TYPE_ICON[el.type];
                const isSel = el.id === selectedId;
                return (
                  <button
                    key={el.id}
                    onClick={() => setSelectedId(isSel ? null : el.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isSel
                        ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--muted)]/60'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 opacity-70" />
                    <span className="flex-1 truncate text-xs font-medium">{elName(el)}</span>
                    {box.hidden && <EyeSlashIcon className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />}
                    <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{el.type}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Selection readout — precursor to the Phase 4 properties panel. */}
          {selected && selectedBox && (
            <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Selected
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="Name" value={elName(selected)} />
                <Row label="Type" value={selected.type} />
                <Row label="Binding" value={bindingDescription(selected)} />
                <Row
                  label="Position"
                  value={`${Math.round(selectedBox.x * 100)}% , ${Math.round(selectedBox.y * 100)}%`}
                />
                <Row
                  label="Size"
                  value={`${Math.round(selectedBox.w * 100)}% × ${Math.round(selectedBox.h * 100)}%`}
                />
                {selectedBox.fontSize != null && <Row label="Font size" value={`${selectedBox.fontSize}px`} />}
              </div>
              <p className="mt-3 text-[11px] leading-snug text-[var(--muted-foreground)]">
                Drag, resize, and style editing arrive in the next phase.
              </p>
            </section>
          )}
        </div>

        {/* Right: canvas */}
        <div>
          <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {doc.sizes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSizeId(s.id)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      s.id === sizeId ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    {s.label.split(' ')[0]}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowOutlines((v) => !v)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  showOutlines
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                }`}
              >
                Outlines
              </button>
            </div>

            <div className="flex justify-center rounded-xl bg-[var(--muted)]/40 p-6">
              <div className="relative shadow-lg ring-1 ring-black/5" style={{ width: frameW, height: frameH }}>
                {/* The export renderer, scaled to fit. */}
                <div className="absolute inset-0 overflow-hidden rounded-md">
                  <iframe
                    title="Template canvas"
                    srcDoc={html}
                    style={{
                      width: size.width,
                      height: size.height,
                      border: 0,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                      pointerEvents: 'none',
                    }}
                  />
                </div>

                {/* Selection overlay — one box per element. */}
                <div className="absolute inset-0">
                  {placed.map(({ el, box }) => {
                    if (box.hidden) return null;
                    const isSel = el.id === selectedId;
                    return (
                      <button
                        key={el.id}
                        onClick={() => setSelectedId(isSel ? null : el.id)}
                        title={elName(el)}
                        className="group absolute"
                        style={{
                          left: box.x * frameW,
                          top: box.y * frameH,
                          width: box.w * frameW,
                          height: box.h * frameH,
                          zIndex: (box.z ?? 0) + 1,
                        }}
                      >
                        <span
                          className={`pointer-events-none absolute inset-0 rounded-[2px] transition-colors ${
                            isSel
                              ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/5'
                              : showOutlines
                                ? 'ring-1 ring-dashed ring-[var(--primary)]/30 group-hover:ring-[var(--primary)]/70'
                                : 'group-hover:ring-1 group-hover:ring-[var(--primary)]/50'
                          }`}
                        />
                        {isSel && (
                          <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {elName(el)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">
              {size.label} · {size.width}×{size.height}px · click an element to select
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="truncate font-medium text-[var(--foreground)]">{value}</span>
    </div>
  );
}
