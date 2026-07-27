'use client';

// Service + purchase history timeline. One entry per repair order or deal
// (ContactEvent), newest first, so a rep can see the whole relationship at a
// glance instead of just the latest-value snapshot on the contact row.

export interface ContactEventDto {
  id: string;
  type: string; // 'service' | 'sale'
  eventDate: string | null;
  amount: number | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleMileage: string | null;
  sourceCrm: string | null;
  reference: string | null;
}

interface ContactHistoryProps {
  events: ContactEventDto[];
  loading: boolean;
  error: string | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtMiles(s: string | null): string {
  const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
  return n > 0 ? `${n.toLocaleString()} mi` : '';
}

export function ContactHistory({ events, loading, error }: ContactHistoryProps) {
  const serviceCount = events.filter((e) => e.type === 'service').length;
  const saleCount = events.filter((e) => e.type === 'sale').length;

  return (
    <section className="glass-card rounded-xl p-4 border border-[var(--border)]/70">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">History</h3>
        {events.length > 0 && (
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {saleCount > 0 && `${saleCount} purchase${saleCount === 1 ? '' : 's'}`}
            {saleCount > 0 && serviceCount > 0 && ' · '}
            {serviceCount > 0 && `${serviceCount} service visit${serviceCount === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--muted)]/30" />
          ))}
        </div>
      ) : error ? (
        <p className="text-[11px] text-red-300">{error}</p>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/15 px-4 py-6 text-center">
          <p className="mb-1 text-xs text-[var(--foreground)]">No service or purchase history yet</p>
          <p className="mx-auto max-w-[300px] text-[11px] text-[var(--muted-foreground)]">
            Repair orders and deals sync in from the dealer&apos;s CRM and appear here as a timeline.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-1.5">
          {events.map((e) => {
            const isSale = e.type === 'sale';
            const vehicle = [e.vehicleYear, e.vehicleMake, e.vehicleModel].filter(Boolean).join(' ');
            const meta = [fmtMiles(e.vehicleMileage), e.reference ? `#${e.reference}` : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)]/40 bg-[var(--muted)]/15 px-3 py-2"
              >
                <span
                  className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[10px] font-medium uppercase tracking-wider ${
                    isSale
                      ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                      : 'bg-emerald-500/15 text-emerald-400'
                  }`}
                >
                  {isSale ? 'Purchase' : 'Service'}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[var(--foreground)]">
                    {vehicle || (isSale ? 'Vehicle purchase' : 'Service visit')}
                  </div>
                  {meta && (
                    <div className="truncate text-[11px] text-[var(--muted-foreground)]">{meta}</div>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-[var(--foreground)]">{fmtDate(e.eventDate)}</div>
                  {fmtMoney(e.amount) && (
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {fmtMoney(e.amount)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
