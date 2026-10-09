import { colorsIn, isAchromatic, isRed, parseColor, toHex, type Rgb } from '../colors';
import { anchors, isImageOnlyLink, parseStyle, styleDeclarations } from '../html';
import { blockText, copySurfaces, textSurfaces, walkBlocks } from '../surfaces';
import type { DraftArtifact, DraftRule, Finding } from '../types';

/**
 * Per-OEM brand rules. Each is scoped to the account's makes in the registry,
 * so a rule here never has to ask which brand it's looking at.
 *
 * The approved creative itself is a raster image and is NOT checked: "no red"
 * binds the email around the graphic, not the pixels design delivered.
 */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Mazda ────────────────────────────────────────────────────────────────────

/** Errors: the word itself, in any form. */
const EXCLUSIVE = /\bexclusiv\w*/i;

/**
 * Warnings: phrasing that implies exclusivity without the word. Flagged for the
 * proofer rather than blocked — "VIP" is a staple of sales-event copy, and
 * whether it reads as exclusive depends on the sentence.
 */
export const MAZDA_EXCLUSIVITY_SYNONYMS = [
  'only at',
  'only from',
  'available only',
  'nowhere else',
  'anywhere else',
  'one place',
  'solely',
  'unique to',
  'members only',
  'members-only',
  'invitation only',
  'invitation-only',
  'invite only',
  'invite-only',
  'VIP',
  'private sale',
  'private event',
  'private pricing',
  'insider',
  'reserved for',
];

const SYNONYM_RES = MAZDA_EXCLUSIVITY_SYNONYMS.map((s) => ({
  phrase: s,
  re: new RegExp(`(?<![\\w-])${escapeRe(s).replace(/\s+/g, '\\s+')}(?![\\w-])`, 'i'),
}));

export const mazdaExclusivityRule: DraftRule = {
  id: 'oem.mazda.no-exclusivity',
  scope: { oems: ['Mazda'] },
  summary: 'Mazda: no "exclusive", and synonyms that imply it are flagged.',
  check(a) {
    const findings: Finding[] = [];
    for (const surface of copySurfaces(a)) {
      const hit = surface.text.match(EXCLUSIVE);
      if (hit) {
        findings.push({
          severity: 'error',
          message: `${surface.where} says "${hit[0]}". Mazda copy can't claim exclusivity.`,
          where: surface.where,
          excerpt: surface.text,
        });
      }
      for (const { phrase, re } of SYNONYM_RES) {
        if (!re.test(surface.text)) continue;
        findings.push({
          severity: 'warning',
          message: `${surface.where} says "${phrase}", which can read as an exclusivity claim. Mazda copy can't imply exclusivity.`,
          where: surface.where,
          excerpt: surface.text,
        });
      }
    }
    return findings;
  },
};

// ── Palettes (Kia, Honda) ────────────────────────────────────────────────────

const COLOR_PROPS = new Set([
  'color',
  'background-color',
  'background',
  'border',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
]);

const TEMPLATE_COLOR_PROPS = ['color', 'bgColor', 'textColor', 'borderColor'];

/**
 * Every color the email itself uses — template settings, block props, and the
 * rendered inline styles (which include each component's built-in defaults) —
 * each reported once, at the first place it appears.
 */
function colorsUsed(a: DraftArtifact): Map<string, { rgb: Rgb; where: string }> {
  const out = new Map<string, { rgb: Rgb; where: string }>();
  const consider = (value: unknown, where: string) => {
    if (typeof value !== 'string') return;
    for (const rgb of colorsIn(value)) {
      const hex = toHex(rgb);
      if (!out.has(hex)) out.set(hex, { rgb, where });
    }
  };
  const { settings } = a.template;
  consider(settings.bodyBg, 'the page background');
  consider(settings.contentBg, 'the content background');
  consider(settings.textColor, 'the base text color');
  walkBlocks(a.template.blocks, (block) => {
    for (const key of TEMPLATE_COLOR_PROPS) consider(block.props[key], `block:${block.id}`);
  });
  for (const d of styleDeclarations(a.html)) {
    if (COLOR_PROPS.has(d.prop)) consider(d.value, `rendered <${d.tag}>`);
  }
  return out;
}

function paletteFindings(
  a: DraftArtifact,
  oem: string,
  palette: string[],
  opts: { noRed?: boolean } = {},
): Finding[] {
  const allowed = new Set(palette.map((c) => toHex(parseColor(c)!)));
  const label = palette.join(', ');
  const findings: Finding[] = [];

  for (const [hex, { rgb, where }] of colorsUsed(a)) {
    if (allowed.has(hex)) continue;
    if (opts.noRed && isRed(rgb)) {
      findings.push({ severity: 'error', message: `${where} uses red (${hex}). ${oem} emails carry no red.`, where, excerpt: hex });
    } else if (isAchromatic(rgb)) {
      findings.push({
        severity: 'warning',
        message: `${where} uses the gray ${hex}. ${oem} emails use ${label} only, so confirm it reads as black or white.`,
        where,
        excerpt: hex,
      });
    } else {
      findings.push({
        severity: 'error',
        message: `${where} uses ${hex}, which is outside the ${oem} palette (${label}).`,
        where,
        excerpt: hex,
      });
    }
  }

  // A text link with no color of its own shows in the inbox's default blue.
  for (const link of anchors(a.html)) {
    if (isImageOnlyLink(link) || !link.text) continue;
    if (parseStyle(link.style).some((d) => d.prop === 'color')) continue;
    findings.push({
      severity: 'error',
      message: `Link ${link.index} ("${link.text}") has no color set, so inboxes show it in their default blue. ${oem} allows ${label}.`,
      where: `link ${link.index}`,
    });
  }
  return findings;
}

export const kiaPaletteRule: DraftRule = {
  id: 'oem.kia.palette',
  scope: { oems: ['Kia'] },
  summary: 'Kia: black and white only, no red.',
  check: (a) => paletteFindings(a, 'Kia', ['#000000', '#ffffff'], { noRed: true }),
};

export const hondaPaletteRule: DraftRule = {
  id: 'oem.honda.palette',
  scope: { oems: ['Honda'] },
  summary: 'Honda: black, white and #0079c0 only.',
  check: (a) => paletteFindings(a, 'Honda', ['#000000', '#ffffff', '#0079c0']),
};

// ── Honda name ───────────────────────────────────────────────────────────────

export const hondaNameRule: DraftRule = {
  id: 'oem.honda.no-uppercase-name',
  scope: { oems: ['Honda'] },
  summary: 'Honda: never "HONDA" in capitals — subject, preview, alt text and footer included.',
  check(a) {
    const findings: Finding[] = [];
    // Every surface, the disclaimer and footer included: "anywhere" means anywhere.
    for (const surface of textSurfaces(a)) {
      const inDisclaimer = surface.isDisclaimer
        ? " It's inside the verbatim disclaimer, so raise it with design rather than editing it."
        : '';
      if (/\bHONDA\b/.test(surface.text)) {
        findings.push({
          severity: 'error',
          message: `${surface.where} writes "HONDA" in capitals. Honda is never all-uppercase.${inDisclaimer}`,
          where: surface.where,
          excerpt: surface.text,
        });
      } else if (surface.uppercase && /\bhonda\b/i.test(surface.text)) {
        findings.push({
          severity: 'error',
          message: `${surface.where} is set to uppercase, so "Honda" displays as "HONDA".${inDisclaimer}`,
          where: surface.where,
          excerpt: surface.text,
        });
      }
    }
    return findings;
  },
};

// ── Volkswagen ───────────────────────────────────────────────────────────────

export const VW_BACKGROUND = '#eff1f5';

export const vwBackgroundRule: DraftRule = {
  id: 'oem.vw.background',
  scope: { oems: ['Volkswagen'] },
  summary: 'Volkswagen: every background is #eff1f5.',
  check(a) {
    const findings: Finding[] = [];
    const want = toHex(parseColor(VW_BACKGROUND)!);
    const consider = (value: unknown, where: string) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const rgb = parseColor(value);
      if (!rgb) return; // transparent — the background behind it shows
      if (toHex(rgb) === want) return;
      findings.push({
        severity: 'error',
        message: `${where} is ${toHex(rgb)}. Volkswagen emails use ${VW_BACKGROUND} backgrounds.`,
        where,
        excerpt: value,
      });
    };
    consider(a.template.settings.bodyBg, 'The page background');
    consider(a.template.settings.contentBg, 'The content background');
    walkBlocks(a.template.blocks, (block) => {
      if (block.type === 'section' || block.type === 'columns' || block.type === 'spacer') {
        consider(block.props.bgColor, `block:${block.id}`);
      }
    });
    return findings;
  },
};

/** Mirrors ButtonBlock: a corner falls back to `borderRadius`, then to 4. */
function cornerRadii(props: Record<string, unknown>): number[] {
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return ['borderRadiusTopLeft', 'borderRadiusTopRight', 'borderRadiusBottomRight', 'borderRadiusBottomLeft'].map(
    (k) => num(props[k]) ?? num(props.borderRadius) ?? 4,
  );
}

export const vwSquareCtaRule: DraftRule = {
  id: 'oem.vw.square-ctas',
  scope: { oems: ['Volkswagen'] },
  summary: 'Volkswagen: CTA buttons have square corners.',
  check(a) {
    const findings: Finding[] = [];
    walkBlocks(a.template.blocks, (block) => {
      if (block.type !== 'button') return;
      if (cornerRadii(block.props).every((r) => r === 0)) return;
      findings.push({
        severity: 'error',
        message: `"${blockText(block)}" has rounded corners. Volkswagen CTAs are square.`,
        where: `block:${block.id}`,
      });
    });
    return findings;
  },
};
