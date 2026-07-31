import { prisma } from '@/lib/prisma';
import { composeDisclaimer } from './disclaimer';
import type { AdData } from './types';

/**
 * Headless disclaimer resolution — the unattended counterpart to the
 * `DisclaimerField` React component, which composes the disclaimer in a
 * `useEffect` and so can't be reused by the worker.
 *
 * Precedence (highest first):
 *   1. The OEM offer's own fine print (`_oemDisclaimerText`) — used VERBATIM.
 *      MarketCheck's eligibility text is the manufacturer's legal language and
 *      outranks anything we'd compose.
 *   2. An explicitly requested `templateId`.
 *   3. The make-specific default `AdDisclaimerTemplate` for this offer type.
 *   4. The global (make = null) default for this offer type.
 *   5. The code-defined default in `DEFAULT_DISCLAIMER_TEMPLATES`.
 *
 * ⚠️ Steps 3–4 are a DELIBERATE divergence from the interactive form. There, the
 * template dropdown starts on "Default (<offerType>)", which is the CODE default —
 * a DB template applies only once a human picks it, so `isDefault` never actually
 * defaults anything. Unattended there's nobody to pick, and a Subaru lease ad
 * should carry Subaru's lease language, so we honour `isDefault` here. Net effect:
 * an automated ad can carry a make-specific disclaimer where a hand-built one
 * would have carried the generic default.
 */

/** The subset of an `AdDisclaimerTemplate` row this module needs. */
export interface DisclaimerTemplateRow {
  id: string;
  name: string;
  make: string | null;
  body: string;
  isDefault: boolean;
}

/**
 * Rank candidate templates the way the generator's picker does: make-specific
 * ahead of global, `isDefault` ahead of the rest, then by name. Pure.
 */
export function rankDisclaimerTemplates(rows: DisclaimerTemplateRow[]): DisclaimerTemplateRow[] {
  return [...rows].sort((a, b) => {
    const am = a.make ? 0 : 1;
    const bm = b.make ? 0 : 1;
    if (am !== bm) return am - bm;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Choose the template to compose from, given the candidates for this
 * (offerType, make). Returns null to mean "use the code-defined default".
 * Pure — the DB read happens in {@link resolveDisclaimerText}.
 */
export function pickDisclaimerTemplate(
  rows: DisclaimerTemplateRow[],
  templateId?: string,
): DisclaimerTemplateRow | null {
  if (templateId) return rows.find((r) => r.id === templateId) ?? null;
  // Only a row explicitly flagged `isDefault` may auto-apply. Without that flag
  // the code default wins — otherwise merely HAVING templates on file would
  // silently change every automated ad's legal text.
  return rankDisclaimerTemplates(rows).find((r) => r.isDefault) ?? null;
}

export interface ResolvedDisclaimer {
  text: string;
  /** Where the body came from — surfaced in run logs so a lawyer can audit it. */
  source: 'oem_verbatim' | 'db_template' | 'code_default';
  templateId: string | null;
  templateName: string | null;
}

/**
 * Compose the disclaimer for `data` with no user in the loop.
 *
 * `make` should be the vehicle make (the incentive patch stashes it as
 * `_vehMake`); it selects make-specific templates. Resilient: an unmigrated or
 * unreachable `AdDisclaimerTemplate` table degrades to the code defaults rather
 * than failing the run — the ad still gets a compliant disclaimer.
 */
export async function resolveDisclaimerText(
  data: AdData,
  opts: { make?: string; templateId?: string } = {},
): Promise<ResolvedDisclaimer> {
  // 1. The OEM's own fine print wins outright.
  const oemRaw = data._oemDisclaimer ? data._oemDisclaimerText?.trim() || '' : '';
  if (oemRaw) {
    return {
      text: composeDisclaimer(data, undefined, oemRaw),
      source: 'oem_verbatim',
      templateId: null,
      templateName: null,
    };
  }

  const offerType = data.offerType || 'custom';
  const make = (opts.make || data._vehMake || '').trim();

  let rows: DisclaimerTemplateRow[] = [];
  try {
    rows = await prisma.adDisclaimerTemplate.findMany({
      where: {
        offerType,
        isActive: true,
        OR: [{ make: null }, ...(make ? [{ make: { equals: make, mode: 'insensitive' as const } }] : [])],
      },
      select: { id: true, name: true, make: true, body: true, isDefault: true },
    });
  } catch (err) {
    console.warn('[disclaimer-resolve] template lookup failed, using code defaults:', err);
  }

  const tmpl = pickDisclaimerTemplate(rows, opts.templateId);
  return {
    text: composeDisclaimer(data, tmpl?.body),
    source: tmpl ? 'db_template' : 'code_default',
    templateId: tmpl?.id ?? null,
    templateName: tmpl?.name ?? null,
  };
}
