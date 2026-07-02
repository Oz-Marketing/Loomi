'use client';

/**
 * Ad Template Builder — the visual TemplateDoc editor.
 *
 * Designers lay out a TemplateDoc visually. The canvas renders the doc with the
 * SAME `renderDoc` the export pipeline uses (WYSIWYG by construction), scaled to
 * fit. An overlay draws each element's box: drag to move, resize via 8 handles,
 * nudge with arrow keys, delete/duplicate, add new elements. The selection
 * panel edits content, position/size, and styles (font/alignment/color/etc.);
 * the fields sidebar manages form fields + bindings; save persists to the
 * AdTemplateDoc table as draft/published (or, in ad mode, to that ad's own doc).
 *
 * To keep dragging smooth, the overlay box moves live while the iframe (the
 * real render) updates once on release — a wireframe drag.
 *
 * Seeded with the Vehicle Offer doc; preview merges active-account branding.
 * Behind AD_GENERATOR_ENABLED (404 in prod).
 */

import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  PhotoIcon,
  Bars3BottomLeftIcon,
  Bars3Icon,
  Bars3BottomRightIcon,
  BuildingStorefrontIcon,
  ArrowLeftIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  MinusIcon,
  TrashIcon,
  XMarkIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowPathIcon,
  CheckIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  LockOpenIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RectangleStackIcon,
  Squares2X2Icon,
  QuestionMarkCircleIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { renderDoc } from '@/lib/ad-generator/doc-renderer';
import { buildFontFaceCssFromUrls } from '@/lib/ad-generator/fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import { enrichOfferFields } from '@/lib/ad-generator/offer-text';
import { buildLayerTree, flattenLayerTree, normalizeGroupZ, type LayerNode } from '@/lib/ad-generator/layer-tree';
import { TextElementIcon, ShapeElementIcon, ButtonElementIcon, DashboardLayoutIcon, LayersIcon, OutlinesIcon, MarginsIcon } from '@/components/ad-generator/builder-icons';
import { catalogByCategory } from '@/lib/ad-generator/ad-size-catalog';
import { useIndustries } from '@/lib/hooks/use-industries';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox, DocBackground } from '@/lib/ad-generator/doc-types';
import type { FieldSpec, FieldType, AdData } from '@/lib/ad-generator/types';

const CANVAS_PAD = 48; // breathing room around the ad inside the canvas pane
const MIN_FRAC = 0.03; // smallest element edge as a fraction of the canvas

/** Track an element's content-box size via ResizeObserver (for fit-to-pane). */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const HISTORY_LIMIT = 60;
const COALESCE_MS = 450; // merge rapid edits (typing, nudging) into one undo step

type Hist = { past: TemplateDoc[]; present: TemplateDoc; future: TemplateDoc[] };

/**
 * Undo/redo history over the doc. `setDoc` is a drop-in for useState's setter
 * (value or updater); rapid successive edits within COALESCE_MS collapse into a
 * single undo step. `reset` replaces the doc and clears history (load / new).
 */
function useDocHistory(init: () => TemplateDoc) {
  const [hist, setHist] = useState<Hist>(() => ({ past: [], present: init(), future: [] }));
  const lastTs = useRef(0);

  const setDoc = useCallback((updater: TemplateDoc | ((d: TemplateDoc) => TemplateDoc)) => {
    setHist((h) => {
      const next = typeof updater === 'function' ? (updater as (d: TemplateDoc) => TemplateDoc)(h.present) : updater;
      if (next === h.present) return h;
      const now = Date.now();
      const coalesce = h.past.length > 0 && now - lastTs.current < COALESCE_MS;
      lastTs.current = now;
      const past = coalesce ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
      return { past, present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastTs.current = 0;
    setHist((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) };
    });
  }, []);

  const redo = useCallback(() => {
    lastTs.current = 0;
    setHist((h) => {
      if (!h.future.length) return h;
      const nxt = h.future[0];
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: nxt, future: h.future.slice(1) };
    });
  }, []);

  const reset = useCallback((doc: TemplateDoc) => {
    lastTs.current = 0;
    setHist({ past: [], present: doc, future: [] });
  }, []);

  return { doc: hist.present, setDoc, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, reset };
}

// Websafe families browsers/Chromium reliably have; account custom fonts are
// added on top, and '' = the account's brand font stack.
const WEBSAFE_FONTS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Garamond',
  'Courier New',
  'Lucida Console',
];
const WEIGHT_OPTIONS: FontSelectOption[] = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extrabold' },
  { value: '900', label: 'Black' },
];
const FIELD_TYPE_OPTIONS: FontSelectOption[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'color', label: 'Color' },
  { value: 'image', label: 'Image URL' },
];
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

const TYPE_ICON: Record<DocElementType, React.ComponentType<{ className?: string }>> = {
  text: TextElementIcon,
  image: PhotoIcon,
  logo: BuildingStorefrontIcon,
  shape: ShapeElementIcon,
};

type SavedTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  doc: TemplateDoc | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type MarginUnit = 'percent' | 'px' | 'em' | 'rem';
const MARGIN_UNITS: { value: MarginUnit; label: string }[] = [
  { value: 'percent', label: '%' },
  { value: 'px', label: 'px' },
  { value: 'em', label: 'em' },
  { value: 'rem', label: 'rem' },
];
/** Convert a safe-area margin (value + unit) to per-size edge fractions. px/em/
 *  rem are absolute, so they resolve against this size's dimensions. */
function safeAreaFractions(sa: { value: number; unit: MarginUnit } | undefined, w: number, h: number): { x: number; y: number } | null {
  if (!sa || !(sa.value > 0)) return null;
  if (sa.unit === 'percent') {
    const f = clamp(sa.value / 100, 0, 0.49);
    return { x: f, y: f };
  }
  const px = sa.unit === 'em' || sa.unit === 'rem' ? sa.value * 16 : sa.value;
  return { x: clamp(px / w, 0, 0.49), y: clamp(px / h, 0, 0.49) };
}

const SNAP_PX = 6; // alignment snap distance, in on-screen pixels

/** Nearest snap of any of `edges` to any of `targets` within `threshold`. */
function bestSnap(edges: number[], targets: number[], threshold: number): { off: number; guide: number | null } {
  let best = threshold;
  let off = 0;
  let guide: number | null = null;
  for (const e of edges) {
    for (const t of targets) {
      const diff = t - e;
      const ad = Math.abs(diff);
      if (ad < best) {
        best = ad;
        off = diff;
        guide = t;
      }
    }
  }
  return { off, guide };
}

/** What actually gets persisted — the dirty check + autosave compare against this. */
function serializeDoc(doc: TemplateDoc, name: string, status: string): string {
  return JSON.stringify({ status, doc: { ...doc, name: name.trim() } });
}

function rid(): string {
  const u = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return u.replace(/-/g, '').slice(0, 8);
}

/** Friendly display name for an element: its custom name, else its binding,
 *  falling back to id. */
function elName(el: DocElement): string {
  if (el.name && el.name.trim()) return el.name;
  const b = el.binding;
  if (!b) return el.id;
  if (b.kind === 'static') return b.value || el.id;
  return b.key;
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
      // Empty static binding (not undefined) so the inspector treats it as an
      // editable image — that's what surfaces the thumbnail + "Choose / upload"
      // (MediaPickerModal) control. Without a binding the Content section, and
      // thus the upload button, never render.
      return { id, type, binding: { kind: 'static', value: '' }, fit: 'contain' };
    case 'shape':
      return { id, type, fill: 'brand', radius: 8 };
  }
}

export default function AdBuilderPage() {
  const { accountData, accountKey } = useAccount();

  const { doc, setDoc, undo, redo, canUndo, canRedo, reset: resetHistory } = useDocHistory(() => structuredClone(vehicleOfferDoc));
  const [sizeId, setSizeId] = useState(doc.sizes[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Marquee (drag-to-select) rectangle in canvas fractions, while dragging the backdrop.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Live boxes for a group (multi-select) drag, keyed by element id.
  const [groupLive, setGroupLive] = useState<Record<string, DocLayoutBox> | null>(null);
  const selectOne = useCallback((id: string) => setSelectedIds([id]), []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const toggleSelect = useCallback((id: string) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])), []);
  const [showOutlines, setShowOutlines] = useState(true);
  // "Wide view" — an overview of every size rendered side-by-side (multi-size docs only).
  const [overviewOpen, setOverviewOpen] = useState(false);
  // Keyboard-shortcuts cheatsheet overlay.
  const [helpOpen, setHelpOpen] = useState(false);
  // Manual zoom multiplier on top of the fit-to-pane scale (1 = fit the pane).
  const [zoom, setZoom] = useState(1);
  // The background panel shows on deselect; dismissing it sets this until the
  // toolbar's "Background" button reopens it.
  const [bgPanelHidden, setBgPanelHidden] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [dragBox, setDragBox] = useState<DocLayoutBox | null>(null);
  // Figma-style alignment guides shown while dragging (fractions, or null).
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // Left rail: which panel (Elements / Layers / Industries / Sizes) is open as a
  // flyout. null = collapsed to just the icons.
  const [leftPanel, setLeftPanel] = useState<'insert' | 'layers' | 'industries' | 'sizes' | null>(null);
  // The on-canvas "add element" popover (top-left of the artboard).
  const [addSizeOpen, setAddSizeOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  // The shared size library (drives the Add-size picker; falls back to presets).
  const [libSizes, setLibSizes] = useState<{ id: string; name: string; width: number; height: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ad-generator/sizes')
      .then((r) => (r.ok ? r.json() : { sizes: [] }))
      .then((d: { sizes?: { id: string; name: string; width: number; height: number }[] }) => {
        if (!cancelled) setLibSizes(d.sizes ?? []);
      })
      .catch(() => {
        if (!cancelled) setLibSizes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── persistence ──
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Ad mode: when set, the builder is editing ONE ad's own design copy (the
  // AdCreative.doc) rather than a shared template — Save writes back to the ad.
  const [adId, setAdId] = useState<string | null>(null);
  const [adData, setAdData] = useState<AdData | null>(null);
  const [templateName, setTemplateName] = useState(vehicleOfferDoc.name);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [saving, setSaving] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedList, setSavedList] = useState<SavedTemplate[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Serialized snapshot of what's persisted — autosave fires only when the live
  // doc/name/status diverge from this.
  const savedRef = useRef('');
  // Guards the one-time `?template=<id>` deep-load (edit a template from the
  // Templates → Ads tab).
  const deepLinkedRef = useRef(false);

  const size = useMemo(() => doc.sizes.find((s) => s.id === sizeId) ?? doc.sizes[0], [doc, sizeId]);

  // Account custom fonts: drive both the dropdown and the @font-face the canvas
  // needs so a chosen family actually renders.
  const customFonts = useMemo(() => accountData?.customFonts ?? [], [accountData?.customFonts]);
  const fontFaceCss = useMemo(() => buildFontFaceCssFromUrls(customFonts), [customFonts]);
  const fontOptions = useMemo<FontSelectOption[]>(
    () => [
      { value: '', label: 'Brand default' },
      ...[...new Set(customFonts.map((f) => f.family))].map((fam) => ({ value: fam, label: fam })),
      ...WEBSAFE_FONTS.map((fam) => ({ value: fam, label: fam })),
    ],
    [customFonts],
  );

  const previewData = useMemo(
    () =>
      enrichOfferFields({
        ...vehicleOfferPreviewData,
        ...doc.defaults, // designer-set default / preview values for fields
        ...(adData ?? {}), // ad mode: the ad's real content
        ...(fontFaceCss ? { fontFaceCss } : {}),
        ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
        ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
        ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
      }),
    [accountData, fontFaceCss, doc.defaults, adData],
  );

  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);

  // The ad scales to fill the canvas pane (measured), with a little padding.
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>();
  const frameRef = useRef<HTMLDivElement>(null); // the artboard frame (for panel alignment)
  const availW = canvasSize.width - CANVAS_PAD;
  const availH = canvasSize.height - CANVAS_PAD;
  // Base scale fits the artboard to the pane; `zoom` (1 = fit) layers manual
  // zoom on top. Everything downstream uses `scale`, so the overlay + drag math
  // stay consistent at any zoom.
  const fitScale = availW > 0 && availH > 0 ? Math.min(availW / size.width, availH / size.height) : Math.min(560 / size.width, 560 / size.height);
  const scale = fitScale * zoom;
  const frameW = size.width * scale;
  const frameH = size.height * scale;
  // Each size refits when you switch to it (drop any manual zoom).
  useEffect(() => {
    setZoom(1);
  }, [sizeId]);

  const layout = doc.layouts[size.id] ?? {};
  const placed = useMemo(
    () =>
      doc.elements
        .map((el) => ({ el, box: layout[el.id] }))
        .filter((x): x is { el: DocElement; box: DocLayoutBox } => Boolean(x.box))
        .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0)),
    [doc.elements, layout],
  );

  const lockedIds = useMemo(() => new Set(doc.elements.filter((e) => e.locked).map((e) => e.id)), [doc.elements]);

  // ── group hierarchy helpers (groups nest via parentId) ──
  const groupParent = useMemo(() => new Map((doc.groups ?? []).map((g) => [g.id, g.parentId ?? null])), [doc.groups]);
  const elementGroup = useMemo(() => new Map(doc.elements.map((e) => [e.id, e.groupId ?? null])), [doc.elements]);
  /** An element's ancestor group chain, innermost → outermost. */
  const ancestorChain = useCallback(
    (elId: string): string[] => {
      const chain: string[] = [];
      const seen = new Set<string>();
      let g = elementGroup.get(elId) ?? null;
      while (g && !seen.has(g)) {
        seen.add(g);
        chain.push(g);
        g = groupParent.get(g) ?? null;
      }
      return chain;
    },
    [elementGroup, groupParent],
  );
  /** Every leaf element under a group, at any depth. */
  const membersOf = useCallback(
    (gid: string) => doc.elements.filter((e) => ancestorChain(e.id).includes(gid)).map((e) => e.id),
    [doc.elements, ancestorChain],
  );

  // The multi-selection "is a group" when it's exactly one group's full leaf set
  // — drives the Group ↔ Ungroup toggle in the selection toolbar.
  const selectionIsGroup = useMemo(() => {
    if (selectedIds.length < 2) return false;
    const sel = new Set(selectedIds);
    return (doc.groups ?? []).some((g) => {
      const m = membersOf(g.id);
      return m.length === sel.size && m.every((x) => sel.has(x));
    });
  }, [selectedIds, doc.groups, membersOf]);
  // Bounding box of the current multi-selection (live during group move/resize),
  // for the group resize handles.
  const groupBox = useMemo(() => {
    if (selectedIds.length < 2) return null;
    const boxes = selectedIds
      .map((id) => groupLive?.[id] ?? layout[id])
      .filter((b): b is DocLayoutBox => Boolean(b) && !b!.hidden);
    if (boxes.length < 2) return null;
    return {
      left: Math.min(...boxes.map((b) => b.x)),
      top: Math.min(...boxes.map((b) => b.y)),
      right: Math.max(...boxes.map((b) => b.x + b.w)),
      bottom: Math.max(...boxes.map((b) => b.y + b.h)),
    };
  }, [selectedIds, groupLive, layout]);
  // Layers panel: inline rename + drag-reorder transient state.
  const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragLayer, setDragLayer] = useState<string | null>(null);
  // Live order during a Layers drag (top→front), so rows shift as you hover.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Right-click context menu (canvas + layers), positioned at the cursor.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline text editing: double-click a text element to edit its value on-canvas.
  const [editingText, setEditingText] = useState<{ id: string; value: string } | null>(null);
  // Background panning: natural size of the selected bg image + the live pan
  // preview (the full image, with its off-canvas "bleed" shown while dragging).
  const [bgNatural, setBgNatural] = useState<{ w: number; h: number } | null>(null);
  const [bgPan, setBgPan] = useState<{ url: string; coverW: number; coverH: number; overflowX: number; overflowY: number; objectX: number; objectY: number } | null>(null);
  // FLIP: gently slide Layers rows to their new spots when the drop order
  // actually changes during a drag. Transforms are cleared before measuring, so
  // an in-flight animation never pollutes the next measurement (no jitter).
  const layersRef = useRef<HTMLDivElement>(null);
  const layerTopsRef = useRef<Map<string, number>>(new Map());
  const lastDragOrderRef = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    const container = layersRef.current;
    if (!container || !dragLayer) {
      layerTopsRef.current.clear();
      lastDragOrderRef.current = null;
      return;
    }
    if (dragOrder === lastDragOrderRef.current) return; // only on a real reorder
    lastDragOrderRef.current = dragOrder;

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-layer-row]'));
    // Snap to true layout positions first (drop any in-flight transform).
    for (const row of rows) {
      row.style.transition = 'none';
      row.style.transform = '';
    }
    const base = container.getBoundingClientRect().top;
    const prev = layerTopsRef.current;
    const next = new Map<string, number>();
    const moved: { row: HTMLElement; dy: number }[] = [];
    for (const row of rows) {
      const id = row.getAttribute('data-layer-row');
      if (!id) continue;
      const top = row.getBoundingClientRect().top - base;
      next.set(id, top);
      const old = prev.get(id);
      if (old != null && Math.abs(old - top) > 0.5) {
        row.style.transform = `translateY(${old - top}px)`; // invert
        moved.push({ row, dy: old - top });
      }
    }
    layerTopsRef.current = next;
    if (moved.length) {
      requestAnimationFrame(() => {
        for (const { row } of moved) {
          row.style.transition = 'transform 130ms cubic-bezier(0.22,1,0.36,1)';
          row.style.transform = '';
        }
      });
    }
  });

  // Single-selection shorthand — the per-element toolbar, handles, and action
  // tab only show when exactly one element is selected.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selected = selectedId ? doc.elements.find((e) => e.id === selectedId) ?? null : null;
  const selectedBox = selectedId ? layout[selectedId] : undefined;

  // What the selection panel's "Content" section shows for the selected element.
  // It surfaces the element's value directly (text to type, image to pick) instead
  // of exposing the raw data binding — derived/brand-driven content is read-only.
  const selectionContent = useMemo((): {
    mode: 'none' | 'text-edit' | 'text-readonly' | 'image-edit' | 'image-readonly';
    value: string;
    note?: string;
  } | null => {
    if (!selected) return null;
    const b = selected.binding;
    const isImage = selected.type === 'image' || selected.type === 'logo';
    if (selected.type === 'shape' || !b) return { mode: 'none', value: '' };
    const value = b.kind === 'static' ? b.value : String(previewData[b.key] ?? '');
    if (b.kind === 'brand') return { mode: isImage ? 'image-readonly' : 'text-readonly', value, note: 'Comes from the account brand.' };
    if (b.kind === 'field' && b.key.startsWith('_')) return { mode: 'text-readonly', value, note: 'Pulled from your offer fields — edit those in the Fields panel.' };
    return { mode: isImage ? 'image-edit' : 'text-edit', value };
  }, [selected, previewData]);

  // Write the selected element's content back to its source: static → the literal,
  // field → that field's default (the form data the generator prefills).
  const setSelectedContent = useCallback(
    (v: string) => {
      if (!selected) return;
      const b = selected.binding;
      const id = selected.id;
      if (b?.kind === 'static') {
        setDoc((prev) => ({ ...prev, elements: prev.elements.map((e) => (e.id === id ? { ...e, binding: { kind: 'static', value: v } } : e)) }));
      } else if (b?.kind === 'field') {
        const key = b.key;
        setDoc((prev) => ({ ...prev, defaults: { ...prev.defaults, [key]: v } }));
      }
    },
    [selected, setDoc],
  );

  // A full-bleed element (covering ~the whole canvas — a background photo or its
  // scrim) behaves like the empty backdrop on click: it clears the selection
  // rather than swallowing every "click outside".
  const isFullBleed = useCallback(
    (elId: string) => {
      const b = layout[elId];
      return !!b && b.x <= 0.02 && b.y <= 0.02 && b.x + b.w >= 0.98 && b.y + b.h >= 0.98;
    },
    [layout],
  );

  // Resolve an element's image URL (for the background-pan bleed preview).
  const resolveBindingUrl = useCallback(
    (el: DocElement | null | undefined): string | null => {
      if (!el?.binding) return null;
      if (el.binding.kind === 'static') return el.binding.value || null;
      const v = previewData[el.binding.key];
      return typeof v === 'string' && v ? v : null;
    },
    [previewData],
  );

  // The full-bleed COVER image in the doc — the pannable background photo, if
  // any. Found regardless of selection so it's pannable on the first click.
  const bgImageId = useMemo(() => {
    const cand = doc.elements.find((e) => e.type === 'image' && (e.fit ?? 'cover') === 'cover' && isFullBleed(e.id));
    return cand?.id ?? null;
  }, [doc.elements, isFullBleed]);

  // Load the background's natural pixel size so we can map drag distance to
  // object-position and draw the bleed at the right cover scale.
  useEffect(() => {
    if (!bgImageId) {
      setBgNatural(null);
      return;
    }
    const url = resolveBindingUrl(doc.elements.find((e) => e.id === bgImageId));
    if (!url) {
      setBgNatural(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setBgNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.src = url;
    return () => {
      alive = false;
    };
  }, [bgImageId, doc.elements, resolveBindingUrl]);

  // Top of the artboard (viewport y) — the selection panel pins to it so it lines
  // up with the top of the ad, with natural spacing below the header.
  const [canvasTop, setCanvasTop] = useState(96);
  useEffect(() => {
    const measure = () => {
      const t = (frameRef.current ?? canvasRef.current)?.getBoundingClientRect().top;
      if (t != null) setCanvasTop(Math.max(8, Math.round(t)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // re-measure when the panel opens or the artboard moves/scales
  }, [selectedId, canvasRef, canvasSize.width, canvasSize.height, size.id]);

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

  // ── inline text editing (double-click a text element) ──
  // Editable when the element binds to a STATIC literal or a plain FIELD.
  // Brand-bound and computed (`_offer*`) text is derived, so it's read-only here.
  const textEditTarget = useCallback((el: DocElement | null | undefined): 'static' | 'field' | null => {
    if (!el || el.type !== 'text' || el.locked || !el.binding) return null;
    if (el.binding.kind === 'static') return 'static';
    if (el.binding.kind === 'field' && !el.binding.key.startsWith('_')) return 'field';
    return null;
  }, []);

  const startTextEdit = useCallback(
    (elId: string) => {
      const el = doc.elements.find((e) => e.id === elId);
      const target = textEditTarget(el);
      if (!el || !target) return;
      const cur = el.binding!.kind === 'static' ? el.binding!.value : String(previewData[(el.binding as { key: string }).key] ?? '');
      setSelectedIds([elId]);
      setEditingText({ id: elId, value: cur });
    },
    [doc.elements, previewData, textEditTarget],
  );

  // Commit writes back to the bound value: static → the literal; field → the
  // field's default in `doc.defaults` (the form data the generator prefills).
  const commitTextEdit = useCallback(() => {
    setEditingText((cur) => {
      if (!cur) return null;
      const el = doc.elements.find((e) => e.id === cur.id);
      const b = el?.binding;
      if (b?.kind === 'static') {
        setElement(cur.id, { binding: { kind: 'static', value: cur.value } });
      } else if (b?.kind === 'field') {
        const key = b.key;
        setDoc((prev) => ({ ...prev, defaults: { ...prev.defaults, [key]: cur.value } }));
      }
      return null;
    });
  }, [doc.elements, setElement]);

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
    setSelectedIds((ids) => ids.filter((x) => x !== id));
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
    setSelectedIds([newId]);
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
      setSelectedIds([id]);
    },
    [],
  );

  // Add a Button: a text element styled as a brand-colored pill (white,
  // centered). Just a styled text element — no separate element type.
  const addButton = useCallback(() => {
    const id = `text-${rid()}`;
    setDoc((prev) => {
      const curLayout = prev.layouts[prev.sizes[0].id] ?? {};
      const maxZ = Object.values(curLayout).reduce((m, b) => Math.max(m, b.z ?? 0), 0);
      const box: DocLayoutBox = { x: 0.35, y: 0.8, w: 0.3, h: 0.08, z: maxZ + 1, fontSize: 28 };
      const layouts = { ...prev.layouts };
      for (const s of prev.sizes) layouts[s.id] = { ...layouts[s.id], [id]: { ...box } };
      const el: DocElement = {
        id,
        type: 'text',
        name: 'Button',
        binding: { kind: 'static', value: 'Shop Now' },
        fontWeight: 700,
        color: '#ffffff',
        align: 'center',
        bg: 'brand',
        radius: 999,
        padding: 14,
      };
      return { ...prev, elements: [...prev.elements, el], layouts };
    });
    setSelectedIds([id]);
  }, []);

  // Add a full-bleed background photo: a cover image element pinned to the whole
  // canvas, behind everything, on every size. Background images are full-bleed
  // image ELEMENTS (not a doc-level field), so this flows through the normal
  // renderer/export + per-size focal point. Selecting it surfaces the inspector's
  // Choose/upload control.
  const addBackgroundImage = useCallback(() => {
    const id = `image-${rid()}`;
    setDoc((prev) => {
      const layouts = { ...prev.layouts };
      for (const s of prev.sizes) {
        const cur = layouts[s.id] ?? {};
        const minZ = Object.values(cur).reduce((m, b) => Math.min(m, b.z ?? 0), 0);
        layouts[s.id] = { ...cur, [id]: { x: 0, y: 0, w: 1, h: 1, z: minZ - 1 } };
      }
      const el: DocElement = { id, type: 'image', name: 'Background', binding: { kind: 'static', value: '' }, fit: 'cover' };
      return { ...prev, elements: [...prev.elements, el], layouts };
    });
    setSelectedIds([id]);
  }, []);

  // Patch the selected element's style.
  const updEl = (patch: Partial<DocElement>) => {
    if (selected) setElement(selected.id, patch);
  };

  // Z-order within the current size (z lives per-size on the box).
  function bringForward() {
    if (!selected || !selectedBox) return;
    const maxZ = Object.values(layout).reduce((m, b) => Math.max(m, b.z ?? 0), 0);
    setBox(size.id, selected.id, { ...selectedBox, z: maxZ + 1 });
  }
  function sendBack() {
    if (!selected || !selectedBox) return;
    const minZ = Object.values(layout).reduce((m, b) => Math.min(m, b.z ?? 0), 0);
    setBox(size.id, selected.id, { ...selectedBox, z: minZ - 1 });
  }

  // ── template field-list operations ──
  const addField = () => {
    setDoc((prev) => ({ ...prev, fields: [...prev.fields, { key: `field_${rid()}`, label: 'New field', type: 'text' }] }));
  };
  const updateFieldAt = (i: number, patch: Partial<FieldSpec>) => {
    setDoc((prev) => ({ ...prev, fields: prev.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) }));
  };
  // Renaming a field key cascades to every binding that references it (and its default).
  const renameFieldKeyAt = (i: number, newKey: string) => {
    setDoc((prev) => {
      const old = prev.fields[i]?.key;
      if (old == null) return prev;
      const fields = prev.fields.map((f, idx) => (idx === i ? { ...f, key: newKey } : f));
      const elements = prev.elements.map((e) =>
        e.binding?.kind === 'field' && e.binding.key === old ? { ...e, binding: { kind: 'field' as const, key: newKey } } : e,
      );
      const defaults = { ...prev.defaults };
      if (old in defaults) {
        defaults[newKey] = defaults[old];
        delete defaults[old];
      }
      return { ...prev, fields, elements, defaults };
    });
  };
  const deleteFieldAt = (i: number) => {
    setDoc((prev) => {
      const key = prev.fields[i]?.key;
      const fields = prev.fields.filter((_, idx) => idx !== i);
      const elements = key
        ? prev.elements.map((e) =>
            e.binding?.kind === 'field' && e.binding.key === key ? { ...e, binding: { kind: 'static' as const, value: '' } } : e,
          )
        : prev.elements;
      const defaults = { ...prev.defaults };
      if (key && key in defaults) delete defaults[key];
      return { ...prev, fields, elements, defaults };
    });
  };
  const setDefaultAt = (i: number, val: string) => {
    setDoc((prev) => {
      const key = prev.fields[i]?.key;
      if (!key) return prev;
      return { ...prev, defaults: { ...prev.defaults, [key]: val } };
    });
  };

  // ── per-size operations ──
  // Show/hide an element in the CURRENT size only (the box stays, just isn't rendered).
  function toggleHidden(id: string) {
    const box = layout[id];
    if (!box) return;
    setBox(size.id, id, { ...box, hidden: !box.hidden });
  }

  // Lock/unlock an element (builder-only; deselects it when locking).
  function toggleLock(id: string) {
    setElement(id, { locked: !doc.elements.find((e) => e.id === id)?.locked });
    setSelectedIds((ids) => ids.filter((x) => x !== id));
  }

  // Rename an element's layer label (double-click in the Layers panel).
  function renameElement(id: string, name: string) {
    setElement(id, { name: name.trim() || undefined });
  }

  // Drag-reorder in the Layers panel → reassign z within the CURRENT size so the
  // dropped order sticks (z is per-size). `orderTopFirst` is front→back (as the
  // Layers list shows it); the renderer paints low z first, so invert.
  function reorderLayers(orderTopFirst: string[]) {
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      const n = orderTopFirst.length;
      orderTopFirst.forEach((id, i) => {
        const b = lay[id];
        if (b) lay[id] = { ...b, z: n - i }; // top of list = highest z (front)
      });
      return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
    });
  }

  // ── element groups (⌘G) — groups can nest within groups ──
  // Group the selection: wrap the distinct "units" (whole sub-groups or loose
  // elements) it touches, under their deepest common ancestor. So selecting two
  // groups nests both in a new parent; selecting elements inside a group makes a
  // sub-group there.
  function groupSelected() {
    const S = selectedIds;
    if (S.length < 2) return;
    const chains = S.map((id) => ancestorChain(id));
    // Deepest common ancestor group of the whole selection (null = root).
    let parent: string | null = null;
    for (const g of chains[0] ?? []) {
      if (chains.every((c) => c.includes(g))) {
        parent = g;
        break;
      }
    }
    // The unit each element belongs to at the common-parent level: the sub-group
    // just below `parent`, or the element itself if it's a direct child.
    const units = new Map<string, { kind: 'group' | 'element'; id: string }>();
    for (const id of S) {
      const chain = ancestorChain(id);
      const pIdx = parent ? chain.indexOf(parent) : chain.length;
      const u = pIdx > 0 ? { kind: 'group' as const, id: chain[pIdx - 1] } : { kind: 'element' as const, id };
      units.set(`${u.kind}:${u.id}`, u);
    }
    const unitList = [...units.values()];
    if (unitList.length < 2) return;
    // Redundant if we'd just re-wrap ALL of an existing group's children.
    if (parent) {
      const childCount =
        (doc.groups ?? []).filter((g) => (g.parentId ?? null) === parent).length +
        doc.elements.filter((e) => (e.groupId ?? null) === parent).length;
      if (unitList.length >= childCount) return;
    }
    const gid = `grp-${rid()}`;
    const groupUnitIds = new Set(unitList.filter((u) => u.kind === 'group').map((u) => u.id));
    const elUnitIds = new Set(unitList.filter((u) => u.kind === 'element').map((u) => u.id));
    setDoc((prev) => {
      const used = (prev.groups ?? []).length;
      const elements = prev.elements.map((e) => (elUnitIds.has(e.id) ? { ...e, groupId: gid } : e));
      const groups = [
        ...(prev.groups ?? []).map((g) => (groupUnitIds.has(g.id) ? { ...g, parentId: gid } : g)),
        { id: gid, name: `Group ${used + 1}`, parentId: parent ?? undefined },
      ];
      return { ...prev, elements, groups, layouts: normalizeGroupZ(elements, groups, prev.sizes, prev.layouts) };
    });
  }

  // Dissolve a group: promote its child elements + sub-groups up to its parent.
  function ungroupGroup(gid: string) {
    setDoc((prev) => {
      const parent = (prev.groups ?? []).find((g) => g.id === gid)?.parentId;
      return {
        ...prev,
        elements: prev.elements.map((e) => (e.groupId === gid ? { ...e, groupId: parent } : e)),
        groups: (prev.groups ?? []).filter((g) => g.id !== gid).map((g) => (g.parentId === gid ? { ...g, parentId: parent } : g)),
      };
    });
  }

  // Ungroup what the selection represents: the exact group if it matches one,
  // else each distinct innermost group of the selected elements.
  function ungroupSelected() {
    const sel = new Set(selectedIds);
    const match = (doc.groups ?? []).find((g) => {
      const m = membersOf(g.id);
      return m.length === sel.size && m.every((x) => sel.has(x));
    });
    if (match) {
      ungroupGroup(match.id);
      return;
    }
    const gids = new Set(selectedIds.map((id) => elementGroup.get(id)).filter((g): g is string => Boolean(g)));
    gids.forEach((g) => ungroupGroup(g));
  }
  const selectGroup = useCallback((gid: string) => setSelectedIds(membersOf(gid)), [membersOf]);

  // Delete every selected element in one step, dropping any group left empty.
  function deleteSelected() {
    const ids = new Set(selectedIds);
    if (!ids.size) return;
    setDoc((prev) => {
      const elements = prev.elements.filter((e) => !ids.has(e.id));
      const layouts: typeof prev.layouts = {};
      for (const sid of Object.keys(prev.layouts)) {
        layouts[sid] = Object.fromEntries(Object.entries(prev.layouts[sid]).filter(([k]) => !ids.has(k)));
      }
      const parentOf = new Map((prev.groups ?? []).map((g) => [g.id, g.parentId ?? null]));
      const stillUsed = (gid: string) =>
        elements.some((e) => {
          let g = e.groupId ?? null;
          const seen = new Set<string>();
          while (g && !seen.has(g)) {
            if (g === gid) return true;
            seen.add(g);
            g = parentOf.get(g) ?? null;
          }
          return false;
        });
      const groups = (prev.groups ?? []).filter((g) => stillUsed(g.id));
      return { ...prev, elements, layouts, groups };
    });
    clearSelection();
    setCtxMenu(null);
  }

  // Right-click → context menu. Selects the target first (a grouped element →
  // its outermost group), unless it's already part of the current selection.
  function openCanvasMenu(e: React.MouseEvent, elId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (lockedIds.has(elId)) return;
    if (!selectedIds.includes(elId)) {
      const chain = ancestorChain(elId);
      const outer = chain[chain.length - 1];
      if (outer) setSelectedIds(membersOf(outer));
      else selectOne(elId);
    }
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }
  function openLayerMenu(e: React.MouseEvent, opts: { elId?: string; gid?: string }) {
    e.preventDefault();
    e.stopPropagation();
    if (opts.gid) setSelectedIds(membersOf(opts.gid));
    else if (opts.elId && !selectedIds.includes(opts.elId)) selectOne(opts.elId);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }
  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCtxMenu(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  function toggleGroupCollapsed(gid: string) {
    setDoc((prev) => ({ ...prev, groups: (prev.groups ?? []).map((g) => (g.id === gid ? { ...g, collapsed: !g.collapsed } : g)) }));
  }
  function renameGroup(gid: string, name: string) {
    const n = name.trim();
    setDoc((prev) => ({ ...prev, groups: (prev.groups ?? []).map((g) => (g.id === gid ? { ...g, name: n || g.name } : g)) }));
  }
  // Lock / hide every member of a group together (locked is per-element; hidden
  // is per-size on the box).
  function toggleGroupLock(gid: string) {
    const ids = membersOf(gid);
    const anyUnlocked = ids.some((id) => !doc.elements.find((e) => e.id === id)?.locked);
    setDoc((prev) => ({ ...prev, elements: prev.elements.map((e) => (ids.includes(e.id) ? { ...e, locked: anyUnlocked } : e)) }));
  }
  function toggleGroupHidden(gid: string) {
    const ids = membersOf(gid);
    const lay = doc.layouts[size.id] ?? {};
    const anyVisible = ids.some((id) => lay[id] && !lay[id].hidden);
    setDoc((prev) => {
      const cur = { ...(prev.layouts[size.id] ?? {}) };
      for (const id of ids) if (cur[id]) cur[id] = { ...cur[id], hidden: anyVisible };
      return { ...prev, layouts: { ...prev.layouts, [size.id]: cur } };
    });
  }

  // New sizes start from the current size's layout so they're not empty.
  function addSize(label: string, width: number, height: number) {
    const base = `${width}x${height}`;
    let id = base;
    let n = 2;
    while (doc.sizes.some((s) => s.id === id)) id = `${base}-${n++}`;
    const src = doc.layouts[sizeId] ?? {};
    setDoc((prev) => ({
      ...prev,
      sizes: [...prev.sizes, { id, label: `${label} ${width}×${height}`, width, height }],
      layouts: { ...prev.layouts, [id]: structuredClone(src) },
    }));
    setSizeId(id);
    setAddSizeOpen(false);
  }

  // Create a NEW size in the shared library (anyone can), then add it here.
  async function createLibrarySize() {
    const w = Number(customW);
    const h = Number(customH);
    const name = customName.trim();
    if (!name || !(w > 0) || !(h > 0)) {
      toast.error('Name, width, and height are required');
      return;
    }
    try {
      const res = await fetch('/api/ad-generator/sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, width: Math.round(w), height: Math.round(h) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.size) setLibSizes((prev) => [json.size, ...prev]);
      addSize(name, Math.round(w), Math.round(h));
      setCustomName('');
      setCustomW('');
      setCustomH('');
      toast.success('Size created');
    } catch (err) {
      toast.error(`Couldn't create size: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function removeSize(targetId: string) {
    if (doc.sizes.length <= 1) return;
    setDoc((prev) => {
      const layouts = { ...prev.layouts };
      delete layouts[targetId];
      return { ...prev, sizes: prev.sizes.filter((s) => s.id !== targetId), layouts };
    });
    if (sizeId === targetId) setSizeId(doc.sizes.find((s) => s.id !== targetId)!.id);
  }

  // Copy another size's full layout into the current size (fractions are
  // size-independent; font sizes carry over as a starting point to tune).
  function copyLayoutFrom(srcId: string) {
    setDoc((prev) => ({
      ...prev,
      layouts: { ...prev.layouts, [sizeId]: structuredClone(prev.layouts[srcId] ?? {}) },
    }));
  }

  // Safe-area margin (value + unit, builder-only guide).
  function setMargin(patch: Partial<{ value: number; unit: MarginUnit }>) {
    setDoc((prev) => {
      const cur = prev.safeArea ?? { value: 5, unit: 'percent' as MarginUnit };
      return { ...prev, safeArea: { ...cur, ...patch } };
    });
  }
  // Edit the artboard background (shown in the inspector when nothing is selected).
  function setBackground(patch: Partial<DocBackground>) {
    setDoc((prev) => ({ ...prev, background: { ...(prev.background ?? {}), ...patch } }));
  }
  // The Margins toggle (on shows the guide + controls; seeds a default if unset).
  function toggleMargins() {
    setShowSafe((v) => {
      const next = !v;
      if (next && !doc.safeArea) setMargin({ value: 5, unit: 'percent' });
      return next;
    });
  }

  // ── industries (which accounts this template is offered to) ──
  const allIndustries = useIndustries();
  const toggleIndustry = useCallback(
    (name: string) => {
      setDoc((prev) => {
        const cur = prev.industries ?? [];
        const next = cur.includes(name) ? cur.filter((i) => i !== name) : [...cur, name];
        return { ...prev, industries: next };
      });
    },
    [setDoc],
  );

  // ── save / load ──
  async function save(asNew = false) {
    // Ad mode — persist the design to THIS ad (not a template).
    if (adId) {
      const name = templateName.trim() || 'Untitled ad';
      setSaving(true);
      try {
        const res = await fetch(`/api/ad-generator/creatives/${adId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, doc: { ...doc, name } }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
        savedRef.current = serializeDoc(doc, name, status);
        setSaveStatus('saved');
        toast.success('Saved to this ad');
      } catch (err) {
        setSaveStatus('error');
        toast.error(`Couldn't save: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setSaving(false);
      }
      return;
    }
    const name = templateName.trim();
    if (!name) {
      toast.error('Name the template first');
      return;
    }
    setSaving(true);
    try {
      const payload = { name, doc: { ...doc, name }, status };
      const useId = templateId && !asNew;
      const res = await fetch(useId ? `/api/ad-generator/templates-doc/${templateId}` : '/api/ad-generator/templates-doc', {
        method: useId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const json = (await res.json()) as { template?: { id: string } };
      if (json.template?.id) setTemplateId(json.template.id);
      savedRef.current = serializeDoc(doc, name, status);
      setSaveStatus('saved');
      toast.success(status === 'published' ? 'Saved & published' : 'Saved as draft');
    } catch (err) {
      setSaveStatus('error');
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function openLoad() {
    setLoadOpen(true);
    setLoadingList(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc?all=1');
      const json = res.ok ? ((await res.json()) as { templates?: SavedTemplate[] }) : { templates: [] };
      setSavedList(json.templates ?? []);
    } catch {
      setSavedList([]);
    } finally {
      setLoadingList(false);
    }
  }

  function loadTemplate(t: SavedTemplate) {
    if (!t.doc) {
      toast.error('That template could not be read');
      return;
    }
    const loaded = structuredClone(t.doc);
    const st = t.status === 'published' ? 'published' : 'draft';
    resetHistory(loaded);
    setTemplateId(t.id);
    setTemplateName(t.name);
    setStatus(st);
    setSizeId(loaded.sizes[0]?.id ?? '');
    clearSelection();
    setLoadOpen(false);
    savedRef.current = serializeDoc(loaded, t.name, st);
    setSaveStatus('saved');
    toast.success(`Loaded "${t.name}"`);
  }

  async function deleteSaved(id: string) {
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedList((list) => list.filter((t) => t.id !== id));
      if (templateId === id) setTemplateId(null);
      toast.success('Deleted');
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function newBlank() {
    const id = `tmpl-${rid()}`;
    resetHistory({
      id,
      name: 'Untitled template',
      sizes: [{ id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080 }],
      fields: [],
      background: { color: '#ffffff' },
      elements: [],
      layouts: { square: {} },
      defaults: {},
    });
    setTemplateId(null);
    setTemplateName('Untitled template');
    setStatus('draft');
    setSizeId('square');
    clearSelection();
    savedRef.current = '';
    setSaveStatus('idle');
  }

  // Deep-link: `/ad-generator/builder?template=<id>` opens an existing template
  // for editing (the Templates → Ads tab links here). Runs once on mount; reads
  // the query client-side so no Suspense boundary is needed.
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const adParam = params.get('ad');
    const tid = params.get('template');
    if (!adParam && !tid) return;
    deepLinkedRef.current = true;
    (async () => {
      try {
        if (adParam) {
          // Ad mode — edit THIS ad's own design copy, saving back to the ad.
          const res = await fetch(`/api/ad-generator/creatives/${adParam}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { creative?: { id: string; name: string; templateId: string; data: AdData; doc: TemplateDoc | null } };
          const c = json.creative;
          if (!c) throw new Error('not found');
          let d = c.doc;
          if (!d) {
            // No snapshot yet (e.g. a code-template ad) — resolve the source doc.
            if (c.templateId === vehicleOfferDoc.id) d = structuredClone(vehicleOfferDoc);
            else {
              const tr = await fetch(`/api/ad-generator/templates-doc/${c.templateId}`);
              if (tr.ok) d = (((await tr.json()) as { template?: { doc: TemplateDoc | null } }).template?.doc) ?? null;
            }
          }
          if (!d || !Array.isArray(d.sizes) || !d.sizes.length) {
            toast.error("This ad's template can't be edited in the builder");
            return;
          }
          resetHistory(d);
          setAdId(c.id);
          setAdData(c.data ?? {});
          setTemplateName(c.name);
          setSizeId(d.sizes[0].id);
          savedRef.current = serializeDoc(d, c.name, 'draft');
          setSaveStatus('saved');
          return;
        }
        const res = await fetch(`/api/ad-generator/templates-doc/${tid}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { template?: { id: string; name: string; description: string | null; status: string; doc: TemplateDoc | null } };
        const t = json.template;
        if (t?.doc) loadTemplate({ id: t.id, name: t.name, description: t.description, status: t.status, updatedAt: '', doc: t.doc });
        else toast.error('That template could not be opened');
      } catch {
        toast.error('Could not open that');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── pointer interactions: single drag · group drag · marquee select ──
  type DragState =
    | { kind: 'single'; handle: Handle; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; elId: string; start: DocLayoutBox; live: DocLayoutBox; targetsX: number[]; targetsY: number[]; scaleFont: boolean }
    | { kind: 'group'; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; items: { elId: string; start: DocLayoutBox }[]; bounds: { left: number; cx: number; right: number; top: number; cy: number; bottom: number }; minDx: number; maxDx: number; minDy: number; maxDy: number; targetsX: number[]; targetsY: number[]; live: Record<string, DocLayoutBox> }
    | { kind: 'groupresize'; handle: Handle; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; bounds: { left: number; top: number; right: number; bottom: number }; items: { elId: string; start: DocLayoutBox; isText: boolean }[]; live: Record<string, DocLayoutBox> }
    | { kind: 'marquee'; left: number; top: number; fw: number; fh: number; startXF: number; startYF: number; rect: { x: number; y: number; w: number; h: number } }
    | { kind: 'bgpan'; sx: number; sy: number; sizeId: string; elId: string; startObjX: number; startObjY: number; overflowX: number; overflowY: number; url: string; coverW: number; coverH: number; dragging: boolean; live: { objectX: number; objectY: number } };
  const dragRef = useRef<DragState | null>(null);

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const moveListener = useCallback((e: PointerEvent) => onMoveRef.current(e), []);
  const upListener = useCallback((e: PointerEvent) => onUpRef.current(e), []);

  // Edges/centers to snap to: every other visible element + canvas + safe area.
  function snapTargets(exclude: Set<string>) {
    const tx = [0, 0.5, 1];
    const ty = [0, 0.5, 1];
    const sa = showSafe ? safeAreaFractions(doc.safeArea, size.width, size.height) : null;
    if (sa) {
      tx.push(sa.x, 1 - sa.x);
      ty.push(sa.y, 1 - sa.y);
    }
    for (const p of placed) {
      if (exclude.has(p.el.id) || p.box.hidden) continue;
      tx.push(p.box.x, p.box.x + p.box.w / 2, p.box.x + p.box.w);
      ty.push(p.box.y, p.box.y + p.box.h / 2, p.box.y + p.box.h);
    }
    return { tx, ty };
  }

  // Nudge the live node inside the iframe so content moves with the outline.
  function moveNode(elId: string, b: DocLayoutBox, nw: number, nh: number) {
    const node = iframeRef.current?.contentDocument?.querySelector(`[data-el-id="${elId}"]`) as HTMLElement | null;
    if (node) {
      node.style.left = `${b.x * nw}px`;
      node.style.top = `${b.y * nh}px`;
      node.style.width = `${b.w * nw}px`;
      node.style.height = `${b.h * nh}px`;
      if (b.fontSize != null) node.style.fontSize = `${b.fontSize}px`;
    }
  }

  onMoveRef.current = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'marquee') {
      const cx = (e.clientX - d.left) / d.fw;
      const cy = (e.clientY - d.top) / d.fh;
      const x = clamp(Math.min(d.startXF, cx), 0, 1);
      const y = clamp(Math.min(d.startYF, cy), 0, 1);
      d.rect = { x, y, w: clamp(Math.abs(cx - d.startXF), 0, 1 - x), h: clamp(Math.abs(cy - d.startYF), 0, 1 - y) };
      setMarquee(d.rect);
      return;
    }
    if (d.kind === 'bgpan') {
      const dxPx = e.clientX - d.sx;
      const dyPx = e.clientY - d.sy;
      // Ignore sub-threshold jitter so a plain click never flashes the preview.
      if (!d.dragging && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
      d.dragging = true;
      // Pan the background: dragging the image right reveals more of its left
      // side, so object-position decreases. Movement is 1:1 with the cursor
      // (mapped through the cover overflow). Axes with no overflow stay put.
      const ox = d.overflowX > 0 ? clamp(d.startObjX - dxPx / d.overflowX, 0, 1) : d.startObjX;
      const oy = d.overflowY > 0 ? clamp(d.startObjY - dyPx / d.overflowY, 0, 1) : d.startObjY;
      d.live = { objectX: ox, objectY: oy };
      setBgPan({ url: d.url, coverW: d.coverW, coverH: d.coverH, overflowX: d.overflowX, overflowY: d.overflowY, objectX: ox, objectY: oy });
      return;
    }
    const dxF = (e.clientX - d.sx) / d.fw;
    const dyF = (e.clientY - d.sy) / d.fh;
    if (d.kind === 'single') {
      const box = computeBox(d.handle, d.start, dxF, dyF);
      let gx: number | null = null;
      let gy: number | null = null;
      if (d.handle === 'move') {
        const sx = bestSnap([box.x, box.x + box.w / 2, box.x + box.w], d.targetsX, SNAP_PX / d.fw);
        const sy = bestSnap([box.y, box.y + box.h / 2, box.y + box.h], d.targetsY, SNAP_PX / d.fh);
        box.x = clamp(box.x + sx.off, 0, 1 - box.w);
        box.y = clamp(box.y + sy.off, 0, 1 - box.h);
        gx = sx.guide;
        gy = sy.guide;
      } else if (d.scaleFont && d.start.fontSize && d.start.h > 0) {
        // Resizing text scales the font with the box height (not just reflow).
        box.fontSize = Math.max(4, Math.round(d.start.fontSize * (box.h / d.start.h)));
      }
      d.live = box;
      setDragBox(box);
      setGuides({ x: gx, y: gy });
      moveNode(d.elId, box, d.nw, d.nh);
    } else if (d.kind === 'group') {
      // group — translate all by a clamped delta, snapping the group's bounds.
      let ddx = clamp(dxF, d.minDx, d.maxDx);
      let ddy = clamp(dyF, d.minDy, d.maxDy);
      const sx = bestSnap([d.bounds.left + ddx, d.bounds.cx + ddx, d.bounds.right + ddx], d.targetsX, SNAP_PX / d.fw);
      const sy = bestSnap([d.bounds.top + ddy, d.bounds.cy + ddy, d.bounds.bottom + ddy], d.targetsY, SNAP_PX / d.fh);
      ddx = clamp(ddx + sx.off, d.minDx, d.maxDx);
      ddy = clamp(ddy + sy.off, d.minDy, d.maxDy);
      const live: Record<string, DocLayoutBox> = {};
      for (const it of d.items) {
        const nb = { ...it.start, x: it.start.x + ddx, y: it.start.y + ddy };
        live[it.elId] = nb;
        moveNode(it.elId, nb, d.nw, d.nh);
      }
      d.live = live;
      setGroupLive(live);
      setGuides({ x: sx.guide, y: sy.guide });
    } else if (d.kind === 'groupresize') {
      // group resize — scale every box (and text font) about the opposite edge.
      const w0 = d.bounds.right - d.bounds.left;
      const h0 = d.bounds.bottom - d.bounds.top;
      const rect = computeBox(d.handle, { x: d.bounds.left, y: d.bounds.top, w: w0, h: h0 }, dxF, dyF);
      const scaleX = w0 > 0 ? rect.w / w0 : 1;
      const scaleY = h0 > 0 ? rect.h / h0 : 1;
      const live: Record<string, DocLayoutBox> = {};
      for (const it of d.items) {
        const nb: DocLayoutBox = {
          ...it.start,
          x: clamp(rect.x + (it.start.x - d.bounds.left) * scaleX, 0, 1),
          y: clamp(rect.y + (it.start.y - d.bounds.top) * scaleY, 0, 1),
          w: Math.max(MIN_FRAC, it.start.w * scaleX),
          h: Math.max(MIN_FRAC, it.start.h * scaleY),
        };
        if (it.isText && it.start.fontSize) nb.fontSize = Math.max(4, Math.round(it.start.fontSize * scaleY));
        live[it.elId] = nb;
        moveNode(it.elId, nb, d.nw, d.nh);
      }
      d.live = live;
      setGroupLive(live);
    }
  };

  onUpRef.current = () => {
    const d = dragRef.current;
    if (d?.kind === 'single') {
      setBox(d.sizeId, d.elId, d.live);
    } else if (d?.kind === 'group' || d?.kind === 'groupresize') {
      setDoc((prev) => {
        const lay = { ...(prev.layouts[d.sizeId] ?? {}) };
        for (const id of Object.keys(d.live)) lay[id] = d.live[id];
        return { ...prev, layouts: { ...prev.layouts, [d.sizeId]: lay } };
      });
    } else if (d?.kind === 'marquee') {
      const r = d.rect;
      if (r.w > 0.01 || r.h > 0.01) {
        const hit = placed
          .filter((p) => !p.box.hidden && !p.el.locked && p.box.x < r.x + r.w && p.box.x + p.box.w > r.x && p.box.y < r.y + r.h && p.box.y + p.box.h > r.y)
          .map((p) => p.el.id);
        setSelectedIds(hit);
      }
    } else if (d?.kind === 'bgpan' && d.dragging) {
      const { elId, sizeId, live } = d;
      setDoc((prev) => {
        const lay = prev.layouts[sizeId] ?? {};
        const b = lay[elId];
        if (!b) return prev;
        return { ...prev, layouts: { ...prev.layouts, [sizeId]: { ...lay, [elId]: { ...b, objectX: live.objectX, objectY: live.objectY } } } };
      });
    }
    dragRef.current = null;
    setDragBox(null);
    setGroupLive(null);
    setGuides({ x: null, y: null });
    setMarquee(null);
    setBgPan(null);
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

  function listen() {
    window.addEventListener('pointermove', moveListener);
    window.addEventListener('pointerup', upListener);
  }

  function startSingleDrag(e: React.PointerEvent, elId: string, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    const box = (doc.layouts[size.id] ?? {})[elId];
    if (!box) return;
    const { tx, ty } = snapTargets(new Set([elId]));
    const scaleFont = doc.elements.find((el) => el.id === elId)?.type === 'text';
    dragRef.current = { kind: 'single', handle, sx: e.clientX, sy: e.clientY, fw: frameW, fh: frameH, nw: size.width, nh: size.height, sizeId: size.id, elId, start: { ...box }, live: { ...box }, targetsX: tx, targetsY: ty, scaleFont };
    setDragBox({ ...box });
    listen();
  }

  function startGroupDrag(e: React.PointerEvent, ids: string[] = selectedIds) {
    const lay = doc.layouts[size.id] ?? {};
    const items = ids
      .map((id) => ({ elId: id, start: lay[id] }))
      .filter((it): it is { elId: string; start: DocLayoutBox } => Boolean(it.start) && !it.start!.hidden);
    if (items.length < 2) return;
    const left = Math.min(...items.map((it) => it.start.x));
    const right = Math.max(...items.map((it) => it.start.x + it.start.w));
    const top = Math.min(...items.map((it) => it.start.y));
    const bottom = Math.max(...items.map((it) => it.start.y + it.start.h));
    const { tx, ty } = snapTargets(new Set(items.map((it) => it.elId)));
    dragRef.current = {
      kind: 'group',
      sx: e.clientX,
      sy: e.clientY,
      fw: frameW,
      fh: frameH,
      nw: size.width,
      nh: size.height,
      sizeId: size.id,
      items,
      bounds: { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 },
      minDx: -left,
      maxDx: 1 - right,
      minDy: -top,
      maxDy: 1 - bottom,
      targetsX: tx,
      targetsY: ty,
      live: {},
    };
    listen();
  }

  // Resize the whole multi-selection from a bounding-box handle: scale every
  // box (and text font size) proportionally about the opposite edge/corner.
  function startGroupResize(e: React.PointerEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    const lay = doc.layouts[size.id] ?? {};
    const items = selectedIds
      .map((id) => ({ elId: id, start: lay[id], isText: doc.elements.find((el) => el.id === id)?.type === 'text' }))
      .filter((it): it is { elId: string; start: DocLayoutBox; isText: boolean } => Boolean(it.start) && !it.start!.hidden);
    if (items.length < 2) return;
    const left = Math.min(...items.map((it) => it.start.x));
    const top = Math.min(...items.map((it) => it.start.y));
    const right = Math.max(...items.map((it) => it.start.x + it.start.w));
    const bottom = Math.max(...items.map((it) => it.start.y + it.start.h));
    dragRef.current = {
      kind: 'groupresize',
      handle,
      sx: e.clientX,
      sy: e.clientY,
      fw: frameW,
      fh: frameH,
      nw: size.width,
      nh: size.height,
      sizeId: size.id,
      bounds: { left, top, right, bottom },
      items,
      live: {},
    };
    listen();
  }

  function startMarquee(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startXF = (e.clientX - rect.left) / frameW;
    const startYF = (e.clientY - rect.top) / frameH;
    clearSelection();
    dragRef.current = { kind: 'marquee', left: rect.left, top: rect.top, fw: frameW, fh: frameH, startXF, startYF, rect: { x: startXF, y: startYF, w: 0, h: 0 } };
    setMarquee({ x: startXF, y: startYF, w: 0, h: 0 });
    listen();
  }

  // Pan the selected background photo: dragging maps to object-position via the
  // cover overflow, so the image tracks the cursor and its off-canvas bleed shows.
  function startBgPan(e: React.PointerEvent, elId: string) {
    const box = layout[elId];
    const url = resolveBindingUrl(doc.elements.find((x) => x.id === elId));
    if (!box || !bgNatural || !url) return;
    const coverScale = Math.max(frameW / bgNatural.w, frameH / bgNatural.h);
    const coverW = bgNatural.w * coverScale;
    const coverH = bgNatural.h * coverScale;
    const overflowX = Math.max(0, coverW - frameW);
    const overflowY = Math.max(0, coverH - frameH);
    const startObjX = box.objectX ?? 0.5;
    const startObjY = box.objectY ?? 0.5;
    // Armed, but the bleed preview only appears once the pointer actually moves —
    // a plain click just selects the background (no flash).
    dragRef.current = { kind: 'bgpan', sx: e.clientX, sy: e.clientY, sizeId: size.id, elId, startObjX, startObjY, overflowX, overflowY, url, coverW, coverH, dragging: false, live: { objectX: startObjX, objectY: startObjY } };
    listen();
  }

  // Element pointerdown: Shift toggles selection; otherwise select (or keep a
  // multi-selection) and start a single / group drag.
  function onBoxPointerDown(e: React.PointerEvent, elId: string) {
    e.preventDefault();
    e.stopPropagation();
    // A LOCKED element can't be selected — clicking it clears the selection, so a
    // locked background behaves like the backdrop ("click off an element to
    // deselect"). Unlocked elements select normally.
    if (lockedIds.has(elId)) {
      if (!e.shiftKey) clearSelection();
      return;
    }
    if (e.shiftKey) {
      toggleSelect(elId);
      return;
    }
    // Clicking the (unlocked) background photo — or the full-bleed scrim above
    // it — selects the background and lets you drag to reposition it, showing the
    // off-canvas bleed. Resize via the Layers panel / handles if you need to.
    if (bgImageId && bgNatural && !lockedIds.has(bgImageId) && (elId === bgImageId || isFullBleed(elId))) {
      if (selectedId !== bgImageId) selectOne(bgImageId);
      startBgPan(e, bgImageId);
      return;
    }
    // A grouped element selects (and drags) its OUTERMOST group as a unit
    // (double-click drills into the element). Nested groups → top-level group.
    const chain = ancestorChain(elId);
    const outer = chain[chain.length - 1];
    if (outer) {
      const members = membersOf(outer).filter((id) => !lockedIds.has(id));
      if (members.length > 1) {
        setSelectedIds(members);
        startGroupDrag(e, members);
        return;
      }
    }
    if (selectedIds.length > 1 && selectedIds.includes(elId)) {
      startGroupDrag(e);
      return;
    }
    selectOne(elId);
    startSingleDrag(e, elId, 'move');
  }

  // ── align / distribute the multi-selection ──
  function applyBoxes(patch: Record<string, DocLayoutBox>) {
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      for (const id of Object.keys(patch)) lay[id] = patch[id];
      return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
    });
  }

  function alignSelected(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom') {
    const boxes = selectedIds.map((id) => ({ id, box: layout[id] })).filter((b): b is { id: string; box: DocLayoutBox } => Boolean(b.box));
    if (boxes.length < 2) return;
    const left = Math.min(...boxes.map((b) => b.box.x));
    const right = Math.max(...boxes.map((b) => b.box.x + b.box.w));
    const top = Math.min(...boxes.map((b) => b.box.y));
    const bottom = Math.max(...boxes.map((b) => b.box.y + b.box.h));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const patch: Record<string, DocLayoutBox> = {};
    for (const { id, box } of boxes) {
      let { x, y } = box;
      if (edge === 'left') x = left;
      else if (edge === 'right') x = right - box.w;
      else if (edge === 'hcenter') x = cx - box.w / 2;
      else if (edge === 'top') y = top;
      else if (edge === 'bottom') y = bottom - box.h;
      else if (edge === 'vmiddle') y = cy - box.h / 2;
      patch[id] = { ...box, x: clamp(x, 0, 1 - box.w), y: clamp(y, 0, 1 - box.h) };
    }
    applyBoxes(patch);
  }

  function distributeSelected(axis: 'h' | 'v') {
    const boxes = selectedIds.map((id) => ({ id, box: layout[id] })).filter((b): b is { id: string; box: DocLayoutBox } => Boolean(b.box));
    if (boxes.length < 3) return; // equal gaps need 3+
    const patch: Record<string, DocLayoutBox> = {};
    if (axis === 'h') {
      boxes.sort((a, b) => a.box.x - b.box.x);
      const start = boxes[0].box.x;
      const end = boxes[boxes.length - 1].box.x + boxes[boxes.length - 1].box.w;
      const totalW = boxes.reduce((s, b) => s + b.box.w, 0);
      const gap = (end - start - totalW) / (boxes.length - 1);
      let cur = start;
      for (const { id, box } of boxes) {
        patch[id] = { ...box, x: cur };
        cur += box.w + gap;
      }
    } else {
      boxes.sort((a, b) => a.box.y - b.box.y);
      const start = boxes[0].box.y;
      const end = boxes[boxes.length - 1].box.y + boxes[boxes.length - 1].box.h;
      const totalH = boxes.reduce((s, b) => s + b.box.h, 0);
      const gap = (end - start - totalH) / (boxes.length - 1);
      let cur = start;
      for (const { id, box } of boxes) {
        patch[id] = { ...box, y: cur };
        cur += box.h + gap;
      }
    }
    applyBoxes(patch);
  }

  // ── keyboard: nudge / delete ALL selected elements ──
  useEffect(() => {
    if (selectedIds.length === 0) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        selectedIds.forEach((id) => deleteElement(id));
        return;
      }
      let dx = 0;
      let dy = 0;
      const step = e.shiftKey ? 0.02 : 0.005;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      setDoc((prev) => {
        const lay = { ...(prev.layouts[size.id] ?? {}) };
        for (const id of selectedIds) {
          const b = lay[id];
          if (b) lay[id] = { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) };
        }
        return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, size.id, deleteElement, setDoc, clearSelection]);

  // ⌘Z / ⌘⇧Z undo-redo + ⌘G / ⌘⇧G group/ungroup — global, but defer to the
  // browser inside text fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedIds, doc.elements, doc.groups]);

  // Autosave — debounced PATCH once there's a target (a saved template, or the
  // ad in ad mode). New/unsaved templates require an explicit Save first.
  useEffect(() => {
    if (!templateId && !adId) return;
    const snapshot = serializeDoc(doc, templateName, status);
    if (snapshot === savedRef.current) return; // nothing changed since last persist
    const handle = window.setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const url = adId ? `/api/ad-generator/creatives/${adId}` : `/api/ad-generator/templates-doc/${templateId}`;
        const body = adId
          ? { name: templateName.trim() || 'Untitled ad', doc: { ...doc, name: templateName.trim() } }
          : { name: templateName.trim(), status, doc: { ...doc, name: templateName.trim() } };
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        savedRef.current = snapshot;
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [doc, templateName, status, templateId, adId]);

  // Element adders. A "Button" is a styled text element (no separate type); a
  // background is just an Image set to Fill — so no Logo / Background adders.
  const adders: { label: string; Icon: React.ComponentType<{ className?: string }>; onAdd: () => void }[] = [
    { label: 'Text', Icon: TextElementIcon, onAdd: () => addElement('text') },
    { label: 'Image', Icon: PhotoIcon, onAdd: () => addElement('image') },
    { label: 'Button', Icon: ButtonElementIcon, onAdd: addButton },
    { label: 'Shape', Icon: ShapeElementIcon, onAdd: () => addElement('shape') },
  ];

  const saveInfo =
    saveStatus === 'saving'
      ? { label: 'Saving…', cls: 'text-amber-500', Icon: ArrowPathIcon, spin: true }
      : saveStatus === 'error'
        ? { label: 'Save failed', cls: 'text-red-500', Icon: ExclamationTriangleIcon, spin: false }
        : saveStatus === 'saved'
          ? { label: 'Saved', cls: 'text-emerald-500', Icon: CheckIcon, spin: false }
          : { label: 'Autosave on', cls: 'text-[var(--muted-foreground)]', Icon: CloudIcon, spin: false };

  return (
    <div className="flex h-full flex-col">
      {fontFaceCss && <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />}

      {/* Editor header bar — an empty rail-width slot keeps the row below aligned
          with the canvas column; the title centers over the canvas. */}
      <header className="flex flex-shrink-0 items-center gap-4 border-b border-[var(--border)] pb-3">
        <div className="w-12 flex-shrink-0" aria-hidden="true" />

        {/* main row — spans the canvas: back at the left edge, title centered, actions right */}
        <div className="relative flex flex-1 items-center gap-2">
          <Link
            href={adId ? `/ad-generator/${adId}` : '/ad-generator'}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            title={adId ? 'Back to the ad' : 'Back to the Generator'}
            aria-label={adId ? 'Back to the ad' : 'Back to the Generator'}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </Link>

          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={adId ? 'Untitled ad' : 'Untitled template'}
            title={adId ? 'Ad name' : 'Template name'}
            className="absolute left-1/2 top-1/2 w-[min(20rem,42%)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-transparent bg-transparent px-2 py-1 text-center text-lg font-bold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
          />

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-2">
          {/* Template-management controls — hidden when editing a single ad. */}
          {!adId && (
            <>
              <button onClick={openLoad} className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]">
                Open
              </button>
              <button onClick={newBlank} className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]">
                New
              </button>
              <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] p-0.5">
                {(['draft', 'published'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                      status === s ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {templateId && (
                <button
                  onClick={() => save(true)}
                  disabled={saving}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Save as new
                </button>
              )}
            </>
          )}

          {/* Autosave status — sits right next to Save */}
          {templateId || adId ? (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${saveInfo.cls}`}>
              <saveInfo.Icon className={`h-3.5 w-3.5 ${saveInfo.spin ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{saveInfo.label}</span>
            </span>
          ) : (
            <span className="hidden text-[11px] text-[var(--muted-foreground)] sm:inline">Unsaved</span>
          )}
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          </div>
        </div>
      </header>

      {/* Body — tools sidebar + canvas */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left sidebar — tools */}
        <aside className="relative flex flex-shrink-0">
          {/* Icon rail — click an icon to open that panel as a flyout to the right */}
          <div className="flex w-12 flex-col items-center gap-1.5 pt-1">
            {/* Insert — opens the Elements flyout (Text / Image / Button / Shape).
                Lives in the rail alongside Layers / Sizes so adding never collides
                with an open panel. */}
            <RailButton label="Insert" Icon={PlusIcon} active={leftPanel === 'insert'} onClick={() => setLeftPanel((p) => (p === 'insert' ? null : 'insert'))} />
            <RailButton label="Layers" Icon={LayersIcon} active={leftPanel === 'layers'} onClick={() => setLeftPanel((p) => (p === 'layers' ? null : 'layers'))} />
            {!adId && <RailButton label="Industries" Icon={BuildingStorefrontIcon} active={leftPanel === 'industries'} onClick={() => setLeftPanel((p) => (p === 'industries' ? null : 'industries'))} />}
            <RailButton label="Sizes" Icon={DashboardLayoutIcon} active={leftPanel === 'sizes'} onClick={() => setLeftPanel((p) => (p === 'sizes' ? null : 'sizes'))} />
          </div>

          {leftPanel && (
            <div className="absolute inset-y-0 left-full z-30 ml-2 flex w-[320px] flex-col gap-4 overflow-y-auto pb-1 pr-1">
          {/* Insert — element palette. Click a tile to drop it on the canvas. */}
          {leftPanel === 'insert' && (
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <PlusIcon className="h-3.5 w-3.5" />
              Insert
            </h2>
            <AdderGrid adders={adders} variant="panel" />
            <p className="mt-3 text-[11px] leading-snug text-[var(--muted-foreground)]">Click to add to the canvas, then drag to position. The panel stays open so you can add several.</p>
          </section>
          )}

          {/* Layers — the stack of placed elements (top of the list = front).
              Double-click to rename · lock icon to lock · drag to reorder (z). */}
          {leftPanel === 'layers' && (
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <LayersIcon className="h-3.5 w-3.5" />
                Layers
              </h2>
              <span className="text-[11px] text-[var(--muted-foreground)]">{placed.length}</span>
            </div>
            <div className="space-y-1" ref={layersRef}>
              {(() => {
                const base = [...placed].reverse(); // top of list = front
                const byId = new Map(base.map((p) => [p.el.id, p] as const));
                const groupOf = (id: string) => byId.get(id)?.el.groupId ?? null;
                const docGroups = doc.groups ?? [];
                const flat = (dragLayer && dragOrder ? dragOrder : base.map((p) => p.el.id)).filter((id) => byId.has(id));
                const nodes = buildLayerTree(flat.map((id) => ({ id, groupId: groupOf(id) })), docGroups);
                const lay = doc.layouts[size.id] ?? {};

                const isGroupId = (id: string) => docGroups.some((g) => g.id === id);
                // The element ids a dragged row moves: a group moves ALL its leaves
                // as one block; an element moves just itself.
                const movingIds = (rowId: string) => (isGroupId(rowId) ? membersOf(rowId) : [rowId]);
                // The row being dragged stays VISIBLE (it live-shifts into its
                // landing spot) — we just mark it as active. A dragged group marks
                // its whole block.
                const draggedLeaves = dragLayer ? new Set(movingIds(dragLayer)) : null;
                const rowIsDragged = (rowId: string, isGroupRow: boolean) => {
                  if (!draggedLeaves) return false;
                  if (isGroupRow) {
                    const m = membersOf(rowId);
                    return m.length > 0 && m.every((x) => draggedLeaves.has(x));
                  }
                  return draggedLeaves.has(rowId);
                };

                // Drag handlers shared by element rows AND group headers (live-shift
                // on `flat`; commit re-clusters so a group's members stay contiguous).
                const dragHandlers = (rowId: string, isGroupRow: boolean, renaming: boolean) => ({
                  draggable: !renaming,
                  onDragStart: () => {
                    setDragLayer(rowId);
                    setDragOrder(flat);
                  },
                  onDragOver: (e: React.DragEvent) => {
                    e.preventDefault();
                    setDragOrder((cur) => {
                      const from = dragLayer;
                      const list = cur ?? flat;
                      if (!from || from === rowId) return list;
                      const movingSet = new Set(movingIds(from));
                      // Over-target element id: a group row targets its frontmost leaf.
                      const overEl = isGroupRow
                        ? membersOf(rowId).reduce<string | null>((best, mId) => (best === null || list.indexOf(mId) < list.indexOf(best) ? mId : best), null)
                        : rowId;
                      if (!overEl || movingSet.has(overEl)) return list;
                      const block = list.filter((x) => movingSet.has(x)); // preserve internal order
                      if (!block.length) return list;
                      const without = list.filter((x) => !movingSet.has(x));
                      let at = without.indexOf(overEl);
                      if (at < 0) return list;
                      if (list.indexOf(block[0]) < list.indexOf(overEl)) at += 1; // moving down → after
                      without.splice(at, 0, ...block);
                      return without;
                    });
                  },
                  onDragEnd: () => {
                    setDragOrder((cur) => {
                      if (cur) reorderLayers(flattenLayerTree(buildLayerTree(cur.map((x) => ({ id: x, groupId: groupOf(x) })), docGroups)));
                      return null;
                    });
                    setDragLayer(null);
                  },
                  onDrop: (e: React.DragEvent) => e.preventDefault(),
                });
                const rowDrag = (id: string, renaming: boolean) => dragHandlers(id, false, renaming);

                const renderRow = (id: string) => {
                  const entry = byId.get(id);
                  if (!entry) return null;
                  const { el, box } = entry;
                  const Icon = TYPE_ICON[el.type];
                  const isSel = selectedIds.includes(el.id);
                  const locked = !!el.locked;
                  const renaming = renamingLayer === el.id;
                  const commitRename = () => {
                    renameElement(el.id, renameDraft);
                    setRenamingLayer(null);
                  };
                  return (
                    <div
                      key={el.id}
                      data-layer-row={el.id}
                      {...rowDrag(el.id, renaming)}
                      onContextMenu={(e) => openLayerMenu(e, { elId: el.id })}
                      className={`flex items-center gap-1 rounded-lg pr-1 ${
                        isSel ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/60'
                      } ${box.hidden ? 'opacity-50' : ''} ${rowIsDragged(el.id, false) ? 'ring-1 ring-[var(--primary)]/60' : ''}`}
                    >
                      {renaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenamingLayer(null);
                          }}
                          className="flex-1 rounded-md border border-[var(--primary)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none"
                        />
                      ) : (
                        <button
                          onClick={(e) => (e.shiftKey ? toggleSelect(el.id) : selectOne(el.id))}
                          onDoubleClick={() => {
                            setRenameDraft(elName(el));
                            setRenamingLayer(el.id);
                          }}
                          className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left ${isSel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                          title="Double-click to rename"
                        >
                          <Icon className="h-4 w-4 flex-shrink-0 opacity-70" />
                          <span className="flex-1 truncate text-xs font-medium">{elName(el)}</span>
                        </button>
                      )}
                      <button
                        onClick={() => toggleLock(el.id)}
                        title={locked ? 'Unlock' : 'Lock (not editable)'}
                        className={`rounded p-1 transition-colors hover:text-[var(--foreground)] ${locked ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}
                      >
                        {locked ? <LockClosedIcon className="h-3.5 w-3.5" /> : <LockOpenIcon className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => toggleHidden(el.id)}
                        title={box.hidden ? 'Show in this size' : 'Hide in this size'}
                        className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      >
                        {box.hidden ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                };

                const renderGroup = (node: Extract<LayerNode, { kind: 'group' }>): React.ReactNode => {
                  const gid = node.groupId;
                  const meta = docGroups.find((g) => g.id === gid);
                  const gname = meta?.name ?? 'Group';
                  const collapsed = !!meta?.collapsed;
                  const renamingG = renamingLayer === gid;
                  const leaves = membersOf(gid);
                  const allSel = leaves.length > 0 && leaves.every((id) => selectedIds.includes(id));
                  const allLocked = leaves.length > 0 && leaves.every((id) => byId.get(id)?.el.locked);
                  const allHidden = leaves.length > 0 && leaves.every((id) => lay[id]?.hidden);
                  const commitGRename = () => {
                    renameGroup(gid, renameDraft);
                    setRenamingLayer(null);
                  };
                  return (
                    <div key={gid} className="rounded-lg">
                      <div
                        data-layer-row={gid}
                        {...dragHandlers(gid, true, renamingG)}
                        onContextMenu={(e) => openLayerMenu(e, { gid })}
                        className={`flex items-center gap-1 rounded-lg pr-1 ${allSel ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/60'} ${rowIsDragged(gid, true) ? 'ring-1 ring-[var(--primary)]/60' : ''}`}
                      >
                        <button onClick={() => toggleGroupCollapsed(gid)} title={collapsed ? 'Expand' : 'Collapse'} className="rounded p-0.5 pl-1 text-[var(--muted-foreground)]/70 hover:text-[var(--foreground)]">
                          {collapsed ? <ChevronRightIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />}
                        </button>
                        {renamingG ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={commitGRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitGRename();
                              if (e.key === 'Escape') setRenamingLayer(null);
                            }}
                            className="flex-1 rounded-md border border-[var(--primary)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => selectGroup(gid)}
                            onDoubleClick={() => {
                              setRenameDraft(gname);
                              setRenamingLayer(gid);
                            }}
                            className={`flex flex-1 items-center gap-2 rounded-lg px-1 py-2 text-left ${allSel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                            title="Click to select group · double-click to rename"
                          >
                            <RectangleStackIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
                            <span className="flex-1 truncate text-xs font-semibold">{gname}</span>
                            <span className="text-[10px] text-[var(--muted-foreground)]">{leaves.length}</span>
                          </button>
                        )}
                        <button onClick={() => ungroupGroup(gid)} title="Ungroup" className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
                          <Squares2X2Icon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => toggleGroupLock(gid)}
                          title={allLocked ? 'Unlock group' : 'Lock group'}
                          className={`rounded p-1 transition-colors hover:text-[var(--foreground)] ${allLocked ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}
                        >
                          {allLocked ? <LockClosedIcon className="h-3.5 w-3.5" /> : <LockOpenIcon className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => toggleGroupHidden(gid)} title={allHidden ? 'Show group' : 'Hide group'} className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
                          {allHidden ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {!collapsed && <div className="mt-1 space-y-1 border-l border-[var(--border)] pl-1">{node.children.map((c) => renderNode(c))}</div>}
                    </div>
                  );
                };

                const renderNode = (node: LayerNode): React.ReactNode => (node.kind === 'element' ? renderRow(node.id) : renderGroup(node));

                return nodes.map((n) => renderNode(n));
              })()}
            </div>
          </section>
          )}

          {/* Industries — which accounts this template is offered to. Ad mode
              edits one ad, not a template, so this only shows in template mode. */}
          {leftPanel === 'industries' && !adId && (
            <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Industries</h2>
              <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
                Which accounts can use this template. None selected → only vehicle-offer accounts (Automotive, Powersports).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allIndustries.map((name) => {
                  const on = (doc.industries ?? []).includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleIndustry(name)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        on
                          ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Sizes — each has its own independent layout */}
          {leftPanel === 'sizes' && (
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <DashboardLayoutIcon className="h-3.5 w-3.5" />
                Sizes
              </h2>
              <div className="flex items-center gap-1.5">
                <Link
                  href="/ad-generator/sizes"
                  className="text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                >
                  Library
                </Link>
                <button
                  onClick={() => setAddSizeOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
                >
                  <PlusIcon className="h-3 w-3" />
                  Add
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {doc.sizes.map((s) => {
                const count = Object.keys(doc.layouts[s.id] ?? {}).length;
                const active = s.id === sizeId;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-1 rounded-lg pr-1 transition-colors ${active ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/60'}`}
                  >
                    <button onClick={() => setSizeId(s.id)} className="flex flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left">
                      <span className={`truncate text-xs font-medium ${active ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{s.label}</span>
                      <span className="flex-shrink-0 text-[10px] text-[var(--muted-foreground)]">
                        {s.width}×{s.height} · {count}
                      </span>
                    </button>
                    {doc.sizes.length > 1 && (
                      <button
                        onClick={() => removeSize(s.id)}
                        title="Remove size"
                        className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {addSizeOpen && (
              <div className="mt-2 space-y-2 rounded-lg border border-dashed border-[var(--border)] p-2">
                {/* Standard catalog, grouped by category */}
                {catalogByCategory().map((grp) => (
                  <div key={grp.category}>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{grp.label}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {grp.sizes.map((p) => (
                        <button
                          key={p.name}
                          onClick={() => addSize(p.name, p.width, p.height)}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-center text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                        >
                          {p.name}
                          <span className="block text-[9px] text-[var(--muted-foreground)]">
                            {p.width}×{p.height}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Custom sizes from the shared library (added on top of the catalog) */}
                {libSizes.length > 0 && (
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Custom</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {libSizes.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => addSize(s.name, s.width, s.height)}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-center text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                        >
                          {s.name}
                          <span className="block text-[9px] text-[var(--muted-foreground)]">
                            {s.width}×{s.height}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Create a brand-new size — saved to the library + added here */}
                <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="New size name (e.g. Wide Banner)"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      placeholder="W"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <span className="text-[var(--muted-foreground)]">×</span>
                    <input
                      type="number"
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createLibrarySize()}
                      placeholder="H"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <button
                      onClick={createLibrarySize}
                      title="Save to the size library and add it here"
                      className="flex-shrink-0 rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Create
                    </button>
                  </div>
                </div>
              </div>
            )}

            {doc.sizes.length > 1 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <label className="mb-1.5 block text-[11px] text-[var(--muted-foreground)]">
                  Copy layout into {size.label.split(' ')[0]} from
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {doc.sizes
                    .filter((s) => s.id !== sizeId)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => copyLayoutFrom(s.id)}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        {s.label.split(' ')[0]}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </section>
          )}
            </div>
          )}
        </aside>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="relative flex flex-shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-3 py-2">
            {/* Zoom — fit-relative; the % click resets to fit. */}
            <div className="mr-auto flex items-center gap-0.5">
              <button
                onClick={() => setZoom((z) => Math.max(0.2, +(z / 1.25).toFixed(3)))}
                title="Zoom out"
                aria-label="Zoom out"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <MagnifyingGlassMinusIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setZoom(1)}
                title="Fit to screen"
                aria-label="Fit to screen"
                className="min-w-[3.25rem] rounded-lg px-1.5 py-1 text-center text-xs font-medium tabular-nums text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(5, +(z * 1.25).toFixed(3)))}
                title="Zoom in"
                aria-label="Zoom in"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <MagnifyingGlassPlusIcon className="h-4 w-4" />
              </button>
            </div>
            {/* Current size name, centered */}
            <span className="pointer-events-none absolute left-1/2 max-w-[36%] -translate-x-1/2 truncate rounded-md bg-[var(--muted)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]">
              {size.label}
            </span>
            {/* View toggles — outlines + safe-area margins */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setShowOutlines((v) => !v)}
                title="Toggle element outlines"
                aria-label="Toggle element outlines"
                aria-pressed={showOutlines}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${showOutlines ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'}`}
              >
                <OutlinesIcon className="h-4 w-4" />
              </button>
              <div className="relative">
                <button
                  onClick={toggleMargins}
                  title="Safe-area margins"
                  aria-label="Safe-area margins"
                  aria-pressed={showSafe}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${showSafe ? 'bg-[#14b8a6]/15 text-[#14b8a6]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'}`}
                >
                  <MarginsIcon className="h-4 w-4" />
                </button>
                {showSafe && (
                  <div className="absolute right-0 top-9 z-50 flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-1.5 shadow-md backdrop-blur-2xl">
                    <input
                      type="number"
                      value={doc.safeArea?.value ?? 5}
                      onChange={(e) => setMargin({ value: Math.max(0, Number(e.target.value)) })}
                      title="Margin size"
                      className="w-12 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-center text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <select
                      value={doc.safeArea?.unit ?? 'percent'}
                      onChange={(e) => setMargin({ unit: e.target.value as MarginUnit })}
                      title="Unit"
                      className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    >
                      {MARGIN_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--border)]" />

            {/* Undo / Redo */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                aria-label="Undo"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowUturnLeftIcon className="h-4 w-4" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⌘⇧Z)"
                aria-label="Redo"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowUturnRightIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Reopen the background panel after it's been dismissed. */}
            {!selected && bgPanelHidden && (
              <button
                onClick={() => setBgPanelHidden(false)}
                title="Background"
                aria-label="Show background panel"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <SwatchIcon className="h-4 w-4" />
              </button>
            )}

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--border)]" />

            {/* Keyboard shortcuts */}
            <button
              onClick={() => setHelpOpen(true)}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <QuestionMarkCircleIcon className="h-4 w-4" />
            </button>
          </div>

          <div
            ref={canvasRef}
            className="relative flex flex-1 flex-col gap-4 overflow-auto bg-[var(--muted)]/30 p-3 [align-items:safe_center] [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1.5px)] [background-position:center] [background-size:18px_18px] [justify-content:safe_center] sm:p-6"
            style={{ userSelect: 'none' }}
            onPointerDown={(e) => {
              // Clicking the empty area around the artboard clears the selection.
              if (e.target === e.currentTarget) clearSelection();
            }}
          >
              <div ref={frameRef} className="relative rounded-md shadow-[0_12px_48px_-8px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/10" style={{ width: frameW, height: frameH }}>
                {/* The export renderer, scaled to fit. */}
                <div className="absolute inset-0 overflow-hidden rounded-md">
                  <iframe
                    ref={iframeRef}
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

                {/* Interaction overlay — drag empty backdrop to marquee-select. */}
                <div
                  className="absolute inset-0"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) startMarquee(e);
                  }}
                >
                  {/* Safe-area margin boundary (a builder-only guide) */}
                  {(() => {
                    const sa = showSafe ? safeAreaFractions(doc.safeArea, size.width, size.height) : null;
                    return sa ? (
                      <div
                        className="pointer-events-none absolute z-10 rounded-[2px] border-2 border-dashed border-[#14b8a6]/90"
                        style={{ left: sa.x * frameW, top: sa.y * frameH, width: (1 - 2 * sa.x) * frameW, height: (1 - 2 * sa.y) * frameH }}
                      />
                    ) : null;
                  })()}
                  {/* Alignment guides (Figma-style) while dragging */}
                  {dragBox && guides.x != null && (
                    <span className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 -translate-x-1/2 bg-[#ec4899]" style={{ left: guides.x * frameW }} />
                  )}
                  {dragBox && guides.y != null && (
                    <span className="pointer-events-none absolute left-0 right-0 z-30 h-0.5 -translate-y-1/2 bg-[#ec4899]" style={{ top: guides.y * frameH }} />
                  )}
                  {/* Marquee select rectangle */}
                  {marquee && (
                    <span
                      className="pointer-events-none absolute z-30 rounded-[2px] border border-[var(--primary)] bg-[var(--primary)]/10"
                      style={{ left: marquee.x * frameW, top: marquee.y * frameH, width: marquee.w * frameW, height: marquee.h * frameH }}
                    />
                  )}
                  {/* Background pan preview — the whole photo, with the off-canvas
                      bleed dimmed and the live frame outlined. */}
                  {bgPan && (
                    <>
                      <img
                        src={bgPan.url}
                        alt=""
                        draggable={false}
                        className="pointer-events-none absolute z-30 max-w-none select-none"
                        style={{ left: -bgPan.objectX * bgPan.overflowX, top: -bgPan.objectY * bgPan.overflowY, width: bgPan.coverW, height: bgPan.coverH }}
                      />
                      <div className="pointer-events-none absolute inset-0 z-30 ring-2 ring-[var(--primary)]" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
                    </>
                  )}
                  {placed.map(({ el, box }) => {
                    const isSel = selectedIds.includes(el.id);
                    const isSingleSel = el.id === selectedId;
                    const singleDragging = dragBox != null && dragRef.current?.kind === 'single' && dragRef.current.elId === el.id;
                    const live = groupLive?.[el.id];
                    const b = singleDragging && dragBox ? dragBox : live ?? box;
                    const boxStyle: CSSProperties = {
                      left: b.x * frameW,
                      top: b.y * frameH,
                      width: b.w * frameW,
                      height: b.h * frameH,
                      // The selected element's overlay (its ring + handles) jumps
                      // above other element overlays so a more-forward element can't
                      // intercept clicks on its chrome. NOT for a full-bleed layer
                      // (a background): its overlay covers the whole canvas, so
                      // raising it would block selecting anything else. Overlays are
                      // transparent, so this never changes the ad's own stacking.
                      zIndex: isSel && !isFullBleed(el.id) ? 50 : (b.z ?? 0) + 1,
                      cursor: el.locked ? 'default' : box.hidden ? 'pointer' : 'move',
                      touchAction: 'none',
                    };
                    return (
                      <div
                        key={el.id}
                        onPointerDown={(e) => onBoxPointerDown(e, el.id)}
                        onContextMenu={(e) => openCanvasMenu(e, el.id)}
                        onDoubleClick={(e) => {
                          // Editable text: double-click to edit its value inline.
                          if (textEditTarget(el)) {
                            e.stopPropagation();
                            startTextEdit(el.id);
                            return;
                          }
                          // Otherwise drill into a group: select just this member.
                          if (el.groupId && !lockedIds.has(el.id)) {
                            e.stopPropagation();
                            selectOne(el.id);
                          }
                        }}
                        title={box.hidden ? `${elName(el)} (hidden here)` : elName(el)}
                        className="group absolute"
                        style={boxStyle}
                      >
                        <span
                          className={`pointer-events-none absolute inset-0 rounded-[2px] ring-inset transition-colors ${
                            isSel
                              ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/10'
                              : box.hidden
                                ? 'ring-1 ring-dashed ring-[var(--muted-foreground)]/45 group-hover:ring-[var(--muted-foreground)]/70'
                                : showOutlines
                                  ? 'ring-[1.5px] ring-dashed ring-[var(--primary)]/55 group-hover:ring-[var(--primary)]/90'
                                  : 'group-hover:ring-[1.5px] group-hover:ring-[var(--primary)]/70'
                          }`}
                        />
                        {isSingleSel && (
                          <>
                            <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {elName(el)}
                            </span>
                            {RESIZE_HANDLES.map((rh) => (
                              <span
                                key={rh.h}
                                onPointerDown={(e) => startSingleDrag(e, el.id, rh.h)}
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

                  {/* Inline text editor — double-click a text element to edit it. */}
                  {editingText &&
                    layout[editingText.id] &&
                    (() => {
                      const el = doc.elements.find((e) => e.id === editingText.id);
                      if (!el) return null;
                      const eb = layout[editingText.id];
                      const color =
                        el.color === 'brand'
                          ? typeof previewData.brandColor === 'string'
                            ? previewData.brandColor
                            : '#111827'
                          : el.color || '#111827';
                      return (
                        <textarea
                          autoFocus
                          value={editingText.value}
                          onChange={(e) => setEditingText({ id: editingText.id, value: e.target.value })}
                          onBlur={commitTextEdit}
                          onPointerDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              commitTextEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingText(null);
                            }
                          }}
                          className="absolute z-[60] resize-none overflow-hidden rounded-[2px] bg-[var(--card)] p-0.5 shadow-[0_0_0_2px_var(--primary)] outline-none"
                          style={{
                            left: eb.x * frameW,
                            top: eb.y * frameH,
                            width: eb.w * frameW,
                            height: eb.h * frameH,
                            color,
                            fontSize: (eb.fontSize ?? 16) * scale,
                            fontWeight: el.fontWeight,
                            lineHeight: el.lineHeight ?? 1.1,
                            letterSpacing: el.letterSpacing ? el.letterSpacing * scale : undefined,
                            textTransform: el.uppercase ? 'uppercase' : undefined,
                            textAlign: el.align ?? 'left',
                          }}
                        />
                      );
                    })()}

                  {/* Group bounding box + resize handles (scale the whole selection) */}
                  {groupBox && (
                    <div
                      className="pointer-events-none absolute z-20"
                      style={{
                        left: groupBox.left * frameW,
                        top: groupBox.top * frameH,
                        width: (groupBox.right - groupBox.left) * frameW,
                        height: (groupBox.bottom - groupBox.top) * frameH,
                      }}
                    >
                      <span className="absolute inset-0 rounded-[2px] ring-1 ring-dashed ring-[var(--primary)]/60" />
                      {RESIZE_HANDLES.map((rh) => (
                        <span
                          key={rh.h}
                          onPointerDown={(e) => startGroupResize(e, rh.h)}
                          className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[2px] border border-[var(--primary)] bg-[var(--card)]"
                          style={{
                            left: `${rh.x * 100}%`,
                            top: `${rh.y * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            cursor: rh.cursor,
                            touchAction: 'none',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Empty-canvas onboarding — guides a brand-new template's first
                  element. Reactive on placed.length, so it clears the moment an
                  element is added and returns if all are removed. The wrapper is
                  click-through (pointer-events-none) so canvas pan/marquee still
                  work around the card; only the card itself is interactive. */}
              {placed.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4">
                  <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-6 text-center shadow-xl backdrop-blur-2xl">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
                      <Squares2X2Icon className="h-6 w-6 text-[var(--primary)]" />
                    </div>
                    <h3 className="text-sm font-bold text-[var(--foreground)]">Design your ad</h3>
                    <p className="mx-auto mt-1 mb-4 max-w-xs text-xs text-[var(--muted-foreground)]">
                      Add your first element to get started — drop in text, an image, a button, or a shape.
                    </p>
                    <AdderGrid adders={adders} variant="onboarding" />
                    <p className="mt-4 text-[11px] text-[var(--muted-foreground)]">
                      Need a different size? Open the <span className="font-medium text-[var(--foreground)]">Sizes</span> panel on the left.
                    </p>
                  </div>
                </div>
              )}


              {/* Size navigation — arrow-paginated, scales to any number of sizes */}
              {doc.sizes.length > 0 &&
                (() => {
                  const idx = Math.max(0, doc.sizes.findIndex((s) => s.id === sizeId));
                  const go = (delta: number) => setSizeId(doc.sizes[(idx + delta + doc.sizes.length) % doc.sizes.length].id);
                  return (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button
                        onClick={() => go(-1)}
                        disabled={doc.sizes.length < 2}
                        title="Previous size"
                        aria-label="Previous size"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                      </button>
                      {doc.sizes.length > 1 ? (
                        <button
                          onClick={() => setOverviewOpen(true)}
                          title="View all sizes"
                          aria-label="View all sizes"
                          className="inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                        >
                          <Squares2X2Icon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          {doc.sizes[idx]?.label.split(' ')[0]} <span className="tabular-nums text-[var(--muted-foreground)]">{idx + 1}/{doc.sizes.length}</span>
                        </button>
                      ) : (
                        <span className="min-w-[6.5rem] text-center text-xs font-medium text-[var(--foreground)]">
                          {doc.sizes[idx]?.label.split(' ')[0]} <span className="tabular-nums text-[var(--muted-foreground)]">{idx + 1}/{doc.sizes.length}</span>
                        </span>
                      )}
                      <button
                        onClick={() => go(1)}
                        disabled={doc.sizes.length < 2}
                        title="Next size"
                        aria-label="Next size"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronRightIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })()}

              {selected && selectedBox && !selectedBox.hidden && (
                <SelectionPanel
                  el={selected}
                  box={selectedBox}
                  sizeW={size.width}
                  sizeH={size.height}
                  fontOptions={fontOptions}
                  content={selectionContent}
                  onContentChange={setSelectedContent}
                  accountKey={accountKey ?? undefined}
                  onEl={updEl}
                  onBox={(patch) => setBox(size.id, selected.id, { ...selectedBox, ...patch })}
                  onClose={clearSelection}
                  shifted={fieldsOpen}
                  topPx={canvasTop}
                />
              )}

              {!selected && !bgPanelHidden && (
                <BackgroundPanel
                  background={doc.background}
                  onChange={setBackground}
                  onClose={() => setBgPanelHidden(true)}
                  hasBgImage={!!bgImageId}
                  onAddImage={addBackgroundImage}
                  onEditImage={() => bgImageId && selectOne(bgImageId)}
                  onRemoveImage={() => bgImageId && deleteElement(bgImageId)}
                  shifted={fieldsOpen}
                  topPx={canvasTop}
                />
              )}
            </div>
        </div>
      </div>

      {fieldsOpen && (
        <FieldsSidebar
          fields={doc.fields}
          defaults={doc.defaults}
          onClose={() => setFieldsOpen(false)}
          onAdd={addField}
          onUpdate={updateFieldAt}
          onRename={renameFieldKeyAt}
          onDelete={deleteFieldAt}
          onSetDefault={setDefaultAt}
        />
      )}

      {loadOpen && (
        <LoadModal
          loading={loadingList}
          templates={savedList}
          currentId={templateId}
          onClose={() => setLoadOpen(false)}
          onLoad={loadTemplate}
          onDelete={deleteSaved}
        />
      )}

      {overviewOpen && (
        <SizesOverviewModal
          doc={doc}
          previewData={previewData}
          currentSizeId={sizeId}
          onClose={() => setOverviewOpen(false)}
          onPick={(id) => {
            setSizeId(id);
            setOverviewOpen(false);
          }}
        />
      )}

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}

      {/* Right-click context menu (canvas + layers) */}
      {ctxMenu && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[200] min-w-[11rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-strong)] py-1 text-[13px] shadow-2xl backdrop-blur-2xl"
            style={{ left: Math.min(ctxMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 230), top: ctxMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const run = (fn: () => void) => () => {
                fn();
                setCtxMenu(null);
              };
              const multi = selectedIds.length > 1;
              const single = selected;
              const Item = ({ onClick, danger, kbd, children }: { onClick: () => void; danger?: boolean; kbd?: string; children: React.ReactNode }) => (
                <button
                  onClick={run(onClick)}
                  className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left transition-colors hover:bg-[var(--muted)] ${danger ? 'text-red-500' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                >
                  <span>{children}</span>
                  {kbd && <span className="text-[10px] text-[var(--muted-foreground)]">{kbd}</span>}
                </button>
              );
              const Sep = () => <div className="my-1 h-px bg-[var(--border)]" />;
              return (
                <>
                  {multi && (
                    <>
                      <Item onClick={selectionIsGroup ? ungroupSelected : groupSelected} kbd={selectionIsGroup ? '⌘⇧G' : '⌘G'}>
                        {selectionIsGroup ? 'Ungroup' : 'Group'}
                      </Item>
                      <Sep />
                      <div className="flex items-center gap-0.5 px-2 py-1">
                        {(['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom'] as const).map((edge) => (
                          <button key={edge} onClick={run(() => alignSelected(edge))} title={`Align ${edge}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]">
                            <AlignIcon edge={edge} />
                          </button>
                        ))}
                        {selectedIds.length >= 3 && (
                          <>
                            <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
                            <button onClick={run(() => distributeSelected('h'))} title="Distribute horizontally" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]">
                              <AlignIcon edge="dist-h" />
                            </button>
                            <button onClick={run(() => distributeSelected('v'))} title="Distribute vertically" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]">
                              <AlignIcon edge="dist-v" />
                            </button>
                          </>
                        )}
                      </div>
                      <Sep />
                    </>
                  )}
                  {single && (
                    <>
                      <Item onClick={bringForward}>Bring forward</Item>
                      <Item onClick={sendBack}>Send back</Item>
                      <Item onClick={() => duplicateElement(single.id)}>Duplicate</Item>
                      <Item onClick={() => toggleLock(single.id)}>{single.locked ? 'Unlock' : 'Lock'}</Item>
                      <Item onClick={() => toggleHidden(single.id)}>{selectedBox?.hidden ? 'Show in this size' : 'Hide in this size'}</Item>
                      <Item
                        onClick={() => {
                          setRenameDraft(elName(single));
                          setRenamingLayer(single.id);
                        }}
                      >
                        Rename
                      </Item>
                      <Sep />
                    </>
                  )}
                  <Item onClick={deleteSelected} danger kbd="⌫">
                    Delete{multi ? ` (${selectedIds.length})` : ''}
                  </Item>
                </>
              );
            })()}
          </div>,
          document.body,
        )}
    </div>
  );
}

function SelectRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors ${
        on ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
      }`}
    >
      <span>{label}</span>
      <span className={`h-3.5 w-3.5 rounded-sm border ${on ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)]'}`} />
    </button>
  );
}


function LabeledInput({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[var(--muted-foreground)]">{label}</span>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
      />
    </label>
  );
}

function SelectOptionsEditor({
  options,
  onChange,
}: {
  options: { value: string; label: string }[];
  onChange: (o: { value: string; label: string }[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[var(--muted-foreground)]">Options</label>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={o.value}
            placeholder="value"
            onChange={(e) => onChange(options.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}
            className="w-1/2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <input
            value={o.label}
            placeholder="label"
            onChange={(e) => onChange(options.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
            className="w-1/2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <button
            onClick={() => onChange(options.filter((_, xi) => xi !== i))}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-red-500"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...options, { value: '', label: '' }])} className="text-[11px] font-medium text-[var(--primary)] hover:underline">
        + Add option
      </button>
    </div>
  );
}

function FieldRow({
  field,
  index,
  expanded,
  defaultValue,
  onToggle,
  onUpdate,
  onRename,
  onDelete,
  onSetDefault,
}: {
  field: FieldSpec;
  index: number;
  expanded: boolean;
  defaultValue: string;
  onToggle: () => void;
  onUpdate: (i: number, patch: Partial<FieldSpec>) => void;
  onRename: (i: number, newKey: string) => void;
  onDelete: (i: number) => void;
  onSetDefault: (i: number, val: string) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
          <span className="truncate text-xs font-medium text-[var(--foreground)]">{field.label || field.key}</span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{field.type}</span>
          {field.copy && <span className="rounded bg-[var(--primary)]/10 px-1 text-[9px] font-medium text-[var(--primary)]">AI</span>}
        </button>
        <button
          onClick={() => onDelete(index)}
          title="Delete field"
          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-[var(--border)] px-3 py-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <LabeledInput label="Label" value={field.label} onChange={(v) => onUpdate(index, { label: v })} />
            <LabeledInput label="Key" value={field.key} onChange={(v) => onRename(index, v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectRow label="Type">
              <FontSelect value={field.type} onChange={(v) => onUpdate(index, { type: v as FieldType })} options={FIELD_TYPE_OPTIONS} previewFont={false} />
            </SelectRow>
            <LabeledInput label="Group" value={field.group ?? ''} onChange={(v) => onUpdate(index, { group: v || undefined })} />
          </div>
          <LabeledInput label="Default / preview value" value={defaultValue} onChange={(v) => onSetDefault(index, v)} />
          <LabeledInput label="Placeholder" value={field.placeholder ?? ''} onChange={(v) => onUpdate(index, { placeholder: v || undefined })} />
          <LabeledInput label="Help" value={field.help ?? ''} onChange={(v) => onUpdate(index, { help: v || undefined })} />
          <div className="grid grid-cols-2 items-end gap-2">
            <LabeledInput
              label="Max length"
              type="number"
              value={field.maxLength != null ? String(field.maxLength) : ''}
              onChange={(v) => onUpdate(index, { maxLength: v ? Number(v) : undefined })}
            />
            <ToggleRow label="AI may write" on={!!field.copy} onClick={() => onUpdate(index, { copy: field.copy ? undefined : true })} />
          </div>
          {field.type === 'select' && <SelectOptionsEditor options={field.options ?? []} onChange={(opts) => onUpdate(index, { options: opts })} />}
        </div>
      )}
    </div>
  );
}

/**
 * Manage the template's fields — the form users fill, and what AI copy and
 * element bindings read. Renaming a key cascades to bindings; deleting a field
 * detaches any element bound to it.
 */
function FieldsSidebar({
  fields,
  defaults,
  onClose,
  onAdd,
  onUpdate,
  onRename,
  onDelete,
  onSetDefault,
}: {
  fields: FieldSpec[];
  defaults: Record<string, string>;
  onClose: () => void;
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<FieldSpec>) => void;
  onRename: (i: number, newKey: string) => void;
  onDelete: (i: number) => void;
  onSetDefault: (i: number, val: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(fields.length ? 0 : null);
  return (
    // Floating right-docked sidebar (no modal / backdrop) — the form that drives
    // the ad stays open beside the canvas while you design.
    <div className="fixed right-4 top-20 bottom-4 z-40 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-sm font-bold text-[var(--foreground)]">Template fields</h2>
          <p className="text-xs text-[var(--muted-foreground)]">The form users fill — and what AI copy + element bindings read.</p>
        </div>
        <button onClick={onClose} title="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {fields.map((f, i) => (
          <FieldRow
            key={i}
            field={f}
            index={i}
            expanded={expanded === i}
            defaultValue={defaults[f.key] ?? ''}
            onToggle={() => setExpanded(expanded === i ? null : i)}
            onUpdate={onUpdate}
            onRename={onRename}
            onDelete={onDelete}
            onSetDefault={onSetDefault}
          />
        ))}
        {!fields.length && (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No fields yet.</p>
        )}
      </div>
      <button
        onClick={onAdd}
        className="m-4 mt-0 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add field
      </button>
    </div>
  );
}

/**
 * Floating properties panel for the selected element — sits to the right of the
 * canvas. The top "Content" section edits the element's value directly (type
 * text, pick/upload an image) and writes straight to the form data; derived and
 * brand-driven content is shown read-only. Below it: font/text styling, image
 * fit, shape fill. Structural actions (reorder, duplicate, delete) live in the
 * right-click menu.
 */
function SelectionPanel({
  el,
  box,
  sizeW,
  sizeH,
  fontOptions,
  content,
  onContentChange,
  accountKey,
  onEl,
  onBox,
  onClose,
  shifted,
  topPx,
}: {
  el: DocElement;
  box: DocLayoutBox;
  sizeW: number;
  sizeH: number;
  fontOptions: FontSelectOption[];
  content: { mode: 'none' | 'text-edit' | 'text-readonly' | 'image-edit' | 'image-readonly'; value: string; note?: string } | null;
  onContentChange: (value: string) => void;
  accountKey?: string;
  onEl: (patch: Partial<DocElement>) => void;
  onBox: (patch: Partial<DocLayoutBox>) => void;
  onClose: () => void;
  shifted: boolean;
  topPx: number;
}) {
  const fontSize = box.fontSize ?? 16;
  const typeLabel = el.type === 'text' ? 'Text' : el.type === 'image' ? 'Image' : el.type === 'logo' ? 'Logo' : 'Shape';
  const [picking, setPicking] = useState(false);

  return (
    <div
      style={{ top: topPx, maxHeight: `calc(100vh - ${topPx + 16}px)` }}
      className={`fixed z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl ${shifted ? 'right-[372px]' : 'right-6'}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <input
            value={el.name ?? ''}
            onChange={(e) => onEl({ name: e.target.value || undefined })}
            placeholder={typeLabel}
            aria-label="Layer name"
            title="Rename this layer"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
          />
          <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">{typeLabel}</span>
        </div>
        <button type="button" onClick={onClose} title="Deselect" aria-label="Deselect" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border)] px-3 py-0.5">
        {/* Content — edit the element's value directly; writes to the form data */}
        {content && content.mode !== 'none' && (
          <PanelSection title="Content">
            {content.mode === 'text-edit' && (
              <textarea
                value={content.value}
                onChange={(e) => onContentChange(e.target.value)}
                rows={2}
                placeholder="Text"
                className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            )}
            {content.mode === 'text-readonly' && (
              <>
                <div className="truncate rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1.5 text-xs text-[var(--foreground)]">{content.value || '—'}</div>
                {content.note && <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted-foreground)]">{content.note}</p>}
              </>
            )}
            {(content.mode === 'image-edit' || content.mode === 'image-readonly') && (
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--muted)]/40">
                  {content.value ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={content.value} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <PhotoIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
                  )}
                </div>
                {content.mode === 'image-edit' ? (
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    Choose / upload
                  </button>
                ) : (
                  <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">{content.note}</p>
                )}
              </div>
            )}
          </PanelSection>
        )}

        {/* Precise position + size (px at the current size). Boxes are stored as
            fractions of the canvas, so we convert px ↔ fraction here. */}
        <PanelSection title="Position & size">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              X
              <MiniNum title="X position (px)" value={Math.round(box.x * sizeW)} onChange={(v) => onBox({ x: v / sizeW })} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              Y
              <MiniNum title="Y position (px)" value={Math.round(box.y * sizeH)} onChange={(v) => onBox({ y: v / sizeH })} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              W
              <MiniNum title="Width (px)" value={Math.round(box.w * sizeW)} onChange={(v) => onBox({ w: Math.max(1, v) / sizeW })} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              H
              <MiniNum title="Height (px)" value={Math.round(box.h * sizeH)} onChange={(v) => onBox({ h: Math.max(1, v) / sizeH })} />
            </label>
          </div>
        </PanelSection>

        {el.type === 'text' && (
          <>
            <PanelSection title="Font">
              <FontSelect value={el.fontFamily ?? ''} onChange={(v) => onEl({ fontFamily: v || undefined })} options={fontOptions} />
              <div className="mt-2 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <BarBtn title="Smaller" onClick={() => onBox({ fontSize: Math.max(4, fontSize - 2) })}>
                    <MinusIcon className="h-4 w-4" />
                  </BarBtn>
                  <input
                    type="number"
                    aria-label="Font size"
                    value={fontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isNaN(n)) onBox({ fontSize: clamp(Math.round(n), 4, 400) });
                    }}
                    className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1.5 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                  <BarBtn title="Larger" onClick={() => onBox({ fontSize: Math.min(400, fontSize + 2) })}>
                    <PlusIcon className="h-4 w-4" />
                  </BarBtn>
                </div>
                <div className="w-28 shrink-0">
                  <FontSelect value={String(el.fontWeight ?? 400)} onChange={(v) => onEl({ fontWeight: Number(v) })} options={WEIGHT_OPTIONS} previewFont={false} />
                </div>
              </div>
            </PanelSection>

            <PanelSection title="Alignment">
              <div className="flex items-center gap-1">
                <BarBtn title="Align left" active={(el.align ?? 'left') === 'left'} onClick={() => onEl({ align: 'left' })}>
                  <Bars3BottomLeftIcon className="h-4 w-4" />
                </BarBtn>
                <BarBtn title="Align center" active={el.align === 'center'} onClick={() => onEl({ align: 'center' })}>
                  <Bars3Icon className="h-4 w-4" />
                </BarBtn>
                <BarBtn title="Align right" active={el.align === 'right'} onClick={() => onEl({ align: 'right' })}>
                  <Bars3BottomRightIcon className="h-4 w-4" />
                </BarBtn>
                <span className="mx-1 h-6 w-px bg-[var(--border)]" />
                <BarBtn title="Uppercase" active={!!el.uppercase} onClick={() => onEl({ uppercase: !el.uppercase })}>
                  <span className="text-[11px] font-bold leading-none">Aa</span>
                </BarBtn>
              </div>
            </PanelSection>

            <PanelSection title="Color & spacing">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  Color
                  <ColorSwatchInput title="Text color" value={el.color && el.color !== 'brand' ? el.color : '#4f46e5'} onChange={(v) => onEl({ color: v })} />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  Letter
                  <MiniNum title="Letter spacing (px)" value={el.letterSpacing ?? 0} onChange={(v) => onEl({ letterSpacing: v ? Math.round(v) : undefined })} />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  Line
                  <MiniNum title="Line height" step={0.05} value={el.lineHeight ?? 1.1} onChange={(v) => onEl({ lineHeight: v || undefined })} />
                </label>
              </div>
            </PanelSection>

            <PanelSection title="Pill background">
              {el.bg ? (
                <div className="flex items-center gap-2">
                  <ColorSwatchInput title="Pill background" value={el.bg !== 'brand' ? el.bg : '#4f46e5'} onChange={(v) => onEl({ bg: v })} />
                  <span className="text-xs text-[var(--muted-foreground)]">On</span>
                  <BarBtn title="Remove pill background" onClick={() => onEl({ bg: undefined })}>
                    <XMarkIcon className="h-4 w-4" />
                  </BarBtn>
                </div>
              ) : (
                <BarBtn title="Add pill background" onClick={() => onEl({ bg: 'brand', radius: el.radius ?? 999, padding: el.padding ?? 14 })}>
                  <span className="text-[10px] font-semibold leading-none">Pill</span>
                </BarBtn>
              )}
            </PanelSection>
          </>
        )}

        {el.type === 'shape' && (
          <PanelSection title="Shape">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Fill
                <ColorSwatchInput title="Fill" value={el.fill && el.fill !== 'brand' ? el.fill : '#4f46e5'} onChange={(v) => onEl({ fill: v })} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                Radius
                <MiniNum title="Corner radius (px)" value={el.radius ?? 0} onChange={(v) => onEl({ radius: v ? Math.round(v) : undefined })} />
              </label>
            </div>
          </PanelSection>
        )}

        {(el.type === 'image' || el.type === 'logo') && (
          <PanelSection title="Image">
            <div className="flex items-center gap-1">
              <BarBtn title="Fit (contain)" active={(el.fit ?? 'contain') === 'contain'} onClick={() => onEl({ fit: 'contain' })}>
                <ArrowsPointingInIcon className="h-4 w-4" />
              </BarBtn>
              <BarBtn title="Fill (cover)" active={el.fit === 'cover'} onClick={() => onEl({ fit: 'cover' })}>
                <ArrowsPointingOutIcon className="h-4 w-4" />
              </BarBtn>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                Radius
                <MiniNum title="Corner radius (px)" value={el.radius ?? 0} onChange={(v) => onEl({ radius: v > 0 ? Math.round(v) : undefined })} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                Opacity
                <MiniNum
                  title="Opacity (%)"
                  value={el.opacity ?? 100}
                  step={5}
                  onChange={(v) => {
                    const n = Math.max(0, Math.min(100, Math.round(v)));
                    onEl({ opacity: n >= 100 ? undefined : n });
                  }}
                />
              </label>
            </div>
            {el.type === 'image' && el.fit === 'cover' && (
              <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">Drag the image on the canvas to reposition it — the off-canvas bleed shows while you drag (saved per size).</p>
            )}
          </PanelSection>
        )}
      </div>

      {picking && (
        <MediaPickerModal
          accountKey={accountKey}
          onSelect={(url) => {
            onContentChange(url);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** A labeled group of controls in the selection panel. */
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</div>
      {children}
    </div>
  );
}

/** An icon button in the left rail — opens its panel as a flyout. */
function RailButton({ label, Icon, active, onClick }: { label: string; Icon: React.ComponentType<{ className?: string }>; active: boolean; onClick: () => void }) {
  return (
    <SidebarTooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
          active ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
        }`}
      >
        <Icon className="h-5 w-5" />
      </button>
    </SidebarTooltip>
  );
}

type Adder = { label: string; Icon: React.ComponentType<{ className?: string }>; onAdd: () => void };

/** The element palette — a grid of tiles that drop an element on the canvas.
 *  Shared by the Insert flyout (`panel`) and the empty-canvas onboarding
 *  (`onboarding`); `variant` only tunes density. */
function AdderGrid({ adders, variant }: { adders: Adder[]; variant: 'panel' | 'onboarding' }) {
  const cols = variant === 'panel' ? 'grid-cols-2' : 'grid-cols-4';
  const tile = variant === 'panel' ? 'justify-center gap-2 py-5 text-xs' : 'gap-1.5 py-3 text-[11px]';
  const icon = variant === 'panel' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <div className={`grid ${cols} gap-2`}>
      {adders.map((a) => (
        <button
          key={a.label}
          onClick={a.onAdd}
          className={`flex flex-col items-center rounded-xl border border-[var(--border)] px-2 font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)] ${tile}`}
        >
          <a.Icon className={`${icon} text-[var(--muted-foreground)]`} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Tiny pictographic icons for the align / distribute actions. */
function AlignIcon({ edge }: { edge: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom' | 'dist-h' | 'dist-v' }) {
  const s = 'h-4 w-4';
  const bar = 'currentColor';
  const rect = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx="0.6" fill={bar} opacity="0.7" />;
  const guide = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={bar} strokeWidth="1.1" strokeLinecap="round" />;
  return (
    <svg viewBox="0 0 16 16" className={s} aria-hidden="true">
      {edge === 'left' && (<>{guide(2.5, 2, 2.5, 14)}{rect(4, 4, 8, 2.4)}{rect(4, 9.2, 5, 2.4)}</>)}
      {edge === 'right' && (<>{guide(13.5, 2, 13.5, 14)}{rect(4, 4, 8, 2.4)}{rect(7, 9.2, 5, 2.4)}</>)}
      {edge === 'hcenter' && (<>{guide(8, 2, 8, 14)}{rect(3.5, 4, 9, 2.4)}{rect(5, 9.2, 6, 2.4)}</>)}
      {edge === 'top' && (<>{guide(2, 2.5, 14, 2.5)}{rect(4, 4, 2.4, 8)}{rect(9.2, 4, 2.4, 5)}</>)}
      {edge === 'bottom' && (<>{guide(2, 13.5, 14, 13.5)}{rect(4, 4, 2.4, 8)}{rect(9.2, 7, 2.4, 5)}</>)}
      {edge === 'vmiddle' && (<>{guide(2, 8, 14, 8)}{rect(4, 3.5, 2.4, 9)}{rect(9.2, 5, 2.4, 6)}</>)}
      {edge === 'dist-h' && (<>{rect(1.5, 4, 2.4, 8)}{rect(6.8, 4, 2.4, 8)}{rect(12.1, 4, 2.4, 8)}</>)}
      {edge === 'dist-v' && (<>{rect(4, 1.5, 8, 2.4)}{rect(4, 6.8, 8, 2.4)}{rect(4, 12.1, 8, 2.4)}</>)}
    </svg>
  );
}

/** Compact number input for the selection toolbar (title is the tooltip). */
function MiniNum({ title, value, onChange, step }: { title: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      title={title}
      aria-label={title}
      value={value}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-12 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1.5 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
    />
  );
}

function BarBtn({
  title,
  onClick,
  active,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        danger
          ? 'text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-500'
          : active
            ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
            : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      {children}
    </button>
  );
}

function ColorSwatchInput({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  return (
    <label title={title} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-[var(--muted)]">
      <span className="h-4 w-4 rounded-full border border-[var(--border)]" style={{ background: value }} />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
  );
}

/**
 * "Wide view" — every size in the doc rendered side-by-side through the same
 * `renderDoc` the canvas/export use, so the overview is WYSIWYG. Click a size to
 * jump back to editing it. Only shown for multi-size docs.
 */
function SizesOverviewModal({
  doc,
  previewData,
  currentSizeId,
  onClose,
  onPick,
}: {
  doc: TemplateDoc;
  previewData: AdData;
  currentSizeId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const MAX_W = 240;
  const MAX_H = 200;
  // Render each size's HTML once per (doc, previewData) rather than on every
  // parent render — each result feeds an <iframe srcDoc>, so recomputing would
  // reload every iframe on each tick.
  const previews = useMemo(
    () => doc.sizes.map((s) => ({ s, html: renderDoc(doc, previewData, s, { preview: true }) })),
    [doc, previewData],
  );
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">All sizes</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Every size at a glance — click one to edit it.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {previews.map(({ s, html }) => {
            const sc = Math.min(MAX_W / s.width, MAX_H / s.height);
            const active = s.id === currentSizeId;
            return (
              <button
                key={s.id}
                onClick={() => onPick(s.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${active ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/40' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
              >
                <div className="flex items-center justify-center" style={{ height: MAX_H }}>
                  <div className="overflow-hidden rounded shadow-md ring-1 ring-black/10" style={{ width: s.width * sc, height: s.height * sc }}>
                    <iframe
                      title={s.label}
                      srcDoc={html}
                      style={{ width: s.width, height: s.height, border: 0, transform: `scale(${sc})`, transformOrigin: 'top left', pointerEvents: 'none' }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                    {s.label.split(' ')[0]}
                    {active && (
                      <span className="rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--primary)]">Editing</span>
                    )}
                  </div>
                  <div className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{s.width}×{s.height}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Background panel — shown in the inspector slot when nothing is selected, so
 * the artboard's fill (solid or gradient) and the brand accent bar are editable
 * without selecting an element. Mirrors the SelectionPanel's docked styling.
 */
function BackgroundPanel({
  background,
  onChange,
  onClose,
  hasBgImage,
  onAddImage,
  onEditImage,
  onRemoveImage,
  shifted,
  topPx,
}: {
  background?: DocBackground;
  onChange: (patch: Partial<DocBackground>) => void;
  onClose: () => void;
  hasBgImage: boolean;
  onAddImage: () => void;
  onEditImage: () => void;
  onRemoveImage: () => void;
  shifted: boolean;
  topPx: number;
}) {
  const bg = background ?? {};
  const grad = bg.gradient;
  return (
    <div
      style={{ top: topPx, maxHeight: `calc(100vh - ${topPx + 16}px)` }}
      className={`fixed z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl ${shifted ? 'right-[372px]' : 'right-6'}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-[var(--foreground)]">Background</span>
          <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">Canvas</span>
        </div>
        <button onClick={onClose} title="Hide background panel" aria-label="Hide background panel" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col divide-y divide-[var(--border)] px-3 py-0.5">
        <PanelSection title="Fill">
          {grad ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  From
                  <ColorSwatchInput title="Gradient start" value={grad[0]} onChange={(v) => onChange({ gradient: [v, grad[1]] })} />
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  To
                  <ColorSwatchInput title="Gradient end" value={grad[1]} onChange={(v) => onChange({ gradient: [grad[0], v] })} />
                </label>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs text-[var(--muted-foreground)]">Angle</span>
                  <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{bg.gradientAngle ?? 135}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={bg.gradientAngle ?? 135}
                  onChange={(e) => onChange({ gradientAngle: Number(e.target.value) })}
                  aria-label="Gradient angle"
                  className="range-slider"
                />
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              Color
              <ColorSwatchInput title="Background color" value={bg.color && bg.color !== 'brand' ? bg.color : '#ffffff'} onChange={(v) => onChange({ color: v })} />
            </label>
          )}
          <button
            onClick={() =>
              grad
                ? onChange({ gradient: undefined })
                : onChange({ gradient: [bg.color && bg.color !== 'brand' ? bg.color : '#ffffff', '#1e293b'] })
            }
            className="mt-2 text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
          >
            {grad ? 'Use a solid color' : 'Use a gradient'}
          </button>
        </PanelSection>
        <PanelSection title="Image">
          {hasBgImage ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onEditImage}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <PhotoIcon className="h-4 w-4" />
                Replace
              </button>
              <button
                onClick={onRemoveImage}
                title="Remove background image"
                aria-label="Remove background image"
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onAddImage}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <PhotoIcon className="h-4 w-4" />
              Add background image
            </button>
          )}
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">
            A full-bleed photo behind everything. Pick/upload it in the panel that opens, then drag to reposition.
          </p>
        </PanelSection>
        <PanelSection title="Accent">
          <ToggleRow label="Brand accent bar" on={!!bg.accentBar} onClick={() => onChange({ accentBar: !bg.accentBar })} />
        </PanelSection>
      </div>
    </div>
  );
}

/** Keyboard-shortcuts cheatsheet — surfaces the shortcuts the builder already
 *  supports so they're discoverable. */
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Edit',
      rows: [
        [`${mod} Z`, 'Undo'],
        [`${mod} ⇧ Z`, 'Redo'],
        ['Delete', 'Remove selected'],
        [`${mod} G`, 'Group selection'],
        [`${mod} ⇧ G`, 'Ungroup'],
      ],
    },
    {
      title: 'Move',
      rows: [
        ['↑ ↓ ← →', 'Nudge 1px'],
        ['⇧ + arrows', 'Nudge 10px'],
        ['Drag', 'Move element'],
        ['Drag handles', 'Resize'],
      ],
    },
    {
      title: 'Select',
      rows: [
        ['Click', 'Select element'],
        ['⇧ Click', 'Add to selection'],
        ['Drag empty', 'Marquee select'],
        ['Double-click', 'Edit text'],
      ],
    },
  ];
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">Keyboard shortcuts</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Speed up editing on the canvas.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{g.title}</div>
              <div className="space-y-1.5">
                {g.rows.map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--muted-foreground)]">{label}</span>
                    <kbd className="flex-shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--foreground)]">{keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The Template Library — open or delete a saved TemplateDoc. */
function LoadModal({
  loading,
  templates,
  currentId,
  onClose,
  onLoad,
  onDelete,
}: {
  loading: boolean;
  templates: SavedTemplate[];
  currentId: string | null;
  onClose: () => void;
  onLoad: (t: SavedTemplate) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">Template Library</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Open a saved template to keep editing. Published ones appear in the Ad Generator.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">
            No saved templates yet. Save one to start your library.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${t.id === currentId ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}
              >
                <button onClick={() => onLoad(t)} className="flex flex-1 items-center gap-2 text-left" disabled={!t.doc}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-[var(--foreground)]">{t.name}</span>
                      <span
                        className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          t.status === 'published' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {t.status}
                      </span>
                      {!t.doc && <span className="text-[10px] text-red-500">unreadable</span>}
                    </div>
                    {t.description && <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">{t.description}</p>}
                  </div>
                </button>
                <button
                  onClick={() => onDelete(t.id)}
                  title="Delete"
                  className="flex-shrink-0 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
