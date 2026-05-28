import { getAuthSession } from '@/lib/api-auth';
import { ReportingPageHeader } from './_components/page-header';

export default async function ReportingHomePage() {
  const session = await getAuthSession();
  const accountKeys = session?.user.accountKeys ?? [];
  const firstName = session?.user.name?.split(' ')[0] ?? 'there';

  return (
    <>
      <ReportingPageHeader
        eyebrow="Dashboard"
        title={`Welcome, ${firstName}.`}
        subtitle="This is the home of your account's reporting. Real dashboards land here next."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="glass-card animate-fade-in-up animate-stagger-1 p-6">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Accounts in scope
          </div>
          <div className="mt-2 text-3xl font-semibold">{accountKeys.length}</div>
        </div>
        <div className="glass-card animate-fade-in-up animate-stagger-2 p-6">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Role
          </div>
          <div className="mt-2 text-2xl font-semibold capitalize">
            {session?.user.role ?? '—'}
          </div>
        </div>
        <div className="glass-card animate-fade-in-up animate-stagger-3 p-6">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Status
          </div>
          <div className="mt-2 text-2xl font-semibold">Coming soon</div>
        </div>
      </section>
    </>
  );
}
