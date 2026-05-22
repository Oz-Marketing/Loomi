'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SegmentEditor, type SegmentEditorProps } from '@/components/contacts/segment-editor';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

type Initial = NonNullable<SegmentEditorProps['initial']>;

export default function EditSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const subHref = useSubaccountHref();
  const [audience, setAudience] = useState<Initial | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'forbidden'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audiences/${encodeURIComponent(id)}`)
      .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }))
      .then(({ ok, status: code, body }) => {
        if (cancelled) return;
        if (!ok) {
          setStatus(code === 403 ? 'forbidden' : 'missing');
          return;
        }
        const a = body?.audience;
        if (!a) {
          setStatus('missing');
          return;
        }
        setAudience({
          id: a.id,
          name: a.name,
          description: a.description,
          accountKey: a.accountKey,
          color: a.color,
          filters: a.filters,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (status === 'loading') {
    return (
      <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">
        Loading segment…
      </div>
    );
  }

  if (status === 'missing' || status === 'forbidden' || !audience) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium">
          {status === 'forbidden' ? "You don't have access to this segment." : 'Segment not found.'}
        </p>
        <Link
          href={subHref('/contacts/segments')}
          className="inline-block mt-3 text-xs text-[var(--primary)] hover:underline"
        >
          Back to segments
        </Link>
      </div>
    );
  }

  return <SegmentEditor mode="edit" initial={audience} />;
}
