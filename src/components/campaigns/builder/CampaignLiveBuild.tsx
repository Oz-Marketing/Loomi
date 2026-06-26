'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { CHANNEL_META } from './shared';
import type {
  CampaignAssetKind,
  CampaignBuildEvent,
  CampaignPlan,
  CampaignStatus,
} from '@/lib/campaigns/types';

type ItemStatus = 'pending' | 'working' | 'done' | 'error';

interface BuildItem {
  key: string;
  kind: CampaignAssetKind;
  label: string;
  status: ItemStatus;
  message?: string;
}

function initialItems(plan: CampaignPlan): BuildItem[] {
  return [
    ...plan.emails.map((e): BuildItem => ({ key: e.key, kind: 'email', label: e.purpose || e.subject, status: 'pending' })),
    ...plan.sms.map((s): BuildItem => ({ key: s.key, kind: 'sms', label: s.purpose, status: 'pending' })),
    ...(plan.forms ?? []).map((f): BuildItem => ({ key: f.key, kind: 'form', label: f.purpose, status: 'pending' })),
    ...(plan.landingPages ?? []).map((lp): BuildItem => ({ key: lp.key, kind: 'landingPage', label: lp.purpose, status: 'pending' })),
  ];
}

export function CampaignLiveBuild({
  campaignId,
  plan,
  onComplete,
}: {
  campaignId: string;
  plan: CampaignPlan;
  onComplete: (status: CampaignStatus) => void;
}) {
  const [items, setItems] = useState<BuildItem[]>(() => initialItems(plan));
  const [fatalError, setFatalError] = useState<string | null>(null);
  // Set on `complete` only when some assets errored — pauses auto-navigation so
  // the user sees what failed instead of landing on an overview missing pieces.
  const [finishedStatus, setFinishedStatus] = useState<CampaignStatus | null>(null);
  const startedRef = useRef(false);
  const errorCountRef = useRef(0);

  useEffect(() => {
    if (startedRef.current) return; // guard StrictMode double-invoke
    startedRef.current = true;

    const setItem = (key: string, patch: Partial<BuildItem>) =>
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

    const handle = (event: CampaignBuildEvent) => {
      switch (event.type) {
        case 'asset_started':
          setItem(event.key, { status: 'working' });
          break;
        case 'asset_done':
          setItem(event.key, { status: 'done' });
          break;
        case 'asset_error':
          errorCountRef.current += 1;
          setItem(event.key, { status: 'error', message: event.message });
          break;
        case 'complete':
          // Auto-navigate only on a clean build; otherwise pause so the user
          // sees the failures and chooses to continue.
          if (errorCountRef.current === 0) onComplete(event.status);
          else setFinishedStatus(event.status);
          break;
        case 'error':
          setFatalError(event.message);
          break;
      }
    };

    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setFatalError(data?.error || `Generation failed (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              handle(JSON.parse(line.slice(5).trim()) as CampaignBuildEvent);
            } catch {
              /* ignore malformed event */
            }
          }
        }
      } catch {
        setFatalError('Lost connection during generation');
      }
    })();
  }, [campaignId, onComplete]);

  const doneCount = items.filter((i) => i.status === 'done').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  return (
    <div className="relative mx-auto max-w-xl">
      {/* Aurora backdrop — echoes the dashboard hero. */}
      <div aria-hidden className="pointer-events-none absolute -inset-24">
        <span className="iris-aurora-blob iris-aurora-blob-1" />
        <span className="iris-aurora-blob iris-aurora-blob-3" />
        <span className="iris-aurora-blob iris-aurora-blob-5" />
      </div>

      <div className="relative">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-[var(--foreground)]">Building your campaign…</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {doneCount} of {items.length} drafted
            {errorCount > 0 ? ` · ${errorCount} need attention` : ''}
          </p>
        </div>

        {fatalError && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {fatalError}
          </div>
        )}

        {finishedStatus && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Built with {errorCountRef.current} issue{errorCountRef.current === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Some pieces couldn’t be generated. Open the campaign to review what was created.
            </p>
            <button
              onClick={() => onComplete(finishedStatus)}
              className="iris-rainbow-gradient mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90"
            >
              View campaign
            </button>
          </div>
        )}

        <div className="iris-beam-wrap rounded-2xl">
          <div className="space-y-2 rounded-2xl bg-[var(--card-strong)] p-3">
            {items.map((item) => {
              const meta = CHANNEL_META[item.kind];
              return (
                <div key={item.key} className="flex items-center gap-3 rounded-xl bg-[var(--card)] px-4 py-3">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    <meta.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.label}</p>
                    <p className={`text-[11px] ${item.status === 'error' ? 'text-rose-400' : 'text-[var(--muted-foreground)]'}`}>
                      {item.status === 'pending' && 'Queued'}
                      {item.status === 'working' && `Generating ${meta.label.toLowerCase()}…`}
                      {item.status === 'done' && 'Draft ready'}
                      {item.status === 'error' && (item.message || 'Failed')}
                    </p>
                  </div>
                  <span className="flex-shrink-0">
                    {item.status === 'pending' && <span className="block h-4 w-4 rounded-full border-2 border-[var(--border)]" />}
                    {item.status === 'working' && <ArrowPathIcon className="h-4 w-4 animate-spin text-sky-400" />}
                    {item.status === 'done' && <CheckCircleIcon className="h-5 w-5 text-emerald-400" />}
                    {item.status === 'error' && <ExclamationTriangleIcon className="h-5 w-5 text-rose-400" />}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
