/**
 * Standard reporting page header — eyebrow chip + title + optional subtitle.
 * Used by stub pages so the visual hierarchy is consistent across the
 * reporting surface. Replace per-page when you build real content.
 */
export function ReportingPageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="animate-fade-in-up mb-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--primary)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
        <span>{eyebrow}</span>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)] sm:text-base">
          {subtitle}
        </p>
      )}
    </section>
  );
}
