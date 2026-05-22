'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The standalone admin-level schedule page used to be a one-shot
// "pick template + audience + time, then POST to ESP" form. With the
// ESP teardown it lost its core flow, and the Loomi-native send path
// lives inside the per-campaign builder (`/messaging/campaigns/[id]/
// schedule`). Anyone landing here now gets bounced back to the
// campaigns list so they can use the proper builder.
export default function StandaloneScheduleRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/messaging/campaigns');
  }, [router]);

  return null;
}
