'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { MessagingSettingsPage, type MessagingSettingsTab } from '@/components/messaging/messaging-settings-page';

const VALID_TABS = new Set<MessagingSettingsTab>(['sending', 'sms', 'suppressions']);

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

export default function SubaccountMessagingSettingsTab({ params }: PageProps) {
  const { tab } = use(params);
  if (!VALID_TABS.has(tab as MessagingSettingsTab)) {
    notFound();
  }
  return <MessagingSettingsPage tab={tab as MessagingSettingsTab} />;
}
