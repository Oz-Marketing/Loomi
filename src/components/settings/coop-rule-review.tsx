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
import { groupPendingByKind } from '@/lib/ad-generator/coop-review';
import type { CoopRule } from '@/lib/ad-generator/coop-rules';

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

export function CoopRuleReview({
  make,
  packId,
  packVerified,
  rules,
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
  docs: ReviewDoc[];
  busy: boolean;
  onRead: (doc: ReviewDoc, page: number, query: string) => void;
  onDecided: () => void;
}) {
  const pending = useMemo(() => rules.filter((r) => r.reviewState === 'proposed'), [rules]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // Grouping and ordering live in coop-review.ts so they are testable without a DOM.
  const groups = useMemo(() => groupPendingByKind(rules), [rules]);

  if (pending.length === 0) return null;

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

  async function decide(state: 'accepted' | 'rejected', ids: string[]) {
    if (ids.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/ad-generator/oem-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_rules',
          packId,
          decisions: ids.map((ruleId) => ({ ruleId, state })),
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        applied?: number;
        rechecksQueued?: number;
        notInReview?: string[];
      };
      if (!res.ok) throw new Error(json.error || 'Could not save the decision');

      const verb = state === 'accepted' ? 'accepted' : 'declined';
      const recheck = json.rechecksQueued
        ? ` ${json.rechecksQueued} template check${json.rechecksQueued === 1 ? '' : 's'} will re-run.`
        : '';
      toast.success(`${json.applied ?? ids.length} rule${(json.applied ?? ids.length) === 1 ? '' : 's'} ${verb}.${recheck}`);
      // Surfaced rather than swallowed: it means an id reached the request that was
      // never in review, which is a defect worth seeing rather than a quiet no-op.
      if (json.notInReview?.length) {
        toast.error(`${json.notInReview.length} rule(s) were not in review and were left alone.`);
      }
      setSelected(new Set());
      onDecided();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the decision');
    } finally {
      setSending(false);
    }
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
                        {rule.sourceQuote && (
                          <p className="mt-1 border-l-2 border-[var(--border)] pl-2 text-[11px] italic leading-snug text-[var(--muted-foreground)]">
                            &ldquo;{rule.sourceQuote}&rdquo;
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                          {rule.citation && <span>{rule.citation}</span>}
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
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <CheckIcon className="h-3 w-3" /> Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
