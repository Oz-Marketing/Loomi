'use client';

/**
 * What a builder step shows for a blast that is no longer a draft.
 *
 * The steps were reachable for any status — the Campaign overview's Open, the
 * browser's Back after scheduling — and each one went to work on load:
 * re-syncing the template over the committed HTML, autosaving settings,
 * rewriting the audience on Back. The PATCH routes now refuse all of that
 * (409), and the pages render this instead of the editor so nothing tries.
 *
 * A locked state rather than a redirect: Back from the Blasts list would land
 * here again and bounce, and inside the Campaign overview's editor sheet a
 * redirect would load the whole Blasts list into the sheet.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { lockedBlastMessage } from '@/lib/messaging/blast-builder-steps';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued to send',
  scheduled: 'Scheduled',
  processing: 'Sending',
  completed: 'Sent',
  partial: 'Sent with errors',
  failed: 'Failed',
  canceled: 'Canceled',
};

export function BlastLockedNotice({ status, name }: { status: string; name?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subHref = useSubaccountHref();
  const message = lockedBlastMessage(status);

  // Inside the Campaign overview's editor sheet the sheet supplies the way
  // back; a second one into the Blasts list would load it inside the sheet.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(searchParams.get('embed') === '1' || window.name === 'loomi-embed');
  }, [searchParams]);

  const toasted = useRef(false);
  useEffect(() => {
    if (toasted.current) return;
    toasted.current = true;
    toast.error(message);
  }, [message]);

  return (
    <div className="max-w-xl mx-auto py-16 px-6">
      <div className="glass-section-card rounded-2xl border border-[var(--border)] p-8 text-center animate-fade-in-up">
        <div className="w-12 h-12 rounded-xl bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center mx-auto mb-4">
          <LockClosedIcon className="w-6 h-6" />
        </div>
        <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
          {STATUS_LABEL[status] || status}
        </p>
        <h1 className="text-lg font-semibold mt-1">
          {name ? `“${name}” can’t be edited` : 'This blast can’t be edited'}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-2">{message}</p>
        {!embedded && (
          <button
            type="button"
            onClick={() => router.push(subHref('/messaging/blasts'))}
            className="mt-6 inline-flex items-center gap-1.5 px-4 h-10 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Blasts
          </button>
        )}
      </div>
    </div>
  );
}
