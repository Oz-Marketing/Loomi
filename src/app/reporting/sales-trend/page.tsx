/**
 * Sales Trend route entry.
 *
 * A server component that renders the interactive page, rather than being
 * `'use client'` itself. That split is the idiomatic App Router shape, and it
 * is also a workaround: as a client page this module was assigned webpack
 * module id `0`, and Next drops falsy ids when building the RSC client
 * reference manifest — so the page was absent from its own manifest and every
 * request 500'd with "Could not find the module ... in the React Client
 * Manifest". See scripts/check-client-manifests.ts, which fails the build if
 * this recurs on any route.
 */
import { SalesTrendPage } from './_components/sales-trend-page';

export default function ReportingSalesTrendPage() {
  return <SalesTrendPage />;
}
