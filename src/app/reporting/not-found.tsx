import Link from 'next/link';
import { HomeIcon } from '@heroicons/react/24/outline';

/**
 * Rendered when a URL under reporting.loomilm.com / reporting.localhost
 * doesn't match a route in `src/app/reporting/`. Wrapped by the reporting
 * layout (header + auth gate), so users stay inside the reporting surface
 * instead of being thrown to the global studio-themed 404.
 */
export default function ReportingNotFound() {
  return (
    <section className="relative flex min-h-[60vh] items-center justify-center">
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[min(92vw,52rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.28)_0%,rgba(99,102,241,0.14)_30%,rgba(56,100,220,0.08)_52%,transparent_74%)] blur-3xl" />
      <div className="glass-card animate-fade-in-up relative w-full max-w-2xl overflow-hidden rounded-3xl p-7 sm:p-10">
        <div className="animate-fade-in-up animate-stagger-2 inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--primary)]">
          <span>404</span>
          <span className="h-1 w-1 rounded-full bg-[var(--primary)]/70" />
          <span>Page Missing</span>
        </div>
        <h1 className="animate-fade-in-up animate-stagger-3 mt-5 text-3xl font-semibold leading-tight tracking-tight text-[var(--foreground)] sm:text-4xl">
          That report doesn&apos;t exist here.
        </h1>
        <p className="animate-fade-in-up animate-stagger-4 mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
          The page you requested either moved or never existed on the reporting
          surface. Head back to the reporting home to find what you&apos;re looking for.
        </p>
        <div className="animate-fade-in-up animate-stagger-5 mt-8 flex flex-wrap gap-3">
          <Link
            href="/reporting"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] shadow-[0_8px_30px_rgba(99,102,241,0.35)] transition hover:brightness-110"
          >
            <HomeIcon className="h-4 w-4" />
            Reporting Home
          </Link>
        </div>
      </div>
    </section>
  );
}
