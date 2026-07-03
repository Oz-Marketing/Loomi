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
  Cog6ToothIcon,
  PaintBrushIcon,
  RocketLaunchIcon,
  BookmarkSquareIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { renderDoc, SHAPE_CLIP } from '@/lib/ad-generator/doc-renderer';
import { buildFontFaceCssFromUrls } from '@/lib/ad-generator/fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import { singleOfferDoc, dualOfferDoc } from '@/lib/ad-generator/templates/offer-docs';
import { blankTemplateDoc } from '@/lib/ad-generator/doc-template';
import { DatePicker, type DateRange } from '@/components/ui/date-picker';
import { DeployTemplateModal } from '@/components/ad-generator/deploy-template-modal';
import { enrichOfferFields } from '@/lib/ad-generator/offer-text';
import { buildLayerTree, flattenLayerTree, normalizeGroupZ, type LayerNode } from '@/lib/ad-generator/layer-tree';
import { TextElementIcon, ShapeElementIcon, ButtonElementIcon, DashboardLayoutIcon, LayersIcon, OutlinesIcon, MarginsIcon, CropIcon } from '@/components/ad-generator/builder-icons';
import { catalogByCategory } from '@/lib/ad-generator/ad-size-catalog';
import { useIndustries } from '@/lib/hooks/use-industries';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox, GradientFill, GradientStop, BlendMode } from '@/lib/ad-generator/doc-types';
import type { FieldSpec, FieldType, AdData, AdSize } from '@/lib/ad-generator/types';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';

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
const COALESCE_MS = 450; // window in which same-key edits (typing, a slider drag) merge

type Hist = { past: TemplateDoc[]; present: TemplateDoc; future: TemplateDoc[] };

/**
 * Undo/redo history over the doc. `setDoc(updater, coalesceKey?)` is a drop-in
 * for useState's setter.
 *
 * Coalescing is KEY-BASED, not purely time-based: a change with NO key always
 * starts a fresh undo step, so every discrete action (group, delete, resize,
 * media swap, reorder, …) is its own step. A change WITH a key only merges into
 * the previous step when that step had the same key AND landed within
 * COALESCE_MS — so holding a number stepper or typing into one field collapses
 * to a single step, while switching fields or tools does not. This is what makes
 * undo "account for every change" instead of swallowing an action that happened
 * to follow another within a fixed time window.
 */
function useDocHistory(init: () => TemplateDoc) {
  const [hist, setHist] = useState<Hist>(() => ({ past: [], present: init(), future: [] }));
  const lastTs = useRef(0);
  const lastKey = useRef<string | null>(null);

  const setDoc = useCallback((updater: TemplateDoc | ((d: TemplateDoc) => TemplateDoc), coalesceKey?: string) => {
    setHist((h) => {
      const next = typeof updater === 'function' ? (updater as (d: TemplateDoc) => TemplateDoc)(h.present) : updater;
      if (next === h.present) return h; // no-op change → don't record a step
      const now = Date.now();
      const coalesce = coalesceKey != null && coalesceKey === lastKey.current && h.past.length > 0 && now - lastTs.current < COALESCE_MS;
      lastTs.current = now;
      lastKey.current = coalesceKey ?? null;
      const past = coalesce ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
      return { past, present: next, future: [] };
    });
  }, []);

  // After any undo/redo, break coalescing so the next edit is always its own step.
  const undo = useCallback(() => {
    lastTs.current = 0;
    lastKey.current = null;
    setHist((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) };
    });
  }, []);

  const redo = useCallback(() => {
    lastTs.current = 0;
    lastKey.current = null;
    setHist((h) => {
      if (!h.future.length) return h;
      const nxt = h.future[0];
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: nxt, future: h.future.slice(1) };
    });
  }, []);

  const reset = useCallback((doc: TemplateDoc) => {
    lastTs.current = 0;
    lastKey.current = null;
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
  background: SwatchIcon,
};

type SavedTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** null = global; an account key = only that account sees it in the picker. */
  accountKey?: string | null;
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
  // Elements may bleed past the artboard (clipped on export) and be dragged fully
  // off it (then they detach — see isDetached). BLEED bounds how far past each
  // edge you can push, so a detached element parks just beside the artboard.
  const BLEED = 0.5;
  if (handle === 'move') {
    x = clamp(x, -w - BLEED, 1 + BLEED);
    y = clamp(y, -h - BLEED, 1 + BLEED);
  } else {
    x = clamp(x, -BLEED, 1 + BLEED - MIN_FRAC);
    y = clamp(y, -BLEED, 1 + BLEED - MIN_FRAC);
    w = clamp(w, MIN_FRAC, 1 + BLEED - x);
    h = clamp(h, MIN_FRAC, 1 + BLEED - y);
  }
  return { ...rest, x, y, w, h };
}

/** A box is "detached" when it sits entirely outside the artboard — it's then a
 *  canvas-only parking spot (omitted from the ad/export) until dragged back in. */
function isDetached(b: { x: number; y: number; w: number; h: number }): boolean {
  return b.x + b.w <= 0 || b.x >= 1 || b.y + b.h <= 0 || b.y >= 1;
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
    case 'background':
      // Full-bleed background: base fill + a white→transparent top fade. Texture
      // is added on demand from the inspector. Placement (full-bleed, back z) is
      // handled by addBackground, not here.
      return {
        id,
        type,
        name: 'Background',
        binding: { kind: 'static', value: '' },
        fit: 'cover',
        fill: 'brand',
        overlay: { type: 'linear', angle: 180, stops: [{ color: '#ffffff', pos: 0 }, { color: '#ffffff', pos: 100, opacity: 0 }] },
      };
  }
}

export default function AdBuilderPage() {
  const { accountData, accountKey } = useAccount();
  const { prompt } = useLoomiDialog();

  // A brand-new template starts on an empty artboard (no starter layout). The
  // vehicle-offer doc is still a registered code template (opened via ?ad / ?
  // template), just not the blank-canvas default.
  const { doc, setDoc, undo, redo, canUndo, canRedo, reset: resetHistory } = useDocHistory(() => blankTemplateDoc('tmpl-blank', 'Untitled template'));
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
  // Multi-artboard: when on, every *checked* size is laid out together on the
  // pannable canvas — the active size stays fully editable in place, the rest
  // are live previews you click to make active. `boardSel` picks which sizes
  // appear in that grid; an empty set is treated as "all".
  const [viewAll, setViewAll] = useState(false);
  const [boardSel, setBoardSel] = useState<Set<string>>(() => new Set(doc.sizes.map((s) => s.id)));
  // Keyboard-shortcuts cheatsheet overlay.
  const [helpOpen, setHelpOpen] = useState(false);
  // Manual zoom multiplier on top of the fit-to-pane scale (1 = fit the pane).
  const [zoom, setZoom] = useState(1);
  // Pan offset (px) of the artboard from its centered rest position. The canvas
  // is a transform viewport (like Figma / the flows editor): the pane clips
  // (overflow-hidden) and we translate the artboard rather than scroll it, so a
  // board larger than the pane can be dragged anywhere — even out from under the
  // settings panel — without fighting flexbox's cross-axis overflow.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Space held → the canvas becomes grab-to-pan (like Figma). Middle-mouse pans too.
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Live mirrors so the native wheel listener + window drag handlers read current
  // zoom/pan without re-subscribing every render.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const [showSafe, setShowSafe] = useState(false);
  const [dragBox, setDragBox] = useState<DocLayoutBox | null>(null);
  // Figma-style alignment guides shown while dragging (fractions, or null).
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // Left rail: which panel (Elements / Layers / Industries / Sizes) is open as a
  // flyout. null = collapsed to just the icons.
  const [leftPanel, setLeftPanel] = useState<'insert' | 'layers' | null>(null);
  const railRef = useRef<HTMLElement>(null);
  // Close the left flyout (Insert / Layers / …) when clicking anywhere outside
  // the rail + flyout — e.g. on the canvas. Tile clicks stay inside, so adding
  // several elements in a row still works.
  useEffect(() => {
    if (!leftPanel) return;
    // Listen on pointerdown, not mousedown: the artboard's element handlers call
    // preventDefault() on pointerdown, which suppresses the follow-up mousedown —
    // so a mousedown listener never fired when clicking on the canvas. pointerdown
    // still bubbles to the document regardless.
    const onDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setLeftPanel(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [leftPanel]);
  // The on-canvas "add element" popover (top-left of the artboard).
  const [addSizeOpen, setAddSizeOpen] = useState(false);
  // Sizes popover on the canvas action bar (replaces the old left-rail Sizes panel).
  const [sizesOpen, setSizesOpen] = useState(false);
  // Template settings popover in the header cog (Industries + Save as new).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Publish popover — Draft / live-now / scheduled window.
  const [publishOpen, setPublishOpen] = useState(false);
  const publishRef = useRef<HTMLDivElement>(null);
  // Deploy-to-subaccounts modal.
  const [deployOpen, setDeployOpen] = useState(false);
  // The canvas (Background) settings panel is shown only when the canvas itself
  // is focused — clicking the empty artboard selects "the canvas". It never
  // appears just because no element is selected (so it stays hidden on load).
  // Where the Back button returns to. Entry points pass `?from=<path>` so you
  // exit to wherever you came from (e.g. /templates vs /ad-generator); absent →
  // the sensible default below.
  const [fromHref, setFromHref] = useState<string | null>(null);
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
  const [templateName, setTemplateName] = useState('Untitled template');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  // Scope: null = global (every account the industry filter allows); an
  // account key = only that account's picker offers it (dealer-branded plates).
  const [scopeAccount, setScopeAccount] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  // URL-based @font-face (instant, but the preview iframe can silently drop these
  // cross-origin fonts to CORS). We fetch a base64-embedded version below and
  // prefer it once loaded, so a chosen brand font actually renders in the editor
  // (WYSIWYG with the export, which embeds the same way).
  const fontFaceCss = useMemo(() => buildFontFaceCssFromUrls(customFonts), [customFonts]);
  const [embeddedFontCss, setEmbeddedFontCss] = useState('');
  useEffect(() => {
    if (!accountKey || customFonts.length === 0) {
      setEmbeddedFontCss('');
      return;
    }
    let cancelled = false;
    fetch(`/api/ad-generator/fonts?accountKey=${encodeURIComponent(accountKey)}`)
      .then((r) => (r.ok ? r.json() : { css: '' }))
      .then((j: { css?: string }) => {
        if (!cancelled) setEmbeddedFontCss(j.css ?? '');
      })
      .catch(() => {
        if (!cancelled) setEmbeddedFontCss('');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, customFonts.length]);
  const effectiveFontCss = embeddedFontCss || fontFaceCss;
  const fontOptions = useMemo<FontSelectOption[]>(
    () => [
      { value: '', label: 'Brand default' },
      ...[...new Set(customFonts.map((f) => f.family))].map((fam) => ({ value: fam, label: fam })),
      ...WEBSAFE_FONTS.map((fam) => ({ value: fam, label: fam })),
    ],
    [customFonts],
  );

  // The account's logo variants — offered in the selection panel so a designer
  // can swap which logo a Logo element shows without leaving the canvas.
  const brandLogos = useMemo<{ key: string; label: string; url: string }[]>(() => {
    const l = accountData?.logos;
    if (!l) return [];
    return [
      l.light && { key: 'light', label: 'Light', url: l.light },
      l.dark && { key: 'dark', label: 'Dark', url: l.dark },
      l.white && { key: 'white', label: 'White', url: l.white },
      l.black && { key: 'black', label: 'Black', url: l.black },
    ].filter((v): v is { key: string; label: string; url: string } => Boolean(v));
  }, [accountData?.logos]);

  const previewData = useMemo(
    () =>
      enrichOfferFields({
        ...vehicleOfferPreviewData,
        ...doc.defaults, // designer-set default / preview values for fields
        ...(adData ?? {}), // ad mode: the ad's real content
        ...(effectiveFontCss ? { fontFaceCss: effectiveFontCss } : {}),
        ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
        ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
        ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
      }),
    [accountData, effectiveFontCss, doc.defaults, adData],
  );

  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);

  // The ad scales to fill the canvas pane (measured), with a little padding.
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>();
  const frameRef = useRef<HTMLDivElement>(null); // the artboard frame (for panel alignment)
  const availW = canvasSize.width - CANVAS_PAD;
  const availH = canvasSize.height - CANVAS_PAD;
  // The ordered set of sizes shown together in multi-artboard view — the checked
  // ones, or all sizes when nothing's checked. Also the export selection.
  const boardSizes = useMemo(() => {
    const sel = doc.sizes.filter((s) => boardSel.has(s.id));
    return sel.length ? sel : doc.sizes;
  }, [doc.sizes, boardSel]);

  // Base scale fits the artboard to the pane; `zoom` (1 = fit) layers manual
  // zoom on top. Everything downstream uses `scale`, so the overlay + drag math
  // stay consistent at any zoom. In multi-artboard view the base scale fits the
  // whole grid of boards instead — every board (incl. the editable one) shares
  // this one scale, so the drag math needs no special-casing.
  const fitScale = availW > 0 && availH > 0 ? Math.min(availW / size.width, availH / size.height) : Math.min(560 / size.width, 560 / size.height);
  const GRID_GAP = 40; // screen px between boards in multi-artboard view
  const allGrid = useMemo(() => {
    const n = boardSizes.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = Math.max(...boardSizes.map((s) => s.width));
    const cellH = Math.max(...boardSizes.map((s) => s.height));
    if (!(availW > 0 && availH > 0)) return { fit: 0.2, cols };
    const sw = (availW - (cols - 1) * GRID_GAP) / (cols * cellW);
    const sh = (availH - (rows - 1) * GRID_GAP) / (rows * cellH);
    return { fit: Math.max(0.02, Math.min(sw, sh) * 0.92), cols };
  }, [boardSizes, availW, availH]);
  const scale = (viewAll ? allGrid.fit : fitScale) * zoom;
  const frameW = size.width * scale;
  const frameH = size.height * scale;
  // Refit + recenter when toggling multi-artboard view (the fit basis changes).
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [viewAll]);
  // In single view each size refits when you switch to it; in multi-view the
  // grid stays put as you click between boards (no jarring recenter).
  useEffect(() => {
    if (viewAll) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeId]);

  // If the active board is unchecked while in multi-view, hand editing to the
  // first still-shown board so the editable frame always sits in the grid.
  useEffect(() => {
    if (viewAll && boardSel.size > 0 && !boardSel.has(sizeId) && boardSizes[0]) {
      setSizeId(boardSizes[0].id);
    }
  }, [viewAll, boardSel, sizeId, boardSizes]);

  // Hold Space to grab-pan the canvas (Figma-style). Ignore while a form control
  // is focused so Space still activates buttons / types spaces.
  useEffect(() => {
    const isInteractive = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isInteractive()) return;
      setSpaceHeld(true);
      e.preventDefault(); // stop the page/pane from scrolling on Space
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ⌘/⌃ + wheel (and trackpad pinch, which sends ctrlKey) zooms toward the
  // cursor; plain two-finger scroll / wheel pans. Native non-passive listener so
  // we can preventDefault the page from scrolling/zooming underneath us.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A scrollable settings panel floats over the canvas — let it scroll itself
      // instead of panning/zooming the canvas underneath. (The wheel listener is
      // on the pane, so panel wheel events bubble here; bail if they came from a
      // panel.)
      if ((e.target as Element | null)?.closest?.('[data-adgen-panel]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Zoom toward the cursor. The artboard is centered in the pane then
        // offset by `pan`, so its centre sits at (paneCentre + pan). Keeping the
        // point under the cursor fixed reduces to pan' = pan·r + d·(1−r), where
        // d is the cursor's offset from the pane centre and r the zoom ratio —
        // the artboard size cancels out, so this holds at any zoom.
        const z = zoomRef.current;
        const z2 = Math.max(0.2, Math.min(5, +(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
        const r = z2 / z;
        const dx = e.clientX - rect.left - rect.width / 2;
        const dy = e.clientY - rect.top - rect.height / 2;
        const p = panRef.current;
        setZoom(z2);
        setPan({ x: p.x * r + dx * (1 - r), y: p.y * r + dy * (1 - r) });
      } else if (canPanRef.current) {
        // Two-finger scroll / wheel pans the canvas (only once it has content).
        const p = panRef.current;
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef]);

  // Grab-to-pan: translate the artboard as the pointer drags. Shared by the
  // Space-held path and middle-mouse; window listeners so it keeps tracking
  // outside the pane. Entry points bail into this before select/marquee.
  function startPan(e: React.PointerEvent) {
    if (!canPanRef.current) return; // nothing to pan on an empty artboard
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const p0 = panRef.current;
    const move = (ev: PointerEvent) => {
      setPan({ x: p0.x + (ev.clientX - sx), y: p0.y + (ev.clientY - sy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const layout = doc.layouts[size.id] ?? {};
  const placed = useMemo(
    () =>
      doc.elements
        .map((el) => ({ el, box: layout[el.id] }))
        .filter((x): x is { el: DocElement; box: DocLayoutBox } => Boolean(x.box))
        .sort((a, b) => (a.box.z ?? 0) - (b.box.z ?? 0)),
    [doc.elements, layout],
  );

  // Panning is disabled on a fresh/empty artboard — there's nothing to pan to,
  // and it kept the onboarding card from feeling anchored. Re-enabled the moment
  // a first element is placed. A ref mirrors it for the (stable) wheel listener.
  const canPan = placed.length > 0;
  const canPanRef = useRef(canPan);
  useEffect(() => {
    canPanRef.current = canPan;
  }, [canPan]);

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
  // Interactive image crop: the id of the image element currently in crop mode
  // (drag it on the canvas to reposition; the panel exposes zoom + reset) and
  // the natural pixel size of its source, needed to map drag → object-position.
  const [cropId, setCropId] = useState<string | null>(null);
  const [cropNatural, setCropNatural] = useState<{ w: number; h: number } | null>(null);
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
  // Crop mode is tied to a single selected image; drop it the moment the
  // selection changes (or clears) so we never crop something that isn't focused.
  useEffect(() => {
    if (cropId && cropId !== selectedId) setCropId(null);
  }, [cropId, selectedId]);

  // Read the `from` entry path once on mount (only same-origin absolute paths,
  // so it can't be used as an open-redirect).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('from');
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) setFromHref(raw);
  }, []);

  // Close the publish popover on an outside click — but NOT when the click is
  // inside the DatePicker calendar (it renders in a body portal, so it's outside
  // publishRef even though it belongs to this popover).
  useEffect(() => {
    if (!publishOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (publishRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-datepicker-popover]')) return;
      setPublishOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [publishOpen]);

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
    const isImage = selected.type === 'image' || selected.type === 'logo' || selected.type === 'background';
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
      // Typing into the content field merges into one step per element; a media
      // swap (discrete) naturally lands outside the window, so it stays separate.
      if (b?.kind === 'static') {
        setDoc((prev) => ({ ...prev, elements: prev.elements.map((e) => (e.id === id ? { ...e, binding: { kind: 'static', value: v } } : e)) }), `content:${id}`);
      } else if (b?.kind === 'field') {
        const key = b.key;
        setDoc((prev) => ({ ...prev, defaults: { ...prev.defaults, [key]: v } }), `content:${id}:${key}`);
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

  // Load the crop target's natural pixel size so a drag maps 1:1 to the visible
  // window (same math as the background pan, but scoped to the element's box).
  useEffect(() => {
    if (!cropId) {
      setCropNatural(null);
      return;
    }
    const url = resolveBindingUrl(doc.elements.find((e) => e.id === cropId));
    if (!url) {
      setCropNatural(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setCropNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.src = url;
    return () => {
      alive = false;
    };
  }, [cropId, doc.elements, resolveBindingUrl]);

  // ── doc mutations (all functional so they don't capture stale state) ──
  // `coalesceKey` (optional): repeated calls with the same key inside the coalesce
  // window merge into one undo step (holding a stepper, dragging a slider). Omit
  // it for discrete actions (a drag/resize commit) so each is its own step.
  const setBox = useCallback((sid: string, elId: string, box: DocLayoutBox, coalesceKey?: string) => {
    setDoc(
      (prev) => ({
        ...prev,
        layouts: { ...prev.layouts, [sid]: { ...prev.layouts[sid], [elId]: box } },
      }),
      coalesceKey,
    );
  }, []);

  const setElement = useCallback((id: string, patch: Partial<DocElement>, coalesceKey?: string) => {
    setDoc(
      (prev) => ({
        ...prev,
        elements: prev.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      }),
      coalesceKey,
    );
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

  // In-place text editing: turn the ACTUAL rendered node inside the iframe into a
  // contenteditable so the caret sits in the real text (WYSIWYG), rather than a
  // floating textarea. Runs once per edit session (keyed on the element id);
  // keystrokes sync back into `editingText.value`, and Enter / blur commit while
  // Escape cancels (the iframe re-renders from the doc, discarding the edit).
  useEffect(() => {
    if (!editingText) return;
    const idoc = iframeRef.current?.contentDocument;
    const iwin = iframeRef.current?.contentWindow;
    if (!idoc || !iwin) return;
    const node = idoc.querySelector(`[data-el-id="${editingText.id}"]`) as HTMLElement | null;
    if (!node) return;

    const el = doc.elements.find((e) => e.id === editingText.id);
    const color =
      el?.color === 'brand'
        ? typeof previewData.brandColor === 'string'
          ? previewData.brandColor
          : '#111827'
        : el?.color || '#111827';

    // Seed the node with the real value (not the dimmed placeholder label) and
    // make it editable in place.
    const prevOutline = node.style.outline;
    const prevOffset = node.style.outlineOffset;
    const prevCursor = node.style.cursor;
    node.textContent = editingText.value;
    node.style.color = color;
    node.style.caretColor = color;
    node.style.outline = '2px solid #6366f1';
    node.style.outlineOffset = '1px';
    node.style.cursor = 'text';
    node.setAttribute('contenteditable', 'true');
    node.spellcheck = false;

    node.focus();
    // Select all so the starting (often placeholder) text is easy to replace.
    try {
      const range = idoc.createRange();
      range.selectNodeContents(node);
      const sel = iwin.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* selection is best-effort */
    }

    const onInput = () => {
      const value = node.textContent ?? '';
      setEditingText((cur) => (cur ? { ...cur, value } : cur));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        node.blur(); // triggers commit
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditingText(null); // cancel
      }
    };
    const onBlur = () => commitTextEdit();

    node.addEventListener('input', onInput);
    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('blur', onBlur);

    return () => {
      node.removeEventListener('input', onInput);
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('blur', onBlur);
      node.removeAttribute('contenteditable');
      node.style.outline = prevOutline;
      node.style.outlineOffset = prevOffset;
      node.style.cursor = prevCursor;
    };
    // Keyed on id only: value changes must NOT re-run this (would reset the caret).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText?.id]);

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

  // Make the selected element a background: full-bleed (0,0,1,1) on every size +
  // sent behind everything. A background is just a full-bleed Image (photo /
  // texture) or Shape (solid / gradient) — this is the one-click convenience so
  // there's no separate "background" concept to manage.
  const fillArtboardAndSendBack = useCallback((elId: string) => {
    setDoc((prev) => {
      const layouts = { ...prev.layouts };
      for (const s of prev.sizes) {
        const cur = layouts[s.id] ?? {};
        const minZ = Object.values(cur).reduce((m, b) => Math.min(m, b.z ?? 0), 0);
        layouts[s.id] = { ...cur, [elId]: { ...(cur[elId] ?? {}), x: 0, y: 0, w: 1, h: 1, z: minZ - 1 } };
      }
      return { ...prev, layouts };
    }, `fillback:${elId}`);
  }, []);

  // Patch the selected element's style.
  // Panel edits coalesce per (element, property set): holding a stepper or
  // dragging a color/slider is one undo step, while editing a different property
  // starts a new one. Discrete callers use setElement directly (no key).
  const updEl = (patch: Partial<DocElement>) => {
    if (selected) setElement(selected.id, patch, `el:${selected.id}:${Object.keys(patch).sort().join(',')}`);
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
    setDoc((prev) => ({ ...prev, fields: prev.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) }), `field:${i}:${Object.keys(patch).sort().join(',')}`);
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
    }, `fieldkey:${i}`);
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
    }, `default:${i}`);
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
  // Publish schedule (lives in the doc JSON). Undefined = live indefinitely.
  function setSchedule(next: { start?: string | null; end?: string | null } | undefined) {
    setDoc((prev) => ({ ...prev, schedule: next }));
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
      const payload = { name, doc: { ...doc, name }, status, accountKey: scopeAccount };
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

  // Save the current design as a NEW reusable template (from either an ad or an
  // existing template). Always creates a fresh AdTemplateDoc so the source is
  // never overwritten. Scoped to the active account (null → global for admins).
  async function saveAsTemplate() {
    const suggested = adId ? `${templateName.trim() || 'Untitled ad'} template` : `${templateName.trim() || 'Untitled template'} copy`;
    const name = (
      await prompt({
        title: 'Save as template',
        message: 'Save this design as a reusable template. It will appear in the template picker for new ads.',
        defaultValue: suggested,
        placeholder: 'Template name',
        confirmLabel: 'Save template',
        required: true,
      })
    )?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ad-generator/templates-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, doc: { ...doc, name }, status: 'draft', accountKey: accountKey ?? null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success('Saved as a new template');
    } catch (err) {
      toast.error(`Couldn't save template: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
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
    setScopeAccount(t.accountKey ?? null);
    setSizeId(loaded.sizes[0]?.id ?? '');
    clearSelection();
    savedRef.current = serializeDoc(loaded, t.name, st);
    setSaveStatus('saved');
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
            // No snapshot yet — resolve the source doc. Code offer templates
            // (single/dual/vehicle) live in the registry; everything else is a
            // saved TemplateDoc. Without this, offer-template ads couldn't be
            // opened in the builder at all (so they never autosaved either).
            const codeDocs: Record<string, TemplateDoc> = {
              [vehicleOfferDoc.id]: vehicleOfferDoc,
              [singleOfferDoc.id]: singleOfferDoc,
              [dualOfferDoc.id]: dualOfferDoc,
            };
            if (codeDocs[c.templateId]) d = structuredClone(codeDocs[c.templateId]);
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
        const json = (await res.json()) as { template?: { id: string; name: string; description: string | null; status: string; accountKey?: string | null; doc: TemplateDoc | null } };
        const t = json.template;
        if (!t?.doc) {
          toast.error('That template could not be opened');
          return;
        }
        // `copy=1` → "start from" this template: load its design but as a NEW,
        // unsaved draft (clear the id so the first save creates a fresh template
        // instead of overwriting the source).
        const copy = params.get('copy') === '1';
        loadTemplate({ id: t.id, name: copy ? `${t.name} copy` : t.name, description: t.description, status: copy ? 'draft' : t.status, accountKey: t.accountKey ?? null, updatedAt: '', doc: t.doc });
        if (copy) {
          setTemplateId(null);
          savedRef.current = '';
          setSaveStatus('idle');
        }
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
    | { kind: 'bgpan'; sx: number; sy: number; sizeId: string; elId: string; startObjX: number; startObjY: number; overflowX: number; overflowY: number; url: string; coverW: number; coverH: number; dragging: boolean; live: { objectX: number; objectY: number } }
    | { kind: 'croppan'; sx: number; sy: number; sizeId: string; elId: string; startObjX: number; startObjY: number; overflowX: number; overflowY: number; dragging: boolean; live: { objectX: number; objectY: number } };
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
    if (d.kind === 'croppan') {
      const dxPx = e.clientX - d.sx;
      const dyPx = e.clientY - d.sy;
      if (!d.dragging && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
      d.dragging = true;
      // Same 1:1 pan as the background, but the window is the element's own box:
      // dragging the image reveals the opposite side, so object-position tracks
      // the cursor. Nudge the live iframe node so it moves without a re-render.
      const ox = d.overflowX > 0 ? clamp(d.startObjX - dxPx / d.overflowX, 0, 1) : d.startObjX;
      const oy = d.overflowY > 0 ? clamp(d.startObjY - dyPx / d.overflowY, 0, 1) : d.startObjY;
      d.live = { objectX: ox, objectY: oy };
      const node = iframeRef.current?.contentDocument?.querySelector(`[data-el-id="${d.elId}"] img`) as HTMLElement | null;
      if (node) {
        node.style.objectPosition = `${ox * 100}% ${oy * 100}%`;
        node.style.transformOrigin = `${ox * 100}% ${oy * 100}%`;
      }
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
      // A plain click on the empty artboard just clears the selection (handled on
      // pointerdown). Backgrounds are elements now — there's no canvas panel.
    } else if ((d?.kind === 'bgpan' || d?.kind === 'croppan') && d.dragging) {
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

  // Crop-mode drag: reposition the image inside its own box. The cover fit fills
  // the box, extra `objectScale` zoom scales it further, and the leftover overflow
  // in each axis is what a drag can pan across (mapped 1:1 to the cursor).
  function startCropPan(e: React.PointerEvent, elId: string) {
    e.preventDefault();
    e.stopPropagation();
    const box = layout[elId];
    if (!box || !cropNatural) return;
    const boxW = box.w * frameW;
    const boxH = box.h * frameH;
    const coverScale = Math.max(boxW / cropNatural.w, boxH / cropNatural.h) * Math.max(1, box.objectScale ?? 1);
    const overflowX = Math.max(0, cropNatural.w * coverScale - boxW);
    const overflowY = Math.max(0, cropNatural.h * coverScale - boxH);
    const startObjX = box.objectX ?? 0.5;
    const startObjY = box.objectY ?? 0.5;
    dragRef.current = { kind: 'croppan', sx: e.clientX, sy: e.clientY, sizeId: size.id, elId, startObjX, startObjY, overflowX, overflowY, dragging: false, live: { objectX: startObjX, objectY: startObjY } };
    listen();
  }

  // Element pointerdown: Shift toggles selection; otherwise select (or keep a
  // multi-selection) and start a single / group drag.
  function onBoxPointerDown(e: React.PointerEvent, elId: string) {
    // Space-held / middle-mouse pans the canvas even when starting over an element.
    if (spaceHeld || e.button === 1) {
      startPan(e);
      return;
    }
    // Crop mode owns the pointer for its target: drag repositions the image
    // inside the crop window instead of moving/selecting the element.
    if (cropId === elId) {
      startCropPan(e, elId);
      return;
    }
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
      } else if (key === ']' || key === '[') {
        // Bring forward (⌘]) / send back (⌘[) — z-order within the current size.
        // Functional setDoc so consecutive presses read fresh z, not a stale closure.
        if (selectedIds.length !== 1) return;
        e.preventDefault();
        const id = selectedIds[0];
        setDoc((prev) => {
          const lay = prev.layouts[size.id] ?? {};
          const b = lay[id];
          if (!b) return prev;
          const zs = Object.values(lay).map((x) => x.z ?? 0);
          const nz = key === ']' ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
          return { ...prev, layouts: { ...prev.layouts, [size.id]: { ...lay, [id]: { ...b, z: nz } } } };
        });
      } else if (key === 'd') {
        // Duplicate (⌘D) the single selected element.
        if (selectedIds.length !== 1) return;
        e.preventDefault();
        duplicateElement(selectedIds[0]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedIds, doc.elements, doc.groups, size.id, duplicateElement]);

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
    // No separate "Background": a background is a full-bleed Image (photo/texture)
    // or Shape (solid/gradient) — use those + the "Fill artboard & send to back"
    // action on the element's inspector.
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
      {effectiveFontCss && <style dangerouslySetInnerHTML={{ __html: effectiveFontCss }} />}

      {/* Editor header — responsive: Back (far left), centered name, actions right.
          Items shrink rather than overflow on narrow widths. */}
      <header className="flex flex-shrink-0 items-center gap-2 pb-3">
        <Link
          href={fromHref ?? (adId ? `/ad-generator/${adId}` : '/ad-generator')}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          title="Back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          Back
        </Link>

        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder={adId ? 'Untitled ad' : 'Untitled template'}
          title={adId ? 'Ad name' : 'Template name'}
          className="w-full max-w-[16rem] min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-bold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
        />

        <div className="ml-auto" />


        {/* Right actions */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* Publish — a popover: Draft, live indefinitely, or a scheduled window
              (only visible in the template library during the window). */}
          {!adId && (() => {
            const sched = doc.schedule;
            // "Scheduled" mode is tracked by the schedule object existing (even
            // with no dates yet) — so picking it doesn't force a default date.
            const scheduled = status === 'published' && sched !== undefined;
            const mode: 'draft' | 'live' | 'scheduled' = status !== 'published' ? 'draft' : scheduled ? 'scheduled' : 'live';
            const range: DateRange = { start: sched?.start ?? null, end: sched?.end ?? null };
            const dot = mode === 'draft' ? 'bg-[var(--muted-foreground)]' : mode === 'scheduled' ? 'bg-amber-500' : 'bg-emerald-500';
            const labelText = mode === 'draft' ? 'Draft' : mode === 'scheduled' ? 'Scheduled' : 'Live';
            const Opt = ({ id, title, desc }: { id: 'draft' | 'live' | 'scheduled'; title: string; desc: string }) => (
              <button
                type="button"
                onClick={() => {
                  if (id === 'draft') setStatus('draft');
                  else if (id === 'live') {
                    setStatus('published');
                    setSchedule(undefined);
                  } else {
                    setStatus('published');
                    if (!sched) setSchedule({ start: null, end: null });
                  }
                }}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--muted)] ${mode === id ? 'bg-[var(--muted)]' : ''}`}
              >
                <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${mode === id ? 'bg-[var(--primary)]' : 'border border-[var(--muted-foreground)]/50'}`} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--foreground)]">{title}</span>
                  <span className="block text-[10px] leading-snug text-[var(--muted-foreground)]">{desc}</span>
                </span>
              </button>
            );
            return (
              <div className="relative" ref={publishRef}>
                <button
                  type="button"
                  onClick={() => setPublishOpen((v) => !v)}
                  aria-expanded={publishOpen}
                  title="Publish settings"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {labelText}
                  <ChevronDownIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                </button>
                {publishOpen && (
                  <div className="absolute right-0 top-full z-[80] mt-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-1.5 shadow-2xl backdrop-blur-2xl">
                    <Opt id="draft" title="Draft" desc="Hidden from the template library." />
                    <Opt id="live" title="Publish — live now" desc="Available indefinitely." />
                    <Opt id="scheduled" title="Publish — scheduled" desc="Available only during the window below." />
                    {mode === 'scheduled' && (
                      <div className="mt-1 border-t border-[var(--border)] px-1 pt-2">
                        <DatePicker
                          mode="range"
                          value={range}
                          onChange={(v) => setSchedule({ start: v.start, end: v.end })}
                          placeholder="Pick a date range"
                          minWidth="100%"
                        />
                        <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted-foreground)]">Leave the end open to run until you unpublish.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Template settings cog — Industries (who the template is offered to)
              + Save as new. Template mode only. */}
          {!adId && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                title="Template settings"
                aria-label="Template settings"
                aria-pressed={settingsOpen}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${settingsOpen ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'}`}
              >
                <Cog6ToothIcon className="h-5 w-5" />
              </button>
              {settingsOpen && (
                <>
                  <div className="fixed inset-0 z-[90]" onClick={() => setSettingsOpen(false)} />
                  <div className="absolute right-0 top-11 z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-2xl backdrop-blur-2xl">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Industries</h3>
                    <p className="mb-3 text-[11px] leading-snug text-[var(--muted-foreground)]">
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
                    <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                      <button
                        onClick={() => {
                          setDeployOpen(true);
                          setSettingsOpen(false);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        <RocketLaunchIcon className="h-4 w-4" />
                        Deploy to subaccounts
                      </button>
                      {templateId && (
                        <button
                          onClick={() => {
                            save(true);
                            setSettingsOpen(false);
                          }}
                          disabled={saving}
                          className="w-full rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
                        >
                          Save as new
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Save the current design as a reusable template. In ad mode this is
              the only way to promote an ad's design into the template library;
              in template mode "Save as new" (in the cog) covers the same need. */}
          {adId && (
            <button
              onClick={saveAsTemplate}
              disabled={saving}
              title="Save this design as a reusable template"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            >
              <BookmarkSquareIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Save as template</span>
            </button>
          )}

          {/* Autosave status — sits right next to Save */}
          {templateId || adId ? (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${saveInfo.cls}`}>
              <saveInfo.Icon className={`h-3.5 w-3.5 ${saveInfo.spin ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">{saveInfo.label}</span>
            </span>
          ) : (
            <span className="hidden text-[11px] text-[var(--muted-foreground)] md:inline">Unsaved</span>
          )}
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {/* Body — tools sidebar + canvas */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left sidebar — tools */}
        <aside ref={railRef} className="relative flex flex-shrink-0">
          {/* Icon rail — click an icon to open that panel as a flyout to the right.
              Nudged down so it sits beside the canvas body rather than the toolbar. */}
          <div className="flex w-12 flex-col items-center gap-0.5 pt-14">
            {/* Insert — opens the Elements flyout (Text / Image / Button / Shape /
                Background). Lives in the rail alongside Layers so adding never
                collides with an open panel. Sizes are managed on the canvas
                action bar (bottom); view guides (outlines / margins) live here. */}
            <RailButton label="Insert" Icon={PlusIcon} primary active={leftPanel === 'insert'} onClick={() => setLeftPanel((p) => (p === 'insert' ? null : 'insert'))} />
            <RailButton label="Layers" Icon={LayersIcon} active={leftPanel === 'layers'} onClick={() => setLeftPanel((p) => (p === 'layers' ? null : 'layers'))} />
            <div className="my-0.5 h-px w-6 bg-[var(--border)]" />
            {/* View guides — element outlines + safe-area margins (moved off the
                canvas header so all the view controls sit on the rail). */}
            <RailButton label="Outlines" Icon={OutlinesIcon} active={showOutlines} onClick={() => setShowOutlines((v) => !v)} activeClassName="text-blue-500" />
            {/* Margins — click toggles the guide; the size/unit popup shows on
                hover ONLY while active (the `pl-2` keeps a hover bridge to it).
                The tooltip is suppressed only while active, so it can't cover the
                popup — when inactive, hovering shows the normal tooltip. */}
            <div className="group relative">
              <RailButton label="Margins" Icon={MarginsIcon} active={showSafe} onClick={toggleMargins} activeClassName="text-green-500" noTooltip={showSafe} />
              <div className={`pointer-events-none absolute left-full top-0 z-40 pl-2 opacity-0 transition-opacity ${showSafe ? 'group-hover:pointer-events-auto group-hover:opacity-100' : ''}`}>
                <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-1.5 shadow-md backdrop-blur-2xl">
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
              </div>
            </div>
          </div>

          {leftPanel && (
            // pointer-events-none so the empty space below the (shorter) card
            // doesn't swallow clicks — otherwise clicking below an open panel
            // lands "inside" the rail and never triggers the outside-close. The
            // cards re-enable pointer events.
            <div className="pointer-events-none absolute inset-y-0 left-full z-30 ml-2 flex w-[320px] flex-col gap-4 overflow-y-auto pb-1 pr-1">
          {/* Insert — element palette. Click a tile to drop it on the canvas. */}
          {leftPanel === 'insert' && (
          <section className="glass-card pointer-events-auto rounded-2xl border border-[var(--border)] p-4">
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
          <section className="glass-card pointer-events-auto rounded-2xl border border-[var(--border)] p-4">
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
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left ${isSel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                          title="Double-click to rename"
                        >
                          <Icon className="h-4 w-4 flex-shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{elName(el)}</span>
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
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-2 text-left ${allSel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                            title="Click to select group · double-click to rename"
                          >
                            <RectangleStackIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{gname}</span>
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

            </div>
          )}
        </aside>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="relative flex flex-shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-3 py-2">
            {/* Zoom lives on the canvas (bottom-left); outlines + margins moved to
                the left rail; the active size is shown on the canvas action bar. */}
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
            className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[var(--muted)]/30 [background-image:radial-gradient(var(--adgen-canvas-dot)_1px,transparent_1.5px)] [background-position:center] [background-size:18px_18px]"
            style={{ userSelect: 'none', cursor: spaceHeld && canPan ? 'grab' : undefined }}
            onPointerDown={(e) => {
              // Space-held or middle-mouse → grab-pan the whole canvas (only once
              // it has content; an empty artboard isn't draggable).
              if ((spaceHeld || e.button === 1) && canPan) {
                startPan(e);
                return;
              }
              // Clicking the gray area OUTSIDE the artboard clears the selection.
              // (Clicking the artboard itself is handled by the marquee up.)
              if (e.target === e.currentTarget) {
                clearSelection();
              }
            }}
          >
              {/* Transform viewport: the pane clips and we translate the artboard
                  by `pan` rather than scroll it, so a board larger than the pane
                  can be dragged anywhere — even out from under the settings panel.
                  In multi-artboard view this becomes a grid: the editable frame is
                  one cell (ordered by its slot) and the other boards are appended
                  as live previews with matching `order`, so no code moves. */}
              <div
                className={viewAll ? 'grid place-items-center' : undefined}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                  willChange: 'transform',
                  ...(viewAll ? { gridTemplateColumns: `repeat(${allGrid.cols}, max-content)`, gap: GRID_GAP } : {}),
                }}
              >
              <div ref={frameRef} className="relative rounded-md shadow-[0_12px_48px_-8px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/10" style={{ width: frameW, height: frameH, order: viewAll ? boardSizes.findIndex((s) => s.id === sizeId) : undefined }}>
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
                      // Normally inert (the overlay handles interaction), but while
                      // editing text we let clicks reach the real node so the caret
                      // lands in the actual rendered text.
                      pointerEvents: editingText ? 'auto' : 'none',
                    }}
                  />
                </div>

                {/* Interaction overlay — drag empty backdrop to marquee-select.
                    Disabled during in-place text editing so clicks pass through to
                    the contenteditable node in the iframe. */}
                <div
                  className="absolute inset-0"
                  style={{ pointerEvents: editingText ? 'none' : undefined }}
                  onPointerDown={(e) => {
                    if ((spaceHeld || e.button === 1) && canPan) {
                      startPan(e);
                      return;
                    }
                    if (e.target === e.currentTarget) startMarquee(e);
                  }}
                >
                  {/* Empty-canvas onboarding — lives INSIDE the artboard frame so
                      it pans/moves with the canvas (not a detached center modal).
                      Clears the moment a first element is added. Wrapper is
                      click-through so pan/marquee still work; only the card is
                      interactive. */}
                  {placed.length === 0 && !viewAll && (
                    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-6">
                      {/* faint dashed frame hinting the design area */}
                      <div className="pointer-events-none absolute inset-3 rounded-2xl border border-dashed border-[var(--primary)]/20" />
                      <div className="pointer-events-auto relative w-full max-w-[22rem] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card-strong)]/95 shadow-2xl backdrop-blur-xl">
                        <div className="flex flex-col items-center gap-2 bg-gradient-to-b from-[var(--primary)]/12 to-transparent px-6 pb-2 pt-6 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[#a855f7] text-white shadow-lg shadow-[var(--primary)]/30">
                            <PaintBrushIcon className="h-6 w-6" />
                          </div>
                          <h3 className="text-base font-bold text-[var(--foreground)]">Design your ad</h3>
                          <p className="max-w-[16rem] text-xs leading-relaxed text-[var(--muted-foreground)]">
                            Start with your first element — text, an image, a button, or a shape.
                          </p>
                        </div>
                        <div className="px-5 pb-5 pt-3">
                          <AdderGrid adders={adders} variant="onboarding" />
                        </div>
                        <div className="border-t border-[var(--border)] px-5 py-2.5 text-center text-[11px] text-[var(--muted-foreground)]">
                          Need a different size? Open <span className="font-medium text-[var(--foreground)]">Sizes</span> from the bar below.
                        </div>
                      </div>
                    </div>
                  )}
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
                    const isCropping = cropId === el.id;
                    const singleDragging = dragBox != null && dragRef.current?.kind === 'single' && dragRef.current.elId === el.id;
                    const live = groupLive?.[el.id];
                    const b = singleDragging && dragBox ? dragBox : live ?? box;
                    // Fully off the artboard → detached (a canvas-only parking
                    // spot). The iframe clips it away, so the builder draws its
                    // visual here in the (unclipped) overlay instead.
                    const detached = isDetached(b);
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
                      cursor: el.locked ? 'default' : isCropping ? 'grab' : box.hidden ? 'pointer' : 'move',
                      // A locked layer never intercepts the pointer — so a locked
                      // full-bleed background can't block dragging the elements on
                      // top of it. Clicks on empty (locked) canvas fall through to
                      // the frame's marquee → deselect, as before.
                      pointerEvents: el.locked ? 'none' : undefined,
                      touchAction: 'none',
                    };
                    return (
                      <div
                        key={el.id}
                        data-overlay-el-id={el.id}
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
                        title={detached ? `${elName(el)} (detached — drag onto the artboard to add)` : box.hidden ? `${elName(el)} (hidden here)` : elName(el)}
                        className="group absolute"
                        style={boxStyle}
                      >
                        {/* Detached elements are clipped out of the iframe, so
                            render their actual content here on the canvas. */}
                        {detached && <DetachedVisual el={el} box={b} scale={scale} previewData={previewData} resolveUrl={resolveBindingUrl} />}
                        <span
                          className={`pointer-events-none absolute inset-0 rounded-[2px] ring-inset transition-colors ${
                            isCropping
                              ? 'ring-2 ring-[var(--primary)]'
                              : isSel
                                ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/10'
                                : detached
                                  ? 'ring-1 ring-dashed ring-amber-500/70 group-hover:ring-amber-500'
                                  : box.hidden
                                    ? 'ring-1 ring-dashed ring-[var(--muted-foreground)]/45 group-hover:ring-[var(--muted-foreground)]/70'
                                    : showOutlines
                                      ? 'ring-[1.5px] ring-dashed ring-[var(--primary)]/55 group-hover:ring-[var(--primary)]/90'
                                      : 'group-hover:ring-[1.5px] group-hover:ring-[var(--primary)]/70'
                          }`}
                        />
                        {isSingleSel && (
                          <>
                            <span className={`pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${detached ? 'bg-amber-500' : 'bg-[var(--primary)]'}`}>
                              {isCropping ? 'Crop — drag to reposition' : detached ? `${elName(el)} — detached` : elName(el)}
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

                  {/* In-place text editing happens directly on the rendered node
                      inside the iframe (see the editingText effect) so the caret
                      sits in the real text — no floating textarea overlay. */}

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
              {/* Live previews of the other checked sizes — click one to make it
                  the editable board. `order` matches its slot in boardSizes so it
                  lands in the right grid cell without reordering the source. */}
              {viewAll &&
                boardSizes.map((s, i) =>
                  s.id === sizeId ? null : (
                    <PreviewBoard
                      key={s.id}
                      doc={doc}
                      previewData={previewData}
                      size={s}
                      scale={scale}
                      order={i}
                      onActivate={() => setSizeId(s.id)}
                    />
                  ),
                )}
              </div>

              {/* Zoom — a vertical stack pinned inside the canvas, bottom-left.
                  Fit-relative; the % click resets to fit. */}
              <div className="absolute bottom-3 left-3 z-20 flex flex-col items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--card-strong)]/80 px-1 py-1 backdrop-blur-md">
                <button
                  onClick={() => setZoom((z) => Math.min(5, +(z * 1.25).toFixed(3)))}
                  title="Zoom in"
                  aria-label="Zoom in"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <MagnifyingGlassPlusIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  title="Fit to screen"
                  aria-label="Fit to screen"
                  className="rounded-lg px-1 py-0.5 text-center text-[11px] font-medium tabular-nums text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, +(z / 1.25).toFixed(3)))}
                  title="Zoom out"
                  aria-label="Zoom out"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <MagnifyingGlassMinusIcon className="h-4 w-4" />
                </button>
              </div>

              {/* Size navigation — single view: arrow-paginated with a toggle into
                  multi-artboard view. Multi view: per-size checkbox chips (which
                  boards show + export) with select/deselect-all. */}
              {doc.sizes.length > 0 &&
                !viewAll &&
                (() => {
                  const idx = Math.max(0, doc.sizes.findIndex((s) => s.id === sizeId));
                  const go = (delta: number) => setSizeId(doc.sizes[(idx + delta + doc.sizes.length) % doc.sizes.length].id);
                  return (
                    <div className="absolute bottom-3 left-1/2 z-20 flex w-max -translate-x-1/2 items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--card-strong)]/80 px-1.5 py-1 backdrop-blur-md">
                      <button
                        onClick={() => go(-1)}
                        disabled={doc.sizes.length < 2}
                        title="Previous size"
                        aria-label="Previous size"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                      </button>
                      {/* The label opens the Sizes modal (switch / add / all-sizes). */}
                      <button
                        onClick={() => setSizesOpen(true)}
                        title="Manage sizes — switch, add, remove, view all"
                        aria-label="Manage sizes"
                        className="inline-flex h-7 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                      >
                        <DashboardLayoutIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                        {doc.sizes[idx]?.label.split(' ')[0]} <span className="tabular-nums text-[var(--muted-foreground)]">{idx + 1}/{doc.sizes.length}</span>
                      </button>
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

              {doc.sizes.length > 0 && viewAll && (
                <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card-strong)]/80 py-1 pl-1.5 pr-2 backdrop-blur-md">
                  <button
                    onClick={() => setViewAll(false)}
                    title="Back to single view"
                    aria-label="Back to single view"
                    className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <ChevronLeftIcon className="h-3.5 w-3.5" />
                    Edit one
                  </button>
                  <button
                    onClick={() => setSizesOpen(true)}
                    title="Manage sizes — switch, add, remove"
                    aria-label="Manage sizes"
                    className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <DashboardLayoutIcon className="h-3.5 w-3.5" />
                  </button>
                  <div className="h-5 w-px flex-shrink-0 bg-[var(--border)]" />
                  <button
                    onClick={() => setBoardSel(new Set(doc.sizes.map((s) => s.id)))}
                    className="flex-shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setBoardSel(new Set([sizeId]))}
                    className="flex-shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    None
                  </button>
                  <div className="h-5 w-px flex-shrink-0 bg-[var(--border)]" />
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {doc.sizes.map((s) => {
                      const checked = boardSel.has(s.id) || boardSel.size === 0;
                      const isActive = s.id === sizeId;
                      return (
                        <button
                          key={s.id}
                          onClick={() =>
                            setBoardSel((prev) => {
                              const next = new Set(prev.size === 0 ? doc.sizes.map((x) => x.id) : prev);
                              if (next.has(s.id)) {
                                if (next.size > 1) next.delete(s.id); // keep at least one
                              } else next.add(s.id);
                              return next;
                            })
                          }
                          title={`${s.label} — ${checked ? 'shown' : 'hidden'}`}
                          className={`inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors ${
                            isActive
                              ? 'border-[var(--primary)] text-[var(--foreground)]'
                              : checked
                                ? 'border-transparent bg-[var(--muted)] text-[var(--foreground)]'
                                : 'border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                          }`}
                        >
                          <span
                            className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
                              checked ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--muted-foreground)]/50'
                            }`}
                          >
                            {checked && <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          {s.label.split(' ')[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selected && selectedBox && !selectedBox.hidden && (
                <SelectionPanel
                  el={selected}
                  box={selectedBox}
                  sizeW={size.width}
                  sizeH={size.height}
                  fontOptions={fontOptions}
                  brandLogos={brandLogos}
                  content={selectionContent}
                  onContentChange={setSelectedContent}
                  accountKey={accountKey ?? undefined}
                  onEl={updEl}
                  onBox={(patch) => setBox(size.id, selected.id, { ...selectedBox, ...patch }, `box:${selected.id}:${Object.keys(patch).sort().join(',')}`)}
                  onClose={clearSelection}
                  onFillArtboard={() => fillArtboardAndSendBack(selected.id)}
                  shifted={fieldsOpen}
                  cropping={cropId === selected.id}
                  onToggleCrop={() => {
                    if (cropId === selected.id) {
                      setCropId(null);
                    } else {
                      if (selected.fit !== 'cover') updEl({ fit: 'cover' });
                      setCropId(selected.id);
                    }
                  }}
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

      {/* Sizes — a centered modal (switch / add / remove / copy layout), opened
          from the canvas action bar. Backdrop click closes it. */}
      {sizesOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSizesOpen(false);
          }}
        >
          <SizesManager
            doc={doc}
            sizeId={sizeId}
            sizeLabel={size.label}
            setSizeId={setSizeId}
            removeSize={removeSize}
            addSize={addSize}
            createLibrarySize={createLibrarySize}
            copyLayoutFrom={copyLayoutFrom}
            libSizes={libSizes}
            addSizeOpen={addSizeOpen}
            setAddSizeOpen={setAddSizeOpen}
            customName={customName}
            setCustomName={setCustomName}
            customW={customW}
            setCustomW={setCustomW}
            customH={customH}
            setCustomH={setCustomH}
            onClose={() => setSizesOpen(false)}
            viewAll={viewAll}
            onViewAll={() => {
              setViewAll(true);
              setSizesOpen(false);
            }}
          />
        </div>
      )}

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}

      {deployOpen && <DeployTemplateModal name={templateName} doc={doc} excludeKey={scopeAccount} onClose={() => setDeployOpen(false)} />}

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
                      <Item onClick={bringForward} kbd="⌘]">Bring forward</Item>
                      <Item onClick={sendBack} kbd="⌘[">Send back</Item>
                      <Item onClick={() => duplicateElement(single.id)} kbd="⌘D">Duplicate</Item>
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
    <div data-adgen-panel className="fixed right-4 top-20 bottom-4 z-40 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl">
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
  brandLogos,
  content,
  onContentChange,
  accountKey,
  onEl,
  onBox,
  onClose,
  onFillArtboard,
  shifted,
  cropping,
  onToggleCrop,
}: {
  el: DocElement;
  box: DocLayoutBox;
  sizeW: number;
  sizeH: number;
  fontOptions: FontSelectOption[];
  brandLogos: { key: string; label: string; url: string }[];
  content: { mode: 'none' | 'text-edit' | 'text-readonly' | 'image-edit' | 'image-readonly'; value: string; note?: string } | null;
  onContentChange: (value: string) => void;
  accountKey?: string;
  onEl: (patch: Partial<DocElement>) => void;
  onBox: (patch: Partial<DocLayoutBox>) => void;
  onClose: () => void;
  /** Make this element a full-bleed background (fill artboard + send to back on
   *  every size). Shown for Image + Shape. */
  onFillArtboard: () => void;
  shifted: boolean;
  cropping: boolean;
  onToggleCrop: () => void;
}) {
  const fontSize = box.fontSize ?? 16;
  const typeLabel = el.type === 'text' ? 'Text' : el.type === 'image' ? 'Image' : el.type === 'logo' ? 'Logo' : el.type === 'background' ? 'Background' : 'Shape';
  const [picking, setPicking] = useState(false);

  return (
    <div
      data-adgen-panel
      className={`absolute bottom-4 top-4 z-[70] flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl ${shifted ? 'right-[360px]' : 'right-4'}`}
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
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPicking(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    >
                      <ArrowUpTrayIcon className="h-4 w-4" />
                      {content.value ? 'Replace' : 'Choose / upload'}
                    </button>
                    {content.value && (
                      <button
                        type="button"
                        onClick={() => onContentChange('')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-red-500/50 hover:text-red-500"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Clear image
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">{content.note}</p>
                )}
              </div>
            )}
          </PanelSection>
        )}

        {/* Brand logo — swap which of the account's logo variants this Logo
            element shows, without leaving the canvas. Picking a variant pins it;
            "Account default" restores the brand-managed logo. */}
        {el.type === 'logo' && brandLogos.length > 0 && (
          <PanelSection title="Brand logo">
            <div className="flex flex-wrap gap-2">
              {brandLogos.map((lg) => {
                const active = el.binding?.kind === 'static' && el.binding.value === lg.url;
                return (
                  <button
                    key={lg.key}
                    type="button"
                    title={lg.label}
                    onClick={() => onEl({ binding: { kind: 'static', value: lg.url } })}
                    className={`flex h-12 w-16 items-center justify-center overflow-hidden rounded-md border bg-[var(--muted)]/40 p-1 transition-colors ${
                      active ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)] hover:border-[var(--primary)]'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lg.url} alt={lg.label} className="max-h-full max-w-full object-contain" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => onEl({ binding: { kind: 'brand', key: 'logoUrl' } })}
              className={`mt-2 text-[11px] font-medium transition-colors ${
                el.binding?.kind === 'brand' ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {el.binding?.kind === 'brand' ? '✓ Using account default' : 'Reset to account default'}
            </button>
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

        {el.type === 'background' && (() => {
          const baseGrad = toGradientFill(el);
          const overlayGrad = el.overlay ? toGradientFill({ gradientFill: el.overlay }) : null;
          const fadeSeed = { type: 'linear' as const, angle: 180, stops: [{ color: '#ffffff', pos: 0 }, { color: '#ffffff', pos: 100, opacity: 0 }] };
          return (
            <>
              {/* Base fill — solid or gradient (absorbs the old canvas background). */}
              <PanelSection title="Fill">
                {baseGrad ? (
                  <GradientEditor value={baseGrad} onChange={(g) => onEl({ gradientFill: g, gradient: undefined, gradientAngle: undefined, gradientStops: undefined })} />
                ) : (
                  <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    Color
                    <ColorSwatchInput title="Base color" value={el.fill && el.fill !== 'brand' ? el.fill : '#199fdb'} onChange={(v) => onEl({ fill: v })} />
                  </label>
                )}
                <button type="button" onClick={() => onEl(baseGrad ? clearGradientPatch : seedGradientPatch(el.fill))} className="mt-2 text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80">
                  {baseGrad ? 'Use a solid color' : 'Use a gradient'}
                </button>
              </PanelSection>
              {/* Texture — pick in the Content section above; frame it here. */}
              <PanelSection title="Texture">
                <div className="flex items-center gap-1">
                  <BarBtn title="Fit (contain)" active={el.fit === 'contain'} onClick={() => onEl({ fit: 'contain' })}>
                    <ArrowsPointingInIcon className="h-4 w-4" />
                  </BarBtn>
                  <BarBtn title="Fill (cover)" active={(el.fit ?? 'cover') === 'cover'} onClick={() => onEl({ fit: 'cover' })}>
                    <ArrowsPointingOutIcon className="h-4 w-4" />
                  </BarBtn>
                  <BarBtn title="Tile (repeat texture)" active={el.fit === 'tile'} onClick={() => onEl({ fit: 'tile' })}>
                    <span className="grid grid-cols-2 gap-[1.5px]">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="h-1.5 w-1.5 rounded-[1px] bg-current" />
                      ))}
                    </span>
                  </BarBtn>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {el.fit === 'tile' && (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                      Tile size
                      <MiniNum
                        title="Tile size (% of width)"
                        value={Math.round((el.tileScale ?? 0.25) * 100)}
                        step={5}
                        onChange={(v) => {
                          const n = Math.max(2, Math.min(100, Math.round(v)));
                          onEl({ tileScale: Number((n / 100).toFixed(3)) });
                        }}
                      />
                      <span className="text-[11px]">%</span>
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    Opacity
                    <MiniNum
                      title="Texture opacity (%)"
                      value={el.bgImageOpacity ?? 100}
                      step={5}
                      onChange={(v) => {
                        const n = Math.max(0, Math.min(100, Math.round(v)));
                        onEl({ bgImageOpacity: n >= 100 ? undefined : n });
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">Pick a texture in the Content section above — the Textures tab has your brand patterns.</p>
              </PanelSection>
              {/* Fade — a gradient overlay on top (e.g. white→transparent scrim). */}
              <PanelSection title="Fade">
                {overlayGrad ? (
                  <>
                    <GradientEditor value={overlayGrad} onChange={(g) => onEl({ overlay: g })} />
                    <button type="button" onClick={() => onEl({ overlay: undefined })} className="mt-2 text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80">
                      Remove fade
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => onEl({ overlay: fadeSeed })} className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80">
                    Add a fade
                  </button>
                )}
              </PanelSection>
            </>
          );
        })()}

        {el.type === 'shape' && (() => {
          const kind = el.shapeKind ?? 'rect';
          const grad = toGradientFill(el);
          const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star'] as const;
          return (
          <PanelSection title="Shape">
            <FillArtboardButton onClick={onFillArtboard} />
            {/* Silhouette picker — each swatch previews its own clip-path. */}
            <div className="mb-3 flex items-center gap-1">
              {SHAPES.map((k) => (
                <BarBtn key={k} title={k[0].toUpperCase() + k.slice(1)} active={kind === k} onClick={() => onEl({ shapeKind: k === 'rect' ? undefined : k })}>
                  <span
                    className="h-3.5 w-3.5 bg-current"
                    style={{ clipPath: SHAPE_CLIP[k], borderRadius: k === 'ellipse' ? '50%' : k === 'rect' ? '2px' : undefined }}
                  />
                </BarBtn>
              ))}
            </div>
            {/* Fill — solid or a multi-stop gradient (linear/radial, per-stop alpha). */}
            {grad ? (
              <GradientEditor value={grad} onChange={(g) => onEl({ gradientFill: g, gradient: undefined, gradientAngle: undefined, gradientStops: undefined })} />
            ) : (
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Fill
                <ColorSwatchInput title="Fill" value={el.fill && el.fill !== 'brand' ? el.fill : '#4f46e5'} onChange={(v) => onEl({ fill: v })} />
              </label>
            )}
            <button
              type="button"
              onClick={() => onEl(grad ? clearGradientPatch : seedGradientPatch(el.fill))}
              className="mt-2 text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
            >
              {grad ? 'Use a solid color' : 'Use a gradient'}
            </button>
            {/* Corner radius only applies to a plain rectangle. */}
            {kind === 'rect' && (
              <label className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                Radius
                <MiniNum title="Corner radius (px)" value={el.radius ?? 0} onChange={(v) => onEl({ radius: v ? Math.round(v) : undefined })} />
              </label>
            )}
            {/* Opacity + blend — composite the shape over what's beneath it. */}
            <CompositeControls el={el} onEl={onEl} />
          </PanelSection>
          );
        })()}

        {(el.type === 'image' || el.type === 'logo') && (
          <PanelSection title="Image">
            {el.type === 'image' && <FillArtboardButton onClick={onFillArtboard} />}
            <div className="flex items-center gap-1">
              <BarBtn title="Fit (contain)" active={(el.fit ?? 'contain') === 'contain'} onClick={() => onEl({ fit: 'contain' })}>
                <ArrowsPointingInIcon className="h-4 w-4" />
              </BarBtn>
              <BarBtn title="Fill (cover)" active={el.fit === 'cover'} onClick={() => onEl({ fit: 'cover' })}>
                <ArrowsPointingOutIcon className="h-4 w-4" />
              </BarBtn>
              <BarBtn title="Tile (repeat texture)" active={el.fit === 'tile'} onClick={() => onEl({ fit: 'tile' })}>
                <span className="grid grid-cols-2 gap-[1.5px]">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-[1px] bg-current" />
                  ))}
                </span>
              </BarBtn>
              {/* Crop — flips to Fill (cover) if needed, then lets the designer
                  drag the image on the canvas + zoom in. Toggles crop mode. */}
              <button
                type="button"
                onClick={onToggleCrop}
                title="Crop — drag the image on the canvas to reposition"
                aria-pressed={cropping}
                className={`ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  cropping
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
                }`}
              >
                <CropIcon className="h-4 w-4" />
                {cropping ? 'Done' : 'Crop'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                Radius
                <MiniNum title="Corner radius (px)" value={el.radius ?? 0} onChange={(v) => onEl({ radius: v > 0 ? Math.round(v) : undefined })} />
              </label>
              {el.fit === 'tile' && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  Tile size
                  <MiniNum
                    title="Tile size (% of width)"
                    value={Math.round((el.tileScale ?? 0.25) * 100)}
                    step={5}
                    onChange={(v) => {
                      const n = Math.max(2, Math.min(100, Math.round(v)));
                      onEl({ tileScale: Number((n / 100).toFixed(3)) });
                    }}
                  />
                  <span className="text-[11px]">%</span>
                </label>
              )}
            </div>
            {/* Opacity + blend — lets an image tint/knock back a layer below it. */}
            <CompositeControls el={el} onEl={onEl} />
            {cropping && (
              // Crop mode — the box IS the crop window. Drag the image on the
              // canvas to reposition; zoom scales it in; X/Y are precise framing.
              <div className="mt-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    Zoom
                    <MiniNum
                      title="Crop zoom (%) — 100 = fit, higher crops in"
                      value={Math.round((box.objectScale ?? 1) * 100)}
                      step={10}
                      onChange={(v) => {
                        const s = Math.max(100, Math.min(400, v)) / 100;
                        onBox({ objectScale: s > 1 ? +s.toFixed(2) : undefined });
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    X
                    <MiniNum
                      title="Horizontal framing (%) — 0 = left, 100 = right"
                      value={Math.round((box.objectX ?? 0.5) * 100)}
                      step={5}
                      onChange={(v) => onBox({ objectX: Math.max(0, Math.min(100, v)) / 100 })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    Y
                    <MiniNum
                      title="Vertical framing (%) — 0 = top, 100 = bottom"
                      value={Math.round((box.objectY ?? 0.5) * 100)}
                      step={5}
                      onChange={(v) => onBox({ objectY: Math.max(0, Math.min(100, v)) / 100 })}
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">Drag the image on the canvas to reposition. Resize the box to change the crop shape.</p>
                  <button
                    type="button"
                    onClick={() => onBox({ objectX: undefined, objectY: undefined, objectScale: undefined })}
                    className="flex-shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </PanelSection>
        )}
      </div>

      {picking && (
        <MediaPickerModal
          accountKey={accountKey}
          showCategories
          showFolders
          brandingMedia={brandLogos.map((l) => ({ label: `${l.label} logo`, url: l.url }))}
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
/** "Fill artboard & send to back" — turns an Image/Shape into a full-bleed
 *  background layer on every size (the convenience that replaced the dedicated
 *  Background element). */
function FillArtboardButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Resize to fill the artboard on every size and move behind everything"
      className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
    >
      <SwatchIcon className="h-3.5 w-3.5" /> Fill artboard &amp; send to back
    </button>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</div>
      {children}
    </div>
  );
}

/** An icon button in the left rail — opens its panel as a flyout. */
function RailButton({ label, Icon, active, onClick, primary, activeClassName, noTooltip }: { label: string; Icon: React.ComponentType<{ className?: string }>; active: boolean; onClick: () => void; primary?: boolean; activeClassName?: string; noTooltip?: boolean }) {
  // `primary` = the marquee action (Insert): solid brand fill so it stands out
  // from the secondary rail buttons, regardless of open/closed state.
  // `activeClassName` overrides the active style (e.g. an icon-only color for the
  // view-guide toggles) instead of the default brand-tinted background.
  // `noTooltip` skips the hover tooltip (e.g. Margins, which shows its own popup).
  const cls = primary
    ? 'bg-[var(--primary)] text-white shadow-sm hover:opacity-90'
    : active
      ? activeClassName ?? 'bg-[var(--primary)]/15 text-[var(--primary)]'
      : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]';
  const btn = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${cls}`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
  return noTooltip ? btn : <SidebarTooltip label={label}>{btn}</SidebarTooltip>;
}

/** Renders a detached element's actual content in the (unclipped) canvas
 *  overlay — the artboard iframe clips anything off-canvas, so a parked element
 *  would otherwise be invisible. Best-effort fidelity (text / image / shape). */
function DetachedVisual({
  el,
  box,
  scale,
  previewData,
  resolveUrl,
}: {
  el: DocElement;
  box: DocLayoutBox;
  scale: number;
  previewData: AdData;
  resolveUrl: (el: DocElement | null | undefined) => string | null;
}) {
  const brand = typeof previewData.brandColor === 'string' ? previewData.brandColor : '#4f46e5';
  if (el.type === 'background') {
    const g = toGradientFill(el);
    const base = g ? gradientPreviewCss(g) : el.fill === 'brand' ? brand : el.fill || '#199fdb';
    const ov = el.overlay ? gradientPreviewCss(el.overlay) : null;
    return (
      <span className="pointer-events-none absolute inset-0" style={{ background: base }}>
        {ov && <span className="absolute inset-0" style={{ background: ov }} />}
      </span>
    );
  }
  if (el.type === 'shape') {
    const kind = el.shapeKind ?? 'rect';
    const g = toGradientFill(el);
    const fill = g
      ? gradientPreviewCss(g)
      : el.fill === 'brand'
        ? brand
        : el.fill || '#4f46e5';
    return (
      <span
        className="pointer-events-none absolute inset-0"
        style={{ background: fill, clipPath: SHAPE_CLIP[kind], borderRadius: kind === 'ellipse' ? '50%' : el.radius ?? 0 }}
      />
    );
  }
  if (el.type === 'image' || el.type === 'logo') {
    const url = resolveUrl(el);
    return url ? (
      el.fit === 'tile' ? (
      <span
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: `url(${url})`, backgroundRepeat: 'repeat', backgroundSize: `${Math.max(2, (el.tileScale ?? 0.25) * 100)}% auto`, borderRadius: el.radius ?? 0 }}
      />
      ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" style={{ objectFit: el.fit === 'cover' ? 'cover' : 'contain', borderRadius: el.radius ?? 0 }} />
      )
    ) : (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">{el.type === 'logo' ? 'Logo' : 'Image'}</span>
    );
  }
  const val = el.binding?.kind === 'static' ? el.binding.value : el.binding ? String(previewData[el.binding.key] ?? el.binding.key) : 'Text';
  const color = el.color === 'brand' ? (typeof previewData.brandColor === 'string' ? previewData.brandColor : '#111827') : el.color || '#111827';
  return (
    <span
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        color,
        fontSize: (box.fontSize ?? 16) * scale,
        fontWeight: el.fontWeight,
        lineHeight: el.lineHeight ?? 1.1,
        letterSpacing: el.letterSpacing ? el.letterSpacing * scale : undefined,
        textTransform: el.uppercase ? 'uppercase' : undefined,
        textAlign: el.align ?? 'left',
        fontFamily: el.fontFamily || undefined,
      }}
    >
      {val}
    </span>
  );
}

type Adder = { label: string; Icon: React.ComponentType<{ className?: string }>; onAdd: () => void };

/** The element palette — a grid of tiles that drop an element on the canvas.
 *  Shared by the Insert flyout (`panel`) and the empty-canvas onboarding
 *  (`onboarding`); `variant` only tunes density. */
function AdderGrid({ adders, variant }: { adders: Adder[]; variant: 'panel' | 'onboarding' }) {
  const cols = variant === 'panel' ? 'grid-cols-2' : 'grid-cols-5';
  const tile = variant === 'panel' ? 'justify-center gap-2 py-5 text-xs' : 'gap-1.5 py-2.5 text-[10px]';
  const icon = variant === 'panel' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <div className={`grid ${cols} gap-2`}>
      {adders.map((a) => (
        <button
          key={a.label}
          onClick={a.onAdd}
          className={`group flex flex-col items-center rounded-xl border border-[var(--border)] px-2 font-medium text-[var(--foreground)] transition-all hover:-translate-y-0.5 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 hover:shadow-sm ${tile}`}
        >
          <a.Icon className={`${icon} text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--primary)]`} />
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

/** Read whichever gradient model a shape/background carries into the editable
 *  `GradientFill` shape — the new `gradientFill` wins; a legacy two-stop
 *  `gradient`/`gradientAngle`/`gradientStops` is upconverted so old templates
 *  open in the new editor. Returns null when there's no gradient. */
function toGradientFill(src: {
  gradientFill?: GradientFill;
  gradient?: [string, string];
  gradientAngle?: number;
  gradientStops?: [number, number];
} | undefined): GradientFill | null {
  if (src?.gradientFill?.stops && src.gradientFill.stops.length >= 2) return src.gradientFill;
  if (src?.gradient) {
    const gs = src.gradientStops;
    return {
      type: 'linear',
      angle: src.gradientAngle ?? 135,
      stops: [
        { color: src.gradient[0], pos: gs?.[0] ?? 0 },
        { color: src.gradient[1], pos: gs?.[1] ?? 100 },
      ],
    };
  }
  return null;
}

/** Patch that switches a fill to a seeded gradient, clearing the legacy fields
 *  so only `gradientFill` remains authoritative. `from` seeds the first stop. */
function seedGradientPatch(from?: string): {
  gradientFill: GradientFill;
  gradient: undefined;
  gradientAngle: undefined;
  gradientStops: undefined;
} {
  const c = from && from !== 'brand' ? from : '#ffffff';
  return {
    gradientFill: { type: 'linear', angle: 135, stops: [{ color: c, pos: 0 }, { color: '#1e293b', pos: 100 }] },
    gradient: undefined,
    gradientAngle: undefined,
    gradientStops: undefined,
  };
}

/** Patch that clears every gradient field (→ back to a solid fill). */
const clearGradientPatch = { gradientFill: undefined, gradient: undefined, gradientAngle: undefined, gradientStops: undefined } as const;

/** CSS for a single stop in a client-side preview (folds opacity into rgba). */
function stopPreviewCss(s: GradientStop): string {
  const pct = s.opacity == null ? 100 : Math.max(0, Math.min(100, s.opacity));
  const h = (s.color || '#000').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (pct < 100 && /^[0-9a-fA-F]{6}$/.test(full)) {
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${(pct / 100).toFixed(2)}) ${s.pos}%`;
  }
  return `${s.color} ${s.pos}%`;
}

/** Build a preview CSS gradient string from a GradientFill (client-side twin of
 *  the renderer's buildGradientCss, minus brand resolution). */
function gradientPreviewCss(g: GradientFill): string {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map(stopPreviewCss).join(', ');
  return (g.type ?? 'linear') === 'radial'
    ? `radial-gradient(${g.radialShape ?? 'ellipse'} at ${g.center?.[0] ?? 50}% ${g.center?.[1] ?? 50}%, ${stops})`
    : `linear-gradient(${g.angle ?? 135}deg, ${stops})`;
}

const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

/**
 * Multi-stop gradient editor — linear/radial, per-stop color + position +
 * opacity, add/remove stops. Writes a full {@link GradientFill}; callers fold
 * the returned value into the element/background and clear the legacy fields.
 * This is the primitive that lets designers build layered fades (Subaru-style
 * white→transparent scrims over a texture) natively.
 */
function GradientEditor({ value, onChange }: { value: GradientFill; onChange: (g: GradientFill) => void }) {
  const type = value.type ?? 'linear';
  const stops = value.stops;
  const setStop = (i: number, patch: Partial<GradientStop>) =>
    onChange({ ...value, stops: stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const addStop = () => {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const mid = Math.round((sorted[0].pos + sorted[sorted.length - 1].pos) / 2);
    onChange({ ...value, stops: [...stops, { color: sorted[sorted.length - 1].color, pos: mid }] });
  };
  const removeStop = (i: number) => {
    if (stops.length <= 2) return;
    onChange({ ...value, stops: stops.filter((_, idx) => idx !== i) });
  };
  return (
    <div className="space-y-3">
      {/* Live preview bar. */}
      <div className="h-6 w-full rounded-md border border-[var(--border)]" style={{ background: gradientPreviewCss(value) }} />
      {/* Type: linear / radial. */}
      <div className="flex items-center gap-1">
        <BarBtn title="Linear" active={type === 'linear'} onClick={() => onChange({ ...value, type: 'linear' })}>
          <span className="text-[10px] font-semibold leading-none">Linear</span>
        </BarBtn>
        <BarBtn title="Radial" active={type === 'radial'} onClick={() => onChange({ ...value, type: 'radial' })}>
          <span className="text-[10px] font-semibold leading-none">Radial</span>
        </BarBtn>
      </div>
      {type === 'linear' ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">Angle</span>
            <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{value.angle ?? 135}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={value.angle ?? 135}
            onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
            aria-label="Gradient angle"
            className="range-slider"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            <BarBtn title="Ellipse" active={(value.radialShape ?? 'ellipse') === 'ellipse'} onClick={() => onChange({ ...value, radialShape: 'ellipse' })}>
              <span className="h-3.5 w-4 rounded-[50%] border border-current" />
            </BarBtn>
            <BarBtn title="Circle" active={value.radialShape === 'circle'} onClick={() => onChange({ ...value, radialShape: 'circle' })}>
              <span className="h-3.5 w-3.5 rounded-full border border-current" />
            </BarBtn>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            X
            <MiniNum title="Center X (%)" value={value.center?.[0] ?? 50} step={5} onChange={(v) => onChange({ ...value, center: [Math.max(0, Math.min(100, v)), value.center?.[1] ?? 50] })} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            Y
            <MiniNum title="Center Y (%)" value={value.center?.[1] ?? 50} step={5} onChange={(v) => onChange({ ...value, center: [value.center?.[0] ?? 50, Math.max(0, Math.min(100, v))] })} />
          </label>
        </div>
      )}
      {/* Stops. */}
      <div className="space-y-1.5">
        <span className="text-xs text-[var(--muted-foreground)]">Stops</span>
        {stops.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <ColorSwatchInput title={`Stop ${i + 1} color`} value={s.color && s.color !== 'brand' ? s.color : '#ffffff'} onChange={(v) => setStop(i, { color: v })} />
            <label className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]" title="Position along the gradient (%)">
              <MiniNum title="Position (%)" value={s.pos} step={5} onChange={(v) => setStop(i, { pos: Math.max(0, Math.min(100, Math.round(v))) })} />
              <span>%</span>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]" title="Stop opacity (%) — lower fades to transparent">
              <MiniNum title="Opacity (%)" value={s.opacity ?? 100} step={5} onChange={(v) => { const n = Math.max(0, Math.min(100, Math.round(v))); setStop(i, { opacity: n >= 100 ? undefined : n }); }} />
              <span>α</span>
            </label>
            <button
              type="button"
              onClick={() => removeStop(i)}
              disabled={stops.length <= 2}
              title="Remove stop"
              aria-label="Remove stop"
              className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addStop} className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80">
          + Add stop
        </button>
      </div>
    </div>
  );
}

/** Opacity + blend-mode row — the compositing controls shared by shapes and
 *  images so a fill/overlay can tint or knock back what's beneath it. */
function CompositeControls({ el, onEl }: { el: DocElement; onEl: (patch: Partial<DocElement>) => void }) {
  return (
    <div className="mt-3 space-y-2.5">
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
      <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
        Blend
        <SearchableSelect
          value={el.blendMode ?? 'normal'}
          onChange={(v) => onEl({ blendMode: v === 'normal' ? undefined : (v as BlendMode) })}
          options={BLEND_OPTIONS}
          className="w-32"
        />
      </label>
    </div>
  );
}

/**
 * A single non-editable board in multi-artboard view — the same `renderDoc` the
 * canvas/export use (WYSIWYG), rendered at the shared canvas `scale` so it lines
 * up with the editable frame. Click it to make it the active editable board.
 */
function PreviewBoard({
  doc,
  previewData,
  size,
  scale,
  order,
  onActivate,
}: {
  doc: TemplateDoc;
  previewData: AdData;
  size: AdSize;
  scale: number;
  order: number;
  onActivate: () => void;
}) {
  // Render this size's HTML once per (doc, previewData, size) — it feeds an
  // <iframe srcDoc>, so recomputing on every zoom tick would reload the iframe.
  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ order }}>
      <button
        type="button"
        onClick={onActivate}
        title={`Edit ${size.label}`}
        className="group relative block overflow-hidden rounded-md shadow-[0_12px_48px_-8px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/10 transition hover:ring-2 hover:ring-[var(--primary)]"
        style={{ width: size.width * scale, height: size.height * scale }}
      >
        <iframe
          title={size.label}
          srcDoc={html}
          tabIndex={-1}
          style={{ width: size.width, height: size.height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        />
        <span className="pointer-events-none absolute inset-0 transition-colors group-hover:bg-[var(--primary)]/5" />
      </button>
      <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
        {size.label.split(' ')[0]} <span className="tabular-nums opacity-70">{size.width}×{size.height}</span>
      </span>
    </div>
  );
}

/** Size management — switch / add / remove / duplicate-layout across the ad's
 *  sizes. Rendered as a popover on the canvas action bar (bottom); the catalog +
 *  custom-size form live here so all size actions sit with the size switcher. */
function SizesManager({
  doc,
  sizeId,
  sizeLabel,
  setSizeId,
  removeSize,
  addSize,
  createLibrarySize,
  copyLayoutFrom,
  libSizes,
  addSizeOpen,
  setAddSizeOpen,
  customName,
  setCustomName,
  customW,
  setCustomW,
  customH,
  setCustomH,
  onClose,
  viewAll,
  onViewAll,
}: {
  doc: TemplateDoc;
  sizeId: string;
  sizeLabel: string;
  setSizeId: (id: string) => void;
  removeSize: (id: string) => void;
  addSize: (label: string, width: number, height: number) => void;
  createLibrarySize: () => void;
  copyLayoutFrom: (id: string) => void;
  libSizes: { id: string; name: string; width: number; height: number }[];
  addSizeOpen: boolean;
  setAddSizeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  customName: string;
  setCustomName: (v: string) => void;
  customW: string;
  setCustomW: (v: string) => void;
  customH: string;
  setCustomH: (v: string) => void;
  onClose: () => void;
  viewAll: boolean;
  onViewAll: () => void;
}) {
  // Mini canvas fill for the ratio previews — mirrors the renderer's base fill.
  const bg = doc.background;
  const previewFill = bg?.gradient
    ? `linear-gradient(${bg.gradientAngle ?? 135}deg, ${bg.gradient[0]}, ${bg.gradient[1]})`
    : bg?.color && bg.color !== 'brand'
      ? bg.color
      : '#ffffff';

  // Multiselect for the Add catalog — accumulate picks, add them all at once.
  const [picked, setPicked] = useState<Record<string, { name: string; width: number; height: number }>>({});
  const pickKey = (name: string, w: number, h: number) => `${name}:${w}x${h}`;
  const togglePick = (name: string, w: number, h: number) =>
    setPicked((prev) => {
      const k = pickKey(name, w, h);
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = { name, width: w, height: h };
      return next;
    });
  const pickedCount = Object.keys(picked).length;
  const addPicked = () => {
    Object.values(picked).forEach((s) => addSize(s.name, s.width, s.height));
    setPicked({});
    setAddSizeOpen(false);
  };
  // A ratio-accurate swatch (long edge = `long` px) for a catalog/list entry.
  const ratioSwatch = (w: number, h: number, long: number, extraClass = '') => {
    const tw = w >= h ? long : Math.round((long * w) / h);
    const th = h >= w ? long : Math.round((long * h) / w);
    return <span className={`rounded-[2px] border border-[var(--border)] ${extraClass}`} style={{ width: tw, height: th, background: previewFill }} />;
  };
  // A selectable catalog/library tile (checkbox-style multiselect + ratio).
  const catalogTile = (name: string, w: number, h: number) => {
    const sel = !!picked[pickKey(name, w, h)];
    return (
      <button
        key={`${name}:${w}x${h}`}
        onClick={() => togglePick(name, w, h)}
        aria-pressed={sel}
        className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${sel ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center">{ratioSwatch(w, h, 30)}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-xs font-medium ${sel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{name}</span>
          <span className="block text-[10px] tabular-nums text-[var(--muted-foreground)]">{w}×{h}</span>
        </span>
        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border ${sel ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--muted-foreground)]/50'}`}>
          {sel && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
        </span>
      </button>
    );
  };
  return (
    <section
      onPointerDown={(e) => e.stopPropagation()}
      className="flex max-h-[85vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-2xl backdrop-blur-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <DashboardLayoutIcon className="h-4 w-4" />
          Sizes
        </h2>
        <div className="flex items-center gap-1.5">
          <Link href="/ad-generator/sizes" className="text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]">
            Library
          </Link>
          <button
            onClick={() => setAddSizeOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3 w-3" />
            Add
          </button>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Lay every size out together on one canvas. */}
      {doc.sizes.length > 1 && !viewAll && (
        <button
          onClick={onViewAll}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <Squares2X2Icon className="h-4 w-4" />
          View all sizes together
        </button>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {doc.sizes.map((s) => {
          const count = Object.keys(doc.layouts[s.id] ?? {}).length;
          const active = s.id === sizeId;
          // A ratio-accurate swatch (max 44px on the long edge) so each size is
          // recognizable at a glance without reading the dimensions.
          const long = 44;
          const tw = s.width >= s.height ? long : Math.round((long * s.width) / s.height);
          const th = s.height >= s.width ? long : Math.round((long * s.height) / s.width);
          return (
            <div key={s.id} className={`flex items-center gap-1 rounded-lg pr-1 transition-colors ${active ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/60'}`}>
              <button
                onClick={() => {
                  setSizeId(s.id);
                  onClose();
                }}
                className="flex flex-1 items-center gap-3 px-2 py-2 text-left"
              >
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
                  <span
                    className={`rounded-[3px] border shadow-sm ${active ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}
                    style={{ width: tw, height: th, background: previewFill }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-medium ${active ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{s.label}</span>
                  <span className="block text-[10px] text-[var(--muted-foreground)]">
                    {s.width}×{s.height} · {count} {count === 1 ? 'layer' : 'layers'}
                  </span>
                </span>
              </button>
              {doc.sizes.length > 1 && (
                <button onClick={() => removeSize(s.id)} title="Remove size" className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500">
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {addSizeOpen && (
        <div className="mt-2 flex min-h-0 flex-col rounded-lg border border-dashed border-[var(--border)]">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
            <p className="text-[11px] text-[var(--muted-foreground)]">Select one or more sizes to add, then hit Add.</p>
            {/* Standard catalog, grouped by category — multiselect w/ ratio previews */}
            {catalogByCategory().map((grp) => (
              <div key={grp.category}>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{grp.label}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {grp.sizes.map((p) => catalogTile(p.name, p.width, p.height))}
                </div>
              </div>
            ))}

            {/* Custom sizes from the shared library (added on top of the catalog) */}
            {libSizes.length > 0 && (
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Custom</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {libSizes.map((s) => catalogTile(s.name, s.width, s.height))}
                </div>
              </div>
            )}

            {/* Create a brand-new size — saved to the library + added here */}
            <div className="space-y-1.5 border-t border-[var(--border)] pt-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Custom size</div>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="New size name (e.g. Wide Banner)"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  placeholder="W"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <span className="text-[var(--muted-foreground)]">×</span>
                <input
                  type="number"
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createLibrarySize()}
                  placeholder="H"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <button
                  onClick={createLibrarySize}
                  title="Save to the size library and add it here"
                  className="flex-shrink-0 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
          {/* Add-selected footer — always visible below the scroll area. */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-2">
            <span className="text-[11px] text-[var(--muted-foreground)]">{pickedCount ? `${pickedCount} selected` : 'None selected'}</span>
            <button
              onClick={addPicked}
              disabled={!pickedCount}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Add {pickedCount || ''} {pickedCount === 1 ? 'size' : 'sizes'}
            </button>
          </div>
        </div>
      )}

      {doc.sizes.length > 1 && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <label className="mb-1.5 block text-[11px] text-[var(--muted-foreground)]">Copy layout into {sizeLabel.split(' ')[0]} from</label>
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
        [`${mod} D`, 'Duplicate'],
        [`${mod} G`, 'Group selection'],
        [`${mod} ⇧ G`, 'Ungroup'],
        [`${mod} ]`, 'Bring forward'],
        [`${mod} [`, 'Send back'],
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

