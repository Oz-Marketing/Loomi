'use client';

/**
 * The review queue for drafted co-op rules.
 *
 * A rule drafted from a guideline document arrives as `proposed`, and a proposal
 * enforces NOTHING until somebody here accepts it. So this panel is the gate: it is
 * the only place a machine-written rule becomes something that can hold back an ad.
 *
 * ── WHY IT IS BUILT FOR BULK ──
 *
 * The realistic unit of work is a manufacturer's prohibited-terms list: one sentence
 * introducing thirty forbidden words, which becomes thirty rules. Reviewed one at a
 * time that is thirty clicks to say the same thing thirty times, and the predictable
 * outcome is that nobody finishes. So selection is the primary interaction — per
 * rule, per group, or everything — and a decision applies to whatever is selected in
 * one request.
 *
 * ── WHY THE QUOTE IS ON SCREEN, NOT BEHIND A LINK ──
 *
 * Every proposal carries the verbatim sentence it was drawn from, already verified
 * to exist on the page it cites. Showing it inline means the reviewer's question is
 * "is this the right reading of that sentence" — which is a judgement they can make
 * in seconds — rather than "does this sentence exist", which would mean opening the
 * PDF for every row. The page link is for when the surrounding context matters.
 *
 * Grouped by rule kind because that is how the source document is shaped: the
 * prohibited words arrive together, the layout requirements arrive together, and a
 * reviewer forms one opinion per group far more often than one per rule.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpTip } from '@/components/ui/help-tip';
import { RULE_KIND_META } from '@/lib/ad-generator/coop-rule-authoring';
import {
  groupPendingByKind,
  mergeMustInclude,
  type MustIncludeRow,
} from '@/lib/ad-generator/coop-review';
import { fillableFieldKeys } from '@/lib/ad-generator/coop-draft';
import type { CoopRule, RequiredFieldEntry } from '@/lib/ad-generator/coop-rules';

/** Plain-language label for a rule kind, written for whoever is reviewing. */
const KIND_LABEL: Record<string, string> = Object.fromEntries(
  RULE_KIND_META.map((m) => [m.kind, m.label]),
);
const KIND_BLURB: Record<string, string> = Object.fromEntries(
  RULE_KIND_META.map((m) => [m.kind, m.blurb]),
);

export interface ReviewDoc {
  id: string;
  title: string;
  pageCount: number | null;
  sourceUrl: string | null;
}

/** Said plainly, because "design scope" is our word and not the reviewer's. */
const ENFORCEMENT_LABEL: Record<MustIncludeRow['enforcement'], string> = {
  design: 'checked in the template',
  data: 'required on every ad',
  both: 'checked in the template and required on every ad',
};

/** The terms a banned-phrase rule carries, if it carries a list. */
function termsOf(rule: CoopRule): string[] {
  const list = (rule as { phrases?: unknown }).phrases;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

/**
 * Just the section and page.
 *
 * A citation reads "Subaru SAF Guidelines, April 2026 (Subaru_SAF_Guidelines_2026.pdf)
 * — §6l, p.42". Repeated down sixty rows the document name is most of the pixels and
 * none of the information: every rule in the panel came from the same document, which
 * the card above already names.
 */
function shortCite(citation: string): string {
  const tail = citation.split('—').pop()?.trim();
  return tail && tail.length < citation.length ? tail : citation;
}

export function CoopRuleReview({
  make,
  packId,
  packVerified,
  rules,
  requiredFields,
  docs,
  busy,
  onRead,
  onDecided,
}: {
  make: string;
  packId: string;
  /** Unverified packs downgrade every finding to a warning — say so up front. */
  packVerified: boolean;
  /** The whole pack's rules; this component picks out the proposals itself. */
  rules: CoopRule[];
  /** Drafted "a person must fill this in" entries, reviewed the same way. */
  requiredFields?: RequiredFieldEntry[];
  docs: ReviewDoc[];
  busy: boolean;
  onRead: (doc: ReviewDoc, page: number, query: string) => void;
  onDecided: () => void;
}) {
  const pending = useMemo(() => rules.filter((r) => r.reviewState === 'proposed'), [rules]);
  // ONE list, from the two mechanisms that enforce it. See mergeMustInclude.
  const mustInclude = useMemo(
    () => mergeMustInclude(rules, requiredFields ?? [], fillableFieldKeys()),
    [rules, requiredFields],
  );
  const [incSel, setIncSel] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // Grouping and ordering live in coop-review.ts so they are testable without a DOM.
  const groups = useMemo(() => groupPendingByKind(rules), [rules]);

  if (pending.length === 0 && mustInclude.length === 0) return null;

  const docById = new Map(docs.map((d) => [d.id, d]));
  const allSelected = selected.size === pending.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /**
   * Record decisions. ONE logical operation, even when it is two requests.
   *
   * A merged row can stand for a design rule AND a data requirement, which live in
   * different places and are decided by different endpoints. That split is ours, so
   * the reviewer gets one confirmation and one refresh, not two of each — and
   * `sending` is held across both, which two separate calls would race on.
   */
  async function submit(state: 'accepted' | 'rejected', ruleIds: string[], fieldKeys: string[]) {
    if (sending || (ruleIds.length === 0 && fieldKeys.length === 0)) return;
    setSending(true);
    try {
      let applied = 0;
      let rechecks = 0;
      const notInReview: string[] = [];

      for (const [action, ids] of [
        ['review_rules', ruleIds],
        ['review_required_fields', fieldKeys],
      ] as const) {
        if (ids.length === 0) continue;
        const res = await fetch('/api/ad-generator/oem-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, packId, decisions: ids.map((ruleId) => ({ ruleId, state })) }),
        });
        const json = (await res.json()) as {
          error?: string;
          applied?: number;
          rechecksQueued?: number;
          notInReview?: string[];
        };
        if (!res.ok) throw new Error(json.error || 'Could not save the decision');
        applied += json.applied ?? ids.length;
        rechecks += json.rechecksQueued ?? 0;
        notInReview.push(...(json.notInReview ?? []));
      }

      const verb = state === 'accepted' ? 'accepted' : 'declined';
      const recheck = rechecks
        ? ` ${rechecks} template check${rechecks === 1 ? '' : 's'} will re-run.`
        : '';
      toast.success(`${applied} requirement${applied === 1 ? '' : 's'} ${verb}.${recheck}`);
      // Surfaced rather than swallowed: it means an id reached the request that was
      // never in review, which is a defect worth seeing rather than a quiet no-op.
      if (notInReview.length) {
        toast.error(`${notInReview.length} item(s) were not in review and were left alone.`);
      }
      setSelected(new Set());
      setIncSel(new Set());
      onDecided();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the decision');
    } finally {
      setSending(false);
    }
  }

  /** Merged rows: one click, whichever halves the rows carry. */
  function decideInclude(state: 'accepted' | 'rejected', rows: MustIncludeRow[]) {
    return submit(
      state,
      rows.map((r) => r.ruleId).filter((x): x is string => !!x),
      rows.map((r) => r.fieldKey).filter((x): x is string => !!x),
    );
  }

  /** Rules reviewed in the kind-grouped list. */
  function decide(state: 'accepted' | 'rejected', ids: string[]) {
    return submit(state, ids, []);
  }

  const disabled = busy || sending;

  return (
    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
          {pending.length} drafted rule{pending.length === 1 ? '' : 's'} awaiting review
          <HelpTip title="What these are">
            <p>
              Rules an AI drafted from the {make} guideline document. Each one carries the exact sentence it
              came from, already checked to exist on the page it cites.
            </p>
            <p>
              <strong>They enforce nothing.</strong> A drafted rule is invisible to every ad check until it is
              accepted here, so there is no rush and no risk in leaving them.
            </p>
            <p>
              Declining a rule keeps it on file as declined, so a later drafting pass recognizes it instead of
              proposing it again.
            </p>
            {!packVerified && (
              <p>
                This pack is not approved for enforcement yet, so even accepted rules will only warn until
                someone approves it above.
              </p>
            )}
          </HelpTip>
        </h4>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            onChange={(on) => toggleMany(pending.map((r) => r.id), on)}
            disabled={disabled}
            size="sm"
            label="Select all"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        {groups.map(({ kind, rules: list }) => {
          const ids = list.map((r) => r.id);
          const on = ids.filter((id) => selected.has(id));
          return (
            <div key={kind} className="rounded-lg border border-[var(--border)] bg-[var(--card)]/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
                <Checkbox
                  checked={on.length === ids.length}
                  indeterminate={on.length > 0 && on.length < ids.length}
                  onChange={(next) => toggleMany(ids, next)}
                  disabled={disabled}
                  size="sm"
                  label={
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--foreground)]">{KIND_LABEL[kind] ?? kind}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {list.length} rule{list.length === 1 ? '' : 's'}
                      </span>
                      <HelpTip title={KIND_LABEL[kind] ?? kind}>
                        <p>{KIND_BLURB[kind] ?? 'A manufacturer requirement.'}</p>
                      </HelpTip>
                    </span>
                  }
                />
                <button
                  onClick={() => decide('accepted', ids)}
                  disabled={disabled}
                  className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] disabled:opacity-50"
                >
                  Accept all {list.length}
                </button>
              </div>

              <ul className="divide-y divide-[var(--border)]">
                {list.map((rule) => {
                  const doc = rule.sourceDocId ? docById.get(rule.sourceDocId) : undefined;
                  return (
                    <li key={rule.id} className="flex items-start gap-2 px-2.5 py-2">
                      <div className="pt-0.5">
                        <Checkbox
                          checked={selected.has(rule.id)}
                          onChange={(next) => toggle(rule.id, next)}
                          disabled={disabled}
                          size="sm"
                          aria-label={`Select ${rule.description}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] leading-snug text-[var(--foreground)]">{rule.description}</p>
                        {/* A prohibited-terms list shows its terms rather than a
                            paragraph of prose: the terms ARE the rule, and fifty of
                            them read faster as chips than as a sentence. */}
                        {termsOf(rule).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {termsOf(rule).map((term) => (
                              <span
                                key={term}
                                className="rounded bg-[var(--muted)]/60 px-1.5 py-0.5 text-[10px] text-[var(--foreground)]"
                              >
                                {term}
                              </span>
                            ))}
                          </div>
                        )}
                        {rule.sourceQuote && (
                          <p className="mt-1 line-clamp-2 border-l-2 border-[var(--border)] pl-2 text-[11px] italic leading-snug text-[var(--muted-foreground)]">
                            &ldquo;{rule.sourceQuote}&rdquo;
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                          {rule.citation && <span>{shortCite(rule.citation)}</span>}
                          {rule.severity === 'warning' && <span>warns only</span>}
                          {doc && rule.sourcePage && (
                            <button
                              onClick={() => onRead(doc, rule.sourcePage!, rule.sourceQuote ?? '')}
                              className="inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline"
                            >
                              <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                              Open page {rule.sourcePage}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {mustInclude.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Checkbox
                checked={incSel.size === mustInclude.length}
                indeterminate={incSel.size > 0 && incSel.size < mustInclude.length}
                onChange={(on) => setIncSel(on ? new Set(mustInclude.map((r) => r.key)) : new Set())}
                disabled={disabled}
                size="sm"
                label={<span className="font-medium text-[var(--foreground)]">The ad must include</span>}
              />
              <span className="text-[var(--muted-foreground)]">{mustInclude.length}</span>
              <HelpTip title="Where each one is checked">
                <p>
                  One requirement from the document, checked wherever it can be. A figure a person fills in is
                  checked twice — the template needs somewhere to put it, and the ad needs a value. A logo or a
                  computed offer figure can only be checked in the design.
                </p>
                <p>Loomi decides which from the field; you decide whether the requirement is real.</p>
              </HelpTip>
            </span>
            <button
              onClick={() => decideInclude('accepted', mustInclude)}
              disabled={disabled}
              className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] disabled:opacity-50"
            >
              Accept all {mustInclude.length}
            </button>
          </div>

          <ul className="divide-y divide-[var(--border)]">
            {mustInclude.map((row) => {
              const doc = row.sourceDocId ? docById.get(row.sourceDocId) : undefined;
              return (
                <li key={row.key} className="flex items-start gap-2 px-2.5 py-2">
                  <div className="pt-0.5">
                    <Checkbox
                      checked={incSel.has(row.key)}
                      onChange={(on) =>
                        setIncSel((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(row.key);
                          else next.delete(row.key);
                          return next;
                        })
                      }
                      disabled={disabled}
                      size="sm"
                      aria-label={`Select ${row.field}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] leading-snug text-[var(--foreground)]">
                      <code className="rounded bg-[var(--muted)]/50 px-1 py-0.5 font-medium">{row.field}</code>{' '}
                      {row.reason}
                    </p>
                    {row.sourceQuote && (
                      <p className="mt-1 line-clamp-2 border-l-2 border-[var(--border)] pl-2 text-[11px] italic leading-snug text-[var(--muted-foreground)]">
                        &ldquo;{row.sourceQuote}&rdquo;
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                      <span>{ENFORCEMENT_LABEL[row.enforcement]}</span>
                      <span>{row.offerTypes.length ? row.offerTypes.join(', ') : 'every offer type'}</span>
                      {row.citation && <span>{shortCite(row.citation)}</span>}
                      {doc && row.sourcePage && (
                        <button
                          onClick={() => onRead(doc, row.sourcePage!, row.sourceQuote ?? '')}
                          className="inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline"
                        >
                          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                          Open page {row.sourcePage}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {incSel.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-[var(--foreground)]">{incSel.size} selected</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => decideInclude('rejected', mustInclude.filter((r) => incSel.has(r.key)))}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
                >
                  <XMarkIcon className="h-3 w-3" /> Decline
                </button>
                <button
                  onClick={() => decideInclude('accepted', mustInclude.filter((r) => incSel.has(r.key)))}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <CheckIcon className="h-3 w-3" /> Accept
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/60 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-[var(--foreground)]">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => decide('rejected', [...selected])}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
            >
              <XMarkIcon className="h-3 w-3" /> Decline
            </button>
            <button
              onClick={() => decide('accepted', [...selected])}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <CheckIcon className="h-3 w-3" /> Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
