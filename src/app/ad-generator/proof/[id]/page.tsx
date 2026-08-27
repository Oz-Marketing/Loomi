'use client';

/**
 * THE PROOF SHEET AS A PAGE — the linkable, printable copy.
 *
 * The sheet's own surface is a modal over the builder (see `ProofSheetModal`):
 * its reader is a designer mid-edit, and sending them into the app shell replaced
 * the builder's chrome with a sidebar and an account switcher for a read that is
 * about the design in front of them.
 *
 * This route stays for the times the sheet has to leave the editor — a link in a
 * message, a print, a second monitor. Same component, same server call, so the two
 * cannot drift apart.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { ProofSheetView } from '@/components/ad-generator/proof-sheet-view';

export default function ProofSheetPage() {
  const params = useParams<{ id: string }>();
  const templateId = params?.id ?? '';
  const { accountKey } = useAccount();

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-8">
      <Link
        href={`/ad-generator/builder?template=${encodeURIComponent(templateId)}${accountKey ? `&account=${encodeURIComponent(accountKey)}` : ''}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to the builder
      </Link>
      <ProofSheetView templateId={templateId} />
    </div>
  );
}
