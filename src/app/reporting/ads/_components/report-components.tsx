'use client';

/**
 * Maps a Digital Ads report key → its (chart-heavy) report component. Kept
 * separate from reports-config so only the /reporting/ads/[report] route pulls
 * these in — the sidebar/nav imports the lightweight metadata instead.
 */

import type { ComponentType } from 'react';
import type { ReportComponentProps } from './reports-config';
import { MetaReport } from './meta-report';
import { StackAdaptReport } from './stackadapt-report';
import { GoogleReport } from './google-report';
import { EmailReport } from './email-report';

export const REPORT_COMPONENTS: Record<string, ComponentType<ReportComponentProps>> = {
  meta: MetaReport,
  stackadapt: StackAdaptReport,
  google: GoogleReport,
  email: EmailReport,
};
