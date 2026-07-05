"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  DevicePhoneMobileIcon,
  ComputerDesktopIcon,
  Bars2Icon,
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3Icon,
  Square2StackIcon,
  CheckIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  CodeBracketIcon,
  AdjustmentsHorizontalIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  LinkIcon,
  EyeIcon,
  EyeSlashIcon,
  FunnelIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ClockIcon,
  UserCircleIcon,
  SparklesIcon,
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  EnvelopeIcon,
  QuestionMarkCircleIcon,
  PhotoIcon,
  Squares2X2Icon,
  SunIcon,
  MoonIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { VariablePickerButton } from "@/components/variable-picker";
import { useAccount } from "@/contexts/account-context";
import { useSubaccountHref } from "@/hooks/use-subaccount-href";
import { useUnsavedChanges } from "@/contexts/unsaved-changes-context";
import { useLoomiDialog } from "@/contexts/loomi-dialog-context";
import {
  componentSchemas,
  getAvailableComponents,
  IMAGE_PLACEHOLDER,
  type RepeatableGroup,
} from "@/lib/component-schemas";
import { parseTemplate, type ParsedTemplate } from "@/lib/template-parser";
import { isVisualEditableTemplate, isV2Template, parseV2Template, type EmailTemplate } from "@/lib/email/types";
import { serializeTemplate as serializeTemplateUnified } from "@/lib/template-serializer";
import { V2EditorShell } from "@/lib/email/editor/V2EditorShell";
import {
  buildPreviewVariableMap,
  findMissingPreviewVariables,
  type PreviewContact,
} from "@/lib/preview-variables";
import {
  lintEmailHtml,
  LINT_CATEGORY_LABELS,
  LINT_SEVERITY_RANK,
  type LintIssue,
  type LintCategory,
} from "@/lib/email-lint";
import espVariablesData from "@/data/esp-variables.json";
import { ComponentIcon, SectionsIcon } from "@/components/icon-map";
import { CodeEditor } from "@/components/code-editor";
import { MediaPickerModal } from "@/components/media-picker-modal";
import {
  TemplateIconPickerModal,
  type TemplateIconSelection,
} from "@/components/template-icon-picker-modal";
import { TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT } from "@/lib/ui-events";
import { getStarterTemplate } from "@/lib/template-starters";
import { buildCurrentEmailContext } from "@/lib/template-editor-ai-context";

type EditorMode = "code" | "visual";
type VisualTab = "settings" | "components";
type TextAlignMode = "left" | "center" | "right" | "justify";

const EDITOR_PANEL_DEFAULT_WIDTH = 480;
const EDITOR_PANEL_MIN_WIDTH = 360;
const EDITOR_PANEL_MAX_WIDTH = 920;
const PREVIEW_PANEL_MIN_WIDTH = 360;
const AI_PANEL_WIDTH = 360;
const SPLIT_GAP_PX = 16;
const SPLITTER_WIDTH_PX = 8;
const PANEL_WIDTH_STEP_PX = 24;
const PREVIEW_ZOOM_DEFAULT = 100;
const PREVIEW_ZOOM_MIN = 50;
const PREVIEW_ZOOM_MAX = 200;
const PREVIEW_ZOOM_STEP = 10;
const ICON_UPLOAD_SIZE_PX = 256;

async function rasterizeSvgToPngFile(
  svgMarkup: string,
  fileNameBase: string,
  size = ICON_UPLOAD_SIZE_PX,
) {
  const svgBlob = new Blob([svgMarkup], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Failed to load icon SVG"));
      nextImage.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to prepare icon canvas");
    }

    const sourceWidth = image.naturalWidth || size;
    const sourceHeight = image.naturalHeight || size;
    const scale = Math.min(size / sourceWidth, size / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const x = (size - drawWidth) / 2;
    const y = (size - drawHeight) / 2;

    context.clearRect(0, 0, size, size);
    context.drawImage(image, x, y, drawWidth, drawHeight);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to convert icon to PNG"));
          return;
        }
        resolve(blob);
      }, "image/png");
    });

    return new File(
      [pngBlob],
      `${fileNameBase.replace(/[^a-z0-9-_]+/gi, "-") || "icon"}.png`,
      { type: "image/png" },
    );
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

interface TemplateHistoryVersion {
  id: string;
  createdAt: string;
  size: number;
  createdBy?: string | null;
}

interface SimpleDiffLine {
  line: number;
  current: string;
  snapshot: string;
  kind: "changed" | "added" | "removed";
}

interface AssistantComponentEdit {
  componentIndex?: number;
  key: string;
  value: string;
  reason?: string;
}

interface TemplateBuild {
  mode: "visual" | "code";
  components?: Array<{ type: string; props: Record<string, string> }>;
  html?: string;
  frontmatter?: Record<string, string>;
  baseProps?: Record<string, string>;
}

interface InlineVariableOption {
  token: string;
  label: string;
  description?: string;
}

interface EspVariableCatalogEntry {
  variable: string;
  label: string;
  description?: string;
}

const BASE_INLINE_VARIABLE_OPTIONS: InlineVariableOption[] = (() => {
  const catalog = espVariablesData as Record<string, EspVariableCatalogEntry[]>;
  const byToken = new Map<string, InlineVariableOption>();
  for (const entries of Object.values(catalog)) {
    for (const entry of entries) {
      const token = (entry.variable || "").trim();
      if (!token) continue;
      const key = token.toLowerCase();
      if (byToken.has(key)) continue;
      byToken.set(key, {
        token,
        label: entry.label || token,
        description: entry.description,
      });
    }
  }
  return Array.from(byToken.values());
})();

const INLINE_VARIABLE_TRIGGER_RE = /\{\{([a-zA-Z0-9_.-]*)$/;

function findInlineVariableTrigger(text: string, caret: number) {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const prefix = text.slice(0, safeCaret);
  const match = INLINE_VARIABLE_TRIGGER_RE.exec(prefix);
  if (!match) return null;
  return {
    start: safeCaret - match[0].length,
    end: safeCaret,
    query: match[1] || "",
  };
}

function filterInlineVariableOptions(
  options: InlineVariableOption[],
  query: string,
): InlineVariableOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) => {
    const tokenRaw = option.token.replace(/^\{\{|\}\}$/g, "").toLowerCase();
    return (
      option.label.toLowerCase().includes(q) ||
      tokenRaw.includes(q) ||
      option.token.toLowerCase().includes(q)
    );
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildSimpleDiff(current: string, snapshot: string): SimpleDiffLine[] {
  const currentLines = current.split("\n");
  const snapshotLines = snapshot.split("\n");
  const max = Math.max(currentLines.length, snapshotLines.length);
  const lines: SimpleDiffLine[] = [];

  for (let i = 0; i < max; i += 1) {
    const cur = currentLines[i] ?? "";
    const old = snapshotLines[i] ?? "";
    if (cur === old) continue;
    lines.push({
      line: i + 1,
      current: cur,
      snapshot: old,
      kind: !old ? "added" : !cur ? "removed" : "changed",
    });
  }
  return lines;
}

// --- CSS unit helpers ---
// Strip "px" suffix so user sees just the number
function stripUnit(val: string): string {
  if (!val) return "";
  return val.replace(/px$/i, "");
}
// Ensure a value has "px" when stored (user types "50", we store "50px")
function ensureUnit(val: string): string {
  if (!val) return "";
  const stripped = val.replace(/px$/i, "").trim();
  if (!stripped) return "";
  if (stripped === "0") return "0px";
  // If it's a pure number, append px
  if (/^\d+(\.\d+)?$/.test(stripped)) return `${stripped}px`;
  // Already has a unit or is something like "50%"
  return stripped;
}

const FORCED_MOBILE_STYLE_ID = "loomi-forced-mobile-styles";
const FORCED_MOBILE_NORMALIZE_STYLE_ID = "loomi-forced-mobile-normalize";

function extractMax600MediaBlocks(cssText: string): string[] {
  if (!cssText) return [];
  const blocks: string[] = [];
  const mediaStart = /@media[^{]*max-width\s*:\s*600px[^{]*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaStart.exec(cssText)) !== null) {
    let i = match.index + match[0].length;
    const start = i;
    let depth = 1;
    while (i < cssText.length && depth > 0) {
      const ch = cssText[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    if (depth !== 0) break;
    const body = cssText.slice(start, i - 1).trim();
    if (body) blocks.push(body);
    mediaStart.lastIndex = i;
  }
  return blocks;
}

function syncPreviewMobileStyles(doc: Document, isMobile: boolean) {
  const existing = doc.getElementById(FORCED_MOBILE_STYLE_ID) as HTMLStyleElement | null;
  if (!isMobile) {
    existing?.remove();
    return;
  }

  const forcedRules: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }

    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.MEDIA_RULE) continue;
      const mediaRule = rule as CSSMediaRule;
      if (!/max-width\s*:\s*600px/i.test(mediaRule.conditionText)) continue;
      for (const nestedRule of Array.from(mediaRule.cssRules)) {
        forcedRules.push(nestedRule.cssText);
      }
    }
  }

  // Fallback: some in-body style tags can be omitted from cssRules enumeration in certain states.
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const cssText = styleEl.textContent || "";
    forcedRules.push(...extractMax600MediaBlocks(cssText));
  }

  if (forcedRules.length === 0) {
    existing?.remove();
    return;
  }

  const styleEl = existing || doc.createElement("style");
  styleEl.id = FORCED_MOBILE_STYLE_ID;
  styleEl.textContent = forcedRules.join("\n");
  if (!existing) doc.head?.appendChild(styleEl);
}

function syncPreviewMobileNormalizeStyle(doc: Document, isMobile: boolean) {
  const existing = doc.getElementById(
    FORCED_MOBILE_NORMALIZE_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!isMobile) {
    existing?.remove();
    return;
  }

  const css = `
    html, body {
      overflow-x: hidden !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    table.email-container,
    table[width="600"],
    table[width="600px"],
    table[style*="max-width: 600px"],
    table[style*="max-width:600px"] {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }
    img[width="600"],
    img[width="600px"] {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
    }
    .loomi-btn-row {
      display: block !important;
      width: 100% !important;
    }
    .loomi-btn-row > td,
    .loomi-btn-gap,
    .loomi-btn-gap + td {
      display: block !important;
      width: 100% !important;
      padding-right: 0 !important;
    }
    .loomi-btn-table {
      width: 100% !important;
      max-width: 100% !important;
    }
    .mobile-stack {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    .mobile-full-width {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .loomi-btn-secondary-cell,
    .loomi-btn-gap + td {
      padding-top: 10px !important;
    }
    .loomi-btn-primary,
    .loomi-btn-secondary {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      text-align: center !important;
    }
    .loomi-btn-primary {
      margin-right: 0 !important;
    }
    .loomi-btn-secondary {
      margin-top: 10px !important;
    }
    .loomi-headline,
    .loomi-subheadline {
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    td {
      min-width: 0 !important;
    }
    td, p, span, a, h1, h2, h3, h4, h5, h6, div {
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  `;

  const styleEl = existing || doc.createElement("style");
  styleEl.id = FORCED_MOBILE_NORMALIZE_STYLE_ID;
  styleEl.textContent = css;
  if (!existing) doc.head?.appendChild(styleEl);
}

function normalizePreviewMobileLayout(doc: Document, isMobile: boolean) {
  if (!isMobile) return;

  const root = doc.documentElement as HTMLElement | null;
  if (root) {
    root.style.overflowX = "hidden";
    root.style.maxWidth = "100%";
  }
  if (doc.body) {
    doc.body.style.overflowX = "hidden";
    doc.body.style.width = "100%";
    doc.body.style.maxWidth = "100%";
  }

  // Force classic email container tables (usually width="600") to fit mobile preview width.
  doc.querySelectorAll("table").forEach((node) => {
    const table = node as HTMLTableElement;
    const widthAttr = (table.getAttribute("width") || "").trim();
    const numericWidth = parseInt(widthAttr, 10);
    const inlineStyle = table.getAttribute("style") || "";
    const looksLikeDesktopContainer =
      (!Number.isNaN(numericWidth) && numericWidth >= 500) ||
      /max-width\s*:\s*600px/i.test(inlineStyle) ||
      table.classList.contains("email-container");
    if (!looksLikeDesktopContainer) return;
    table.setAttribute("width", "100%");
    table.style.width = "100%";
    table.style.maxWidth = "100%";
    table.style.minWidth = "0";
  });

  // Keep wide media assets inside viewport.
  doc.querySelectorAll("img[width]").forEach((node) => {
    const img = node as HTMLImageElement;
    const numericWidth = parseInt(img.getAttribute("width") || "", 10);
    if (Number.isNaN(numericWidth) || numericWidth < 500) return;
    img.style.maxWidth = "100%";
    img.style.width = "100%";
    img.style.height = "auto";
  });

  // Hero safe-mode: avoid side-by-side button overflow and long headline clipping.
  const normalizeHeroButtonRow = (row: HTMLElement) => {
    const table = row.closest("table") as HTMLTableElement | null;
    if (table) {
      table.style.width = "100%";
      table.style.maxWidth = "100%";
      table.style.minWidth = "0";
    }
    row.style.display = "block";
    row.style.width = "100%";
    const cells = Array.from(row.children).filter(
      (child) => child.tagName.toLowerCase() === "td",
    ) as HTMLTableCellElement[];
    const mobileGap = (cells[0]?.style.paddingRight || "10px").trim() || "10px";
    cells.forEach((td, idx) => {
      td.style.display = "block";
      td.style.width = "100%";
      td.style.maxWidth = "100%";
      td.style.paddingRight = "0";
      if (idx > 0) td.style.paddingTop = mobileGap;
    });
  };
  doc.querySelectorAll(".loomi-btn-row").forEach((node) => {
    normalizeHeroButtonRow(node as HTMLElement);
  });
  doc.querySelectorAll(".loomi-btn-gap").forEach((node) => {
    const td = node as HTMLTableCellElement;
    const row = td.parentElement;
    if (row && row.tagName.toLowerCase() === "tr") {
      normalizeHeroButtonRow(row as HTMLElement);
    }
  });
  doc.querySelectorAll(".loomi-btn-primary, .loomi-btn-secondary").forEach((node) => {
    const el = node as HTMLElement;
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("text-align", "center", "important");
  });
  // Additional hard fallback: normalize button/table/cell sizing from anchors directly.
  doc
    .querySelectorAll("a.loomi-btn-primary, a.loomi-btn-secondary")
    .forEach((node) => {
      const anchor = node as HTMLElement;
      anchor.style.setProperty("display", "block", "important");
      anchor.style.setProperty("width", "100%", "important");
      anchor.style.setProperty("max-width", "100%", "important");
      anchor.style.setProperty("box-sizing", "border-box", "important");
      anchor.style.setProperty("text-align", "center", "important");

      const cell = anchor.closest("td") as HTMLTableCellElement | null;
      if (cell) {
        cell.style.setProperty("display", "block", "important");
        cell.style.setProperty("width", "100%", "important");
        cell.style.setProperty("max-width", "100%", "important");
        cell.style.setProperty("padding-right", "0", "important");
      }

      const table = anchor.closest("table") as HTMLTableElement | null;
      if (table && table.querySelector("a.loomi-btn-primary")) {
        table.style.setProperty("width", "100%", "important");
        table.style.setProperty("max-width", "100%", "important");
        table.style.setProperty("min-width", "0", "important");
      }
    });
  doc.querySelectorAll("table.loomi-btn-table").forEach((node) => {
    const table = node as HTMLTableElement;
    const primary = table.querySelector("a.loomi-btn-primary") as HTMLElement | null;
    const secondary = table.querySelector("a.loomi-btn-secondary") as HTMLElement | null;
    const mobileGap = (primary?.style.marginRight || "10px").trim() || "10px";
    if (primary) {
      primary.style.setProperty("margin-right", "0", "important");
    }
    if (secondary) {
      secondary.style.setProperty("margin-top", mobileGap, "important");
    }
  });
  doc.querySelectorAll(".loomi-headline, .loomi-subheadline").forEach((node) => {
    const el = node as HTMLElement;
    el.style.overflowWrap = "anywhere";
    el.style.wordBreak = "break-word";
  });
}

// --- Padding field component ---
// Parses CSS shorthand "10px 20px 30px 40px" into {top, right, bottom, left}
function parsePadding(value: string): {
  top: string;
  right: string;
  bottom: string;
  left: string;
} {
  if (!value) return { top: "", right: "", bottom: "", left: "" };
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1)
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2)
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3)
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

function serializePadding(sides: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}): string {
  const { top, right, bottom, left } = sides;
  if (!top && !right && !bottom && !left) return "";
  const t = ensureUnit(top) || "0px";
  const r = ensureUnit(right) || "0px";
  const b = ensureUnit(bottom) || "0px";
  const l = ensureUnit(left) || "0px";
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

// A single unit input with optional "px" suffix and hover stepper arrows
function DraggableUnitInput({
  value,
  placeholder,
  onChange,
  disabled,
  className,
  hideUnit,
}: {
  value: string;
  placeholder: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  className?: string;
  hideUnit?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const getNumeric = () =>
    parseInt(stripUnit(value) || stripUnit(placeholder) || "0", 10) || 0;

  const adjustValue = (delta: number) => {
    if (disabled) return;
    const newVal = Math.max(0, getNumeric() + delta);
    onChange(String(newVal));
  };

  const arrowOffsetClass = hideUnit ? "right-1.5" : "right-5";
  const placeholderText = stripUnit(placeholder) || "0";

  return (
    <div
      className="relative group"
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <input
        type="text"
        value={stripUnit(value)}
        placeholder={placeholderText}
        onChange={(e) => onChange(e.target.value)}
        onWheel={(e) => e.currentTarget.blur()}
        disabled={disabled}
        className={`${className || ""} ${hideUnit ? "pr-4" : "pr-5"}`}
      />
      {!disabled && isHovered && (
        <div
          className={`absolute ${arrowOffsetClass} top-1/2 -translate-y-1/2 flex flex-col`}
        >
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              adjustValue(e.shiftKey ? 10 : 1);
            }}
            className="p-0 h-2.5 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            tabIndex={-1}
          >
            <ChevronUpIcon className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              adjustValue(e.shiftKey ? -10 : -1);
            }}
            className="p-0 h-2.5 flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            tabIndex={-1}
          >
            <ChevronDownIcon className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
      {!hideUnit && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted-foreground)] pointer-events-none font-mono">
          px
        </span>
      )}
    </div>
  );
}

// ── Alignment icon SVGs (icons8 files) ──
const AlignLeftSvg = ({ rotate }: { rotate?: number }) => (
  <svg
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="w-4 h-4"
    style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
  >
    <path d="M1.5 1C1.2236328 1 1 1.2236328 1 1.5v21C1 22.7763672 1.2236328 23 1.5 23S2 22.7763672 2 22.5v-21C2 1.2236328 1.7763672 1 1.5 1zM21 13H6c-1.1025391 0-2 .8969727-2 2v3c0 1.1030273.8974609 2 2 2h15c1.1025391 0 2-.8969727 2-2v-3C23 13.8969727 22.1025391 13 21 13zM22 18c0 .5512695-.4482422 1-1 1H6c-.5517578 0-1-.4487305-1-1v-3c0-.5512695.4482422-1 1-1h15c.5517578 0 1 .4487305 1 1V18zM6 11.0400391h9c1.1025391 0 2-.8969727 2-2V6c0-1.1030273-.8974609-2-2-2H6C4.8974609 4 4 4.8969727 4 6v3.0400391C4 10.1430664 4.8974609 11.0400391 6 11.0400391zM5 6c0-.5512695.4482422-1 1-1h9c.5517578 0 1 .4487305 1 1v3.0400391c0 .5512695-.4482422 1-1 1H6c-.5517578 0-1-.4487305-1-1V6z" />
  </svg>
);
const AlignCenterSvg = ({ rotate }: { rotate?: number }) => (
  <svg
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="w-4 h-4"
    style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
  >
    <path d="M19,13h-6.5v-1.9599609H16c1.1025391,0,2-0.8969727,2-2V6c0-1.1030273-0.8974609-2-2-2h-3.5V0.5C12.5,0.2236328,12.2763672,0,12,0s-0.5,0.2236328-0.5,0.5V4H8C6.8974609,4,6,4.8969727,6,6v3.0400391c0,1.1030273,0.8974609,2,2,2h3.5V13H5c-1.1025391,0-2,0.8969727-2,2v3c0,1.1030273,0.8974609,2,2,2h6.5v3.5c0,0.2763672,0.2236328,0.5,0.5,0.5s0.5-0.2236328,0.5-0.5V20H19c1.1025391,0,2-0.8969727,2-2v-3C21,13.8969727,20.1025391,13,19,13z M16,5c0.5517578,0,1,0.4487305,1,1v3.0400391c0,0.5512695-0.4482422,1-1,1h-3.5V5H16z M8,10.0400391c-0.5517578,0-1-0.4487305-1-1V6c0-0.5512695,0.4482422-1,1-1h3.5v5.0400391H8z M5,19c-0.5517578,0-1-0.4487305-1-1v-3c0-0.5512695,0.4482422-1,1-1h6.5v5H5z M20,18c0,0.5512695-0.4482422,1-1,1h-6.5v-5H19c0.5517578,0,1,0.4487305,1,1V18z" />
  </svg>
);
const AlignRightSvg = ({ rotate }: { rotate?: number }) => (
  <svg
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="w-4 h-4"
    style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
  >
    <path d="M22.5 1C22.2236328 1 22 1.2236328 22 1.5v21c0 .2763672.2236328.5.5.5s.5-.2236328.5-.5v-21C23 1.2236328 22.7763672 1 22.5 1zM18 13H3c-1.1025391 0-2 .8969727-2 2v3c0 1.1030273.8974609 2 2 2h15c1.1025391 0 2-.8969727 2-2v-3C20 13.8969727 19.1025391 13 18 13zM19 18c0 .5512695-.4482422 1-1 1H3c-.5517578 0-1-.4487305-1-1v-3c0-.5512695.4482422-1 1-1h15c.5517578 0 1 .4487305 1 1V18zM18 4H9C7.8974609 4 7 4.8969727 7 6v3.0400391c0 1.1030273.8974609 2 2 2h9c1.1025391 0 2-.8969727 2-2V6C20 4.8969727 19.1025391 4 18 4zM19 9.0400391c0 .5512695-.4482422 1-1 1H9c-.5517578 0-1-.4487305-1-1V6c0-.5512695.4482422-1 1-1h9c.5517578 0 1 .4487305 1 1V9.0400391z" />
  </svg>
);

/** Detect if a select field's options match the standard horizontal alignment set */
function isAlignmentOptions(options?: { label: string; value: string }[]): boolean {
  if (!options || options.length !== 3) return false;
  const vals = options.map(o => o.value);
  return vals[0] === 'left' && vals[1] === 'center' && vals[2] === 'right';
}

/** Detect if a select field's options match the standard vertical alignment set */
function isVerticalAlignOptions(options?: { label: string; value: string }[]): boolean {
  if (!options || options.length !== 3) return false;
  const vals = options.map(o => o.value);
  return vals[0] === 'top' && vals[1] === 'middle' && vals[2] === 'bottom';
}

/** Segmented icon buttons for alignment (Elementor-style) — works for both horizontal and vertical */
function AlignmentButtons({ value, onChange, vertical }: { value: string; onChange: (val: string) => void; vertical?: boolean }) {
  const rotation = vertical ? -90 : undefined;
  const opts = vertical
    ? [
        { value: 'top', icon: <AlignLeftSvg rotate={rotation} />, label: 'Top' },
        { value: 'middle', icon: <AlignCenterSvg rotate={rotation} />, label: 'Middle' },
        { value: 'bottom', icon: <AlignRightSvg rotate={rotation} />, label: 'Bottom' },
      ]
    : [
        { value: 'left', icon: <AlignLeftSvg />, label: 'Left' },
        { value: 'center', icon: <AlignCenterSvg />, label: 'Center' },
        { value: 'right', icon: <AlignRightSvg />, label: 'Right' },
      ];
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 flex items-center justify-center transition-colors ${
            value === o.value
              ? 'bg-[var(--primary)] text-white'
              : 'bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
          }`}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/** Slider + number input combo for unit values (Elementor-style) */
function SliderUnitInput({
  value,
  placeholder,
  onChange,
  propKey,
}: {
  value: string;
  placeholder?: string;
  onChange: (val: string) => void;
  propKey?: string;
}) {
  // Smart max based on prop key
  const isBorderWidth = propKey ? /border.*width/i.test(propKey) : false;
  const isLargeDimension = propKey ? /width|height|max-width|max-height/i.test(propKey) : false;
  const isLetterSpacing = propKey ? /letter-spacing|spacing/i.test(propKey) : false;
  const max = isBorderWidth ? 20 : isLetterSpacing ? 20 : isLargeDimension ? 600 : 100;

  const numericValue = parseInt(stripUnit(value) || stripUnit(placeholder || '') || '0', 10) || 0;

  return (
    <div className="flex items-center gap-2 w-full">
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={Math.min(numericValue, max)}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex-1 h-1 range-slider"
      />
      <DraggableUnitInput
        value={value ? stripUnit(value) : ''}
        placeholder={stripUnit(placeholder || '') || '0'}
        onChange={onChange}
        className="w-[60px] bg-[var(--input)] border border-[var(--border)] rounded-lg pl-2 pr-5 py-1.5 text-xs text-center font-mono"
      />
    </div>
  );
}

function SpacingField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [linked, setLinked] = useState(() => {
    const parsed = parsePadding(value || placeholder || "");
    return (
      parsed.top === parsed.right &&
      parsed.right === parsed.bottom &&
      parsed.bottom === parsed.left
    );
  });

  const displayValue = value || placeholder || "";
  const sides = parsePadding(displayValue);
  const isUsingDefault = !value;
  const placeholderSides = parsePadding(placeholder || "");

  const handleSideChange = (
    side: "top" | "right" | "bottom" | "left",
    rawVal: string,
  ) => {
    const val = rawVal;
    if (linked) {
      onChange(
        serializePadding({ top: val, right: val, bottom: val, left: val }),
      );
    } else {
      const newSides = { ...sides, [side]: ensureUnit(val) };
      onChange(serializePadding(newSides));
    }
  };

  const toggleLinked = () => {
    if (!linked) {
      const uniform = stripUnit(sides.top) || "0";
      onChange(
        serializePadding({
          top: uniform,
          right: uniform,
          bottom: uniform,
          left: uniform,
        }),
      );
    }
    setLinked(!linked);
  };

  const inputClass = `w-full bg-[var(--input)] border border-[var(--border)] rounded-lg py-1.5 text-xs text-center font-mono ${isUsingDefault ? "text-[var(--muted-foreground)]" : ""}`;

  const gridCells: {
    key: "top" | "right" | "bottom" | "left";
    label: string;
  }[] = [
    { key: "top", label: "Top" },
    { key: "right", label: "Right" },
    { key: "bottom", label: "Bottom" },
    { key: "left", label: "Left" },
  ];

  return (
    <div className="flex items-start gap-1.5">
      <div className="flex gap-1 flex-1 min-w-0">
        {gridCells.map((cell) => (
          <div key={cell.key} className="flex-1 min-w-0">
            <DraggableUnitInput
              value={isUsingDefault ? "" : sides[cell.key]}
              placeholder={placeholderSides[cell.key]}
              onChange={(val) => handleSideChange(cell.key, val)}
              className={`${inputClass} px-1`}
            />
            <label className="text-[9px] text-[var(--muted-foreground)] block text-center mt-1 leading-none">
              {cell.label}
            </label>
          </div>
        ))}
      </div>
      <button
        onClick={toggleLinked}
        className={`w-7 h-7 self-start rounded-md flex items-center justify-center border transition-colors flex-shrink-0 ${linked ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--input)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"}`}
        title={linked ? "Unlink sides" : "Link all sides"}
      >
        <LinkIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

// --- Border radius field (4 corners: TL, TR, BR, BL) ---
function parseBorderRadius(value: string): {
  tl: string;
  tr: string;
  br: string;
  bl: string;
} {
  if (!value) return { tl: "", tr: "", br: "", bl: "" };
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1)
    return { tl: parts[0], tr: parts[0], br: parts[0], bl: parts[0] };
  if (parts.length === 2)
    return { tl: parts[0], tr: parts[1], br: parts[0], bl: parts[1] };
  if (parts.length === 3)
    return { tl: parts[0], tr: parts[1], br: parts[2], bl: parts[1] };
  return { tl: parts[0], tr: parts[1], br: parts[2], bl: parts[3] };
}

function serializeBorderRadius(corners: {
  tl: string;
  tr: string;
  br: string;
  bl: string;
}): string {
  const { tl, tr, br, bl } = corners;
  if (!tl && !tr && !br && !bl) return "";
  const a = ensureUnit(tl) || "0px";
  const b = ensureUnit(tr) || "0px";
  const c = ensureUnit(br) || "0px";
  const d = ensureUnit(bl) || "0px";
  if (a === b && b === c && c === d) return a;
  if (a === c && b === d) return `${a} ${b}`;
  if (b === d) return `${a} ${b} ${c}`;
  return `${a} ${b} ${c} ${d}`;
}

function BorderRadiusField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [linked, setLinked] = useState(() => {
    const parsed = parseBorderRadius(value || placeholder || "");
    return (
      parsed.tl === parsed.tr &&
      parsed.tr === parsed.br &&
      parsed.br === parsed.bl
    );
  });

  const displayValue = value || placeholder || "";
  const corners = parseBorderRadius(displayValue);
  const isUsingDefault = !value;
  const placeholderCorners = parseBorderRadius(placeholder || "");

  const handleCornerChange = (
    corner: "tl" | "tr" | "br" | "bl",
    rawVal: string,
  ) => {
    if (linked) {
      onChange(
        serializeBorderRadius({
          tl: rawVal,
          tr: rawVal,
          br: rawVal,
          bl: rawVal,
        }),
      );
    } else {
      const newCorners = { ...corners, [corner]: ensureUnit(rawVal) };
      onChange(serializeBorderRadius(newCorners));
    }
  };

  const toggleLinked = () => {
    if (!linked) {
      const uniform = stripUnit(corners.tl) || "0";
      onChange(
        serializeBorderRadius({
          tl: uniform,
          tr: uniform,
          br: uniform,
          bl: uniform,
        }),
      );
    }
    setLinked(!linked);
  };

  const inputClass = `w-full bg-[var(--input)] border border-[var(--border)] rounded-lg py-1.5 text-xs text-center font-mono ${isUsingDefault ? "text-[var(--muted-foreground)]" : ""}`;

  const gridCells: {
    key: "tl" | "tr" | "br" | "bl";
    label: string;
    rotation: string;
  }[] = [
    { key: "tl", label: "TL", rotation: "-90" },
    { key: "tr", label: "TR", rotation: "0" },
    { key: "br", label: "BR", rotation: "90" },
    { key: "bl", label: "BL", rotation: "180" },
  ];

  return (
    <div className="flex items-start gap-1.5">
      <div className="flex gap-1 flex-1 min-w-0">
        {gridCells.map((cell) => (
          <div key={cell.key} className="flex-1 min-w-0">
            <DraggableUnitInput
              value={isUsingDefault ? "" : corners[cell.key]}
              placeholder={placeholderCorners[cell.key]}
              onChange={(val) => handleCornerChange(cell.key, val)}
              className={`${inputClass} px-1`}
            />
            <div className="flex justify-center mt-1">
              <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-3.5 h-3.5 text-[var(--muted-foreground)]" style={{ transform: `rotate(${cell.rotation}deg)` }}><path d="M 7.5 6 A 1.5 1.5 0 0 0 7.5 9 A 1.5 1.5 0 0 0 7.5 6 z M 13.5 6 A 1.5 1.5 0 0 0 13.5 9 A 1.5 1.5 0 0 0 13.5 6 z M 19.5 6 A 1.5 1.5 0 0 0 19.5 9 A 1.5 1.5 0 0 0 19.5 6 z M 25.5 6 A 1.50015 1.50015 0 1 0 25.5 9 C 32.973281 9 39 15.026719 39 22.5 A 1.50015 1.50015 0 1 0 42 22.5 C 42 13.405281 34.594719 6 25.5 6 z M 40.5 27 A 1.5 1.5 0 0 0 40.5 30 A 1.5 1.5 0 0 0 40.5 27 z M 40.5 33 A 1.5 1.5 0 0 0 40.5 36 A 1.5 1.5 0 0 0 40.5 33 z M 40.5 39 A 1.5 1.5 0 0 0 40.5 42 A 1.5 1.5 0 0 0 40.5 39 z"/></svg>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={toggleLinked}
        className={`w-7 h-7 self-start rounded-md flex items-center justify-center border transition-colors flex-shrink-0 ${linked ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--input)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"}`}
        title={linked ? "Unlink corners" : "Link all corners"}
      >
        <LinkIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Color picker HSV helpers ──

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

// Render a single form field
const VARIABLE_ELIGIBLE_TYPES = new Set(["text", "textarea", "url", "image"]);

const RICH_TEXT_ALLOWED_TAGS = new Set([
  "div",
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "span",
  "a",
  "ul",
  "ol",
  "li",
]);

const RICH_TEXT_ALLOWED_STYLE_PROPS = new Set([
  "color",
  "font-size",
  "line-height",
  "font-weight",
  "font-style",
  "text-decoration",
  "font-family",
  "text-align",
]);

const FALLBACK_FONT_FAMILY = "Helvetica Neue, Helvetica, Arial, sans-serif";
const DEFAULT_FONT_CONTROL_VALUE = "__default_font_family__";

function normalizeHexColor(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  const prefixed = input.startsWith("#") ? input : `#${input}`;
  if (/^#[0-9a-f]{3}$/.test(prefixed)) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(prefixed)) return prefixed;
  return null;
}

function cssColorToHex(value: string): string | null {
  const direct = normalizeHexColor(value);
  if (direct) return direct;

  const text = value.trim().toLowerCase();
  const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/);
  if (!rgbMatch) return null;
  const parts = rgbMatch[1].split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const nums = parts.slice(0, 3).map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return `#${nums.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function isSafeCssColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  return Boolean(
    normalizeHexColor(v) ||
      /^rgba?\([\d\s,.%]+\)$/.test(v) ||
      /^hsla?\([\d\s,.%]+\)$/.test(v) ||
      /^var\(--[a-z0-9-]+\)$/.test(v),
  );
}

function sanitizeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\{\{[a-zA-Z0-9_.-]+\}\}$/.test(trimmed)) return trimmed;
  if (/^#/.test(trimmed) || /^\//.test(trimmed)) return trimmed;
  if (/^(https?:|mailto:|tel:|sms:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return `https://${trimmed}`;
}

function normalizeFontFamilyValue(value: string): string {
  return value.replace(/["']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeInlineStyle(styleText: string): string {
  const safeEntries: string[] = [];
  for (const rawEntry of styleText.split(";")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const idx = entry.indexOf(":");
    if (idx === -1) continue;
    const key = entry.slice(0, idx).trim().toLowerCase();
    const value = entry.slice(idx + 1).trim();
    if (!RICH_TEXT_ALLOWED_STYLE_PROPS.has(key) || !value) continue;

    let valid = false;
    if (key === "color") {
      valid = isSafeCssColor(value);
    } else if (key === "font-size") {
      valid = /^\d+(\.\d+)?(px|em|rem|%)$/i.test(value);
    } else if (key === "line-height") {
      valid = /^normal$/i.test(value) || /^\d+(\.\d+)?(px|em|rem|%)?$/i.test(value);
    } else if (key === "font-weight") {
      valid = /^(normal|bold|[1-9]00)$/i.test(value);
    } else if (key === "font-style") {
      valid = /^(normal|italic|oblique)$/i.test(value);
    } else if (key === "text-decoration") {
      valid = /^(none|underline|line-through)(\s+(none|underline|line-through))*$/i.test(value);
    } else if (key === "font-family") {
      // Strip quotes around font names to avoid double-encoding through
      // the PostHTML pipeline (browser adds "Times New Roman" with quotes,
      // which become &quot; in innerHTML, then &amp;quot; after
      // escapeTemplateAttrValue, breaking the CSS in the final HTML).
      // Unquoted multi-word font names are universally accepted by browsers
      // and email clients in inline styles.
      const unquoted = value.replace(/["']/g, "").trim();
      valid =
        /^var\(--[a-z0-9-]+\)$/i.test(unquoted) ||
        /^[a-z0-9\s,-]+$/i.test(unquoted);
      if (valid && unquoted !== value) {
        safeEntries.push(`${key}: ${unquoted}`);
        continue;
      }
    } else if (key === "text-align") {
      valid = /^(left|right|center|justify|start|end)$/i.test(value);
    }

    if (valid) safeEntries.push(`${key}: ${value}`);
  }
  // Add trailing semicolon to match browser cssText format. This prevents
  // commitEditorValue from detecting a diff (trailing semicolon vs none) and
  // unnecessarily replacing innerHTML + moving the caret to the end.
  const joined = safeEntries.join("; ");
  return joined ? joined + ";" : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeRichTextHtml(raw: string): string {
  if (!raw) return "";

  if (typeof window === "undefined") {
    return raw.trim();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${raw}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";

  const sanitizeNode = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();

        if (!RICH_TEXT_ALLOWED_TAGS.has(tag)) {
          const parent = el.parentNode;
          if (!parent) continue;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          continue;
        }

        for (const attr of Array.from(el.attributes)) {
          const attrName = attr.name.toLowerCase();
          if (attrName === "style") {
            const cleanedStyle = sanitizeInlineStyle(attr.value || "");
            if (cleanedStyle) {
              el.setAttribute("style", cleanedStyle);
            } else {
              el.removeAttribute("style");
            }
          } else if (tag === "a" && attrName === "href") {
            const safeHref = sanitizeLinkHref(attr.value || "");
            if (safeHref) {
              el.setAttribute("href", safeHref);
            } else {
              el.removeAttribute("href");
            }
          } else {
            el.removeAttribute(attr.name);
          }
        }
      }
      sanitizeNode(child);
    }
  };

  sanitizeNode(root);

  return root.innerHTML
    .replace(
      /<div(\s[^>]*)?>/gi,
      (_match, attrs: string | undefined) => `<p${attrs || ""}>`,
    )
    .replace(/<\/div>/gi, "</p>")
    .replace(/<p>\s*<\/p>/gi, "<br>")
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>");
}

function normalizeRichTextValue(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return "";

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(normalized);
  if (looksLikeHtml) return sanitizeRichTextHtml(normalized);

  return sanitizeRichTextHtml(escapeHtml(normalized).replace(/\n/g, "<br>"));
}

function stripRichText(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  return (doc.body.textContent || "").replace(/\u00a0/g, " ").trim();
}

function moveCaretToEnd(el: HTMLElement) {
  if (typeof window === "undefined") return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

const COPY_PROP_KEYS_MOVED_TO_EDITOR = new Set([
  "greeting",
  "greeting-size",
  "greeting-color",
  "greeting-weight",
  "greeting-spacing",
  "greeting-transform",
  "greeting-margin",
  "body-size",
  "body-color",
  "body-weight",
  "body-margin",
  "line-height",
]);

function mergeCopyGreetingIntoBody(greeting: string, body: string): string {
  const normalizedGreeting = normalizeRichTextValue(greeting || "");
  const normalizedBody = normalizeRichTextValue(body || "");

  if (!normalizedGreeting) return normalizedBody;
  if (!normalizedBody) return normalizedGreeting;

  const greetingText = stripRichText(normalizedGreeting).replace(/\s+/g, " ").trim();
  const bodyText = stripRichText(normalizedBody).replace(/\s+/g, " ").trim();
  if (greetingText && bodyText.startsWith(greetingText)) {
    return normalizedBody;
  }

  return `${normalizedGreeting}<br><br>${normalizedBody}`;
}

function RichTextField({
  value,
  onChange,
  placeholderText,
  onInsertVariable,
  brandColors,
  previewAsLabel,
  baseFontFamily,
  inlineVariableOptions = [],
}: {
  value: string;
  onChange: (val: string) => void;
  placeholderText?: string;
  onInsertVariable?: (token: string) => void;
  brandColors?: { label: string; value: string }[];
  previewAsLabel?: string;
  baseFontFamily?: string;
  inlineVariableOptions?: InlineVariableOption[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const alignButtonRef = useRef<HTMLButtonElement>(null);
  const alignDropdownRef = useRef<HTMLDivElement>(null);
  const alignCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const fontDropdownRef = useRef<HTMLDivElement>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const colorDropdownRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const toolbarTooltipRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [internalHtml, setInternalHtml] = useState("");
  const [alignOpen, setAlignOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState("https://");
  const [alignDropdownPos, setAlignDropdownPos] = useState<CSSProperties>({});
  const [fontDropdownPos, setFontDropdownPos] = useState<CSSProperties>({});
  const [colorDropdownPos, setColorDropdownPos] = useState<CSSProperties>({});
  const [showToolbarLabels, setShowToolbarLabels] = useState(true);
  const [commandState, setCommandState] = useState({
    bold: false,
    italic: false,
    underline: false,
    unordered: false,
    ordered: false,
    link: false,
    align: "left" as TextAlignMode,
  });
  const [fontFamilyControl, setFontFamilyControl] = useState(
    DEFAULT_FONT_CONTROL_VALUE,
  );
  const [fontSizeControl, setFontSizeControl] = useState("16px");
  const [lineHeightControl, setLineHeightControl] = useState("1.8");
  const [textColor, setTextColor] = useState("#111111");
  const [colorHexInput, setColorHexInput] = useState("#111111");
  const [inlineVarOpen, setInlineVarOpen] = useState(false);
  const [inlineVarQuery, setInlineVarQuery] = useState("");
  const [inlineVarTriggerLength, setInlineVarTriggerLength] = useState(0);
  const [inlineVarActiveIndex, setInlineVarActiveIndex] = useState(0);
  const [toolbarTooltip, setToolbarTooltip] = useState<{
    label: string;
    left: number;
    top: number;
  } | null>(null);

  const effectiveBaseFontFamily = (baseFontFamily || "").trim() || FALLBACK_FONT_FAMILY;
  const defaultFontLabel = useMemo(() => {
    const normalizedBase = normalizeFontFamilyValue(effectiveBaseFontFamily);
    const match = WEBSAFE_FONTS.find(
      (option) => normalizeFontFamilyValue(option.value) === normalizedBase,
    );
    return match ? `Default (${match.label})` : "Default (Component Font)";
  }, [effectiveBaseFontFamily]);
  const fontFamilyOptions = useMemo(
    () => [
      { label: defaultFontLabel, value: DEFAULT_FONT_CONTROL_VALUE },
      ...WEBSAFE_FONTS,
    ],
    [defaultFontLabel],
  );
  const alignmentOptions = useMemo(
    () => [
      { key: "left" as const, label: "Align left", command: "justifyLeft", icon: Bars3BottomLeftIcon },
      { key: "center" as const, label: "Align center", command: "justifyCenter", icon: Bars2Icon },
      { key: "right" as const, label: "Align right", command: "justifyRight", icon: Bars3BottomRightIcon },
      { key: "justify" as const, label: "Justify", command: "justifyFull", icon: Bars3Icon },
    ],
    [],
  );
  const fontSizeOptions = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];
  const lineHeightOptions = ["normal", "1.2", "1.4", "1.6", "1.8", "2"];
  const filteredInlineVarOptions = useMemo(
    () => filterInlineVariableOptions(inlineVariableOptions, inlineVarQuery).slice(0, 12),
    [inlineVariableOptions, inlineVarQuery],
  );

  const getCurrentLinePrefixText = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return null;
    }

    const caretRange = selection.getRangeAt(0);
    if (!root.contains(caretRange.startContainer)) return null;

    let block: HTMLElement | null = null;
    let probe: Node | null = caretRange.startContainer;
    while (probe && probe !== root) {
      if (probe.nodeType === Node.ELEMENT_NODE) {
        const tag = (probe as HTMLElement).tagName.toLowerCase();
        if (tag === "p" || tag === "div" || tag === "li") {
          block = probe as HTMLElement;
          break;
        }
      }
      probe = probe.parentNode;
    }
    if (!block) block = root;

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(block);
    prefixRange.setEnd(caretRange.startContainer, caretRange.startOffset);
    const fullPrefix = prefixRange.toString().replace(/\u00a0/g, " ");
    const currentLine = fullPrefix.split("\n").pop() ?? fullPrefix;
    return currentLine;
  }, []);

  const detectInlineVariableTrigger = useCallback(() => {
    if (typeof window === "undefined") return null;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const textNode = range.startContainer as Text;
    const trigger = findInlineVariableTrigger(textNode.data, range.startOffset);
    if (!trigger) return null;

    return {
      query: trigger.query,
      length: trigger.end - trigger.start,
    };
  }, []);

  const syncInlineVariableAutocomplete = useCallback(() => {
    if (inlineVariableOptions.length === 0) {
      setInlineVarOpen(false);
      return;
    }
    const trigger = detectInlineVariableTrigger();
    if (!trigger) {
      setInlineVarOpen(false);
      return;
    }

    setInlineVarQuery(trigger.query);
    setInlineVarTriggerLength(trigger.length);
    setInlineVarOpen(true);
    setInlineVarActiveIndex(0);
  }, [detectInlineVariableTrigger, inlineVariableOptions.length]);

  const ensureListStyles = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;

    root.querySelectorAll("ul").forEach((ul) => {
      const list = ul as HTMLElement;
      list.style.listStyleType = "disc";
      list.style.paddingLeft = "1.25rem";
      list.style.margin = "0.5rem 0";
    });

    root.querySelectorAll("ol").forEach((ol) => {
      const list = ol as HTMLElement;
      list.style.listStyleType = "decimal";
      list.style.paddingLeft = "1.25rem";
      list.style.margin = "0.5rem 0";
    });
  }, []);

  const saveSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    selectionRef.current = range.cloneRange();
  }, []);

  const restoreSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection) return;

    if (selectionRef.current) {
      selection.removeAllRanges();
      selection.addRange(selectionRef.current);
      return;
    }

    moveCaretToEnd(el);
  }, []);

  const getSelectionAnchorElement = useCallback((): HTMLElement | null => {
    if (typeof window === "undefined") return null;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return null;

    let node: Node | null = selection.anchorNode;
    if (!node || !root.contains(node)) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

    let el = node as HTMLElement | null;
    while (el && el !== root) {
      const tag = el.tagName.toLowerCase();
      if (["span", "b", "strong", "i", "em", "u", "a", "p", "li", "div"].includes(tag)) {
        return el;
      }
      el = el.parentElement;
    }
    return root;
  }, []);

  const updateToolbarState = useCallback(() => {
    if (typeof window === "undefined") return;
    const root = editorRef.current;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    if (!root || !selection || selection.rangeCount === 0 || !anchorNode || !root.contains(anchorNode)) {
      setCommandState({
        bold: false,
        italic: false,
        underline: false,
        unordered: false,
        ordered: false,
        link: false,
        align: "left",
      });
      setFontFamilyControl(DEFAULT_FONT_CONTROL_VALUE);
      return;
    }

    let bold = false;
    let italic = false;
    let underline = false;
    let unordered = false;
    let ordered = false;
    let link = false;
    let align: TextAlignMode = "left";
    try {
      bold = document.queryCommandState("bold");
      italic = document.queryCommandState("italic");
      underline = document.queryCommandState("underline");
      unordered = document.queryCommandState("insertUnorderedList");
      ordered = document.queryCommandState("insertOrderedList");
      link = document.queryCommandState("createLink");
      if (document.queryCommandState("justifyCenter")) align = "center";
      else if (document.queryCommandState("justifyRight")) align = "right";
      else if (document.queryCommandState("justifyFull")) align = "justify";
      else if (document.queryCommandState("justifyLeft")) align = "left";
    } catch {
      // Ignore command-state failures in non-standard browser contexts.
    }

    const anchor = getSelectionAnchorElement();
    if (anchor) {
      unordered = unordered || !!anchor.closest("ul");
      ordered = ordered || !!anchor.closest("ol");
      link = link || !!anchor.closest("a");

      const block = anchor.closest("p, li, div") as HTMLElement | null;
      const computed = window.getComputedStyle(block || anchor);
      const nextFontSize = computed.fontSize || "16px";
      const nextLineHeight = computed.lineHeight && computed.lineHeight !== "normal"
        ? computed.lineHeight
        : "normal";
      const nextColor = cssColorToHex(computed.color) || "#111111";
      const findInlineFontFamily = () => {
        let probe: HTMLElement | null = anchor;
        while (probe && probe !== root) {
          const inlineFont = probe.style?.getPropertyValue("font-family");
          if (inlineFont) return inlineFont;
          probe = probe.parentElement;
        }
        // Also check the root element itself (cursor may be at root level after
        // innerHTML replacement moves caret to end)
        const rootFont = root.style?.getPropertyValue("font-family");
        if (rootFont) return rootFont;
        // Fallback: check the first child element (common after moveCaretToEnd
        // places cursor after the last <p>)
        const firstChild = root.querySelector("p, li, div, span, a") as HTMLElement | null;
        if (firstChild) {
          const childFont = firstChild.style?.getPropertyValue("font-family");
          if (childFont) return childFont;
        }
        return "";
      };
      const inlineFontFamily = findInlineFontFamily();
      const nextTextAlign = (computed.textAlign || "left").toLowerCase();
      if (nextTextAlign.includes("center")) align = "center";
      else if (nextTextAlign.includes("right")) align = "right";
      else if (nextTextAlign.includes("justify")) align = "justify";
      else align = "left";

      setFontFamilyControl(inlineFontFamily || DEFAULT_FONT_CONTROL_VALUE);
      setFontSizeControl(nextFontSize);
      setLineHeightControl(nextLineHeight);
      setTextColor(nextColor);
      setColorHexInput(nextColor);
    }

    setCommandState({
      bold,
      italic,
      underline,
      unordered,
      ordered,
      link,
      align,
    });
  }, [getSelectionAnchorElement]);

  useEffect(() => {
    const onSelectionChange = () => updateToolbarState();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [updateToolbarState]);

  useEffect(() => {
    if (!(alignOpen || fontOpen || colorOpen) || typeof window === "undefined") return;

    const updateDropdownPositions = () => {
      if (alignOpen && alignButtonRef.current) {
        const rect = alignButtonRef.current.getBoundingClientRect();
        setAlignDropdownPos({
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left + rect.width / 2,
          zIndex: 1200,
        });
      }
      if (fontOpen && fontButtonRef.current) {
        const rect = fontButtonRef.current.getBoundingClientRect();
        const dropdownWidth = 220;
        const viewportRight = window.innerWidth - 8;
        const left = Math.min(rect.left, Math.max(8, viewportRight - dropdownWidth));
        setFontDropdownPos({
          position: "fixed",
          top: rect.bottom + 6,
          left,
          width: dropdownWidth,
          zIndex: 1200,
        });
      }
      if (colorOpen && colorButtonRef.current) {
        const rect = colorButtonRef.current.getBoundingClientRect();
        setColorDropdownPos({
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left,
          zIndex: 1200,
        });
      }
    };

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        alignDropdownRef.current && !alignDropdownRef.current.contains(target) &&
        alignButtonRef.current && !alignButtonRef.current.contains(target)
      ) {
        setAlignOpen(false);
      }
      if (
        fontDropdownRef.current && !fontDropdownRef.current.contains(target) &&
        fontButtonRef.current && !fontButtonRef.current.contains(target)
      ) {
        setFontOpen(false);
      }
      if (
        colorDropdownRef.current && !colorDropdownRef.current.contains(target) &&
        colorButtonRef.current && !colorButtonRef.current.contains(target)
      ) {
        setColorOpen(false);
      }
    };

    updateDropdownPositions();
    window.addEventListener("resize", updateDropdownPositions);
    window.addEventListener("scroll", updateDropdownPositions, true);
    document.addEventListener("mousedown", handleOutside);
    return () => {
      window.removeEventListener("resize", updateDropdownPositions);
      window.removeEventListener("scroll", updateDropdownPositions, true);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [alignOpen, colorOpen, fontOpen]);

  useEffect(() => {
    if (!toolbarTooltip || typeof window === "undefined") return;
    const tooltipEl = toolbarTooltipRef.current;
    if (!tooltipEl) return;

    const rect = tooltipEl.getBoundingClientRect();
    const margin = 8;
    let nextLeft = toolbarTooltip.left;
    if (rect.left < margin) {
      nextLeft += margin - rect.left;
    } else if (rect.right > window.innerWidth - margin) {
      nextLeft -= rect.right - (window.innerWidth - margin);
    }

    if (Math.abs(nextLeft - toolbarTooltip.left) >= 1) {
      setToolbarTooltip((prev) => (prev ? { ...prev, left: nextLeft } : prev));
    }
  }, [toolbarTooltip]);

  useEffect(() => {
    if (!linkModalOpen || typeof window === "undefined") return;

    const timer = window.setTimeout(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }, 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLinkModalOpen(false);
        setLinkInputValue("https://");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [linkModalOpen]);

  useEffect(() => {
    if (!inlineVarOpen) return;
    if (filteredInlineVarOptions.length === 0) {
      setInlineVarOpen(false);
      return;
    }
    if (inlineVarActiveIndex >= filteredInlineVarOptions.length) {
      setInlineVarActiveIndex(0);
    }
  }, [filteredInlineVarOptions.length, inlineVarActiveIndex, inlineVarOpen]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;

    const updateMode = () => {
      setShowToolbarLabels(toolbar.getBoundingClientRect().width >= 640);
    };

    updateMode();
    const observer = new ResizeObserver(updateMode);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setInternalHtml(normalizeRichTextValue(value || ""));
  }, [value]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== internalHtml) {
      el.innerHTML = internalHtml;
    }
    ensureListStyles();
    updateToolbarState();
  }, [ensureListStyles, internalHtml, updateToolbarState]);

  const commitEditorValue = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const sanitized = sanitizeRichTextHtml(el.innerHTML);
    if (sanitized !== el.innerHTML) {
      const wasFocused = document.activeElement === el;
      el.innerHTML = sanitized;
      if (wasFocused) moveCaretToEnd(el);
    }

    setInternalHtml(sanitized);
    onChange(sanitized);
    updateToolbarState();
  }, [onChange, updateToolbarState]);

  const applyInlineVariableToken = useCallback((token: string) => {
    if (typeof window === "undefined") return;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;

    let replaced = false;
    if (
      range.collapsed &&
      range.startContainer.nodeType === Node.TEXT_NODE &&
      inlineVarTriggerLength > 0 &&
      range.startOffset >= inlineVarTriggerLength
    ) {
      const textNode = range.startContainer as Text;
      const triggerStart = range.startOffset - inlineVarTriggerLength;
      textNode.data =
        textNode.data.slice(0, triggerStart) +
        token +
        textNode.data.slice(range.startOffset);
      const nextOffset = triggerStart + token.length;
      const nextRange = document.createRange();
      nextRange.setStart(textNode, nextOffset);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      replaced = true;
    }

    if (!replaced) {
      document.execCommand("insertText", false, token);
    }

    setInlineVarOpen(false);
    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, inlineVarTriggerLength, saveSelection, updateToolbarState]);

  const runCommand = useCallback((command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection();
    document.execCommand(command, false, value);
    if (command === "insertUnorderedList" || command === "insertOrderedList") {
      ensureListStyles();
    }
    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, ensureListStyles, restoreSelection, saveSelection, updateToolbarState]);

  const applyAlignment = useCallback((nextAlignment: TextAlignMode) => {
    if (typeof window === "undefined") return;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;

    root.focus();
    restoreSelection();
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const findBlock = (node: Node | null): HTMLElement | null => {
      let probe: Node | null = node;
      while (probe && probe !== root) {
        if (probe.nodeType === Node.ELEMENT_NODE) {
          const el = probe as HTMLElement;
          const tag = el.tagName.toLowerCase();
          if (["p", "div", "li"].includes(tag)) return el;
        }
        probe = probe.parentNode;
      }
      return null;
    };

    const commandByAlign: Record<TextAlignMode, string> = {
      left: "justifyLeft",
      center: "justifyCenter",
      right: "justifyRight",
      justify: "justifyFull",
    };
    const command = commandByAlign[nextAlignment];
    let appliedByCommand = false;
    try {
      appliedByCommand = document.execCommand(command, false);
    } catch {
      appliedByCommand = false;
    }

    if (!appliedByCommand) {
      const targets = new Set<HTMLElement>();
      const startBlock = findBlock(range.startContainer);
      const endBlock = findBlock(range.endContainer);
      if (startBlock) targets.add(startBlock);
      if (endBlock) targets.add(endBlock);
      if (!range.collapsed) {
        root.querySelectorAll("p, div, li").forEach((candidate) => {
          if (range.intersectsNode(candidate)) {
            targets.add(candidate as HTMLElement);
          }
        });
      }
      if (targets.size === 0) targets.add(root);

      targets.forEach((target) => {
        target.style.textAlign = nextAlignment;
      });
    }

    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, restoreSelection, saveSelection, updateToolbarState]);

  const closeLinkModal = useCallback(() => {
    setLinkModalOpen(false);
    setLinkInputValue("https://");
  }, []);

  const openLinkModal = useCallback(() => {
    if (typeof window === "undefined") return;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;

    root.focus();
    restoreSelection();
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const currentAnchor = getSelectionAnchorElement()?.closest("a");
    const existingHref = currentAnchor?.getAttribute("href") || "https://";
    setLinkInputValue(existingHref);
    setLinkModalOpen(true);
  }, [getSelectionAnchorElement, restoreSelection]);

  const removeLink = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    restoreSelection();
    document.execCommand("unlink");
    commitEditorValue();
    saveSelection();
    updateToolbarState();
    closeLinkModal();
  }, [closeLinkModal, commitEditorValue, restoreSelection, saveSelection, updateToolbarState]);

  const applyLinkFromModal = useCallback(() => {
    if (typeof window === "undefined") return;
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;

    root.focus();
    restoreSelection();
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const trimmedHref = linkInputValue.trim();
    if (!trimmedHref) {
      removeLink();
      return;
    }

    const safeHref = sanitizeLinkHref(trimmedHref);
    if (!safeHref) {
      toast.error("Please enter a valid URL, mailto:, tel:, or relative link.");
      return;
    }

    if (range.collapsed) {
      const encodedHref = escapeHtml(safeHref);
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${encodedHref}">${encodedHref}</a>`,
      );
    } else {
      document.execCommand("createLink", false, safeHref);
    }

    commitEditorValue();
    saveSelection();
    updateToolbarState();
    closeLinkModal();
  }, [closeLinkModal, commitEditorValue, linkInputValue, removeLink, restoreSelection, saveSelection, updateToolbarState]);

  const clearFormatting = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    restoreSelection();
    document.execCommand("removeFormat");
    document.execCommand("unlink");
    ensureListStyles();
    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, ensureListStyles, restoreSelection, saveSelection, updateToolbarState]);

  const applyInlineStyle = useCallback((styleKey: "font-size" | "line-height" | "color" | "font-family", styleValue: string) => {
    const el = editorRef.current;
    if (!el || typeof window === "undefined") return;

    el.focus();
    restoreSelection();

    if (styleKey === "font-family") {
      const nextStyleValue = styleValue === DEFAULT_FONT_CONTROL_VALUE ? "" : styleValue;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;

      const allTargets = Array.from(el.querySelectorAll("p, li, div, span, a")) as HTMLElement[];
      const targets = new Set<HTMLElement>();

      const wrapLooseRootTextNodes = () => {
        if (!nextStyleValue) return;
        Array.from(el.childNodes).forEach((node) => {
          if (node.nodeType !== Node.TEXT_NODE) return;
          const text = node.textContent || "";
          if (!text.trim()) return;
          const span = document.createElement("span");
          span.style.setProperty(styleKey, nextStyleValue);
          span.textContent = text;
          el.replaceChild(span, node);
        });
      };

      if (range.collapsed) {
        // No selection — apply font to all block-level elements (global change)
        wrapLooseRootTextNodes();
        const updatedTargets = Array.from(el.querySelectorAll("p, li, div, span, a")) as HTMLElement[];
        if (updatedTargets.length === 0) {
          targets.add(el);
        } else {
          updatedTargets.forEach((node) => targets.add(node));
        }
        targets.forEach((target) => {
          if (nextStyleValue) {
            target.style.setProperty(styleKey, nextStyleValue);
          } else {
            target.style.removeProperty(styleKey);
            if (!target.getAttribute("style")) target.removeAttribute("style");
          }
        });
      } else if (nextStyleValue) {
        // Text is selected — wrap only the selected content in a styled span
        // (same approach as font-size/line-height) so only the selected
        // word/phrase gets the new font, not the entire paragraph.
        const styledSpan = document.createElement("span");
        styledSpan.style.setProperty(styleKey, nextStyleValue);
        const extracted = range.extractContents();
        styledSpan.appendChild(extracted);
        range.insertNode(styledSpan);
        const nextRange = document.createRange();
        nextRange.selectNodeContents(styledSpan);
        nextRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(nextRange);
      } else {
        // Removing font — strip font-family from elements in the selection
        allTargets.forEach((node) => {
          if (range.intersectsNode(node)) targets.add(node);
        });
        targets.forEach((target) => {
          target.style.removeProperty(styleKey);
          if (!target.getAttribute("style")) target.removeAttribute("style");
        });
      }
    } else if (styleKey === "color") {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, styleValue);
    } else {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;

      if (range.collapsed) {
        let target: HTMLElement | null =
          range.startContainer.nodeType === Node.ELEMENT_NODE
            ? (range.startContainer as HTMLElement)
            : range.startContainer.parentElement;

        while (target && target !== el) {
          const tag = target.tagName.toLowerCase();
          if (["span", "p", "li", "div", "a"].includes(tag)) break;
          target = target.parentElement;
        }

        if (!target || target === el) {
          const span = document.createElement("span");
          span.style.setProperty(styleKey, styleValue);
          span.appendChild(document.createTextNode("\u200b"));
          range.insertNode(span);
          const nextRange = document.createRange();
          nextRange.setStart(span.firstChild!, 1);
          nextRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(nextRange);
        } else {
          target.style.setProperty(styleKey, styleValue);
        }
      } else {
        const styledSpan = document.createElement("span");
        styledSpan.style.setProperty(styleKey, styleValue);
        const extracted = range.extractContents();
        styledSpan.appendChild(extracted);
        range.insertNode(styledSpan);
        const nextRange = document.createRange();
        nextRange.selectNodeContents(styledSpan);
        nextRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(nextRange);
      }
    }

    ensureListStyles();
    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, ensureListStyles, restoreSelection, saveSelection, updateToolbarState]);

  const applyColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor) || cssColorToHex(rawColor);
    if (!normalized) return;
    setTextColor(normalized);
    setColorHexInput(normalized);
    applyInlineStyle("color", normalized);
  }, [applyInlineStyle]);

  const insertVariableAtCursor = useCallback((token: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const inserted = document.execCommand("insertText", false, token);
    if (!inserted && typeof window !== "undefined") {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(token);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        el.appendChild(document.createTextNode(token));
        moveCaretToEnd(el);
      }
    }

    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [commitEditorValue, saveSelection, updateToolbarState]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (inlineVarOpen && filteredInlineVarOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setInlineVarActiveIndex((prev) => (prev + 1) % filteredInlineVarOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setInlineVarActiveIndex((prev) => (prev - 1 + filteredInlineVarOptions.length) % filteredInlineVarOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredInlineVarOptions[inlineVarActiveIndex] || filteredInlineVarOptions[0];
        if (selected) applyInlineVariableToken(selected.token);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInlineVarOpen(false);
        return;
      }
    }

    if (e.key !== " ") return;

    const linePrefix = getCurrentLinePrefixText();
    if (linePrefix === null) return;

    const text = linePrefix.replace(/\u00a0/g, " ");
    const unorderedMatch = /^\s*-$/.test(text);
    const orderedMatch = /^\s*1(?:\.|\)|\s-)$/.test(text);
    if (!unorderedMatch && !orderedMatch) return;

    e.preventDefault();

    const command = unorderedMatch ? "insertUnorderedList" : "insertOrderedList";
    document.execCommand(command);
    ensureListStyles();
    const markerCleanupPattern = unorderedMatch
      ? /^\s*-\s*$/
      : /^\s*1(?:\.|\)|\s-)\s*$/;
    const root = editorRef.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    let activeLi: HTMLLIElement | null = null;
    let probe: Node | null = sel?.anchorNode || null;
    while (probe && root && probe !== root) {
      if (probe.nodeType === Node.ELEMENT_NODE && (probe as HTMLElement).tagName.toLowerCase() === "li") {
        activeLi = probe as HTMLLIElement;
        break;
      }
      probe = probe.parentNode;
    }
    if (!activeLi) {
      activeLi = root?.querySelector("li:last-of-type") as HTMLLIElement | null;
    }
    if (activeLi && markerCleanupPattern.test((activeLi.textContent || "").replace(/\u00a0/g, " ").trim())) {
      activeLi.innerHTML = "";
      moveCaretToEnd(activeLi);
    }
    commitEditorValue();
    saveSelection();
    updateToolbarState();
  }, [applyInlineVariableToken, commitEditorValue, ensureListStyles, filteredInlineVarOptions, getCurrentLinePrefixText, inlineVarActiveIndex, inlineVarOpen, saveSelection, updateToolbarState]);

  const isEmpty = stripRichText(internalHtml).length === 0;
  const toolbarButtonClass = (active: boolean) =>
    `px-2 py-1 text-xs rounded border transition-colors ${
      active
        ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
        : "border-[var(--border)] bg-[var(--input)] hover:border-[var(--primary)]"
    }`;
  const listIconMaskStyle = (iconPath: string): CSSProperties => ({
    WebkitMaskImage: `url(${iconPath})`,
    maskImage: `url(${iconPath})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    backgroundColor: "currentColor",
  });
  const activeAlignOption =
    alignmentOptions.find((option) => option.key === commandState.align) || alignmentOptions[0];
  const ActiveAlignIcon = activeAlignOption.icon;
  const defaultFontValue = fontFamilyOptions[0]?.value || DEFAULT_FONT_CONTROL_VALUE;
  const normalizedCurrentFont =
    fontFamilyControl === DEFAULT_FONT_CONTROL_VALUE
      ? DEFAULT_FONT_CONTROL_VALUE
      : normalizeFontFamilyValue(fontFamilyControl);
  const activeFontOption =
    fontFamilyOptions.find((option) => {
      if (option.value === DEFAULT_FONT_CONTROL_VALUE) {
        return normalizedCurrentFont === DEFAULT_FONT_CONTROL_VALUE;
      }
      const normalizedOption = normalizeFontFamilyValue(option.value);
      return (
        normalizedCurrentFont === normalizedOption ||
        normalizedCurrentFont.startsWith(normalizedOption.split(",")[0] || "")
      );
    }) || fontFamilyOptions[0];
  const fontSelectValue = fontSizeOptions.includes(fontSizeControl) ? fontSizeControl : "custom";
  const lineHeightSelectValue = lineHeightOptions.includes(lineHeightControl) ? lineHeightControl : "custom";
  const fontOverrideActive =
    activeFontOption.value !== defaultFontValue;
  const openToolbarTooltip = useCallback(
    (label: string, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      setToolbarTooltip({
        label,
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
      });
    },
    [],
  );
  const closeToolbarTooltip = useCallback(() => setToolbarTooltip(null), []);
  const openAlignDropdown = useCallback(() => {
    if (alignCloseTimerRef.current) {
      clearTimeout(alignCloseTimerRef.current);
      alignCloseTimerRef.current = null;
    }
    setAlignOpen(true);
  }, []);
  const scheduleCloseAlignDropdown = useCallback(() => {
    if (alignCloseTimerRef.current) {
      clearTimeout(alignCloseTimerRef.current);
    }
    alignCloseTimerRef.current = setTimeout(() => {
      setAlignOpen(false);
      alignCloseTimerRef.current = null;
    }, 90);
  }, []);

  useEffect(() => {
    return () => {
      if (alignCloseTimerRef.current) {
        clearTimeout(alignCloseTimerRef.current);
        alignCloseTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-1.5" data-no-component-drag>
      <div className="flex items-center justify-between gap-2">
        <div ref={toolbarRef} className="flex items-center gap-1 flex-wrap">
          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Bold", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Bold", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand("bold")}
              className={`${toolbarButtonClass(commandState.bold)} h-7 w-7 !px-0 flex items-center justify-center font-semibold`}
              aria-label="Bold"
            >
              B
            </button>
          </div>
          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Italic", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Italic", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand("italic")}
              className={`${toolbarButtonClass(commandState.italic)} h-7 w-7 !px-0 flex items-center justify-center italic`}
              aria-label="Italic"
            >
              I
            </button>
          </div>
          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Underline", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Underline", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand("underline")}
              className={`${toolbarButtonClass(commandState.underline)} h-7 w-7 !px-0 flex items-center justify-center underline`}
              aria-label="Underline"
            >
              U
            </button>
          </div>
          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Bulleted list", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Bulleted list", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand("insertUnorderedList")}
              className={`${toolbarButtonClass(commandState.unordered)} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label="Bulleted list"
            >
              <span
                className="w-3.5 h-3.5"
                style={listIconMaskStyle("/icons/editor-bullet-list.svg")}
                aria-hidden="true"
              />
            </button>
          </div>
          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Numbered list", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Numbered list", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand("insertOrderedList")}
              className={`${toolbarButtonClass(commandState.ordered)} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label="Numbered list"
            >
              <span
                className="w-3.5 h-3.5"
                style={listIconMaskStyle("/icons/editor-numbered-list.svg")}
                aria-hidden="true"
              />
            </button>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => {
              openAlignDropdown();
              openToolbarTooltip("Text align", e.currentTarget);
            }}
            onMouseLeave={() => {
              scheduleCloseAlignDropdown();
              closeToolbarTooltip();
            }}
            onFocus={(e) => {
              openAlignDropdown();
              openToolbarTooltip("Text align", e.currentTarget);
            }}
            onBlur={() => {
              scheduleCloseAlignDropdown();
              closeToolbarTooltip();
            }}
          >
            <button
              ref={alignButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (alignOpen) {
                  if (alignCloseTimerRef.current) {
                    clearTimeout(alignCloseTimerRef.current);
                    alignCloseTimerRef.current = null;
                  }
                  setAlignOpen(false);
                } else {
                  openAlignDropdown();
                }
              }}
              className={`${toolbarButtonClass(alignOpen || commandState.align !== "left")} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label={activeAlignOption.label}
            >
              <ActiveAlignIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Font family", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Font family", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              ref={fontButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFontOpen((prev) => !prev)}
              className={`${toolbarButtonClass(fontOpen || fontOverrideActive)} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label="Font family"
            >
              <span
                className="block w-3.5 h-3.5"
                style={listIconMaskStyle("/icons/editor-font-size.svg")}
                aria-hidden="true"
              />
            </button>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Font size", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Font size", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <select
              value={fontSelectValue}
              onChange={(e) => {
                const selected = e.target.value === "custom" ? fontSizeControl : e.target.value;
                setFontSizeControl(selected);
                applyInlineStyle("font-size", selected);
              }}
              className={`h-7 rounded border border-[var(--border)] bg-[var(--input)] text-xs px-2 ${
                showToolbarLabels ? "min-w-[98px]" : "min-w-[84px]"
              }`}
              aria-label="Font size"
            >
              {!fontSizeOptions.includes(fontSizeControl) && (
                <option value="custom">{fontSizeControl}</option>
              )}
              {fontSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Line height", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Line height", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
              </span>
              <select
                value={lineHeightSelectValue}
                onChange={(e) => {
                  const selected = e.target.value === "custom" ? lineHeightControl : e.target.value;
                  setLineHeightControl(selected);
                  applyInlineStyle("line-height", selected);
                }}
                className={`h-7 rounded border border-[var(--border)] bg-[var(--input)] text-xs pl-7 pr-2 ${
                  showToolbarLabels ? "min-w-[98px]" : "min-w-[84px]"
                }`}
                aria-label="Line height"
              >
                {!lineHeightOptions.includes(lineHeightControl) && (
                  <option value="custom">{lineHeightControl}</option>
                )}
                {lineHeightOptions.map((lh) => (
                  <option key={lh} value={lh}>
                    {lh}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Link", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Link", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openLinkModal}
              className={`${toolbarButtonClass(commandState.link)} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label="Add link"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Clear formatting", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Clear formatting", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearFormatting}
              className={`${toolbarButtonClass(false)} h-7 w-7 !px-0 flex items-center justify-center`}
              aria-label="Clear formatting"
            >
              <span
                className="block w-3.5 h-3.5"
                style={listIconMaskStyle("/icons/editor-clear-formatting.svg")}
                aria-hidden="true"
              />
            </button>
          </div>

          <div
            className="relative group"
            data-no-component-drag
            onMouseEnter={(e) => openToolbarTooltip("Text color", e.currentTarget)}
            onMouseLeave={closeToolbarTooltip}
            onFocus={(e) => openToolbarTooltip("Text color", e.currentTarget)}
            onBlur={closeToolbarTooltip}
          >
            <button
              ref={colorButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setColorOpen((prev) => !prev)}
              className={`${toolbarButtonClass(colorOpen)} h-7 w-9 !px-0 flex items-center justify-center`}
              aria-label="Text color"
            >
              <span
                className="w-3.5 h-3.5 rounded-sm border border-[var(--border)]"
                style={{ backgroundColor: textColor }}
              />
            </button>
          </div>

          {alignOpen &&
            createPortal(
              <div
                ref={alignDropdownRef}
                style={alignDropdownPos}
                className="-translate-x-1/2 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] backdrop-blur-xl backdrop-saturate-150 shadow-[0_18px_35px_rgba(0,0,0,0.45)] p-1"
                onMouseEnter={openAlignDropdown}
                onMouseLeave={scheduleCloseAlignDropdown}
              >
                {alignmentOptions.map((option) => {
                  const AlignIcon = option.icon;
                  const active = commandState.align === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyAlignment(option.key);
                        setAlignOpen(false);
                      }}
                      className={`${toolbarButtonClass(active)} h-7 w-7 !px-0 flex items-center justify-center`}
                      aria-label={option.label}
                    >
                      <AlignIcon className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}

          {fontOpen &&
            createPortal(
              <div
                ref={fontDropdownRef}
                style={fontDropdownPos}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] backdrop-blur-xl backdrop-saturate-150 shadow-[0_20px_40px_rgba(0,0,0,0.5)] overflow-hidden max-h-64 overflow-y-auto"
              >
                {fontFamilyOptions.map((option) => {
                  const active =
                    option.value === DEFAULT_FONT_CONTROL_VALUE
                      ? activeFontOption.value === DEFAULT_FONT_CONTROL_VALUE
                      : normalizeFontFamilyValue(option.value) ===
                        normalizeFontFamilyValue(activeFontOption.value);
                  return (
                    <button
                      key={`${option.value}-${option.label}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFontFamilyControl(option.value);
                        applyInlineStyle("font-family", option.value);
                        setFontOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                          : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                      }`}
                      style={{
                        fontFamily:
                          option.value === DEFAULT_FONT_CONTROL_VALUE
                            ? effectiveBaseFontFamily
                            : option.value,
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}

          {colorOpen &&
            createPortal(
              <div
                ref={colorDropdownRef}
                className="w-56 rounded-xl border border-[var(--border)] shadow-[0_22px_50px_rgba(0,0,0,0.6)] p-2.5 space-y-2 backdrop-blur-2xl backdrop-saturate-200"
                data-no-component-drag
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  ...colorDropdownPos,
                  background: "var(--card)",
                }}
              >
                {brandColors && brandColors.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
                      Brand Colors
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {brandColors.map((color) => (
                        <button
                          key={`${color.label}-${color.value}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyColor(color.value)}
                          className="w-5 h-5 rounded border border-[var(--border)]"
                          style={{ backgroundColor: color.value }}
                          aria-label={`${color.label} ${color.value}`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeHexColor(textColor) || "#111111"}
                    onChange={(e) => applyColor(e.target.value)}
                    className="w-8 h-8 rounded border border-[var(--border)] bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={colorHexInput}
                    onChange={(e) => setColorHexInput(e.target.value)}
                    onBlur={() => {
                      const normalized = normalizeHexColor(colorHexInput);
                      if (normalized) {
                        setColorHexInput(normalized);
                        applyColor(normalized);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const normalized = normalizeHexColor(colorHexInput);
                        if (normalized) {
                          setColorHexInput(normalized);
                          applyColor(normalized);
                        }
                        setColorOpen(false);
                      }
                    }}
                    placeholder="#111111"
                    className="flex-1 h-8 px-2 text-xs font-mono rounded border border-[var(--border)] bg-[var(--input)]"
                  />
                </div>
              </div>,
              document.body,
            )}
          {toolbarTooltip &&
            createPortal(
              <div
                ref={toolbarTooltipRef}
                className="pointer-events-none fixed z-[1300] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/15 bg-[rgba(8,12,22,0.94)] px-2 py-1 text-[10px] font-medium text-white shadow-lg backdrop-blur-xl"
                style={{ left: toolbarTooltip.left, top: toolbarTooltip.top }}
              >
                {toolbarTooltip.label}
              </div>,
              document.body,
            )}
          {linkModalOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-[1320] backdrop-blur-md flex items-center justify-center p-4"
                style={{
                  background: "color-mix(in srgb, var(--background) 68%, transparent)",
                }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) {
                    closeLinkModal();
                  }
                }}
              >
                <div
                  className="w-full max-w-sm rounded-xl border border-[var(--border)] p-4 space-y-3 text-[var(--foreground)] shadow-[0_32px_90px_rgba(0,0,0,0.45)] backdrop-blur-3xl backdrop-saturate-[1.9]"
                  style={{
                    background: "color-mix(in srgb, var(--card) 92%, transparent)",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">Insert Link</h3>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Enter a URL, `mailto:`, `tel:`, or relative path.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted-foreground)]">Preview As</label>
                    <div
                      className="h-9 px-3 rounded-lg border border-[var(--border)] text-sm flex items-center text-[var(--foreground)]"
                      style={{
                        background: "color-mix(in srgb, var(--input) 94%, transparent)",
                      }}
                    >
                      {previewAsLabel || "Sample"}
                    </div>
                  </div>
                  <input
                    ref={linkInputRef}
                    type="text"
                    value={linkInputValue}
                    onChange={(e) => setLinkInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyLinkFromModal();
                      }
                    }}
                    placeholder="https://example.com"
                    className="w-full h-9 px-3 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)]"
                    style={{
                      background: "color-mix(in srgb, var(--input) 94%, transparent)",
                    }}
                  />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={removeLink}
                      className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                      style={{
                        background: "color-mix(in srgb, var(--input) 92%, transparent)",
                      }}
                    >
                      Remove Link
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={closeLinkModal}
                        className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                        style={{
                          background: "color-mix(in srgb, var(--input) 92%, transparent)",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={applyLinkFromModal}
                        className="px-3 py-1.5 text-xs rounded border border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
                      >
                        Apply Link
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body,
            )}
        </div>
        {onInsertVariable && (
          <VariablePickerButton onInsert={insertVariableAtCursor} />
        )}
      </div>

      <div className="relative">
        {isEmpty && !isFocused && placeholderText && (
          <span className="pointer-events-none absolute left-3 top-4 text-sm text-[var(--muted-foreground)]">
            {placeholderText}
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-no-component-drag
          onFocus={() => {
            setIsFocused(true);
            try {
              document.execCommand("defaultParagraphSeparator", false, "p");
            } catch {
              // Ignore if unsupported.
            }
            saveSelection();
            updateToolbarState();
            syncInlineVariableAutocomplete();
          }}
          onBlur={() => {
            setIsFocused(false);
            commitEditorValue();
            updateToolbarState();
            setTimeout(() => setInlineVarOpen(false), 120);
          }}
          onInput={() => {
            commitEditorValue();
            saveSelection();
            updateToolbarState();
            syncInlineVariableAutocomplete();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={() => {
            saveSelection();
            updateToolbarState();
            syncInlineVariableAutocomplete();
          }}
          onMouseUp={() => {
            saveSelection();
            updateToolbarState();
            syncInlineVariableAutocomplete();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
            commitEditorValue();
            saveSelection();
            updateToolbarState();
            syncInlineVariableAutocomplete();
          }}
          className="w-full min-h-[140px] max-h-[420px] overflow-auto resize-y whitespace-pre-wrap break-words bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-4 text-sm leading-6 outline-none focus:border-[var(--primary)] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-0.5"
          style={{ fontFamily: effectiveBaseFontFamily }}
        />
        {inlineVarOpen && filteredInlineVarOptions.length > 0 && (
          <div
            className="absolute left-3 right-3 bottom-3 z-20 rounded-lg border border-[var(--border)] backdrop-blur-xl backdrop-saturate-150 shadow-xl max-h-48 overflow-y-auto"
            style={{ background: "color-mix(in srgb, var(--background) 96%, transparent)" }}
          >
            {filteredInlineVarOptions.map((option, idx) => {
              const isActive = idx === inlineVarActiveIndex;
              return (
                <button
                  key={option.token}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyInlineVariableToken(option.token);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 transition-colors ${
                    isActive
                      ? "bg-[var(--primary)]/10"
                      : "hover:bg-[var(--muted)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--foreground)] truncate">{option.label}</span>
                    <code className="text-[10px] font-mono text-[var(--muted-foreground)] truncate max-w-[55%]">
                      {option.token}
                    </code>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PropField({
  prop,
  value,
  onChange,
  onLiveStyle,
  onBrowseMedia,
  onBrowseIcon,
  onUploadMedia,
  onInsertVariable,
  brandColors,
  previewAsLabel,
  richTextBaseFontFamily,
  inlineVariableOptions = [],
}: {
  prop: {
    key: string;
    label: string;
    type: string;
    default?: string;
    placeholder?: string;
    options?: { label: string; value: string }[];
    min?: number;
    max?: number;
  };
  value: string;
  onChange: (val: string) => void;
  onLiveStyle?: (val: string) => void;
  onBrowseMedia?: () => void;
  onBrowseIcon?: () => void;
  onUploadMedia?: (file: File) => Promise<void>;
  onInsertVariable?: (token: string) => void;
  brandColors?: { label: string; value: string }[];
  previewAsLabel?: string;
  richTextBaseFontFamily?: string;
  inlineVariableOptions?: InlineVariableOption[];
}) {
  const placeholderText = prop.placeholder || prop.default;
  const inputRef = useRef<HTMLInputElement>(null);
  const [inlineVarOpen, setInlineVarOpen] = useState(false);
  const [inlineVarQuery, setInlineVarQuery] = useState("");
  const [inlineVarActiveIndex, setInlineVarActiveIndex] = useState(0);
  const [inlineVarRange, setInlineVarRange] = useState<{ start: number; end: number } | null>(null);

  const filteredInlineVarOptions = useMemo(
    () => filterInlineVariableOptions(inlineVariableOptions, inlineVarQuery).slice(0, 12),
    [inlineVariableOptions, inlineVarQuery],
  );

  const syncInlineVarFromInput = useCallback((text: string, caret: number) => {
    if (inlineVariableOptions.length === 0) {
      setInlineVarOpen(false);
      return;
    }
    const trigger = findInlineVariableTrigger(text, caret);
    if (!trigger) {
      setInlineVarOpen(false);
      return;
    }
    setInlineVarQuery(trigger.query);
    setInlineVarRange({ start: trigger.start, end: trigger.end });
    setInlineVarOpen(true);
    setInlineVarActiveIndex(0);
  }, [inlineVariableOptions.length]);

  const applyInlineVarToken = useCallback((token: string) => {
    const currentValue = inputRef.current?.value ?? value ?? "";
    const range = inlineVarRange;
    let nextValue = currentValue;
    let nextCaret = currentValue.length;
    if (range) {
      nextValue = `${currentValue.slice(0, range.start)}${token}${currentValue.slice(range.end)}`;
      nextCaret = range.start + token.length;
    } else {
      nextValue = `${currentValue}${token}`;
      nextCaret = nextValue.length;
    }
    onChange(nextValue);
    setInlineVarOpen(false);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  }, [inlineVarRange, onChange, value]);

  useEffect(() => {
    if (!inlineVarOpen) return;
    if (filteredInlineVarOptions.length === 0) {
      setInlineVarOpen(false);
      return;
    }
    if (inlineVarActiveIndex >= filteredInlineVarOptions.length) {
      setInlineVarActiveIndex(0);
    }
  }, [filteredInlineVarOptions.length, inlineVarActiveIndex, inlineVarOpen]);

  if (prop.type === "padding") {
    return (
      <SpacingField
        value={value}
        onChange={onChange}
        placeholder={placeholderText}
      />
    );
  }
  if (prop.type === "radius") {
    return (
      <BorderRadiusField
        value={value}
        onChange={onChange}
        placeholder={placeholderText}
      />
    );
  }
  if (prop.type === "unit") {
    return (
      <SliderUnitInput
        value={value}
        placeholder={placeholderText}
        onChange={(val) => onChange(val ? ensureUnit(val) : "")}
        propKey={prop.key}
      />
    );
  }
  if (prop.type === "color") {
    const [colorOpen, setColorOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const svPanelRef = useRef<HTMLDivElement>(null);
    const huePanelRef = useRef<HTMLDivElement>(null);
    const swatches = brandColors?.filter((c) => c.value) || [];
    const displayColor = value || placeholderText || "#000000";
    const [dropdownPos, setDropdownPos] = useState<CSSProperties>({});
    const draggingRef = useRef<"sv" | "hue" | null>(null);

    // Internal HSV state — synced from value on open
    const parsed = isValidHex(displayColor) ? hexToHsv(displayColor) : { h: 0, s: 0, v: 1 };
    const [hue, setHue] = useState(parsed.h);
    const [sat, setSat] = useState(parsed.s);
    const [bright, setBright] = useState(parsed.v);
    const hexFromHsv = hsvToHex(hue, sat, bright);

    // Sync HSV when external value changes while closed
    const prevValueRef = useRef(value);
    useEffect(() => {
      if (!colorOpen && value !== prevValueRef.current) {
        prevValueRef.current = value;
        if (value && isValidHex(value)) {
          const p = hexToHsv(value);
          setHue(p.h); setSat(p.s); setBright(p.v);
        }
      }
    }, [value, colorOpen]);

    useEffect(() => {
      if (!colorOpen) return;
      const handleClick = (e: MouseEvent) => {
        if (
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)
        ) setColorOpen(false);
      };
      const handleUp = () => { draggingRef.current = null; };
      const handleMove = (e: MouseEvent) => {
        if (draggingRef.current === "sv" && svPanelRef.current) {
          const rect = svPanelRef.current.getBoundingClientRect();
          const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
          setSat(s); setBright(v);
          const hex = hsvToHex(hue, s, v);
          onChange(hex); onLiveStyle?.(hex);
        } else if (draggingRef.current === "hue" && huePanelRef.current) {
          const rect = huePanelRef.current.getBoundingClientRect();
          const h = Math.max(0, Math.min(359, ((e.clientX - rect.left) / rect.width) * 360));
          setHue(h);
          const hex = hsvToHex(h, sat, bright);
          onChange(hex); onLiveStyle?.(hex);
        }
      };
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("mouseup", handleUp);
      document.addEventListener("mousemove", handleMove);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("mouseup", handleUp);
        document.removeEventListener("mousemove", handleMove);
      };
    }, [colorOpen, hue, sat, bright, onChange, onLiveStyle]);

    const openDropdown = () => {
      if (colorOpen) { setColorOpen(false); return; }
      // Sync HSV from current value on open
      if (value && isValidHex(value)) {
        const p = hexToHsv(value);
        setHue(p.h); setSat(p.s); setBright(p.v);
      }
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setDropdownPos({ position: "fixed", top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240), zIndex: 9999 });
      }
      setColorOpen(true);
    };

    const applyColor = (c: string) => { onChange(c); onLiveStyle?.(c); };

    const handleSvDown = (e: React.MouseEvent) => {
      draggingRef.current = "sv";
      if (!svPanelRef.current) return;
      const rect = svPanelRef.current.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      setSat(s); setBright(v);
      const hex = hsvToHex(hue, s, v);
      onChange(hex); onLiveStyle?.(hex);
    };

    const handleHueDown = (e: React.MouseEvent) => {
      draggingRef.current = "hue";
      if (!huePanelRef.current) return;
      const rect = huePanelRef.current.getBoundingClientRect();
      const h = Math.max(0, Math.min(359, ((e.clientX - rect.left) / rect.width) * 360));
      setHue(h);
      const hex = hsvToHex(h, sat, bright);
      onChange(hex); onLiveStyle?.(hex);
    };

    const hueColor = hsvToHex(hue, 1, 1);

    return (
      <div className="w-[108px] max-w-full sm:w-[132px]">
        <button
          ref={triggerRef}
          type="button"
          onClick={openDropdown}
          className="flex w-full items-center gap-2 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-left hover:border-[var(--primary)] transition-colors"
        >
          <div className="h-5 w-5 rounded-md border border-[var(--border)] flex-shrink-0" style={{ backgroundColor: displayColor }} />
          <span className="min-w-0 truncate font-mono text-xs text-[var(--foreground)]">{value || placeholderText || "#000000"}</span>
        </button>

        {colorOpen && createPortal(
          <div ref={dropdownRef} style={dropdownPos} className="border border-[var(--border)] rounded-xl shadow-2xl backdrop-blur-2xl bg-[var(--popover)]/95 p-3 space-y-3">
            {/* Brand palette */}
            {swatches.length > 0 && (
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">Brand Colors</span>
                <div className="flex flex-wrap gap-1.5">
                  {swatches.map((c) => {
                    const isActive = value?.toLowerCase() === c.value.toLowerCase();
                    return (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => {
                          applyColor(c.value);
                          if (isValidHex(c.value)) { const p = hexToHsv(c.value); setHue(p.h); setSat(p.s); setBright(p.v); }
                        }}
                        title={`${c.label} (${c.value})`}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-medium transition-all ${
                          isActive
                            ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
                        }`}
                      >
                        <span className="w-3.5 h-3.5 rounded-full border border-black/10 flex-shrink-0" style={{ backgroundColor: c.value }} />
                        <span className="whitespace-nowrap">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SV panel */}
            <div
              ref={svPanelRef}
              className="relative w-full h-[140px] rounded-lg cursor-crosshair overflow-hidden border border-[var(--border)]"
              style={{ backgroundColor: hueColor }}
              onMouseDown={handleSvDown}
            >
              <div className="absolute inset-0" style={{ background: "linear-gradient(to right, #ffffff, transparent)" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent, #000000)" }} />
              <div
                className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ left: `${sat * 100}%`, top: `${(1 - bright) * 100}%` }}
              />
            </div>

            {/* Hue slider */}
            <div
              ref={huePanelRef}
              className="relative w-full h-3.5 rounded-full cursor-pointer border border-[var(--border)]"
              style={{ background: "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)" }}
              onMouseDown={handleHueDown}
            >
              <div
                className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] -translate-x-1/2 -translate-y-1/2 pointer-events-none top-1/2"
                style={{ left: `${(hue / 360) * 100}%` }}
              />
            </div>

            {/* Hex input + preview swatch + eyedropper */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg border border-[var(--border)] flex-shrink-0" style={{ backgroundColor: hexFromHsv }} />
              <input
                type="text"
                value={value || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  applyColor(v);
                  if (isValidHex(v)) { const p = hexToHsv(v); setHue(p.h); setSat(p.s); setBright(p.v); }
                }}
                onKeyDown={(e) => { if (e.key === "Enter") setColorOpen(false); }}
                className="flex-1 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-[var(--primary)] min-w-0"
                placeholder={placeholderText || "#000000"}
              />
              {"EyeDropper" in window && (
                <button
                  type="button"
                  title="Pick color from screen"
                  className="flex-shrink-0 p-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors"
                  onClick={async () => {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const dropper = new (window as any).EyeDropper();
                      const result = await dropper.open();
                      const hex = result.sRGBHex as string;
                      applyColor(hex);
                      if (isValidHex(hex)) { const p = hexToHsv(hex); setHue(p.h); setSat(p.s); setBright(p.v); }
                    } catch { /* user cancelled */ }
                  }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 22l1-1h3l9-9" />
                    <path d="M3 21v-3l9-9" />
                    <path d="M14.5 5.5 18 2l4 4-3.5 3.5" />
                    <path d="M12 8l4 4" />
                  </svg>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>
    );
  }
  if (prop.type === "fontSelect") {
    const [fontOpen, setFontOpen] = useState(false);
    const fontTriggerRef = useRef<HTMLButtonElement>(null);
    const fontDropdownRef = useRef<HTMLDivElement>(null);
    const [fontPos, setFontPos] = useState<CSSProperties>({});
    const selectedFont = prop.options?.find((o) => o.value === value);
    useEffect(() => {
      if (!fontOpen) return;
      const handleClick = (e: MouseEvent) => {
        if (
          fontDropdownRef.current && !fontDropdownRef.current.contains(e.target as Node) &&
          fontTriggerRef.current && !fontTriggerRef.current.contains(e.target as Node)
        ) setFontOpen(false);
      };
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [fontOpen]);
    const openFontDropdown = () => {
      if (fontOpen) { setFontOpen(false); return; }
      if (fontTriggerRef.current) {
        const rect = fontTriggerRef.current.getBoundingClientRect();
        setFontPos({ position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 });
      }
      setFontOpen(true);
    };
    return (
      <div className="w-full">
        <button
          ref={fontTriggerRef}
          type="button"
          onClick={openFontDropdown}
          className="w-full flex items-center justify-between bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-left hover:border-[var(--primary)] transition-colors"
        >
          <span
            className="truncate"
            style={{ fontFamily: value || placeholderText || "inherit" }}
          >
            {selectedFont?.label || "Default (Helvetica)"}
          </span>
          <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0 ml-2" />
        </button>
        {fontOpen && createPortal(
          <div ref={fontDropdownRef} style={fontPos} className="border border-[var(--border)] rounded-lg shadow-xl overflow-hidden max-h-[260px] overflow-y-auto backdrop-blur-xl bg-[var(--card)]/90">
            <button
              type="button"
              onClick={() => { onChange(""); onLiveStyle?.(""); setFontOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors ${!value ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}
            >
              Default (Helvetica)
            </button>
            {prop.options?.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); onLiveStyle?.(opt.value); setFontOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors ${value === opt.value ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--foreground)]"}`}
                style={{ fontFamily: opt.value }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    );
  }
  if (prop.type === "select" && isAlignmentOptions(prop.options)) {
    return <AlignmentButtons value={value || prop.default || ""} onChange={onChange} />;
  }
  if (prop.type === "select" && isVerticalAlignOptions(prop.options)) {
    return <AlignmentButtons value={value || prop.default || ""} onChange={onChange} vertical />;
  }
  if (prop.type === "select") {
    return (
      <select
        value={value || prop.default || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
      >
        <option value="">Default</option>
        {prop.options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "textarea") {
    return (
      <RichTextField
        value={value || ""}
        onChange={onChange}
        placeholderText={placeholderText}
        onInsertVariable={onInsertVariable}
        brandColors={brandColors}
        previewAsLabel={previewAsLabel}
        baseFontFamily={richTextBaseFontFamily}
        inlineVariableOptions={inlineVariableOptions}
      />
    );
  }
  if (prop.type === "image") {
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewError, setPreviewError] = useState(false);
    const canOpenMedia = Boolean(onBrowseMedia);
    const canUploadMedia = Boolean(onUploadMedia);
    const imageLabel = useMemo(() => {
      if (!value) return "";
      const withoutQuery = value.split("?")[0] || value;
      const segments = withoutQuery.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (!lastSegment) return value;
      try {
        return decodeURIComponent(lastSegment);
      } catch {
        return lastSegment;
      }
    }, [value]);

    useEffect(() => {
      setPreviewError(false);
    }, [value]);

    const handleMediaUpload = async (file?: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Drop an image file");
        return;
      }
      if (!onUploadMedia) {
        toast.error("Media uploads are not available here");
        return;
      }
      setUploading(true);
      try {
        await onUploadMedia(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to upload image");
      } finally {
        setUploading(false);
        setDragOver(false);
      }
    };

    const displaySrc = (value && !previewError) ? value : IMAGE_PLACEHOLDER;
    const hasImage = Boolean(value && !previewError);

    return (
      <div
        className={`group relative w-full overflow-hidden rounded-lg border transition-all ${
          dragOver
            ? "border-[var(--primary)] bg-[var(--primary)]/10"
            : "border-[var(--border)] hover:border-[var(--primary)]/60"
        } ${uploading || (!canOpenMedia && !canUploadMedia) ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
        onClick={() => { if (!uploading) onBrowseMedia?.(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer.files?.[0];
          void handleMediaUpload(file);
        }}
        onDragOver={(e) => {
          if (!canUploadMedia) return;
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-5">
            <ArrowPathIcon className="h-4 w-4 animate-spin text-[var(--primary)]" />
            <span className="text-xs text-[var(--muted-foreground)]">Uploading...</span>
          </div>
        ) : (
          <div className="relative">
            <img
              src={displaySrc}
              alt={imageLabel || prop.label}
              className={`w-full h-28 object-cover${!hasImage ? " opacity-40" : ""}`}
              onError={() => setPreviewError(true)}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 group-hover:bg-black/40 group-hover:opacity-100 transition-all">
              <span className="text-[11px] font-medium text-white">{hasImage ? "Replace" : "Choose image"}</span>
            </div>
            {hasImage && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
                className="absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 hover:text-white"
                title="Remove image"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (prop.type === "icon") {
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewError, setPreviewError] = useState(false);
    const canOpenLibrary = Boolean(onBrowseIcon);
    const canUploadIcon = Boolean(onUploadMedia);
    const iconLabel = useMemo(() => {
      if (!value) return "";
      const withoutQuery = value.split("?")[0] || value;
      const segments = withoutQuery.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (!lastSegment) return value;
      try {
        return decodeURIComponent(lastSegment);
      } catch {
        return lastSegment;
      }
    }, [value]);

    useEffect(() => {
      setPreviewError(false);
    }, [value]);

    const handleIconUpload = async (file?: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Drop an SVG or icon image");
        return;
      }
      if (!onUploadMedia) {
        toast.error("Icon uploads are not available here");
        return;
      }
      setUploading(true);
      try {
        const uploadFile =
          file.type === "image/svg+xml"
            ? await rasterizeSvgToPngFile(
                await file.text(),
                file.name.replace(/\.svg$/i, ""),
              )
            : file;
        await onUploadMedia(uploadFile);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to upload icon",
        );
      } finally {
        setUploading(false);
        setDragOver(false);
      }
    };

    const hasIcon = Boolean(value && !previewError);

    return (
      <div className="flex items-start gap-3">
        <div
          data-no-component-drag
          className={`group relative aspect-square w-28 flex-shrink-0 overflow-hidden rounded-xl border border-dashed transition-all ${
            dragOver
              ? "border-[var(--primary)] bg-[var(--primary)]/10"
              : "border-[var(--border)] bg-[var(--input)]/50 hover:border-[var(--primary)]/60"
          } ${
            uploading || (!canOpenLibrary && !canUploadIcon)
              ? "cursor-not-allowed opacity-70"
              : "cursor-pointer"
          }`}
          onClick={() => {
            if (!uploading) onBrowseIcon?.();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const file = event.dataTransfer.files?.[0];
            void handleIconUpload(file);
          }}
          onDragOver={(event) => {
            if (!canUploadIcon) return;
            event.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
        >
          {uploading ? (
            <div className="flex h-full items-center justify-center gap-2 px-2 text-center">
              <ArrowPathIcon className="h-4 w-4 animate-spin text-[var(--primary)]" />
              <span className="text-xs text-[var(--muted-foreground)]">
                Uploading...
              </span>
            </div>
          ) : hasIcon ? (
            <>
              <img
                src={value}
                alt={iconLabel || prop.label}
                className="h-full w-full object-contain p-4"
                onError={() => setPreviewError(true)}
              />
              <button
                type="button"
                data-no-component-drag
                onClick={(event) => {
                  event.stopPropagation();
                  onChange("");
                }}
                className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100"
                title="Remove icon"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-3 text-center">
              <Squares2X2Icon className="h-8 w-8 text-[var(--muted-foreground)]/70" />
              <p className="mt-2 text-[11px] font-medium text-[var(--foreground)]">
                Choose icon
              </p>
              <p className="mt-1 text-[10px] leading-tight text-[var(--muted-foreground)]">
                Library or drag SVG
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <button
            type="button"
            data-no-component-drag
            onClick={() => {
              if (!uploading) onBrowseIcon?.();
            }}
            disabled={uploading || !canOpenLibrary}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-left text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasIcon ? "Replace from icon library" : "Choose from icon library"}
          </button>
          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Search the built-in icon library, or drag your own SVG or icon image onto the preview tile.
          </p>
          {hasIcon && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/50 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              {iconLabel}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (prop.type === "toggle") {
    const isOn = (value || prop.default) === "true";
    return (
      <button
        onClick={() => onChange(isOn ? "false" : "true")}
        className={`relative w-10 h-5 rounded-full transition-colors ${isOn ? "bg-[var(--primary)]" : "bg-zinc-600"}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isOn ? "left-5" : "left-0.5"}`}
        />
      </button>
    );
  }
  if (prop.type === "range") {
    const numVal = parseInt(value || prop.default || "100", 10);
    const min = prop.min ?? 0;
    const max = prop.max ?? 100;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={numVal}
          onChange={(e) => onChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-1 h-1 range-slider"
        />
        <span className="text-xs text-[var(--muted-foreground)] w-8 text-right tabular-nums">{numVal}%</span>
      </div>
    );
  }
  // Text/URL/number — variable picker for eligible types
  if (onInsertVariable && prop.type !== "number") {
    return (
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={value || ""}
            onChange={(e) => {
              onChange(e.target.value);
              syncInlineVarFromInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={(e) => {
              if (!inlineVarOpen || filteredInlineVarOptions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setInlineVarActiveIndex((prev) => (prev + 1) % filteredInlineVarOptions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setInlineVarActiveIndex((prev) => (prev - 1 + filteredInlineVarOptions.length) % filteredInlineVarOptions.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredInlineVarOptions[inlineVarActiveIndex] || filteredInlineVarOptions[0];
                if (selected) applyInlineVarToken(selected.token);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setInlineVarOpen(false);
              }
            }}
            onBlur={() => setTimeout(() => setInlineVarOpen(false), 120)}
            className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
            placeholder={placeholderText}
          />
          <VariablePickerButton onInsert={onInsertVariable} />
        </div>
        {inlineVarOpen && filteredInlineVarOptions.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-[var(--border)] backdrop-blur-xl backdrop-saturate-150 shadow-xl max-h-52 overflow-y-auto"
            style={{ background: "color-mix(in srgb, var(--background) 96%, transparent)" }}
          >
            {filteredInlineVarOptions.map((option, idx) => {
              const isActive = idx === inlineVarActiveIndex;
              return (
                <button
                  key={option.token}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyInlineVarToken(option.token);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 transition-colors ${
                    isActive ? "bg-[var(--primary)]/10" : "hover:bg-[var(--muted)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--foreground)] truncate">{option.label}</span>
                    <code className="text-[10px] font-mono text-[var(--muted-foreground)] truncate max-w-[55%]">
                      {option.token}
                    </code>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const isNumberInput = prop.type === "number";
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type={isNumberInput ? "number" : "text"}
        value={value || ""}
        onChange={(e) => {
          onChange(e.target.value);
          if (!isNumberInput) {
            syncInlineVarFromInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }
        }}
        onKeyDown={(e) => {
          if (!inlineVarOpen || filteredInlineVarOptions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setInlineVarActiveIndex((prev) => (prev + 1) % filteredInlineVarOptions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setInlineVarActiveIndex((prev) => (prev - 1 + filteredInlineVarOptions.length) % filteredInlineVarOptions.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const selected = filteredInlineVarOptions[inlineVarActiveIndex] || filteredInlineVarOptions[0];
            if (selected) applyInlineVarToken(selected.token);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setInlineVarOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setInlineVarOpen(false), 120)}
        onWheel={(e) => e.currentTarget.blur()}
        className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
        placeholder={placeholderText}
      />
      {!isNumberInput && inlineVarOpen && filteredInlineVarOptions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-[var(--border)] backdrop-blur-xl backdrop-saturate-150 shadow-xl max-h-52 overflow-y-auto"
          style={{ background: "color-mix(in srgb, var(--background) 96%, transparent)" }}
        >
          {filteredInlineVarOptions.map((option, idx) => {
            const isActive = idx === inlineVarActiveIndex;
            return (
              <button
                key={option.token}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyInlineVarToken(option.token);
                }}
                className={`w-full text-left px-2.5 py-1.5 transition-colors ${
                  isActive ? "bg-[var(--primary)]/10" : "hover:bg-[var(--muted)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--foreground)] truncate">{option.label}</span>
                  <code className="text-[10px] font-mono text-[var(--muted-foreground)] truncate max-w-[55%]">
                    {option.token}
                  </code>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Group configuration for prop organization ---
const GROUP_CONFIG: Record<string, { label: string; order: number; defaultOpen?: boolean }> = {
  stats: { label: 'Stats', order: -1 },
  text: { label: 'Text', order: 0, defaultOpen: true },
  "footer-logo-bg": { label: 'Logo & Background', order: 0, defaultOpen: true },
  "footer-business": { label: 'Business Details', order: 1 },
  "footer-socials": { label: 'Socials', order: 2 },
  "footer-legal": { label: 'Legal', order: 3 },
  background: { label: 'Background', order: 1 },
  buttons: { label: 'Buttons', order: 2 },
  layout: { label: 'Layout', order: 4 },
  border: { label: 'Border', order: 5 },
  tracking: { label: 'Tracking', order: 6 },
};

const SPLIT_SIDE_EDITABLE_GROUPS = new Set([
  "text",
  "background",
  "buttons",
  "layout",
  "tracking",
]);

// Button set tabs (Primary / Secondary toggle like Elementor's hover/active tabs)
function ButtonSetTabs({
  groupProps,
  activeTab,
  onTabChange,
  renderStandardProps,
  tabs = ["primary", "secondary"],
  hideTabsWhenSingle = false,
}: {
  groupProps: { key: string; label: string; type: string; buttonSet?: 'primary' | 'secondary'; [k: string]: unknown }[];
  activeTab: 'primary' | 'secondary';
  onTabChange: (tab: 'primary' | 'secondary') => void;
  renderStandardProps: (props: typeof groupProps) => React.ReactNode[];
  tabs?: ("primary" | "secondary")[];
  hideTabsWhenSingle?: boolean;
}) {
  const resolvedTabs: ("primary" | "secondary")[] =
    tabs.length > 0 ? tabs : ["primary"];
  const resolvedActiveTab = resolvedTabs.includes(activeTab) ? activeTab : resolvedTabs[0];
  const showTabs = !(hideTabsWhenSingle && resolvedTabs.length <= 1);
  const filteredProps = groupProps.filter(
    (p) => !p.buttonSet || p.buttonSet === resolvedActiveTab,
  );

  return (
    <div className="space-y-4">
      {showTabs && (
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          {resolvedTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                resolvedActiveTab === tab
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}
      {renderStandardProps(filteredProps as typeof groupProps)}
    </div>
  );
}

// Collapsible prop group wrapper (Elementor-style section separators)
function CollapsiblePropGroup({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)]">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 pt-3.5 pb-2.5 text-left group/grp"
      >
        <ChevronRightIcon
          className="chevron-icon w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0"
          data-open={isOpen}
        />
        <span className="text-[11px] font-semibold text-[var(--foreground)] uppercase tracking-wider">
          {label}
        </span>
      </button>
      <div className="collapsible-wrapper" data-open={isOpen}>
        <div className="collapsible-inner">
          <div className="space-y-4 pb-4 px-px">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Elementor-style border editor: type + linked side widths + color
function BorderSideEditor({
  props: allBorderProps,
  values,
  onChange,
  onLiveStyle,
  brandColors,
}: {
  props: { key: string; label: string; type: string; default?: string; options?: { label: string; value: string }[] }[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  onLiveStyle?: (key: string, val: string) => void;
  brandColors?: { label: string; value: string }[];
}) {
  const sides = ["top", "right", "bottom", "left"] as const;
  type Side = (typeof sides)[number];
  const sideLabels: Record<Side, string> = {
    top: "Top",
    right: "Right",
    bottom: "Bottom",
    left: "Left",
  };

  // Find the "all sides" shorthand props (no -top/-right/-bottom/-left in key)
  const findShorthand = (type: string) =>
    allBorderProps.find(
      (p) => p.type === type && !p.key.match(/-(top|right|bottom|left)-/),
    );
  const shorthandStyle = findShorthand("select");
  const shorthandWidth = allBorderProps.find(
    (p) =>
      (p.type === "text" || p.type === "unit") &&
      !p.key.match(/-(top|right|bottom|left)-/) &&
      p.key.includes("width"),
  );
  const shorthandColor = allBorderProps.find(
    (p) => p.type === "color" && !p.key.match(/-(top|right|bottom|left)-/),
  );

  // If this is a divider-style border (no per-side props), render differently
  const hasPerSide = allBorderProps.some((p) =>
    p.key.match(/-(top|right|bottom|left)-/),
  );

  // Find per-side props by pattern
  const findSideProp = (side: Side, type: "style" | "width" | "color") => {
    if (type === "style")
      return allBorderProps.find((p) => p.key.endsWith(`-${side}-style`));
    if (type === "width")
      return allBorderProps.find((p) => p.key.endsWith(`-${side}-width`));
    return allBorderProps.find((p) => p.key.endsWith(`-${side}-color`));
  };

  const sidePropMap: Record<
    Side,
    {
      style?: (typeof allBorderProps)[number];
      width?: (typeof allBorderProps)[number];
      color?: (typeof allBorderProps)[number];
    }
  > = {
    top: {
      style: findSideProp("top", "style"),
      width: findSideProp("top", "width"),
      color: findSideProp("top", "color"),
    },
    right: {
      style: findSideProp("right", "style"),
      width: findSideProp("right", "width"),
      color: findSideProp("right", "color"),
    },
    bottom: {
      style: findSideProp("bottom", "style"),
      width: findSideProp("bottom", "width"),
      color: findSideProp("bottom", "color"),
    },
    left: {
      style: findSideProp("left", "style"),
      width: findSideProp("left", "width"),
      color: findSideProp("left", "color"),
    },
  };

  const [linked, setLinked] = useState<boolean>(() => {
    const globalWidth =
      (shorthandWidth && (values[shorthandWidth.key] || shorthandWidth.default)) ||
      "0px";
    const widths = sides.map((side) => {
      const sideWidth = sidePropMap[side].width;
      return (sideWidth && values[sideWidth.key]) || globalWidth;
    });
    return widths.every((w) => w === widths[0]);
  });

  if (!hasPerSide) {
    // Simple border (e.g. divider, footer divider-color) — let standard renderer handle it.
    return null;
  }
  if (!shorthandStyle || !shorthandWidth || !shorthandColor) return null;
  if (
    !sides.every(
      (side) =>
        sidePropMap[side].style &&
        sidePropMap[side].width &&
        sidePropMap[side].color,
    )
  ) {
    return null;
  }

  const sideStyleKey = (side: Side) => sidePropMap[side].style!.key;
  const sideWidthKey = (side: Side) => sidePropMap[side].width!.key;
  const sideColorKey = (side: Side) => sidePropMap[side].color!.key;
  const borderRadiusProp =
    allBorderProps.find(
      (p) =>
        p.type === "radius" &&
        (p.key === "radius" || p.key.endsWith("-radius")),
    ) || allBorderProps.find((p) => p.type === "radius");

  const globalStyle =
    values[shorthandStyle.key] || shorthandStyle.default || "none";
  const globalWidth = values[shorthandWidth.key] || shorthandWidth.default || "0px";
  const globalColor = values[shorthandColor.key] || shorthandColor.default || "";

  const handleBorderTypeChange = (nextType: string) => {
    onChange(shorthandStyle.key, nextType);
    // Border type UI is global in this editor; keep side styles in sync
    // regardless of width link state.
    sides.forEach((side) => onChange(sideStyleKey(side), nextType));
  };

  const handleBorderColorChange = (nextColor: string) => {
    onChange(shorthandColor.key, nextColor);
    // Border color UI is global in this editor; keep side colors in sync
    // regardless of width link state.
    sides.forEach((side) => onChange(sideColorKey(side), nextColor));
  };

  const applyGlobalStyleColorToSide = (side: Side) => {
    if (!values[sideStyleKey(side)] && globalStyle) {
      onChange(sideStyleKey(side), globalStyle);
    }
    if (!values[sideColorKey(side)] && globalColor) {
      onChange(sideColorKey(side), globalColor);
    }
  };

  const handleWidthChange = (side: Side, rawVal: string) => {
    const nextWidth = rawVal ? ensureUnit(rawVal) : "";
    if (linked) {
      onChange(shorthandWidth.key, nextWidth);
      sides.forEach((s) => {
        onChange(sideWidthKey(s), nextWidth);
        if (globalStyle) onChange(sideStyleKey(s), globalStyle);
        if (globalColor) onChange(sideColorKey(s), globalColor);
      });
      return;
    }

    onChange(sideWidthKey(side), nextWidth);
    applyGlobalStyleColorToSide(side);

    const nextWidths = sides.map((s) =>
      s === side ? nextWidth || globalWidth : values[sideWidthKey(s)] || globalWidth,
    );
    const allEqual = nextWidths.every((w) => w === nextWidths[0]);
    if (allEqual) onChange(shorthandWidth.key, nextWidths[0]);
  };

  const toggleLinked = () => {
    if (!linked) {
      const uniformWidth = values[sideWidthKey("top")] || globalWidth || "0px";
      onChange(shorthandWidth.key, uniformWidth);
      sides.forEach((side) => {
        onChange(sideWidthKey(side), uniformWidth);
        if (globalStyle) onChange(sideStyleKey(side), globalStyle);
        if (globalColor) onChange(sideColorKey(side), globalColor);
      });
    }
    setLinked((prev) => !prev);
  };

  const widthInputClass =
    "w-full bg-[var(--input)] border border-[var(--border)] rounded-lg py-1.5 text-xs text-center font-mono px-1";
  const hideBorderSizeAndColor = globalStyle === "none";

  return (
    <div className="space-y-3">
      <div className="w-full flex items-center justify-between gap-3">
        <label className="text-[11px] text-[var(--muted-foreground)]">
          Border Type
        </label>
        <select
          value={globalStyle}
          onChange={(e) => handleBorderTypeChange(e.target.value)}
          className="w-[124px] bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">Default</option>
          {(shorthandStyle.options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {!hideBorderSizeAndColor && (
        <>
          <div>
            <label className="text-[11px] text-[var(--muted-foreground)] mb-1 block">
              Border Width
            </label>
            <div className="flex items-start gap-1.5">
              <div className="flex gap-1 flex-1 min-w-0">
                {sides.map((side) => (
                  <div key={side} className="flex-1 min-w-0">
                    <DraggableUnitInput
                      value={linked ? values[sideWidthKey(side)] || globalWidth : values[sideWidthKey(side)] || ""}
                      placeholder={stripUnit(globalWidth || "0px")}
                      onChange={(val) => handleWidthChange(side, val)}
                      className={widthInputClass}
                    />
                    <label className="text-[9px] text-[var(--muted-foreground)] block text-center mt-1 leading-none">
                      {sideLabels[side]}
                    </label>
                  </div>
                ))}
              </div>
              <button
                onClick={toggleLinked}
                className={`w-7 h-7 self-start rounded-md flex items-center justify-center border transition-colors flex-shrink-0 ${linked ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--input)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"}`}
                title={linked ? "Unlink sides" : "Link all sides"}
              >
                <LinkIcon className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="w-full">
            <label className="text-[11px] text-[var(--muted-foreground)] mb-1 block">
              Border Color
            </label>
            <div>
              <PropField
                prop={{ key: shorthandColor.key, label: "Border Color", type: "color" }}
                value={values[shorthandColor.key] || ""}
                onChange={(v) => { handleBorderColorChange(v); }}
                onLiveStyle={(v) => onLiveStyle?.(shorthandColor.key, v)}
                brandColors={brandColors}
              />
            </div>
          </div>
        </>
      )}

      {borderRadiusProp && (
        <div>
          <label className="text-[11px] text-[var(--muted-foreground)] mb-1 block">
            Border Radius
          </label>
          <PropField
            prop={borderRadiusProp}
            value={values[borderRadiusProp.key] || ""}
            onChange={(val) => onChange(borderRadiusProp.key, val)}
            onLiveStyle={
              onLiveStyle
                ? (val) => onLiveStyle(borderRadiusProp.key, val)
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

type EditableProp = {
  key: string;
  label: string;
  type: string;
  default?: string;
  options?: { label: string; value: string }[];
  half?: boolean;
  placeholder?: string;
  group?: string;
  conditionalOn?: string;
  buttonSet?: "primary" | "secondary";
  responsive?: boolean;
  separator?: boolean;
};

function HeroBackgroundEditor({
  props: groupProps,
  values,
  onChange,
  onBrowseMedia,
  onUploadMedia,
  previewWidth,
}: {
  props: EditableProp[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  onBrowseMedia?: (propKey: string) => void;
  onUploadMedia?: (propKey: string, file: File) => Promise<void>;
  previewWidth: "desktop" | "mobile";
}) {
  const gradientKeys = new Set([
    "gradient-type",
    "gradient-angle",
    "gradient-direction",
    "gradient-start",
    "gradient-start-position",
    "gradient-end",
    "gradient-end-position",
  ]);
  const gradientPropsArr = groupProps.filter((p) => gradientKeys.has(p.key));

  const typeProp = gradientPropsArr.find((p) => p.key === "gradient-type");
  const angleProp = gradientPropsArr.find((p) => p.key === "gradient-angle");
  const startProp = gradientPropsArr.find((p) => p.key === "gradient-start");
  const endProp = gradientPropsArr.find((p) => p.key === "gradient-end");
  const startPosProp = gradientPropsArr.find(
    (p) => p.key === "gradient-start-position",
  );
  const endPosProp = gradientPropsArr.find((p) => p.key === "gradient-end-position");
  const bgImageProp = groupProps.find((p) => p.key === "bg-image");
  const fallbackBgProp = groupProps.find((p) => p.key === "fallback-bg");
  const overlayOpacityProp = groupProps.find((p) => p.key === "overlay-opacity");
  const cssGradientProp = groupProps.find((p) => p.key === "gradient");

  const gradType = typeProp
    ? values[typeProp.key] || typeProp.default || "none"
    : "none";
  const isGradientMode = gradType !== "none" && gradType !== "";
  const startColor = startProp
    ? values[startProp.key] || startProp.default || "#000000"
    : "#000000";
  const endColor = endProp
    ? values[endProp.key] || endProp.default || "#ffffff"
    : "#ffffff";

  const clamp = (raw: string, fallback: number, min: number, max: number) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const startPos = clamp(values[startPosProp?.key || ""], 0, 0, 100);
  const endPos = clamp(values[endPosProp?.key || ""], 100, 0, 100);
  const angle = clamp(values[angleProp?.key || ""], 180, 0, 360);
  const overlayRaw = overlayOpacityProp
    ? Number(values[overlayOpacityProp.key] || overlayOpacityProp.default || "0")
    : 0;
  const overlayOpacity = Number.isFinite(overlayRaw)
    ? Math.max(0, Math.min(100, overlayRaw))
    : 0;

  const setGradientMode = (mode: "classic" | "gradient") => {
    if (!typeProp) return;
    if (mode === "classic") {
      onChange(typeProp.key, "none");
      return;
    }
    const nextType = gradType === "none" ? "linear" : gradType;
    onChange(typeProp.key, nextType);
    if (startProp && !values[startProp.key]) onChange(startProp.key, "#000000");
    if (endProp && !values[endProp.key]) onChange(endProp.key, "#ffffff");
    if (startPosProp && !values[startPosProp.key]) onChange(startPosProp.key, "0");
    if (endPosProp && !values[endPosProp.key]) onChange(endPosProp.key, "100");
    if (angleProp && !values[angleProp.key]) onChange(angleProp.key, "180");
  };

  const previewGrad =
    gradType === "radial"
      ? `radial-gradient(circle, ${startColor} ${startPos}%, ${endColor} ${endPos}%)`
      : `linear-gradient(${angle}deg, ${startColor} ${startPos}%, ${endColor} ${endPos}%)`;

  const DeviceIcon = previewWidth === "mobile" ? DevicePhoneMobileIcon : ComputerDesktopIcon;
  const iconColorClass =
    previewWidth === "mobile"
      ? "text-[var(--primary)]"
      : "text-[var(--muted-foreground)]";
  const deviceTitle =
    previewWidth === "mobile"
      ? "Mobile preview"
      : "Desktop preview";

  const RangeRow = ({
    label,
    value,
    min,
    max,
    unit,
    propKey,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    unit: "%" | "deg";
    propKey: string;
  }) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-1">
          {label}
          <DeviceIcon className={`w-3.5 h-3.5 ${iconColorClass}`} title={deviceTitle} />
        </label>
        <span className="text-[11px] text-[var(--muted-foreground)]">{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(propKey, e.target.value)}
          className="flex-1 range-slider"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(propKey, e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          className="w-16 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Background Type
        </span>
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden">
          <button
            type="button"
            onClick={() => setGradientMode("classic")}
            className={`px-2.5 py-1.5 border-r border-[var(--border)] ${!isGradientMode ? "bg-[var(--primary)] text-white" : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            title="Image / Classic"
          >
            <PhotoIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setGradientMode("gradient")}
            className={`px-2.5 py-1.5 ${isGradientMode ? "bg-[var(--primary)] text-white" : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            title="Gradient"
          >
            <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 p-3">
        {bgImageProp && (
          <div>
            <label className="text-[11px] text-[var(--muted-foreground)] mb-1 block">
              {bgImageProp.label}
            </label>
            <PropField
              prop={bgImageProp}
              value={values[bgImageProp.key] || ""}
              onChange={(val) => onChange(bgImageProp.key, val)}
              onBrowseMedia={onBrowseMedia ? () => onBrowseMedia(bgImageProp.key) : undefined}
              onUploadMedia={
                onUploadMedia
                  ? (file) => onUploadMedia(bgImageProp.key, file)
                  : undefined
              }
            />
          </div>
        )}

        {fallbackBgProp && (
          <div className="w-full flex items-center justify-between gap-3">
            <label className="text-[11px] text-[var(--muted-foreground)]">
              {fallbackBgProp.label}
            </label>
            <PropField
              prop={fallbackBgProp}
              value={values[fallbackBgProp.key] || ""}
              onChange={(val) => onChange(fallbackBgProp.key, val)}
            />
          </div>
        )}

        {overlayOpacityProp && (
          <div className="space-y-1.5">
            <label className="text-[11px] text-[var(--muted-foreground)]">
              {overlayOpacityProp.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => onChange(overlayOpacityProp.key, e.target.value)}
                className="flex-1 range-slider"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => onChange(overlayOpacityProp.key, e.target.value)}
                className="w-16 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
              />
              <span className="text-[11px] text-[var(--muted-foreground)]">%</span>
            </div>
          </div>
        )}

        {isGradientMode && gradientPropsArr.length > 0 && (
          <>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
              <p className="text-[11px] italic text-[var(--muted-foreground)] leading-5 border-l-2 border-amber-400 pl-2.5">
                Set locations and angle for each breakpoint so the gradient adapts to different screen sizes.
              </p>
            </div>

            <div
              className="h-11 w-full rounded-md border border-[var(--border)]"
              style={{ background: previewGrad }}
            />

            {startProp && (
              <div className="w-full flex items-center justify-between gap-3">
                <label className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0 leading-tight whitespace-nowrap">
                  Color
                </label>
                <div className="flex-shrink-0">
                  <PropField
                    prop={startProp}
                    value={values[startProp.key] || ""}
                    onChange={(val) => onChange(startProp.key, val)}
                  />
                </div>
              </div>
            )}

            {startPosProp && (
              <RangeRow
                label="Location"
                value={startPos}
                min={0}
                max={100}
                unit="%"
                propKey={startPosProp.key}
              />
            )}

            {endProp && (
              <div className="w-full flex items-center justify-between gap-3">
                <label className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0 leading-tight whitespace-nowrap">
                  Second Color
                </label>
                <div className="flex-shrink-0">
                  <PropField
                    prop={endProp}
                    value={values[endProp.key] || ""}
                    onChange={(val) => onChange(endProp.key, val)}
                  />
                </div>
              </div>
            )}

            {endPosProp && (
              <RangeRow
                label="Location"
                value={endPos}
                min={0}
                max={100}
                unit="%"
                propKey={endPosProp.key}
              />
            )}

            {typeProp && (
              <div className="w-full flex items-center justify-between gap-3">
                <label className="text-[11px] text-[var(--muted-foreground)]">Type</label>
                <select
                  value={gradType === "none" ? "linear" : gradType}
                  onChange={(e) => onChange(typeProp.key, e.target.value)}
                  className="w-36 bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="linear">Linear</option>
                  <option value="radial">Radial</option>
                </select>
              </div>
            )}

            {gradType === "linear" && angleProp && (
              <RangeRow
                label="Angle"
                value={angle}
                min={0}
                max={360}
                unit="deg"
                propKey={angleProp.key}
              />
            )}
          </>
        )}

        {cssGradientProp && (
          <details className="rounded-md border border-[var(--border)] bg-[var(--input)]/40 px-2.5 py-2">
            <summary className="text-[11px] text-[var(--muted-foreground)] cursor-pointer">
              Advanced CSS Gradient
            </summary>
            <div className="mt-2">
              <PropField
                prop={cssGradientProp}
                value={values[cssGradientProp.key] || ""}
                onChange={(val) => onChange(cssGradientProp.key, val)}
              />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// Gradient editor for background group
function GradientEditor({
  props: gradientPropsArr,
  values,
  onChange,
}: {
  props: EditableProp[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  const typeProp = gradientPropsArr.find((p) => p.key === "gradient-type");
  const angleProp = gradientPropsArr.find((p) => p.key === "gradient-angle");
  const dirProp = gradientPropsArr.find((p) => p.key === "gradient-direction");
  const startProp = gradientPropsArr.find((p) => p.key === "gradient-start");
  const endProp = gradientPropsArr.find((p) => p.key === "gradient-end");
  const startPosProp = gradientPropsArr.find(
    (p) => p.key === "gradient-start-position",
  );
  const endPosProp = gradientPropsArr.find((p) => p.key === "gradient-end-position");

  if (!typeProp || !startProp || !endProp) return null;

  const clamp = (raw: string, fallback: number, min: number, max: number) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const gradType = values[typeProp.key] || "none";
  const isActive = gradType !== "none" && gradType !== "";
  const startColor = values[startProp.key] || "#000000";
  const endColor = values[endProp.key] || "#ffffff";
  const startPos = clamp(values[startPosProp?.key || ""], 0, 0, 100);
  const endPos = clamp(values[endPosProp?.key || ""], 100, 0, 100);
  const angle = clamp(values[angleProp?.key || ""], 180, 0, 360);
  const legacyDir = values[dirProp?.key || ""] || "to bottom";
  const linearAxis = angleProp ? `${angle}deg` : legacyDir;

  const previewGrad =
    gradType === "radial"
      ? `radial-gradient(circle, ${startColor} ${startPos}%, ${endColor} ${endPos}%)`
      : `linear-gradient(${linearAxis}, ${startColor} ${startPos}%, ${endColor} ${endPos}%)`;

  const setType = (type: "none" | "linear" | "radial") => {
    onChange(typeProp.key, type);
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/25">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Background Type
        </span>
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden">
          <button
            type="button"
            onClick={() => setType("none")}
            className={`px-2 py-1 text-[10px] ${gradType === "none" ? "bg-[var(--primary)] text-white" : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
          >
            None
          </button>
          <button
            type="button"
            onClick={() => setType("linear")}
            className={`px-2 py-1 text-[10px] border-l border-[var(--border)] ${gradType === "linear" ? "bg-[var(--primary)] text-white" : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
          >
            Linear
          </button>
          <button
            type="button"
            onClick={() => setType("radial")}
            className={`px-2 py-1 text-[10px] border-l border-[var(--border)] ${gradType === "radial" ? "bg-[var(--primary)] text-white" : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
          >
            Radial
          </button>
        </div>
      </div>

      {isActive && (
        <>
          <div
            className="h-12 w-full rounded-md border border-[var(--border)]"
            style={{ background: previewGrad }}
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-[var(--muted-foreground)] mb-1 block">
                First Color
              </span>
              <div className="flex items-center bg-[var(--input)] border border-[var(--border)] rounded-lg overflow-hidden">
                <input
                  type="color"
                  value={startColor}
                  onChange={(e) => onChange(startProp.key, e.target.value)}
                  className="w-7 h-7 cursor-pointer bg-transparent flex-shrink-0 border-none p-0.5"
                />
                <input
                  type="text"
                  value={values[startProp.key] || ""}
                  onChange={(e) => onChange(startProp.key, e.target.value)}
                  className="flex-1 bg-transparent border-none px-1 py-1.5 text-[11px] font-mono outline-none min-w-0"
                  placeholder="#000000"
                />
              </div>
            </div>
            <div>
              <span className="text-[10px] text-[var(--muted-foreground)] mb-1 block">
                Second Color
              </span>
              <div className="flex items-center bg-[var(--input)] border border-[var(--border)] rounded-lg overflow-hidden">
                <input
                  type="color"
                  value={endColor}
                  onChange={(e) => onChange(endProp.key, e.target.value)}
                  className="w-7 h-7 cursor-pointer bg-transparent flex-shrink-0 border-none p-0.5"
                />
                <input
                  type="text"
                  value={values[endProp.key] || ""}
                  onChange={(e) => onChange(endProp.key, e.target.value)}
                  className="flex-1 bg-transparent border-none px-1 py-1.5 text-[11px] font-mono outline-none min-w-0"
                  placeholder="#ffffff"
                />
              </div>
            </div>
          </div>

          {startPosProp && (
            <div className="flex items-center gap-2">
              <span className="w-24 text-[10px] text-[var(--muted-foreground)]">
                First Location
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={startPos}
                onChange={(e) => onChange(startPosProp.key, e.target.value)}
                className="flex-1 range-slider"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={startPos}
                onChange={(e) => onChange(startPosProp.key, e.target.value)}
                className="w-16 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
              />
            </div>
          )}

          {endPosProp && (
            <div className="flex items-center gap-2">
              <span className="w-24 text-[10px] text-[var(--muted-foreground)]">
                Second Location
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={endPos}
                onChange={(e) => onChange(endPosProp.key, e.target.value)}
                className="flex-1 range-slider"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={endPos}
                onChange={(e) => onChange(endPosProp.key, e.target.value)}
                className="w-16 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
              />
            </div>
          )}

          {gradType === "linear" && angleProp && (
            <div className="flex items-center gap-2">
              <span className="w-24 text-[10px] text-[var(--muted-foreground)]">
                Angle
              </span>
              <input
                type="range"
                min={0}
                max={360}
                value={angle}
                onChange={(e) => onChange(angleProp.key, e.target.value)}
                className="flex-1 range-slider"
              />
              <input
                type="number"
                min={0}
                max={360}
                value={angle}
                onChange={(e) => onChange(angleProp.key, e.target.value)}
                className="w-16 bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Component props renderer with repeatable group support ---
function ComponentPropsRenderer({
  schema,
  props: compProps,
  allSchemaProps,
  onPropChange,
  onLiveStyle,
  onBrowseMedia,
  onBrowseIcon,
  onUploadMedia,
  onInsertVariable,
  previewWidth,
  brandColors,
  previewAsLabel,
  defaultFontFamily,
  inlineVariableOptions,
  accountLogos,
}: {
  schema: { name?: string; repeatableGroups?: RepeatableGroup[] };
  props: Record<string, string>;
  allSchemaProps: {
    key: string;
    label: string;
    type: string;
    half?: boolean;
    repeatableGroup?: string;
    default?: string;
    placeholder?: string;
    options?: { label: string; value: string }[];
    group?: string;
    conditionalOn?: string;
    buttonSet?: 'primary' | 'secondary';
    responsive?: boolean;
    separator?: boolean;
    sideScoped?: boolean;
  }[];
  onPropChange: (key: string, val: string) => void;
  onLiveStyle?: (key: string, val: string) => void;
  onBrowseMedia?: (propKey: string) => void;
  onBrowseIcon?: (propKey: string) => void;
  onUploadMedia?: (propKey: string, file: File) => Promise<void>;
  onInsertVariable?: (propKey: string, token: string) => void;
  previewWidth: 'desktop' | 'mobile';
  brandColors?: { label: string; value: string }[];
  previewAsLabel?: string;
  defaultFontFamily?: string;
  inlineVariableOptions?: InlineVariableOption[];
  accountLogos?: { light: string; dark: string; white?: string; black?: string };
}) {
  const groups = schema.repeatableGroups || [];
  const isCopyComponent = schema.name === "copy";
  const copyBodyProp = isCopyComponent
    ? allSchemaProps.find((p) => p.key === "body" && !p.repeatableGroup)
    : undefined;
  const componentBaseFontFamily =
    (compProps.font || defaultFontFamily || FALLBACK_FONT_FAMILY).trim() ||
    FALLBACK_FONT_FAMILY;
  const isSplitComponent = schema.name === "split";
  const [activeSplitSide, setActiveSplitSide] = useState<"left" | "right">("left");
  const splitSideLabel: Record<"left" | "right", string> =
    previewWidth === "mobile"
      ? { left: "Top", right: "Bottom" }
      : { left: "Left", right: "Right" };
  type SchemaPropDef = (typeof allSchemaProps)[number];
  const hasOwnProp = (key: string) =>
    Object.prototype.hasOwnProperty.call(compProps, key);
  const usesSplitSideKey = (prop?: SchemaPropDef) =>
    !!prop &&
    isSplitComponent &&
    !!prop.group &&
    SPLIT_SIDE_EDITABLE_GROUPS.has(prop.group) &&
    prop.sideScoped !== false;
  const scopedPropKey = (rawKey: string, prop?: SchemaPropDef) =>
    usesSplitSideKey(prop) ? `${activeSplitSide}-${rawKey}` : rawKey;
  // Legacy split: if image-side exists, route unscoped props to the correct side
  const legacyImageSide = isSplitComponent ? (compProps["image-side"] || "") : "";
  const LEGACY_IMAGE_KEYS = new Set(["image", "image-alt", "image-fit", "image-position", "overlay-color", "overlay-opacity"]);
  const LEGACY_TEXT_CONTENT_KEYS = new Set(["eyebrow", "headline", "description", "primary-button-text", "primary-button-url", "secondary-button-text", "secondary-button-url"]);
  const readScopedPropValue = (rawKey: string, prop?: SchemaPropDef) => {
    const resolvedKey = scopedPropKey(rawKey, prop);
    if (resolvedKey !== rawKey) {
      // Side-scoped: prefer scoped key
      if (hasOwnProp(resolvedKey)) return compProps[resolvedKey] ?? "";
      // Unscoped fallback for legacy templates
      const cleanKey = rawKey.replace(/^m:/, "");
      if (legacyImageSide && hasOwnProp(rawKey)) {
        // Image props → image side only
        if (LEGACY_IMAGE_KEYS.has(cleanKey)) {
          return activeSplitSide === legacyImageSide ? (compProps[rawKey] ?? "") : "";
        }
        // Text content props → text side only
        if (LEGACY_TEXT_CONTENT_KEYS.has(cleanKey)) {
          const txtSide = legacyImageSide === "left" ? "right" : "left";
          return activeSplitSide === txtSide ? (compProps[rawKey] ?? "") : "";
        }
        // Shared props (font, sizes, colors, padding, etc.) → both sides
        return compProps[rawKey] ?? "";
      }
      // No legacy: shared fallback to unscoped (handles partially migrated templates)
      if (hasOwnProp(rawKey)) {
        if (LEGACY_IMAGE_KEYS.has(cleanKey) || LEGACY_TEXT_CONTENT_KEYS.has(cleanKey)) return "";
        return compProps[rawKey] ?? "";
      }
      return "";
    }
    return compProps[rawKey] ?? "";
  };

  // For numbered groups (feature{n}, stat-{n}), determine how many items have data
  const getNumberedGroupItemCount = (group: RepeatableGroup): number => {
    // Find all props for this group, grouped by item number
    const groupProps = allSchemaProps.filter(
      (p) => p.repeatableGroup === group.key,
    );
    const propsPerItem = group.propsPerItem.length;
    const totalItems = groupProps.length / propsPerItem;
    let activeCount = 0;
    for (let itemIdx = 0; itemIdx < totalItems; itemIdx++) {
      const itemProps = groupProps.slice(
        itemIdx * propsPerItem,
        (itemIdx + 1) * propsPerItem,
      );
      const hasValue = itemProps.some((p) => compProps[p.key]);
      if (hasValue) activeCount = itemIdx + 1; // Keep all up to the last filled one
    }
    return Math.max(1, activeCount); // Show at least 1
  };

  // For non-numbered groups (social links), each prop is one item
  const isNumberedGroup = (group: RepeatableGroup): boolean => {
    return group.propsPerItem.some((p) => p.includes("{n}"));
  };

  const getNonNumberedActiveItems = (group: RepeatableGroup): string[] => {
    const groupProps = allSchemaProps.filter(
      (p) => p.repeatableGroup === group.key,
    );
    return groupProps.filter((p) => compProps[p.key]).map((p) => p.key);
  };

  // Track which groups are showing how many items
  const [groupItemCounts, setGroupItemCounts] = useState<
    Record<string, number>
  >(() => {
    const counts: Record<string, number> = {};
    for (const group of groups) {
      if (isNumberedGroup(group)) {
        counts[group.key] = getNumberedGroupItemCount(group);
      }
    }
    return counts;
  });

  // For non-numbered groups, track visible items by key
  const [visibleNonNumbered, setVisibleNonNumbered] = useState<
    Record<string, Set<string>>
  >(() => {
    const result: Record<string, Set<string>> = {};
    for (const group of groups) {
      if (!isNumberedGroup(group)) {
        const active = getNonNumberedActiveItems(group);
        result[group.key] = new Set(active);
      }
    }
    return result;
  });

  // Render standard (non-repeatable) props with half-width grouping
  const renderStandardProps = (propsToRender: typeof allSchemaProps) => {
    const propByKey = new Map(propsToRender.map((p) => [p.key, p]));
    const allPropByKey = new Map(allSchemaProps.map((p) => [p.key, p]));
    const resolvePropDef = (key: string) =>
      propByKey.get(key) || allPropByKey.get(key);
    const getEffectivePropValue = (propKey: string) => {
      const target = resolvePropDef(propKey);
      if (!target) return compProps[propKey] || "";
      const isResp = !!target.responsive;
      let resolved = readScopedPropValue(propKey, target) || target.default || "";
      if (isResp && previewWidth === "mobile") {
        resolved =
          readScopedPropValue(`m:${propKey}`, target) ||
          readScopedPropValue(propKey, target) ||
          target.default ||
          "";
      }

      if (isCopyComponent && propKey === "body") {
        return mergeCopyGreetingIntoBody(compProps.greeting || "", resolved);
      }

      return resolved;
    };

    const handleStandardPropChange = (
      prop: (typeof allSchemaProps)[number],
      effectiveKey: string,
      val: string,
    ) => {
      if (isCopyComponent && prop.key === "body") {
        onPropChange(effectiveKey, normalizeRichTextValue(val || ""));
        if (compProps.greeting) onPropChange("greeting", "");
        return;
      }
      onPropChange(effectiveKey, val);
    };

    // Filter out props gated by conditionalOn when the referenced prop is falsy
    const visibleProps = propsToRender.filter(p => {
      if (!p.conditionalOn) return true;
      const depProp = allPropByKey.get(p.conditionalOn);
      const depVal = depProp
        ? readScopedPropValue(depProp.key, depProp)
        : (compProps[p.conditionalOn] || "");
      if (depProp?.type === "toggle") return depVal === "true";
      // Strip HTML tags and whitespace to detect truly empty content (e.g. lone <br>)
      const stripped = String(depVal || "").replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
      if (stripped === "") return false;

      return true;
    }).filter((p) => {
      // Hide border width/color controls when their matching border style is set to none.
      // This covers button border controls and simple border groups rendered via standard fields.
      if (!p.key.includes("border") || !p.key.match(/-(width|color)$/)) return true;
      const styleKey = p.key.replace(/-(width|color)$/, "-style");
      if (!propByKey.has(styleKey)) return true;
      return String(getEffectivePropValue(styleKey)).trim().toLowerCase() !== "none";
    }).filter((p) => {
      if (!isCopyComponent) return true;
      if (p.key === "body") return false;
      return !COPY_PROP_KEYS_MOVED_TO_EDITOR.has(p.key);
    });
    // Helper: inline types show label beside the control (small widgets)
    const isInlineType = (type: string) => type === 'select' || type === 'toggle' || type === 'color';

    const isMobile = previewWidth === 'mobile';

    // Resolve responsive prop key, value, placeholder
    const resolve = (prop: typeof allSchemaProps[0]) => {
      const isResp = !!prop.responsive;
      const baseEffectiveKey = (isResp && isMobile) ? `m:${prop.key}` : prop.key;
      const effectiveKey = scopedPropKey(baseEffectiveKey, prop);
      let value = readScopedPropValue(baseEffectiveKey, prop) || '';
      if (isCopyComponent && prop.key === "body") {
        value = getEffectivePropValue(prop.key);
      }
      const desktopVal = readScopedPropValue(prop.key, prop) || '';
      const mobilePlaceholder = desktopVal || prop.default || '';
      const mobileOverrideKey = scopedPropKey(`m:${prop.key}`, prop);
      const hasMobileOverride = isResp && hasOwnProp(mobileOverrideKey);
      // For mobile editing, override placeholder and clear default so field shows empty when no override
      const propOverride = (isResp && isMobile)
        ? { ...prop, placeholder: mobilePlaceholder, default: undefined as string | undefined }
        : prop;
      return { effectiveKey, value, hasMobileOverride, isResp, propOverride };
    };

    // Responsive indicator next to label
    const RespIndicator = ({
      isResp,
      hasMobileOverride,
    }: {
      isResp: boolean;
      hasMobileOverride: boolean;
    }) => {
      if (!isResp) return null;

      const title = isMobile
        ? "Mobile override: this edit only affects mobile"
        : hasMobileOverride
          ? "Desktop value: mobile has its own override"
          : "Desktop value: this edit affects desktop and mobile";

      return (
        <span className="inline-flex items-center ml-1" title={title}>
          {isMobile ? (
            <DevicePhoneMobileIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
          ) : (
            <ComputerDesktopIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          )}
          {hasMobileOverride && !isMobile && (
            <span
              className="ml-1 w-1.5 h-1.5 rounded-full bg-[var(--primary)]"
              aria-hidden="true"
            />
          )}
        </span>
      );
    };

    // Clear mobile override button
    const ClearMobile = ({ prop, isResp }: { prop: SchemaPropDef; isResp: boolean }) => {
      if (!isResp || !isMobile) return null;
      const mobileKey = scopedPropKey(`m:${prop.key}`, prop);
      if (!hasOwnProp(mobileKey)) return null;
      return (
        <button
          onClick={() => onPropChange(mobileKey, '')}
          className="text-[9px] text-[var(--muted-foreground)] hover:text-red-400 ml-0.5 leading-none"
          title="Clear mobile override"
        >✕</button>
      );
    };

    // Helper: generate onInsertVariable callback for eligible prop types
    const varPickerFor = (p: SchemaPropDef, effectiveKey: string, currentVal: string) =>
      VARIABLE_ELIGIBLE_TYPES.has(p.type) && onInsertVariable
        ? (token: string) =>
            handleStandardPropChange(p, effectiveKey, `${currentVal || ""}${token}`)
        : undefined;

    const elements: React.ReactNode[] = [];
    let i = 0;
    const pairHalfFields = false;
    while (i < visibleProps.length) {
      const prop = visibleProps[i];
      const nextProp = visibleProps[i + 1];
      const r = resolve(prop);

      // Render a visual separator line before this prop if flagged
      if (prop.separator && i > 0) {
        elements.push(
          <div key={`sep-${prop.key}`} className="border-t border-[var(--border)] pt-1" />
        );
      }

      // Keep color controls on their own row for consistent labeling/layout.
      if (
        pairHalfFields &&
        prop.half &&
        nextProp?.half &&
        prop.type !== "color" &&
        nextProp.type !== "color"
      ) {
        const rNext = resolve(nextProp);
        // Half-width pairs: keep vertical labels (label above) — compact layout
        elements.push(
          <div key={`${prop.key}-${nextProp.key}`} className="flex gap-2">
            <div className="flex-1 min-w-0">
              {prop.type === "color" ? (
                <div className="w-full flex items-center justify-between gap-2">
                  <label className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0 leading-tight whitespace-nowrap flex items-center gap-0.5">
                    {prop.label}
                    <RespIndicator isResp={r.isResp} hasMobileOverride={r.hasMobileOverride} />
                    <ClearMobile prop={prop} isResp={r.isResp} />
                  </label>
                  <div className="flex-shrink-0">
                    <PropField
                      prop={r.propOverride}
                      value={r.value}
                      onChange={(val) => handleStandardPropChange(prop, r.effectiveKey, val)}
                      onLiveStyle={
                        onLiveStyle ? (val) => onLiveStyle(prop.key, val) : undefined
                      }
                      brandColors={brandColors}
                      previewAsLabel={previewAsLabel}
                      inlineVariableOptions={inlineVariableOptions}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <label className="text-[11px] text-[var(--muted-foreground)] mb-1 flex items-center">
                    {prop.label}
                    <RespIndicator isResp={r.isResp} hasMobileOverride={r.hasMobileOverride} />
                    <ClearMobile prop={prop} isResp={r.isResp} />
                  </label>
                  <PropField
                    prop={r.propOverride}
                    value={r.value}
                    onChange={(val) => handleStandardPropChange(prop, r.effectiveKey, val)}
                    onLiveStyle={
                      onLiveStyle ? (val) => onLiveStyle(prop.key, val) : undefined
                    }
                    onBrowseMedia={
                      prop.type === "image" && onBrowseMedia
                        ? () => onBrowseMedia(r.effectiveKey)
                        : undefined
                    }
                    onBrowseIcon={
                      prop.type === "icon" && onBrowseIcon
                        ? () => onBrowseIcon(r.effectiveKey)
                        : undefined
                    }
                    onUploadMedia={
                      (prop.type === "image" || prop.type === "icon") && onUploadMedia
                        ? (file) => onUploadMedia(r.effectiveKey, file)
                        : undefined
                    }
                    onInsertVariable={varPickerFor(prop, r.effectiveKey, r.value)}
                    brandColors={brandColors}
                    previewAsLabel={previewAsLabel}
                    inlineVariableOptions={inlineVariableOptions}
                  />
                </>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {nextProp.type === "color" ? (
                <div className="w-full flex items-center justify-between gap-2">
                  <label className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0 leading-tight whitespace-nowrap flex items-center gap-0.5">
                    {nextProp.label}
                    <RespIndicator isResp={rNext.isResp} hasMobileOverride={rNext.hasMobileOverride} />
                    <ClearMobile prop={nextProp} isResp={rNext.isResp} />
                  </label>
                  <div className="flex-shrink-0">
                    <PropField
                      prop={rNext.propOverride}
                      value={rNext.value}
                      onChange={(val) => handleStandardPropChange(nextProp, rNext.effectiveKey, val)}
                      onLiveStyle={
                        onLiveStyle
                          ? (val) => onLiveStyle(nextProp.key, val)
                          : undefined
                      }
                      brandColors={brandColors}
                      previewAsLabel={previewAsLabel}
                      inlineVariableOptions={inlineVariableOptions}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <label className="text-[11px] text-[var(--muted-foreground)] mb-1 flex items-center">
                    {nextProp.label}
                    <RespIndicator isResp={rNext.isResp} hasMobileOverride={rNext.hasMobileOverride} />
                    <ClearMobile prop={nextProp} isResp={rNext.isResp} />
                  </label>
                  <PropField
                    prop={rNext.propOverride}
                    value={rNext.value}
                    onChange={(val) => handleStandardPropChange(nextProp, rNext.effectiveKey, val)}
                    onLiveStyle={
                      onLiveStyle
                        ? (val) => onLiveStyle(nextProp.key, val)
                        : undefined
                    }
                    onBrowseMedia={
                      nextProp.type === "image" && onBrowseMedia
                        ? () => onBrowseMedia(rNext.effectiveKey)
                        : undefined
                    }
                    onBrowseIcon={
                      nextProp.type === "icon" && onBrowseIcon
                        ? () => onBrowseIcon(rNext.effectiveKey)
                        : undefined
                    }
                    onUploadMedia={
                      (nextProp.type === "image" || nextProp.type === "icon") && onUploadMedia
                        ? (file) => onUploadMedia(rNext.effectiveKey, file)
                        : undefined
                    }
                    onInsertVariable={varPickerFor(nextProp, rNext.effectiveKey, rNext.value)}
                    brandColors={brandColors}
                    previewAsLabel={previewAsLabel}
                    inlineVariableOptions={inlineVariableOptions}
                  />
                </>
              )}
            </div>
          </div>,
        );
        i += 2;
      } else if (isInlineType(prop.type)) {
        // Inline: horizontal layout (label left, control right) — small controls only
        elements.push(
          <div key={prop.key} className="w-full flex items-center justify-between gap-3">
            <label className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0 leading-tight whitespace-nowrap flex items-center gap-0.5">
              {prop.label}
              <RespIndicator isResp={r.isResp} hasMobileOverride={r.hasMobileOverride} />
              <ClearMobile prop={prop} isResp={r.isResp} />
            </label>
            <div className="flex-shrink-0">
              <PropField
                prop={r.propOverride}
                value={r.value}
                onChange={(val) => handleStandardPropChange(prop, r.effectiveKey, val)}
                onLiveStyle={
                  onLiveStyle ? (val) => onLiveStyle(prop.key, val) : undefined
                }
                brandColors={brandColors}
                previewAsLabel={previewAsLabel}
                inlineVariableOptions={inlineVariableOptions}
              />
            </div>
          </div>,
        );
        i += 1;
      } else if (
        prop.key === "logo-url" &&
        (schema.name === "header" || schema.name === "footer") &&
        accountLogos
      ) {
        // Custom logo picker: variant buttons + media library
        const logoVariants: { key: keyof NonNullable<typeof accountLogos>; label: string }[] = [
          { key: "light", label: "Light" },
          { key: "dark", label: "Dark" },
          { key: "white", label: "White" },
          { key: "black", label: "Black" },
        ];
        const available = logoVariants.filter((v) => accountLogos[v.key]);
        const currentVal = r.value;
        elements.push(
          <div key={prop.key}>
            <label className="text-[11px] text-[var(--muted-foreground)] mb-1 flex items-center">
              Logo
              <RespIndicator isResp={r.isResp} hasMobileOverride={r.hasMobileOverride} />
              <ClearMobile prop={prop} isResp={r.isResp} />
            </label>
            {available.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {available.map((v) => {
                  const url = accountLogos[v.key]!;
                  const isActive = currentVal === url;
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => onPropChange(r.effectiveKey, url)}
                      className={`group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                        isActive
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--input)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
                      }`}
                      title={url}
                    >
                      <img
                        src={url}
                        alt={v.label}
                        className="h-4 w-auto max-w-[48px] object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span>{v.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <PropField
              prop={r.propOverride}
              value={currentVal}
              onChange={(val) => onPropChange(r.effectiveKey, val)}
              onBrowseMedia={
                onBrowseMedia ? () => onBrowseMedia(r.effectiveKey) : undefined
              }
              onUploadMedia={
                onUploadMedia ? (file) => onUploadMedia(r.effectiveKey, file) : undefined
              }
            />
          </div>,
        );
        i += 1;
      } else {
        // Vertical: label above, full-width control — text, unit, padding, radius, image, etc.
        elements.push(
          <div key={prop.key}>
            <label className="text-[11px] text-[var(--muted-foreground)] mb-1 flex items-center">
              {prop.label}
              <RespIndicator isResp={r.isResp} hasMobileOverride={r.hasMobileOverride} />
              <ClearMobile prop={prop} isResp={r.isResp} />
            </label>
            <PropField
              prop={r.propOverride}
              value={r.value}
              onChange={(val) => handleStandardPropChange(prop, r.effectiveKey, val)}
              onLiveStyle={
                onLiveStyle ? (val) => onLiveStyle(prop.key, val) : undefined
              }
              onBrowseMedia={
                prop.type === "image" && onBrowseMedia
                  ? () => onBrowseMedia(r.effectiveKey)
                  : undefined
              }
              onBrowseIcon={
                prop.type === "icon" && onBrowseIcon
                  ? () => onBrowseIcon(r.effectiveKey)
                  : undefined
              }
              onUploadMedia={
                (prop.type === "image" || prop.type === "icon") && onUploadMedia
                  ? (file) => onUploadMedia(r.effectiveKey, file)
                  : undefined
              }
              onInsertVariable={varPickerFor(prop, r.effectiveKey, r.value)}
              brandColors={brandColors}
              previewAsLabel={previewAsLabel}
              inlineVariableOptions={inlineVariableOptions}
            />
          </div>,
        );
        i += 1;
      }
    }
    return elements;
  };

  // Render a numbered repeatable group (features, stats)
  const renderNumberedGroup = (group: RepeatableGroup) => {
    const groupProps = allSchemaProps.filter(
      (p) => p.repeatableGroup === group.key,
    );
    const propsPerItem = group.propsPerItem.length;
    const totalItems = groupProps.length / propsPerItem;
    const visibleCount = groupItemCounts[group.key] || 1;
    const isFeaturesGroup = schema.name === "features" && group.key === "feature";
    const featureVariant = (compProps.variant || "icon") === "image" ? "image" : "icon";

    return (
      <div key={`group-${group.key}`} className="space-y-2">
        {isFeaturesGroup && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/35 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Feature Visual
            </div>
            <div className="mt-2 flex overflow-hidden rounded-lg border border-[var(--border)]">
              {(["icon", "image"] as const).map((option) => {
                const isActive = featureVariant === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onPropChange("variant", option)}
                    className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {option === "icon" ? "Use Icons" : "Use Images"}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              Icon mode opens the icon library for each card. Image mode uses the media uploader for each card.
            </p>
          </div>
        )}
        {Array.from({ length: visibleCount }, (_, itemIdx) => {
          const itemProps = groupProps.slice(
            itemIdx * propsPerItem,
            (itemIdx + 1) * propsPerItem,
          );
          const visibleItemProps = isFeaturesGroup
            ? itemProps.filter((prop) => {
                if (prop.key.endsWith("-icon")) return featureVariant === "icon";
                if (prop.key.endsWith("-image")) return featureVariant === "image";
                return true;
              })
            : itemProps;
          return (
            <div
              key={`${group.key}-${itemIdx}`}
              className="border border-[var(--border)] rounded-lg p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  {group.label} {itemIdx + 1}
                </span>
                {visibleCount > 1 && (
                  <button
                    onClick={() => {
                      // Clear this item's props and remove it
                      for (const p of itemProps) {
                        onPropChange(p.key, "");
                      }
                      setGroupItemCounts((prev) => ({
                        ...prev,
                        [group.key]: Math.max(1, prev[group.key] - 1),
                      }));
                    }}
                    className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                    title={`Remove ${group.label} ${itemIdx + 1}`}
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {renderStandardProps(visibleItemProps)}
            </div>
          );
        })}
        {visibleCount < totalItems && (
          <button
            onClick={() =>
              setGroupItemCounts((prev) => ({
                ...prev,
                [group.key]: Math.min(totalItems, (prev[group.key] || 1) + 1),
              }))
            }
            className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-[var(--border)] rounded-lg text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add {group.label}
          </button>
        )}
      </div>
    );
  };

  // Render a non-numbered repeatable group (social links)
  const renderNonNumberedGroup = (group: RepeatableGroup) => {
    const groupProps = allSchemaProps.filter(
      (p) => p.repeatableGroup === group.key,
    );
    const visible = visibleNonNumbered[group.key] || new Set<string>();
    const visibleProps = groupProps.filter((p) => visible.has(p.key));
    const hiddenProps = groupProps.filter((p) => !visible.has(p.key));

    return (
      <div key={`group-${group.key}`} className="space-y-2">
        {visibleProps.length > 0 &&
          visibleProps.map((prop) => (
            <div key={prop.key} className="flex items-end gap-1.5">
              <div className="flex-1 min-w-0">
                <label className="text-xs text-[var(--muted-foreground)] mb-1 block">
                  {prop.label}
                </label>
                <PropField
                  prop={prop}
                  value={compProps[prop.key] || ""}
                  onChange={(val) => onPropChange(prop.key, val)}
                  onBrowseMedia={
                    prop.type === "image" && onBrowseMedia
                      ? () => onBrowseMedia(prop.key)
                      : undefined
                  }
                  onBrowseIcon={
                    prop.type === "icon" && onBrowseIcon
                      ? () => onBrowseIcon(prop.key)
                      : undefined
                  }
                  onUploadMedia={
                    (prop.type === "image" || prop.type === "icon") && onUploadMedia
                      ? (file) => onUploadMedia(prop.key, file)
                      : undefined
                  }
                  onInsertVariable={
                    VARIABLE_ELIGIBLE_TYPES.has(prop.type) && onInsertVariable
                      ? (token: string) => onInsertVariable(prop.key, token)
                      : undefined
                  }
                  brandColors={brandColors}
                  previewAsLabel={previewAsLabel}
                  inlineVariableOptions={inlineVariableOptions}
                />
              </div>
              <button
                onClick={() => {
                  onPropChange(prop.key, "");
                  setVisibleNonNumbered((prev) => {
                    const next = new Set(prev[group.key]);
                    next.delete(prop.key);
                    return { ...prev, [group.key]: next };
                  });
                }}
                className="p-1.5 mb-0.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                title={`Remove ${prop.label}`}
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        {hiddenProps.length > 0 && (
          <div className="relative">
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setVisibleNonNumbered((prev) => {
                  const next = new Set(prev[group.key]);
                  next.add(e.target.value);
                  return { ...prev, [group.key]: next };
                });
              }}
              className="w-full py-2 border border-dashed border-[var(--border)] rounded-lg text-xs text-[var(--muted-foreground)] hover:border-[var(--primary)] transition-colors bg-transparent text-center cursor-pointer appearance-none"
            >
              <option value="">+ Add {group.label}</option>
              {hiddenProps.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };

  // ── Group-based section building ──

  // State for collapsible groups and smart defaults
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [buttonSetTab, setButtonSetTab] = useState<'primary' | 'secondary'>('primary');
  const [trackingSetTab, setTrackingSetTab] = useState<'primary' | 'secondary'>('primary');
  const pinnedTopProps =
    schema.name === "image"
      ? (["image", "alt"]
          .map((key) => allSchemaProps.find((p) => !p.repeatableGroup && p.key === key))
          .filter(Boolean) as typeof allSchemaProps)
      : [];
  const pinnedTopPropKeys = new Set(pinnedTopProps.map((p) => p.key));
  // Separate repeatable-group props from standard props
  const standardProps = allSchemaProps.filter(
    (p) =>
      !p.repeatableGroup &&
      !pinnedTopPropKeys.has(p.key) &&
      !(schema.name === "features" && p.key === "variant"),
  );
  const splitSectionLevelProps =
    isSplitComponent
      ? standardProps.filter((p) => p.sideScoped === false)
      : [];
  const groupedStandardProps =
    isSplitComponent
      ? standardProps.filter((p) => p.sideScoped !== false)
      : standardProps;
  const renderedRepeatableGroups = new Set<string>();

  // Group standard props by their group value
  const propsByGroup: Record<string, typeof groupedStandardProps> = {};
  for (const prop of groupedStandardProps) {
    const g = prop.group || 'text';
    if (!propsByGroup[g]) propsByGroup[g] = [];
    propsByGroup[g].push(prop);
  }

  // Sort groups by configured order
  const sortedGroupNames = Object.keys(propsByGroup).sort(
    (a, b) => (GROUP_CONFIG[a]?.order ?? 99) - (GROUP_CONFIG[b]?.order ?? 99)
  );

  // Check if a group has gradient props
  const hasGradientProps = (gProps: typeof standardProps) =>
    gProps.some(p => p.key === 'gradient-type');

  // Separate gradient props from regular props in a group
  const splitGradientProps = (gProps: typeof standardProps) => {
    const gradientKeys = [
      "gradient-type",
      "gradient-angle",
      "gradient-direction",
      "gradient-start",
      "gradient-start-position",
      "gradient-end",
      "gradient-end-position",
    ];
    return {
      regular: gProps.filter(p => !gradientKeys.includes(p.key)),
      gradient: gProps.filter(p => gradientKeys.includes(p.key)),
    };
  };

  const sections: React.ReactNode[] = [];

  // Render grouped standard props
  for (const groupName of sortedGroupNames) {
    if (isCopyComponent && groupName === "text") continue;
    const groupProps = isSplitComponent && groupName === "layout"
      ? propsByGroup[groupName].filter((p) => p.key !== "image-side")
      : propsByGroup[groupName];
    if (groupProps.length === 0) continue;
    const groupPropByKey = new Map(groupProps.map((p) => [p.key, p]));
    const sideAwareGroupValues =
      isSplitComponent && SPLIT_SIDE_EDITABLE_GROUPS.has(groupName)
        ? groupProps.reduce<Record<string, string>>((acc, prop) => {
            acc[prop.key] = readScopedPropValue(prop.key, prop);
            if (prop.responsive) {
              acc[`m:${prop.key}`] = readScopedPropValue(`m:${prop.key}`, prop);
            }
            return acc;
          }, { ...compProps })
        : compProps;
    const handleGroupPropChange = (rawKey: string, val: string) => {
      const propDef =
        groupPropByKey.get(rawKey) ||
        (rawKey.startsWith("m:") ? groupPropByKey.get(rawKey.slice(2)) : undefined);
      onPropChange(scopedPropKey(rawKey, propDef), val);
    };
    const config = GROUP_CONFIG[groupName];
    const groupLabel =
      schema.name === "header" && groupName === "background"
        ? "Logo & Background"
        : (config?.label || groupName);
    const isOpen = expandedGroups[groupName] ?? false;
    // Check if this group has button sets (primary/secondary tabs)
    const hasButtonSets = groupProps.some(p => p.buttonSet);

    sections.push(
      <CollapsiblePropGroup
        key={`group-${groupName}`}
        label={groupLabel}
        isOpen={isOpen}
        onToggle={() =>
          setExpandedGroups((prev) =>
            prev[groupName] ? {} : { [groupName]: true },
          )
        }
      >
        {groupName === 'border' ? (
          // Border group: custom per-side editor, with fallback to standard rendering
          (() => {
            const hasPerSide = groupProps.some(p => p.key.match(/-(top|right|bottom|left)-/));
            if (hasPerSide) {
              return (
                <BorderSideEditor
                  props={groupProps}
                  values={sideAwareGroupValues}
                  onChange={handleGroupPropChange}
                  onLiveStyle={onLiveStyle ? (key, val) => onLiveStyle(key, val) : undefined}
                  brandColors={brandColors}
                />
              );
            }
            // Fallback: render border props as standard fields (divider, footer)
            return <>{renderStandardProps(groupProps)}</>;
          })()
        ) : hasButtonSets ? (
          // Button/tracking groups with primary/secondary tabs
          (() => {
            const isHeroTrackingGroup = groupName === "tracking" && schema.name === "hero";
            const secondaryButtonProp = allSchemaProps.find(
              (prop) => prop.key === "secondary-button-text",
            );
            const hasSecondaryButton =
              String(
                readScopedPropValue(
                  "secondary-button-text",
                  secondaryButtonProp,
                ) || "",
              ).trim() !== "";
            const trackingTabs = hasSecondaryButton
              ? (["primary", "secondary"] as ("primary" | "secondary")[])
              : (["primary"] as ("primary" | "secondary")[]);

            if (isHeroTrackingGroup) {
              return (
                <ButtonSetTabs
                  groupProps={groupProps}
                  activeTab={trackingSetTab}
                  onTabChange={setTrackingSetTab}
                  renderStandardProps={renderStandardProps}
                  tabs={trackingTabs}
                  hideTabsWhenSingle
                />
              );
            }

            return (
              <ButtonSetTabs
                groupProps={groupProps}
                activeTab={buttonSetTab}
                onTabChange={setButtonSetTab}
                renderStandardProps={renderStandardProps}
              />
            );
          })()
        ) : (() => {
          // For background group, check for gradient props
          const isBackgroundGroup = groupName === 'background';
          const isHeroBackground = isBackgroundGroup && schema.name === "hero";
          const hasGradient = isBackgroundGroup && hasGradientProps(groupProps);
          const { regular: regularProps, gradient: gradientPropsList } = hasGradient
            ? splitGradientProps(groupProps)
            : { regular: groupProps, gradient: [] as typeof groupProps };

          if (isHeroBackground) {
            return (
              <HeroBackgroundEditor
                props={groupProps}
                values={sideAwareGroupValues}
                onChange={handleGroupPropChange}
                onBrowseMedia={onBrowseMedia}
                onUploadMedia={onUploadMedia}
                previewWidth={previewWidth}
              />
            );
          }

          return (
            <>
              {renderStandardProps(regularProps)}
              {hasGradient && gradientPropsList.length > 0 && (
                <GradientEditor
                  props={gradientPropsList}
                  values={sideAwareGroupValues}
                  onChange={handleGroupPropChange}
                />
              )}
            </>
          );
        })()}
      </CollapsiblePropGroup>
    );
  }

  // Render repeatable groups after standard groups
  for (const prop of allSchemaProps) {
    if (prop.repeatableGroup && !renderedRepeatableGroups.has(prop.repeatableGroup)) {
      renderedRepeatableGroups.add(prop.repeatableGroup);
      const group = groups.find((g) => g.key === prop.repeatableGroup);
      if (group) {
        if (isNumberedGroup(group)) {
          sections.push(renderNumberedGroup(group));
        } else {
          sections.push(renderNonNumberedGroup(group));
        }
      }
    }
  }

  return (
    <div className="space-y-2">
      {isCopyComponent && copyBodyProp && (
        <div className="pb-2">
          <label className="text-xs text-[var(--muted-foreground)] mb-1 block">
            {copyBodyProp.label}
          </label>
          <PropField
            prop={copyBodyProp}
            value={mergeCopyGreetingIntoBody(compProps.greeting || "", compProps.body || "")}
            onChange={(val) => {
              onPropChange("body", normalizeRichTextValue(val || ""));
              if (compProps.greeting) onPropChange("greeting", "");
            }}
            onInsertVariable={
              VARIABLE_ELIGIBLE_TYPES.has(copyBodyProp.type) && onInsertVariable
                ? (token: string) => onInsertVariable(copyBodyProp.key, token)
                : undefined
            }
            brandColors={brandColors}
            previewAsLabel={previewAsLabel}
            richTextBaseFontFamily={componentBaseFontFamily}
            inlineVariableOptions={inlineVariableOptions}
          />
        </div>
      )}
      {pinnedTopProps.length > 0 && (
        <div className={`space-y-3 ${sections.length > 0 ? "pb-3" : ""}`}>
          {renderStandardProps(pinnedTopProps)}
        </div>
      )}
      {isSplitComponent && (
        <>
          {splitSectionLevelProps.length > 0 && (
            <div className="space-y-2 pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Section
              </div>
              {renderStandardProps(splitSectionLevelProps)}
            </div>
          )}
          <div className="pb-2">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {(["left", "right"] as const).map((side) => {
              const isActive = activeSplitSide === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => setActiveSplitSide(side)}
                  className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                    isActive
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--input)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {splitSideLabel[side]}
                </button>
              );
            })}
          </div>
          </div>
        </>
      )}
      <div className="[&>*:first-child]:border-t-0">{sections}</div>
    </div>
  );
}

// Settings field definition type
interface SettingsField {
  key: string;
  label: string;
  type: string;
  target: string;
  placeholder?: string;
  half?: boolean;
  options?: { label: string; value: string }[];
}

interface SettingsSection {
  label: string;
  key: string;
  fields: SettingsField[];
}

// Canonical CTA prop keys used by x-core.cta + legacy aliases found in older templates.
const CTA_PROP_ALIASES: Record<string, string[]> = {
  "button-bg-color": ["bg-color"],
  "button-text-color": ["text-color"],
  "button-radius": ["radius"],
  "button-padding": ["padding"],
};

// Canonical global button keys mapped onto Hero primary/secondary button props.
const HERO_BUTTON_PROP_MAP: Record<string, string[]> = {
  "button-bg-color": [
    "primary-button-bg-color",
    "secondary-button-bg-color",
  ],
  "button-text-color": [
    "primary-button-text-color",
    "secondary-button-text-color",
  ],
  "button-radius": ["primary-button-radius", "secondary-button-radius"],
  "button-padding": ["primary-button-padding", "secondary-button-padding"],
};

const WEBSAFE_FONTS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, Times New Roman, serif' },
  { label: 'Times New Roman', value: 'Times New Roman, Times, serif' },
  { label: 'Palatino', value: 'Palatino Linotype, Book Antiqua, Palatino, serif' },
  { label: 'Garamond', value: 'Garamond, Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, Courier, monospace' },
  { label: 'Lucida Console', value: 'Lucida Console, Monaco, monospace' },
];

// Settings sections with static defaults (no theme system)
const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: "Email Meta",
    key: "meta",
    fields: [
      { key: "fm:title", label: "Title", type: "text", target: "frontmatter" },
    ],
  },
  {
    label: "Typography",
    key: "typography",
    fields: [
      {
        key: "font",
        label: "Font Family",
        type: "fontSelect",
        target: "allComponentsFont",
        placeholder: 'Helvetica Neue, Helvetica, Arial, sans-serif',
        options: WEBSAFE_FONTS,
      },
    ],
  },
  {
    label: "Layout",
    key: "layout",
    fields: [
      {
        key: "content-margin",
        label: "Margin",
        type: "padding",
        target: "baseProps",
        placeholder: "0px",
      },
      {
        key: "content-padding",
        label: "Padding",
        type: "padding",
        target: "baseProps",
        placeholder: "50px",
      },
      {
        key: "content-radius",
        label: "Border Radius",
        type: "radius",
        target: "baseProps",
        placeholder: "0",
      },
    ],
  },
  {
    label: "Colors",
    key: "colors",
    fields: [
      {
        key: "body-bg",
        label: "Body BG",
        type: "color",
        target: "baseProps",
        placeholder: "#ffffff",
        half: true,
      },
      {
        key: "content-bg",
        label: "Content BG",
        type: "color",
        target: "baseProps",
        placeholder: "#ffffff",
        half: true,
      },
    ],
  },
  {
    label: "CTA Button",
    key: "cta",
    fields: [
      {
        key: "button-bg-color",
        label: "Button Color",
        type: "color",
        target: "ctaComponents",
        placeholder: "#000000",
        half: true,
      },
      {
        key: "button-text-color",
        label: "Text Color",
        type: "color",
        target: "ctaComponents",
        placeholder: "#ffffff",
        half: true,
      },
      {
        key: "button-radius",
        label: "Button Radius",
        type: "radius",
        target: "ctaComponents",
        placeholder: "0",
      },
      {
        key: "button-padding",
        label: "Button Padding",
        type: "padding",
        target: "ctaComponents",
        placeholder: "18px 48px",
      },
    ],
  },
];

// Helper to serialize a single component into lines
function escapeTemplateAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function serializeComponent(
  comp: { type: string; props: Record<string, string>; content?: string },
  indent: string,
): string[] {
  const lines: string[] = [];
  const propEntries = Object.entries(comp.props);
  if (propEntries.length <= 2) {
    const attrStr = propEntries
      .map(([k, v]) => `${k}="${escapeTemplateAttrValue(String(v ?? ""))}"`)
      .join(" ");
    if (comp.content) {
      lines.push(
        `${indent}<x-core.${comp.type} ${attrStr}>${comp.content}</x-core.${comp.type}>`,
      );
    } else {
      lines.push(`${indent}<x-core.${comp.type} ${attrStr} />`);
    }
  } else {
    lines.push(`${indent}<x-core.${comp.type}`);
    for (const [key, value] of propEntries) {
      lines.push(
        `${indent}  ${key}="${escapeTemplateAttrValue(String(value ?? ""))}"`,
      );
    }
    if (comp.content) {
      lines[lines.length - 1] += ">";
      lines.push(`${indent}  ${comp.content}`);
      lines.push(`${indent}</x-core.${comp.type}>`);
    } else {
      lines.push(`${indent}/>`);
    }
  }
  return lines;
}

// All footer component types (only one allowed per template)
const FOOTER_TYPES = new Set(["footer"]);

// ── Live style injection ──
// Maps component prop names to CSS properties for instant preview updates.
// Only covers props that are simple, direct CSS mappings (color, background-color, padding, etc.)
// Composed/computed props (border shorthand, gradients) still go through the full compile.
const PROP_CSS_MAP: Record<string, string> = {
  // Colors
  "bg-color": "background-color",
  "text-color": "color",
  "link-color": "color",
  "dealer-name-color": "color",
  "phone-color": "color",
  "copyright-color": "color",
  "card-background": "background-color",
  "card-bg-color": "background-color",
  "eyebrow-color": "color",
  "headline-color": "color",
  "subheadline-color": "color",
  "body-color": "color",
  "greeting-color": "color",
  "label-color": "color",
  "value-color": "color",
  "caption-color": "color",
  "quote-color": "color",
  "author-color": "color",
  "source-color": "color",
  "vehicle-color": "color",
  "stat-label-color": "color",
  "stat-value-color": "color",
  "cta-color": "color",
  "description-color": "color",
  "heading-color": "color",
  "disclaimer-color": "color",
  "title-color": "color",
  "image-text-color": "color",
  "image-desc-color": "color",
  "primary-bg-color": "background-color",
  "primary-text-color": "color",
  "secondary-bg-color": "background-color",
  "secondary-text-color": "color",
  "button-bg-color": "background-color",
  "button-text-color": "color",
  "button-padding": "padding",
  // Spacing / sizing
  padding: "padding",
  "container-padding": "padding",
  "content-padding": "padding",
  "card-padding": "padding",
  "outer-padding": "padding",
  "brand-padding": "padding",
  // Font
  font: "font-family",
  "font-size": "font-size",
  "greeting-size": "font-size",
  "body-size": "font-size",
  "headline-size": "font-size",
  "subheadline-size": "font-size",
  "eyebrow-size": "font-size",
  "label-size": "font-size",
  "value-size": "font-size",
  "quote-size": "font-size",
  "vehicle-size": "font-size",
  // Radius
  radius: "border-radius",
  "card-radius": "border-radius",
  "primary-radius": "border-radius",
  "secondary-radius": "border-radius",
  "button-radius": "border-radius",
};

// Inject a live style change directly into the iframe DOM, bypassing the Maizzle compiler.
// Finds all elements within a component's <tr> subtree that currently have the target CSS
// property set, and updates their value. Falls back to the component's main <td> if needed.
function injectLiveStyle(
  iframe: HTMLIFrameElement | null,
  componentIndex: number,
  cssProp: string,
  value: string,
) {
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Find all <tr> elements for this component
    const trs = doc.querySelectorAll(`tr[data-loomi="${componentIndex}"]`);
    if (trs.length === 0) return;

    // Search within the component subtree for elements that already have this style set
    let found = false;
    trs.forEach((tr) => {
      const all = tr.querySelectorAll("*");
      all.forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style && htmlEl.style.getPropertyValue(cssProp)) {
          htmlEl.style.setProperty(cssProp, value);
          found = true;
        }
      });
      // Also check the <tr> itself
      const trEl = tr as HTMLElement;
      if (trEl.style && trEl.style.getPropertyValue(cssProp)) {
        trEl.style.setProperty(cssProp, value);
        found = true;
      }
    });

    // If no element found with that property, try the first <td> child (common case for bg-color)
    if (!found && trs.length > 0) {
      const td = trs[0].querySelector(":scope > td") as HTMLElement;
      if (td) {
        td.style.setProperty(cssProp, value);
      }
    }
  } catch {
    // iframe cross-origin or other error, silently fail
  }
}

function injectFooterIconColor(
  iframe: HTMLIFrameElement | null,
  componentIndex: number,
  value: string,
) {
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;

    const trs = doc.querySelectorAll(`tr[data-loomi="${componentIndex}"]`);
    if (trs.length === 0) return;

    trs.forEach((tr) => {
      const svgs = tr.querySelectorAll("svg");
      svgs.forEach((svg) => {
        svg.setAttribute("fill", value);
        (svg as SVGElement).style.setProperty("fill", value);
      });
    });
  } catch {
    // iframe cross-origin or other error, silently fail
  }
}

// Inject a live style for base layout props (body-bg, content-bg) which are on wrapper elements
function injectLiveBaseStyle(
  iframe: HTMLIFrameElement | null,
  propKey: string,
  value: string,
) {
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;

    if (propKey === "body-bg") {
      // Body background + outer table
      if (doc.body) doc.body.style.backgroundColor = value;
      const outerTable = doc.querySelector(
        'table[role="presentation"]',
      ) as HTMLElement;
      if (outerTable) outerTable.style.backgroundColor = value;
    } else if (propKey === "content-bg") {
      // Inner content table
      const contentTable = doc.querySelector(".email-container") as HTMLElement;
      if (contentTable) contentTable.style.backgroundColor = value;
    }
  } catch {
    // silently fail
  }
}

/**
 * Preview serializer. With the Maizzle removal, both v2 templates and any
 * residual non-v2 callers route through the unified serializer — the legacy
 * hidden-div-marker injection (used to wire click-to-select onto Maizzle's
 * post-rendered HTML) is gone.
 *
 * The `hiddenComponents` parameter is kept for call-site compatibility but
 * is unused — the v2 visual editor handles selection / hide via React state.
 */
function serializeTemplateForPreview(
  template: ParsedTemplate,
  _hiddenComponents: Set<number>,
): string {
  return serializeTemplateUnified(template);
}

/**
 * No-op. Previously post-processed Maizzle-rendered HTML to add `data-loomi`
 * attributes to <tr> elements so iframe clicks could be mapped back to a
 * component index. The v2 editor doesn't use an iframe preview, so this
 * isn't needed anymore.
 */
function injectLoomiAttributes(html: string): string {
  return html;
}

/**
 * Transforms compiled HTML to simulate Apple Mail-style dark mode preview.
 *
 * Strategy:
 *  - Set `color-scheme: dark` on the document so browsers know to use dark UI chrome.
 *  - Strip the `prefers-color-scheme` wrapper from any dark-mode media queries so
 *    those rules apply unconditionally (this is what email designers write to
 *    support dark mode — we just force-enable it here).
 *  - Inject a fallback dark background so the iframe wrapper itself doesn't
 *    flash white when the email lacks an explicit body bg.
 *
 * Note: this only simulates clients that honor prefers-color-scheme (Apple
 * Mail). Outlook.com and Gmail mobile apply their own forced inversion that we
 * cannot replicate from CSS alone.
 */
function applyDarkModePreview(html: string): string {
  if (!html) return html;

  let transformed = html;

  // Unwrap `@media (prefers-color-scheme: dark) { … }` blocks so they always apply.
  // Match the @media query and its matching closing brace by balanced-brace scan.
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  const unwrap = (input: string): string => {
    let result = "";
    let cursor = 0;
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(input)) !== null) {
      const start = match.index;
      const openBraceIdx = start + match[0].length - 1;
      // Walk forward, tracking brace depth, to find the matching close brace.
      let depth = 1;
      let i = openBraceIdx + 1;
      while (i < input.length && depth > 0) {
        const ch = input[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      if (depth !== 0) break; // unbalanced — bail out, leave the rest alone
      const innerStart = openBraceIdx + 1;
      const innerEnd = i - 1;
      result += input.slice(cursor, start);
      result += input.slice(innerStart, innerEnd);
      cursor = i;
      re.lastIndex = i;
    }
    result += input.slice(cursor);
    return result;
  };
  transformed = unwrap(transformed);

  // Prepend a base dark stylesheet — applied first so the email's own styles win.
  const darkBaseStyles = `<style data-loomi-dark-preview>html{color-scheme:dark;}html,body{background-color:#1a1a1a;}</style>`;

  if (/<head[^>]*>/i.test(transformed)) {
    transformed = transformed.replace(/<head([^>]*)>/i, `<head$1>${darkBaseStyles}`);
  } else {
    transformed = darkBaseStyles + transformed;
  }

  return transformed;
}

/**
 * Transforms compiled HTML to force a light-mode preview, regardless of the
 * viewer's OS theme.
 *
 * `prefers-color-scheme` reflects the OS preference, not the document's
 * `color-scheme` property — so we cannot opt out of OS dark mode by setting
 * `color-scheme: light`. Instead we rewrite any `@media (prefers-color-scheme:
 * dark)` condition to `@media not all`, which never matches in any context.
 * The dark rules remain in the source, just dormant, so toggling back to
 * Dark Mode re-activates them via `applyDarkModePreview`.
 */
function applyLightModePreview(html: string): string {
  if (!html) return html;

  const transformed = html.replace(
    /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi,
    "@media not all {",
  );

  const lightBaseStyles = `<style data-loomi-light-preview>:root,html,body{color-scheme:light;}</style>`;
  if (/<head[^>]*>/i.test(transformed)) {
    return transformed.replace(/<head([^>]*)>/i, `<head$1>${lightBaseStyles}`);
  }
  return lightBaseStyles + transformed;
}

// Client-side serializer
function serializeTemplateClient(template: ParsedTemplate): string {
  if (template.frontmatter?.version === "2") {
    return serializeTemplateUnified(template);
  }

  const lines: string[] = [];
  lines.push("---");
  for (const [key, value] of Object.entries(template.frontmatter)) {
    if (
      typeof value === "string" &&
      (value.includes(":") || value.includes("{") || value.includes('"'))
    ) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push("");
  if (Object.keys(template.baseProps).length <= 2) {
    const inlineStr = Object.entries(template.baseProps)
      .map(([k, v]) => `${k}="${escapeTemplateAttrValue(String(v ?? ""))}"`)
      .join(" ");
    lines.push(`<x-base ${inlineStr}>`);
  } else {
    lines.push(`<x-base`);
    for (const [k, v] of Object.entries(template.baseProps)) {
      lines.push(`  ${k}="${escapeTemplateAttrValue(String(v ?? ""))}"`);
    }
    lines.push(`>`);
  }

  template.components.forEach((comp, i) => {
    const compWithIndex = {
      ...comp,
      props: { ...comp.props, "component-index": String(i) },
    };
    lines.push("");
    lines.push(...serializeComponent(compWithIndex, "  "));
  });

  lines.push("");
  lines.push("</x-base>");
  lines.push("");
  return lines.join("\n");
}

function hasVisualTemplateScaffold(raw: string): boolean {
  // Recognizes v2 JSON templates AND the legacy <x-base> scaffold as visual-editable.
  return isVisualEditableTemplate(raw);
}

export default function TemplateEditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useLoomiDialog();
  const designParam = searchParams.get("design") || "";
  const [design, setDesign] = useState(designParam);
  const templateName = "template";
  const modeParam = searchParams.get("mode");
  const accountKeyParam = searchParams.get("accountKey") || "";
  const libraryTemplateSlug = searchParams.get("libraryTemplate") || "";
  // When launched from the campaign builder, the editor shows campaign-aware
  // actions (Schedule, Manage template dropdown) in the top bar instead of
  // the regular Save Template button.
  const campaignIdParam = searchParams.get("campaignId") || "";
  // The multi=1 flag rides along when the editor is opened from the
  // multi-channel builder. Without it, Schedule + Change template would
  // route to email-only paths and the linked SMS draft would be orphaned.
  const fromMultiBuilder = searchParams.get("multi") === "1";
  const [showManageTemplateMenu, setShowManageTemplateMenu] = useState(false);
  const manageTemplateMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showManageTemplateMenu) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        manageTemplateMenuRef.current &&
        !manageTemplateMenuRef.current.contains(event.target as Node)
      ) {
        setShowManageTemplateMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showManageTemplateMenu]);
  const { isAdmin, isAccount, accountKey, accountData, accounts } = useAccount();
  const subHref = useSubaccountHref();
  const { markClean, markDirty } = useUnsavedChanges();
  // accountKey priority: URL param > current session account context.
  // Library templates aren't account-scoped, so this is mainly used by the
  // media picker and account-specific branding fallbacks.
  const effectiveAccountKey = accountKeyParam || accountKey;
  const effectiveAccountData = useMemo(
    () => (effectiveAccountKey ? accounts[effectiveAccountKey] || null : accountData),
    [effectiveAccountKey, accounts, accountData],
  );
  // Parse branding safely — may arrive as a JSON string from the API
  const parsedBranding = useMemo(() => {
    const raw = effectiveAccountData?.branding;
    if (!raw) return undefined;
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as NonNullable<typeof effectiveAccountData>["branding"]; } catch { return undefined; }
    }
    return raw;
  }, [effectiveAccountData?.branding]);
  const brandColors = useMemo(() => {
    const colors = parsedBranding?.colors;
    if (!colors) return undefined;
    const entries: { label: string; value: string }[] = [];
    if (colors.primary) entries.push({ label: "Primary", value: colors.primary });
    if (colors.secondary) entries.push({ label: "Secondary", value: colors.secondary });
    if (colors.accent) entries.push({ label: "Accent", value: colors.accent });
    if (colors.background) entries.push({ label: "Background", value: colors.background });
    if (colors.text) entries.push({ label: "Text", value: colors.text });
    return entries.length > 0 ? entries : undefined;
  }, [parsedBranding?.colors]);
  const inlineVariableOptions = useMemo<InlineVariableOption[]>(() => {
    const byToken = new Map<string, InlineVariableOption>();
    for (const option of BASE_INLINE_VARIABLE_OPTIONS) {
      byToken.set(option.token.toLowerCase(), option);
    }

    const raw = effectiveAccountData?.customValues;
    if (!raw) return Array.from(byToken.values());

    let parsed: Record<string, { name?: string; value?: string }> | null = null;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw) as Record<string, { name?: string; value?: string }>;
      } catch {
        parsed = null;
      }
    } else if (typeof raw === "object") {
      parsed = raw as Record<string, { name?: string; value?: string }>;
    }
    if (!parsed) return Array.from(byToken.values());

    for (const [fieldKey, def] of Object.entries(parsed)) {
      const token = `{{custom_values.${fieldKey}}}`;
      const key = token.toLowerCase();
      const existing = byToken.get(key);
      byToken.set(key, {
        token,
        label: (def?.name || existing?.label || fieldKey).trim(),
        description: def?.value
          ? `Current: ${def.value}`
          : existing?.description || "Account custom value",
      });
    }

    return Array.from(byToken.values());
  }, [effectiveAccountData?.customValues]);
  // Parse logos safely — may also be a JSON string
  const accountLogos = useMemo(() => {
    const raw = effectiveAccountData?.logos;
    if (!raw) return undefined;
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as NonNullable<typeof effectiveAccountData>["logos"]; } catch { return undefined; }
    }
    return raw;
  }, [effectiveAccountData?.logos]);
  const mediaPickerAccountKey = effectiveAccountKey || undefined;
  const canBrowseMedia = Boolean(mediaPickerAccountKey || isAdmin);
  const builderMode = searchParams.get("builder");
  const isHtmlOnlyBuilder = builderMode === "html";

  const [code, setCode] = useState("");
  const [originalCode, setOriginalCode] = useState("");
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  // Ref tracks the latest parsed state so that multiple synchronous
  // updateComponentProp calls (e.g. border editor setting shorthand + 4 sides)
  // each build on the previous call's result instead of a stale closure value.
  const parsedRef = useRef<ParsedTemplate | null>(null);
  useEffect(() => { parsedRef.current = parsed; }, [parsed]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewKeyRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [previewColorScheme, setPreviewColorScheme] = useState<"light" | "dark">(
    "light",
  );
  const [previewZoom, setPreviewZoom] = useState(PREVIEW_ZOOM_DEFAULT);
  const [hasChanges, setHasChanges] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(
    isHtmlOnlyBuilder ? "code" : "visual",
  );
  const [visualTab, setVisualTab] = useState<VisualTab>("components");
  const [expandedComponents, setExpandedComponents] = useState<Set<number>>(
    new Set(),
  );
  const [showComponentPicker, setShowComponentPicker] = useState(false);
  const [previewContacts, setPreviewContacts] = useState<PreviewContact[]>([]);
  const [previewContactsLoading, setPreviewContactsLoading] = useState(false);
  const [previewContactsError, setPreviewContactsError] = useState("");
  const [selectedPreviewContactId, setSelectedPreviewContactId] =
    useState("__sample__");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [, setAiReply] = useState("");
  const [, setAiSuggestions] = useState<string[]>([]);
  const [, setAiComponentEdits] = useState<
    AssistantComponentEdit[]
  >([]);
  const [aiHistory, setAiHistory] = useState<
    Array<{
      role: "user" | "assistant";
      content: string;
      suggestions?: string[];
      componentEdits?: AssistantComponentEdit[];
      templateBuild?: TemplateBuild | null;
      clarification?: string | null;
    }>
  >([]);
  const [pendingAiBuild, setPendingAiBuild] = useState<TemplateBuild | null>(null);
  const aiScrollRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVersions, setHistoryVersions] = useState<
    TemplateHistoryVersion[]
  >([]);
  const [historyCompareLoading, setHistoryCompareLoading] = useState(false);
  const [selectedHistoryVersion, setSelectedHistoryVersion] =
    useState<TemplateHistoryVersion | null>(null);
  const [selectedHistoryRaw, setSelectedHistoryRaw] = useState("");
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null,
  );
  const [sectionTags, setSectionTags] = useState<{
    tags: string[];
    assignments: Record<string, string[]>;
  } | null>(null);
  const [pickerTag, setPickerTag] = useState<string>("all");
  const [hiddenComponents, setHiddenComponents] = useState<Set<number>>(
    new Set(),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragHeightsRef = useRef<number[]>([]);
  const dragTopsRef = useRef<number[]>([]);
  const dragMouseTargetRef = useRef<HTMLElement | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<number | null>(
    null,
  );
  const selectedComponentRef = useRef<number | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef(code);
  const previewCacheRef = useRef(new Map<string, string>());
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const splitResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const [editorPanelWidth, setEditorPanelWidth] = useState(EDITOR_PANEL_DEFAULT_WIDTH);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const effectiveTemplateFont = useMemo(() => {
    const explicitTemplateFont = parsed?.components
      .find((component) => (component.props.font || "").trim())
      ?.props.font?.trim();
    if (explicitTemplateFont) return explicitTemplateFont;
    const brandedDefaultFont = parsedBranding?.fonts?.body?.trim();
    if (brandedDefaultFont) return brandedDefaultFont;
    return FALLBACK_FONT_FAMILY;
  }, [parsed, parsedBranding?.fonts?.body]);

  // Media picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerComponentIdx, setMediaPickerComponentIdx] = useState<number | null>(null);
  const [mediaPickerPropKey, setMediaPickerPropKey] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerComponentIdx, setIconPickerComponentIdx] = useState<number | null>(null);
  const [iconPickerPropKey, setIconPickerPropKey] = useState<string | null>(null);

  const handleBrowseMedia = useCallback((componentIdx: number, propKey: string) => {
    if (!canBrowseMedia) {
      toast.error("Select an account to browse media");
      return;
    }
    setMediaPickerComponentIdx(componentIdx);
    setMediaPickerPropKey(propKey);
    setMediaPickerOpen(true);
  }, [canBrowseMedia]);

  const handleCloseIconPicker = useCallback(() => {
    setIconPickerOpen(false);
    setIconPickerComponentIdx(null);
    setIconPickerPropKey(null);
  }, []);

  const handleBrowseIcon = useCallback((componentIdx: number, propKey: string) => {
    if (!canBrowseMedia) {
      toast.error("Select an account to use the icon library");
      return;
    }
    setIconPickerComponentIdx(componentIdx);
    setIconPickerPropKey(propKey);
    setIconPickerOpen(true);
  }, [canBrowseMedia]);

  const handleMediaSelect = useCallback((url: string) => {
    if (mediaPickerComponentIdx !== null && mediaPickerPropKey) {
      updateComponentProp(mediaPickerComponentIdx, mediaPickerPropKey, url);
    }
    setMediaPickerOpen(false);
    setMediaPickerComponentIdx(null);
    setMediaPickerPropKey(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaPickerComponentIdx, mediaPickerPropKey]);

  // Keep codeRef in sync for reading in effects without triggering re-runs
  useEffect(() => { codeRef.current = code; }, [code]);

  // Undo/redo history
  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const historySkipRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback((prevCode: string) => {
    historyRef.current.push(prevCode);
    if (historyRef.current.length > 50) historyRef.current.shift();
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const clampEditorPanelWidth = useCallback((desiredWidth: number) => {
    const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
    if (!containerWidth || Number.isNaN(containerWidth)) {
      return Math.max(EDITOR_PANEL_MIN_WIDTH, Math.round(desiredWidth));
    }

    const reservedAiWidth = showAiAssistant ? AI_PANEL_WIDTH + SPLIT_GAP_PX : 0;
    const maxWidth =
      containerWidth -
      reservedAiWidth -
      PREVIEW_PANEL_MIN_WIDTH -
      SPLIT_GAP_PX * 2 -
      SPLITTER_WIDTH_PX;
    const boundedMax = Math.max(
      EDITOR_PANEL_MIN_WIDTH,
      Math.min(Math.floor(maxWidth), EDITOR_PANEL_MAX_WIDTH),
    );

    return Math.round(
      Math.min(Math.max(desiredWidth, EDITOR_PANEL_MIN_WIDTH), boundedMax),
    );
  }, [showAiAssistant]);

  const beginPanelResize = useCallback((clientX: number) => {
    splitResizeStartRef.current = { x: clientX, width: editorPanelWidth };
    setIsResizingPanels(true);
  }, [editorPanelWidth]);

  const handlePanelResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    beginPanelResize(e.clientX);
  }, [beginPanelResize]);

  const adjustEditorPanelWidth = useCallback((delta: number) => {
    setEditorPanelWidth((prev) => clampEditorPanelWidth(prev + delta));
  }, [clampEditorPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncWidth = () => {
      setEditorPanelWidth((prev) => clampEditorPanelWidth(prev));
    };
    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, [clampEditorPanelWidth]);

  useEffect(() => {
    if (!isResizingPanels || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const start = splitResizeStartRef.current;
      if (!start) return;
      const nextWidth = start.width + (e.clientX - start.x);
      setEditorPanelWidth(clampEditorPanelWidth(nextWidth));
    };

    const stopResizing = () => {
      splitResizeStartRef.current = null;
      setIsResizingPanels(false);
    };

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    window.addEventListener("blur", stopResizing);

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      window.removeEventListener("blur", stopResizing);
    };
  }, [clampEditorPanelWidth, isResizingPanels]);

  const selectedPreviewContact = useMemo(
    () =>
      previewContacts.find((c) => c.id === selectedPreviewContactId) || null,
    [previewContacts, selectedPreviewContactId],
  );
  const previewAsLabel = useMemo(() => {
    if (selectedPreviewContactId === "__sample__" || !selectedPreviewContact) {
      return "Sample";
    }
    return (
      selectedPreviewContact.fullName ||
      [selectedPreviewContact.firstName, selectedPreviewContact.lastName]
        .filter(Boolean)
        .join(" ") ||
      selectedPreviewContact.email ||
      selectedPreviewContact.id
    );
  }, [selectedPreviewContact, selectedPreviewContactId]);

  const previewVariableMap = useMemo(
    () => buildPreviewVariableMap(effectiveAccountData, selectedPreviewContact),
    [effectiveAccountData, selectedPreviewContact],
  );

  const missingPreviewVars = useMemo(
    () => findMissingPreviewVariables(code, previewVariableMap),
    [code, previewVariableMap],
  );

  const [showMissingVars, setShowMissingVars] = useState(false);

  const lintIssues = useMemo<LintIssue[]>(
    () => lintEmailHtml(previewHtml),
    [previewHtml],
  );

  const lintIssuesByCategory = useMemo(() => {
    const grouped = new Map<LintCategory, LintIssue[]>();
    for (const issue of lintIssues) {
      const list = grouped.get(issue.category) ?? [];
      list.push(issue);
      grouped.set(issue.category, list);
    }
    for (const list of grouped.values()) {
      list.sort(
        (a, b) => LINT_SEVERITY_RANK[a.severity] - LINT_SEVERITY_RANK[b.severity],
      );
    }
    return grouped;
  }, [lintIssues]);

  const [showLintPanel, setShowLintPanel] = useState(false);

  const previewSrcDoc = useMemo(
    () =>
      previewColorScheme === "dark"
        ? applyDarkModePreview(previewHtml)
        : applyLightModePreview(previewHtml),
    [previewHtml, previewColorScheme],
  );

  const selectedEditorComponent = useMemo(() => {
    if (selectedComponent === null || !parsed) return null;
    const component = parsed.components[selectedComponent];
    if (!component) return null;
    const schema = componentSchemas[component.type];
    return {
      index: selectedComponent,
      type: component.type,
      label: schema?.label || component.type,
      props: component.props,
      availableProps:
        schema?.props.map((prop) => ({
          key: prop.key,
          label: prop.label,
          type: prop.type,
        })) || [],
    };
  }, [selectedComponent, parsed]);

  const currentEmailContext = useMemo(
    () =>
      buildCurrentEmailContext({
        parsed,
        previewHtml,
        rawTemplate: code,
        subject: parsed?.frontmatter?.subject || parsed?.frontmatter?.title || null,
        previewText: parsed?.frontmatter?.previewText || null,
        selectedComponent: selectedEditorComponent,
      }),
    [parsed, previewHtml, code, selectedEditorComponent],
  );

  const compilePreview = useCallback(
    async (html: string) => {
      // Cancel any in-flight preview request
      if (previewAbortRef.current) previewAbortRef.current.abort();
      const controller = new AbortController();
      previewAbortRef.current = controller;

      // Check client-side in-memory cache first (avoids network round-trip)
      const cached = previewCacheRef.current.get(html);
      if (cached) {
        previewKeyRef.current += 1;
        setPreviewHtml(injectLoomiAttributes(cached));
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      setPreviewError("");
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html,
            project: "core",
            previewValues: previewVariableMap,
          }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const data = await res.json();
        if (data.html) {
          // Cache the compiled result (LRU eviction at 100 entries)
          if (previewCacheRef.current.size > 100) {
            const firstKey = previewCacheRef.current.keys().next().value;
            if (firstKey) previewCacheRef.current.delete(firstKey);
          }
          previewCacheRef.current.set(html, data.html);
          previewKeyRef.current += 1;
          setPreviewHtml(injectLoomiAttributes(data.html));
        } else if (data.error) setPreviewError(data.error);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setPreviewError(err.message || "Preview failed");
      }
      if (!controller.signal.aborted) setPreviewLoading(false);
    },
    [previewVariableMap],
  );

  // Clear client-side preview cache when preview variables change (different contact selected)
  useEffect(() => {
    previewCacheRef.current.clear();
  }, [previewVariableMap]);

  const loadPreviewContacts = useCallback(async () => {
    if (!effectiveAccountKey) {
      setPreviewContacts([]);
      setPreviewContactsError("");
      setSelectedPreviewContactId("__sample__");
      return;
    }

    setPreviewContactsLoading(true);
    setPreviewContactsError("");
    try {
      const res = await fetch(
        `/api/contacts?accountKey=${encodeURIComponent(effectiveAccountKey)}&limit=30`,
      );
      const data = await res.json();
      if (!res.ok) {
        setPreviewContacts([]);
        setPreviewContactsError(data.error || "Unable to load contacts");
        return;
      }
      const contacts = Array.isArray(data.contacts)
        ? (data.contacts as PreviewContact[])
        : [];
      setPreviewContacts(contacts);
      setSelectedPreviewContactId((prev) => {
        if (prev !== "__sample__" && !contacts.some((c) => c.id === prev))
          return "__sample__";
        return prev;
      });
    } catch {
      setPreviewContacts([]);
      setPreviewContactsError("Unable to load contacts");
    } finally {
      setPreviewContactsLoading(false);
    }
  }, [effectiveAccountKey]);

  const loadTemplateHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/templates/history?design=${encodeURIComponent(design)}&type=${encodeURIComponent(templateName)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to load history");
        return;
      }
      setHistoryVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch {
      setMessage("Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [design, templateName]);

  const loadHistoryVersion = useCallback(
    async (version: TemplateHistoryVersion) => {
      setHistoryCompareLoading(true);
      setSelectedHistoryVersion(version);
      setSelectedHistoryRaw("");
      try {
        const res = await fetch(
          `/api/templates/history?design=${encodeURIComponent(design)}&type=${encodeURIComponent(templateName)}&versionId=${encodeURIComponent(version.id)}`,
        );
        const data = await res.json();
        if (!res.ok || !data.raw) {
          setSelectedHistoryRaw("");
          setMessage(data.error || "Failed to load version");
          return;
        }
        setSelectedHistoryRaw(data.raw);
      } catch {
        setSelectedHistoryRaw("");
        setMessage("Failed to load version");
      } finally {
        setHistoryCompareLoading(false);
      }
    },
    [design, templateName],
  );

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true);
    setSelectedHistoryVersion(null);
    setSelectedHistoryRaw("");
    loadTemplateHistory();
  }, [loadTemplateHistory]);

  // Load template + ESP variables
  useEffect(() => {
    const applyResolvedFontDefaults = (template: ParsedTemplate): ParsedTemplate => {
      if (!template.components.length) return template;
      const firstExplicitFont = template.components.find(
        (component) => (component.props.font || "").trim(),
      )?.props.font;
      const fallbackFont =
        (firstExplicitFont || parsedBranding?.fonts?.body || "").trim();
      if (!fallbackFont) return template;

      const hasMissingFont = template.components.some(
        (component) => !(component.props.font || "").trim(),
      );
      if (!hasMissingFont) return template;

      return {
        ...template,
        components: template.components.map((component) => {
          if ((component.props.font || "").trim()) return component;
          return {
            ...component,
            props: {
              ...component.props,
              font: fallbackFont,
            },
          };
        }),
      };
    };

    // ── New template scratch (no design slug yet, account-scoped start) ──
    // Used when the editor is launched from a campaign builder before a
    // library template has been picked: just initialize a blank source so
    // the user can write/build immediately. The first save creates a
    // library record under a generated slug.
    if (accountKeyParam && !design) {
      if (modeParam === "code") setEditorMode("code");
      if (libraryTemplateSlug) {
        fetch(`/api/templates?design=${libraryTemplateSlug}&type=template&format=raw`)
          .then((r) => r.json())
          .then((rawData) => {
            if (rawData.raw) {
              const visualSource = hasVisualTemplateScaffold(rawData.raw);
              if (visualSource) {
                const p = parseTemplate(rawData.raw);
                const withFont = applyResolvedFontDefaults(p);
                const serialized = serializeTemplateClient(withFont);
                setCode(serialized);
                setOriginalCode(rawData.raw);
                setParsed(withFont);
                compilePreview(serializeTemplateForPreview(withFont, new Set()));
              } else {
                setParsed(null);
                setEditorMode("code");
                setCode(rawData.raw);
                setOriginalCode(rawData.raw);
                compilePreview(rawData.raw);
              }
            }
          })
          .catch((err) => console.error("Error loading library template:", err));
      } else {
        const blank = getStarterTemplate(modeParam === "code" ? "code" : "visual");
        const blankIsVisual = hasVisualTemplateScaffold(blank);
        if (blankIsVisual) {
          const p = parseTemplate(blank);
          const withFont = applyResolvedFontDefaults(p);
          const serialized = serializeTemplateClient(withFont);
          setCode(serialized);
          setOriginalCode(blank);
          setParsed(withFont);
          compilePreview(serializeTemplateForPreview(withFont, new Set()));
        } else {
          setParsed(null);
          setEditorMode("code");
          setCode(blank);
          setOriginalCode(blank);
          compilePreview(blank);
        }
      }
      return;
    }

    // ── Library template: load by design slug ──
    if (!design) return;
    Promise.all([
      fetch(
        `/api/templates?design=${design}&type=${templateName}&format=raw`,
      ).then((r) => r.json()),
      fetch(`/api/templates?design=${design}&type=${templateName}`).then((r) =>
        r.json(),
      ),
    ])
      .then(([rawData, parsedData]) => {
        const raw = typeof rawData.raw === "string" ? rawData.raw : "";
        if (!raw) return;

        setCode(raw);
        setOriginalCode(raw);

        const visualSource = hasVisualTemplateScaffold(raw);
        if (!visualSource) {
          setParsed(null);
          setEditorMode("code");
          compilePreview(raw);
          return;
        }

        const parsedWithFontDefaults = applyResolvedFontDefaults(
          parsedData.frontmatter ? parsedData : parseTemplate(raw),
        );
        setParsed(parsedWithFontDefaults);
        // v2 JSON templates are inherently visual — force visual mode regardless of URL param.
        if (!isHtmlOnlyBuilder || isV2Template(raw)) {
          setEditorMode("visual");
        }
        const previewCode = serializeTemplateForPreview(
          parsedWithFontDefaults,
          new Set(),
        );
        compilePreview(previewCode);
      })
      .catch((err) => console.error("Error loading template:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, templateName, accountKeyParam, libraryTemplateSlug, parsedBranding?.fonts?.body, modeParam, isHtmlOnlyBuilder]);

  useEffect(() => {
    setHasChanges(code !== originalCode);
  }, [code, originalCode]);

  useEffect(() => {
    if (hasChanges) {
      markDirty();
      return;
    }
    markClean();
  }, [hasChanges, markClean, markDirty]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    document.body.dataset.templateAiSidebar = showAiAssistant ? "open" : "closed";
    window.dispatchEvent(
      new CustomEvent(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, {
        detail: { open: showAiAssistant },
      }),
    );
  }, [showAiAssistant]);

  // Listen for external requests to open the AI sidebar (e.g. from the global AI bubble)
  const showAiAssistantRef = useRef(showAiAssistant);
  showAiAssistantRef.current = showAiAssistant;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ open?: boolean }>).detail;
      // Only react if state actually needs to change (avoids re-dispatch loop)
      if (detail?.open === true && !showAiAssistantRef.current) {
        setShowAiAssistant(true);
      }
    };
    window.addEventListener(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, handler);
  }, []);

  useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.templateAiSidebar;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(TEMPLATE_AI_SIDEBAR_TOGGLE_EVENT, {
            detail: { open: false },
          }),
        );
      }
    };
  }, []);

  // ── Auto-save (3s after last change) ──
  // Library templates only — ESP-side persistence is gone. If we don't
  // have a design slug yet (brand-new template launched from a campaign
  // builder before the first save) we just defer; an explicit save will
  // create the library record.
  useEffect(() => {
    if (!hasChanges || saving) return;
    if (!design) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      setMessage("");
      try {
        const res = await fetch("/api/templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ design, type: templateName, raw: code }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.slug && data.slug !== design) setDesign(data.slug);
          setOriginalCode(code);
          setMessage("Saved");
          setTimeout(() => setMessage(""), 2000);
        }
      } catch { /* silent */ }
      setSaving(false);
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges, code, design, templateName, saving]);

  useEffect(() => {
    if (isHtmlOnlyBuilder) {
      setEditorMode("code");
      setVisualTab("settings");
    }
  }, [isHtmlOnlyBuilder]);

  useEffect(() => {
    loadPreviewContacts();
  }, [loadPreviewContacts]);

  // Keep selectedComponent ref in sync for iframe load handler
  useEffect(() => {
    selectedComponentRef.current = selectedComponent;
  }, [selectedComponent]);

  // Lazy-load section tags when picker opens
  useEffect(() => {
    if (showComponentPicker && !sectionTags) {
      fetch("/api/component-tags")
        .then((r) => r.json())
        .then((data) => setSectionTags(data))
        .catch(() => setSectionTags({ tags: [], assignments: {} }));
    }
    if (!showComponentPicker) {
      setPickerTag("all");
    }
  }, [showComponentPicker, sectionTags]);

  // Re-compile preview when preview variables or hidden components change.
  // Reads parsed/code from refs to avoid double-triggering with syncVisualToCode.
  useEffect(() => {
    const currentCode = codeRef.current;
    const currentParsed = parsedRef.current;
    if (!currentCode) return;
    const htmlForPreview =
      editorMode === "visual" && currentParsed
        ? serializeTemplateForPreview(currentParsed, hiddenComponents)
        : currentCode;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(
      () => compilePreview(htmlForPreview),
      300,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVariableMap, editorMode, hiddenComponents, compilePreview]);

  const handleCodeChange = (newCode: string) => {
    if (!historySkipRef.current) pushHistory(code);
    historySkipRef.current = false;
    setCode(newCode);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => compilePreview(newCode), 300);
  };

  const handleModeSwitch = async (mode: EditorMode) => {
    if (mode === editorMode) return;
    if (mode === "visual" && !canUseVisualBuilder) return;
    // Templates launched from a campaign builder may not have a design
    // slug yet (no library record created). In that case skip the
    // server-side reparse — just toggle the in-memory mode.
    if (!design) {
      if (mode === "visual" && parsed) {
        const previewCode = serializeTemplateForPreview(parsed, hiddenComponents);
        compilePreview(previewCode);
      } else if (mode === "visual") {
        compilePreview(code);
      }
      setEditorMode(mode);
      return;
    }
    if (mode === "visual") {
      if (hasChanges) {
        await fetch("/api/templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            design,
            type: templateName,
            raw: code,
            createSnapshot: false,
          }),
        });
        setOriginalCode(code);
      }
      const parsedRes = await fetch(
        `/api/templates?design=${design}&type=${templateName}`,
      );
      const parsedData = await parsedRes.json();
      if (parsedData.frontmatter) {
        setParsed(parsedData);
        // Recompile preview with markers for click-to-select
        const previewCode = serializeTemplateForPreview(
          parsedData,
          hiddenComponents,
        );
        compilePreview(previewCode);
      }
    }
    setEditorMode(mode);
  };

  const updateComponentProp = (
    compIndex: number,
    key: string,
    value: string,
  ) => {
    // Read from ref so that multiple synchronous calls (e.g. border editor
    // setting shorthand + 4 per-side props) each see the accumulated state.
    const currentParsed = parsedRef.current ?? parsed;
    if (!currentParsed) return;
    const newComponents = [...currentParsed.components];
    const newProps = { ...newComponents[compIndex].props };
    if (!value && (key.startsWith('m:') || key.includes('-m:'))) {
      // Clear mobile override — remove the key entirely
      delete newProps[key];
    } else {
      newProps[key] = value;
    }
    newComponents[compIndex] = {
      ...newComponents[compIndex],
      props: newProps,
    };
    const newParsed = { ...currentParsed, components: newComponents };
    parsedRef.current = newParsed; // Update ref immediately for next synchronous call
    setParsed(newParsed);
    // CSS-mapped props already get instant visual feedback via injectLiveStyle,
    // so use a lazy 3s background recompile. All other props use the fast 300ms debounce.
    const isLiveInjectable = !!PROP_CSS_MAP[key] || !!PROP_CSS_MAP[key.replace(/^m:/, '')];
    syncVisualToCode(newParsed, undefined, isLiveInjectable ? 3000 : 300);
  };

  const handleUploadMedia = useCallback(async (componentIdx: number, propKey: string, file: File) => {
    if (!canBrowseMedia) {
      throw new Error("Select an account to upload media");
    }

    const formData = new FormData();
    formData.append("file", file);
    if (mediaPickerAccountKey) {
      formData.append("accountKey", mediaPickerAccountKey);
    } else {
      formData.append("category", "general");
    }
    const res = await fetch("/api/media", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || `Upload failed (${res.status})`,
      );
    }

    const uploadedUrl = (data as { file?: { url?: string } }).file?.url;
    if (!uploadedUrl) {
      throw new Error("Upload succeeded but no image URL was returned");
    }

    updateComponentProp(componentIdx, propKey, uploadedUrl);
  }, [canBrowseMedia, mediaPickerAccountKey, updateComponentProp]);

  const handleIconLibrarySelect = useCallback(async (selection: TemplateIconSelection) => {
    if (iconPickerComponentIdx === null || !iconPickerPropKey) return;
    const iconFile = await rasterizeSvgToPngFile(
      selection.svgMarkup,
      selection.id,
    );
    await handleUploadMedia(iconPickerComponentIdx, iconPickerPropKey, iconFile);
    handleCloseIconPicker();
  }, [
    handleCloseIconPicker,
    handleUploadMedia,
    iconPickerComponentIdx,
    iconPickerPropKey,
  ]);

  const updateFrontmatter = (key: string, value: string) => {
    if (!parsed) return;
    const newParsed = {
      ...parsed,
      frontmatter: { ...parsed.frontmatter, [key]: value },
    };
    setParsed(newParsed);
    syncVisualToCode(newParsed);
  };

  const updateBaseProp = (key: string, value: string) => {
    if (!parsed) return;
    const newBaseProps = { ...parsed.baseProps };
    if (value) {
      newBaseProps[key] = value;
    } else {
      delete newBaseProps[key];
    }
    const newParsed = { ...parsed, baseProps: newBaseProps };
    setParsed(newParsed);
    syncVisualToCode(newParsed);
  };

  // Update font on all components at once (global typography setting).
  const updateAllComponentsFont = (value: string) => {
    if (!parsed) return;
    const newComponents = parsed.components.map((comp) => {
      const newProps = { ...comp.props };
      if (value) {
        newProps.font = value;
      } else {
        delete newProps.font;
      }
      return { ...comp, props: newProps };
    });
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    syncVisualToCode(newParsed);
  };

  // Update global button style props on CTA + Hero components.
  const updateCtaComponents = (propKey: string, value: string) => {
    if (!parsed) return;
    const canonicalKey =
      CTA_PROP_ALIASES[propKey]
        ? propKey
        : (Object.entries(CTA_PROP_ALIASES).find(([, aliases]) =>
            aliases.includes(propKey),
          )?.[0] ?? propKey);
    const legacyKeys = CTA_PROP_ALIASES[canonicalKey] || [];

    const newComponents = parsed.components.map((comp) => {
      if (comp.type !== "cta" && comp.type !== "hero") return comp;
      const newProps = { ...comp.props };
      if (comp.type === "cta") {
        if (value) {
          newProps[canonicalKey] = value;
        } else {
          delete newProps[canonicalKey];
        }
        for (const legacyKey of legacyKeys) delete newProps[legacyKey];
      } else if (comp.type === "hero") {
        const heroKeys = HERO_BUTTON_PROP_MAP[canonicalKey] || [];
        for (const heroKey of heroKeys) {
          if (value) newProps[heroKey] = value;
          else delete newProps[heroKey];
        }
      }
      return { ...comp, props: newProps };
    });
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    syncVisualToCode(newParsed);
  };

  const syncVisualToCode = useCallback(
    (template: ParsedTemplate, hidden?: Set<number>, debounceMs = 300) => {
      if (!historySkipRef.current) pushHistory(code);
      historySkipRef.current = false;
      const newCode = serializeTemplateClient(template);
      setCode(newCode);
      // For preview, use marker-injected serializer
      const h = hidden ?? hiddenComponents;
      const previewCode = serializeTemplateForPreview(template, h);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(
        () => compilePreview(previewCode),
        debounceMs,
      );
    },
    [compilePreview, hiddenComponents, code, pushHistory],
  );

  const applyAiEdits = useCallback(
    (edits: AssistantComponentEdit[]) => {
      if (!parsed || edits.length === 0) return;

      // Check if any edits have componentIndex (multi-component mode)
      const hasIndexedEdits = edits.some((e) => typeof e.componentIndex === "number");

      if (hasIndexedEdits) {
        // Multi-component edit: apply each edit to its targeted component
        const nextComponents = parsed.components.map((comp, i) => {
          const matching = edits.filter((e) => e.componentIndex === i);
          if (matching.length === 0) return comp;
          const updatedProps = { ...comp.props };
          for (const edit of matching) {
            if (edit.key) updatedProps[edit.key] = edit.value;
          }
          return { ...comp, props: updatedProps };
        });

        const nextParsed = { ...parsed, components: nextComponents };
        setParsed(nextParsed);
        syncVisualToCode(nextParsed);

        const affectedCount = new Set(edits.map((e) => e.componentIndex)).size;
        setMessage(
          `Applied ${edits.length} AI edit${edits.length === 1 ? "" : "s"} across ${affectedCount} section${affectedCount === 1 ? "" : "s"}`,
        );
        setTimeout(() => setMessage(""), 3000);
      } else {
        // Legacy single-component mode: apply to selected component
        if (
          selectedComponent === null ||
          !parsed.components[selectedComponent]
        ) {
          setAiError("Select a section first, then apply AI prop edits.");
          return;
        }

        const current = parsed.components[selectedComponent];
        const updated = {
          ...current,
          props: { ...current.props },
        };

        for (const edit of edits) {
          if (!edit.key) continue;
          updated.props[edit.key] = edit.value;
        }

        const nextComponents = [...parsed.components];
        nextComponents[selectedComponent] = updated;
        const nextParsed = { ...parsed, components: nextComponents };
        setParsed(nextParsed);
        syncVisualToCode(nextParsed);

        setMessage(
          `Applied ${edits.length} AI edit${edits.length === 1 ? "" : "s"} to section ${selectedComponent + 1}`,
        );
        setTimeout(() => setMessage(""), 3000);
      }
    },
    [parsed, selectedComponent, syncVisualToCode],
  );

  const isTemplateEmpty = useCallback((): boolean => {
    if (!parsed) return true;
    const nonStructural = parsed.components.filter(
      (c) => !["header", "footer", "spacer"].includes(c.type),
    );
    return nonStructural.length === 0;
  }, [parsed]);

  const handleAiBuildTemplate = useCallback(
    (build: TemplateBuild) => {
      // Subject + preview text travel via frontmatter on the parsed
      // template — they're folded in below when the new visual template
      // is constructed.
      if (build.mode === "visual" && build.components) {
        const newComponents = build.components.map((comp) => {
          const schema = componentSchemas[comp.type];
          const defaultProps: Record<string, string> = {};
          if (schema) {
            for (const prop of schema.props) {
              if (prop.default) defaultProps[prop.key] = prop.default;
            }
          }
          return {
            type: comp.type,
            props: { ...defaultProps, ...comp.props },
          };
        });

        const newParsed: ParsedTemplate = {
          frontmatter: { ...parsed?.frontmatter, ...build.frontmatter },
          baseProps: { ...parsed?.baseProps, ...build.baseProps },
          components: newComponents,
          raw: "",
        };

        setParsed(newParsed);
        setExpandedComponents(new Set(newComponents.map((_, i) => i)));
        setSelectedComponent(null);
        syncVisualToCode(newParsed);
        setPendingAiBuild(null);
        setMessage(`AI generated ${newComponents.length} sections`);
        setTimeout(() => setMessage(""), 3000);
      } else if (build.mode === "code" && build.html) {
        setCode(build.html);
        compilePreview(build.html);
        try {
          const newParsed = parseTemplate(build.html);
          setParsed(newParsed);
        } catch {
          /* ignore parse errors in code mode */
        }
        setPendingAiBuild(null);
        setMessage("AI generated email template");
        setTimeout(() => setMessage(""), 3000);
      }
    },
    [parsed, syncVisualToCode, compilePreview],
  );

  // handleGenerateEmailMeta — the "Generate subject/preview text with AI"
  // buttons lived inside the ESP-only Email Meta settings panel, which is
  // gone. The AI endpoint `/api/ai/generate-email-meta` is still there if
  // we want to rewire it into a library-frontmatter-driven UI later.

  const handleAskAssistant = useCallback(async (promptOverride?: string) => {
    const prompt = (promptOverride ?? aiPrompt).trim();
    if (!prompt || aiLoading) return;

    setAiLoading(true);
    setAiError("");
    setAiPrompt("");

    // Add user message to history immediately for display
    const userMsg = { role: "user" as const, content: prompt };
    setAiHistory((prev) => [...prev, userMsg]);

    try {
      // Build condensed history for API (last 5 exchanges = 10 messages max)
      const apiHistory = aiHistory.slice(-10).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Build account context for AI branding awareness
      const aiAccountContext = effectiveAccountData
        ? {
            name: effectiveAccountData.dealer,
            branding: parsedBranding
              ? { colors: parsedBranding.colors, fonts: parsedBranding.fonts }
              : null,
            logos: accountLogos || null,
            customValues: (() => {
              const raw = effectiveAccountData.customValues;
              if (!raw) return null;
              const cvMap: Record<string, string> = {};
              const entries =
                typeof raw === "string"
                  ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
                  : raw;
              if (!entries || typeof entries !== "object") return null;
              for (const [k, v] of Object.entries(
                entries as Record<string, { name?: string; value?: string }>,
              )) {
                if (v && typeof v === "object" && "value" in v && v.value)
                  cvMap[k] = v.value as string;
              }
              return Object.keys(cvMap).length > 0 ? cvMap : null;
            })(),
            identity: {
              city: effectiveAccountData.city || null,
              state: effectiveAccountData.state || null,
              phone: effectiveAccountData.phone || null,
              address: effectiveAccountData.address || null,
              postalCode: effectiveAccountData.postalCode || null,
              website: effectiveAccountData.website || null,
            },
            business: {
              category: effectiveAccountData.category || null,
              email: effectiveAccountData.email || null,
              timezone: effectiveAccountData.timezone || null,
              storefrontImage: effectiveAccountData.storefrontImage || null,
              salesPhone:
                effectiveAccountData.phoneSales ||
                effectiveAccountData.salesPhone ||
                null,
              servicePhone:
                effectiveAccountData.phoneService ||
                effectiveAccountData.servicePhone ||
                null,
              partsPhone:
                effectiveAccountData.phoneParts ||
                effectiveAccountData.partsPhone ||
                null,
            },
          }
        : null;

      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          history: apiHistory,
          context: {
            design,
            template: templateName,
            mode: editorMode,
            htmlOnlyBuilder: isHtmlOnlyBuilder,
            frontmatter: parsed?.frontmatter || {},
            baseProps: parsed?.baseProps || {},
            componentCount: parsed?.components.length || 0,
            components: parsed?.components.map((c, i) => ({
              index: i,
              type: c.type,
              label: componentSchemas[c.type]?.label || c.type,
              props: c.props,
            })) || [],
            currentEmail: currentEmailContext,
            selectedComponent: selectedEditorComponent,
            account: aiAccountContext,
          },
        }),
      });

      if (!res.ok) {
        let errMsg = `AI request failed (${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch {
          // Response wasn't JSON (e.g. Next.js error page)
        }
        setAiError(errMsg);
        return;
      }

      const data = await res.json();

      const reply = typeof data.reply === "string" ? data.reply : "";
      const suggestions = Array.isArray(data.suggestions)
        ? data.suggestions.filter(
            (row: unknown): row is string => typeof row === "string",
          )
        : [];
      const componentEdits = Array.isArray(data.componentEdits)
        ? data.componentEdits
            .filter(
              (row: unknown): row is Record<string, unknown> =>
                Boolean(row) && typeof row === "object",
            )
            .map((row: Record<string, unknown>) => ({
              componentIndex: typeof row.componentIndex === "number" ? row.componentIndex : undefined,
              key: typeof row.key === "string" ? row.key : "",
              value: typeof row.value === "string" ? row.value : "",
              reason: typeof row.reason === "string" ? row.reason : undefined,
            }))
            .filter((row: AssistantComponentEdit) => row.key && row.value)
        : [];

      const templateBuild: TemplateBuild | null =
        data.templateBuild && typeof data.templateBuild === "object"
          ? (data.templateBuild as TemplateBuild)
          : null;
      const clarification: string | null =
        typeof data.clarification === "string" && data.clarification.trim()
          ? data.clarification.trim()
          : null;

      setAiReply(reply);
      setAiSuggestions(suggestions);
      setAiComponentEdits(componentEdits);

      // Add assistant response to history
      const assistantMsg = {
        role: "assistant" as const,
        content: clarification || reply,
        suggestions,
        componentEdits,
        templateBuild,
        clarification,
      };
      setAiHistory((prev) => [...prev, assistantMsg]);

      // Auto-apply component edits if they have componentIndex targeting
      if (componentEdits.length > 0 && componentEdits.some((e: AssistantComponentEdit) => typeof e.componentIndex === "number")) {
        applyAiEdits(componentEdits);
      }

      // Handle template build: auto-apply if empty, else prompt
      if (templateBuild) {
        if (isTemplateEmpty()) {
          handleAiBuildTemplate(templateBuild);
        } else {
          setPendingAiBuild(templateBuild);
        }
      }

      // Auto-scroll to bottom
      setTimeout(() => {
        aiScrollRef.current?.scrollTo({
          top: aiScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 50);
    } catch (err: any) {
      setAiError(err.message || "AI request failed");
    } finally {
      setAiLoading(false);
    }
  }, [
    aiPrompt,
    aiLoading,
    aiHistory,
    design,
    editorMode,
    parsed,
    currentEmailContext,
    selectedEditorComponent,
    templateName,
    effectiveAccountData,
    parsedBranding,
    accountLogos,
    isTemplateEmpty,
    handleAiBuildTemplate,
    applyAiEdits,
  ]);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    futureRef.current.push(code);
    historySkipRef.current = true;
    setCode(prev);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    // Re-parse for visual mode
    if (editorMode === "visual") {
      const reparsed = parseTemplate(prev);
      setParsed(reparsed);
      const previewCode = serializeTemplateForPreview(
        reparsed,
        hiddenComponents,
      );
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(
        () => compilePreview(previewCode),
        300,
      );
    } else {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(() => compilePreview(prev), 300);
    }
  }, [code, editorMode, hiddenComponents, compilePreview]);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop()!;
    historyRef.current.push(code);
    historySkipRef.current = true;
    setCode(next);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    // Re-parse for visual mode
    if (editorMode === "visual") {
      const reparsed = parseTemplate(next);
      setParsed(reparsed);
      const previewCode = serializeTemplateForPreview(
        reparsed,
        hiddenComponents,
      );
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(
        () => compilePreview(previewCode),
        300,
      );
    } else {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(() => compilePreview(next), 300);
    }
  }, [code, editorMode, hiddenComponents, compilePreview]);

  // Undo/redo keyboard shortcuts (visual mode only — Monaco has its own)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editorMode === "code") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorMode, handleUndo, handleRedo]);

  const handlePreviewComponentClick = useCallback((componentIndex: number) => {
    setSelectedComponent(componentIndex);
    // Collapse all previously expanded, then expand only the clicked one
    setExpandedComponents(new Set([componentIndex]));
    // Switch to Components tab if on Settings
    setVisualTab("components");
    // Scroll sidebar to show this component
    setTimeout(() => {
      const el = document.querySelector(
        `[data-sidebar-component="${componentIndex}"]`,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, []);

  const toggleComponent = (index: number) => {
    setExpandedComponents((prev) => {
      if (prev.has(index)) {
        // Closing the currently open component
        if (selectedComponent === index) setSelectedComponent(null);
        return new Set<number>();
      } else {
        // Open this component, close all others
        setSelectedComponent(index);
        return new Set<number>([index]);
      }
    });
  };

  const toggleComponentVisibility = (index: number) => {
    setHiddenComponents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      // Re-render preview with updated visibility
      if (parsed) {
        const previewCode = serializeTemplateClient({
          ...parsed,
          components: parsed.components.filter((_, i) => !next.has(i)),
        });
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        previewTimerRef.current = setTimeout(
          () => compilePreview(previewCode),
          300,
        );
      }
      return next;
    });
  };

  const handleAddComponent = (componentType: string) => {
    if (!parsed) return;
    const schema = componentSchemas[componentType];
    const newProps: Record<string, string> = {};
    if (schema) {
      for (const prop of schema.props) {
        if (prop.default) {
          newProps[prop.key] = prop.default;
        } else if (prop.required) {
          newProps[prop.key] = `[${prop.label}]`;
        }
      }
    }
    if (componentType === "split") {
      newProps["image-side"] = "left";
    }
    const newComponent = { type: componentType, props: newProps };
    const newComponents = [...parsed.components, newComponent];
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    setExpandedComponents(
      (prev) => new Set([...prev, newComponents.length - 1]),
    );
    setShowComponentPicker(false);
    syncVisualToCode(newParsed);
  };

  const handleDeleteComponent = (index: number) => {
    if (!parsed) return;
    const newComponents = parsed.components.filter((_, i) => i !== index);
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    const remapDelete = (oldSet: Set<number>) => {
      const next = new Set<number>();
      for (const i of oldSet) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    };
    setExpandedComponents((prev) => remapDelete(prev));
    setHiddenComponents((prev) => remapDelete(prev));
    syncVisualToCode(newParsed);
  };

  const handleDuplicateComponent = (index: number) => {
    if (!parsed) return;
    const original = parsed.components[index];
    const clone = { ...original, props: { ...original.props } };
    const newComponents = [...parsed.components];
    newComponents.splice(index + 1, 0, clone);
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    const remapInsert = (oldSet: Set<number>) => {
      const next = new Set<number>();
      for (const i of oldSet) {
        if (i <= index) next.add(i);
        else next.add(i + 1);
      }
      return next;
    };
    setExpandedComponents((prev) => remapInsert(prev));
    setHiddenComponents((prev) => remapInsert(prev));
    syncVisualToCode(newParsed);
  };

  const handleReorderComponent = (from: number, to: number) => {
    if (!parsed || from === to) return;
    const newComponents = [...parsed.components];
    const [moved] = newComponents.splice(from, 1);
    newComponents.splice(to, 0, moved);
    const newParsed = { ...parsed, components: newComponents };
    setParsed(newParsed);
    const remapSet = (oldSet: Set<number>) => {
      const next = new Set<number>();
      for (const i of oldSet) {
        let newIdx = i;
        if (i === from) {
          newIdx = to;
        } else if (from < to) {
          if (i > from && i <= to) newIdx = i - 1;
        } else {
          if (i >= to && i < from) newIdx = i + 1;
        }
        next.add(newIdx);
      }
      return next;
    };
    setExpandedComponents((prev) => remapSet(prev));
    setHiddenComponents((prev) => remapSet(prev));
    setDragIndex(null);
    setDragOverIndex(null);
    syncVisualToCode(newParsed);
  };

  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    setMessage("");
    try {
      if (!design) {
        setMessage("Save unavailable until template has a slug");
        return false;
      }
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, type: templateName, raw: code }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.slug && data.slug !== design) setDesign(data.slug);
        setOriginalCode(code);
        setMessage("Saved");
        setTimeout(() => setMessage(""), 3000);
        toast.success("Template saved!");
        return true;
      }
      setMessage("Error saving");
      toast.error("Error saving template");
      return false;
    } catch {
      setMessage("Error saving");
      toast.error("Error saving template");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── Save Template ──
  // The publish-to-ESP flow is gone with the ESP teardown. The remaining
  // surface is the Loomi library save, which the toolbar's Save button
  // triggers directly via handleSave. We keep a thin savingTemplate flag
  // wired into the toolbar's autosave status display.
  const savingTemplate = false;

  const handleRestoreVersion = async (versionId: string) => {
    const confirmed = await confirm({
      title: "Restore Version",
      message: "Restore this version? Current content will be replaced.",
      confirmLabel: "Restore",
    });
    if (!confirmed) return;
    setRestoringVersionId(versionId);
    setMessage("");
    try {
      const res = await fetch("/api/templates/history/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          design,
          type: templateName,
          versionId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.raw) {
        setMessage(data.error || "Failed to restore version");
        return;
      }

      const restoredRaw = data.raw as string;
      historyRef.current = [];
      futureRef.current = [];
      historySkipRef.current = true;
      setCanUndo(false);
      setCanRedo(false);
      setExpandedComponents(new Set());
      setHiddenComponents(new Set());
      setSelectedComponent(null);
      setCode(restoredRaw);
      setOriginalCode(restoredRaw);

      const reparsed = parseTemplate(restoredRaw);
      setParsed(reparsed);
      const previewCode = serializeTemplateForPreview(reparsed, new Set());
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(
        () => compilePreview(previewCode),
        300,
      );

      setMessage("Version restored");
      setTimeout(() => setMessage(""), 3000);
      setShowHistory(false);
      loadTemplateHistory();
    } catch {
      setMessage("Failed to restore version");
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handleCopyHtml = async (format: "compiled" | "source" | "text" = "compiled") => {
    let content = "";
    if (format === "compiled") {
      if (!previewHtml) return;
      // Re-render with pretty:true so the copied HTML is indented rather
      // than the single minified line used for the live iframe preview.
      content = previewHtml;
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html: code,
            project: "core",
            previewValues: previewVariableMap,
            pretty: true,
          }),
        });
        const data = await res.json();
        if (res.ok && data.html) content = data.html;
      } catch {
        // Network/parse failure → fall back to the minified preview HTML.
      }
    } else if (format === "source") {
      if (!code) return;
      content = code;
    } else if (format === "text") {
      if (!previewHtml) return;
      // Strip HTML tags to get plain text
      const tmp = document.createElement("div");
      tmp.innerHTML = previewHtml;
      content = tmp.textContent || tmp.innerText || "";
    }
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setShowMoreMenu(false);
    const labels = { compiled: "Compiled HTML", source: "Source Template", text: "Plain Text" };
    toast.success(`${labels[format]} copied!`);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Send Test Email ──
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSendTest, setShowSendTest] = useState(false);
  const [sendTestTo, setSendTestTo] = useState("");
  const [sendTestSubject, setSendTestSubject] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const handleSendTest = useCallback(async () => {
    const to = sendTestTo.trim();
    if (!to || !previewHtml) return;
    setSendingTest(true);
    try {
      const res = await fetch("/api/emails/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject:
            sendTestSubject.trim() ||
            parsed?.frontmatter?.title ||
            templateName ||
            "Test Email",
          html: previewHtml,
          // Routes through SendGrid when this account has a key
          // configured; the server falls back to SMTP otherwise.
          accountKey: effectiveAccountKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send test email");
        if (data.hint) toast.info(data.hint);
        return;
      }
      toast.success(
        `Test email sent to ${data.recipients} recipient${data.recipients === 1 ? "" : "s"}`,
      );
      setShowSendTest(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to send test email");
    } finally {
      setSendingTest(false);
    }
  }, [sendTestTo, sendTestSubject, previewHtml, parsed, templateName, effectiveAccountKey]);

  const historyDiff = useMemo(
    () => buildSimpleDiff(code, selectedHistoryRaw),
    [code, selectedHistoryRaw],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      // Cmd/Ctrl+S → Save
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      // Cmd/Ctrl+Shift+E → Toggle code/visual mode
      if (mod && e.shiftKey && e.key === "E") {
        e.preventDefault();
        handleModeSwitch(editorMode === "code" ? "visual" : "code");
        return;
      }
      // Cmd/Ctrl+Shift+P → Refresh preview
      if (mod && e.shiftKey && e.key === "P") {
        e.preventDefault();
        compilePreview(code);
        return;
      }
      // Cmd/Ctrl+Shift+A → Toggle AI assistant
      if (mod && e.shiftKey && e.key === "A") {
        e.preventDefault();
        setShowAiAssistant((prev) => !prev);
        return;
      }
      // Cmd/Ctrl+Shift+H → Open history
      if (mod && e.shiftKey && e.key === "H") {
        e.preventDefault();
        handleOpenHistory();
        return;
      }
      // Cmd/Ctrl + / → Show keyboard shortcuts (only when not in an input)
      if (mod && e.code === "Slash" && !isInput) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      // Escape → Close modals/panels
      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (showSendTest) {
          setShowSendTest(false);
          return;
        }
        if (showHistory) {
          setShowHistory(false);
          return;
        }
        if (showAiAssistant) {
          setShowAiAssistant(false);
          return;
        }
        if (showMissingVars) {
          setShowMissingVars(false);
          return;
        }
        if (showMoreMenu) {
          setShowMoreMenu(false);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    code,
    editorMode,
    showShortcuts,
    showSendTest,
    showHistory,
    showAiAssistant,
    showMissingVars,
    showMoreMenu,
  ]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-more-menu]")) {
        setShowMoreMenu(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showMoreMenu]);

  const adjustPreviewZoom = useCallback((delta: number) => {
    setPreviewZoom((current) =>
      Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, current + delta)),
    );
  }, []);

  const resetPreviewZoom = useCallback(() => {
    setPreviewZoom(PREVIEW_ZOOM_DEFAULT);
  }, []);

  const syncPreviewFrameWidth = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const isMobilePreview = previewWidth === "mobile";
    const frameWidth = isMobilePreview ? "375px" : "100%";
    const frameMaxWidth = isMobilePreview ? "375px" : "100%";
    const frameMinWidth = isMobilePreview ? "375px" : "0px";

    iframe.style.setProperty("width", frameWidth, "important");
    iframe.style.setProperty("max-width", frameMaxWidth, "important");
    iframe.style.setProperty("min-width", frameMinWidth, "important");

    const wrapper = iframe.parentElement as HTMLElement | null;
    if (wrapper) {
      wrapper.style.setProperty("width", frameWidth, "important");
      wrapper.style.setProperty("max-width", frameMaxWidth, "important");
      wrapper.style.setProperty("min-width", frameMinWidth, "important");
    }
  }, [previewWidth]);

  useEffect(() => {
    syncPreviewFrameWidth();
  }, [syncPreviewFrameWidth, previewHtml]);

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      syncPreviewFrameWidth();
      const doc = iframe.contentDocument;
      if (!doc) return;

      syncPreviewMobileNormalizeStyle(doc, previewWidth === "mobile");

      // Force mobile-specific media rules in the embedded preview document.
      syncPreviewMobileStyles(doc, previewWidth === "mobile");
      normalizePreviewMobileLayout(doc, previewWidth === "mobile");

      // Auto-size iframe
      const height = doc.body?.scrollHeight;
      if (height && height > 100) {
        iframe.style.height = `${height + 20}px`;
      }

      // Inject interaction styles for click-to-select
      const style = doc.createElement("style");
      style.textContent = `
        tr[data-loomi] { cursor: pointer; position: relative; }
        tr[data-loomi] > td { transition: outline-color 0.15s ease; outline: 3px solid transparent; outline-offset: -3px; }
        tr[data-loomi]:hover > td { outline-color: rgba(99, 102, 241, 0.45); }
        tr[data-loomi].loomi-selected > td { outline-color: transparent; }
        /* Don't highlight nested data-loomi elements (child rows within a component) */
        tr[data-loomi] tr[data-loomi] > td { outline: none !important; }
        tr[data-loomi] tr[data-loomi] { cursor: default; }
        .loomi-selected-overlay {
          position: absolute; top: 0; left: 0; z-index: 9998;
          border: 3px solid rgb(99, 102, 241);
          box-sizing: border-box;
          pointer-events: none;
        }
        /* Floating toolbar */
        .loomi-toolbar {
          position: absolute; top: 0; left: 0; z-index: 9999;
          display: flex; gap: 2px; padding: 2px;
          background: rgba(24, 24, 27, 0.9); border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          pointer-events: auto;
        }
        .loomi-toolbar button {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border: none; border-radius: 4px;
          background: transparent; cursor: pointer; padding: 0;
          color: rgba(255,255,255,0.7); transition: all 0.15s ease;
        }
        .loomi-toolbar button:hover { background: rgba(255,255,255,0.15); color: #fff; }
        .loomi-toolbar button.loomi-tb-delete:hover { color: #f87171; background: rgba(248,113,113,0.15); }
        .loomi-toolbar button:disabled { opacity: 0.3; cursor: default; }
        .loomi-toolbar button:disabled:hover { background: transparent; color: rgba(255,255,255,0.7); }
        .loomi-toolbar .loomi-tb-sep { width: 1px; background: rgba(255,255,255,0.15); margin: 4px 1px; }
      `;
      doc.head?.appendChild(style);

      // Create floating toolbar element
      const toolbar = doc.createElement("div");
      toolbar.className = "loomi-toolbar";
      toolbar.style.display = "none";
      toolbar.innerHTML = `
        <button class="loomi-tb-up" title="Move up">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button class="loomi-tb-down" title="Move down">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="loomi-tb-sep"></div>
        <button class="loomi-tb-duplicate" title="Duplicate section">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="loomi-tb-delete" title="Delete section">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `;
      doc.body?.appendChild(toolbar);

      const selectedOverlay = doc.createElement("div");
      selectedOverlay.className = "loomi-selected-overlay";
      selectedOverlay.style.display = "none";
      doc.body?.appendChild(selectedOverlay);

      let toolbarIdx: number | null = null;
      let toolbarHost: HTMLElement | null = null;
      let toolbarAnchor: HTMLElement | null = null;

      const findClosestLoomi = (el: HTMLElement): HTMLElement | null => {
        return el.closest("tr[data-loomi]") as HTMLElement | null;
      };

      // Helper to find outermost data-loomi ancestor
      const findOuterLoomi = (el: HTMLElement): HTMLElement | null => {
        let tr = el.closest("tr[data-loomi]") as HTMLElement | null;
        if (!tr) return null;
        let outer = tr;
        let p = tr.parentElement?.closest(
          "tr[data-loomi]",
        ) as HTMLElement | null;
        while (p) {
          outer = p;
          p = p.parentElement?.closest("tr[data-loomi]") as HTMLElement | null;
        }
        return outer;
      };

      const findComponentRootsByIndex = (idx: number): HTMLElement[] => {
        const rows = Array.from(
          doc.querySelectorAll(`tr[data-loomi="${idx}"]`),
        ) as HTMLElement[];
        if (!rows.length) return [];
        const roots = rows.filter(
          (row) =>
            !row.parentElement?.closest(`tr[data-loomi="${idx}"]`),
        );
        return roots.length > 0 ? roots : rows;
      };

      const findComponentRootByIndex = (idx: number): HTMLElement | null => {
        const roots = findComponentRootsByIndex(idx);
        return roots[0] || null;
      };

      const positionSelectedOverlayForIndex = (idx: number | null) => {
        if (idx === null || idx < 0) {
          selectedOverlay.style.display = "none";
          return;
        }

        const roots = findComponentRootsByIndex(idx);
        if (!roots.length) {
          selectedOverlay.style.display = "none";
          return;
        }

        const win = doc.defaultView;
        const scrollX = win?.scrollX ?? doc.documentElement.scrollLeft ?? 0;
        const scrollY = win?.scrollY ?? doc.documentElement.scrollTop ?? 0;

        let minLeft = Number.POSITIVE_INFINITY;
        let minTop = Number.POSITIVE_INFINITY;
        let maxRight = Number.NEGATIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;

        roots.forEach((row) => {
          const rect = row.getBoundingClientRect();
          minLeft = Math.min(minLeft, rect.left);
          minTop = Math.min(minTop, rect.top);
          maxRight = Math.max(maxRight, rect.right);
          maxBottom = Math.max(maxBottom, rect.bottom);
        });

        if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
          selectedOverlay.style.display = "none";
          return;
        }

        selectedOverlay.style.left = `${Math.round(minLeft + scrollX)}px`;
        selectedOverlay.style.top = `${Math.round(minTop + scrollY)}px`;
        selectedOverlay.style.width = `${Math.max(0, Math.round(maxRight - minLeft))}px`;
        selectedOverlay.style.height = `${Math.max(0, Math.round(maxBottom - minTop))}px`;
        selectedOverlay.style.display = "block";
      };

      const positionToolbar = (anchorEl: HTMLElement) => {
        const win = doc.defaultView;
        const scrollX = win?.scrollX ?? doc.documentElement.scrollLeft ?? 0;
        const scrollY = win?.scrollY ?? doc.documentElement.scrollTop ?? 0;
        const viewportWidth = doc.documentElement.clientWidth || win?.innerWidth || 0;
        const viewportHeight = doc.documentElement.clientHeight || win?.innerHeight || 0;
        const margin = 4;

        const anchorRect = anchorEl.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();

        let left: number;
        let top = anchorRect.top + scrollY + margin;
        // Keep controls inside the hovered component so cursor travel never leaves
        // the component hover area before reaching the toolbar.
        left = anchorRect.right + scrollX - toolbarRect.width - margin;

        const minLeft = scrollX + margin;
        const maxLeft = Math.max(
          minLeft,
          scrollX + viewportWidth - toolbarRect.width - margin,
        );
        left = Math.min(Math.max(left, minLeft), maxLeft);

        const minTop = scrollY + margin;
        const maxTop = Math.max(
          minTop,
          scrollY + viewportHeight - toolbarRect.height - margin,
        );
        top = Math.min(Math.max(top, minTop), maxTop);

        toolbar.style.left = `${Math.round(left)}px`;
        toolbar.style.top = `${Math.round(top)}px`;
      };

      const showToolbar = (
        hostTr: HTMLElement,
        idx: number,
        anchorTr: HTMLElement,
      ) => {
        toolbarIdx = idx;
        toolbarHost = hostTr;
        toolbarAnchor = anchorTr;
        doc.body?.appendChild(toolbar);
        toolbar.style.display = "flex";
        positionToolbar(anchorTr);
        const total = parsed?.components.length ?? 0;
        const upBtn = toolbar.querySelector(
          ".loomi-tb-up",
        ) as HTMLButtonElement | null;
        const downBtn = toolbar.querySelector(
          ".loomi-tb-down",
        ) as HTMLButtonElement | null;
        if (upBtn) upBtn.disabled = idx <= 0;
        if (downBtn) downBtn.disabled = idx >= total - 1;
      };

      const hideToolbar = () => {
        toolbar.style.display = "none";
        doc.body?.appendChild(toolbar);
        toolbarIdx = null;
        toolbarHost = null;
        toolbarAnchor = null;
      };

      // Hover to show toolbar
      doc.addEventListener("mouseover", (e: Event) => {
        const target = e.target as HTMLElement;
        if (toolbar.contains(target)) return;
        const closest = findClosestLoomi(target);
        const outer = findOuterLoomi(target);
        const hovered = closest || outer;
        if (!hovered) {
          hideToolbar();
          return;
        }
        const idx = parseInt(hovered.getAttribute("data-loomi") || "", 10);
        if (isNaN(idx)) return;
        const componentRoot = findComponentRootByIndex(idx) || outer || hovered;
        if (
          idx !== toolbarIdx ||
          toolbarHost !== componentRoot ||
          toolbarAnchor !== componentRoot
        ) {
          showToolbar(componentRoot, idx, componentRoot);
        } else {
          positionToolbar(componentRoot);
        }
      });

      doc.addEventListener("mouseleave", () => {
        hideToolbar();
      });

      doc.addEventListener(
        "scroll",
        () => {
          if (toolbar.style.display !== "none" && toolbarAnchor) {
            positionToolbar(toolbarAnchor);
          }
          positionSelectedOverlayForIndex(selectedComponentRef.current);
        },
        true,
      );

      // Toolbar button handlers
      toolbar
        .querySelector(".loomi-tb-duplicate")
        ?.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          if (toolbarIdx !== null) {
            const idx = toolbarIdx;
            hideToolbar();
            handleDuplicateComponent(idx);
          }
        });

      toolbar
        .querySelector(".loomi-tb-delete")
        ?.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          if (toolbarIdx !== null) {
            const idx = toolbarIdx;
            hideToolbar();
            handleDeleteComponent(idx);
          }
        });

      toolbar
        .querySelector(".loomi-tb-up")
        ?.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          if (toolbarIdx !== null && toolbarIdx > 0) {
            const idx = toolbarIdx;
            hideToolbar();
            handleReorderComponent(idx, idx - 1);
          }
        });

      toolbar
        .querySelector(".loomi-tb-down")
        ?.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          const total = parsed?.components.length ?? 0;
          if (toolbarIdx !== null && toolbarIdx < total - 1) {
            const idx = toolbarIdx;
            hideToolbar();
            handleReorderComponent(idx, idx + 1);
          }
        });

      // Attach click listener for component selection
      doc.addEventListener("click", (e: Event) => {
        const target = e.target as HTMLElement;
        if (toolbar.contains(target)) return;
        const outer = findOuterLoomi(target);
        if (!outer) return;
        const idx = parseInt(outer.getAttribute("data-loomi") || "", 10);
        if (isNaN(idx)) return;

        // Update visual selection in iframe
        doc
          .querySelectorAll("tr.loomi-selected")
          .forEach((el) => el.classList.remove("loomi-selected"));
        doc
          .querySelectorAll(`tr[data-loomi="${idx}"]`)
          .forEach((el) => el.classList.add("loomi-selected"));
        positionSelectedOverlayForIndex(idx);

        // Notify React
        handlePreviewComponentClick(idx);
      });

      // Re-apply selection if one was active before preview recompiled
      const sel = selectedComponentRef.current;
      if (sel !== null) {
        doc
          .querySelectorAll(`tr[data-loomi="${sel}"]`)
          .forEach((el) => el.classList.add("loomi-selected"));
        positionSelectedOverlayForIndex(sel);
      } else {
        positionSelectedOverlayForIndex(null);
      }
    } catch {}
  };

  // Bidirectional sync: when selectedComponent changes from sidebar, update preview highlight
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const overlay = doc.querySelector(".loomi-selected-overlay") as HTMLElement | null;
      const positionOverlayForIndex = (idx: number | null) => {
        if (!overlay) return;
        if (idx === null || idx < 0) {
          overlay.style.display = "none";
          return;
        }

        const rows = Array.from(
          doc.querySelectorAll(`tr[data-loomi="${idx}"]`),
        ) as HTMLElement[];
        const roots = rows.filter(
          (row) => !row.parentElement?.closest(`tr[data-loomi="${idx}"]`),
        );
        const targets = roots.length > 0 ? roots : rows;
        if (!targets.length) {
          overlay.style.display = "none";
          return;
        }

        const win = doc.defaultView;
        const scrollX = win?.scrollX ?? doc.documentElement.scrollLeft ?? 0;
        const scrollY = win?.scrollY ?? doc.documentElement.scrollTop ?? 0;

        let minLeft = Number.POSITIVE_INFINITY;
        let minTop = Number.POSITIVE_INFINITY;
        let maxRight = Number.NEGATIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        targets.forEach((row) => {
          const rect = row.getBoundingClientRect();
          minLeft = Math.min(minLeft, rect.left);
          minTop = Math.min(minTop, rect.top);
          maxRight = Math.max(maxRight, rect.right);
          maxBottom = Math.max(maxBottom, rect.bottom);
        });

        if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
          overlay.style.display = "none";
          return;
        }

        overlay.style.left = `${Math.round(minLeft + scrollX)}px`;
        overlay.style.top = `${Math.round(minTop + scrollY)}px`;
        overlay.style.width = `${Math.max(0, Math.round(maxRight - minLeft))}px`;
        overlay.style.height = `${Math.max(0, Math.round(maxBottom - minTop))}px`;
        overlay.style.display = "block";
      };

      doc
        .querySelectorAll("tr.loomi-selected")
        .forEach((el) => el.classList.remove("loomi-selected"));
      if (selectedComponent !== null) {
        const rows = doc.querySelectorAll(
          `tr[data-loomi="${selectedComponent}"]`,
        );
        rows.forEach((el) => el.classList.add("loomi-selected"));
        if (rows.length > 0) {
          rows[0].scrollIntoView({ behavior: "smooth", block: "center" });
        }
        positionOverlayForIndex(selectedComponent);
      } else {
        positionOverlayForIndex(null);
      }
    } catch {}
  }, [selectedComponent]);

  const slugLabel = design
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const designLabel = parsed?.frontmatter?.title || slugLabel;
  const isDragDropTemplate = useMemo(
    () => hasVisualTemplateScaffold(code),
    [code],
  );
  const canUseVisualBuilder = !isHtmlOnlyBuilder && Boolean(parsed);
  const templateTypeLabel = code.trim()
    ? ((canUseVisualBuilder && isDragDropTemplate) ? "Drag & Drop" : "HTML")
    : null;
  const isDragDropLabel = templateTypeLabel === "Drag & Drop";
  const lineCount = code.split("\n").length;
  const backHref = isAccount ? subHref("/emails") : "/templates";
  const handleBackClick = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(backHref);
  }, [backHref, router]);
  const autoSaveStatus = useMemo(() => {
    if (saving || savingTemplate) {
      return { label: "Autosaving...", tone: "saving" as const };
    }
    const trimmedMessage = message.trim();
    if (trimmedMessage) {
      const lower = trimmedMessage.toLowerCase();
      if (lower.includes("error") || lower.includes("failed")) {
        return { label: trimmedMessage, tone: "error" as const };
      }
      return { label: trimmedMessage, tone: "saved" as const };
    }
    if (hasChanges) {
      return { label: "Changes pending", tone: "pending" as const };
    }
    return { label: "Autosave on", tone: "saved" as const };
  }, [saving, savingTemplate, message, hasChanges]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      {/* Top toolbar */}
      <div className="grid grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] items-center gap-3 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleBackClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          {templateTypeLabel && (
            <span
              className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                isDragDropLabel
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-sky-500/30 bg-sky-500/10 text-sky-300"
              }`}
            >
              {templateTypeLabel}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              autoSaveStatus.tone === "error"
                ? "text-red-400"
                : autoSaveStatus.tone === "saving" || autoSaveStatus.tone === "pending"
                  ? "text-amber-400"
                  : "text-emerald-400"
            }`}
          >
            {autoSaveStatus.tone === "saving" ? (
              <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
            ) : autoSaveStatus.tone === "error" ? (
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            ) : (
              <CheckIcon className="w-3.5 h-3.5" />
            )}
            <span>{autoSaveStatus.label}</span>
          </span>
        </div>

        <div className="min-w-0 max-w-[720px] justify-self-center">
          <div className="min-w-0 text-center">
            {isEditingTitle ? (
              <input
                type="text"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                size={Math.min(
                  Math.max(
                    (editTitleValue.trim() || designLabel || "Template").length,
                    12,
                  ),
                  48,
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = editTitleValue.trim();
                    if (trimmed && parsed) {
                      updateFrontmatter("title", trimmed);
                    }
                    setIsEditingTitle(false);
                  } else if (e.key === "Escape") {
                    setIsEditingTitle(false);
                  }
                }}
                onBlur={() => {
                  const trimmed = editTitleValue.trim();
                  if (trimmed && parsed) {
                    updateFrontmatter("title", trimmed);
                  }
                  setIsEditingTitle(false);
                }}
                autoFocus
                className="max-w-[min(44rem,64vw)] rounded-xl border border-[var(--primary)] bg-[var(--background)]/80 px-4 py-1.5 text-center text-2xl font-bold text-[var(--foreground)] shadow-[0_0_0_1px_rgba(99,102,241,0.18)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
              />
            ) : (
              <h2
                role="button"
                tabIndex={0}
                onClick={() => {
                  setEditTitleValue(parsed?.frontmatter?.title || designLabel);
                  setIsEditingTitle(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditTitleValue(parsed?.frontmatter?.title || designLabel);
                    setIsEditingTitle(true);
                  }
                }}
                title="Click to rename"
                className="text-2xl font-bold truncate max-w-[40rem] mx-auto cursor-text rounded-md px-3 py-1 hover:bg-[var(--muted)] focus:outline-none focus:bg-[var(--muted)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-colors"
              >
                {designLabel}
              </h2>
            )}
            <p className="text-xs text-[var(--muted-foreground)] truncate">
              {editorMode === "code"
                ? `${lineCount} lines`
                : `${parsed?.components.length || 0} components`}
              {isHtmlOnlyBuilder && (
                <span className="text-[var(--primary)] ml-2">HTML-only builder</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 min-w-0">
          {previewContactsError && (
            <span className="text-[10px] text-amber-400 mr-1">
              {previewContactsError}
            </span>
          )}
          {/* Secondary actions consolidated into a single 3-dot menu:
              Send Test, Save as template, Change template (last two only
              in campaign-builder mode). Ask Iris removed at this level
              per UX cleanup — it lives inside the editor pane already. */}
          <div ref={manageTemplateMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowManageTemplateMenu((v) => !v)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
              title="More actions"
              aria-label="More actions"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {showManageTemplateMenu && (
              <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] glass-dropdown p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setShowManageTemplateMenu(false);
                    setSendTestSubject(
                      parsed?.frontmatter?.title || templateName || "",
                    );
                    setShowSendTest(true);
                  }}
                  disabled={!previewHtml}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send test
                  <EnvelopeIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                </button>
                {campaignIdParam && (
                  <>
                    {/* "Save as template" used to open the publish-to-ESP
                        modal. With the ESP teardown the standalone library
                        save flow is the only path, and it's already wired
                        to the Save button in the toolbar, so the dropdown
                        item is gone. Change template stays. */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowManageTemplateMenu(false);
                        router.push(
                          fromMultiBuilder
                            ? `/messaging/blasts/multi/${encodeURIComponent(campaignIdParam)}/message`
                            : `/messaging/blasts/${encodeURIComponent(campaignIdParam)}/template`,
                        );
                      }}
                      className="w-full text-left px-3 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      Change template
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {campaignIdParam ? (
            <>
              <button
                onClick={() => { void handleSave(); }}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
                title="Save template"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" fill="currentColor" className="w-4 h-4"><path d="M 7 4 C 5.3545455 4 4 5.3545455 4 7 L 4 43 C 4 44.645455 5.3545455 46 7 46 L 43 46 C 44.645455 46 46 44.645455 46 43 L 46 13.199219 A 1.0001 1.0001 0 0 0 45.707031 12.492188 L 37.507812 4.2929688 A 1.0001 1.0001 0 0 0 36.800781 4 L 7 4 z M 7 6 L 12 6 L 12 18 C 12 19.645455 13.354545 21 15 21 L 34 21 C 35.645455 21 37 19.645455 37 18 L 37 6.6132812 L 44 13.613281 L 44 43 C 44 43.554545 43.554545 44 43 44 L 38 44 L 38 29 C 38 27.354545 36.645455 26 35 26 L 15 26 C 13.354545 26 12 27.354545 12 29 L 12 44 L 7 44 C 6.4454545 44 6 43.554545 6 43 L 6 7 C 6 6.4454545 6.4454545 6 7 6 z M 14 6 L 35 6 L 35 18 C 35 18.554545 34.554545 19 34 19 L 15 19 C 14.445455 19 14 18.554545 14 18 L 14 6 z M 29 8 A 1.0001 1.0001 0 0 0 28 9 L 28 16 A 1.0001 1.0001 0 0 0 29 17 L 32 17 A 1.0001 1.0001 0 0 0 33 16 L 33 9 A 1.0001 1.0001 0 0 0 32 8 L 29 8 z M 30 10 L 31 10 L 31 15 L 30 15 L 30 10 z M 15 28 L 35 28 C 35.554545 28 36 28.445455 36 29 L 36 44 L 14 44 L 14 29 C 14 28.445455 14.445455 28 15 28 z"/></svg>
                Save Template
              </button>
              {/* In multi-channel mode the primary action is 'Done' →
                  back to the Message step, so the user still has to walk
                  through the SMS tab before the Message step's own
                  Continue-to-Schedule button lets them advance. In
                  single-channel mode it's still 'Schedule' → straight
                  to the schedule page. */}
              <button
                onClick={() =>
                  router.push(
                    fromMultiBuilder
                      ? `/messaging/blasts/multi/${encodeURIComponent(campaignIdParam)}/message`
                      : `/messaging/blasts/${encodeURIComponent(campaignIdParam)}/schedule`,
                  )
                }
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                title={fromMultiBuilder ? 'Back to Message' : 'Continue to Schedule'}
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                {fromMultiBuilder ? 'Done' : 'Schedule'}
              </button>
            </>
          ) : (
            /* Save Draft (normal editor mode) — library-only now;
                the multi-provider publish modal is gone with the ESP teardown. */
            <button
              onClick={() => { void handleSave(); }}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              title="Save draft"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" fill="currentColor" className="w-4 h-4"><path d="M 7 4 C 5.3545455 4 4 5.3545455 4 7 L 4 43 C 4 44.645455 5.3545455 46 7 46 L 43 46 C 44.645455 46 46 44.645455 46 43 L 46 13.199219 A 1.0001 1.0001 0 0 0 45.707031 12.492188 L 37.507812 4.2929688 A 1.0001 1.0001 0 0 0 36.800781 4 L 7 4 z M 7 6 L 12 6 L 12 18 C 12 19.645455 13.354545 21 15 21 L 34 21 C 35.645455 21 37 19.645455 37 18 L 37 6.6132812 L 44 13.613281 L 44 43 C 44 43.554545 43.554545 44 43 44 L 38 44 L 38 29 C 38 27.354545 36.645455 26 35 26 L 15 26 C 13.354545 26 12 27.354545 12 29 L 12 44 L 7 44 C 6.4454545 44 6 43.554545 6 43 L 6 7 C 6 6.4454545 6.4454545 6 7 6 z M 14 6 L 35 6 L 35 18 C 35 18.554545 34.554545 19 34 19 L 15 19 C 14.445455 19 14 18.554545 14 18 L 14 6 z M 29 8 A 1.0001 1.0001 0 0 0 28 9 L 28 16 A 1.0001 1.0001 0 0 0 29 17 L 32 17 A 1.0001 1.0001 0 0 0 33 16 L 33 9 A 1.0001 1.0001 0 0 0 32 8 L 29 8 z M 30 10 L 31 10 L 31 15 L 30 15 L 30 10 z M 15 28 L 35 28 C 35.554545 28 36 28.445455 36 29 L 36 44 L 14 44 L 14 29 C 14 28.445455 14.445455 28 15 28 z"/></svg>
              Save Draft
            </button>
          )}
          {/* History (clock icon only) */}
          <button
            onClick={handleOpenHistory}
            className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            title="Version History"
          >
            <ClockIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main split pane */}
      {isV2Template(code) && editorMode === "visual" ? (
        <div className="flex-1 min-h-0 flex gap-4">
          <V2EditorShell
            template={(parseV2Template(code) as EmailTemplate) ?? { version: "2", subject: "", preheader: "", settings: { bodyBg: "#f5f5f5", contentBg: "#ffffff", contentWidth: 600, fontFamily: "Helvetica, Arial, sans-serif", textColor: "#1a1a1a" }, blocks: [] }}
            onChange={(next) => handleCodeChange(JSON.stringify(next, null, 2))}
            accountKey={mediaPickerAccountKey ?? null}
            previewContacts={previewContacts}
            selectedContactId={selectedPreviewContactId}
            onSelectContact={setSelectedPreviewContactId}
            onReloadContacts={loadPreviewContacts}
            contactsLoading={previewContactsLoading}
            previewValues={previewVariableMap}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onCopyHtml={() => handleCopyHtml("compiled")}
            copied={copied}
          />
        </div>
      ) : (
      <div ref={splitPaneRef} className="flex gap-4 flex-1 min-h-0">
        {/* Left panel — Editor */}
        <div
          className="flex-shrink-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)]"
          style={{ width: `${editorPanelWidth}px` }}
        >
          {/* Tabs */}
          <div className="flex items-center border-b border-[var(--border)] bg-[var(--muted)] flex-shrink-0">
            {canUseVisualBuilder && (
              <button
                onClick={() => {
                  handleModeSwitch("visual");
                  setVisualTab("settings");
                }}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${editorMode === "visual" && visualTab === "settings" ? "border-[var(--primary)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                Settings
              </button>
            )}
            {canUseVisualBuilder && (
              <button
                onClick={() => {
                  handleModeSwitch("visual");
                  setVisualTab("components");
                }}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${editorMode === "visual" && visualTab === "components" ? "border-[var(--primary)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                <SectionsIcon className="w-3.5 h-3.5" />
                Sections
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={() => handleModeSwitch("code")}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${editorMode === "code" ? "border-[var(--primary)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              <CodeBracketIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Editor content — single scroll container */}
          {editorMode === "code" ? (
            <div className="flex-1 min-h-0">
              <CodeEditor
                value={code}
                onChange={handleCodeChange}
                language="html"
                onSave={handleSave}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-4 space-y-8">
                {/* The "Template Assignment" + ESP-specific "Email Meta"
                    panels (subject/preview text fed from the EspTemplate
                    record) were removed with the ESP teardown. Library
                    templates carry subject + preview text as part of the
                    frontmatter section below, so no replacement is needed
                    here. */}
                {visualTab === "settings" &&
                  parsed &&
                  SETTINGS_SECTIONS.map((section, sectionIdx) => (
                    <div key={section.key}>
                      <h3
                        className={`text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider ${sectionIdx > 0 ? "mt-4" : ""} mb-2`}
                      >
                        {section.label}
                      </h3>
                      <div className="space-y-3">
                        {(() => {
                          const resolveField = (f: SettingsField) => {
                            const fKey =
                              f.target === "frontmatter"
                                ? f.key.replace("fm:", "")
                                : f.key;
                            let val = "";
                            if (f.target === "frontmatter") {
                              val = parsed.frontmatter[fKey] || "";
                            } else if (f.target === "allComponentsFont") {
                              // Read font from the first component that has one
                              const firstWithFont = parsed.components.find(
                                (c) => (c.props.font || "").trim(),
                              );
                              val =
                                firstWithFont?.props.font ||
                                parsedBranding?.fonts?.body ||
                                "";
                            } else if (f.target === "ctaComponents") {
                              const firstButtonComp = parsed.components.find(
                                (c) => c.type === "cta" || c.type === "hero",
                              );
                              if (firstButtonComp?.type === "cta") {
                                val = firstButtonComp?.props[fKey] || "";
                                if (!val) {
                                  const legacyKeys = CTA_PROP_ALIASES[fKey] || [];
                                  for (const legacyKey of legacyKeys) {
                                    const legacyVal = firstButtonComp?.props[legacyKey];
                                    if (legacyVal) {
                                      val = legacyVal;
                                      break;
                                    }
                                  }
                                }
                              } else if (firstButtonComp?.type === "hero") {
                                const heroKeys = HERO_BUTTON_PROP_MAP[fKey] || [];
                                for (const heroKey of heroKeys) {
                                  const heroVal = firstButtonComp?.props[heroKey];
                                  if (heroVal) {
                                    val = heroVal;
                                    break;
                                  }
                                }
                              }
                            } else {
                              val = parsed.baseProps[fKey] || "";
                            }
                            const handleChange = (v: string) => {
                              if (f.target === "frontmatter")
                                updateFrontmatter(fKey, v);
                              else if (f.target === "allComponentsFont")
                                updateAllComponentsFont(
                                  v || parsedBranding?.fonts?.body || "",
                                );
                              else if (f.target === "ctaComponents")
                                updateCtaComponents(fKey, v);
                              else updateBaseProp(fKey, v);
                            };
                            const handleLiveStyle = (v: string) => {
                              if (f.target === "baseProps") {
                                const cssProp = PROP_CSS_MAP[fKey];
                                if (cssProp)
                                  injectLiveBaseStyle(
                                    iframeRef.current,
                                    fKey,
                                    v,
                                  );
                              } else if (
                                f.target === "allComponentsFont" &&
                                parsed
                              ) {
                                parsed.components.forEach((_c, idx) => {
                                  injectLiveStyle(
                                    iframeRef.current,
                                    idx,
                                    "font-family",
                                    v,
                                  );
                                });
                              } else if (
                                f.target === "ctaComponents" &&
                                parsed
                              ) {
                                const cssProp = PROP_CSS_MAP[fKey];
                                if (cssProp)
                                  parsed.components.forEach((c, idx) => {
                                    if (c.type === "cta")
                                      injectLiveStyle(
                                        iframeRef.current,
                                        idx,
                                        cssProp,
                                        v,
                                      );
                                  });
                              }
                            };
                            return { val, handleChange, handleLiveStyle };
                          };
                          const elements: React.ReactNode[] = [];
                          const pairHalfSettingsFields = false;
                          const isInlineSettingsField = (type: string) =>
                            type === "color" ||
                            type === "select" ||
                            type === "toggle" ||
                            type === "fontSelect";
                          let i = 0;
                          while (i < section.fields.length) {
                            const field = section.fields[i];
                            const next = section.fields[i + 1];
                            if (pairHalfSettingsFields && field.half && next?.half) {
                              const r1 = resolveField(field);
                              const r2 = resolveField(next);
                              elements.push(
                                <div
                                  key={`${field.key}-${next.key}`}
                                  className="flex gap-2"
                                >
                                  <div className="flex-1 min-w-0">
                                    <label className="text-xs text-[var(--muted-foreground)] mb-1 block">
                                      {field.label}
                                    </label>
                                    <PropField
                                      prop={field}
                                      value={r1.val}
                                      onChange={r1.handleChange}
                                      onLiveStyle={r1.handleLiveStyle}
                                      onInsertVariable={
                                        VARIABLE_ELIGIBLE_TYPES.has(field.type)
                                          ? (token: string) => r1.handleChange(r1.val + token)
                                          : undefined
                                      }
                                      brandColors={brandColors}
                                      previewAsLabel={previewAsLabel}
                                      inlineVariableOptions={inlineVariableOptions}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <label className="text-xs text-[var(--muted-foreground)] mb-1 block">
                                      {next.label}
                                    </label>
                                    <PropField
                                      prop={next}
                                      value={r2.val}
                                      onChange={r2.handleChange}
                                      onLiveStyle={r2.handleLiveStyle}
                                      onInsertVariable={
                                        VARIABLE_ELIGIBLE_TYPES.has(next.type)
                                          ? (token: string) => r2.handleChange(r2.val + token)
                                          : undefined
                                      }
                                      brandColors={brandColors}
                                      previewAsLabel={previewAsLabel}
                                      inlineVariableOptions={inlineVariableOptions}
                                    />
                                  </div>
                                </div>,
                              );
                              i += 2;
                            } else {
                              const r = resolveField(field);
                              elements.push(
                                isInlineSettingsField(field.type) ? (
                                  <div
                                    key={field.key}
                                    className="flex items-center justify-between gap-3"
                                  >
                                    <label className="min-w-0 text-xs text-[var(--muted-foreground)]">
                                      {field.label}
                                    </label>
                                    <div
                                      className={
                                        field.type === "color"
                                          ? "flex-shrink-0"
                                          : "w-[180px] max-w-[60%] flex-shrink-0"
                                      }
                                    >
                                      <PropField
                                        prop={field}
                                        value={r.val}
                                        onChange={r.handleChange}
                                        onLiveStyle={r.handleLiveStyle}
                                        onInsertVariable={
                                          VARIABLE_ELIGIBLE_TYPES.has(field.type)
                                            ? (token: string) => r.handleChange(r.val + token)
                                            : undefined
                                        }
                                        brandColors={brandColors}
                                        previewAsLabel={previewAsLabel}
                                        inlineVariableOptions={inlineVariableOptions}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div key={field.key}>
                                    <label className="text-xs text-[var(--muted-foreground)] mb-1 block">
                                      {field.label}
                                    </label>
                                    <PropField
                                      prop={field}
                                      value={r.val}
                                      onChange={r.handleChange}
                                      onLiveStyle={r.handleLiveStyle}
                                      onInsertVariable={
                                        VARIABLE_ELIGIBLE_TYPES.has(field.type)
                                          ? (token: string) => r.handleChange(r.val + token)
                                          : undefined
                                      }
                                      brandColors={brandColors}
                                      previewAsLabel={previewAsLabel}
                                      inlineVariableOptions={inlineVariableOptions}
                                    />
                                  </div>
                                ),
                              );
                              i += 1;
                            }
                          }
                          return elements;
                        })()}
                      </div>
                    </div>
                  ))}
                {/* Components sub-tab */}
                {visualTab === "components" && (
                  <div
                    className="space-y-2"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragIndex === null) return;
                      const tops = dragTopsRef.current;
                      const heights = dragHeightsRef.current;
                      if (tops.length === 0) return;
                      const y = e.clientY;
                      // Find which original slot the cursor is over
                      let target = tops.length - 1;
                      for (let i = 0; i < tops.length; i++) {
                        const mid = tops[i] + heights[i] / 2;
                        if (y < mid) {
                          target = i;
                          break;
                        }
                      }
                      if (target !== dragOverIndex) setDragOverIndex(target);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragOverIndex !== null) {
                        handleReorderComponent(dragIndex, dragOverIndex);
                      }
                    }}
                  >
                    {parsed?.components.map((comp, index) => {
                      const schema = componentSchemas[comp.type];
                      const isExpanded = expandedComponents.has(index);
                      const label = schema?.label || comp.type;
                      const iconName = schema?.icon || "DocumentIcon";

                      const setProps = Object.keys(comp.props).filter(
                        (k) => k !== "rooftop" && k !== "component-index",
                      );
                      const allSchemaProps =
                        schema?.props.filter((p) => p.key !== "rooftop" && p.key !== "component-index") || [];

                      const rawProps = schema ? null : setProps;
                      const isHidden = hiddenComponents.has(index);

                      const isDragging = dragIndex === index;

                      const isSelected = selectedComponent === index;

                      // Compute pixel-exact shift for drag animation
                      let dragTransformPx = 0;
                      if (
                        dragIndex !== null &&
                        dragOverIndex !== null &&
                        dragIndex !== dragOverIndex &&
                        index !== dragIndex
                      ) {
                        const heights = dragHeightsRef.current;
                        const gap = 8; // space-y-2 = 0.5rem = 8px
                        if (dragIndex < dragOverIndex) {
                          // Dragging down: items between shift up by dragged item's height
                          if (index > dragIndex && index <= dragOverIndex) {
                            dragTransformPx = -(heights[dragIndex] + gap);
                          }
                        } else {
                          // Dragging up: items between shift down by dragged item's height
                          if (index >= dragOverIndex && index < dragIndex) {
                            dragTransformPx = heights[dragIndex] + gap;
                          }
                        }
                      }

                      return (
                        <div
                          key={index}
                          data-sidebar-component={index}
                          draggable
                          onMouseDownCapture={(e) => {
                            dragMouseTargetRef.current = e.target as HTMLElement;
                          }}
                          onDragStart={(e) => {
                            // Prevent drag when interacting with form controls (sliders, inputs, buttons, etc.)
                            const mouseTarget = dragMouseTargetRef.current;
                            if (mouseTarget) {
                              const tag = mouseTarget.tagName.toLowerCase();
                              if (
                                tag === "input" ||
                                tag === "select" ||
                                tag === "textarea" ||
                                tag === "button" ||
                                tag === "label" ||
                                mouseTarget.isContentEditable ||
                                mouseTarget.closest("button") ||
                                mouseTarget.closest(".range-slider") ||
                                mouseTarget.closest("[data-no-component-drag]")
                              ) {
                                e.preventDefault();
                                return;
                              }
                            }
                            // Measure all item positions before drag begins
                            const items = document.querySelectorAll(
                              "[data-sidebar-component]",
                            );
                            const h: number[] = [];
                            const t: number[] = [];
                            items.forEach((el) => {
                              const rect = (
                                el as HTMLElement
                              ).getBoundingClientRect();
                              h.push(rect.height);
                              t.push(rect.top);
                            });
                            dragHeightsRef.current = h;
                            dragTopsRef.current = t;
                            setDragIndex(index);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            setDragIndex(null);
                            setDragOverIndex(null);
                          }}
                          className={`flex items-stretch gap-1 ${isHidden ? "opacity-50" : ""}`}
                          style={{
                            opacity: isDragging ? 0.3 : undefined,
                            transform: dragTransformPx
                              ? `translateY(${dragTransformPx}px)`
                              : undefined,
                            transition:
                              dragIndex !== null
                                ? "transform 200ms ease"
                                : undefined,
                          }}
                        >
                          <div className="flex items-center cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex-shrink-0 px-0.5">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="7"
                              height="12"
                              viewBox="0 0 46 80"
                              className="fill-current"
                            >
                              <path d="M0 72c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8m0-32c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8M0 8c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8m30 64c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8m0-32c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8m0-32c0-4.4 3.6-8 8-8s8 3.6 8 8s-3.6 8-8 8s-8-3.6-8-8" />
                            </svg>
                          </div>
                          <div
                            className={`flex-1 min-w-0 border rounded-xl overflow-hidden transition-all ${
                              isSelected
                                ? "border-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                                : isExpanded
                                  ? "border-[var(--primary)]"
                                  : "border-[var(--border)]"
                            }`}
                          >
                            <div
                              className={`group/comp flex items-center transition-colors ${isExpanded ? '' : 'hover:bg-[var(--muted)]'}`}
                              style={isExpanded ? { backgroundColor: 'color-mix(in srgb, var(--primary) 10%, transparent)' } : undefined}
                            >
                              <button
                                onClick={() => toggleComponent(index)}
                                className="flex-1 flex items-center gap-2 py-2.5 pl-3 pr-2 text-left cursor-pointer"
                              >
                                <ComponentIcon
                                  name={iconName}
                                  className="w-4 h-4 text-[var(--muted-foreground)]"
                                />
                                <span className="text-sm font-medium">
                                  {label}
                                </span>
                                {!isExpanded && setProps.length > 0 && (
                                  <span className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[120px] ml-auto pr-1">
                                    {comp.props["headline"] ||
                                      comp.props["body"]?.slice(0, 30) ||
                                      comp.props["button-text"] ||
                                      comp.props["size"] ||
                                      ""}
                                  </span>
                                )}
                              </button>
                              <div
                                className={`flex items-center flex-shrink-0 overflow-hidden transition-all duration-200 ${isExpanded || isHidden ? "w-auto opacity-100" : "w-0 opacity-0 group-hover/comp:w-auto group-hover/comp:opacity-100"}`}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleComponentVisibility(index);
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${isHidden ? "text-amber-400 hover:text-amber-300" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                                  title={
                                    isHidden
                                      ? "Show in preview"
                                      : "Hide from preview"
                                  }
                                >
                                  {isHidden ? (
                                    <EyeSlashIcon className="w-3.5 h-3.5" />
                                  ) : (
                                    <EyeIcon className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicateComponent(index);
                                  }}
                                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors flex-shrink-0"
                                  title="Duplicate section"
                                >
                                  <Square2StackIcon className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteComponent(index);
                                  }}
                                  className="p-1.5 mr-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                                  title="Remove section"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="p-3">
                                {schema ? (
                                  <ComponentPropsRenderer
                                    schema={schema}
                                    props={comp.props}
                                    allSchemaProps={allSchemaProps}
                                    previewWidth={previewWidth}
                                    onPropChange={(key, val) =>
                                      updateComponentProp(index, key, val)
                                    }
                                    onLiveStyle={(key, val) => {
                                      if (key === "icon-color") {
                                        injectFooterIconColor(
                                          iframeRef.current,
                                          index,
                                          val,
                                        );
                                        return;
                                      }
                                      const cssProp = PROP_CSS_MAP[key];
                                      if (cssProp)
                                        injectLiveStyle(
                                          iframeRef.current,
                                          index,
                                          cssProp,
                                          val,
                                        );
                                    }}
                                    onBrowseMedia={(propKey) =>
                                      handleBrowseMedia(index, propKey)
                                    }
                                    onBrowseIcon={(propKey) =>
                                      handleBrowseIcon(index, propKey)
                                    }
                                    onUploadMedia={(propKey, file) =>
                                      handleUploadMedia(index, propKey, file)
                                    }
                                    onInsertVariable={(propKey, token) =>
                                      updateComponentProp(index, propKey, (comp.props[propKey] || '') + token)
                                    }
                                    brandColors={brandColors}
                                    previewAsLabel={previewAsLabel}
                                    defaultFontFamily={effectiveTemplateFont}
                                    inlineVariableOptions={inlineVariableOptions}
                                    accountLogos={accountLogos}
                                  />
                                ) : (
                                  rawProps &&
                                  rawProps.map((key) => (
                                    <div key={key}>
                                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block font-mono">
                                        {key}
                                      </label>
                                      <input
                                        type="text"
                                        value={comp.props[key] || ""}
                                        onChange={(e) =>
                                          updateComponentProp(
                                            index,
                                            key,
                                            e.target.value,
                                          )
                                        }
                                        className="w-full bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                                      />
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <button
                      onClick={() => setShowComponentPicker(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed border-[var(--border)] rounded-xl text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add Section
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          role="separator"
          aria-label="Resize editor and preview panes"
          aria-orientation="vertical"
          aria-valuenow={editorPanelWidth}
          aria-valuemin={EDITOR_PANEL_MIN_WIDTH}
          aria-valuemax={EDITOR_PANEL_MAX_WIDTH}
          tabIndex={0}
          onMouseDown={handlePanelResizerMouseDown}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              adjustEditorPanelWidth(-PANEL_WIDTH_STEP_PX);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              adjustEditorPanelWidth(PANEL_WIDTH_STEP_PX);
            }
          }}
          className={`group flex-shrink-0 self-stretch w-2 -mx-1 rounded cursor-col-resize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
            isResizingPanels ? "bg-[var(--primary)]/15" : "hover:bg-[var(--muted)]"
          }`}
          title="Drag to resize editor and preview panes"
        >
          <span
            className={`mx-auto block h-full w-[2px] rounded-full transition-colors ${
              isResizingPanels
                ? "bg-[var(--primary)]"
                : "bg-[var(--border)] group-hover:bg-[var(--primary)]"
            }`}
          />
        </div>

        {/* Right panel — Preview */}
        <div className="flex-1 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--muted)] flex-shrink-0">
            {/* Left — Preview As */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--muted)]">
                <UserCircleIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                <select
                  value={selectedPreviewContactId}
                  onChange={(e) => setSelectedPreviewContactId(e.target.value)}
                  className="w-[220px] max-w-[28vw] min-w-0 bg-transparent text-xs text-[var(--foreground)] focus:outline-none"
                >
                  <option value="__sample__">Preview As: Sample</option>
                  {previewContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.fullName ||
                        [contact.firstName, contact.lastName]
                          .filter(Boolean)
                          .join(" ") ||
                        contact.email ||
                        contact.id}
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadPreviewContacts}
                  disabled={
                    !effectiveAccountKey || previewContactsLoading
                  }
                  className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
                  title={
                    effectiveAccountKey
                      ? "Refresh contacts"
                      : "Switch to a connected account to load contacts"
                  }
                >
                  <ArrowPathIcon
                    className={`w-3.5 h-3.5 ${previewContactsLoading ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
              {previewLoading && (
                <span className="text-[10px] text-amber-400 ml-1">Compiling...</span>
              )}
              {missingPreviewVars.length > 0 && (
                <div className="relative ml-1">
                  <button
                    onClick={() => setShowMissingVars(!showMissingVars)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
                    title={`${missingPreviewVars.length} variable${missingPreviewVars.length === 1 ? "" : "s"} missing data`}
                  >
                    <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold">
                      {missingPreviewVars.length}
                    </span>
                  </button>
                  {showMissingVars && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-72 glass-dropdown">
                      <div className="px-3 py-2 border-b border-[var(--border)] bg-amber-500/5 flex items-center justify-between">
                        <p className="text-xs font-semibold text-amber-400">
                          Missing Preview Data
                        </p>
                        <button
                          onClick={() => setShowMissingVars(false)}
                          className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                        {missingPreviewVars.map((varName) => (
                          <div
                            key={varName}
                            className="flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--background)]"
                          >
                            <span className="text-[10px] font-mono text-amber-300">{`{{${varName}}}`}</span>
                          </div>
                        ))}
                      </div>
                      <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--muted)]/30">
                        <p className="text-[10px] text-[var(--muted-foreground)]">
                          These variables will show as blank in the email. Select
                          a contact with this data or set values in Settings.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {lintIssues.length > 0 && (() => {
                const errorCount = lintIssues.filter((i) => i.severity === "error").length;
                const warnCount = lintIssues.filter((i) => i.severity === "warning").length;
                const tone =
                  errorCount > 0
                    ? "text-red-400 hover:bg-red-500/10"
                    : warnCount > 0
                      ? "text-amber-400 hover:bg-amber-500/10"
                      : "text-sky-400 hover:bg-sky-500/10";
                const dotTone =
                  errorCount > 0
                    ? "text-red-300"
                    : warnCount > 0
                      ? "text-amber-300"
                      : "text-sky-300";
                return (
                  <div className="relative ml-1">
                    <button
                      onClick={() => setShowLintPanel(!showLintPanel)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg transition-colors ${tone}`}
                      title={`${lintIssues.length} email lint issue${lintIssues.length === 1 ? "" : "s"}`}
                    >
                      <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold">
                        {lintIssues.length}
                      </span>
                    </button>
                    {showLintPanel && (
                      <div className="absolute left-0 top-full mt-1 z-50 w-96 glass-dropdown">
                        <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]/40 flex items-center justify-between">
                          <p className={`text-xs font-semibold ${errorCount > 0 ? "text-red-400" : warnCount > 0 ? "text-amber-400" : "text-sky-400"}`}>
                            Email Lint
                            <span className="ml-2 text-[10px] font-normal text-[var(--muted-foreground)]">
                              {errorCount > 0 && `${errorCount} error${errorCount === 1 ? "" : "s"}`}
                              {errorCount > 0 && warnCount > 0 && " · "}
                              {warnCount > 0 && `${warnCount} warning${warnCount === 1 ? "" : "s"}`}
                            </span>
                          </p>
                          <button
                            onClick={() => setShowLintPanel(false)}
                            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="max-h-96 overflow-y-auto p-2 space-y-3">
                          {Array.from(lintIssuesByCategory.entries()).map(
                            ([category, issues]) => (
                              <div key={category}>
                                <p className="text-[10px] uppercase tracking-wide font-semibold text-[var(--muted-foreground)] px-1 mb-1">
                                  {LINT_CATEGORY_LABELS[category]}
                                </p>
                                <div className="space-y-1">
                                  {issues.map((issue) => (
                                    <div
                                      key={issue.id}
                                      className="px-2 py-1.5 rounded-md bg-[var(--background)]"
                                    >
                                      <div className="flex items-start gap-2">
                                        <span
                                          className={`mt-0.5 text-[10px] leading-none ${
                                            issue.severity === "error"
                                              ? "text-red-400"
                                              : issue.severity === "warning"
                                                ? "text-amber-400"
                                                : "text-sky-400"
                                          } ${dotTone}`}
                                        >
                                          ●
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11px] font-medium text-[var(--foreground)] leading-snug">
                                            {issue.message}
                                          </p>
                                          {issue.detail && (
                                            <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5 leading-snug">
                                              {issue.detail}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                        <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--muted)]/30">
                          <p className="text-[10px] text-[var(--muted-foreground)]">
                            Static checks on the compiled HTML. They don't catch every issue — send a real test to be sure.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Center — Desktop / Mobile toggle */}
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={() => setPreviewWidth("desktop")}
                className={`p-1.5 rounded ${previewWidth === "desktop" ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                title="Desktop"
              >
                <ComputerDesktopIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPreviewWidth("mobile")}
                className={`p-1.5 rounded ${previewWidth === "mobile" ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                title="Mobile (375px)"
              >
                <DevicePhoneMobileIcon className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-[var(--border)]/70">
                <button
                  onClick={() => adjustPreviewZoom(-PREVIEW_ZOOM_STEP)}
                  disabled={previewZoom <= PREVIEW_ZOOM_MIN}
                  className="h-7 w-7 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
                  title="Zoom out"
                >
                  <span className="text-sm font-semibold leading-none">-</span>
                </button>
                <button
                  onClick={resetPreviewZoom}
                  className="h-7 min-w-[46px] px-1 rounded text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  title="Reset zoom"
                >
                  {previewZoom}%
                </button>
                <button
                  onClick={() => adjustPreviewZoom(PREVIEW_ZOOM_STEP)}
                  disabled={previewZoom >= PREVIEW_ZOOM_MAX}
                  className="h-7 w-7 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
                  title="Zoom in"
                >
                  <span className="text-sm font-semibold leading-none">+</span>
                </button>
              </div>
            </div>

            {/* Right — Undo/Redo + More menu + Refresh */}
            <div className="flex items-center justify-self-end gap-1.5">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                className="p-1.5 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
                title="Undo (⌘Z)"
              >
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                className="p-1.5 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
                title="Redo (⌘⇧Z)"
              >
                <ArrowUturnRightIcon className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-[var(--border)] mx-0.5" />
              <div className="relative" data-more-menu>
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={`p-1.5 rounded-lg transition-colors ${copied ? "text-green-400 bg-green-500/10" : "hover:bg-[var(--muted)]"}`}
                  title="More actions"
                >
                  {copied ? (
                    <CheckIcon className="w-4 h-4" />
                  ) : (
                    <EllipsisVerticalIcon className="w-4 h-4" />
                  )}
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 glass-dropdown">
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide font-semibold text-[var(--muted-foreground)]">
                      Preview Mode
                    </div>
                    <button
                      onClick={() => {
                        setPreviewColorScheme("light");
                        setShowMoreMenu(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${previewColorScheme === "light" ? "bg-[var(--accent)]/60 text-[var(--foreground)]" : "hover:bg-[var(--accent)]"}`}
                    >
                      <SunIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                      <span className="flex-1">Light</span>
                      {previewColorScheme === "light" && (
                        <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setPreviewColorScheme("dark");
                        setShowMoreMenu(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${previewColorScheme === "dark" ? "bg-[var(--accent)]/60 text-[var(--foreground)]" : "hover:bg-[var(--accent)]"}`}
                    >
                      <MoonIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                      <span className="flex-1">Dark</span>
                      {previewColorScheme === "dark" && (
                        <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
                      )}
                    </button>
                    <div className="my-1 border-t border-[var(--border)]/60" />
                    <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide font-semibold text-[var(--muted-foreground)]">
                      Copy
                    </div>
                    <button
                      onClick={() => {
                        handleCopyHtml("compiled");
                        setShowMoreMenu(false);
                      }}
                      disabled={!previewHtml}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:opacity-40 transition-colors text-left"
                    >
                      <CodeBracketIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                      Compiled HTML
                    </button>
                    <button
                      onClick={() => {
                        handleCopyHtml("source");
                        setShowMoreMenu(false);
                      }}
                      disabled={!previewHtml}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:opacity-40 transition-colors text-left"
                    >
                      <Square2StackIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                      Source Template
                    </button>
                    <button
                      onClick={() => {
                        handleCopyHtml("text");
                        setShowMoreMenu(false);
                      }}
                      disabled={!previewHtml}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:opacity-40 transition-colors text-left"
                    >
                      <DocumentArrowDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                      Plain Text
                    </button>
                  </div>
                )}
              </div>
              {/* Refresh preview */}
              <button
                onClick={() => compilePreview(code)}
                disabled={previewLoading}
                className="p-1.5 rounded-lg hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
                title="Refresh preview"
              >
                <ArrowPathIcon
                  className={`w-4 h-4 ${previewLoading ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <div
            className={`flex-1 min-h-0 overflow-y-auto overflow-x-auto flex justify-center ${previewColorScheme === "dark" ? "bg-zinc-950" : "bg-zinc-700"}`}
          >
            {previewError ? (
              <div className="max-w-md mx-auto p-6 text-center mt-8">
                <p className="text-red-400 text-sm font-medium mb-2">
                  Preview Error
                </p>
                <p className="text-xs text-zinc-400 font-mono whitespace-pre-wrap">
                  {previewError}
                </p>
              </div>
            ) : previewHtml ? (
              <div
                className="origin-top transition-all duration-150 ease-out"
                style={{
                  width: previewWidth === "mobile" ? "375px" : "100%",
                  maxWidth: previewWidth === "mobile" ? "375px" : "100%",
                  minWidth: previewWidth === "mobile" ? "375px" : "0px",
                  zoom: previewZoom / 100,
                }}
              >
                <iframe
                  ref={iframeRef}
                  key={`${previewKeyRef.current}-${previewWidth}-${previewColorScheme}`}
                  srcDoc={previewSrcDoc}
                  className="w-full border-0 block mx-auto"
                  style={{
                    minHeight: "100vh",
                  }}
                  title="Email preview"
                  sandbox="allow-same-origin"
                  onLoad={handleIframeLoad}
                />
              </div>
            ) : (
              <div className="p-8 text-center text-zinc-500 text-sm mt-8">
                <ArrowPathIcon className="w-8 h-8 mx-auto mb-3 animate-spin" />
                <p>Loading preview...</p>
              </div>
            )}
          </div>
        </div>

        {showAiAssistant && (
          <div
            data-ai-assistant-pane="true"
            className="relative w-[360px] flex-shrink-0 flex flex-col rounded-2xl overflow-hidden ai-assist-panel animate-slide-in-right"
          >
            <div className="relative z-10 flex h-full flex-col">
              {/* Header */}
              <div className="px-4 py-3 border-b border-[var(--ai-assist-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full ai-horizon-orb flex items-center justify-center">
                    <SparklesIcon className="w-3.5 h-3.5 text-zinc-900" />
                  </div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Ask Iris
                  </p>
                  <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded">
                    ⌘⇧A
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {aiHistory.length > 0 && (
                    <button
                      onClick={() => {
                        setAiHistory([]);
                        setAiReply("");
                        setAiSuggestions([]);
                        setAiComponentEdits([]);
                        setAiError("");
                        setPendingAiBuild(null);
                      }}
                      className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                      title="Clear conversation"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowAiAssistant(false)}
                    className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    title="Close AI assistant"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Context bar */}
              <div className="px-3 py-1.5 border-b border-[var(--ai-assist-border)] ai-assist-context flex items-center gap-2">
                {selectedEditorComponent ? (
                  <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                    <span className="text-[var(--foreground)] font-medium">
                      Section {selectedEditorComponent.index + 1}:
                    </span>{" "}
                    {selectedEditorComponent.label} &middot;{" "}
                    {Object.keys(selectedEditorComponent.props).length} prop
                    {Object.keys(selectedEditorComponent.props).length === 1
                      ? ""
                      : "s"}
                  </p>
                ) : (
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Select a section for prop-level suggestions
                  </p>
                )}
              </div>

              {/* Conversation thread */}
              <div
                ref={aiScrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-3 ai-assist-thread"
              >
                {/* Welcome / empty state */}
                {aiHistory.length === 0 && !aiLoading && (
                  <div className="space-y-3">
                    <div className="border border-dashed border-[var(--ai-assist-border)] rounded-xl p-3 text-center ai-assist-assistant-message">
                      <SparklesIcon className="w-5 h-5 mx-auto text-[var(--muted-foreground)] mb-1.5" />
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Build full emails, edit components, write subject lines,
                        or improve copy.
                      </p>
                    </div>
                    {/* Preset quick actions */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Build a service reminder email",
                        "Build a promotional email",
                        "Write 5 subject lines",
                        "Improve the CTA copy",
                        "Suggest a preheader",
                      ].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => {
                            handleAskAssistant(preset);
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-[var(--ai-assist-border)] text-[var(--ai-ed-text-muted)] hover:text-[var(--ai-ed-text)] hover:bg-[var(--ai-ed-hover)] transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message history */}
                {aiHistory.map((msg, idx) => (
                  <div key={`ai-msg-${idx}`}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] bg-[linear-gradient(90deg,var(--ai-hz-start),var(--ai-hz-mid),var(--ai-hz-end))] text-white rounded-xl rounded-br-sm px-3 py-2">
                          <p className="text-xs whitespace-pre-wrap">
                            {msg.content}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Reply text */}
                        {msg.content && (
                          <div className="border border-[var(--ai-assist-border)] rounded-xl rounded-bl-sm p-2.5 ai-assist-assistant-message">
                            <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">
                              {msg.content}
                            </p>
                          </div>
                        )}
                        {/* Suggestions */}
                        {msg.suggestions && msg.suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {msg.suggestions.map((suggestion, sIdx) => (
                              <button
                                key={`${suggestion}-${sIdx}`}
                                onClick={() => handleAskAssistant(suggestion)}
                                className="px-2.5 py-1.5 rounded-full text-[10px] font-medium border border-[var(--ai-assist-border)] text-[var(--ai-ed-text-muted)] hover:text-[var(--ai-ed-text)] hover:bg-[var(--ai-ed-hover)] transition-colors"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Component edits (only show on the latest assistant message) */}
                        {msg.componentEdits &&
                          msg.componentEdits.length > 0 &&
                          idx === aiHistory.length - 1 && (
                            <div className="border border-[var(--ai-assist-border)] rounded-lg p-2.5 ai-assist-assistant-message">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                                  Prop Edits
                                </p>
                                <button
                                  onClick={() =>
                                    applyAiEdits(msg.componentEdits!)
                                  }
                                  disabled={selectedComponent === null}
                                  className="ai-ed-primary-btn px-2 py-1 rounded-md text-[10px] font-semibold disabled:opacity-40 transition-all"
                                >
                                  Apply All
                                </button>
                              </div>
                              <div className="space-y-1.5">
                                {msg.componentEdits.map((edit, eIdx) => (
                                  <div
                                    key={`${edit.key}-${eIdx}`}
                                    className="border border-[var(--ai-assist-border)] rounded-md p-2 bg-[var(--muted)]"
                                  >
                                    <p className="text-[11px] font-medium text-[var(--foreground)]">
                                      {edit.key}
                                    </p>
                                    <p className="text-xs mt-1 whitespace-pre-wrap text-[var(--foreground)]">
                                      {edit.value}
                                    </p>
                                    {edit.reason && (
                                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                                        {edit.reason}
                                      </p>
                                    )}
                                    <button
                                      onClick={() => applyAiEdits([edit])}
                                      disabled={selectedComponent === null}
                                      className="ai-ed-primary-btn mt-2 px-2 py-1 rounded-md text-[10px] font-semibold disabled:opacity-40 transition-all"
                                    >
                                      Apply
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        {/* Template build result */}
                        {msg.templateBuild &&
                          msg.templateBuild.mode === "visual" &&
                          msg.templateBuild.components &&
                          idx === aiHistory.length - 1 && (
                            <div className="border border-[var(--ai-assist-border)] rounded-lg p-2.5 ai-assist-assistant-message">
                              <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
                                Generated Email
                              </p>
                              <div className="space-y-1">
                                {msg.templateBuild.components.map(
                                  (comp, cIdx) => (
                                    <div
                                      key={`build-${cIdx}`}
                                      className="flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--muted)] border border-[var(--ai-assist-border)]"
                                    >
                                      <span className="text-[10px] font-mono text-[var(--muted-foreground)]">
                                        {cIdx + 1}.
                                      </span>
                                      <span className="text-xs text-[var(--foreground)]">
                                        {comp.type}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                              {pendingAiBuild === msg.templateBuild ? (
                                <div className="mt-2.5 space-y-1.5">
                                  <p className="text-[10px] text-amber-400">
                                    Your template has {parsed?.components.length || 0} existing sections. Replace all?
                                  </p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() =>
                                        handleAiBuildTemplate(msg.templateBuild!)
                                      }
                                      className="ai-ed-primary-btn px-3 py-1.5 rounded-md text-[10px] font-semibold transition-all"
                                    >
                                      Replace
                                    </button>
                                    <button
                                      onClick={() => setPendingAiBuild(null)}
                                      className="px-3 py-1.5 rounded-md text-[10px] font-semibold border border-[var(--ai-assist-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : !pendingAiBuild && idx === aiHistory.length - 1 ? (
                                <p className="mt-2 text-[10px] text-green-400">
                                  Applied to template
                                </p>
                              ) : null}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {aiLoading && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex gap-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--ai-ed-dot)] animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--ai-ed-dot)] animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--ai-ed-dot)] animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                    <p className="text-[10px] text-[var(--muted-foreground)]">Thinking...</p>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="p-3 border-t border-[var(--ai-assist-border)] space-y-2">
                {aiError && (
                  <p className="text-xs text-[var(--destructive)] mb-1">{aiError}</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAskAssistant();
                      }
                    }}
                    placeholder="Ask anything..."
                    rows={2}
                    className="flex-1 resize-none bg-[var(--ai-ed-input)] border border-[var(--ai-assist-border)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--ai-ed-focus)] focus:ring-1 focus:ring-[var(--ai-ed-focus)] transition-colors max-h-20"
                  />
                  <button
                    onClick={() => {
                      void handleAskAssistant();
                    }}
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="ai-ed-primary-btn p-2.5 rounded-lg disabled:opacity-40 transition-all flex-shrink-0"
                    title="Send"
                  >
                    <PaperAirplaneIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="glass-modal w-[980px] h-[78vh] max-h-[780px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Template History</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Last 5 saved versions for {designLabel}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadTemplateHistory}
                  disabled={historyLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
                >
                  <ArrowPathIcon
                    className={`w-3.5 h-3.5 ${historyLoading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex">
              <div className="w-[320px] border-r border-[var(--border)] overflow-y-auto p-2 space-y-1.5">
                {historyLoading ? (
                  <p className="text-xs text-[var(--muted-foreground)] px-2 py-2">
                    Loading history...
                  </p>
                ) : historyVersions.length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] px-2 py-2">
                    No saved versions yet.
                  </p>
                ) : (
                  historyVersions.map((version) => {
                    const selected = selectedHistoryVersion?.id === version.id;
                    return (
                      <div
                        key={version.id}
                        className={`border rounded-lg p-2.5 transition-colors ${selected ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--background)]"}`}
                      >
                        <button
                          onClick={() => loadHistoryVersion(version)}
                          className="w-full text-left"
                        >
                          <p className="text-xs font-medium">
                            {formatHistoryDate(version.createdAt)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {version.createdBy && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                {version.createdBy}
                              </span>
                            )}
                            {version.createdBy && <span className="text-[10px] text-[var(--muted-foreground)] opacity-40">·</span>}
                            <span className="text-[10px] text-[var(--muted-foreground)]">
                              {formatBytes(version.size)}
                            </span>
                          </div>
                        </button>
                        <button
                          onClick={() => handleRestoreVersion(version.id)}
                          disabled={restoringVersionId === version.id}
                          className="mt-2 w-full text-center px-2 py-1.5 rounded-md text-xs font-medium bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
                        >
                          {restoringVersionId === version.id
                            ? "Restoring..."
                            : "Restore"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {!selectedHistoryVersion && (
                  <div className="h-full flex items-center justify-center text-center">
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Select a version to compare against your current editor
                      content.
                    </p>
                  </div>
                )}

                {selectedHistoryVersion && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          Comparing with{" "}
                          {formatHistoryDate(selectedHistoryVersion.createdAt)}
                        </p>
                        {!historyCompareLoading && (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {historyDiff.length} changed line
                            {historyDiff.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    </div>

                    {historyCompareLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Loading version...
                      </p>
                    ) : historyDiff.length === 0 ? (
                      <div className="p-4 border border-[var(--border)] rounded-lg bg-[var(--background)]">
                        <p className="text-sm text-[var(--muted-foreground)]">
                          No differences from current editor content.
                        </p>
                      </div>
                    ) : (
                      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[76px_1fr_1fr] gap-0 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] bg-[var(--muted)] border-b border-[var(--border)]">
                          <div className="px-2 py-1.5">Line</div>
                          <div className="px-2 py-1.5 border-l border-[var(--border)]">
                            Snapshot
                          </div>
                          <div className="px-2 py-1.5 border-l border-[var(--border)]">
                            Current
                          </div>
                        </div>
                        <div className="max-h-[480px] overflow-auto font-mono text-xs">
                          {historyDiff.slice(0, 240).map((row) => (
                            <div
                              key={`${row.line}-${row.kind}-${row.snapshot}-${row.current}`}
                              className="grid grid-cols-[76px_1fr_1fr] gap-0 border-b border-[var(--border)] last:border-b-0"
                            >
                              <div className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)]/40">
                                {row.line}
                              </div>
                              <div
                                className={`px-2 py-1.5 border-l border-[var(--border)] whitespace-pre-wrap break-words ${row.kind === "added" ? "bg-transparent" : "bg-red-500/10"}`}
                              >
                                {row.snapshot || (
                                  <span className="opacity-40">
                                    &lt;empty&gt;
                                  </span>
                                )}
                              </div>
                              <div
                                className={`px-2 py-1.5 border-l border-[var(--border)] whitespace-pre-wrap break-words ${row.kind === "removed" ? "bg-transparent" : "bg-green-500/10"}`}
                              >
                                {row.current || (
                                  <span className="opacity-40">
                                    &lt;empty&gt;
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                          {historyDiff.length > 240 && (
                            <div className="px-3 py-2 text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)]/30">
                              Showing first 240 changed lines.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section Picker Modal */}
      {showComponentPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in"
          onClick={() => setShowComponentPicker(false)}
        >
          <div
            className="glass-modal w-[420px] max-h-[520px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Section Library</h3>
                <button
                  onClick={() => setShowComponentPicker(false)}
                  className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
              {/* Tag filter pills */}
              {sectionTags && sectionTags.tags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <FunnelIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
                  <button
                    onClick={() => setPickerTag("all")}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                      pickerTag === "all"
                        ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                    }`}
                  >
                    All
                  </button>
                  {sectionTags.tags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setPickerTag(tag)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                        pickerTag === tag
                          ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/5"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {(() => {
                const filtered = getAvailableComponents().filter((schema) => {
                  // Only allow one footer per template
                  if (
                    FOOTER_TYPES.has(schema.name) &&
                    parsed?.components.some((c) => FOOTER_TYPES.has(c.type))
                  ) {
                    return false;
                  }
                  // Tag filter
                  if (pickerTag !== "all" && sectionTags) {
                    const assigned = sectionTags.assignments[schema.name] || [];
                    if (!assigned.includes(pickerTag)) return false;
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">
                      <p>No sections match this tag</p>
                      <button
                        onClick={() => setPickerTag("all")}
                        className="text-[var(--primary)] hover:underline text-xs mt-1"
                      >
                        Browse all
                      </button>
                    </div>
                  );
                }

                return filtered.map((schema) => (
                  <button
                    key={schema.name}
                    onClick={() => handleAddComponent(schema.name)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--muted)] rounded-lg transition-colors"
                  >
                    <ComponentIcon
                      name={schema.icon}
                      className="w-5 h-5 text-[var(--muted-foreground)]"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{schema.label}</div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {schema.props.length} props
                      </div>
                    </div>
                    <PlusIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="glass-modal w-[480px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <QuestionMarkCircleIcon className="w-4 h-4 text-[var(--primary)]" />
                <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
              </div>
              <button
                onClick={() => setShowShortcuts(false)}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {[
                {
                  group: "General",
                  shortcuts: [
                    { keys: ["Cmd", "S"], label: "Save template" },
                    {
                      keys: ["Cmd", "Shift", "E"],
                      label: "Toggle code / visual mode",
                    },
                    { keys: ["Cmd", "Z"], label: "Undo (visual mode)" },
                    {
                      keys: ["Cmd", "Shift", "Z"],
                      label: "Redo (visual mode)",
                    },
                    { keys: ["Esc"], label: "Close modal / panel" },
                    { keys: ["?"], label: "Show this help" },
                  ],
                },
                {
                  group: "Preview & Tools",
                  shortcuts: [
                    { keys: ["Cmd", "Shift", "P"], label: "Refresh preview" },
                    {
                      keys: ["Cmd", "Shift", "A"],
                      label: "Toggle AI assistant",
                    },
                    {
                      keys: ["Cmd", "Shift", "H"],
                      label: "Open version history",
                    },
                  ],
                },
              ].map((section) => (
                <div key={section.group}>
                  <h4 className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                    {section.group}
                  </h4>
                  <div className="space-y-1.5">
                    {section.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.label}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-xs text-[var(--foreground)]">
                          {shortcut.label}
                        </span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key) => (
                            <kbd
                              key={key}
                              className="px-1.5 py-0.5 rounded bg-[var(--muted)] border border-[var(--border)] text-[10px] font-mono text-[var(--muted-foreground)] min-w-[24px] text-center"
                            >
                              {key === "Cmd"
                                ? typeof navigator !== "undefined" &&
                                  navigator.platform?.includes("Mac")
                                  ? "\u2318"
                                  : "Ctrl"
                                : key === "Shift"
                                  ? "\u21E7"
                                  : key === "Esc"
                                    ? "Esc"
                                    : key}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* The multi-provider "Save Template" modal lived here. It bundled
          library save with publish-to-ESP, which is gone with the ESP
          teardown. The toolbar Save button now writes directly to the
          Loomi template library via handleSave. */}

      {/* Send Test Email Modal */}
      {showSendTest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => setShowSendTest(false)}
        >
          <div
            className="glass-modal w-[440px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4 text-[var(--primary)]" />
                <h3 className="text-sm font-semibold">Send Test Email</h3>
              </div>
              <button
                onClick={() => setShowSendTest(false)}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1.5">
                  To
                </label>
                <input
                  type="email"
                  value={sendTestTo}
                  onChange={(e) => setSendTestTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
                  className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
                  placeholder="you@example.com (comma-separate for multiple)"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  value={sendTestSubject}
                  onChange={(e) => setSendTestSubject(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
                  className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
                  placeholder="Subject line..."
                />
              </div>
              <p className="text-[10px] text-[var(--muted-foreground)]">
                Sends the compiled preview HTML with current preview data.
                Subject will be prefixed with [TEST].
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30">
              <button
                onClick={() => setShowSendTest(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendTest}
                disabled={!sendTestTo.trim() || sendingTest}
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                <EnvelopeIcon className="w-3.5 h-3.5" />
                {sendingTest ? "Sending..." : "Send Test"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Media Picker Modal */}
      {mediaPickerOpen && canBrowseMedia && (
        <MediaPickerModal
          accountKey={mediaPickerAccountKey}
          onSelect={handleMediaSelect}
          onClose={() => {
            setMediaPickerOpen(false);
            setMediaPickerComponentIdx(null);
            setMediaPickerPropKey(null);
          }}
        />
      )}
      {iconPickerOpen && canBrowseMedia && (
        <TemplateIconPickerModal
          onSelect={handleIconLibrarySelect}
          onClose={handleCloseIconPicker}
        />
      )}
    </div>
  );
}
