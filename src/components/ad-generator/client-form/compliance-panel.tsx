'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import type { AdData } from '@/lib/ad-generator/types';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

/**
 * What the manufacturer requires of THIS ad, while it is being built.
 *
 * The rules, the packs and the citations already existed — they just only ever
 * ran on the automation path, so an unattended ad was checked and a hand-built
 * one was not. The person typing a banned phrase into a headline was the one
 * person nobody told.
 *
 * Three states, deliberately distinct:
 *   - blocking problems, which stop the export;
 *   - warnings, which don't;
 *   - "no rules on file", which is NOT a pass. Most makes have no pack yet
 *     ({@link ../../../app/settings} → Co-op guidelines), and showing a green tick
 *     for one would be the single most misleading thing this panel could do.
 */

interface Issue {
  code: string;
  severity: 'error' | 'warning';
  field?: string;
  label?: string;
  sizes?: string[];
  message: string;
  ruleId?: string;
  citation?: string;
}

interface Result {
  ok: boolean;
  issues: Issue[];
  checked: boolean;
  make?: string;
  hasPack?: boolean;
  packVerified?: boolean;
}

export function CompliancePanel({
  accountKey,
  templateId,
  doc,
  data,
  sizeIds,
  onBlockingChange,
}: {
  accountKey: string | null;
  templateId: string;
  doc: TemplateDoc | null;
  data: AdData;
  sizeIds: string[];
  /** Lets the page disable export while a manufacturer rule is broken. */
  onBlockingChange?: (blocking: number) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Debounced: the form autosaves as you type, and a compliance check on every
  // keystroke would be both wasteful and jumpy to read.
  useEffect(() => {
    if (!templateId) return;
    const handle = window.setTimeout(() => {
      // The sequence number is taken HERE, not when the effect runs. Taking it
      // per effect meant every discarded debounce still advanced the counter, so
      // the one request that actually went out came back looking stale and its
      // result was thrown away — the panel then had nothing to render and stayed
      // invisible.
      const id = ++seq.current;
      setLoading(true);
      fetch('/api/ad-generator/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, templateId, data, doc, sizeIds }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Result | null) => {
          // Ignore a response that a later edit has already superseded.
          if (id !== seq.current) return;
          setResult(d);
          onBlockingChange?.(d?.issues.filter((i) => i.severity === 'error').length ?? 0);
        })
        .catch(() => {
          if (id === seq.current) setResult(null);
        })
        .finally(() => {
          if (id === seq.current) setLoading(false);
        });
    }, 700);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, templateId, JSON.stringify(data), JSON.stringify(sizeIds), doc]);

  if (!result?.checked) return null;

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const make = result.make || 'this manufacturer';

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          <ShieldCheckIcon className="h-3.5 w-3.5" />
          Manufacturer compliance
        </h2>
        {loading && <span className="text-[10px] text-[var(--muted-foreground)]">Checking…</span>}
      </div>

      {/* No pack is the common case and must never read as approval. */}
      {!result.hasPack ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          No automated rules are on file for <span className="font-medium text-[var(--foreground)]">{make}</span>,
          so nothing here has been checked against their co-op guidelines. Ads still need a person to
          approve them.
        </p>
      ) : errors.length === 0 && warnings.length === 0 ? (
        <p className="flex items-start gap-2 text-xs text-[var(--foreground)]">
          <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
          <span>
            Passes every {make} rule Loomi checks automatically.
            {!result.packVerified && (
              <span className="text-[var(--muted-foreground)]">
                {' '}
                Their rule set is still being checked against the source document, so treat this as a
                guide rather than a sign-off.
              </span>
            )}
          </span>
        </p>
      ) : (
        <div className="space-y-2">
          {errors.length > 0 && (
            <p className="text-xs font-medium text-rose-500">
              {errors.length} {errors.length === 1 ? 'change is' : 'changes are'} required before this ad
              can be exported.
            </p>
          )}
          <ul className="space-y-1.5">
            {[...errors, ...warnings].map((i, idx) => {
              const bad = i.severity === 'error';
              return (
                <li
                  key={`${i.ruleId ?? i.code}-${i.field ?? idx}`}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                    bad
                      ? 'border-rose-500/30 bg-rose-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                >
                  {bad ? (
                    <XCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
                  ) : (
                    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0 text-xs">
                    <div className="text-[var(--foreground)]">{i.message}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--muted-foreground)]">
                      {i.label && <span>{i.label}</span>}
                      {i.sizes?.length ? <span>{i.sizes.join(', ')}</span> : null}
                      {/* The citation is the point: a blocked ad should come with
                          the section someone can go and read, not a verdict. */}
                      {i.citation && <span className="italic">{i.citation}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
