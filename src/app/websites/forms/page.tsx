import Link from 'next/link';
import { AdminOnly } from '@/components/route-guard';
import { DocumentTextIcon, BeakerIcon } from '@heroicons/react/24/outline';

// Placeholder list page until PR3 (admin CRUD + real list). Renders a
// jump-link to /websites/forms/demo so the in-memory builder is
// reachable for testing while persistence + list view land.
export default function FormsPage() {
  return (
    <AdminOnly>
      <div className="px-8 py-12">
        <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-6">
            <DocumentTextIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
            Forms
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">
            The form list + admin actions ship next. The builder itself is
            live — try it below.
          </p>
          <Link
            href="/websites/forms/demo"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <BeakerIcon className="w-4 h-4" />
            Try the builder
          </Link>
        </div>
      </div>
    </AdminOnly>
  );
}
