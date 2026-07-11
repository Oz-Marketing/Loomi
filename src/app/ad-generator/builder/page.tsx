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

import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback, type CSSProperties, type ComponentType } from 'react';
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
  Square2StackIcon,
  Squares2X2Icon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  SwatchIcon,
  Cog6ToothIcon,
  PaintBrushIcon,
  RocketLaunchIcon,
  BookmarkSquareIcon,
  VariableIcon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  HashtagIcon,
  CalendarDaysIcon,
  ChevronUpDownIcon,
  FolderArrowDownIcon,
  ArrowUpRightIcon,
} from '@heroicons/react/24/outline';
import { BranchIcon } from '@/components/icons/branch';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { MediaPickerModal } from '@/components/media-picker-modal';
import { CropEditorModal, type CropRect } from '@/components/media/crop-editor-modal';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { renderDoc, SHAPE_CLIP } from '@/lib/ad-generator/doc-renderer';
import { availableCustomFonts, buildFontFaceCssFromUrls, usedFontFamilies } from '@/lib/ad-generator/fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { CornerBox, SpacingBox, NumberInput } from '@/lib/email/editor/PropertyControls';
import { GOOGLE_FONTS, googleFontsCssUrl, usedGoogleFontFamilies } from '@/lib/ad-generator/google-fonts';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import { singleOfferDoc, dualOfferDoc } from '@/lib/ad-generator/templates/offer-docs';
import { blankTemplateDoc } from '@/lib/ad-generator/doc-template';
import { DatePicker, type DateRange } from '@/components/ui/date-picker';
import { MultiSelect } from '@/components/ui/multi-select';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import { DeployTemplateModal } from '@/components/ad-generator/deploy-template-modal';
import { enrichOfferFields, OFFER_TYPES } from '@/lib/ad-generator/offer-text';
import { EVOX_MAKES } from '@/components/ad-generator/client-form/evox-makes';
import { vehicleOffer } from '@/lib/ad-generator/templates/vehicle-offer';
import { requiredFieldsFor, FIELD_LABELS, type OemOfferRule } from '@/lib/ad-generator/compliance';
import { buildLayerTree, flattenLayerTree, normalizeGroupZ, type LayerNode } from '@/lib/ad-generator/layer-tree';
import { TextElementIcon, ShapeElementIcon, ButtonElementIcon, DashboardLayoutIcon, LayersIcon, OutlinesIcon, MarginsIcon, CropIcon } from '@/components/ad-generator/builder-icons';
import { catalogByCategory } from '@/lib/ad-generator/ad-size-catalog';
import { useIndustries } from '@/lib/hooks/use-industries';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox, GradientFill, GradientStop, BlendMode, Binding } from '@/lib/ad-generator/doc-types';
import { isFieldVisible, isClientField, type FieldSpec, type FieldType, type AdData, type AdSize } from '@/lib/ad-generator/types';
import { buildBlockPayload, insertBlockIntoDoc, type BlockPayload } from '@/lib/ad-generator/blocks';
import { SearchableSelect, type SearchableSelectOption } from '@/components/flows/builder/SearchableSelect';

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
// Computed offer LABEL fields (`_offerLabel`, `_o2_offerLabel`) map to a
// free-text override field the offer engine honors — so double-clicking the
// rendered label edits the override (writes here) instead of the derived value.
const OFFER_LABEL_OVERRIDE: Record<string, string> = {
  _offerLabel: 'offerLabel',
  _o2_offerLabel: 'o2_offerLabel',
};

// ── Content-source binding picker ──
// The inspector's "Shows" control lets a designer point an element at a template
// field, a computed offer value, brand data, or a static literal — so a
// from-scratch layout can be wired to the offer engine (no code template needed).
// Options are encoded as `static` | `field:<key>` | `brand:<key>` strings.
const OFFER_TOKENS: { key: string; label: string }[] = [
  { key: '_offerLabel', label: 'Offer label' },
  { key: '_offerMain', label: 'Offer amount' },
  { key: '_offerTerms', label: 'Offer terms' },
];
const OFFER_TOKENS_O2: { key: string; label: string }[] = [
  { key: '_o2_offerLabel', label: 'Offer 2 label' },
  { key: '_o2_offerMain', label: 'Offer 2 amount' },
  { key: '_o2_offerTerms', label: 'Offer 2 terms' },
];

function bindingToSourceValue(b: Binding | undefined): string {
  if (!b || b.kind === 'static') return 'static';
  if (b.kind === 'field') return `field:${b.key}`;
  return `brand:${b.key}`;
}
function sourceValueToBinding(v: string, currentValue: string): Binding {
  if (v.startsWith('field:')) return { kind: 'field', key: v.slice(6) };
  if (v.startsWith('brand:')) return { kind: 'brand', key: v.slice(6) as 'dealerName' | 'logoUrl' | 'brandColor' };
  return { kind: 'static', value: currentValue };
}
/** Build the "Shows" options for an element: static, the template's compatible
 *  fields (grouped by their `group` so Offer 1 / Offer 2 / Vehicle / Legal read
 *  as clear sections), the computed offer tokens (text only), and brand data.
 *  Labels that collide across groups (e.g. "Vehicle" in both Offer 1 and Offer 2)
 *  are auto-suffixed with their group so the control is unambiguous open OR
 *  collapsed. */
function buildContentSources(el: DocElement, fields: FieldSpec[]): SearchableSelectOption[] {
  const isImage = el.type === 'image' || el.type === 'logo' || el.type === 'background';
  const hasO2 = fields.some((f) => f.key === 'o2_offerType');
  // Only surface the computed offer tokens when the template actually has the
  // offer question set — otherwise a blank/non-offer template lists Offer
  // label/amount/terms that resolve to nothing (confusing). They ride in with
  // the "Vehicle Offer" category starter (or the offer field kit).
  const hasOffer = fields.some((f) => f.key === 'offerType');
  const opts: SearchableSelectOption[] = [
    { value: 'static', label: isImage ? 'Fixed image' : 'Type it in', group: 'Custom' },
  ];
  for (const f of fields) {
    const fieldIsImage = f.type === 'image';
    if (isImage !== fieldIsImage) continue; // image elements ↔ image fields; text ↔ the rest
    opts.push({ value: `field:${f.key}`, label: f.label || f.key, group: f.group?.trim() || 'Fields' });
  }
  if (!isImage) {
    // Computed offer text — only when the template has the offer question set
    // (otherwise these tokens resolve to nothing). Name Offer 1's tokens
    // explicitly when a second offer exists.
    if (hasOffer) {
      const offer1Tokens = hasO2
        ? [
            { key: '_offerLabel', label: 'Offer 1 label' },
            { key: '_offerMain', label: 'Offer 1 amount' },
            { key: '_offerTerms', label: 'Offer 1 terms' },
          ]
        : OFFER_TOKENS;
      for (const t of offer1Tokens) opts.push({ value: `field:${t.key}`, label: t.label, group: 'Computed offer text' });
      if (hasO2) for (const t of OFFER_TOKENS_O2) opts.push({ value: `field:${t.key}`, label: t.label, group: 'Computed offer text' });
    }
    opts.push({ value: 'brand:dealerName', label: 'Dealer name', group: 'Brand' });
  } else {
    opts.push({ value: 'brand:logoUrl', label: 'Account logo', group: 'Brand' });
  }
  // Offer 1 and Offer 2 share identical field labels ("Vehicle", "Offer type").
  // Where a label collides, suffix ONLY the second-offer twin with its group
  // (e.g. "Vehicle · Offer 2") — offer-1/originals stay clean, and the collapsed
  // control reads unambiguously. Suffixing both would give silly "Vehicle · Vehicle".
  const counts = new Map<string, number>();
  for (const o of opts) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  for (const o of opts) {
    const isSecondOffer = o.value.startsWith('field:o2_') || o.value.startsWith('field:_o2_');
    if (isSecondOffer && (counts.get(o.label) ?? 0) > 1 && o.group) o.label = `${o.label} · ${o.group}`;
  }
  return opts;
}
// Make/OEM options for the template-settings picker — the shared EVOX make list,
// with a blank "None" so a template can be untagged.
const MAKE_OPTIONS: FontSelectOption[] = [{ value: '', label: 'None' }, ...EVOX_MAKES.map((m) => ({ value: m, label: m }))];
// Canonical field spec per key — the source for the compliance "insert" action.
const FIELD_SPEC_BY_KEY: Record<string, FieldSpec> = Object.fromEntries(vehicleOffer.fields.map((f) => [f.key, f]));
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
  { value: 'image', label: 'Image' },
];
// Per-type icon + color for the field-row header — mirrors the element KIND
// color-coding (Text = blue, Image = pink) so a designer scans field types at a
// glance; the other input types get their own distinct hues. Icons are drawn
// with currentColor, so a wrapping span sets the color.
const FIELD_TYPE_META: Record<FieldType, { Icon: ComponentType<{ className?: string }>; color: string }> = {
  text: { Icon: TextElementIcon, color: '#3b82f6' }, // blue (mirrors Text element)
  textarea: { Icon: Bars3BottomLeftIcon, color: '#6366f1' }, // indigo
  number: { Icon: HashtagIcon, color: '#f59e0b' }, // amber
  date: { Icon: CalendarDaysIcon, color: '#10b981' }, // emerald
  select: { Icon: ChevronUpDownIcon, color: '#06b6d4' }, // cyan
  color: { Icon: SwatchIcon, color: '#f43f5e' }, // rose
  image: { Icon: PhotoIcon, color: '#ec4899' }, // pink (mirrors Image element)
};
// Where an image field's picture comes from — lets a designer wire any image
// field to the vehicle-image API (EVOX) or keep it manual, per field.
const IMAGE_SOURCE_OPTIONS: FontSelectOption[] = [
  { value: 'manual', label: 'Manual (upload / library)' },
  { value: 'evox', label: 'Vehicle image (EVOX)' },
  { value: 'both', label: 'Both — manual + vehicle' },
];
// Who fills a field on the creative form — designer-set, replaces the old
// hardcoded client/manager split. Client = the client edits it; Internal =
// managers/designers only (hidden from clients).
const AUDIENCE_OPTIONS: FontSelectOption[] = [
  { value: 'client', label: 'Client' },
  { value: 'internal', label: 'Internal (you only)' },
];
// The subaccount branding-color slots surfaced as quick-pick swatches in every
// color popover (only those actually set on the account show).
const BRAND_COLOR_KEYS = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
] as const;
// The catch-all form section. A field with no explicit group resolves here, so
// no field is ever "ungrouped"; it's a normal renamable/deletable section.
const DEFAULT_GROUP = 'General';
// Per-browser opt-out for the "deleting a section deletes its fields" confirm.
const SKIP_DELETE_SECTION_KEY = 'adgen-skip-delete-section-confirm';
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

// Element colour coding, used everywhere an element is referenced (Insert
// palette, canvas selection outline + handles, Layers rows, the inspector type
// badge): Text = blue, Image = pink, Button = purple, Shape = orange. A
// "button" is a styled text element (a text el with a background pill).
type ElementKind = 'text' | 'image' | 'button' | 'shape' | 'logo';
const KIND_COLOR: Record<ElementKind, string> = {
  text: '#3b82f6', // blue
  image: '#ec4899', // pink
  button: '#a855f7', // purple
  shape: '#f97316', // orange
  logo: '#14b8a6', // teal
};
function elementKind(el: { type: DocElementType; bg?: string }): ElementKind {
  if (el.type === 'shape') return 'shape';
  if (el.type === 'logo') return 'logo';
  if (el.type === 'image' || el.type === 'background') return 'image';
  return el.bg ? 'button' : 'text'; // text with a pill background reads as a Button
}

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

/** Binary-search a Fit-to-box text node's font so its (wrapped) text is as large
 *  as fits the box's inner width AND height. Mirrors the FIT_SCRIPT injected for
 *  export — the builder writes the canvas via innerHTML, so scripts there don't
 *  run and the parent drives the fit. Measured via a Range (padding-agnostic). */
function fitTextNode(node: HTMLElement) {
  const win = node.ownerDocument?.defaultView;
  if (!win) return;
  const cs = win.getComputedStyle(node);
  const availW = node.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
  const availH = node.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
  if (availW <= 0 || availH <= 0) return;
  let lo = 1;
  let hi = Math.max(2, availH * 2);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    node.style.fontSize = `${mid}px`;
    const r = node.ownerDocument.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    if (rect.width <= availW + 0.5 && rect.height <= availH + 0.5) lo = mid;
    else hi = mid;
  }
  node.style.fontSize = `${lo}px`;
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

/**
 * Constrain a resize to the element's starting aspect ratio (Shift+drag), keeping
 * the anchor (the edge/corner opposite the dragged handle) fixed. Works in PIXEL
 * space (w is a fraction of canvas width, h of height, so their aspect only makes
 * sense once scaled by nw/nh). Edge handles adjust the perpendicular dimension
 * about the box center; corner handles drive off width and derive height.
 */
function lockAspect(handle: Handle, start: DocLayoutBox, box: DocLayoutBox, nw: number, nh: number): DocLayoutBox {
  if (handle === 'move') return box;
  const aspect = (start.w * nw) / (start.h * nh); // pixel w/h of the element
  if (!isFinite(aspect) || aspect <= 0) return box;

  // Pick the driving dimension, then derive the other to preserve aspect.
  let wpx = box.w * nw;
  let hpx = box.h * nh;
  if (handle === 'n' || handle === 's') {
    wpx = hpx * aspect; // vertical edge → height drives
  } else {
    hpx = wpx / aspect; // corners + horizontal edges → width drives
  }
  const w = Math.max(MIN_FRAC, wpx / nw);
  const h = Math.max(MIN_FRAC, hpx / nh);

  // Re-anchor so the opposite edge/corner stays put.
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  let x = box.x;
  let y = box.y;
  switch (handle) {
    case 'se': x = start.x; y = start.y; break;
    case 'sw': x = right - w; y = start.y; break;
    case 'ne': x = start.x; y = bottom - h; break;
    case 'nw': x = right - w; y = bottom - h; break;
    case 'e': x = start.x; y = cy - h / 2; break;
    case 'w': x = right - w; y = cy - h / 2; break;
    case 's': y = start.y; x = cx - w / 2; break;
    case 'n': y = bottom - h; x = cx - w / 2; break;
  }
  return { ...box, x, y, w, h };
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
  const { accountData, accountKey, accounts, isUnrestricted } = useAccount();
  const { prompt, confirm } = useLoomiDialog();
  // OEM rule for the template's make (drives the Fields-panel compliance checklist).
  const [oemRule, setOemRule] = useState<OemOfferRule | null>(null);

  // Reusable blocks (saved element clusters) available to insert here: global +
  // this account's own. `blockDraft` opens the save dialog with a built payload.
  type BlockRow = { id: string; name: string; accountKey: string | null; accountKeys: string[]; doc: BlockPayload };
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [blockDraft, setBlockDraft] = useState<BlockPayload | null>(null);

  // A brand-new template starts on an empty artboard (no starter layout). The
  // vehicle-offer doc is still a registered code template (opened via ?ad / ?
  // template), just not the blank-canvas default.
  const { doc, setDoc, undo, redo, canUndo, canRedo, reset: resetHistory } = useDocHistory(() => blankTemplateDoc('tmpl-blank', 'Untitled template'));
  // Pull the OEM rule for the template's make so the Fields panel can flag any
  // required field that's missing from the template. Cleared when no make is set.
  const docMake = doc.make?.trim() ?? '';
  useEffect(() => {
    if (!docMake) { setOemRule(null); return; }
    let cancelled = false;
    fetch(`/api/ad-generator/oem-rules?make=${encodeURIComponent(docMake)}`)
      .then((r) => (r.ok ? r.json() : { rule: null }))
      .then((d: { rule?: OemOfferRule | null }) => { if (!cancelled) setOemRule(d.rule ?? null); })
      .catch(() => { if (!cancelled) setOemRule(null); });
    return () => { cancelled = true; };
  }, [docMake]);
  // The Make/OEM tag + compliance checklist apply to Automotive templates: shown
  // when the template targets Automotive — explicitly selected, or the empty
  // "all vehicle-offer accounts" default (which includes Automotive).
  const templateIsAutomotive = (doc.industries ?? []).length === 0 || (doc.industries ?? []).includes('Automotive');
  // Compliance vs. the tagged make's OEM rule: per offer type, which required
  // fields are missing (absent, or not shown for that offer type). Surfaced as a
  // chip on the canvas action bar. Null when the template has no make.
  const compliance = useMemo(() => {
    if (!doc.make) return null;
    return OFFER_TYPES.map((t) => {
      const missing = requiredFieldsFor(t.value, oemRule).filter((k) => {
        const spec = doc.fields.find((f) => f.key === k);
        return !spec || !isFieldVisible(spec, { offerType: t.value });
      });
      return { type: t, missing };
    }).filter((r) => requiredFieldsFor(r.type.value, oemRule).length > 0);
  }, [doc.make, doc.fields, oemRule]);
  const complianceMissing = compliance ? compliance.reduce((n, r) => n + r.missing.length, 0) : 0;
  // Compliance "insert": add the required field to the template (making it visible
  // for that offer type, so the warning clears) and drop a text element bound to it
  // onto the artboard so the designer can place it.
  const insertComplianceField = (key: string, offerType: string) => {
    const id = `text-${rid()}`;
    setDoc((prev) => {
      const base = prev.fields.find((f) => f.key === key) ?? FIELD_SPEC_BY_KEY[key];
      // Ensure the field is present + shown for this offer type.
      const ensured =
        base && base.visibleWhen?.field === 'offerType' && !base.visibleWhen.in.includes(offerType)
          ? { ...base, visibleWhen: { ...base.visibleWhen, in: [...base.visibleWhen.in, offerType] } }
          : base;
      const fields = ensured
        ? prev.fields.some((f) => f.key === key)
          ? prev.fields.map((f) => (f.key === key ? ensured : f))
          : [...prev.fields, ensured]
        : prev.fields;
      const el: DocElement = { ...makeDefaultElement(id, 'text'), binding: { kind: 'field', key }, autoSize: true };
      const layouts = { ...prev.layouts };
      for (const sid of Object.keys(prev.layouts)) {
        const zs = Object.values(prev.layouts[sid]).map((b) => b.z ?? 0);
        layouts[sid] = { ...prev.layouts[sid], [id]: { x: 0.06, y: 0.06, w: 0.3, h: 0.08, z: (zs.length ? Math.max(...zs) : 0) + 1 } };
      }
      return { ...prev, fields, elements: [...prev.elements, el], layouts };
    });
    setSelectedIds([id]);
    toast.success(`Added ${FIELD_LABELS[key] ?? key}`);
  };
  const [sizeId, setSizeId] = useState(doc.sizes[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The group the user has "drilled into" via double-click (Figma-style): while
  // set, clicks act on individual members of this group instead of selecting the
  // whole group as a unit. Cleared when the selection leaves the group.
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  // Marquee (drag-to-select) rectangle in canvas fractions, while dragging the backdrop.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Live boxes for a group (multi-select) drag, keyed by element id.
  const [groupLive, setGroupLive] = useState<Record<string, DocLayoutBox> | null>(null);
  const selectOne = useCallback((id: string) => setSelectedIds([id]), []);
  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setFocusedGroupId(null);
  }, []);
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
  // Template Fields is a LEFT-docked panel (same shell as the element inspector),
  // so it can be open at the same time as the element/block settings panel on the
  // right. It shares the left slot with Insert/Layers (one at a time).
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
  // Template settings popover in the header cog (Industries + Second offer + Save as new).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Field PRESETS — a designer-managed registry of reusable field-sets (fields +
  // sections + defaults). Applying one seeds its fields (merge-missing) into the
  // current template; "Save current fields as a preset" upserts one. Lives in the
  // Fields sidebar (not tied to the library Category). "Vehicle Offer" ships
  // seeded with the offer question set. (Backed by the AdCategoryStarter table /
  // category-starters API — the store predates the "preset" rename.)
  type Preset = { name: string; fields: FieldSpec[]; defaults: Record<string, string> };
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    fetch('/api/ad-generator/category-starters')
      .then((r) => (r.ok ? r.json() : { starters: [] }))
      .then((j: { starters?: Preset[] }) => setPresets(j.starters ?? []))
      .catch(() => setPresets([]));
  }, []);
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
  // The builder autosaves, so tell the global unsaved-changes guard it's clean
  // whenever a save lands — otherwise the generic DOM dirty-tracker flags
  // "unsaved changes" forever (it never learns the autosave happened).
  const { markClean } = useUnsavedChanges();
  useEffect(() => {
    if (saveStatus === 'saved') markClean();
  }, [saveStatus, markClean]);
  // Guards the one-time `?template=<id>` deep-load (edit a template from the
  // Templates → Ads tab).
  const deepLinkedRef = useRef(false);

  // A NEW (unsaved) template inherits the active account's scope: building
  // inside a subaccount publishes ONLY to that subaccount; building on the
  // Admin account (accountKey null) publishes global ("All accounts"). A loaded
  // template keeps its own stored scope (loadTemplate sets both id + scope), so
  // we only sync while there's no template id and we're not in ad mode.
  useEffect(() => {
    if (!templateId && !adId) setScopeAccount(accountKey ?? null);
  }, [accountKey, templateId, adId]);

  const size = useMemo(() => doc.sizes.find((s) => s.id === sizeId) ?? doc.sizes[0], [doc, sizeId]);

  // Account custom fonts: drive both the dropdown and the @font-face the canvas
  // needs so a chosen family actually renders.
  // Admins get the roll-up (union of every subaccount's fonts); clients get only
  // the active account's own. Drives both the dropdown and the @font-face.
  const customFonts = useMemo(
    () => availableCustomFonts({ accountData, accounts, unrestricted: isUnrestricted }),
    [accountData, accounts, isUnrestricted],
  );
  // Embed ONLY the custom families the doc actually uses — not the whole
  // roll-up union (an admin's union is ~45 faces / ~MBs of base64, which bloated
  // the parent doc + the re-parsed iframe html and made the editor laggy). The
  // dropdown still lists every family (names are cheap); a font gets embedded
  // once it's applied to an element. Mirrors the Google-fonts `usedGoogleFontFamilies`.
  const customFamilySet = useMemo(() => new Set(customFonts.map((f) => f.family)), [customFonts]);
  const usedFamilies = useMemo(
    () => usedFontFamilies(doc.elements, [doc.defaults?.fontFamily, adData?.fontFamily]).filter((fam) => customFamilySet.has(fam)),
    [doc.elements, doc.defaults?.fontFamily, adData, customFamilySet],
  );
  const usedFamilyKey = usedFamilies.join('');
  const usedCustomFonts = useMemo(
    () => customFonts.filter((f) => customFamilySet.size && usedFamilies.includes(f.family)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customFonts, usedFamilyKey],
  );
  // URL-based @font-face (instant, but the srcdoc iframe drops these cross-origin
  // to CORS — our Spaces fonts send no CORS header, so this is really just a
  // placeholder; the embedded base64 below is what actually renders).
  const fontFaceCss = useMemo(() => buildFontFaceCssFromUrls(usedCustomFonts), [usedCustomFonts]);
  const [embeddedFontCss, setEmbeddedFontCss] = useState('');
  useEffect(() => {
    // Base64-embed only the used families — works on the Admin account too
    // (empty accountKey → the API unions every account's fonts for unrestricted
    // users, then narrows to `families`).
    if (usedFamilies.length === 0) {
      setEmbeddedFontCss('');
      return;
    }
    let cancelled = false;
    const qs = `accountKey=${encodeURIComponent(accountKey ?? '')}&families=${encodeURIComponent(usedFamilies.join('\n'))}`;
    fetch(`/api/ad-generator/fonts?${qs}`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, usedFamilyKey]);
  // URL faces + embedded faces (embedded last so it wins where present).
  const effectiveFontCss = [fontFaceCss, embeddedFontCss].filter(Boolean).join('\n');
  const fontOptions = useMemo<FontSelectOption[]>(
    () => [
      { value: '', label: 'Brand default' },
      ...[...new Set(customFonts.map((f) => f.family))].map((fam) => ({ value: fam, label: fam, group: 'Uploaded' })),
      ...GOOGLE_FONTS.map((f) => ({ value: f.family, label: f.family, group: f.category })),
      ...WEBSAFE_FONTS.map((fam) => ({ value: fam, label: fam, group: 'System' })),
    ],
    [customFonts],
  );

  // Load the curated Google Fonts (weight 400) in the PARENT document so each
  // option in the font dropdown previews in its own face. Only the CSS loads up
  // front; a family's file is fetched lazily when its option first renders.
  useEffect(() => {
    const families = GOOGLE_FONTS.map((f) => f.family);
    const links: HTMLLinkElement[] = [];
    for (let i = 0; i < families.length; i += 24) {
      const href = googleFontsCssUrl(families.slice(i, i + 24), [400]);
      if (!href) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.adgenFontPreview = '1';
      document.head.appendChild(link);
      links.push(link);
    }
    return () => links.forEach((l) => l.remove());
  }, []);

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

  const previewData = useMemo(() => {
    const base = enrichOfferFields({
      ...vehicleOfferPreviewData,
      ...doc.defaults, // designer-set default / preview values for fields
      ...(adData ?? {}), // ad mode: the ad's real content
      ...(effectiveFontCss ? { fontFaceCss: effectiveFontCss } : {}),
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
      ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
    });
    // Load only the Google families this doc actually uses into the canvas iframe.
    const googleUrl = googleFontsCssUrl(
      usedGoogleFontFamilies(doc.elements, typeof base.fontFamily === 'string' ? base.fontFamily : undefined),
    );
    return googleUrl ? { ...base, googleFontsUrl: googleUrl } : base;
  }, [accountData, effectiveFontCss, doc.defaults, doc.elements, adData]);

  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);

  // Patch the canvas iframe's document IN PLACE on every edit instead of swapping
  // `srcDoc` (which navigates the iframe → a white flash on every change). Replacing
  // documentElement.innerHTML keeps the same document (no navigation, no flash);
  // the iframe keeps a constant shell `srcDoc` so it always has a same-origin doc.
  // Driven by both this effect (on edits) and the iframe's onLoad (on (re)mount,
  // after the shell finishes loading — which otherwise clobbers an early write).
  // Hug text renders content-sized (width:max-content, auto height), but the
  // selection box/handles read the STORED box. Sync the stored box to the measured
  // element so the handles hug the text. Runs from writeFrame (after the iframe is
  // rewritten) — the reliable time to measure, vs. a commit-time rAF which fires
  // before the write effect. Keeps the align-anchored edge + vertical center fixed
  // (matching the renderer). Guarded (writes only on a real change) so it converges
  // in one pass and never loops or spams undo.
  const measureGlyphs = (idoc: Document, n: HTMLElement) => {
    // Measure the visible GLYPHS (via a Range), not just the CSS line-box: a tight
    // line-height lets tall glyphs/descenders spill past offsetHeight.
    let rw = 0;
    let rh = 0;
    try {
      const r = idoc.createRange();
      r.selectNodeContents(n);
      const rect = r.getBoundingClientRect();
      rw = rect.width;
      rh = rect.height;
    } catch {
      /* range best-effort */
    }
    return { w: Math.max(n.offsetWidth, rw), h: Math.max(n.offsetHeight, rh) };
  };
  const syncAutoBoxes = useCallback(() => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    // HUG text ([data-hug]) sizes to its glyphs, so its stored box (which drives
    // the handles) must track the text's width AND height, keeping the align edge +
    // vertical center fixed. Fit-to-box is a FIXED frame — never ressynced here.
    const measured = [...idoc.querySelectorAll<HTMLElement>('[data-hug]')]
      .map((n) => ({ id: n.getAttribute('data-el-id'), ...measureGlyphs(idoc, n) }))
      .filter((m): m is { id: string; w: number; h: number } => !!m.id && m.w > 0 && m.h > 0);
    if (!measured.length) return;
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      let changed = false;
      for (const m of measured) {
        const b = lay[m.id];
        if (!b) continue;
        const nw = clamp(m.w / size.width, 0.01, 1.5);
        const nh = clamp(m.h / size.height, 0.01, 1.5);
        const align = prev.elements.find((e) => e.id === m.id)?.align ?? 'left';
        const nx = align === 'center' ? b.x + b.w / 2 - nw / 2 : align === 'right' ? b.x + b.w - nw : b.x;
        const ny = b.y + b.h / 2 - nh / 2;
        if (Math.abs(nw - b.w) > 0.003 || Math.abs(nh - b.h) > 0.003 || Math.abs(nx - b.x) > 0.003 || Math.abs(ny - b.y) > 0.003) {
          lay[m.id] = { ...b, x: nx, y: ny, w: nw, h: nh };
          changed = true;
        }
      }
      return changed ? { ...prev, layouts: { ...prev.layouts, [size.id]: lay } } : prev;
    }, 'autoboxes');
  }, [size.id, size.width, size.height]);
  // Fit the font of every Fit-to-box text node so it fills its fixed frame (the
  // injected FIT_SCRIPT can't run in the builder — see writeFrame). Safe per write/drag/edit.
  const fitTextNodes = useCallback(() => {
    iframeRef.current?.contentDocument?.querySelectorAll<HTMLElement>('[data-fit]').forEach(fitTextNode);
  }, []);
  const writeFrame = useCallback(() => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc?.documentElement) return;
    const inner = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    idoc.documentElement.innerHTML = inner;
    // Fill pinned-width fonts + sync auto boxes to their text after layout and once
    // webfonts settle (correct metrics), so pinned text fills and handles hug even
    // after a font swap changes text metrics.
    fitTextNodes();
    requestAnimationFrame(() => { fitTextNodes(); syncAutoBoxes(); });
    idoc.fonts?.ready?.then(() => { fitTextNodes(); syncAutoBoxes(); }).catch(() => {});
  }, [html, fitTextNodes, syncAutoBoxes]);
  useEffect(() => {
    writeFrame();
  }, [writeFrame]);

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
  // Leaving the drilled-into group (selecting something outside it, or clearing)
  // exits that group so the next click selects a whole group again.
  useEffect(() => {
    if (!focusedGroupId) return;
    const stillInside = selectedIds.length > 0 && selectedIds.every((id) => ancestorChain(id).includes(focusedGroupId));
    if (!stillInside) setFocusedGroupId(null);
  }, [selectedIds, focusedGroupId, ancestorChain]);

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
  // Modal cropper (mirrors the media library): set boundaries on the image and
  // apply → server-side crop → the element points at the new cropped image.
  const [cropModal, setCropModal] = useState<{ id: string; url: string; name: string } | null>(null);
  const [cropSaving, setCropSaving] = useState(false);
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
    if (selected.type === 'shape') return { mode: 'none', value: '' };
    if (isImage) {
      if (!b) return { mode: 'image-edit', value: '' };
      const value = b.kind === 'static' ? b.value : String(previewData[b.key] ?? '');
      if (b.kind === 'brand') return { mode: 'image-readonly', value, note: 'Comes from the account brand.' };
      return { mode: 'image-edit', value };
    }
    // Text/button: authored as free text with {{variables}}. Any legacy
    // field/brand binding is surfaced as its token so it stays editable — and
    // converts to a static token string on first edit (see setSelectedContent).
    const text = !b ? '' : b.kind === 'static' ? b.value : `{{${b.key}}}`;
    return { mode: 'text-edit', value: text };
  }, [selected, previewData]);

  // "Shows" options for the selected element's Content source picker — its
  // template fields + computed offer tokens + brand data (see buildContentSources).
  const contentSources = useMemo<SearchableSelectOption[]>(
    () => (selected ? buildContentSources(selected, doc.fields) : []),
    [selected, doc.fields],
  );

  // Write the selected element's content back to its source: static → the literal,
  // field → that field's default (the form data the generator prefills).
  const setSelectedContent = useCallback(
    (v: string) => {
      if (!selected) return;
      const b = selected.binding;
      const id = selected.id;
      const isImage = selected.type === 'image' || selected.type === 'logo' || selected.type === 'background';
      // Text/button: always author as a STATIC token string. This is the fix for
      // the old footgun where a field-bound text element edited the FIELD's value
      // (letting you type {{leaseTerm}} INTO leaseTerm → self-reference). A text
      // box is now just free text with {{variables}} that resolve to live values.
      if (!isImage) {
        setDoc((prev) => ({ ...prev, elements: prev.elements.map((e) => (e.id === id ? { ...e, binding: { kind: 'static', value: v } } : e)) }), `content:${id}`);
        return;
      }
      // Image/logo: static → the URL literal; field → the field's default.
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
  // Computed `_offer*` text is derived from the offer inputs so it's read-only —
  // EXCEPT the offer LABEL, which has a free-text override field (`offerLabel` /
  // `o2_offerLabel`); editing that label inline writes the override (see
  // enrichOfferFields). Brand-bound text stays read-only.
  const textEditTarget = useCallback((el: DocElement | null | undefined): 'static' | 'field' | null => {
    if (!el || el.type !== 'text' || el.locked || !el.binding) return null;
    if (el.binding.kind === 'static') return 'static';
    if (el.binding.kind === 'field') {
      const key = el.binding.key;
      if (!key.startsWith('_')) return 'field';
      if (key in OFFER_LABEL_OVERRIDE) return 'field'; // editable via its override field
    }
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
  // Resize an auto-size ("hug") text box's stored w/h to its rendered content so
  // the selection handles wrap the text (the renderer already hugs visually).
  // Measures the live node forced to max-content/no-wrap, then keeps the
  // align-anchored edge + vertical center fixed so the box grows from the anchor.
  const hugBoxToContent = useCallback((id: string) => {
    const node = iframeRef.current?.contentDocument?.querySelector(`[data-el-id="${id}"]`) as HTMLElement | null;
    if (!node) return;
    const prev = { width: node.style.width, height: node.style.height, whiteSpace: node.style.whiteSpace, transform: node.style.transform };
    node.style.transform = 'none';
    node.style.width = 'max-content';
    node.style.whiteSpace = 'pre';
    node.style.height = 'auto';
    const contentW = node.offsetWidth;
    const contentH = node.offsetHeight;
    node.style.width = prev.width; node.style.height = prev.height; node.style.whiteSpace = prev.whiteSpace; node.style.transform = prev.transform;
    if (!contentW || !contentH) return;
    setDoc((prevDoc) => {
      const el = prevDoc.elements.find((e) => e.id === id);
      const lay = { ...(prevDoc.layouts[size.id] ?? {}) };
      const b = lay[id];
      if (!b) return prevDoc;
      const w = clamp(contentW / size.width, 0.01, 1.5);
      const h = clamp(contentH / size.height, 0.01, 1.5);
      const align = el?.align ?? 'left';
      const x = align === 'center' ? b.x + b.w / 2 - w / 2 : align === 'right' ? b.x + b.w - w : b.x;
      const y = b.y + b.h / 2 - h / 2;
      lay[id] = { ...b, x, y, w, h };
      return { ...prevDoc, layouts: { ...prevDoc.layouts, [size.id]: lay } };
    }, `hug:${id}`);
  }, [size.id, size.width, size.height]);

  const commitTextEdit = useCallback(() => {
    // Read the latest value via the functional updater — the blur handler is
    // bound once per edit session, so this closure can be stale; `cur` is always
    // the current typed value.
    setEditingText((cur) => {
      if (!cur) return null;
      const el = doc.elements.find((e) => e.id === cur.id);
      const b = el?.binding;
      if (b?.kind === 'static') {
        setElement(cur.id, { binding: { kind: 'static', value: cur.value } });
      } else if (b?.kind === 'field') {
        // Offer-label bindings write their free-text override field, not the
        // derived `_offer*` key (which enrichOfferFields would recompute).
        const key = OFFER_LABEL_OVERRIDE[b.key] ?? b.key;
        setDoc((prev) => ({ ...prev, defaults: { ...prev.defaults, [key]: cur.value } }));
      }
      // The auto-size boxes re-hug on the next canvas write via syncAutoBoxes —
      // the reliable point to measure (after the iframe reflects the new value).
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
      // Pinned-width text: refill the font live so it keeps spanning the box.
      if (node.hasAttribute('data-fit')) fitTextNode(node);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Enter inserts a new line (multi-line text); click out to commit, Esc to
        // cancel. Insert a LITERAL "\n" text node (not a <br>, which textContent
        // drops) so the newline survives the commit + the pre/pre-wrap render.
        e.preventDefault();
        const idoc = node.ownerDocument;
        const sel = idoc.defaultView?.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const tn = idoc.createTextNode('\n');
          range.insertNode(tn);
          range.setStartAfter(tn);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          onInput(); // sync value + refit (manual DOM edits don't fire `input`)
        }
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

  // Duplicate every element in `ids` at once (⌘D on a multi-selection), keeping
  // each clone next to its original + offset, and select the new clones.
  const duplicateElements = useCallback((ids: string[]) => {
    const valid = ids.filter((id) => doc.elements.some((e) => e.id === id));
    if (!valid.length) return;
    const idSet = new Set(valid);
    const idMap = new Map<string, string>();
    for (const el of doc.elements) if (idSet.has(el.id)) idMap.set(el.id, `${el.type}-${rid()}`);
    setDoc((prev) => {
      const elements: DocElement[] = [];
      for (const el of prev.elements) {
        elements.push(el);
        const newId = idMap.get(el.id);
        if (newId) {
          const clone = structuredClone(el);
          clone.id = newId;
          elements.push(clone);
        }
      }
      const layouts = { ...prev.layouts };
      for (const sid of Object.keys(prev.layouts)) {
        const lay = { ...prev.layouts[sid] };
        for (const [oldId, newId] of idMap) {
          const b = prev.layouts[sid][oldId];
          if (b) lay[newId] = { ...b, x: clamp(b.x + 0.03, 0, 1 - b.w), y: clamp(b.y + 0.03, 0, 1 - b.h), z: (b.z ?? 0) + 1 };
        }
        layouts[sid] = lay;
      }
      return { ...prev, elements, layouts };
    });
    setSelectedIds([...idMap.values()]);
  }, [doc.elements]);

  // ── bulk edits across the current multi-selection ──
  // Patch a property on every selected ELEMENT (font, weight, color, align, …).
  const patchSelectedElements = useCallback((patch: Partial<DocElement>) => {
    const ids = new Set(selectedIds);
    setDoc((prev) => ({ ...prev, elements: prev.elements.map((el) => (ids.has(el.id) ? { ...el, ...patch } : el)) }), `bulkel:${Object.keys(patch).sort().join(',')}`);
  }, [selectedIds]);
  // Patch the current-size BOX of every selected element (fontSize lives here).
  const patchSelectedBoxes = useCallback((patch: Partial<DocLayoutBox>) => {
    const ids = selectedIds;
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      for (const id of ids) if (lay[id]) lay[id] = { ...lay[id], ...patch };
      return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
    }, `bulkbox:${Object.keys(patch).sort().join(',')}`);
  }, [selectedIds, size.id]);
  // Nudge each selected element's font size by delta, keeping their relative sizes.
  const bumpSelectedFontSize = useCallback((delta: number) => {
    const ids = selectedIds;
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      for (const id of ids) if (lay[id]) lay[id] = { ...lay[id], fontSize: clamp(Math.round((lay[id].fontSize ?? 48) + delta), 4, 400) };
      return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
    }, 'bulkbox:fontSize');
  }, [selectedIds, size.id]);

  // Fit a text box to its rendered content on the given axis — the explicit
  // action behind double-clicking a resize handle (n/s → height, e/w → width,
  // corners → both). Measures the live node inside the iframe (native px), so
  // the box hugs the wrapped text. NOT the old auto-hug (removed); user-invoked only.
  const fitBoxToContent = useCallback((id: string, axis: 'h' | 'w' | 'both') => {
    const node = iframeRef.current?.contentDocument?.querySelector(`[data-el-id="${id}"]`) as HTMLElement | null;
    if (!node) return;
    const prevStyle = { width: node.style.width, height: node.style.height, whiteSpace: node.style.whiteSpace };
    let contentW = 0;
    let contentH = 0;
    if (axis === 'w' || axis === 'both') {
      node.style.width = 'max-content';
      node.style.whiteSpace = 'pre-wrap';
      contentW = node.offsetWidth;
      node.style.width = prevStyle.width;
      node.style.whiteSpace = prevStyle.whiteSpace;
    }
    if (axis === 'h' || axis === 'both') {
      node.style.height = 'auto';
      contentH = node.offsetHeight;
      node.style.height = prevStyle.height;
    }
    setDoc((prev) => {
      const lay = { ...(prev.layouts[size.id] ?? {}) };
      const b = lay[id];
      if (!b) return prev;
      const nb = { ...b };
      if (contentW) nb.w = clamp(contentW / size.width, 0.02, 1 - b.x);
      if (contentH) nb.h = clamp(contentH / size.height, 0.01, 1 - b.y);
      lay[id] = nb;
      return { ...prev, layouts: { ...prev.layouts, [size.id]: lay } };
    }, `fit:${axis}:${id}`);
  }, [size.id, size.width, size.height]);

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
        // New text hugs its content by default (no wrap; resize scales the font).
        const el = type === 'text' ? { ...makeDefaultElement(id, type), autoSize: true } : makeDefaultElement(id, type);
        return { ...prev, elements: [...prev.elements, el], layouts };
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
        // A concrete black square by default — no `radius` (square) and a real
        // hex (not `'brand'`, which rendered a colour the swatch didn't reflect).
        bg: '#000000',
        padding: 14,
        // A button pill hugs its label (grows with the text, no wrap).
        autoSize: true,
      };
      return { ...prev, elements: [...prev.elements, el], layouts };
    });
    setSelectedIds([id]);
  }, []);

  // ── Reusable blocks ──────────────────────────────────────────────────────
  const refreshBlocks = useCallback(() => {
    const qs = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    fetch(`/api/ad-generator/blocks${qs}`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((j: { blocks?: BlockRow[] }) => setBlocks(j.blocks ?? []))
      .catch(() => setBlocks([]));
  }, [accountKey]);
  useEffect(() => {
    refreshBlocks();
  }, [refreshBlocks]);

  // Insert a saved block: clone its elements onto every size + re-seed the
  // fields its bindings need, then select the new elements.
  const insertBlock = useCallback((payload: BlockPayload) => {
    setDoc((prev) => {
      const { doc: next, newIds } = insertBlockIntoDoc(prev, payload, (type) => `${type}-${rid()}`);
      setSelectedIds(newIds);
      return next;
    });
    toast.success('Block inserted');
  }, [setDoc]);

  // Open the save dialog with a payload built from the current selection.
  const saveSelectionAsBlock = useCallback(() => {
    const payload = buildBlockPayload(doc, selectedIds, size.id);
    if (!payload) {
      toast.error('Select one or more elements first');
      return;
    }
    setBlockDraft(payload);
  }, [doc, selectedIds, size.id]);

  const deleteBlock = useCallback(
    async (id: string, name: string) => {
      const ok = await confirm({
        title: 'Delete block',
        message: `Delete the block "${name}"? Templates already built with it are unaffected.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      try {
        const res = await fetch(`/api/ad-generator/blocks/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBlocks((bs) => bs.filter((b) => b.id !== id));
      } catch (err) {
        toast.error(`Couldn't delete block: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    },
    [confirm],
  );

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

  // Z-order within the current size (z lives per-size on the box). Front/back
  // JUMP past everything; forward/backward STEP one layer by normalizing the
  // stack to contiguous z then swapping the neighbour (ties broken by element
  // order so a step is always deterministic). Functional setDoc so consecutive
  // presses read fresh z.
  const applyZ = useCallback(
    (mode: 'front' | 'back' | 'forward' | 'backward') => {
      if (selectedIds.length !== 1) return;
      const id = selectedIds[0];
      setDoc((prev) => {
        const lay = prev.layouts[size.id] ?? {};
        const b = lay[id];
        if (!b) return prev;
        if (mode === 'front' || mode === 'back') {
          const zs = Object.values(lay).map((x) => x.z ?? 0);
          const nz = mode === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
          return { ...prev, layouts: { ...prev.layouts, [size.id]: { ...lay, [id]: { ...b, z: nz } } } };
        }
        const ids = Object.keys(lay);
        if (ids.length < 2) return prev;
        const elIndex = new Map(prev.elements.map((e, i) => [e.id, i] as const));
        const order = ids.slice().sort((a, c) => {
          const za = lay[a].z ?? 0;
          const zc = lay[c].z ?? 0;
          return za !== zc ? za - zc : (elIndex.get(a) ?? 0) - (elIndex.get(c) ?? 0);
        });
        const i = order.indexOf(id);
        const j = i + (mode === 'forward' ? 1 : -1);
        if (i < 0 || j < 0 || j >= order.length) return prev; // already at an end
        [order[i], order[j]] = [order[j], order[i]];
        const next = { ...lay };
        order.forEach((eid, idx) => {
          next[eid] = { ...next[eid], z: idx };
        });
        return { ...prev, layouts: { ...prev.layouts, [size.id]: next } };
      }, `z:${mode}:${id}`);
    },
    [selectedIds, size.id],
  );

  // ── template field-list operations ──
  // Every field ALWAYS belongs to a real group — there is no "ungrouped" limbo.
  // A field with no explicit group resolves to the "General" catch-all section
  // (`DEFAULT_GROUP`), which is a normal, renamable/deletable section like any
  // other. Add a field into a specific group (a section's "+ Add field"), or —
  // for the bare "Field" button — into the last section (or a fresh General).
  const addField = (group?: string) => {
    setDoc((prev) => {
      const groups = currentGroups(prev);
      const target = group?.trim() || groups[groups.length - 1] || DEFAULT_GROUP;
      const fieldGroups = groups.includes(target) ? groups : [...groups, target];
      return { ...prev, fieldGroups, fields: [...prev.fields, { key: `field_${rid()}`, label: 'New field', type: 'text', group: target }] };
    });
  };
  // ── Field groups (designer-defined form sections; ordered on the doc) ──
  // Ordered group list: explicit `fieldGroups`, unioned with any group present
  // on a field — an ungrouped field counts under the "General" section, so it's
  // never orphaned. Mirrors the FieldsSidebar's `orderedNames` (indices match).
  const currentGroups = (d: TemplateDoc): string[] => {
    const base = (d.fieldGroups ?? []).slice();
    for (const f of d.fields) { const g = f.group?.trim() || DEFAULT_GROUP; if (!base.includes(g)) base.push(g); }
    return base;
  };
  const addFieldGroup = () => {
    setDoc((prev) => {
      const groups = currentGroups(prev);
      let name = 'New group';
      for (let n = 2; groups.includes(name); n++) name = `New group ${n}`;
      return { ...prev, fieldGroups: [...groups, name] };
    });
    return;
  };
  const renameFieldGroup = (oldName: string, next: string) => {
    const finalName = next.trim() || oldName;
    setDoc((prev) => {
      const groups = [...new Set(currentGroups(prev).map((g) => (g === oldName ? finalName : g)))];
      // Assign a real name — including previously-ungrouped fields that resolved
      // to the General section when it's being renamed.
      const fields = prev.fields.map((f) => ((f.group?.trim() || DEFAULT_GROUP) === oldName ? { ...f, group: finalName } : f));
      return { ...prev, fieldGroups: groups, fields };
    }, `renamegroup:${oldName}`);
  };
  const deleteFieldGroup = async (name: string) => {
    const inGroup = doc.fields.filter((f) => (f.group?.trim() || DEFAULT_GROUP) === name);
    const doDelete = () =>
      setDoc((prev) => ({
        ...prev,
        fieldGroups: currentGroups(prev).filter((g) => g !== name),
        // Delete the section AND its fields (undoable via ⌘Z).
        fields: prev.fields.filter((f) => (f.group?.trim() || DEFAULT_GROUP) !== name),
      }), `deletegroup:${name}`);
    // Empty section → remove silently. Section with fields → confirm, since the
    // fields go with it (with a "don't show again" opt-out stored per browser).
    if (inGroup.length === 0) { doDelete(); return; }
    const skip = typeof window !== 'undefined' && window.localStorage.getItem(SKIP_DELETE_SECTION_KEY) === '1';
    if (!skip) {
      const dontAsk = { current: false };
      const ok = await confirm({
        title: 'Delete group?',
        message: `Deleting “${name}” will also delete the ${inGroup.length} field${inGroup.length === 1 ? '' : 's'} inside it. You can undo with ⌘Z.`,
        destructive: true,
        confirmLabel: 'Delete group',
        body: <DontShowAgainCheckbox onChange={(v) => { dontAsk.current = v; }} />,
      });
      if (!ok) return;
      if (dontAsk.current && typeof window !== 'undefined') window.localStorage.setItem(SKIP_DELETE_SECTION_KEY, '1');
    }
    doDelete();
  };
  const moveFieldGroup = (from: number, to: number) => {
    setDoc((prev) => {
      const groups = currentGroups(prev);
      if (from < 0 || to < 0 || from >= groups.length || to >= groups.length || from === to) return prev;
      const next = [...groups];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return { ...prev, fieldGroups: next };
    });
  };
  // Move a field (by key) into `group`, positioned before `beforeKey` (else at the
  // group's end). Reorders `doc.fields` so within-group order is preserved.
  const moveFieldToGroup = (key: string, group: string | undefined, beforeKey?: string) => {
    setDoc((prev) => {
      const g = group?.trim() || DEFAULT_GROUP; // never leave a field ungrouped
      const fields = [...prev.fields];
      const idx = fields.findIndex((f) => f.key === key);
      if (idx < 0) return prev;
      const [moved] = fields.splice(idx, 1);
      moved.group = g;
      let insertAt = -1;
      if (beforeKey) insertAt = fields.findIndex((f) => f.key === beforeKey);
      if (insertAt < 0) {
        // Land at the end of the target group (after its last field).
        for (let i = 0; i < fields.length; i++) if ((fields[i].group?.trim() || DEFAULT_GROUP) === g) insertAt = i + 1;
      }
      if (insertAt < 0) fields.push(moved); else fields.splice(insertAt, 0, moved);
      const groups = currentGroups(prev);
      const fieldGroups = groups.includes(g) ? groups : [...groups, g];
      return { ...prev, fields, fieldGroups };
    });
  };
  // Apply a preset: seed its fields (merge-missing, never overwrites the
  // designer's fields) + defaults into the current template. This is how
  // "Vehicle Offer" fills the offer questions. Not tied to the library Category.
  const applyPreset = (name: string) => {
    const preset = presets.find((s) => s.name === name);
    if (!preset?.fields?.length) return;
    setDoc((prev) => {
      const next: TemplateDoc = { ...prev };
      const have = new Set(prev.fields.map((f) => f.key));
      const add = preset.fields.filter((f) => !have.has(f.key));
      if (add.length) next.fields = [...prev.fields, ...add];
      const defaults = { ...prev.defaults };
      for (const [k, v] of Object.entries(preset.defaults ?? {})) if (!(k in defaults)) defaults[k] = v;
      next.defaults = defaults;
      return next;
    }, 'preset');
    toast.success(`Applied “${name}” preset`);
  };
  // Save the current template's fields (+ defaults) as a reusable, named preset.
  // Designer-managed; managers only (the POST route enforces the role).
  const savePreset = async () => {
    const name = (
      await prompt({
        title: 'Save preset',
        message: 'Save the current fields and their sections/defaults as a reusable preset you can apply to any template.',
        placeholder: 'Preset name (e.g. Vehicle Offer)',
        confirmLabel: 'Save preset',
        required: true,
      })
    )?.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/ad-generator/category-starters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fields: doc.fields, defaults: doc.defaults }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setPresets((prev) => {
        const rest = prev.filter((s) => s.name !== name);
        return [...rest, { name, fields: doc.fields, defaults: doc.defaults }].sort((a, b) => a.name.localeCompare(b.name));
      });
      toast.success(`Saved “${name}” preset`);
    } catch (err) {
      toast.error(`Couldn't save preset: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };
  // Update an existing preset in place with the current template's fields —
  // "I tweaked the field-set, save it back over the preset." Reuses the upsert
  // POST (the name already exists). Managers only (route-enforced).
  const updatePreset = async (name: string) => {
    const ok = await confirm({
      title: 'Update preset?',
      message: `Replace “${name}” with the current fields and defaults? Templates you’ve already built won’t change.`,
      confirmLabel: 'Update preset',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/ad-generator/category-starters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fields: doc.fields, defaults: doc.defaults }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setPresets((prev) => prev.map((s) => (s.name === name ? { name, fields: doc.fields, defaults: doc.defaults } : s)));
      toast.success(`Updated “${name}” preset`);
    } catch (err) {
      toast.error(`Couldn't update preset: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };
  // Delete a preset from the registry. Only removes the reusable preset —
  // templates already built keep their fields. Managers only (route-enforced).
  const deletePreset = async (name: string) => {
    const ok = await confirm({
      title: 'Delete preset?',
      message: `Delete the “${name}” preset? This only removes the reusable preset — templates you’ve already built keep their fields. You can’t undo this.`,
      destructive: true,
      confirmLabel: 'Delete preset',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/category-starters?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setPresets((prev) => prev.filter((s) => s.name !== name));
      toast.success(`Deleted “${name}” preset`);
    } catch (err) {
      toast.error(`Couldn't delete preset: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };
  // Duplicate one field, dropped in right after the original (fresh key, "copy"
  // label, its default carried over). Undoable via ⌘Z.
  const duplicateFieldAt = (i: number) => {
    setDoc((prev) => {
      const src = prev.fields[i];
      if (!src) return prev;
      const clone: FieldSpec = { ...structuredClone(src), key: `field_${rid()}`, label: src.label ? `${src.label} copy` : 'New field' };
      const fields = [...prev.fields];
      fields.splice(i + 1, 0, clone);
      const defaults = { ...prev.defaults };
      if (src.key in defaults) defaults[clone.key] = defaults[src.key];
      return { ...prev, fields, defaults };
    });
  };
  // Duplicate a whole section: a new "<name> copy" group placed right after the
  // original, with every field cloned (fresh keys + defaults). Conditional
  // (visibleWhen) references between the copied fields re-point to the copies so
  // the duplicate is self-contained — ideal for a second offer built off the first.
  const duplicateFieldGroup = (name: string) => {
    setDoc((prev) => {
      const groups = currentGroups(prev);
      const gi = groups.indexOf(name);
      if (gi < 0) return prev;
      let newName = `${name} copy`;
      for (let n = 2; groups.includes(newName); n++) newName = `${name} copy ${n}`;
      const members = prev.fields.filter((f) => (f.group?.trim() || DEFAULT_GROUP) === name);
      const keyMap = new Map<string, string>();
      const clones: FieldSpec[] = members.map((f) => {
        const key = `field_${rid()}`;
        keyMap.set(f.key, key);
        return { ...structuredClone(f), key, group: newName };
      });
      for (const c of clones) {
        if (c.visibleWhen && keyMap.has(c.visibleWhen.field)) c.visibleWhen = { ...c.visibleWhen, field: keyMap.get(c.visibleWhen.field)! };
      }
      const fieldGroups = [...groups];
      fieldGroups.splice(gi + 1, 0, newName);
      // Land the clones right after the source group's last field.
      const fields = [...prev.fields];
      let insertAt = fields.length;
      for (let k = 0; k < fields.length; k++) if ((fields[k].group?.trim() || DEFAULT_GROUP) === name) insertAt = k + 1;
      fields.splice(insertAt, 0, ...clones);
      const defaults = { ...prev.defaults };
      for (const [oldKey, newKey] of keyMap) if (oldKey in defaults) defaults[newKey] = defaults[oldKey];
      return { ...prev, fields, fieldGroups, defaults };
    });
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
    | { kind: 'single'; handle: Handle; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; elId: string; start: DocLayoutBox; live: DocLayoutBox; targetsX: number[]; targetsY: number[]; scaleFont: boolean; autoSize: boolean }
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
      // Drive the node as a plain box during the drag. Auto-size text renders with
      // an align-anchored transform (translate); clear it here so left/top/width
      // describe the same rectangle the committed render will produce.
      node.style.transform = '';
      node.style.left = `${b.x * nw}px`;
      node.style.top = `${b.y * nh}px`;
      node.style.width = `${b.w * nw}px`;
      node.style.height = `${b.h * nh}px`;
      if (b.fontSize != null) node.style.fontSize = `${b.fontSize}px`;
      // Pinned-width text: refill the font to the new box width on every drag frame.
      if (node.hasAttribute('data-fit')) fitTextNode(node);
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
      let box = computeBox(d.handle, d.start, dxF, dyF);
      // Text sizing: an AUTO-SIZE ("hug") text box scales its font on any resize
      // (the box tracks the text, so widening the box grows the text). A classic
      // fixed text box resizes freely, and ⌘/Ctrl scales its font instead. Either
      // way the font-scale path locks aspect so the text scales like an object;
      // Shift locks aspect for any element.
      // HUG text scales its font on resize (the box re-hugs). FIT-to-box text is a
      // fixed frame — resizing just changes the frame and the font auto-fits (via
      // moveNode below), so we don't hand-scale it.
      const scaleText = d.scaleFont && d.autoSize && !!d.start.fontSize && d.start.h > 0;
      if (d.handle !== 'move' && (e.shiftKey || scaleText)) box = lockAspect(d.handle, d.start, box, d.nw, d.nh);
      let gx: number | null = null;
      let gy: number | null = null;
      if (d.handle === 'move') {
        const sx = bestSnap([box.x, box.x + box.w / 2, box.x + box.w], d.targetsX, SNAP_PX / d.fw);
        const sy = bestSnap([box.y, box.y + box.h / 2, box.y + box.h], d.targetsY, SNAP_PX / d.fh);
        box.x = clamp(box.x + sx.off, 0, 1 - box.w);
        box.y = clamp(box.y + sy.off, 0, 1 - box.h);
        gx = sx.guide;
        gy = sy.guide;
      } else if (scaleText) {
        box.fontSize = Math.max(4, Math.round(d.start.fontSize! * (box.h / d.start.h)));
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
      const startBounds = { x: d.bounds.left, y: d.bounds.top, w: w0, h: h0 };
      let rect = computeBox(d.handle, startBounds, dxF, dyF);
      // Shift = lock the group's aspect ratio too (scales everything uniformly).
      if (d.handle !== 'move' && e.shiftKey) rect = lockAspect(d.handle, startBounds, rect, d.nw, d.nh);
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
      // Commit the drag as-is — text/button boxes size freely (no auto-hug).
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
    const elDef = doc.elements.find((el) => el.id === elId);
    const scaleFont = elDef?.type === 'text';
    const autoSize = !!elDef?.autoSize;
    dragRef.current = { kind: 'single', handle, sx: e.clientX, sy: e.clientY, fw: frameW, fh: frameH, nw: size.width, nh: size.height, sizeId: size.id, elId, start: { ...box }, live: { ...box }, targetsX: tx, targetsY: ty, scaleFont, autoSize };
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

  // Apply the modal crop: server-side crop of the element's current image (by
  // URL) into a new asset, then point the element at it. Mirrors the media library.
  async function applyBuilderCrop(crop: CropRect) {
    if (!cropModal) return;
    setCropSaving(true);
    try {
      const res = await fetch('/api/media/crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cropModal.url, accountKey: accountKey ?? null, x: crop.x, y: crop.y, width: crop.width, height: crop.height }),
      });
      const j = (await res.json().catch(() => null)) as { file?: { url: string }; error?: string } | null;
      if (!res.ok || !j?.file?.url) throw new Error(j?.error || `HTTP ${res.status}`);
      const url = j.file.url;
      // Preserve the element's binding. A FIELD-bound image (e.g. Vehicle Image
      // URL) keeps its field binding — the cropped image becomes that field's
      // default — so cropping no longer silently reverts it to a Fixed Image.
      // Static/brand fall back to pinning the cropped asset (a baked crop can't
      // ride a live brand binding).
      const cur = doc.elements.find((e) => e.id === cropModal.id);
      if (cur?.binding?.kind === 'field') {
        const key = cur.binding.key;
        setDoc((prev) => ({ ...prev, defaults: { ...prev.defaults, [key]: url } }), `crop:${cropModal.id}`);
      } else {
        setElement(cropModal.id, { binding: { kind: 'static', value: url } });
      }
      toast.success('Image cropped');
      setCropModal(null);
    } catch (err) {
      toast.error(`Couldn't crop: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setCropSaving(false);
    }
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
    // A deliberate multi-selection wins: pressing any of its members drags the
    // whole set together, even when some members are grouped (otherwise the
    // group-collapse branch below would shrink the selection to one group).
    if (selectedIds.length > 1 && selectedIds.includes(elId)) {
      startGroupDrag(e);
      return;
    }
    const chain = ancestorChain(elId);
    const outer = chain[chain.length - 1];
    // Drilled into this element's group (double-click): act on the individual
    // member — select and drag just it, don't re-collapse to the whole group.
    if (focusedGroupId && chain.includes(focusedGroupId)) {
      selectOne(elId);
      startSingleDrag(e, elId, 'move');
      return;
    }
    // A grouped element (not drilled in) selects (and drags) its OUTERMOST group
    // as a unit — double-click drills into it. Nested groups → top-level group.
    if (outer) {
      const members = membersOf(outer).filter((id) => !lockedIds.has(id));
      if (members.length > 1) {
        setFocusedGroupId(null);
        setSelectedIds(members);
        startGroupDrag(e, members);
        return;
      }
    }
    setFocusedGroupId(null);
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
        // Z-order: ⌘] forward one / ⌘[ back one; add ⇧ to jump to front/back.
        if (selectedIds.length !== 1) return;
        e.preventDefault();
        const forward = key === ']';
        applyZ(e.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward');
      } else if (key === 'd') {
        // Duplicate (⌘D) the whole selection — one or many elements.
        if (!selectedIds.length) return;
        e.preventDefault();
        duplicateElements(selectedIds);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedIds, doc.elements, doc.groups, size.id, duplicateElements, applyZ]);

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
  const adders: Adder[] = [
    { label: 'Text', Icon: TextElementIcon, onAdd: () => addElement('text'), color: KIND_COLOR.text },
    { label: 'Image', Icon: PhotoIcon, onAdd: () => addElement('image'), color: KIND_COLOR.image },
    { label: 'Button', Icon: ButtonElementIcon, onAdd: addButton, color: KIND_COLOR.button },
    { label: 'Shape', Icon: ShapeElementIcon, onAdd: () => addElement('shape'), color: KIND_COLOR.shape },
    { label: 'Logo', Icon: BuildingStorefrontIcon, onAdd: () => addElement('logo'), color: KIND_COLOR.logo },
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
                    <MultiSelect
                      value={doc.industries ?? []}
                      onChange={(vals) => setDoc((prev) => ({ ...prev, industries: vals }), 'industries')}
                      options={allIndustries.map((name) => ({ value: name, label: name }))}
                      placeholder="All vehicle-offer accounts"
                      menuZIndex={260}
                    />
                    <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">Assign tags on the template card in the Templates library.</p>

                    {templateIsAutomotive && (
                      <div className="mt-4 border-t border-[var(--border)] pt-3">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Make / OEM</h3>
                        <p className="mb-2 text-[11px] leading-snug text-[var(--muted-foreground)]">
                          Tie this template to an OEM — the Fields panel then flags any required compliance field it&apos;s missing.
                        </p>
                        <FontSelect
                          value={doc.make ?? ''}
                          onChange={(v) => setDoc((prev) => ({ ...prev, make: v || undefined }), 'make')}
                          options={MAKE_OPTIONS}
                          placeholder="Select make…"
                          previewFont={false}
                        />
                      </div>
                    )}

                    <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                      <button
                        onClick={() => {
                          setDeployOpen(true);
                          setSettingsOpen(false);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        <RocketLaunchIcon className="h-4 w-4" />
                        Copy to Subaccounts
                      </button>
                      {templateId && (
                        <button
                          onClick={() => {
                            save(true);
                            setSettingsOpen(false);
                          }}
                          disabled={saving}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
                        >
                          <BookmarkSquareIcon className="h-4 w-4" />
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
            <RailButton label="Insert" Icon={PlusIcon} primary active={leftPanel === 'insert'} onClick={() => { setLeftPanel((p) => (p === 'insert' ? null : 'insert')); setFieldsOpen(false); }} />
            <RailButton label="Layers" Icon={LayersIcon} active={leftPanel === 'layers'} onClick={() => { setLeftPanel((p) => (p === 'layers' ? null : 'layers')); setFieldsOpen(false); }} />
            {/* Fields — the form that drives the ad. Left-docked (shares the left
                slot with Insert/Layers); coexists with the right settings panel. */}
            <RailButton
              label="Fields"
              Icon={Bars3BottomLeftIcon}
              active={fieldsOpen}
              onClick={() =>
                setFieldsOpen((v) => {
                  const next = !v;
                  if (next) setLeftPanel(null); // Fields takes the left slot from Insert/Layers
                  return next;
                })
              }
            />
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
          <section className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-2xl backdrop-blur-2xl">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <PlusIcon className="h-3.5 w-3.5" />
              Insert
            </h2>
            <AdderGrid adders={adders} variant="panel" />
            <p className="mt-3 text-[11px] leading-snug text-[var(--muted-foreground)]">Click to add to the canvas, then drag to position. The panel stays open so you can add several.</p>
          </section>
          )}

          {/* Blocks — reusable element clusters (offer blocks, etc.). Click to
              insert; save the current selection via the ⋯/right-click menu. */}
          {leftPanel === 'insert' && (
          <section className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-2xl backdrop-blur-2xl">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <Squares2X2Icon className="h-3.5 w-3.5" />
              Blocks
            </h2>
            {blocks.length === 0 ? (
              <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                Select elements on the canvas, then <span className="text-[var(--foreground)]">Save as block</span> (right-click or the multi-select panel) to reuse them here.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {blocks.map((b) => (
                  <div key={b.id} className="group flex items-center gap-1 rounded-lg border border-[var(--border)] pr-1 transition-colors hover:border-[var(--primary)]">
                    <button
                      type="button"
                      onClick={() => insertBlock(b.doc)}
                      title="Insert this block"
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[var(--foreground)]"
                    >
                      <span className="truncate">{b.name}</span>
                      <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">
                        {b.accountKeys?.length ? `${b.accountKeys.length} acct${b.accountKeys.length > 1 ? 's' : ''}` : 'Global'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBlock(b.id, b.name)}
                      title="Delete block"
                      className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {/* Layers — the stack of placed elements (top of the list = front).
              Double-click to rename · lock icon to lock · drag to reorder (z). */}
          {leftPanel === 'layers' && (
          <section className="pointer-events-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-4 shadow-2xl backdrop-blur-2xl">
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
                          <span className="flex-shrink-0" style={{ color: KIND_COLOR[elementKind(el)] }}>
                            <Icon className="h-4 w-4" />
                          </span>
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
            {/* Compliance status for the tagged make — pinned to the left. */}
            {doc.make && compliance && compliance.length > 0 && (
              <div className="mr-auto">
                <ComplianceChip make={doc.make} compliance={compliance} missing={complianceMissing} onInsert={insertComplianceField} />
              </div>
            )}
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
                    srcDoc="<!doctype html><html><head></head><body></body></html>"
                    onLoad={writeFrame}
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
                      <div className="pointer-events-auto relative w-full max-w-[26rem] animate-fade-in-up">
                        {/* Soft glow in the four element-palette colours so a blank
                            canvas still feels alive + on-brand. */}
                        <div
                          aria-hidden
                          className="pointer-events-none absolute -inset-8 -z-10 opacity-70 blur-3xl"
                          style={{
                            background:
                              'radial-gradient(38% 38% at 22% 18%, #3b82f655, transparent 70%), radial-gradient(38% 38% at 82% 16%, #ec489955, transparent 70%), radial-gradient(42% 42% at 78% 88%, #a855f755, transparent 70%), radial-gradient(38% 38% at 18% 86%, #f9731655, transparent 70%)',
                          }}
                        />
                        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card-strong)]/95 shadow-2xl backdrop-blur-xl">
                          <div className="flex flex-col items-center gap-2 bg-gradient-to-b from-[var(--primary)]/12 to-transparent px-6 pb-3 pt-7 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[#a855f7] text-white shadow-lg shadow-[var(--primary)]/30">
                              <PaintBrushIcon className="h-7 w-7" />
                            </div>
                            <h3 className="text-lg font-bold text-[var(--foreground)]">Design your ad</h3>
                            <p className="max-w-[17rem] text-xs leading-relaxed text-[var(--muted-foreground)]">
                              Drop in your first element to start — text, image, button, or shape.
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
                    // While text-editing, the box grows live but its stored size
                    // (and thus the handles) can't update until commit — so hide
                    // the resize handles during the edit; the caret's own outline
                    // shows the live bounds. They reappear hugging on commit.
                    const isEditingThis = editingText?.id === el.id;
                    const isCropping = cropId === el.id;
                    const singleDragging = dragBox != null && dragRef.current?.kind === 'single' && dragRef.current.elId === el.id;
                    const live = groupLive?.[el.id];
                    const b = singleDragging && dragBox ? dragBox : live ?? box;
                    // Fully off the artboard → detached (a canvas-only parking
                    // spot). The iframe clips it away, so the builder draws its
                    // visual here in the (unclipped) overlay instead.
                    const detached = isDetached(b);
                    // Type colour (Text=blue / Image=pink / Button=purple /
                    // Shape=orange), exposed as `--kind` for the ring + handles.
                    const kindColor = KIND_COLOR[elementKind(el)];
                    const boxStyle: CSSProperties = {
                      ['--kind' as string]: kindColor,
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
                          const chain = ancestorChain(el.id);
                          const inFocusedGroup = focusedGroupId ? chain.includes(focusedGroupId) : false;
                          // First double-click on a grouped element: drill INTO the
                          // group and select just this member, so you can act on it.
                          // (Editing its text takes a second double-click, once we're
                          // already drilled in — matching Figma/Canva.)
                          if (el.groupId && !lockedIds.has(el.id) && !inFocusedGroup) {
                            e.stopPropagation();
                            setFocusedGroupId(chain[0] ?? el.groupId);
                            selectOne(el.id);
                            return;
                          }
                          // Editable text: edit its value inline. Reached for ungrouped
                          // text directly, or for a grouped child we've drilled into.
                          if (textEditTarget(el)) {
                            e.stopPropagation();
                            startTextEdit(el.id);
                            return;
                          }
                          // Computed offer text (e.g. the price/terms, `_offer*`) is
                          // derived from the offer inputs — tell the user where to edit
                          // it rather than silently doing nothing on double-click.
                          if (el.type === 'text' && el.binding?.kind === 'field' && el.binding.key.startsWith('_')) {
                            e.stopPropagation();
                            toast('This text is generated from the offer fields — edit those in the Fields panel.');
                            return;
                          }
                        }}
                        title={detached ? `${elName(el)} (detached — drag onto the artboard to add)` : box.hidden ? `${elName(el)} (hidden here)` : elName(el)}
                        className="group absolute"
                        style={boxStyle}
                      >
                        {/* Detached elements are clipped out of the iframe, so
                            render their actual content here on the canvas. */}
                        {detached && <DetachedVisual el={el} box={b} scale={scale} previewData={previewData} resolveUrl={resolveBindingUrl} />}
                        {/* Selection ring + fill. Hidden while editing this element:
                            the stored box can't resize mid-keystroke, so it'd sit
                            stale around the live-shrinking text. The editing effect's
                            own outline (on the max-content node) hugs the text live. */}
                        {!isEditingThis && (
                          <span
                            className={`pointer-events-none absolute inset-0 rounded-[2px] ring-inset transition-colors ${
                              isCropping
                                ? 'ring-2 ring-[var(--kind)]'
                                : isSel
                                  ? 'ring-2 ring-[var(--kind)]'
                                  : detached
                                    ? 'ring-1 ring-dashed ring-amber-500/70 group-hover:ring-amber-500'
                                    : box.hidden
                                      ? 'ring-1 ring-dashed ring-[var(--muted-foreground)]/45 group-hover:ring-[var(--muted-foreground)]/70'
                                      : showOutlines
                                        ? 'ring-[1.5px] ring-dashed ring-[var(--primary)]/55 group-hover:ring-[var(--primary)]/90'
                                        : 'group-hover:ring-[1.5px] group-hover:ring-[var(--primary)]/70'
                            }`}
                            style={isSel && !isCropping ? { backgroundColor: `${kindColor}1a` } : undefined}
                          />
                        )}
                        {isSingleSel && !isEditingThis && (
                          <>
                            <span
                              className={`pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${detached ? 'bg-amber-500' : ''}`}
                              style={detached ? undefined : { backgroundColor: kindColor }}
                            >
                              {isCropping ? 'Crop — drag to reposition' : detached ? `${elName(el)} — detached` : elName(el)}
                            </span>
                            {RESIZE_HANDLES.map((rh) => {
                              // Double-click a handle on a text box to fit it to
                              // its content: top/bottom → height, left/right →
                              // width, a corner → both. (Explicit, not auto-hug.)
                              const fitAxis = rh.h === 'n' || rh.h === 's' ? 'h' : rh.h === 'e' || rh.h === 'w' ? 'w' : 'both';
                              const canFit = el.type === 'text';
                              return (
                                <span
                                  key={rh.h}
                                  onPointerDown={(e) => startSingleDrag(e, el.id, rh.h)}
                                  onDoubleClick={canFit ? (e) => { e.stopPropagation(); fitBoxToContent(el.id, fitAxis); } : undefined}
                                  title={canFit ? `Drag to resize · double-click to fit ${fitAxis === 'h' ? 'height' : fitAxis === 'w' ? 'width' : 'box'} to text` : undefined}
                                  className="absolute h-2.5 w-2.5 rounded-[2px] border border-[var(--kind)] bg-[var(--card)]"
                                  style={{
                                    left: `${rh.x * 100}%`,
                                    top: `${rh.y * 100}%`,
                                    transform: 'translate(-50%, -50%)',
                                    cursor: rh.cursor,
                                    touchAction: 'none',
                                  }}
                                />
                              );
                            })}
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
                  contentSources={contentSources}
                  onContentChange={setSelectedContent}
                  accountKey={accountKey ?? undefined}
                  onEl={updEl}
                  onBox={(patch) => setBox(size.id, selected.id, { ...selectedBox, ...patch }, `box:${selected.id}:${Object.keys(patch).sort().join(',')}`)}
                  onSetSizing={(mode) => {
                    updEl({ autoSize: mode === 'hug' ? true : undefined });
                    if (mode === 'hug') hugBoxToContent(selected.id);
                  }}
                  onClose={clearSelection}
                  onFillArtboard={() => fillArtboardAndSendBack(selected.id)}
                  shifted={false}
                  cropping={cropModal?.id === selected.id}
                  onToggleCrop={() => {
                    const url = resolveBindingUrl(selected);
                    if (!url) {
                      toast.error('Add an image first, then crop it');
                      return;
                    }
                    setCropModal({ id: selected.id, url, name: elName(selected) });
                  }}
                />
              )}

              {/* Bulk-edit panel for a multi-selection — mass-update font, size,
                  weight, alignment, colour, spacing across all selected text. */}
              {selectedIds.length > 1 && !editingText && (
                <MultiSelectPanel
                  elements={selectedIds.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is DocElement => Boolean(e))}
                  sampleFontSize={(() => {
                    const firstText = selectedIds.map((id) => layout[id]).find((b, i) => b && doc.elements.find((e) => e.id === selectedIds[i])?.type === 'text');
                    return firstText?.fontSize ?? 48;
                  })()}
                  fontOptions={fontOptions}
                  onElAll={patchSelectedElements}
                  onBoxAll={patchSelectedBoxes}
                  onBumpSize={bumpSelectedFontSize}
                  onDuplicate={() => duplicateElements(selectedIds)}
                  onSaveAsBlock={saveSelectionAsBlock}
                  onDelete={deleteSelected}
                  onClose={clearSelection}
                  shifted={false}
                />
              )}

              {/* Template Fields — left-docked inside the canvas (mirrors the
                  right settings panel), so both can be open at once. */}
              {fieldsOpen && (
                <FieldsSidebar
                  fields={doc.fields}
                  fieldGroups={currentGroups(doc)}
                  defaults={doc.defaults}
                  accountKey={accountKey ?? undefined}
                  brandLogos={brandLogos}
                  onClose={() => setFieldsOpen(false)}
                  onAdd={addField}
                  onUpdate={updateFieldAt}
                  onRename={renameFieldKeyAt}
                  onDelete={deleteFieldAt}
                  onDuplicateField={duplicateFieldAt}
                  onSetDefault={setDefaultAt}
                  onAddGroup={addFieldGroup}
                  onRenameGroup={renameFieldGroup}
                  onDeleteGroup={deleteFieldGroup}
                  onDuplicateGroup={duplicateFieldGroup}
                  onMoveGroup={moveFieldGroup}
                  onMoveField={moveFieldToGroup}
                  presets={presets.map((p) => p.name)}
                  onApplyPreset={applyPreset}
                  onSavePreset={savePreset}
                  onUpdatePreset={updatePreset}
                  onDeletePreset={deletePreset}
                  canManagePresets={isUnrestricted}
                />
              )}

            </div>
        </div>
      </div>

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
      {cropModal && (
        <CropEditorModal
          file={{ url: cropModal.url, name: cropModal.name }}
          saving={cropSaving}
          onClose={() => { if (!cropSaving) setCropModal(null); }}
          onSave={applyBuilderCrop}
          confirmLabel="Crop"
        />
      )}

      {blockDraft && (
        <SaveBlockDialog
          payload={blockDraft}
          accountOptions={Object.entries(accounts)
            .map(([key, a]) => ({ value: key, label: a.dealer || key }))
            .sort((x, y) => x.label.localeCompare(y.label))}
          defaultAccountKeys={accountKey ? [accountKey] : []}
          onCancel={() => setBlockDraft(null)}
          onSaved={() => {
            setBlockDraft(null);
            refreshBlocks();
          }}
        />
      )}

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
                      <Item onClick={() => applyZ('front')} kbd="⌘⇧]">Bring to front</Item>
                      <Item onClick={() => applyZ('forward')} kbd="⌘]">Bring forward</Item>
                      <Item onClick={() => applyZ('backward')} kbd="⌘[">Send backward</Item>
                      <Item onClick={() => applyZ('back')} kbd="⌘⇧[">Send to back</Item>
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
                  {multi && (
                    <Item onClick={() => duplicateElements(selectedIds)} kbd="⌘D">
                      Duplicate ({selectedIds.length})
                    </Item>
                  )}
                  <Item onClick={saveSelectionAsBlock}>Save as block…</Item>
                  <Sep />
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

/** A `?` info icon with a Loomi tooltip — used to clarify builder controls. */
function InfoTip({ text }: { text: React.ReactNode }) {
  return (
    <Tooltip label={text}>
      <QuestionMarkCircleIcon
        className="h-3.5 w-3.5 cursor-help text-[var(--muted-foreground)]/70 transition-colors hover:text-[var(--foreground)]"
        onClick={(e) => e.stopPropagation()}
      />
    </Tooltip>
  );
}

/** A form-control label + optional `?` hint tooltip. */
function HintLabel({ label, hint, className = '' }: { label: string; hint?: React.ReactNode; className?: string }) {
  return (
    <span className={`mb-1 flex items-center gap-1 text-[var(--muted-foreground)] ${className}`}>
      {label}
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

function SelectRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <HintLabel label={label} hint={hint} />
      {children}
    </div>
  );
}

function ToggleRow({ label, hint, on, onClick }: { label: string; hint?: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors ${
        on ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
      }`}
    >
      <span className="flex items-center gap-1">{label}{hint && <InfoTip text={hint} />}</span>
      <span className={`h-3.5 w-3.5 rounded-sm border ${on ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)]'}`} />
    </button>
  );
}


function LabeledInput({
  label,
  hint,
  value,
  onChange,
  type,
}: {
  label: string;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <HintLabel label={label} hint={hint} />
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
      />
    </label>
  );
}

/**
 * A minimal custom dropdown styled to match `LabeledInput` (same border /
 * `--card` background / compact size) so the Fields editor's Type control reads
 * as one of the text fields, not a heavier native-looking select.
 */
function CompactSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] outline-none transition-colors hover:border-[var(--primary)] focus:border-[var(--primary)]"
      >
        <span className="truncate">{sel?.label ?? value}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-lg backdrop-blur-2xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-xs transition-colors ${
                o.value === value ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <CheckIcon className="h-3 w-3 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
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

/** Group picker — pick an existing group (so a designer sees where other fields
 *  live) or create a new one inline. Preserves the typed name as-is. */
function FieldRow({
  field,
  index,
  expanded,
  defaultValue,
  accountKey,
  brandLogos,
  allFields,
  groupNames,
  onToggle,
  onUpdate,
  onRename,
  onDelete,
  onDuplicate,
  onSetDefault,
  onMoveToGroup,
}: {
  field: FieldSpec;
  index: number;
  expanded: boolean;
  defaultValue: string;
  accountKey?: string;
  brandLogos: { key: string; label: string; url: string }[];
  /** Sibling fields — for the "Show only when" conditional-visibility picker. */
  allFields: FieldSpec[];
  /** All section names, ordered — for the ⋯ "Move to group" picker. */
  groupNames: string[];
  onToggle: () => void;
  onUpdate: (i: number, patch: Partial<FieldSpec>) => void;
  onRename: (i: number, newKey: string) => void;
  onDelete: (i: number) => void;
  onDuplicate: (i: number) => void;
  onSetDefault: (i: number, val: string) => void;
  onMoveToGroup: (key: string, group: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Two-level ⋯ menu: the root actions, or the "Move to group" section list.
  const [showMoveList, setShowMoveList] = useState(false);
  // Whether the "Show only when" section is shown in the editor — on if the field
  // already has a condition, or the designer picks "Conditional field" in the ⋯ menu.
  const [showConditional, setShowConditional] = useState(!!field.visibleWhen);
  // Advanced options collapsed by default — these forms get long; show only the
  // high-level fields (Label / Type / Default) until the designer opts in.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) { setShowMoveList(false); return; }
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);
  // The field that gates this one's visibility (for the "Show only when" UI).
  const condField = field.visibleWhen ? allFields.find((f) => f.key === field.visibleWhen!.field) : undefined;
  // Color-coded type badge/icon + this field's current section (to exclude it
  // from the "Move to group" list).
  const typeMeta = FIELD_TYPE_META[field.type];
  const currentGroup = field.group?.trim() || DEFAULT_GROUP;
  return (
    // Subtle fill so a field row lifts off the group section it sits in (they
    // otherwise share the panel background and blend together); the opened row
    // gets a slight outline so the active one reads clearly.
    <div
      className={`rounded-lg border bg-[var(--muted)]/40 ${
        expanded ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/30' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="shrink-0" style={{ color: typeMeta.color }} title={field.type}>
            <typeMeta.Icon className="h-3 w-3" />
          </span>
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--foreground)]">{field.label || field.key}</span>
          <span className="shrink-0 text-[8px] font-medium uppercase tracking-wide" style={{ color: typeMeta.color }}>{field.type}</span>
          {field.copy && <span className="shrink-0 rounded bg-[var(--primary)]/10 px-1 text-[9px] font-medium text-[var(--primary)]">AI</span>}
          {field.audience === 'internal' && (
            <Tooltip label="Internal only — hidden from clients">
              <EyeSlashIcon className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
            </Tooltip>
          )}
          {field.visibleWhen && (
            <Tooltip label="Conditional field">
              <BranchIcon className="h-3 w-3 shrink-0 text-[var(--primary)]" />
            </Tooltip>
          )}
        </button>
        {/* Subtle peek at the default/preview value so a designer can scan values
            without expanding each row (image fields skip it — the value is a URL). */}
        {field.type !== 'image' && defaultValue.trim() && (
          <span className="max-w-[45%] shrink truncate text-right text-[11px] text-[var(--muted-foreground)]/80" title={defaultValue}>
            {defaultValue}
          </span>
        )}
        {/* Row menu — Conditional field + Delete (replaces the bare trash icon). */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="More"
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-[90] mt-1 w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card-strong)] py-1 shadow-2xl backdrop-blur-2xl">
              {showMoveList ? (
                <>
                  <button
                    onClick={() => setShowMoveList(false)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <ChevronLeftIcon className="h-3 w-3" />
                    Move to group
                  </button>
                  <div className="max-h-52 overflow-y-auto">
                    {groupNames.map((g) => (
                      <button
                        key={g}
                        onClick={() => { if (g !== currentGroup) onMoveToGroup(field.key, g); setMenuOpen(false); }}
                        disabled={g === currentGroup}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--muted)] ${g === currentGroup ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${g === currentGroup ? 'bg-[var(--primary)]' : 'bg-transparent'}`} />
                        <span className="truncate">{g}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowMoveList(true)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <FolderArrowDownIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    Move to group
                    <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  </button>
                  <button
                    onClick={() => { setShowConditional(true); if (!expanded) onToggle(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <BranchIcon className="h-3.5 w-3.5 text-[var(--primary)]" />
                    Conditional field
                  </button>
                  <button
                    onClick={() => { onDuplicate(index); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <Square2StackIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => { onDelete(index); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-[var(--border)] px-3 py-3 text-xs">
          {/* Basic — the high-level fields filled most often. */}
          <div className="grid grid-cols-2 gap-2">
            <LabeledInput label="Label" hint="What the client sees above this field in the form." value={field.label} onChange={(v) => onUpdate(index, { label: v })} />
            <SelectRow label="Type" hint="How the client fills this field: plain text, number, a date picker, a color, an image picker, or a dropdown (select).">
              <CompactSelect value={field.type} onChange={(v) => onUpdate(index, { type: v as FieldType })} options={FIELD_TYPE_OPTIONS} />
            </SelectRow>
          </div>
          {/* Filled by — who edits this field on the creative form. */}
          <SelectRow label="Filled by" hint="Who fills this field on the creative form. Client: the client sees and edits it. Internal: only you/managers — hidden from clients (managers always see every field).">
            <CompactSelect value={field.audience ?? 'client'} onChange={(v) => onUpdate(index, { audience: v === 'internal' ? 'internal' : undefined })} options={AUDIENCE_OPTIONS} />
          </SelectRow>
          {/* Default / preview value — the fallback shown in the picker thumb,
              builder canvas, and client form until the client fills it in. For
              image fields this is a media picker so a designer can drop a dummy
              jellybean; everything else is a plain text box. */}
          {field.type === 'image' ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Default / preview image</label>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--muted)]/40">
                  {defaultValue ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={defaultValue} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <PhotoIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    {defaultValue ? 'Replace' : 'Choose / upload'}
                  </button>
                  {defaultValue && (
                    <button
                      type="button"
                      onClick={() => onSetDefault(index, '')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-red-500/50 hover:text-red-500"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <LabeledInput label="Default / preview value" hint="Shown in the preview + client form until the client edits it — great for mock data (e.g. “36”). A {{token}} here resolves against the other fields." value={defaultValue} onChange={(v) => onSetDefault(index, v)} />
          )}
          {field.type === 'image' && (
            <SelectRow label="Source" hint="Where the picture comes from. Manual: the client uploads or picks from the media library. Vehicle image (EVOX): the client picks a vehicle + paint color from the vehicle-image library. Both: offer the manual inputs and the vehicle picker.">
              <CompactSelect value={field.imageSource ?? 'manual'} onChange={(v) => onUpdate(index, { imageSource: v as 'manual' | 'evox' | 'both' })} options={IMAGE_SOURCE_OPTIONS} />
            </SelectRow>
          )}
          {field.type === 'select' && <SelectOptionsEditor options={field.options ?? []} onChange={(opts) => onUpdate(index, { options: opts })} />}
          {/* Conditional visibility — opt-in via the ⋯ menu. Shows this field only
              when another field has a given value (e.g. Lease fields only when
              Offer type = Lease). Honored by the client form + AI via isFieldVisible. */}
          {showConditional && (
            <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--foreground)]">
                  <BranchIcon className="h-3.5 w-3.5 text-[var(--primary)]" />
                  Show only when
                  <InfoTip text="This field appears only when the chosen field equals one of the selected values. Turn off to always show it." />
                </span>
                <button
                  onClick={() => { onUpdate(index, { visibleWhen: undefined }); setShowConditional(false); }}
                  title="Turn off conditional visibility"
                  className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <CompactSelect
                value={field.visibleWhen?.field ?? ''}
                onChange={(fk) =>
                  onUpdate(index, {
                    visibleWhen: fk ? { field: fk, in: field.visibleWhen?.field === fk ? field.visibleWhen.in : [] } : undefined,
                  })
                }
                options={[{ value: '', label: 'Choose a field…' }, ...allFields.filter((f) => f.key !== field.key && f.key).map((f) => ({ value: f.key, label: f.label || f.key }))]}
              />
              <div className="py-1 text-center text-sm font-semibold text-[var(--muted-foreground)]">=</div>
              {condField?.type === 'select' && condField.options?.length ? (
                <MultiSelect
                  value={field.visibleWhen?.in ?? []}
                  onChange={(vals) => field.visibleWhen && onUpdate(index, { visibleWhen: { field: field.visibleWhen.field, in: vals } })}
                  options={condField.options.map((o) => ({ value: o.value, label: o.label }))}
                  placeholder="any value"
                />
              ) : (
                <input
                  value={field.visibleWhen?.in.join(', ') ?? ''}
                  disabled={!field.visibleWhen?.field}
                  onChange={(e) => field.visibleWhen && onUpdate(index, { visibleWhen: { field: field.visibleWhen.field, in: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })}
                  placeholder={field.visibleWhen?.field ? 'value(s), comma-separated' : 'choose a field first'}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
                />
              )}
            </div>
          )}
          {/* Advanced — technical / optional bits, hidden until opened so the
              common case (Label / Type / Default) stays short. */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between rounded-md py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <span className="flex items-center gap-1.5"><Cog6ToothIcon className="h-3.5 w-3.5" />Advanced options</span>
            {showAdvanced ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
          </button>
          {showAdvanced && (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-2.5">
              <LabeledInput label="Key" hint="The internal id used in {{variable}} tokens and element bindings (e.g. {{leaseTerm}}). Must be unique — renaming updates every reference automatically. Use the ⋯ menu’s “Move to group” to change this field’s section." value={field.key} onChange={(v) => onRename(index, v)} />
              <LabeledInput label="Placeholder" hint="Faint hint text inside the empty input on the client form (not a real value)." value={field.placeholder ?? ''} onChange={(v) => onUpdate(index, { placeholder: v || undefined })} />
              <LabeledInput label="Help" hint="A one-line note shown under this field on the client form to guide what they enter." value={field.help ?? ''} onChange={(v) => onUpdate(index, { help: v || undefined })} />
              <div className="grid grid-cols-2 items-end gap-2">
                <LabeledInput
                  label="Max length"
                  hint="Optional character cap — a fit hint for on-canvas text and a limit the AI copywriter respects."
                  type="number"
                  value={field.maxLength != null ? String(field.maxLength) : ''}
                  onChange={(v) => onUpdate(index, { maxLength: v ? Number(v) : undefined })}
                />
                <ToggleRow label="AI may write" hint="Let the AI copywriter fill this field. Use for marketing copy (headline, tagline) — never for data/price/legal, which the AI must not change." on={!!field.copy} onClick={() => onUpdate(index, { copy: field.copy ? undefined : true })} />
              </div>
            </div>
          )}
        </div>
      )}
      {picking && (
        <MediaPickerModal
          accountKey={accountKey}
          showCategories
          showFolders
          brandingMedia={brandLogos.map((l) => ({ label: `${l.label} logo`, url: l.url }))}
          onSelect={(url) => {
            onSetDefault(index, url);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/**
 * Manage the template's fields — the form users fill, and what AI copy and
 * element bindings read. Renaming a key cascades to bindings; deleting a field
 * detaches any element bound to it.
 */
/** Small 6-dot drag handle. */
function GripDots({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.1" /><circle cx="7.5" cy="3" r="1.1" />
      <circle cx="2.5" cy="8" r="1.1" /><circle cx="7.5" cy="8" r="1.1" />
      <circle cx="2.5" cy="13" r="1.1" /><circle cx="7.5" cy="13" r="1.1" />
    </svg>
  );
}

/** "Don't show this again" checkbox for the delete-section confirm dialog —
 *  reports its value up so the caller can persist the opt-out. */
function DontShowAgainCheckbox({ onChange }: { onChange: (v: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { const v = !checked; setChecked(v); onChange(v); }}
      className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
    >
      <span className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${checked ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)]'}`}>
        {checked && <CheckIcon className="h-3 w-3" />}
      </span>
      Don’t show this again
    </button>
  );
}

/** A single input control for the form preview — mirrors how the creative form
 *  renders each field type (label + help + placeholder), so a designer sees the
 *  shape at a glance. Interactive only to test conditional visibility. */
function PreviewControl({ field, value, onChange, internalBadge }: { field: FieldSpec; value: string; onChange: (v: string) => void; internalBadge?: boolean }) {
  const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';
  return (
    <div className={internalBadge ? 'rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-2' : ''}>
      <label className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
        <span>{field.label || field.key}</span>
        {internalBadge && (
          <span className="inline-flex items-center gap-1 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <EyeSlashIcon className="h-2.5 w-2.5" />Internal
          </span>
        )}
        {field.help && <span className="w-full font-normal text-[var(--muted-foreground)]">{field.help}</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} rows={2} className={inputCls} />
      ) : field.type === 'select' ? (
        <CompactSelect value={value} onChange={onChange} options={[{ value: '', label: field.placeholder || 'Select…' }, ...(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))]} />
      ) : field.type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent" />
          <input type="text" value={value} placeholder={field.placeholder || '#000000'} onChange={(e) => onChange(e.target.value)} className={inputCls} />
        </div>
      ) : field.type === 'image' ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          <PhotoIcon className="h-4 w-4 shrink-0" />
          {field.imageSource === 'evox' ? 'Vehicle image picker' : field.imageSource === 'both' ? 'Upload / library or vehicle picker' : 'Upload / media library'}
        </div>
      ) : (
        <input type={field.type === 'date' ? 'date' : 'text'} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}

/** Live form preview built from the current fields — shows the designer what the
 *  creative form looks like, with a Client/Full switch (Client hides fields the
 *  designer marked Internal). Honors conditional visibility as you type. */
function FormPreview({ fields, fieldGroups, defaults }: { fields: FieldSpec[]; fieldGroups: string[]; defaults: Record<string, string> }) {
  const [view, setView] = useState<'client' | 'full'>('client');
  const [vals, setVals] = useState<Record<string, string>>({});
  const data = useMemo(() => ({ ...defaults, ...vals }), [defaults, vals]);
  const setVal = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));
  const internalCount = useMemo(() => fields.filter((f) => !isClientField(f)).length, [fields]);
  const groups = useMemo(() => {
    const m = new Map<string, FieldSpec[]>();
    for (const f of fields) {
      if (view === 'client' && !isClientField(f)) continue;
      if (!isFieldVisible(f, data)) continue; // conditional visibility
      const g = f.group?.trim() || DEFAULT_GROUP;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(f);
    }
    const rank = (g: string) => { const i = fieldGroups.indexOf(g); return i < 0 ? fieldGroups.length + 1 : i; };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [fields, fieldGroups, data, view]);
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-0.5 border-b border-[var(--border)] p-3">
        <div className="flex flex-1 items-center gap-0.5 rounded-lg border border-[var(--border)] p-0.5">
          {(['client', 'full'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${view === v ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
            >
              {v === 'client' ? 'Client view' : 'Full form'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
          {view === 'client'
            ? internalCount > 0
              ? `What a client sees and fills in — ${internalCount} internal field${internalCount === 1 ? '' : 's'} hidden here.`
              : 'What a client fills in. Every field is client-facing right now — set a field’s “Filled by” to Internal to hide it from clients.'
            : 'Every field. Dashed rows tagged “Internal” are hidden from clients (only you fill them in).'}
        </p>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
            {view === 'client' ? 'No client-facing fields yet — mark fields “Client”, or add some.' : 'No fields yet.'}
          </p>
        ) : (
          groups.map(([group, fs]) => (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{group}</h3>
              <div className="space-y-3">
                {fs.map((f) => (
                  <PreviewControl key={f.key} field={f} value={vals[f.key] ?? defaults[f.key] ?? ''} onChange={(v) => setVal(f.key, v)} internalBadge={view === 'full' && !isClientField(f)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

// Compliance status chip for the canvas action bar: a compact warning (or green
// "compliant") that opens a per-offer-type breakdown on click. Each missing field
// is an "insert" button that adds it to the template + drops it on the artboard.
function ComplianceChip({
  make,
  compliance,
  missing,
  onInsert,
}: {
  make: string;
  compliance: { type: { value: string; label: string }; missing: string[] }[];
  missing: number;
  onInsert: (key: string, offerType: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const ok = missing === 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${make} compliance`}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${ok ? 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400' : 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'}`}
      >
        {ok ? <CheckIcon className="h-4 w-4" strokeWidth={2.5} /> : <ExclamationTriangleIcon className="h-4 w-4" />}
        <span>{ok ? `${make} compliant` : `${missing} required field${missing === 1 ? '' : 's'} missing`}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[95] mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-3 shadow-2xl backdrop-blur-2xl">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[var(--foreground)]">{make} compliance</span>
            <span className={`ml-auto text-[10px] font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {ok ? 'All required fields present' : `${missing} missing`}
            </span>
          </div>
          <p className="mb-2 text-[10px] leading-snug text-[var(--muted-foreground)]">
            Required by the {make} OEM rule per offer type. Missing fields block export of that offer type until added to the template&apos;s fields.
          </p>
          <div className="space-y-1">
            {compliance.map(({ type, missing: m }) => (
              <div key={type.value} className="flex items-start gap-1.5 text-[11px]">
                {m.length === 0 ? (
                  <CheckIcon className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.5} />
                ) : (
                  <XMarkIcon className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" strokeWidth={2.5} />
                )}
                <span className="w-20 shrink-0 font-medium text-[var(--muted-foreground)]">{type.label}</span>
                {m.length === 0 ? (
                  <span className="text-[var(--muted-foreground)]">Ready</span>
                ) : (
                  <span className="flex flex-1 flex-wrap gap-1">
                    {m.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onInsert(k, type.value)}
                        title={`Insert “${FIELD_LABELS[k] ?? k}” — adds the field + drops it on the artboard`}
                        className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
                      >
                        <PlusIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
                        {FIELD_LABELS[k] ?? k}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupHeaderMenu({
  onRename,
  onDuplicate,
  onDelete,
}: {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More"
        className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <EllipsisVerticalIcon className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[90] mt-1 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card-strong)] py-1 shadow-2xl backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => { onRename(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            <PencilSquareIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => { onDuplicate(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            <Square2StackIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => { onDelete(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function FieldsSidebar({
  fields,
  fieldGroups,
  defaults,
  accountKey,
  brandLogos,
  onClose,
  onAdd,
  onUpdate,
  onRename,
  onDelete,
  onDuplicateField,
  onSetDefault,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onDuplicateGroup,
  onMoveGroup,
  onMoveField,
  presets,
  onApplyPreset,
  onSavePreset,
  onUpdatePreset,
  onDeletePreset,
  canManagePresets,
}: {
  fields: FieldSpec[];
  /** Ordered, designer-defined group names (may include empty groups). */
  fieldGroups: string[];
  defaults: Record<string, string>;
  accountKey?: string;
  brandLogos: { key: string; label: string; url: string }[];
  /** Reusable field-set presets — names only; apply seeds fields, save upserts. */
  presets: string[];
  onApplyPreset: (name: string) => void;
  onSavePreset: () => void;
  /** Overwrite an existing preset with the current fields (managers only). */
  onUpdatePreset: (name: string) => void;
  /** Remove a preset from the registry (managers only). */
  onDeletePreset: (name: string) => void;
  /** Whether this user may save/update/delete presets (unrestricted access). */
  canManagePresets: boolean;
  onClose: () => void;
  onAdd: (group?: string) => void;
  onUpdate: (i: number, patch: Partial<FieldSpec>) => void;
  onRename: (i: number, newKey: string) => void;
  onDelete: (i: number) => void;
  onDuplicateField: (i: number) => void;
  onSetDefault: (i: number, val: string) => void;
  onAddGroup: () => void;
  onRenameGroup: (oldName: string, next: string) => void;
  onDeleteGroup: (name: string) => void;
  onDuplicateGroup: (name: string) => void;
  onMoveGroup: (from: number, to: number) => void;
  onMoveField: (key: string, group: string | undefined, beforeKey?: string) => void;
}) {
  // All field rows start collapsed — the designer opens the one they want.
  // Tracked by the field's flat INDEX (not its `key`): the key is user-editable
  // in Advanced options, and keying expansion/React-key on it made editing the
  // key orphan the expansion + remount the row → the row collapsed mid-edit.
  const [expanded, setExpanded] = useState<number | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Preview mode — swap the editor for a live client-form mock of these fields.
  const [previewOpen, setPreviewOpen] = useState(false);
  // Presets popover (the header cog) — apply a saved field-set or save this one.
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!presetsOpen) return;
    const h = (e: MouseEvent) => { if (!presetsRef.current?.contains(e.target as Node)) setPresetsOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [presetsOpen]);
  // Drag source is tracked in refs (read synchronously in onDrop, unaffected by
  // React's async state) + mirrored to state for the drag visual.
  const [dragGroup, setDragGroup] = useState<number | null>(null);
  const [dragField, setDragField] = useState<string | null>(null);
  // Where the dragged item will land — drives the single insertion line shown at
  // the drop point. For fields it's a BOUNDARY index within a section (0..len),
  // computed once at the section-body level so there's exactly one drop zone per
  // gap (not a per-row before/after pair) and gaps/padding never fall through to
  // an append. For sections it's a before/after edge on the hovered section.
  const [fieldDrop, setFieldDrop] = useState<{ group: string; index: number } | null>(null);
  const [groupDrop, setGroupDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const dragGroupRef = useRef<number | null>(null);
  const dragFieldRef = useRef<string | null>(null);
  const startGroupDrag = (gi: number) => { dragGroupRef.current = gi; dragFieldRef.current = null; setDragGroup(gi); };
  const startFieldDrag = (key: string) => { dragFieldRef.current = key; dragGroupRef.current = null; setDragField(key); };
  const endDrag = () => { dragGroupRef.current = null; dragFieldRef.current = null; setDragGroup(null); setDragField(null); setFieldDrop(null); setGroupDrop(null); };

  // Ordered section list: the designer-defined groups, unioned with any group
  // present on a field — an ungrouped field resolves to the "General" section,
  // so every field has a real, editable home (no separate ungrouped bucket).
  // Mirrors the parent's `currentGroups` so index-based handlers line up. Each
  // field keeps its flat index into `fields` so the handlers hit the right one.
  const GENERAL = DEFAULT_GROUP;
  const orderedNames = useMemo(() => {
    const base = fieldGroups.slice();
    for (const f of fields) { const g = f.group?.trim() || GENERAL; if (!base.includes(g)) base.push(g); }
    return base;
  }, [fieldGroups, fields]);
  const rows = useMemo(() => fields.map((f, i) => ({ f, i })), [fields]);
  const itemsFor = (name: string) => rows.filter(({ f }) => (f.group?.trim() || GENERAL) === name);
  // Auto-open a newly-added group so it isn't lost.
  const prevNames = useRef(new Set(orderedNames));
  useEffect(() => {
    const added = orderedNames.filter((g) => !prevNames.current.has(g));
    if (added.length === 1) setOpenGroups((s) => new Set([...s, added[0]]));
    prevNames.current = new Set(orderedNames);
  }, [orderedNames]);
  const toggleGroup = (g: string) =>
    setOpenGroups((s) => { const next = new Set(s); if (next.has(g)) next.delete(g); else next.add(g); return next; });

  // FLIP animation: after any reorder, tagged nodes glide from their previous
  // position to the new one. Gated on an order signature so expanding/collapsing
  // a row (which doesn't reorder) never animates.
  const flipRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Map<string, number>>(new Map());
  const orderSig = orderedNames.join('|') + '::' + rows.map(({ f }) => `${f.group?.trim() || GENERAL}/${f.key}`).join(',');
  const prevSig = useRef(orderSig);
  useLayoutEffect(() => {
    const container = flipRef.current;
    if (!container) return;
    const changed = prevSig.current !== orderSig;
    container.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((node) => {
      const key = node.dataset.flipKey!;
      const top = node.getBoundingClientRect().top;
      const prev = posRef.current.get(key);
      if (changed && prev !== undefined) {
        const dy = prev - top;
        if (Math.abs(dy) > 1) node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      }
      posRef.current.set(key, top);
    });
    prevSig.current = orderSig;
  });

  const renderFieldRow = (f: FieldSpec, i: number, group: string, pos: number, count: number) => {
    // Lines are driven by the section-body boundary (`fieldDrop.index`): draw
    // above the row sitting at the boundary, or below the last row when the
    // boundary is the section end. Exactly one line, no dead gaps.
    const lineBefore = fieldDrop?.group === group && fieldDrop.index === pos;
    const lineAfter = fieldDrop?.group === group && pos === count - 1 && fieldDrop.index === count;
    return (
      <div
        key={i}
        data-flip-key={`f:${f.key}`}
        data-field-row
        className="relative"
      >
        {lineBefore && <div className="pointer-events-none absolute -top-[5px] left-1 right-1 z-10 h-[2px] rounded-full bg-[var(--primary)]" />}
        <div className={`flex items-start gap-1 rounded-lg transition-[opacity,transform] duration-150 ${dragField === f.key ? 'opacity-40' : ''}`}>
          <span
            draggable
            onDragStart={(e) => { e.stopPropagation(); startFieldDrag(f.key); }}
            onDragEnd={endDrag}
            title="Drag to reorder / move to another group"
            className="mt-2.5 shrink-0 cursor-grab text-[var(--muted-foreground)]/60 hover:text-[var(--foreground)] active:cursor-grabbing"
          >
            <GripDots className="h-3.5 w-2" />
          </span>
          <div className="min-w-0 flex-1">
            <FieldRow
              field={f}
              index={i}
              expanded={expanded === i}
              defaultValue={defaults[f.key] ?? ''}
              accountKey={accountKey}
              brandLogos={brandLogos}
              allFields={fields}
              groupNames={orderedNames}
              onToggle={() => setExpanded(expanded === i ? null : i)}
              onUpdate={onUpdate}
              onRename={onRename}
              onDelete={onDelete}
              onDuplicate={onDuplicateField}
              onSetDefault={onSetDefault}
              onMoveToGroup={(key, g) => onMoveField(key, g)}
            />
          </div>
        </div>
        {lineAfter && <div className="pointer-events-none absolute -bottom-[5px] left-1 right-1 z-10 h-[2px] rounded-full bg-[var(--primary)]" />}
      </div>
    );
  };

  return (
    // Left-docked panel inside the canvas — the form that drives the ad stays
    // open beside the canvas while you design.
    <div data-adgen-panel className="absolute left-4 top-4 bottom-4 z-[70] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[var(--foreground)]">{previewOpen ? 'Form preview' : 'Template fields'}</h2>
          <p className="text-xs text-[var(--muted-foreground)]">{previewOpen ? 'How the fields look on the creative form.' : 'The form users fill — organize them into groups that carry to the client form.'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Preview — flip the panel between editing fields and a live mock of
              the client form built from them. */}
          <button
            onClick={() => { setPreviewOpen((v) => !v); setPresetsOpen(false); }}
            title={previewOpen ? 'Back to editing fields' : 'Preview the form'}
            aria-pressed={previewOpen}
            className={`rounded-md p-1 transition-colors ${previewOpen ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {previewOpen ? <PencilSquareIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
          {/* Presets — apply a saved field-set to this template, or save the
              current fields as a reusable preset. */}
          <div ref={presetsRef} className={`relative ${previewOpen ? 'hidden' : ''}`}>
            <button
              onClick={() => setPresetsOpen((v) => !v)}
              title="Field presets"
              aria-pressed={presetsOpen}
              className={`rounded-md p-1 transition-colors ${presetsOpen ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              <Cog6ToothIcon className="h-5 w-5" />
            </button>
            {presetsOpen && (
              <div className="absolute right-0 top-full z-[95] mt-1 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-2 shadow-2xl backdrop-blur-2xl">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Apply a preset</p>
                <p className="px-2 pb-1.5 text-[11px] leading-snug text-[var(--muted-foreground)]">Fills in a saved set of fields + groups (e.g. Vehicle Offer). Won’t overwrite fields you already have.{canManagePresets ? ' Hover a preset to update or delete it.' : ''}</p>
                <div className="max-h-56 overflow-y-auto">
                  {presets.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] italic text-[var(--muted-foreground)]">No presets saved yet.</p>
                  ) : (
                    presets.map((name) => (
                      // Whole row is the apply target; on hover (or keyboard focus)
                      // managers get inline Update / Delete affordances.
                      <div key={name} className="group flex items-center rounded-md pr-1 transition-colors hover:bg-[var(--muted)]">
                        <button
                          onClick={() => { onApplyPreset(name); setPresetsOpen(false); }}
                          title={`Apply “${name}”`}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--foreground)]"
                        >
                          <RectangleStackIcon className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                          <span className="truncate">{name}</span>
                        </button>
                        {canManagePresets && (
                          <>
                            <button
                              onClick={() => { onUpdatePreset(name); setPresetsOpen(false); }}
                              disabled={fields.length === 0}
                              title={fields.length === 0 ? 'Add some fields first' : 'Update this preset with the current fields'}
                              className="shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-0 transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                            >
                              <ArrowPathIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => { onDeletePreset(name); setPresetsOpen(false); }}
                              title="Delete this preset"
                              className="shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {canManagePresets && (
                  <>
                    <div className="my-1.5 border-t border-[var(--border)]" />
                    <button
                      onClick={() => { onSavePreset(); setPresetsOpen(false); }}
                      disabled={fields.length === 0}
                      title={fields.length === 0 ? 'Add some fields first' : 'Save the current fields as a new reusable preset'}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/10 disabled:opacity-40"
                    >
                      <BookmarkSquareIcon className="h-3.5 w-3.5 shrink-0" />
                      Save current fields as a preset…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} title="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      {previewOpen ? (
        <FormPreview fields={fields} fieldGroups={fieldGroups} defaults={defaults} />
      ) : (
      <>
      <div ref={flipRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {orderedNames.map((group, gi) => {
          const open = openGroups.has(group);
          const items = itemsFor(group);
          const renaming = renamingGroup === group;
          const gLineBefore = groupDrop?.id === group && groupDrop.edge === 'before';
          const gLineAfter = groupDrop?.id === group && groupDrop.edge === 'after';
          const groupKeys = items.map(({ f }) => f.key);
          return (
            <div
              key={group}
              data-flip-key={`g:${group}`}
              className={`relative rounded-lg border transition-[opacity,transform] duration-150 ${dragGroup === gi ? 'opacity-40' : ''} border-[var(--border)]`}
              onDragOver={(e) => {
                if (dragGroupRef.current !== null) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const edge = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
                  setGroupDrop((p) => (p && p.id === group && p.edge === edge ? p : { id: group, edge }));
                } else if (dragFieldRef.current) {
                  e.preventDefault();
                }
              }}
              onDrop={() => {
                const fromG = dragGroupRef.current;
                if (fromG !== null) {
                  const edge = groupDrop?.id === group ? groupDrop.edge : 'before';
                  let target = edge === 'before' ? gi : gi + 1;
                  if (fromG < target) target -= 1; // account for removal before insertion
                  target = Math.max(0, Math.min(target, orderedNames.length - 1));
                  if (target !== fromG) onMoveGroup(fromG, target);
                } else if (dragFieldRef.current) {
                  // Fallback (e.g. dropping on a collapsed section header): append.
                  onMoveField(dragFieldRef.current, group, undefined);
                }
                endDrag();
              }}
            >
              {gLineBefore && <div className="pointer-events-none absolute -top-[5px] left-0 right-0 z-10 h-[2px] rounded-full bg-[var(--primary)]" />}
              {gLineAfter && <div className="pointer-events-none absolute -bottom-[5px] left-0 right-0 z-10 h-[2px] rounded-full bg-[var(--primary)]" />}
              <div className="flex items-center gap-1 px-2 py-2">
                <span
                  draggable
                  onDragStart={() => startGroupDrag(gi)}
                  onDragEnd={endDrag}
                  title="Drag to reorder group"
                  className="shrink-0 cursor-grab text-[var(--muted-foreground)]/60 hover:text-[var(--foreground)] active:cursor-grabbing"
                >
                  <GripDots className="h-4 w-2.5" />
                </span>
                <button type="button" onClick={() => toggleGroup(group)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  {open ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === 'Enter') { onRenameGroup(group, renameDraft); setRenamingGroup(null); } if (e.key === 'Escape') setRenamingGroup(null); }}
                      onBlur={() => { onRenameGroup(group, renameDraft); setRenamingGroup(null); }}
                      className="min-w-0 flex-1 rounded border border-[var(--primary)] bg-[var(--input)] px-1 py-0.5 text-xs font-semibold text-[var(--foreground)] outline-none"
                    />
                  ) : (
                    <span className="truncate text-xs font-semibold text-[var(--foreground)]">{group}</span>
                  )}
                </button>
                <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">{items.length}</span>
                {/* Group actions live in a ⋯ menu, mirroring the field rows. */}
                <GroupHeaderMenu
                  onRename={() => { setRenamingGroup(group); setRenameDraft(group); }}
                  onDuplicate={() => onDuplicateGroup(group)}
                  onDelete={() => onDeleteGroup(group)}
                />
              </div>
              {open && (
                <div
                  className="space-y-2 border-t border-[var(--border)] p-2"
                  onDragOver={(e) => {
                    if (!dragFieldRef.current) return;
                    e.preventDefault();
                    // One boundary for the whole section: the first row whose
                    // midpoint is below the cursor (else the section end). Covers
                    // the gaps + padding too, so a drop never falls through to an
                    // append and there's exactly one drop zone per gap.
                    const rowEls = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-field-row]')];
                    let index = rowEls.length;
                    for (let k = 0; k < rowEls.length; k++) {
                      const r = rowEls[k].getBoundingClientRect();
                      if (e.clientY < r.top + r.height / 2) { index = k; break; }
                    }
                    setGroupDrop(null);
                    setFieldDrop((p) => (p && p.group === group && p.index === index ? p : { group, index }));
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    const src = dragFieldRef.current;
                    if (src) {
                      const index = fieldDrop?.group === group ? fieldDrop.index : groupKeys.length;
                      const beforeKey = index < groupKeys.length ? groupKeys[index] : undefined;
                      if (src !== beforeKey) onMoveField(src, group, beforeKey);
                    }
                    endDrag();
                  }}
                >
                  {items.map(({ f, i }, pos) => renderFieldRow(f, i, group, pos, items.length))}
                  {items.length === 0 && <p className="px-1 py-1 text-[11px] text-[var(--muted-foreground)]">No fields in this group yet.</p>}
                  <button
                    onClick={() => onAdd(group)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add field to {group}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {orderedNames.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-5 text-center">
            <p className="text-xs text-[var(--muted-foreground)]">No fields yet. Create a group, then add fields to it.</p>
          </div>
        )}
      </div>
      <div className="m-4 mt-0">
        <button
          onClick={onAddGroup}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New group
        </button>
      </div>
      </>
      )}
    </div>
  );
}

/**
 * A textarea that highlights `{{field}}` tokens as purple pills. A transparent
 * textarea sits over a styled backdrop that mirrors the text (same font/padding/
 * wrapping) with tokens wrapped in a coloured span; scroll is synced. The caret
 * + editing stay in the real textarea, so behaviour is unchanged.
 */
function TokenTextArea({
  value,
  onChange,
  placeholder,
  options = [],
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Field tokens offered by a `{{` autocomplete (value `field:<key>`). */
  options?: SearchableSelectOption[];
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(0);
  const syncScroll = () => {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    escHtml(value).replace(
      /\{\{\s*[\w.]+\s*\}\}/g,
      (m) => `<span class="rounded bg-[var(--primary)]/15 font-medium text-[var(--primary)]">${m}</span>`,
    ) + '​';

  // Autocomplete: an OPEN `{{` (optionally with a partial key) right before the
  // caret, not yet closed by `}}`. Show matching field tokens; picking inserts
  // `{{key}}`. Typing `{{` alone lists everything.
  const openTok = /\{\{\s*([\w.]*)$/.exec(value.slice(0, caret));
  const partial = openTok ? openTok[1].toLowerCase() : null;
  const matches =
    partial == null
      ? []
      : options.filter((o) => {
          const key = o.value.replace(/^field:/, '');
          return key.toLowerCase().includes(partial) || o.label.toLowerCase().includes(partial);
        }).slice(0, 8);
  const showAc = acOpen && matches.length > 0;

  const insert = (opt: SearchableSelectOption) => {
    const key = opt.value.replace(/^field:/, '');
    const start = caret - (openTok?.[0].length ?? 0);
    const injected = `{{${key}}}`;
    const next = value.slice(0, start) + injected + value.slice(caret);
    onChange(next);
    setAcOpen(false);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = start + injected.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  // Variable picker (the top-right icon): insert `{{key}}` at the caret (or end),
  // with a space if needed so it doesn't glue onto the previous word.
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const pickRef = useRef<HTMLDivElement>(null);
  const pickMatches = options.filter((o) => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return o.value.replace(/^field:/, '').toLowerCase().includes(q) || o.label.toLowerCase().includes(q);
  });
  useEffect(() => {
    if (!pickOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setPickOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickOpen]);
  const insertToken = (opt: SearchableSelectOption) => {
    const key = opt.value.replace(/^field:/, '');
    const pos = Math.min(caret || value.length, value.length);
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const injected = `${before && !/\s$/.test(before) ? ' ' : ''}{{${key}}}`;
    onChange(before + injected + after);
    setPickOpen(false);
    setPickQuery('');
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const p = pos + injected.length;
      ta.focus();
      ta.setSelectionRange(p, p);
      setCaret(p);
    });
  };

  return (
    <div className="relative">
      <div
        ref={backRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent bg-[var(--card)] px-2 py-1.5 text-xs leading-normal text-[var(--foreground)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          setAcOpen(true);
          setAcIdx(0);
        }}
        onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0); }}
        onKeyDown={(e) => {
          if (!showAc) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((i) => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[Math.min(acIdx, matches.length - 1)]); }
          else if (e.key === 'Escape') { e.preventDefault(); setAcOpen(false); }
        }}
        onScroll={syncScroll}
        onBlur={() => setTimeout(() => setAcOpen(false), 120)}
        rows={2}
        placeholder={placeholder}
        spellCheck={false}
        className="relative w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 pr-8 text-xs leading-normal text-transparent caret-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
      />
      {options.length > 0 && (
        <div ref={pickRef} className="absolute right-1.5 top-1.5">
          <button
            type="button"
            title="Insert a variable"
            onClick={() => setPickOpen((o) => !o)}
            className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
              pickOpen ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
            } bg-[var(--card)]`}
          >
            <VariableIcon className="h-3.5 w-3.5" />
          </button>
          {pickOpen && (
            <div className="absolute right-0 top-full z-[90] mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-2xl backdrop-blur-2xl">
              <div className="relative mb-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="Search variables…"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-1 pl-7 pr-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <ul className="max-h-52 overflow-y-auto">
                {pickMatches.length === 0 && <li className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">No variables</li>}
                {pickMatches.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => insertToken(o)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                    >
                      <span className="truncate">{o.label}</span>
                      {o.group && <span className="ml-auto shrink-0 text-[10px] text-[var(--muted-foreground)]">{o.group}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {showAc && (
        <ul className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-2xl backdrop-blur-2xl">
          {matches.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insert(o); }}
                onMouseEnter={() => setAcIdx(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  i === Math.min(acIdx, matches.length - 1) ? 'bg-[var(--primary)] text-white' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {o.group && <span className={`ml-auto shrink-0 text-[10px] ${i === Math.min(acIdx, matches.length - 1) ? 'text-white/70' : 'text-[var(--muted-foreground)]'}`}>{o.group}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Bulk-edit panel for a multi-selection. Mirrors the single panel's typography
 * controls but applies each change to EVERY selected element at once (font,
 * size, weight, alignment, colour, spacing). Values shown reflect the first
 * selected text box; changing one applies to all. Non-text elements in the
 * selection are unaffected by the text controls.
 */
function MultiSelectPanel({
  elements,
  sampleFontSize,
  fontOptions,
  onElAll,
  onBoxAll,
  onBumpSize,
  onDuplicate,
  onSaveAsBlock,
  onDelete,
  onClose,
  shifted,
}: {
  elements: DocElement[];
  sampleFontSize: number;
  fontOptions: FontSelectOption[];
  onElAll: (patch: Partial<DocElement>) => void;
  onBoxAll: (patch: Partial<DocLayoutBox>) => void;
  onBumpSize: (delta: number) => void;
  onDuplicate: () => void;
  onSaveAsBlock: () => void;
  onDelete: () => void;
  onClose: () => void;
  shifted: boolean;
}) {
  const textEls = elements.filter((e) => e.type === 'text');
  const sample = textEls[0];
  return (
    <div
      data-adgen-panel
      className={`absolute bottom-4 top-4 z-[70] flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] shadow-2xl backdrop-blur-2xl ${shifted ? 'right-[360px]' : 'right-4'}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <span className="text-sm font-semibold text-[var(--foreground)]">{elements.length} selected</span>
        <button type="button" onClick={onClose} title="Deselect" aria-label="Deselect" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border)] px-3 py-0.5">
        {textEls.length > 0 ? (
          <>
            <PanelSection title={`Font · ${textEls.length} text ${textEls.length === 1 ? 'box' : 'boxes'}`}>
              <FontSelect value={sample?.fontFamily ?? ''} onChange={(v) => onElAll({ fontFamily: v || undefined })} options={fontOptions} />
              <div className="mt-2 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <BarBtn title="Smaller (all)" onClick={() => onBumpSize(-2)}>
                    <MinusIcon className="h-4 w-4" />
                  </BarBtn>
                  <input
                    type="number"
                    aria-label="Font size (all)"
                    defaultValue={sampleFontSize}
                    key={sampleFontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isNaN(n)) onBoxAll({ fontSize: clamp(Math.round(n), 4, 400) });
                    }}
                    className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1.5 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                  <BarBtn title="Larger (all)" onClick={() => onBumpSize(2)}>
                    <PlusIcon className="h-4 w-4" />
                  </BarBtn>
                </div>
                <div className="w-28 shrink-0">
                  <FontSelect value={String(sample?.fontWeight ?? 400)} onChange={(v) => onElAll({ fontWeight: Number(v) })} options={WEIGHT_OPTIONS} previewFont={false} />
                </div>
              </div>
            </PanelSection>

            <PanelSection title="Alignment">
              <div className="flex items-center gap-1">
                <BarBtn title="Align left" active={(sample?.align ?? 'left') === 'left'} onClick={() => onElAll({ align: 'left' })}>
                  <Bars3BottomLeftIcon className="h-4 w-4" />
                </BarBtn>
                <BarBtn title="Align center" active={sample?.align === 'center'} onClick={() => onElAll({ align: 'center' })}>
                  <Bars3Icon className="h-4 w-4" />
                </BarBtn>
                <BarBtn title="Align right" active={sample?.align === 'right'} onClick={() => onElAll({ align: 'right' })}>
                  <Bars3BottomRightIcon className="h-4 w-4" />
                </BarBtn>
                <span className="mx-1 h-6 w-px bg-[var(--border)]" />
                <BarBtn title="Uppercase" active={!!sample?.uppercase} onClick={() => onElAll({ uppercase: !sample?.uppercase })}>
                  <span className="text-[11px] font-bold leading-none">Aa</span>
                </BarBtn>
              </div>
            </PanelSection>

            <PanelSection title="Color & spacing">
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Text color</span>
                  <ColorSwatchInput title="Text color (all)" value={sample?.color && sample.color !== 'brand' ? sample.color : '#4f46e5'} onChange={(v) => onElAll({ color: v })} />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Letter</span>
                  <MiniNum title="Letter spacing (px, all)" value={sample?.letterSpacing ?? 0} onChange={(v) => onElAll({ letterSpacing: v ? Math.round(v) : undefined })} />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Line</span>
                  <MiniNum title="Line height (all)" step={0.05} value={sample?.lineHeight ?? 1.1} onChange={(v) => onElAll({ lineHeight: v || undefined })} />
                </label>
              </div>
            </PanelSection>
          </>
        ) : (
          <p className="px-1 py-4 text-xs leading-relaxed text-[var(--muted-foreground)]">
            Select two or more <span className="text-[var(--foreground)]">text boxes</span> to mass-edit their font, size, weight, colour, and spacing.
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-[var(--border)] p-3">
        <button
          type="button"
          onClick={onSaveAsBlock}
          title="Save these elements as a reusable block"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <Squares2X2Icon className="h-4 w-4" />
          Save as block
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          title="Duplicate all"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-red-500/50 hover:text-red-500"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
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
  contentSources,
  onContentChange,
  accountKey,
  onEl,
  onBox,
  onSetSizing,
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
  contentSources: SearchableSelectOption[];
  onContentChange: (value: string) => void;
  accountKey?: string;
  onEl: (patch: Partial<DocElement>) => void;
  onBox: (patch: Partial<DocLayoutBox>) => void;
  /** Text only: set the sizing mode — fixed (wrap) / hug (box follows text).
   *  Re-hugs when switching to hug. */
  onSetSizing: (mode: 'hug' | 'fit') => void;
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
  const kindColor = KIND_COLOR[elementKind(el)];
  const [picking, setPicking] = useState(false);
  const isImageEl = el.type === 'image' || el.type === 'logo' || el.type === 'background';
  // Text sizing mode. Hug (default): the box follows the text (W/H auto, resizing
  // scales the font). Fit to box: a fixed W×H frame; the text auto-scales to fill
  // it (W/H editable, the font stepper becomes an "auto" note).
  const sizingMode: 'hug' | 'fit' = el.autoSize ? 'hug' : 'fit';
  const isHug = el.type === 'text' && sizingMode === 'hug';
  const isFit = el.type === 'text' && sizingMode === 'fit';
  const applyFontSize = (next: number) => {
    const n = clamp(Math.round(next), 4, 400);
    if (isHug && fontSize > 0) {
      const r = n / fontSize;
      const w = box.w * r;
      const h = box.h * r;
      const align = el.align ?? 'left';
      const x = align === 'center' ? box.x + box.w / 2 - w / 2 : align === 'right' ? box.x + box.w - w : box.x;
      const y = box.y + box.h / 2 - h / 2;
      onBox({ fontSize: n, w, h, x, y });
    } else {
      onBox({ fontSize: n });
    }
  };
  // Field/offer tokens a designer can drop into text as {{key}}.
  const insertableVars = contentSources.filter((o) => o.value.startsWith('field:'));

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
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${kindColor}1f`, color: kindColor }}>{typeLabel}</span>
        </div>
        <button type="button" onClick={onClose} title="Deselect" aria-label="Deselect" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border)] px-3 py-0.5">
        {/* Content — for IMAGES, pick what the element shows (a field / brand /
            uploaded image) via "Shows". For TEXT, there's no "Shows": you write
            free text and drop {{variables}} (the icon in the field), which
            resolve to live values. */}
        {content && content.mode !== 'none' && (
          <PanelSection title="Content">
            {isImageEl && contentSources.length > 0 && (
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">Shows</label>
                <SearchableSelect
                  value={bindingToSourceValue(el.binding)}
                  onChange={(v) => onEl({ binding: sourceValueToBinding(v, content.value) })}
                  options={contentSources}
                  className="w-full"
                />
              </div>
            )}
            {content.mode === 'text-edit' && (
              <>
                {/* Variable-aware text: {{field}} tokens render as purple pills;
                    typing {{ opens an autocomplete, or use the variable icon. */}
                <TokenTextArea value={content.value} onChange={onContentChange} options={insertableVars} placeholder="Type text — add {{variables}} with the icon →" />
              </>
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
              {isHug ? (
                <span title="Auto — the box hugs the text" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1 text-center text-[11px] italic text-[var(--muted-foreground)]">auto</span>
              ) : (
                <MiniNum title="Width (px)" value={Math.round(box.w * sizeW)} onChange={(v) => onBox({ w: Math.max(1, v) / sizeW })} />
              )}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              H
              {isHug ? (
                <span title="Auto — the height hugs the text" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1 text-center text-[11px] italic text-[var(--muted-foreground)]">auto</span>
              ) : (
                <MiniNum title="Height (px)" value={Math.round(box.h * sizeH)} onChange={(v) => onBox({ h: Math.max(1, v) / sizeH })} />
              )}
            </label>
          </div>
        </PanelSection>

        {el.type === 'text' && (
          <>
            <PanelSection title="Font">
              <FontSelect value={el.fontFamily ?? ''} onChange={(v) => onEl({ fontFamily: v || undefined })} options={fontOptions} />
              <div className="mt-2 flex items-center gap-2">
                {/* Fit to box: the font auto-scales to the frame, so the size
                    stepper is replaced by an "auto" note. */}
                {isFit ? (
                  <div className="flex-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1.5 text-center text-[11px] italic text-[var(--muted-foreground)]">Auto — fits the box</div>
                ) : (
                  <div className="flex flex-1 items-center gap-1">
                    <BarBtn title="Smaller" onClick={() => applyFontSize(fontSize - 2)}>
                      <MinusIcon className="h-4 w-4" />
                    </BarBtn>
                    <input
                      type="number"
                      aria-label="Font size"
                      value={fontSize}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isNaN(n)) applyFontSize(n);
                      }}
                      className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1.5 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <BarBtn title="Larger" onClick={() => applyFontSize(fontSize + 2)}>
                      <PlusIcon className="h-4 w-4" />
                    </BarBtn>
                  </div>
                )}
                <div className="w-28 shrink-0">
                  <FontSelect value={String(el.fontWeight ?? 400)} onChange={(v) => onEl({ fontWeight: Number(v) })} options={WEIGHT_OPTIONS} previewFont={false} />
                </div>
              </div>
            </PanelSection>

            {/* Sizing — how the box and text relate:
                • Hug (default): the box follows the text (no wrap); resizing scales the font.
                • Fit to box:    a fixed W×H frame; the text auto-scales to fill it. */}
            <PanelSection title="Sizing">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs font-medium text-[var(--foreground)]">
                  Fit to box
                  <Tooltip label="On: a fixed frame — drag W and H and the text auto-scales to fill it, staying put as the value changes (aligns horizontally + vertically). Off: the box hugs the text — type to resize it, Enter for a new line.">
                    <InformationCircleIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]" />
                  </Tooltip>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isFit}
                  onClick={() => onSetSizing(isFit ? 'hug' : 'fit')}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${isFit ? 'bg-[var(--primary)]' : 'border border-[var(--border)] bg-[var(--muted)]'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isFit ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
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
                {/* Vertical alignment — only meaningful inside a Fit-to-box frame. */}
                {isFit && (
                  <>
                    <span className="mx-1 h-6 w-px bg-[var(--border)]" />
                    <BarBtn title="Align top" active={(el.vAlign ?? 'middle') === 'top'} onClick={() => onEl({ vAlign: 'top' })}>
                      <span className="flex h-4 w-4 flex-col justify-start"><span className="h-[2px] w-full rounded bg-current" /></span>
                    </BarBtn>
                    <BarBtn title="Align middle" active={(el.vAlign ?? 'middle') === 'middle'} onClick={() => onEl({ vAlign: undefined })}>
                      <span className="flex h-4 w-4 flex-col justify-center"><span className="h-[2px] w-full rounded bg-current" /></span>
                    </BarBtn>
                    <BarBtn title="Align bottom" active={el.vAlign === 'bottom'} onClick={() => onEl({ vAlign: 'bottom' })}>
                      <span className="flex h-4 w-4 flex-col justify-end"><span className="h-[2px] w-full rounded bg-current" /></span>
                    </BarBtn>
                  </>
                )}
                <span className="mx-1 h-6 w-px bg-[var(--border)]" />
                <BarBtn title="Uppercase" active={!!el.uppercase} onClick={() => onEl({ uppercase: !el.uppercase })}>
                  <span className="text-[11px] font-bold leading-none">Aa</span>
                </BarBtn>
              </div>
            </PanelSection>

            <PanelSection title="Color & spacing">
              <div className="space-y-2.5">
                {/* Button color — the pill background. Only a Button element (a
                    text element WITH a background pill) exposes this; plain text
                    does not. Make a button via Insert → Button. */}
                {el.bg && (
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                    <span>Button color</span>
                    <ColorSwatchInput title="Button color" value={el.bg !== 'brand' ? el.bg : '#4f46e5'} onChange={(v) => onEl({ bg: v })} />
                  </div>
                )}
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Text color</span>
                  <ColorSwatchInput title="Text color" value={el.color && el.color !== 'brand' ? el.color : '#4f46e5'} onChange={(v) => onEl({ color: v })} />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Letter</span>
                  <MiniNum title="Letter spacing (px)" value={el.letterSpacing ?? 0} onChange={(v) => onEl({ letterSpacing: v ? Math.round(v) : undefined })} />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>Line</span>
                  <MiniNum title="Line height" step={0.05} value={el.lineHeight ?? 1.1} onChange={(v) => onEl({ lineHeight: v || undefined })} />
                </label>
                {/* Per-corner radius + per-side padding for the button (same
                    controls as shapes). */}
                {el.bg && <RadiusControl el={el} onEl={onEl} />}
                {el.bg && <PaddingControl el={el} onEl={onEl} />}
              </div>
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
            {kind === 'rect' && <RadiusControl el={el} onEl={onEl} />}
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
            <RadiusControl el={el} onEl={onEl} />
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

/**
 * Dialog to save the current selection as a reusable block. Name + scope —
 * All accounts (global) or a multi-select of specific subaccounts. POSTs to the
 * blocks API and calls onSaved so the Insert panel refreshes.
 */
function SaveBlockDialog({
  payload,
  accountOptions,
  defaultAccountKeys,
  onCancel,
  onSaved,
}: {
  payload: BlockPayload;
  accountOptions: { value: string; label: string }[];
  defaultAccountKeys: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'global' | 'accounts'>(defaultAccountKeys.length ? 'accounts' : 'global');
  const [selected, setSelected] = useState<string[]>(defaultAccountKeys);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give the block a name');
      return;
    }
    if (scope === 'accounts' && selected.length === 0) {
      toast.error('Pick at least one subaccount (or choose All accounts)');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ad-generator/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          accountKeys: scope === 'accounts' ? selected : [],
          doc: payload,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success('Saved as a block');
      onSaved();
    } catch (err) {
      toast.error(`Couldn't save block: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4" onPointerDown={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-2xl backdrop-blur-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
          <Squares2X2Icon className="h-4 w-4" />
          Save as block
        </h3>
        <p className="mb-4 text-xs leading-snug text-[var(--muted-foreground)]">
          Save {payload.elements.length} element{payload.elements.length === 1 ? '' : 's'} as a reusable block you can insert from the Insert panel.
        </p>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. Lease offer block"
          className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Available to</label>
        <div className="mb-3 flex gap-2">
          {([
            { key: 'global' as const, label: 'All accounts' },
            { key: 'accounts' as const, label: 'Specific subaccounts' },
          ]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setScope(opt.key)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                scope === opt.key
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {scope === 'accounts' && (
          <div className="mb-5">
            <MultiSelect
              value={selected}
              onChange={setSelected}
              options={accountOptions}
              placeholder="Select subaccounts…"
              menuZIndex={260}
            />
          </div>
        )}
        {scope === 'global' && <div className="mb-5" />}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save block'}
          </button>
        </div>
      </div>
    </div>
  );
}

type Adder = { label: string; Icon: React.ComponentType<{ className?: string }>; onAdd: () => void; color: string };

/** The element palette — a grid of tiles that drop an element on the canvas.
 *  Shared by the Insert flyout (`panel`) and the empty-canvas onboarding
 *  (`onboarding`); `variant` only tunes density. */
function AdderGrid({ adders, variant }: { adders: Adder[]; variant: 'panel' | 'onboarding' }) {
  const cols = variant === 'panel' ? 'grid-cols-2' : 'grid-cols-5';
  const tile = variant === 'panel' ? 'gap-2 py-4 text-xs' : 'gap-1.5 py-3 text-[10px]';
  return (
    <div className={`grid ${cols} gap-2`}>
      {adders.map((a) => (
        <button
          key={a.label}
          onClick={a.onAdd}
          className={`group flex flex-col items-center justify-center rounded-xl border border-[var(--border)] px-2 font-medium text-[var(--foreground)] transition-all hover:-translate-y-0.5 hover:shadow-md ${tile}`}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = a.color)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
        >
          {/* Colour-coded icon chip (Text=blue, Image=pink, Button=purple, Shape=orange). */}
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
            style={{ backgroundColor: `${a.color}1f`, color: a.color }}
          >
            <a.Icon className="h-5 w-5" />
          </span>
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

/** A color picker that opens a small popover: the subaccount's BRAND colors as
 *  one-click swatches (only when inside a subaccount — an admin/no-account view
 *  shows none), a custom color input + hex field, and a quick "Edit brand
 *  colors" link that opens the subaccount's branding settings in a new tab.
 *  Used by every color control (fill, background, text, button, gradient stops)
 *  so brand colors are one click away wherever a color is set. */
function ColorSwatchInput({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  const { accountData, accountKey } = useAccount();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  // Brand colors only in a subaccount (accountKey set); admin/no-account = none.
  const palette = (accountKey ? accountData?.branding?.colors : undefined) as Record<string, string | undefined> | undefined;
  const brandSwatches = BRAND_COLOR_KEYS
    .map((k) => ({ key: k.key as string, label: k.label as string, value: palette?.[k.key] }))
    .filter((c): c is { key: string; label: string; value: string } => !!c.value);
  const editHref = accountKey ? `/settings/subaccounts/${encodeURIComponent(accountKey)}?tab=branding` : null;
  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 224)) });
    setOpen((v) => !v);
  };
  return (
    <>
      <button ref={btnRef} type="button" title={title} onClick={toggle} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--muted)]">
        <span className="h-4 w-4 rounded-full border border-[var(--border)]" style={{ background: value }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} style={{ top: pos.top, left: pos.left }} className="fixed z-[200] w-52 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-3 shadow-2xl backdrop-blur-2xl">
          {brandSwatches.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Brand colors</p>
              <div className="flex flex-wrap gap-1.5">
                {brandSwatches.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    title={`${c.label} · ${c.value}`}
                    onClick={() => { onChange(c.value); setOpen(false); }}
                    className={`h-7 w-7 rounded-full border transition-transform hover:scale-110 ${c.value.toLowerCase() === value.toLowerCase() ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--card-strong)]' : 'border-[var(--border)]'}`}
                    style={{ background: c.value }}
                  />
                ))}
              </div>
            </div>
          )}
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Custom</p>
          <div className="flex items-center gap-2">
            <label title="Pick a custom color" className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[var(--border)]">
              <span className="h-4 w-4 rounded-full" style={{ background: value }} />
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="sr-only" />
            </label>
            <input
              type="text"
              value={value}
              placeholder="#000000"
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          {editHref && (
            <a href={editHref} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80">
              Edit brand colors
              <ArrowUpRightIcon className="h-3 w-3" />
            </a>
          )}
        </div>,
        document.body,
      )}
    </>
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

/** Per-corner radius control (shared TL/TR/BR/BL box from the email editor, with a
 *  link-all toggle) — seeds from the element's per-corner values or the single
 *  `radius`, and writes the per-corner fields (clearing the legacy `radius`). */
function RadiusControl({ el, onEl }: { el: DocElement; onEl: (patch: Partial<DocElement>) => void }) {
  const base = el.radius ?? 0;
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs text-[var(--muted-foreground)]">Radius</div>
      <CornerBox
        showSteppers
        values={{ tl: el.radiusTL ?? base, tr: el.radiusTR ?? base, br: el.radiusBR ?? base, bl: el.radiusBL ?? base }}
        onChange={(v) =>
          onEl({
            radiusTL: v.tl || undefined,
            radiusTR: v.tr || undefined,
            radiusBR: v.br || undefined,
            radiusBL: v.bl || undefined,
            radius: undefined,
          })
        }
      />
    </div>
  );
}

/** Per-side padding control (shared T/R/B/L box, link-all toggle) — mirrors
 *  RadiusControl. Seeds from the per-side values or the single `padding`, and
 *  writes the per-side fields (clearing the legacy `padding`). */
function PaddingControl({ el, onEl }: { el: DocElement; onEl: (patch: Partial<DocElement>) => void }) {
  const base = el.padding ?? 0;
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs text-[var(--muted-foreground)]">Padding</div>
      <SpacingBox
        showSteppers
        values={{
          top: el.paddingTop ?? base,
          right: el.paddingRight ?? base,
          bottom: el.paddingBottom ?? base,
          left: el.paddingLeft ?? base,
        }}
        onChange={(v) =>
          onEl({
            paddingTop: v.top || undefined,
            paddingRight: v.right || undefined,
            paddingBottom: v.bottom || undefined,
            paddingLeft: v.left || undefined,
            padding: undefined,
          })
        }
      />
    </div>
  );
}

/** Opacity + blend-mode row — the compositing controls shared by shapes and
 *  images so a fill/overlay can tint or knock back what's beneath it. */
function CompositeControls({ el, onEl }: { el: DocElement; onEl: (patch: Partial<DocElement>) => void }) {
  return (
    <div className="mt-3 space-y-2.5">
      <div>
        <div className="mb-1 text-xs text-[var(--muted-foreground)]">Opacity</div>
        <NumberInput
          value={el.opacity ?? 100}
          min={0}
          max={100}
          unit="%"
          slider
          onChange={(v) => {
            const n = Math.max(0, Math.min(100, Math.round(v)));
            onEl({ opacity: n >= 100 ? undefined : n });
          }}
        />
      </div>
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
        [`${mod} [`, 'Send backward'],
        [`${mod} ⇧ ]`, 'Bring to front'],
        [`${mod} ⇧ [`, 'Send to back'],
      ],
    },
    {
      title: 'Move & size',
      rows: [
        ['↑ ↓ ← →', 'Nudge 1px'],
        ['⇧ + arrows', 'Nudge 10px'],
        ['Drag', 'Move element'],
        ['Drag handles', 'Resize'],
        ['⇧ drag', 'Lock aspect ratio'],
        [`${mod} drag`, 'Scale text font'],
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

