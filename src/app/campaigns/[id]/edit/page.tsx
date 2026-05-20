'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
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

export default function CampaignEditorPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [draft, setDraft] = useState<DraftCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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
        setContent(data.campaign.htmlContent || '');
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

  async function save(): Promise<boolean> {
    if (!draft) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/email/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmlContent: content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save');
      }
      setDirty(false);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleContinueToSchedule() {
    const ok = dirty ? await save() : true;
    if (ok) router.push(`/campaigns/${encodeURIComponent(id)}/schedule`);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-6">
        <p className="text-sm text-[var(--muted-foreground)] inline-flex items-center gap-2">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          Loading campaign…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex-shrink-0 px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            Editing
          </p>
          <h1 className="text-base font-semibold truncate">{draft?.name || 'Campaign'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[11px] text-[var(--muted-foreground)]">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="px-3 h-9 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <PrimaryButton onClick={handleContinueToSchedule} disabled={saving}>
            <PaperAirplaneIcon className="w-4 h-4" />
            Continue to Schedule
          </PrimaryButton>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
        <div className="flex flex-col border-r border-[var(--border)] min-h-0">
          <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              HTML
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Block editor wiring lands next — for now, raw HTML editing.
            </p>
          </div>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (!dirty) setDirty(true);
            }}
            className="flex-1 min-h-0 w-full p-4 bg-[var(--background)] text-[var(--foreground)] font-mono text-xs leading-relaxed border-0 focus:outline-none resize-none"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col bg-[var(--muted)]/30 min-h-0">
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--card)]/40">
            <p className="text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              Preview
            </p>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-auto">
            <iframe
              title="Campaign preview"
              srcDoc={content}
              sandbox=""
              className="w-full h-full min-h-[500px] bg-white rounded-lg border border-[var(--border)]"
            />
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 bg-[var(--card)]/80 backdrop-blur-md border-t border-[var(--border)] px-6 py-3 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push(`/campaigns/${encodeURIComponent(id)}/template`)}
          className="inline-flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Message
        </button>
      </div>
    </div>
  );
}
