'use client';

/**
 * Ad Meeting builder. Fetches every live report for one account, assembles them
 * into a single `ReportDoc`, optionally tops it with a Claude-written analysis,
 * and hands the result to the existing PDF exporter.
 *
 * ── WHY THE FAN-OUT IS CLIENT-SIDE ──────────────────────────────────────────
 * `ReportDoc` is designed to be built from data the client already fetched, and
 * both exporters already work that way. Fanning out from the browser reuses
 * every report route exactly as the on-screen pages call them — same auth, same
 * margin handling, same comparison logic — so a figure here cannot drift from
 * the page it came from. A server-side assembler would be a second
 * implementation of all of that, and the first bug would be a number in a
 * client deck that disagrees with the report the client is looking at.
 *
 * Each source fails independently: an unconfigured platform becomes a row in
 * the document's "Not included" section rather than an error on the page.
 */

import { useState } from 'react';
import {
  DocumentTextIcon,
  SparklesIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Section, Muted, EmptyState, DataTable } from '../../ads/_components/shared';
import {
  buildMeetingDoc,
  analysisSection,
  type MeetingInput,
} from '@/lib/reporting/meeting-doc';
import type { ReportDoc } from '@/lib/reporting/report-doc';
// Shared with the Marketing Overview so the two surfaces can never disagree
// about which channels exist or where a platform hides its totals.
import { ACCOUNT_SOURCES, fetchAllSources, fetchJson } from '../../_components/account-sources';

export function AdMeetingBuilder({
  accountKey,
  dealer,
  from,
  to,
}: {
  accountKey: string;
  dealer: string;
  from: string;
  to: string;
}) {
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  async function assemble() {
    setAssembling(true);
    setNotice(null);
    setDoc(null);
    try {
      const platforms = await fetchAllSources(accountKey, from, to);

      const year = Number(to.slice(0, 4));
      const [sales, service, budget] = await Promise.all([
        fetchJson<{ summary: MeetingInput['sales'] }>(
          `/api/reporting/sales-trend?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
        ),
        fetchJson<{ summary: MeetingInput['service'] }>(
          `/api/reporting/service-trend?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
        ),
        fetchJson<{
          contractTotal: number | null;
          planned: number;
          spent: number | null;
          byChannel: { label: string; amount: number }[];
        }>(`/api/reporting/budget?accountKey=${encodeURIComponent(accountKey)}&year=${year}`),
      ]);

      setDoc(
        buildMeetingDoc({
          dealer,
          startDate: from,
          endDate: to,
          platforms,
          sales: sales?.summary ?? null,
          service: service?.summary ?? null,
          budget: budget
            ? {
                contractTotal: budget.contractTotal,
                planned: budget.planned,
                spent: budget.spent,
                byChannel: budget.byChannel ?? [],
              }
            : null,
        }),
      );

      const missing = platforms.filter((p) => p.status !== 'ok').length;
      if (missing) {
        setNotice({
          tone: 'warn',
          text: `${missing} of ${ACCOUNT_SOURCES.length} channels had no data. They're listed in "Not included" at the end of the document.`,
        });
      }
    } finally {
      setAssembling(false);
    }
  }

  async function addAnalysis() {
    if (!doc) return;
    setAnalyzing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/reporting/ad-meeting/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          tone: 'warn',
          text: `${body?.error || 'The analysis could not be written.'} You can still export the document.`,
        });
        return;
      }
      const section = analysisSection(String(body.analysis ?? ''));
      if (!section) {
        setNotice({ tone: 'warn', text: 'The analysis came back empty. Export without it.' });
        return;
      }
      // Re-running replaces the previous analysis rather than stacking a second
      // one, and "Not included" stays last so the caveats close the document.
      const rest = doc.sections.filter((s) => s.title !== 'Analysis');
      const notIncluded = rest.filter((s) => s.title === 'Not included');
      setDoc({
        ...doc,
        sections: [...rest.filter((s) => s.title !== 'Not included'), section, ...notIncluded],
      });
      setNotice({ tone: 'ok', text: 'Analysis added. Read it before sending — it is a draft.' });
    } finally {
      setAnalyzing(false);
    }
  }

  async function exportPdf() {
    if (!doc) return;
    setExporting(true);
    try {
      const res = await fetch('/api/reporting/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ tone: 'warn', text: body?.error || 'PDF export failed.' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title.replace(/[^\w\s-]/g, '').trim() || 'marketing-review'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={assemble}
          disabled={assembling}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {assembling ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : (
            <DocumentTextIcon className="h-4 w-4" />
          )}
          {assembling ? 'Gathering reports…' : doc ? 'Rebuild' : 'Build document'}
        </button>

        <button
          type="button"
          onClick={addAnalysis}
          disabled={!doc || analyzing}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs font-medium transition-colors hover:border-[var(--primary)]/40 disabled:opacity-40"
        >
          {analyzing ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SparklesIcon className="h-4 w-4" />
          )}
          {analyzing ? 'Writing…' : 'Add analysis'}
        </button>

        <button
          type="button"
          onClick={exportPdf}
          disabled={!doc || exporting}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs font-medium transition-colors hover:border-[var(--primary)]/40 disabled:opacity-40"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            notice.tone === 'ok'
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}
        >
          <div className="flex items-start gap-2">
            {notice.tone === 'ok' ? (
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            )}
            <Muted>{notice.text}</Muted>
          </div>
        </div>
      )}

      {!doc && !assembling && (
        <EmptyState
          icon={DocumentTextIcon}
          title="Nothing built yet"
          body="Build the document to gather every configured report for this account and date range into one deliverable you can review and export."
        />
      )}

      {doc && (
        <>
          <Section title={doc.title} subtitle={doc.subtitle} icon={DocumentTextIcon}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {(doc.kpis ?? []).map((k) => (
                <div
                  key={k.label}
                  className="rounded-xl border border-[var(--border)] p-3"
                >
                  <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    {k.label}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
                  {k.secondary && (
                    <p className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
                      {k.secondary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {doc.sections.map((s) => (
            <Section key={s.title} title={s.title}>
              {s.title === 'Analysis' ? (
                <div className="space-y-3">
                  {s.rows.map((r, i) => (
                    <p key={i} className="text-sm leading-relaxed text-[var(--foreground)]">
                      {String(r[0])}
                    </p>
                  ))}
                  <Muted>
                    Written by Claude from the figures above. Read it before it goes to a client —
                    it is a draft, not a reviewed statement.
                  </Muted>
                </div>
              ) : (
                <DataTable
                  head={s.columns.map((c) => c.header)}
                  rows={s.rows.map((r) => r.map((cell) => String(cell)))}
                  maxRows={12}
                />
              )}
            </Section>
          ))}
        </>
      )}
    </div>
  );
}
