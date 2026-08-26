import { prisma } from '@/lib/prisma';
import { parseCoopPack, type CoopRule, type RequiredFieldEntry } from './coop-rules';
import { splitByReviewState } from './coop-pack-store';
import { listTemplateChecks, type TemplateCheckRow } from './coop-template-check-store';
import { listGuidelineDocs, type GuidelineDocRow } from './guideline-docs';

/**
 * Read model for the OEM guidelines + sales-events page.
 *
 * The two things the co-op team owns are the same shape — per make, versioned,
 * time-boxed, and consequential when stale — so they're reported together.
 *
 * The point of this module is the STALENESS reporting, not the listing. The
 * failure mode isn't "nobody uploaded a document", it's "an event ended and
 * nobody queued the next one", after which ads quietly stop carrying a mandated
 * mark or start being refused. So every make gets an explicit event state, and a
 * make whose event lapses soon with nothing behind it is called out.
 *
 * Server-only, read-only.
 */

const DAY = 86_400_000;
/** How far ahead to warn that an event window is closing. */
export const EVENT_EXPIRY_WARN_DAYS = 14;

export type EventState =
  /** An event is live and something follows it (or it runs past the warning horizon). */
  | 'covered'
  /** Live, but ends within the warning window with nothing queued after it. */
  | 'ending_soon'
  /** Nothing live now, but a future event is queued. */
  | 'upcoming'
  /** Nothing live and nothing queued. */
  | 'none';

export interface EventRow {
  id: string;
  name: string;
  logoUrl: string;
  effectiveFrom: string;
  effectiveTo: string;
  required: boolean;
  offerTypes: string[];
  isActive: boolean;
  /** Relative to now: past | live | future. */
  phase: 'past' | 'live' | 'future';
  daysRemaining: number | null;
}

export interface PackRow {
  id: string;
  version: string;
  source: string | null;
  sourceUrl: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  isActive: boolean;
  /** ACCEPTED rules — what is actually enforced. */
  ruleCount: number;
  /** Drafted rules awaiting a human decision. Enforced by nothing. */
  proposedCount: number;
  /** Rules already declined. Kept so a later pass doesn't re-propose them. */
  rejectedCount: number;
  /** Rules that report but cannot block, so the page can say how much is live.
   *  Counted over ACCEPTED rules only — a proposal blocks and warns nothing. */
  warningCount: number;
  errorCount: number;
  updatedAt: string;
  /** The rules themselves, so the editor can open an existing pack. Parsed here
   *  rather than shipping the raw JSON string, so a corrupt row reads as an
   *  empty pack instead of breaking the page. */
  rules: CoopRule[];
  /** Drafted required-field entries, for the review queue. */
  requiredFields: RequiredFieldEntry[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface MakeAssets {
  make: string;
  packs: PackRow[];
  events: EventRow[];
  eventState: EventState;
  /** One line explaining the event state, for the page and for run logs. */
  eventSummary: string;
  /** True when no pack for this make is verified — nothing can reach `ready`. */
  unverified: boolean;
  /** The registered guideline documents, with their state. */
  docs: GuidelineDocRow[];
  /** True when a document was recently reissued or has become unreachable. */
  docsChanged: boolean;
  /** Per-template layout verdicts against this make's pack. */
  templateChecks: TemplateCheckRow[];
}

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function countBySeverity(rules: CoopRule[]): { errorCount: number; warningCount: number } {
  let errorCount = 0;
  let warningCount = 0;
  for (const r of rules) {
    if (r.severity === 'error') errorCount++;
    else warningCount++;
  }
  return { errorCount, warningCount };
}

/**
 * Classify a make's event calendar and say what it means in one line.
 *
 * Takes no clock: `phase` and `daysRemaining` are resolved against `now` once, in
 * `toEventRow`, so this stays a pure function of already-dated rows.
 */
export function classifyEvents(events: EventRow[]): { state: EventState; summary: string } {
  const live = events.filter((e) => e.isActive && e.phase === 'live');
  const future = events.filter((e) => e.isActive && e.phase === 'future');

  if (live.length === 0) {
    if (future.length > 0) {
      const next = future.reduce((a, b) => (a.effectiveFrom < b.effectiveFrom ? a : b));
      return { state: 'upcoming', summary: `No event live. "${next.name}" starts ${next.effectiveFrom}.` };
    }
    return {
      state: 'none',
      summary: 'No event live and none queued. Correct if this OEM is between campaigns.',
    };
  }

  const soonest = live.reduce((a, b) => ((a.daysRemaining ?? 0) < (b.daysRemaining ?? 0) ? a : b));
  const remaining = soonest.daysRemaining ?? 0;
  if (remaining <= EVENT_EXPIRY_WARN_DAYS && future.length === 0) {
    return {
      state: 'ending_soon',
      // This is the case worth catching: ads keep generating, silently without a
      // mark the OEM mandates — or refused outright if the event is `required`.
      summary: `"${soonest.name}" ends in ${remaining} day(s) and nothing follows it. Queue the next mark or ads will lose it.`,
    };
  }
  return {
    state: 'covered',
    summary: `"${soonest.name}" is live${
      remaining > 0 ? ` for another ${remaining} day(s)` : ''
    }${future.length ? `, then ${future.length} queued` : ''}.`,
  };
}

function toEventRow(r: {
  id: string;
  name: string;
  logoUrl: string;
  effectiveFrom: Date;
  effectiveTo: Date;
  required: boolean;
  offerTypes: string | null;
  isActive: boolean;
}, now: Date): EventRow {
  const from = r.effectiveFrom.getTime();
  const to = r.effectiveTo.getTime();
  const t = now.getTime();
  const phase: EventRow['phase'] = t < from ? 'future' : t > to ? 'past' : 'live';
  return {
    id: r.id,
    name: r.name,
    logoUrl: r.logoUrl,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: r.effectiveTo.toISOString().slice(0, 10),
    required: r.required,
    offerTypes: jsonArray(r.offerTypes),
    isActive: r.isActive,
    phase,
    daysRemaining: phase === 'live' ? Math.max(0, Math.floor((to - t) / DAY)) : null,
  };
}

/**
 * Everything the page shows, grouped by make. Makes appear if they have a pack, an
 * event, or an automation config pointed at them — so a brand being automated with
 * neither asset on file still shows up rather than silently missing.
 */
export async function buildOemAssetsReport(now = new Date()): Promise<MakeAssets[]> {
  const [packRows, eventRows, configRows, accountRows, docRows, checkRows] = await Promise.all([
    prisma.adCoopRulePack.findMany({ orderBy: [{ make: 'asc' }, { version: 'desc' }] }).catch(() => []),
    prisma.adOemEventAsset.findMany({ orderBy: [{ make: 'asc' }, { effectiveFrom: 'desc' }] }).catch(() => []),
    prisma.adAutomationConfig.findMany({ select: { makes: true } }).catch(() => []),
    prisma.account.findMany({ where: { oem: { not: null } }, select: { oem: true } }).catch(() => []),
    listGuidelineDocs(),
    listTemplateChecks(),
  ]);

  const makes = new Set<string>();
  const norm = (m: string) => m.trim();
  for (const p of packRows) makes.add(norm(p.make));
  for (const e of eventRows) makes.add(norm(e.make));
  for (const c of configRows) for (const m of jsonArray(c.makes)) if (m.trim()) makes.add(norm(m));
  for (const a of accountRows) if (a.oem?.trim()) makes.add(norm(a.oem));
  // A document on file for a make with no pack still has to show up: "we hold the
  // guidelines but transcribed nothing" is a state worth seeing, not hiding.
  for (const d of docRows) makes.add(norm(d.make));

  const out: MakeAssets[] = [];
  for (const make of [...makes].sort((a, b) => a.localeCompare(b))) {
    const lower = make.toLowerCase();
    const packs: PackRow[] = packRows
      .filter((p) => p.make.trim().toLowerCase() === lower)
      .map((p) => {
        const parsed = parseCoopPack(p.rules);
        // Severity is counted over ACCEPTED rules: "8 errors" has to mean eight
        // things that can block an ad, not eight things someone might accept later.
        const split = parsed ? splitByReviewState(parsed) : null;
        const counts = countBySeverity(split?.accepted.rules ?? []);
        return {
          id: p.id,
          version: p.version,
          source: p.source,
          sourceUrl: p.sourceUrl,
          verified: p.verified,
          verifiedBy: p.verifiedBy,
          verifiedAt: p.verifiedAt?.toISOString() ?? null,
          isActive: p.isActive,
          ruleCount: split?.accepted.rules.length ?? 0,
          proposedCount: split?.proposedCount ?? 0,
          rejectedCount: split?.rejectedCount ?? 0,
          ...counts,
          updatedAt: p.updatedAt.toISOString(),
          rules: parsed?.rules ?? [],
          requiredFields: parsed?.requiredFields ?? [],
          effectiveFrom: p.effectiveFrom?.toISOString().slice(0, 10) ?? null,
          effectiveTo: p.effectiveTo?.toISOString().slice(0, 10) ?? null,
        };
      });

    const events = eventRows
      .filter((e) => e.make.trim().toLowerCase() === lower)
      .map((e) => toEventRow(e, now));
    const { state, summary } = classifyEvents(events);

    const docs = docRows.filter((d) => d.make.trim().toLowerCase() === lower);
    out.push({
      make,
      packs,
      events,
      eventState: state,
      eventSummary: summary,
      unverified: packs.length === 0 || !packs.some((p) => p.verified && p.isActive),
      docs,
      // 'unreachable' counts as needing attention too — a document we can no longer
      // fetch is one whose citations can't be checked.
      docsChanged: docs.some((d) => d.state === 'updated' || d.state === 'unreachable'),
      templateChecks: checkRows.filter((c) => c.make.trim().toLowerCase() === lower),
    });
  }
  return out;
}
