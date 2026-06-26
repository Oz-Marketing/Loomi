'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, ArrowUpIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { CampaignPlanReview } from './CampaignPlanReview';
import { CampaignLiveBuild } from './CampaignLiveBuild';
import type { CampaignDetail, CampaignPlan, CampaignStatus } from '@/lib/campaigns/types';

type Phase = 'account' | 'goal' | 'planning' | 'review' | 'building';

export function CampaignBuilderNew() {
  const router = useRouter();
  const href = useSubaccountHref();
  const searchParams = useSearchParams();
  const goalParam = searchParams.get('goal') ?? '';
  const campaignParam = searchParams.get('campaign');

  const { accountKey, accounts, accountsLoaded, setAccount } = useAccount();

  const [phase, setPhase] = useState<Phase>('planning');
  const [goal, setGoal] = useState(goalParam);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const initRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Actions ──
  const startPlan = async (g: string, key: string) => {
    setError(null);
    setPhase('planning');
    try {
      const res = await fetch('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: g, accountKey: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to plan campaign');
      setCampaign(data.campaign);
      setPlan(data.campaign.plan);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to plan campaign');
      setPhase('goal');
    }
  };

  const resumeLoad = async (id: string) => {
    setPhase('planning');
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      const data = await res.json();
      if (!res.ok || !data?.campaign) throw new Error(data?.error || 'Campaign not found');
      setCampaign(data.campaign);
      if (data.campaign.plan) {
        setPlan(data.campaign.plan);
        setPhase('review');
      } else {
        setError('This campaign has no plan to resume.');
        setPhase('goal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
      setPhase('goal');
    }
  };

  // ── Init: decide the starting phase once accounts have loaded ──
  useEffect(() => {
    if (initRef.current || !accountsLoaded) return;
    initRef.current = true;
    if (campaignParam) {
      void resumeLoad(campaignParam);
    } else if (!accountKey) {
      setPhase('account');
    } else if (goalParam.trim()) {
      void startPlan(goalParam, accountKey);
    } else {
      setPhase('goal');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsLoaded]);

  const savePlan = async (p: CampaignPlan) => {
    if (!campaign) return;
    await fetch(`/api/campaigns/${campaign.id}/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: p }),
    }).catch(() => {});
  };

  const handlePlanChange = (next: CampaignPlan) => {
    setPlan(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void savePlan(next), 800);
  };

  const handleApprove = async () => {
    if (!campaign || !plan) return;
    setApproving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await savePlan(plan);
    setApproving(false);
    setPhase('building');
  };

  const handleAccountChosen = (key: string) => {
    setAccount({ mode: 'account', accountKey: key });
    if (goal.trim()) void startPlan(goal, key);
    else setPhase('goal');
  };

  const handleComplete = (_status: CampaignStatus) => {
    if (campaign) router.push(href(`/campaign-builder/${campaign.id}`));
  };

  // ── Render ──
  const backLink = (
    <Link
      href={href('/campaign-builder')}
      className="mb-5 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
    >
      <ArrowLeftIcon className="h-4 w-4" /> Campaigns
    </Link>
  );

  return (
    <div className="animate-fade-in-up">
      {backLink}

      {phase === 'account' && (
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-xl font-bold tracking-tight">Which account is this campaign for?</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Loomi uses the account’s branding, sender identity, and contacts to build the campaign.
          </p>
          <select
            className="mt-5 w-full rounded-lg border border-[var(--border)] bg-[var(--card-strong)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none"
            defaultValue=""
            onChange={(e) => e.target.value && handleAccountChosen(e.target.value)}
          >
            <option value="" disabled>
              Select an account…
            </option>
            {Object.entries(accounts).map(([key, data]) => (
              <option key={key} value={key}>
                {data.dealer}
              </option>
            ))}
          </select>
        </div>
      )}

      {phase === 'goal' && (
        <div className="mx-auto max-w-xl">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="iris-rainbow-gradient mb-3 flex h-10 w-10 items-center justify-center rounded-full shadow-md">
              <SparklesIcon className="h-5 w-5 text-zinc-900" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">What do you want to promote?</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Describe the campaign and Loomi will draft the emails and texts together.
            </p>
          </div>
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
              {error}
            </div>
          )}
          <div className="iris-beam-wrap rounded-2xl">
            <div className="relative rounded-2xl bg-[var(--card-strong)]">
              <textarea
                autoFocus
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && goal.trim() && accountKey) {
                    void startPlan(goal, accountKey);
                  }
                }}
                rows={3}
                placeholder="e.g. Memorial Day service sale — 2 emails and a reminder text to lapsed customers."
                className="w-full resize-none rounded-2xl bg-transparent px-4 py-3.5 pr-14 text-sm leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
              <button
                type="button"
                disabled={!goal.trim() || !accountKey}
                onClick={() => accountKey && startPlan(goal, accountKey)}
                className="iris-rainbow-gradient absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUpIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'planning' && (
        <div className="py-20 text-center">
          <div className="iris-rainbow-gradient mx-auto mb-4 flex h-12 w-12 animate-pulse items-center justify-center rounded-full shadow-md">
            <SparklesIcon className="h-6 w-6 text-zinc-900" />
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">Drafting your campaign plan…</p>
        </div>
      )}

      {phase === 'review' && plan && (
        <div>
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">{campaign?.name ?? 'Your campaign plan'}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Review and tweak the plan, then generate. Nothing sends — every piece lands as a draft.
            </p>
          </div>
          <CampaignPlanReview
            plan={plan}
            onChange={handlePlanChange}
            onApprove={handleApprove}
            approving={approving}
            accountKey={campaign?.accountKey ?? accountKey ?? ''}
          />
        </div>
      )}

      {phase === 'building' && campaign && plan && (
        <CampaignLiveBuild campaignId={campaign.id} plan={plan} onComplete={handleComplete} />
      )}
    </div>
  );
}
