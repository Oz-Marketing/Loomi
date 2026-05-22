'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SegmentEditor } from '@/components/contacts/segment-editor';

interface SeedSegment {
  name: string;
  description?: string | null;
  filters: string;
}

export default function NewSegmentPage() {
  const params = useSearchParams();
  const fromId = params.get('from');
  const [seed, setSeed] = useState<SeedSegment | null>(null);
  const [loading, setLoading] = useState(Boolean(fromId));

  useEffect(() => {
    if (!fromId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch(`/api/audiences/${encodeURIComponent(fromId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const a = data?.audience;
        if (a) {
          setSeed({
            name: `${a.name} (copy)`,
            description: a.description,
            filters: a.filters,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">
        Loading segment…
      </div>
    );
  }

  return <SegmentEditor mode="create" initial={seed ?? undefined} />;
}
