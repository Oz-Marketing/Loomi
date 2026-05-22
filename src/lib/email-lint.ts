/**
 * Email lint pass — scans compiled email HTML for common cross-client
 * rendering bugs and dark-mode pitfalls.
 *
 * Pure function: takes an HTML string, returns LintIssue[]. No DOM access,
 * no side effects — safe to call on every preview compile.
 */

export type LintSeverity = "error" | "warning" | "info";

export type LintCategory = "dark-mode" | "images" | "outlook" | "layout";

export interface LintIssue {
  id: string;
  severity: LintSeverity;
  category: LintCategory;
  message: string;
  detail?: string;
}

const MAX_ISSUES_PER_RULE = 5;

const RGB_HEX_BLACK = /^#0{3,6}$/i;
const RGB_HEX_WHITE = /^#f{3,6}$/i;

function dedupePush(
  issues: LintIssue[],
  seenIds: Set<string>,
  issue: LintIssue,
): void {
  if (seenIds.has(issue.id)) return;
  seenIds.add(issue.id);
  issues.push(issue);
}

function countPerRule(map: Map<string, number>, ruleId: string): number {
  const next = (map.get(ruleId) ?? 0) + 1;
  map.set(ruleId, next);
  return next;
}

function extractHeadSection(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : "";
}

function extractBodyTag(html: string): string | null {
  const match = html.match(/<body[^>]*>/i);
  return match ? match[0] : null;
}

function extractAllStyleBlocks(html: string): string {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) parts.push(m[1]);
  return parts.join("\n");
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? "";
}

function getInlineStyle(tag: string): string {
  return getAttr(tag, "style") ?? "";
}

function inlineStyleDeclares(style: string, property: string): boolean {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:`, "i");
  return re.test(style);
}

function inlineStyleValue(style: string, property: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  const m = style.match(re);
  return m ? m[1].trim() : null;
}

/* -------------------------------------------------------------------------- */
/*  Dark mode rules                                                            */
/* -------------------------------------------------------------------------- */

function checkColorSchemeMeta(
  html: string,
  issues: LintIssue[],
  seen: Set<string>,
): void {
  const head = extractHeadSection(html);
  const hasColorScheme = /<meta\s+[^>]*name\s*=\s*["']?color-scheme["']?/i.test(
    head,
  );
  const hasSupportedSchemes =
    /<meta\s+[^>]*name\s*=\s*["']?supported-color-schemes["']?/i.test(head);

  if (!hasColorScheme) {
    dedupePush(issues, seen, {
      id: "dark-mode/missing-color-scheme",
      severity: "warning",
      category: "dark-mode",
      message: "Missing <meta name=\"color-scheme\">",
      detail:
        "Add <meta name=\"color-scheme\" content=\"light dark\"> to opt in to client-controlled dark mode rendering.",
    });
  }

  if (!hasSupportedSchemes) {
    dedupePush(issues, seen, {
      id: "dark-mode/missing-supported-color-schemes",
      severity: "info",
      category: "dark-mode",
      message: "Missing <meta name=\"supported-color-schemes\">",
      detail:
        "Add <meta name=\"supported-color-schemes\" content=\"light dark\"> — used by some Outlook variants.",
    });
  }
}

function checkBodyBackground(
  html: string,
  issues: LintIssue[],
  seen: Set<string>,
): void {
  const bodyTag = extractBodyTag(html);
  if (!bodyTag) return;

  const bgAttr = getAttr(bodyTag, "bgcolor");
  const style = getInlineStyle(bodyTag);
  const hasBgColor = inlineStyleDeclares(style, "background-color");
  const hasBgShorthand = inlineStyleDeclares(style, "background");

  if (!bgAttr && !hasBgColor && !hasBgShorthand) {
    dedupePush(issues, seen, {
      id: "dark-mode/body-no-background",
      severity: "warning",
      category: "dark-mode",
      message: "<body> has no explicit background-color",
      detail:
        "Without an explicit background, Outlook.com and Gmail dark mode may invert your layout unpredictably. Set bgcolor + style=\"background-color:…\" on <body>.",
    });
  }
}

function checkHardcodedBlackWhite(
  html: string,
  issues: LintIssue[],
  seen: Set<string>,
): void {
  // Look at the consolidated style blocks for any @media (prefers-color-scheme: dark)
  // — if the email author wrote one, we assume they're handling dark mode.
  const styleBlock = extractAllStyleBlocks(html);
  const hasDarkMediaQuery = /@media[^{]*prefers-color-scheme\s*:\s*dark/i.test(
    styleBlock,
  );
  if (hasDarkMediaQuery) return;

  // Quick scan: do we have hardcoded #000/#fff anywhere in inline styles?
  const inlineColors = html.matchAll(/style\s*=\s*"([^"]*)"/gi);
  let sawHardcodedBlackText = false;
  let sawHardcodedWhiteBg = false;

  for (const m of inlineColors) {
    const style = m[1];
    const color = inlineStyleValue(style, "color");
    const bg =
      inlineStyleValue(style, "background-color") ??
      inlineStyleValue(style, "background");
    if (color && RGB_HEX_BLACK.test(color.replace(/\s/g, ""))) {
      sawHardcodedBlackText = true;
    }
    if (bg) {
      const firstToken = bg.split(/\s+/)[0];
      if (RGB_HEX_WHITE.test(firstToken)) sawHardcodedWhiteBg = true;
    }
  }

  if (sawHardcodedBlackText) {
    dedupePush(issues, seen, {
      id: "dark-mode/hardcoded-black-text",
      severity: "warning",
      category: "dark-mode",
      message: "Hardcoded black text without a dark-mode override",
      detail:
        "Body text uses #000 / #000000 with no @media (prefers-color-scheme: dark) override. On Apple Mail dark mode the text may become unreadable on dark backgrounds.",
    });
  }
  if (sawHardcodedWhiteBg) {
    dedupePush(issues, seen, {
      id: "dark-mode/hardcoded-white-bg",
      severity: "info",
      category: "dark-mode",
      message: "Hardcoded white background without a dark-mode override",
      detail:
        "A #fff background with no @media (prefers-color-scheme: dark) override means light cards will stay bright in dark mode — usually fine, but worth confirming intent.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Image rules                                                                */
/* -------------------------------------------------------------------------- */

function checkImages(
  html: string,
  issues: LintIssue[],
  seen: Set<string>,
): void {
  const imgRe = /<img\b[^>]*>/gi;
  const counts = new Map<string, number>();
  let missingAlt = 0;
  let missingWidth = 0;
  let missingDisplayBlock = 0;
  let oversized = 0;

  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];

    // Rule: missing alt
    if (getAttr(tag, "alt") === null) {
      missingAlt = countPerRule(counts, "img-missing-alt");
    }

    // Rule: missing explicit width attribute
    const widthAttr = getAttr(tag, "width");
    if (widthAttr === null) {
      missingWidth = countPerRule(counts, "img-missing-width");
    }

    // Rule: missing display:block in inline style
    const style = getInlineStyle(tag);
    if (!/display\s*:\s*block/i.test(style)) {
      missingDisplayBlock = countPerRule(counts, "img-missing-display-block");
    }

    // Rule: width > 600 without max-width:100% (hero overflow class of bugs)
    if (widthAttr) {
      const widthNum = parseInt(widthAttr, 10);
      if (
        Number.isFinite(widthNum) &&
        widthNum > 600 &&
        !/max-width\s*:\s*100%/i.test(style)
      ) {
        oversized = countPerRule(counts, "img-oversized-no-max-width");
      }
    }
  }

  if (missingAlt) {
    dedupePush(issues, seen, {
      id: "images/missing-alt",
      severity: "warning",
      category: "images",
      message: `${missingAlt} image${missingAlt === 1 ? "" : "s"} missing alt attribute`,
      detail:
        "Outlook displays the alt text when images are blocked by default. Add alt=\"\" for decorative images, otherwise describe the image.",
    });
  }
  if (missingWidth) {
    dedupePush(issues, seen, {
      id: "images/missing-width",
      severity: "error",
      category: "images",
      message: `${missingWidth} image${missingWidth === 1 ? "" : "s"} missing width attribute`,
      detail:
        "Outlook desktop ignores CSS width on <img> — without a width attribute the image renders at its natural pixel size, often breaking layout.",
    });
  }
  if (missingDisplayBlock) {
    dedupePush(issues, seen, {
      id: "images/missing-display-block",
      severity: "warning",
      category: "images",
      message: `${missingDisplayBlock} image${missingDisplayBlock === 1 ? "" : "s"} missing display:block`,
      detail:
        "Gmail and Yahoo add a small gap below inline images. Add style=\"display:block\" to remove the gap.",
    });
  }
  if (oversized) {
    dedupePush(issues, seen, {
      id: "images/oversized-no-max-width",
      severity: "error",
      category: "images",
      message: `${oversized} image${oversized === 1 ? "" : "s"} wider than 600px without max-width:100%`,
      detail:
        "Image width > 600px with no max-width:100% will overflow mobile viewports. Add style=\"max-width:100%; height:auto\" to constrain it.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Outlook rules                                                              */
/* -------------------------------------------------------------------------- */

function checkOutlookQuirks(
  html: string,
  issues: LintIssue[],
  seen: Set<string>,
): void {
  // Modern CSS layout features Outlook ignores
  const styleBlock = extractAllStyleBlocks(html);
  const allStyles = styleBlock + " " + html;
  if (/(?:^|[\s;"])display\s*:\s*(?:flex|grid|inline-flex|inline-grid)/i.test(allStyles)) {
    dedupePush(issues, seen, {
      id: "outlook/modern-layout",
      severity: "warning",
      category: "outlook",
      message: "Modern CSS layout (flex/grid) detected",
      detail:
        "Outlook desktop ignores display:flex and display:grid — your layout will collapse. Use nested <table> elements for layout instead.",
    });
  }

  if (/position\s*:\s*(?:absolute|fixed|sticky)/i.test(allStyles)) {
    dedupePush(issues, seen, {
      id: "outlook/positioned-elements",
      severity: "warning",
      category: "outlook",
      message: "position:absolute / fixed / sticky detected",
      detail:
        "Outlook (and most webmail clients) ignore positioned layouts. Anything that relies on this will render in normal document flow.",
    });
  }

  // rgba()/hsla() in styles → some Outlook variants drop the rule entirely
  const inlineStyles = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)];
  const hasRgba = inlineStyles.some((m) => /rgba?\(|hsla?\(/i.test(m[1]));
  if (hasRgba) {
    dedupePush(issues, seen, {
      id: "outlook/rgba-colors",
      severity: "info",
      category: "outlook",
      message: "rgba() / hsla() colors used in inline styles",
      detail:
        "Outlook Windows historically dropped rules containing rgba(). Modern Outlook handles it, but if you need to support Outlook 2016 or older, prefer hex (#RRGGBB) with a solid background underneath.",
    });
  }

  // <table style="background-color:…"> without bgcolor attr → Outlook may not paint
  const tableRe = /<table\b[^>]*>/gi;
  let tablesMissingBgcolor = 0;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const tag = m[0];
    const style = getInlineStyle(tag);
    const styledBg =
      inlineStyleValue(style, "background-color") ??
      inlineStyleValue(style, "background");
    if (styledBg && !getAttr(tag, "bgcolor")) {
      tablesMissingBgcolor++;
      if (tablesMissingBgcolor >= MAX_ISSUES_PER_RULE) break;
    }
  }
  if (tablesMissingBgcolor) {
    dedupePush(issues, seen, {
      id: "outlook/table-missing-bgcolor",
      severity: "warning",
      category: "outlook",
      message: `${tablesMissingBgcolor}+ <table>${tablesMissingBgcolor === 1 ? "" : "s"} with background-color but no bgcolor attribute`,
      detail:
        "Outlook prefers the bgcolor attribute over CSS background-color. Add bgcolor=\"#XXXXXX\" alongside the style for reliable rendering.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function lintEmailHtml(html: string): LintIssue[] {
  if (!html || html.length < 30) return [];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();

  try {
    checkColorSchemeMeta(html, issues, seen);
    checkBodyBackground(html, issues, seen);
    checkHardcodedBlackWhite(html, issues, seen);
    checkImages(html, issues, seen);
    checkOutlookQuirks(html, issues, seen);
  } catch {
    // Defensive: lint must never throw. A malformed template should still
    // render its preview; we just won't surface lint issues for it.
    return [];
  }

  return issues;
}

export const LINT_CATEGORY_LABELS: Record<LintCategory, string> = {
  "dark-mode": "Dark Mode",
  images: "Images",
  outlook: "Outlook",
  layout: "Layout",
};

export const LINT_SEVERITY_RANK: Record<LintSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};
