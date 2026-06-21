'use client';

/**
 * Ad Template Builder — Phase 3 (drag, resize, element CRUD).
 *
 * Designers lay out a TemplateDoc visually. The canvas renders the doc with the
 * SAME `renderDoc` the export pipeline uses (WYSIWYG by construction), scaled to
 * fit. An overlay draws each element's box: drag to move, resize via 8 handles,
 * nudge with arrow keys, delete/duplicate, add new elements. Style + binding
 * editing land in Phases 4–5; saving in Phase 7 (edits are in-memory for now).
 *
 * To keep dragging smooth, the overlay box moves live while the iframe (the
 * real render) updates once on release — a wireframe drag.
 *
 * Seeded with the Vehicle Offer doc; preview merges active-account branding.
 * Behind AD_GENERATOR_ENABLED (404 in prod).
 */

import { useMemo, useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  Squares2X2Icon,
  PhotoIcon,
  Bars3BottomLeftIcon,
  BuildingStorefrontIcon,
  RectangleGroupIcon,
  ArrowLeftIcon,
  EyeSlashIcon,
  PlusIcon,
  TrashIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { renderDoc } from '@/lib/ad-generator/doc-renderer';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox } from '@/lib/ad-generator/doc-types';

const CANVAS_MAX = 560; // px the canvas fits within (longest edge)
const MIN_FRAC = 0.03; // smallest element edge as a fraction of the canvas

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_HANDLES: { h: Handle; x: number; y: number; cursor: string }[] = [
  { h: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { h: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { h: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { h: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { h: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { h: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { h: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { h: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

const TYPE_ICON: Record<DocElementType, typeof PhotoIcon> = {
  text: Bars3BottomLeftIcon,
  image: PhotoIcon,
  logo: BuildingStorefrontIcon,
  shape: RectangleGroupIcon,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rid(): string {
  const u = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return u.replace(/-/g, '').slice(0, 8);
}

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
  return 'Static text';
}

/** Apply a drag/resize delta (in canvas fractions) to a box, clamped on-canvas. */
function computeBox(handle: Handle, start: DocLayoutBox, dxF: number, dyF: number): DocLayoutBox {
  const { x: sx, y: sy, w: sw, h: sh, ...rest } = start;
  let x = sx;
  let y = sy;
  let w = sw;
  let h = sh;
  switch (handle) {
    case 'move': x += dxF; y += dyF; break;
    case 'e': w += dxF; break;
    case 'w': x += dxF; w -= dxF; break;
    case 's': h += dyF; break;
    case 'n': y += dyF; h -= dyF; break;
    case 'se': w += dxF; h += dyF; break;
    case 'sw': x += dxF; w -= dxF; h += dyF; break;
    case 'ne': w += dxF; y += dyF; h -= dyF; break;
    case 'nw': x += dxF; w -= dxF; y += dyF; h -= dyF; break;
  }
  // Keep a minimum size; west/north handles move the origin as they shrink.
  if (w < MIN_FRAC) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') x -= MIN_FRAC - w;
    w = MIN_FRAC;
  }
  if (h < MIN_FRAC) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') y -= MIN_FRAC - h;
    h = MIN_FRAC;
  }
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  w = clamp(w, MIN_FRAC, 1 - x);
  h = clamp(h, MIN_FRAC, 1 - y);
  return { ...rest, x, y, w, h };
}

function makeDefaultElement(id: string, type: DocElementType): DocElement {
  switch (type) {
    case 'text':
      return { id, type, binding: { kind: 'static', value: 'New text' }, fontWeight: 700, color: '#0f172a', align: 'left' };
    case 'logo':
      return { id, type, binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' };
    case 'image':
      return { id, type, fit: 'contain' };
    case 'shape':
      return { id, type, fill: 'brand', radius: 8 };
  }
}

export default function AdBuilderPage() {
  const { accountData } = useAccount();

  const [doc, setDoc] = useState<TemplateDoc>(() => structuredClone(vehicleOfferDoc));
  const [sizeId, setSizeId] = useState(doc.sizes[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOutlines, setShowOutlines] = useState(true);
  const [dragBox, setDragBox] = useState<DocLayoutBox | null>(null);

  const size = useMemo(() => doc.sizes.find((s) => s.id === sizeId) ?? doc.sizes[0], [doc, sizeId]);

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

  // ── doc mutations (all functional so they don't capture stale state) ──
  const setBox = useCallback((sid: string, elId: string, box: DocLayoutBox) => {
    setDoc((prev) => ({
      ...prev,
      layouts: { ...prev.layouts, [sid]: { ...prev.layouts[sid], [elId]: box } },
    }));
  }, []);

  const setElement = useCallback((id: string, patch: Partial<DocElement>) => {
    setDoc((prev) => ({
      ...prev,
      elements: prev.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const deleteElement = useCallback((id: string) => {
    setDoc((prev) => {
      const layouts: typeof prev.layouts = {};
      for (const sid of Object.keys(prev.layouts)) {
        const next: Record<string, DocLayoutBox> = {};
        for (const [k, v] of Object.entries(prev.layouts[sid])) {
          if (k !== id) next[k] = v;
        }
        layouts[sid] = next;
      }
      return { ...prev, elements: prev.elements.filter((e) => e.id !== id), layouts };
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateElement = useCallback((id: string) => {
    const newId = `${doc.elements.find((e) => e.id === id)?.type ?? 'el'}-${rid()}`;
    setDoc((prev) => {
      const idx = prev.elements.findIndex((e) => e.id === id);
      if (idx < 0) return prev;
      const clone = structuredClone(prev.elements[idx]);
      clone.id = newId;
      const elements = [...prev.elements];
      elements.splice(idx + 1, 0, clone);
      const layouts = { ...prev.layouts };
      for (const sid of Object.keys(prev.layouts)) {
        const b = prev.layouts[sid][id];
        if (b) {
          layouts[sid] = {
            ...prev.layouts[sid],
            [newId]: { ...b, x: clamp(b.x + 0.03, 0, 1 - b.w), y: clamp(b.y + 0.03, 0, 1 - b.h), z: (b.z ?? 0) + 1 },
          };
        }
      }
      return { ...prev, elements, layouts };
    });
    setSelectedId(newId);
  }, [doc.elements]);

  const addElement = useCallback(
    (type: DocElementType) => {
      const id = `${type}-${rid()}`;
      setDoc((prev) => {
        const curLayout = prev.layouts[prev.sizes[0].id] ?? {};
        const maxZ = Object.values(curLayout).reduce((m, b) => Math.max(m, b.z ?? 0), 0);
        const box: DocLayoutBox = {
          x: 0.3,
          y: 0.44,
          w: 0.4,
          h: 0.12,
          z: maxZ + 1,
          ...(type === 'text' ? { fontSize: 48 } : {}),
        };
        const layouts = { ...prev.layouts };
        for (const s of prev.sizes) layouts[s.id] = { ...layouts[s.id], [id]: { ...box } };
        return { ...prev, elements: [...prev.elements, makeDefaultElement(id, type)], layouts };
      });
      setSelectedId(id);
    },
    [],
  );

  // ── pointer drag/resize ──
  const dragRef = useRef<{
    handle: Handle;
    sx: number;
    sy: number;
    start: DocLayoutBox;
    fw: number;
    fh: number;
    sizeId: string;
    elId: string;
    live: DocLayoutBox;
  } | null>(null);

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const moveListener = useCallback((e: PointerEvent) => onMoveRef.current(e), []);
  const upListener = useCallback((e: PointerEvent) => onUpRef.current(e), []);

  onMoveRef.current = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxF = (e.clientX - d.sx) / d.fw;
    const dyF = (e.clientY - d.sy) / d.fh;
    const box = computeBox(d.handle, d.start, dxF, dyF);
    d.live = box;
    setDragBox(box);
  };
  onUpRef.current = () => {
    const d = dragRef.current;
    if (d) setBox(d.sizeId, d.elId, d.live);
    dragRef.current = null;
    setDragBox(null);
    window.removeEventListener('pointermove', moveListener);
    window.removeEventListener('pointerup', upListener);
  };

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', moveListener);
      window.removeEventListener('pointerup', upListener);
    },
    [moveListener, upListener],
  );

  function startDrag(e: React.PointerEvent, elId: string, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    const box = (doc.layouts[size.id] ?? {})[elId];
    if (!box) return;
    setSelectedId(elId);
    dragRef.current = { handle, sx: e.clientX, sy: e.clientY, start: { ...box }, fw: frameW, fh: frameH, sizeId: size.id, elId, live: { ...box } };
    setDragBox({ ...box });
    window.addEventListener('pointermove', moveListener);
    window.addEventListener('pointerup', upListener);
  }

  // ── keyboard: nudge with arrows, delete with Delete/Backspace ──
  useEffect(() => {
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const box = (doc.layouts[size.id] ?? {})[selectedId!];
      if (!box) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteElement(selectedId!);
        return;
      }
      const step = e.shiftKey ? 0.02 : 0.005;
      let nx = box.x;
      let ny = box.y;
      if (e.key === 'ArrowLeft') nx -= step;
      else if (e.key === 'ArrowRight') nx += step;
      else if (e.key === 'ArrowUp') ny -= step;
      else if (e.key === 'ArrowDown') ny += step;
      else return;
      e.preventDefault();
      setBox(size.id, selectedId!, { ...box, x: clamp(nx, 0, 1 - box.w), y: clamp(ny, 0, 1 - box.h) });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, doc, size.id, deleteElement, setBox]);

  const adders: { type: DocElementType; label: string }[] = [
    { type: 'text', label: 'Text' },
    { type: 'image', label: 'Image' },
    { type: 'logo', label: 'Logo' },
    { type: 'shape', label: 'Shape' },
  ];

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
              Drag to move, drag a handle to resize, arrow keys to nudge — the canvas is the exact renderer that exports.
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
        {/* Left: elements + selection */}
        <div className="space-y-4">
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Elements</h2>
              <span className="text-[11px] text-[var(--muted-foreground)]">{placed.length}</span>
            </div>

            {/* Add element */}
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {adders.map((a) => {
                const Icon = TYPE_ICON[a.type];
                return (
                  <button
                    key={a.type}
                    onClick={() => addElement(a.type)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <PlusIcon className="h-3 w-3" />
                    <Icon className="h-3.5 w-3.5" />
                    {a.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1">
              {[...placed].reverse().map(({ el, box }) => {
                const Icon = TYPE_ICON[el.type];
                const isSel = el.id === selectedId;
                return (
                  <button
                    key={el.id}
                    onClick={() => setSelectedId(isSel ? null : el.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isSel ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]/60'
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

          {/* Selected element controls */}
          {selected && selectedBox && (
            <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Selected</h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => duplicateElement(selected.id)}
                    title="Duplicate"
                    className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteElement(selected.id)}
                    title="Delete"
                    className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <Row label="Type" value={selected.type} />
                <Row label="Binding" value={bindingDescription(selected)} />

                {/* Edit static text content inline (full binding editing is Phase 5). */}
                {selected.type === 'text' && selected.binding?.kind === 'static' && (
                  <div>
                    <label className="mb-1 block text-[var(--muted-foreground)]">Text</label>
                    <input
                      value={selected.binding.value}
                      onChange={(e) => setElement(selected.id, { binding: { kind: 'static', value: e.target.value } })}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <NumberField label="X %" value={Math.round(selectedBox.x * 100)} onChange={(v) => setBox(size.id, selected.id, { ...selectedBox, x: clamp(v / 100, 0, 1 - selectedBox.w) })} />
                  <NumberField label="Y %" value={Math.round(selectedBox.y * 100)} onChange={(v) => setBox(size.id, selected.id, { ...selectedBox, y: clamp(v / 100, 0, 1 - selectedBox.h) })} />
                  <NumberField label="W %" value={Math.round(selectedBox.w * 100)} onChange={(v) => setBox(size.id, selected.id, { ...selectedBox, w: clamp(v / 100, MIN_FRAC, 1 - selectedBox.x) })} />
                  <NumberField label="H %" value={Math.round(selectedBox.h * 100)} onChange={(v) => setBox(size.id, selected.id, { ...selectedBox, h: clamp(v / 100, MIN_FRAC, 1 - selectedBox.y) })} />
                </div>

                {selected.type === 'text' && (
                  <NumberField
                    label="Font size (px)"
                    value={selectedBox.fontSize ?? 16}
                    onChange={(v) => setBox(size.id, selected.id, { ...selectedBox, fontSize: clamp(Math.round(v), 4, 400) })}
                  />
                )}
              </div>
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
                  showOutlines ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                }`}
              >
                Outlines
              </button>
            </div>

            <div className="flex justify-center rounded-xl bg-[var(--muted)]/40 p-6" style={{ userSelect: 'none' }}>
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

                {/* Interaction overlay — click backdrop to deselect. */}
                <div
                  className="absolute inset-0"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedId(null);
                  }}
                >
                  {placed.map(({ el, box }) => {
                    if (box.hidden) return null;
                    const isSel = el.id === selectedId;
                    const isDragging = isSel && dragBox != null && dragRef.current?.elId === el.id;
                    const b = isDragging && dragBox ? dragBox : box;
                    const boxStyle: CSSProperties = {
                      left: b.x * frameW,
                      top: b.y * frameH,
                      width: b.w * frameW,
                      height: b.h * frameH,
                      zIndex: (b.z ?? 0) + 1,
                      cursor: 'move',
                      touchAction: 'none',
                    };
                    return (
                      <div
                        key={el.id}
                        onPointerDown={(e) => startDrag(e, el.id, 'move')}
                        title={elName(el)}
                        className="group absolute"
                        style={boxStyle}
                      >
                        <span
                          className={`pointer-events-none absolute inset-0 rounded-[2px] transition-colors ${
                            isSel
                              ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/10'
                              : showOutlines
                                ? 'ring-1 ring-dashed ring-[var(--primary)]/30 group-hover:ring-[var(--primary)]/70'
                                : 'group-hover:ring-1 group-hover:ring-[var(--primary)]/50'
                          }`}
                        />
                        {isSel && (
                          <>
                            <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {elName(el)}
                            </span>
                            {RESIZE_HANDLES.map((rh) => (
                              <span
                                key={rh.h}
                                onPointerDown={(e) => startDrag(e, el.id, rh.h)}
                                className="absolute h-2.5 w-2.5 rounded-[2px] border border-[var(--primary)] bg-[var(--card)]"
                                style={{
                                  left: `${rh.x * 100}%`,
                                  top: `${rh.y * 100}%`,
                                  transform: 'translate(-50%, -50%)',
                                  cursor: rh.cursor,
                                  touchAction: 'none',
                                }}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">
              {size.label} · {size.width}×{size.height}px · drag to move · arrows nudge · Delete removes
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
      />
    </label>
  );
}
