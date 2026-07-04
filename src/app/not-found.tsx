import Link from 'next/link';
import { HomeIcon } from '@heroicons/react/24/outline';

export default function NotFound() {
  return (
    <section className="relative flex min-h-[calc(100vh-9rem)] items-center justify-center py-10 sm:py-14">
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[min(92vw,52rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.28)_0%,rgba(99,102,241,0.14)_30%,rgba(56,100,220,0.08)_52%,transparent_74%)] blur-3xl" />

      <div className="glass-card animate-fade-in-up relative w-full max-w-2xl overflow-hidden rounded-3xl p-7 sm:p-10">
        <div className="animate-fade-in-up animate-stagger-2 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] backdrop-blur-xl">
          <span className="iris-rainbow-gradient h-2 w-2 rounded-full" />
          404 · Page not found
        </div>

        <h1 className="animate-fade-in-up animate-stagger-3 mt-6 max-w-xl text-3xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-4xl">
          We couldn&rsquo;t find that page.
        </h1>

        <p className="animate-fade-in-up animate-stagger-4 mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
          It may have moved, or the link is just off. Head back to your dashboard
          to keep building.
        </p>

        <div className="animate-fade-in-up animate-stagger-5 mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] shadow-[0_8px_30px_rgba(99,102,241,0.35)] transition hover:brightness-110"
          >
            <HomeIcon className="h-4 w-4" />
            Go to Dashboard
          </Link>
        </div>

        <p className="animate-fade-in-up animate-stagger-6 mt-7 text-xs text-[var(--muted-foreground)]">
          Still stuck? The help menu in the top bar can point you the right way.
        </p>
      </div>
    </section>
  );
}
