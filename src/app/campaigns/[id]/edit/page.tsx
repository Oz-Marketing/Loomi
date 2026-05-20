'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface DraftCampaign {
  id: string;
  name: string;
  status: string;
  subject: string;
  htmlContent: string;
}

export default function EditStepPage({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id } = use(params);
  const design = searchParams.get('design') || '';

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/email/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load campaign'))))
      .then((data: { campaign?: DraftCampaign }) => {
        if (cancelled) return;
        if (!data.campaign) {
          toast.error('Campaign not found');
          router.push('/campaigns');
          return;
        }
        setDraft(data.campaign);
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading campaign draft…
        </p>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="mb-6">
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Editor
          </p>
          <h1 className="text-2xl font-bold">{draft?.name || 'Campaign'}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Customize the template content before scheduling.
          </p>
        </div>

        <div className="glass-section-card rounded-2xl p-10 border border-dashed border-[var(--border)] text-center">
          <PencilSquareIcon className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-50" />
          <h2 className="text-base font-semibold">Editor wiring lands in Commit 4</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5 max-w-md mx-auto">
            The existing Loomi template editor will open here with the selected
            template loaded. The top &quot;Save&quot; button gets swapped for &quot;Continue
            to Schedule&quot;.
          </p>
          {design && (
            <p className="text-xs text-[var(--muted-foreground)] mt-4">
              Selected template: <code className="text-[10px]">{design}</code>
            </p>
          )}
          {draft?.subject && (
            <p className="text-xs text-[var(--muted-foreground)] mt-2">
              Subject pulled from template: <span className="font-medium">{draft.subject}</span>
            </p>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/campaigns/${encodeURIComponent(id)}/template`)}
            className="inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>
          <PrimaryButton
            onClick={() => router.push(`/campaigns/${encodeURIComponent(id)}/schedule`)}
          >
            Continue to Schedule
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
