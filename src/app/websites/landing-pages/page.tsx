import { AdminOnly } from '@/components/route-guard';
import { RectangleStackIcon } from '@heroicons/react/24/outline';

// Placeholder for the upcoming Landing Pages surface. Routed so the
// Websites nav group resolves while Forms ships first.
export default function LandingPagesPage() {
  return (
    <AdminOnly>
      <div className="px-8 py-12">
        <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-6">
            <RectangleStackIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
            Landing Pages
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Landing Pages ship after Forms. The builder will share the
            same block system.
          </p>
        </div>
      </div>
    </AdminOnly>
  );
}
