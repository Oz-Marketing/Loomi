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
import { toast } from 'sonner';
import {
  PhotoIcon,
  Bars3BottomLeftIcon,
  Bars3Icon,
  Bars3BottomRightIcon,
  BuildingStorefrontIcon,
  RectangleGroupIcon,
  ArrowLeftIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  MinusIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  XMarkIcon,
  ChevronDoubleUpIcon,
  ChevronDoubleDownIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowPathIcon,
  CheckIcon,
  CloudIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { renderDoc } from '@/lib/ad-generator/doc-renderer';
import { buildFontFaceCssFromUrls } from '@/lib/ad-generator/fonts';
import { FontSelect, type FontSelectOption } from '@/components/font-select';
import { vehicleOfferDoc, vehicleOfferPreviewData } from '@/lib/ad-generator/templates/vehicle-offer-doc';
import type { TemplateDoc, DocElement, DocElementType, DocLayoutBox, DocBackground, DocBgFraming } from '@/lib/ad-generator/doc-types';
import type { FieldSpec, FieldType } from '@/lib/ad-generator/types';

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
const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Landscape', width: 1200, height: 628 },
  { label: 'Portrait', width: 1080, height: 1350 },
  { label: 'Story', width: 1080, height: 1920 },
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

const TYPE_ICON: Record<DocElementType, typeof PhotoIcon> = {
  text: Bars3BottomLeftIcon,
  image: PhotoIcon,
  logo: BuildingStorefrontIcon,
  shape: RectangleGroupIcon,
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

/** Friendly display name for an element (its binding, falling back to id). */
function elName(el: DocElement): string {
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
      return { id, type, fit: 'contain' };
    case 'shape':
      return { id, type, fill: 'brand', radius: 8 };
  }
}

export default function AdBuilderPage() {
  const { accountData } = useAccount();

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
  const [showSafe, setShowSafe] = useState(true);
  const [dragBox, setDragBox] = useState<DocLayoutBox | null>(null);
  // Figma-style alignment guides shown while dragging (fractions, or null).
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
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
    () => ({
      ...vehicleOfferPreviewData,
      ...doc.defaults, // designer-set default / preview values for fields
      ...(fontFaceCss ? { fontFaceCss } : {}),
      ...(accountData?.dealer ? { dealerName: accountData.dealer } : {}),
      ...(accountData?.logos?.light ? { logoUrl: accountData.logos.light } : {}),
      ...(accountData?.branding?.colors?.primary ? { brandColor: accountData.branding.colors.primary } : {}),
    }),
    [accountData, fontFaceCss, doc.defaults],
  );

  const html = useMemo(() => renderDoc(doc, previewData, size, { preview: true }), [doc, previewData, size]);

  // The ad scales to fill the canvas pane (measured), with a little padding.
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>();
  const availW = canvasSize.width - CANVAS_PAD;
  const availH = canvasSize.height - CANVAS_PAD;
  const scale = availW > 0 && availH > 0 ? Math.min(availW / size.width, availH / size.height) : Math.min(560 / size.width, 560 / size.height);
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

  // Single-selection shorthand — the per-element toolbar, handles, and action
  // tab only show when exactly one element is selected.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
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

  // Safe-area padding (uniform %, builder-only guide). 0 clears it.
  function setSafeArea(pct: number) {
    const f = clamp(pct, 0, 40) / 100;
    setDoc((prev) => ({ ...prev, safeArea: f > 0 ? { x: f, y: f } : undefined }));
  }

  // ── canvas background ──
  const setBackground = useCallback(
    (patch: Partial<DocBackground>) => {
      setDoc((prev) => ({ ...prev, background: { ...prev.background, ...patch } }));
    },
    [setDoc],
  );
  // Per-size framing of the background image (focal point + zoom), keyed by the
  // current size so one image can be composed differently per aspect ratio.
  const setBgFraming = useCallback(
    (patch: Partial<DocBgFraming>) => {
      setDoc((prev) => ({
        ...prev,
        bgFraming: { ...prev.bgFraming, [sizeId]: { ...prev.bgFraming?.[sizeId], ...patch } },
      }));
    },
    [setDoc, sizeId],
  );
  // Bind the background to a NEW image field (per-ad) and return its key, so the
  // generator form surfaces it for whoever fills the ad.
  const addBackgroundField = useCallback(() => {
    const key = `bgImage_${rid()}`;
    setDoc((prev) => ({
      ...prev,
      fields: [...prev.fields, { key, label: 'Background image', type: 'image', group: 'Background' }],
      background: { ...prev.background, image: { kind: 'field', key } },
    }));
  }, [setDoc]);

  // ── save / load ──
  async function save(asNew = false) {
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

  // ── pointer interactions: single drag · group drag · marquee select ──
  type DragState =
    | { kind: 'single'; handle: Handle; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; elId: string; start: DocLayoutBox; live: DocLayoutBox; targetsX: number[]; targetsY: number[] }
    | { kind: 'group'; sx: number; sy: number; fw: number; fh: number; nw: number; nh: number; sizeId: string; items: { elId: string; start: DocLayoutBox }[]; bounds: { left: number; cx: number; right: number; top: number; cy: number; bottom: number }; minDx: number; maxDx: number; minDy: number; maxDy: number; targetsX: number[]; targetsY: number[]; live: Record<string, DocLayoutBox> }
    | { kind: 'marquee'; left: number; top: number; fw: number; fh: number; startXF: number; startYF: number; rect: { x: number; y: number; w: number; h: number } };
  const dragRef = useRef<DragState | null>(null);

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const moveListener = useCallback((e: PointerEvent) => onMoveRef.current(e), []);
  const upListener = useCallback((e: PointerEvent) => onUpRef.current(e), []);

  // Edges/centers to snap to: every other visible element + canvas + safe area.
  function snapTargets(exclude: Set<string>) {
    const tx = [0, 0.5, 1];
    const ty = [0, 0.5, 1];
    if (doc.safeArea) {
      tx.push(doc.safeArea.x, 1 - doc.safeArea.x);
      ty.push(doc.safeArea.y, 1 - doc.safeArea.y);
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
      }
      d.live = box;
      setDragBox(box);
      setGuides({ x: gx, y: gy });
      moveNode(d.elId, box, d.nw, d.nh);
    } else {
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
    }
  };

  onUpRef.current = () => {
    const d = dragRef.current;
    if (d?.kind === 'single') {
      setBox(d.sizeId, d.elId, d.live);
    } else if (d?.kind === 'group') {
      setDoc((prev) => {
        const lay = { ...(prev.layouts[d.sizeId] ?? {}) };
        for (const id of Object.keys(d.live)) lay[id] = d.live[id];
        return { ...prev, layouts: { ...prev.layouts, [d.sizeId]: lay } };
      });
    } else if (d?.kind === 'marquee') {
      const r = d.rect;
      if (r.w > 0.01 || r.h > 0.01) {
        const hit = placed
          .filter((p) => !p.box.hidden && p.box.x < r.x + r.w && p.box.x + p.box.w > r.x && p.box.y < r.y + r.h && p.box.y + p.box.h > r.y)
          .map((p) => p.el.id);
        setSelectedIds(hit);
      }
    }
    dragRef.current = null;
    setDragBox(null);
    setGroupLive(null);
    setGuides({ x: null, y: null });
    setMarquee(null);
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
    dragRef.current = { kind: 'single', handle, sx: e.clientX, sy: e.clientY, fw: frameW, fh: frameH, nw: size.width, nh: size.height, sizeId: size.id, elId, start: { ...box }, live: { ...box }, targetsX: tx, targetsY: ty };
    setDragBox({ ...box });
    listen();
  }

  function startGroupDrag(e: React.PointerEvent) {
    const lay = doc.layouts[size.id] ?? {};
    const items = selectedIds
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

  function startMarquee(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startXF = (e.clientX - rect.left) / frameW;
    const startYF = (e.clientY - rect.top) / frameH;
    clearSelection();
    dragRef.current = { kind: 'marquee', left: rect.left, top: rect.top, fw: frameW, fh: frameH, startXF, startYF, rect: { x: startXF, y: startYF, w: 0, h: 0 } };
    setMarquee({ x: startXF, y: startYF, w: 0, h: 0 });
    listen();
  }

  // Element pointerdown: Shift toggles selection; otherwise select (or keep a
  // multi-selection) and start a single / group drag.
  function onBoxPointerDown(e: React.PointerEvent, elId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      toggleSelect(elId);
      return;
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
  }, [selectedIds, size.id, deleteElement, setDoc]);

  // ⌘Z / ⌘⇧Z undo-redo — global, but defer to the browser inside text fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Autosave — debounced PATCH once the template exists (has an id). New/unsaved
  // templates require an explicit Save first (there's no row to PATCH yet).
  useEffect(() => {
    if (!templateId) return;
    const snapshot = serializeDoc(doc, templateName, status);
    if (snapshot === savedRef.current) return; // nothing changed since last persist
    const handle = window.setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const res = await fetch(`/api/ad-generator/templates-doc/${templateId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: templateName.trim(), status, doc: { ...doc, name: templateName.trim() } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        savedRef.current = snapshot;
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [doc, templateName, status, templateId]);

  const adders: { type: DocElementType; label: string }[] = [
    { type: 'text', label: 'Text' },
    { type: 'image', label: 'Image' },
    { type: 'logo', label: 'Logo' },
    { type: 'shape', label: 'Shape' },
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

      {/* Editor header bar */}
      <header className="grid flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 pb-3">
        {/* left — back + status */}
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/ad-generator"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            title="Back to the Generator"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Generator
          </Link>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              status === 'published'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-500/30 bg-zinc-500/10 text-[var(--muted-foreground)]'
            }`}
          >
            {status}
          </span>
          {templateId ? (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${saveInfo.cls}`}>
              <saveInfo.Icon className={`h-3.5 w-3.5 ${saveInfo.spin ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{saveInfo.label}</span>
            </span>
          ) : (
            <span className="hidden text-[11px] text-[var(--muted-foreground)] sm:inline">Unsaved</span>
          )}
        </div>

        {/* center — name */}
        <div className="min-w-0 justify-self-center">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Untitled template"
            title="Template name"
            className="w-[min(28rem,60vw)] rounded-lg border border-transparent bg-transparent px-3 py-1 text-center text-lg font-bold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--primary)] focus:bg-[var(--background)]"
          />
        </div>

        {/* right — actions */}
        <div className="flex min-w-0 items-center justify-end gap-2">
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
        <aside className="flex w-[320px] flex-shrink-0 flex-col gap-4 overflow-y-auto pb-1 pr-1">
          {/* Elements — add to the canvas */}
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Elements</h2>
            <div className="grid grid-cols-2 gap-1.5">
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
          </section>

          {/* Layers — the stack of placed elements (top of the list = front) */}
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Layers</h2>
              <span className="text-[11px] text-[var(--muted-foreground)]">{placed.length}</span>
            </div>
            <div className="space-y-1">
              {[...placed].reverse().map(({ el, box }) => {
                const Icon = TYPE_ICON[el.type];
                const isSel = selectedIds.includes(el.id);
                return (
                  <div
                    key={el.id}
                    className={`flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                      isSel ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]/60'
                    } ${box.hidden ? 'opacity-50' : ''}`}
                  >
                    <button
                      onClick={(e) => (e.shiftKey ? toggleSelect(el.id) : selectOne(el.id))}
                      className={`flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left ${isSel ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 opacity-70" />
                      <span className="flex-1 truncate text-xs font-medium">{elName(el)}</span>
                      <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{el.type}</span>
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
              })}
            </div>
          </section>

          {/* Template fields — drive the generator form + AI copy */}
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Fields</h2>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {doc.fields.length} field{doc.fields.length === 1 ? '' : 's'} drive the form
                </p>
              </div>
              <button
                onClick={() => setFieldsOpen(true)}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
              >
                Manage
              </button>
            </div>
          </section>

          {/* Sizes — each has its own independent layout */}
          <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Sizes</h2>
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
                {/* From the shared library (falls back to built-in presets when empty) */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(libSizes.length > 0
                    ? libSizes.map((s) => ({ key: s.id, label: s.name, width: s.width, height: s.height }))
                    : SIZE_PRESETS.map((p) => ({ key: p.label, label: p.label, width: p.width, height: p.height }))
                  ).map((p) => (
                    <button
                      key={p.key}
                      onClick={() => addSize(p.label, p.width, p.height)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-center text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    >
                      {p.label}
                      <span className="block text-[9px] text-[var(--muted-foreground)]">
                        {p.width}×{p.height}
                      </span>
                    </button>
                  ))}
                </div>

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

          {/* Background — canvas fill + a full-bleed image framed per size */}
          <BackgroundPanel
            background={doc.background}
            fields={doc.fields}
            sizeLabel={size.label.split(' ')[0]}
            framing={doc.bgFraming?.[sizeId]}
            onBackground={setBackground}
            onFraming={setBgFraming}
            onAddBackgroundField={addBackgroundField}
          />

        </aside>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
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
            <div className="flex items-center gap-3">
              <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {size.width}×{size.height}
              </span>
              <button
                onClick={() => setShowOutlines((v) => !v)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  showOutlines ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                }`}
              >
                Outlines
              </button>
              {/* Safe-area margins: toggle visibility + set the padding % */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSafe((v) => !v)}
                  title="Show/hide safe-area margins"
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    showSafe && doc.safeArea ? 'border-[#14b8a6] text-[#14b8a6]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                  }`}
                >
                  Margins
                </button>
                <input
                  type="number"
                  value={Math.round((doc.safeArea?.x ?? 0) * 100)}
                  onChange={(e) => setSafeArea(Number(e.target.value))}
                  title="Safe-area padding (%)"
                  className="w-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-center text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
                <span className="text-[10px] text-[var(--muted-foreground)]">%</span>
              </div>
            </div>
          </div>

          <div ref={canvasRef} className="relative flex flex-1 items-center justify-center overflow-auto bg-[var(--muted)]/30 p-6" style={{ userSelect: 'none' }}>
              <div className="relative shadow-lg ring-1 ring-black/5" style={{ width: frameW, height: frameH }}>
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
                  {showSafe && doc.safeArea && (
                    <div
                      className="pointer-events-none absolute z-10 rounded-[2px] border border-dashed border-[#14b8a6]/70"
                      style={{
                        left: doc.safeArea.x * frameW,
                        top: doc.safeArea.y * frameH,
                        width: (1 - 2 * doc.safeArea.x) * frameW,
                        height: (1 - 2 * doc.safeArea.y) * frameH,
                      }}
                    />
                  )}
                  {/* Alignment guides (Figma-style) while dragging */}
                  {dragBox && guides.x != null && (
                    <span className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-[#ec4899]" style={{ left: guides.x * frameW }} />
                  )}
                  {dragBox && guides.y != null && (
                    <span className="pointer-events-none absolute left-0 right-0 z-30 h-px bg-[#ec4899]" style={{ top: guides.y * frameH }} />
                  )}
                  {/* Marquee select rectangle */}
                  {marquee && (
                    <span
                      className="pointer-events-none absolute z-30 rounded-[2px] border border-[var(--primary)] bg-[var(--primary)]/10"
                      style={{ left: marquee.x * frameW, top: marquee.y * frameH, width: marquee.w * frameW, height: marquee.h * frameH }}
                    />
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
                      zIndex: (b.z ?? 0) + 1,
                      cursor: box.hidden ? 'pointer' : 'move',
                      touchAction: 'none',
                    };
                    return (
                      <div
                        key={el.id}
                        onPointerDown={(e) => onBoxPointerDown(e, el.id)}
                        title={box.hidden ? `${elName(el)} (hidden here)` : elName(el)}
                        className="group absolute"
                        style={boxStyle}
                      >
                        <span
                          className={`pointer-events-none absolute inset-0 rounded-[2px] transition-colors ${
                            isSel
                              ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/10'
                              : box.hidden
                                ? 'ring-1 ring-dashed ring-[var(--muted-foreground)]/30 group-hover:ring-[var(--muted-foreground)]/60'
                                : showOutlines
                                  ? 'ring-1 ring-dashed ring-[var(--primary)]/30 group-hover:ring-[var(--primary)]/70'
                                  : 'group-hover:ring-1 group-hover:ring-[var(--primary)]/50'
                          }`}
                        />
                        {isSingleSel && (
                          <>
                            <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {elName(el)}
                            </span>
                            {/* Element actions — a tab anchored to the box's top-right */}
                            <div
                              onPointerDown={(e) => e.stopPropagation()}
                              className="absolute bottom-full right-0 mb-1 flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-lg backdrop-blur-2xl"
                            >
                              <BarBtn title="Bring forward" onClick={bringForward}>
                                <ChevronDoubleUpIcon className="h-4 w-4" />
                              </BarBtn>
                              <BarBtn title="Send back" onClick={sendBack}>
                                <ChevronDoubleDownIcon className="h-4 w-4" />
                              </BarBtn>
                              <BarBtn title="Duplicate" onClick={() => duplicateElement(el.id)}>
                                <DocumentDuplicateIcon className="h-4 w-4" />
                              </BarBtn>
                              <BarBtn title="Hide on this size" onClick={() => toggleHidden(el.id)}>
                                <EyeSlashIcon className="h-4 w-4" />
                              </BarBtn>
                              <BarBtn title="Delete" onClick={() => deleteElement(el.id)} danger>
                                <TrashIcon className="h-4 w-4" />
                              </BarBtn>
                            </div>
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
                </div>
              </div>

              {selected && selectedBox && !selectedBox.hidden && (
                <SelectionToolbar
                  el={selected}
                  box={selectedBox}
                  fontOptions={fontOptions}
                  fields={doc.fields}
                  onEl={updEl}
                  onBox={(patch) => setBox(size.id, selected.id, { ...selectedBox, ...patch })}
                />
              )}
              {selectedIds.length > 1 && (
                <MultiSelectToolbar
                  count={selectedIds.length}
                  onAlign={alignSelected}
                  onDistribute={distributeSelected}
                  canDistribute={selectedIds.length >= 3}
                />
              )}
            </div>

          <div className="flex-shrink-0 border-t border-[var(--border)] px-4 py-1.5 text-center text-[11px] text-[var(--muted-foreground)]">
            {size.label} · drag to move · shift-click or drag a box to multi-select · arrows nudge · Delete removes
          </div>
        </div>
      </div>

      {fieldsOpen && (
        <FieldManagerModal
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
function FieldManagerModal({
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">Template fields</h2>
            <p className="text-xs text-[var(--muted-foreground)]">The form users fill — and what AI copy + element bindings read.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
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
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add field
        </button>
      </div>
    </div>
  );
}

/**
 * Floating contextual toolbar over the canvas (mirrors the flows action bar) —
 * quick, in-context styling for the selected element, font controls first. The
 * full set (binding, geometry, pill, spacing) stays in the left sidebar.
 */
function SelectionToolbar({
  el,
  box,
  fontOptions,
  fields,
  onEl,
  onBox,
}: {
  el: DocElement;
  box: DocLayoutBox;
  fontOptions: FontSelectOption[];
  fields: FieldSpec[];
  onEl: (patch: Partial<DocElement>) => void;
  onBox: (patch: Partial<DocLayoutBox>) => void;
}) {
  const fontSize = box.fontSize ?? 16;

  // ── binding (content source) as a single compact dropdown ──
  const bindingVal = !el.binding ? 'static' : el.binding.kind === 'static' ? 'static' : `${el.binding.kind}:${el.binding.key}`;
  const bindingOpts: FontSelectOption[] = [
    { value: 'static', label: 'Static' },
    { value: 'brand:dealerName', label: 'Brand · Dealer name' },
    { value: 'brand:logoUrl', label: 'Brand · Logo' },
    { value: 'brand:brandColor', label: 'Brand · Color' },
    ...fields.map((f) => ({ value: `field:${f.key}`, label: `Field · ${f.label || f.key}` })),
  ];
  const boundFieldKey = el.binding?.kind === 'field' ? el.binding.key : null;
  if (boundFieldKey && !fields.some((f) => f.key === boundFieldKey)) {
    bindingOpts.push({ value: `field:${boundFieldKey}`, label: `Field · ${boundFieldKey}` });
  }
  const applyBinding = (v: string) => {
    if (v === 'static') onEl({ binding: { kind: 'static', value: el.binding?.kind === 'static' ? el.binding.value : '' } });
    else if (v.startsWith('brand:')) onEl({ binding: { kind: 'brand', key: v.slice(6) as 'dealerName' | 'logoUrl' | 'brandColor' } });
    else if (v.startsWith('field:')) onEl({ binding: { kind: 'field', key: v.slice(6) } });
  };

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-1.5 shadow-lg backdrop-blur-2xl backdrop-saturate-150">
      {/* Content source — every element except shapes binds to data */}
      {el.type !== 'shape' && (
        <>
          <div className="w-40">
            <FontSelect value={bindingVal} onChange={applyBinding} options={bindingOpts} previewFont={false} openUp />
          </div>
          {el.binding?.kind === 'static' && (
            <input
              value={el.binding.value}
              onChange={(e) => onEl({ binding: { kind: 'static', value: e.target.value } })}
              placeholder={el.type === 'text' ? 'Text' : 'Image URL'}
              className="w-36 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          )}
          <BarSep />
        </>
      )}

      {el.type === 'text' && (
        <>
          <div className="w-36">
            <FontSelect value={el.fontFamily ?? ''} onChange={(v) => onEl({ fontFamily: v || undefined })} options={fontOptions} openUp />
          </div>
          <div className="flex items-center gap-0.5">
            <BarBtn title="Smaller" onClick={() => onBox({ fontSize: Math.max(4, fontSize - 2) })}>
              <MinusIcon className="h-4 w-4" />
            </BarBtn>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) onBox({ fontSize: clamp(Math.round(n), 4, 400) });
              }}
              className="w-12 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
            <BarBtn title="Larger" onClick={() => onBox({ fontSize: Math.min(400, fontSize + 2) })}>
              <PlusIcon className="h-4 w-4" />
            </BarBtn>
          </div>
          <div className="w-24">
            <FontSelect value={String(el.fontWeight ?? 400)} onChange={(v) => onEl({ fontWeight: Number(v) })} options={WEIGHT_OPTIONS} previewFont={false} openUp />
          </div>
          <BarSep />
          <BarBtn title="Align left" active={(el.align ?? 'left') === 'left'} onClick={() => onEl({ align: 'left' })}>
            <Bars3BottomLeftIcon className="h-4 w-4" />
          </BarBtn>
          <BarBtn title="Align center" active={el.align === 'center'} onClick={() => onEl({ align: 'center' })}>
            <Bars3Icon className="h-4 w-4" />
          </BarBtn>
          <BarBtn title="Align right" active={el.align === 'right'} onClick={() => onEl({ align: 'right' })}>
            <Bars3BottomRightIcon className="h-4 w-4" />
          </BarBtn>
          <BarSep />
          <ColorSwatchInput title="Text color" value={el.color && el.color !== 'brand' ? el.color : '#4f46e5'} onChange={(v) => onEl({ color: v })} />
          <BarBtn title="Uppercase" active={!!el.uppercase} onClick={() => onEl({ uppercase: !el.uppercase })}>
            <span className="text-[11px] font-bold leading-none">Aa</span>
          </BarBtn>
          <MiniNum title="Letter spacing (px)" value={el.letterSpacing ?? 0} onChange={(v) => onEl({ letterSpacing: v ? Math.round(v) : undefined })} />
          <MiniNum title="Line height" step={0.05} value={el.lineHeight ?? 1.1} onChange={(v) => onEl({ lineHeight: v || undefined })} />
          <BarSep />
          {el.bg ? (
            <>
              <ColorSwatchInput title="Pill background" value={el.bg !== 'brand' ? el.bg : '#4f46e5'} onChange={(v) => onEl({ bg: v })} />
              <BarBtn title="Remove pill background" onClick={() => onEl({ bg: undefined })}>
                <XMarkIcon className="h-4 w-4" />
              </BarBtn>
            </>
          ) : (
            <BarBtn title="Add pill background" onClick={() => onEl({ bg: 'brand', radius: el.radius ?? 999, padding: el.padding ?? 14 })}>
              <span className="text-[10px] font-semibold leading-none">Pill</span>
            </BarBtn>
          )}
        </>
      )}

      {el.type === 'shape' && (
        <>
          <ColorSwatchInput title="Fill" value={el.fill && el.fill !== 'brand' ? el.fill : '#4f46e5'} onChange={(v) => onEl({ fill: v })} />
          <MiniNum title="Corner radius (px)" value={el.radius ?? 0} onChange={(v) => onEl({ radius: v ? Math.round(v) : undefined })} />
        </>
      )}

      {(el.type === 'image' || el.type === 'logo') && (
        <>
          <BarBtn title="Fit (contain)" active={(el.fit ?? 'contain') === 'contain'} onClick={() => onEl({ fit: 'contain' })}>
            <ArrowsPointingInIcon className="h-4 w-4" />
          </BarBtn>
          <BarBtn title="Fill (cover)" active={el.fit === 'cover'} onClick={() => onEl({ fit: 'cover' })}>
            <ArrowsPointingOutIcon className="h-4 w-4" />
          </BarBtn>
        </>
      )}
    </div>
  );
}

/**
 * Background panel — canvas fill + a full-bleed background image. The image
 * always covers the canvas; a per-size focal point (+ zoom) chooses what stays
 * in frame so ONE image works across every aspect ratio. A scrim keeps text
 * legible over photos.
 */
function BackgroundPanel({
  background,
  fields,
  sizeLabel,
  framing,
  onBackground,
  onFraming,
  onAddBackgroundField,
}: {
  background: DocBackground | undefined;
  fields: FieldSpec[];
  sizeLabel: string;
  framing: DocBgFraming | undefined;
  onBackground: (patch: Partial<DocBackground>) => void;
  onFraming: (patch: Partial<DocBgFraming>) => void;
  onAddBackgroundField: () => void;
}) {
  const img = background?.image;
  const imageFields = fields.filter((f) => f.type === 'image');
  const sourceVal = !img ? 'none' : img.kind === 'static' ? 'static' : img.kind === 'field' ? `field:${img.key}` : 'none';

  const onSource = (v: string) => {
    if (v === 'none') onBackground({ image: undefined });
    else if (v === 'static') onBackground({ image: { kind: 'static', value: img?.kind === 'static' ? img.value : '' } });
    else if (v === '__addfield__') onAddBackgroundField();
    else if (v.startsWith('field:')) onBackground({ image: { kind: 'field', key: v.slice(6) } });
  };

  const ov = background?.overlay;
  const fx = framing?.x ?? 0.5;
  const fy = framing?.y ?? 0.5;
  const zoom = framing?.zoom ?? 1;
  const inputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Background</h2>

      {/* Base fill */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--muted-foreground)]">Fill</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onBackground({ accentBar: !background?.accentBar })}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              background?.accentBar
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
            }`}
            title="Thin brand-colored bar across the top"
          >
            Accent bar
          </button>
          <ColorSwatchInput title="Background color" value={background?.color || '#ffffff'} onChange={(v) => onBackground({ color: v, gradient: undefined })} />
        </div>
      </div>

      {/* Image source */}
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <label className="mb-1.5 block text-[11px] text-[var(--muted-foreground)]">Image</label>
        <select value={sourceVal} onChange={(e) => onSource(e.target.value)} className={inputCls}>
          <option value="none">No image</option>
          <option value="static">Custom URL (static)</option>
          {imageFields.map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              Field · {f.label || f.key}
            </option>
          ))}
          <option value="__addfield__">+ New background field…</option>
        </select>

        {img?.kind === 'static' && (
          <input
            value={img.value}
            onChange={(e) => onBackground({ image: { kind: 'static', value: e.target.value } })}
            placeholder="https://…/background.jpg"
            className={`${inputCls} mt-1.5`}
          />
        )}
        {img?.kind === 'field' && (
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Filled per ad in the generator form — field &ldquo;{fields.find((f) => f.key === img.key)?.label || img.key}&rdquo;.
          </p>
        )}
      </div>

      {/* Overlay + per-size framing — only relevant once an image is set */}
      {img && (
        <>
          {/* Scrim */}
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">Darken (scrim)</span>
              <button
                type="button"
                onClick={() => onBackground({ overlay: ov ? undefined : { color: '#000000', opacity: 0.4, direction: 'full' } })}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  ov ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                }`}
              >
                {ov ? 'On' : 'Off'}
              </button>
            </div>
            {ov && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <ColorSwatchInput title="Scrim color" value={ov.color || '#000000'} onChange={(v) => onBackground({ overlay: { ...ov, color: v } })} />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ov.opacity ?? 0.4}
                    onChange={(e) => onBackground({ overlay: { ...ov, opacity: Number(e.target.value) } })}
                    className="flex-1 accent-[var(--primary)]"
                    title="Scrim strength"
                  />
                  <span className="w-8 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">{Math.round((ov.opacity ?? 0.4) * 100)}%</span>
                </div>
                <div className="flex gap-1.5">
                  {(['full', 'top', 'bottom'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onBackground({ overlay: { ...ov, direction: d } })}
                      className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                        (ov.direction ?? 'full') === d
                          ? 'border-[var(--primary)] text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Per-size focal point + zoom */}
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <label className="mb-1.5 block text-[11px] text-[var(--muted-foreground)]">
              Focal point · {sizeLabel} <span className="opacity-70">(keeps the right part in frame)</span>
            </label>
            <div className="flex items-start gap-3">
              <div className="grid grid-cols-3 gap-1">
                {[0, 0.5, 1].map((y) =>
                  [0, 0.5, 1].map((x) => {
                    const active = Math.abs(fx - x) < 0.01 && Math.abs(fy - y) < 0.01;
                    return (
                      <button
                        key={`${x}-${y}`}
                        type="button"
                        onClick={() => onFraming({ x, y })}
                        title={`Focus ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'center'}`}
                        className={`h-5 w-5 rounded-[3px] border transition-colors ${
                          active ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)] bg-[var(--muted)]/40 hover:border-[var(--primary)]'
                        }`}
                      />
                    );
                  }),
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                  <span>Zoom</span>
                  <span className="tabular-nums">{zoom.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => onFraming({ zoom: Number(e.target.value) })}
                  className="mt-1 w-full accent-[var(--primary)]"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Floating toolbar shown when 2+ elements are selected — align the selection to
 * a shared edge/center, and (3+) distribute with equal gaps. Mirrors the
 * single-element SelectionToolbar's chrome.
 */
function MultiSelectToolbar({
  count,
  onAlign,
  onDistribute,
  canDistribute,
}: {
  count: number;
  onAlign: (edge: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom') => void;
  onDistribute: (axis: 'h' | 'v') => void;
  canDistribute: boolean;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-1.5 shadow-lg backdrop-blur-2xl backdrop-saturate-150">
      <span className="px-1.5 text-xs font-medium text-[var(--muted-foreground)]">{count} selected</span>
      <BarSep />
      <BarBtn title="Align left" onClick={() => onAlign('left')}>
        <AlignIcon edge="left" />
      </BarBtn>
      <BarBtn title="Align horizontal centers" onClick={() => onAlign('hcenter')}>
        <AlignIcon edge="hcenter" />
      </BarBtn>
      <BarBtn title="Align right" onClick={() => onAlign('right')}>
        <AlignIcon edge="right" />
      </BarBtn>
      <BarSep />
      <BarBtn title="Align top" onClick={() => onAlign('top')}>
        <AlignIcon edge="top" />
      </BarBtn>
      <BarBtn title="Align vertical centers" onClick={() => onAlign('vmiddle')}>
        <AlignIcon edge="vmiddle" />
      </BarBtn>
      <BarBtn title="Align bottom" onClick={() => onAlign('bottom')}>
        <AlignIcon edge="bottom" />
      </BarBtn>
      {canDistribute && (
        <>
          <BarSep />
          <BarBtn title="Distribute horizontally (equal gaps)" onClick={() => onDistribute('h')}>
            <AlignIcon edge="dist-h" />
          </BarBtn>
          <BarBtn title="Distribute vertically (equal gaps)" onClick={() => onDistribute('v')}>
            <AlignIcon edge="dist-v" />
          </BarBtn>
        </>
      )}
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

function BarSep() {
  return <span className="mx-0.5 h-6 w-px bg-[var(--border)]" />;
}

function ColorSwatchInput({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  return (
    <label title={title} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-[var(--muted)]">
      <span className="h-4 w-4 rounded-full border border-[var(--border)]" style={{ background: value }} />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
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
