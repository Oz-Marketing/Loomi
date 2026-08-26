'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface Email {
  id: string;
  name: string;
  templateRef: string;
  client: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplateEntry {
  design: string;
  name: string;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ClientDashboard() {
  const { accountKey: clientKey, accountData: clientData } = useAccount();
  const href = useSubaccountHref();
  const [emails, setEmails] = useState<Email[]>([]);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!clientKey) return;
    Promise.all([
      fetch(`/api/emails?client=${clientKey}`).then(r => r.json()),
      fetch('/api/templates').then(r => r.json()),
    ]).then(([em, tmpl]) => {
      setEmails(em);
      setTemplates(tmpl);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [clientKey]);

  if (!loaded || !clientData || !clientKey) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  const clientCategory = clientData.category || 'General';

  // Recent emails
  const recentEmails = [...emails]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const stats = [
    { label: 'Emails', value: emails.length, href: href('/emails') },
    { label: 'Available Templates', value: templates.length, href: href('/library') },
  ];

  return (
    <div>
      {/* Client header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--primary-foreground)] font-bold text-lg bg-[var(--primary)]"
          >
            {clientData.dealer.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-2xl font-bold">{clientData.dealer}</h2>
            <p className="text-[var(--muted-foreground)] text-sm">
              {clientCategory}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="p-4 border border-[var(--border)] rounded-xl bg-[var(--card)] hover:border-[var(--primary)] transition-colors"
          >
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link
          href={href('/library')}
          className="flex-1 text-center py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Browse Templates
        </Link>
        <Link
          href={href('/emails')}
          className="flex-1 text-center py-3 px-4 rounded-xl border border-[var(--border)] bg-[var(--card)] font-medium text-sm hover:border-[var(--primary)] transition-colors"
        >
          View All Emails
        </Link>
      </div>

      {/* Recent emails */}
      <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
        Recent Emails
      </h3>
      {recentEmails.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-[var(--muted-foreground)] text-sm">No emails yet.</p>
          <Link href={href('/library')} className="text-[var(--primary)] text-sm mt-2 inline-block hover:underline">
            Browse templates to get started
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {recentEmails.map((email) => {
            const [design] = email.templateRef.split('/');
            return (
              <div
                key={email.id}
                className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg bg-[var(--card)] hover:border-[var(--primary)] transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{email.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {design ? capitalize(design.replace(/-/g, ' ')) : email.templateRef} &middot; {formatDate(email.updatedAt)}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  email.status === 'active'
                    ? 'bg-green-500/10 text-green-600'
                    : email.status === 'archived'
                    ? 'bg-gray-500/10 text-gray-500'
                    : 'bg-yellow-500/10 text-yellow-600'
                }`}>
                  {capitalize(email.status)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
