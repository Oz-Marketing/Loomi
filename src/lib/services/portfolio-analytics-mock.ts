// Deterministic mock data for the portfolio dashboard.
//
// Enabled when DASHBOARD_DUMMY_DATA=1 (or NEXT_PUBLIC_DASHBOARD_DUMMY_DATA=1)
// at request time. Returns a fully-populated PortfolioDashboardData
// shape so every widget renders with realistic-looking content — useful
// for screenshots, demos, and design QA without seeding the dev DB.

import type {
  AccountHealthRow,
  ActivityEntry,
  AnomalyAlert,
  EngagedContactsBreakdown,
  EngagementTimelinePoint,
  LifecycleAlertsResult,
  MetaPacerSummaryRow,
  PipelineCampaign,
  PortfolioKpis,
  RepPerformanceRow,
  SendPipelineResult,
  SuppressionHealthResult,
  TopCampaignRow,
} from '@/hooks/use-portfolio-dashboard';

type MockPortfolio = {
  meta: {
    accountKeys: string[];
    start: string;
    end: string;
    engagedWindowDays: number;
    role: string;
  };
  kpis: PortfolioKpis;
  timeline: EngagementTimelinePoint[];
  engagedContacts: EngagedContactsBreakdown;
  lifecycle: LifecycleAlertsResult;
  pipeline: SendPipelineResult;
  accountHealth: AccountHealthRow[];
  anomalies: AnomalyAlert[];
  topCampaigns: TopCampaignRow[];
  activity: ActivityEntry[];
  repPerformance: RepPerformanceRow[];
  suppression: SuppressionHealthResult;
  metaPacer: MetaPacerSummaryRow[];
  errors: Record<string, string>;
};

const MOCK_ACCOUNTS = [
  { key: 'youngHonda', dealer: 'Young Honda', rep: 'Sarah Chen', repId: 'rep-sarah' },
  { key: 'audiLayton', dealer: 'Audi Layton', rep: 'Marcus Reid', repId: 'rep-marcus' },
  { key: 'bmwSaltlake', dealer: 'BMW of Salt Lake', rep: 'Sarah Chen', repId: 'rep-sarah' },
  { key: 'fordWestValley', dealer: 'Ford West Valley', rep: 'Jenna Park', repId: 'rep-jenna' },
  { key: 'subaruOgden', dealer: 'Subaru of Ogden', rep: 'Marcus Reid', repId: 'rep-marcus' },
  { key: 'toyotaProvo', dealer: 'Toyota Provo', rep: 'Jenna Park', repId: 'rep-jenna' },
  { key: 'mazdaLehi', dealer: 'Mazda Lehi', rep: null, repId: null },
  { key: 'lexusDraper', dealer: 'Lexus of Draper', rep: 'Sarah Chen', repId: 'rep-sarah' },
];

function daysAgoIso(days: number, hours = 0): string {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
}

function daysFromNowIso(days: number, hours = 0): string {
  return new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();
}

function buildTimeline(): EngagementTimelinePoint[] {
  const points: EngagementTimelinePoint[] = [];
  const now = new Date();
  // 30 days of data, with a clear weekly cadence + a promo spike.
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const promoBoost = i === 14 || i === 7 ? 2.8 : 1;
    const base = isWeekend ? 280 : 940;
    const delivered = Math.round(base * promoBoost + (i % 3) * 35);
    points.push({
      date: day,
      emailDelivered: delivered,
      emailOpens: Math.round(delivered * (0.22 + (i % 5) * 0.01)),
      emailClicks: Math.round(delivered * (0.034 + (i % 4) * 0.004)),
      emailBounces: Math.round(delivered * (0.008 + (i % 7) * 0.0015)),
      smsDelivered: Math.round((isWeekend ? 90 : 240) * promoBoost),
    });
  }
  return points;
}

function buildKpis(): PortfolioKpis {
  const emailsSent = 28_416;
  const emailDelivered = 27_854;
  const emailOpens = 6_823;
  const emailClicks = 1_088;
  const emailBounces = 487;
  const emailSpamReports = 9;
  const smsSent = 6_120;
  const smsDelivered = 6_034;
  return {
    accountsTotal: MOCK_ACCOUNTS.length,
    accountsActive: 7,
    contactsTotal: 142_318,
    contactsAdded: 1_847,
    emailsSent,
    smsSent,
    emailDelivered,
    emailOpens,
    emailClicks,
    emailBounces,
    emailSpamReports,
    emailUnsubscribes: 73,
    smsDelivered,
    smsFailed: 86,
    smsStops: 41,
    emailDeliveryRate: emailDelivered / emailsSent,
    emailOpenRate: emailOpens / emailDelivered,
    emailClickRate: emailClicks / emailDelivered,
    emailBounceRate: emailBounces / emailsSent,
    emailSpamRate: emailSpamReports / emailDelivered,
    smsDeliveryRate: smsDelivered / smsSent,
    suppressionsAdded: 218,
  };
}

function buildLifecycle(): LifecycleAlertsResult {
  return {
    service: {
      dueIn30: 1_842,
      dueIn60: 3_618,
      dueIn90: 5_204,
      byAccount: [
        { accountKey: 'youngHonda', dealer: 'Young Honda', dueIn30: 412, dueIn60: 798, dueIn90: 1_140 },
        { accountKey: 'toyotaProvo', dealer: 'Toyota Provo', dueIn30: 386, dueIn60: 712, dueIn90: 1_030 },
        { accountKey: 'fordWestValley', dealer: 'Ford West Valley', dueIn30: 318, dueIn60: 624, dueIn90: 902 },
        { accountKey: 'subaruOgden', dealer: 'Subaru of Ogden', dueIn30: 274, dueIn60: 521, dueIn90: 757 },
      ],
    },
    lease: {
      endingIn30: 287,
      endingIn60: 612,
      endingIn90: 942,
      byAccount: [
        { accountKey: 'audiLayton', dealer: 'Audi Layton', endingIn30: 84, endingIn60: 167, endingIn90: 258 },
        { accountKey: 'bmwSaltlake', dealer: 'BMW of Salt Lake', endingIn30: 72, endingIn60: 151, endingIn90: 226 },
        { accountKey: 'lexusDraper', dealer: 'Lexus of Draper', endingIn30: 58, endingIn60: 124, endingIn90: 191 },
        { accountKey: 'mazdaLehi', dealer: 'Mazda Lehi', endingIn30: 39, endingIn60: 88, endingIn90: 142 },
      ],
    },
    warranty: {
      expiringIn30: 624,
      expiringIn60: 1_318,
      expiringIn90: 1_945,
      byAccount: [
        { accountKey: 'fordWestValley', dealer: 'Ford West Valley', expiringIn30: 168, expiringIn60: 344, expiringIn90: 512 },
        { accountKey: 'youngHonda', dealer: 'Young Honda', expiringIn30: 142, expiringIn60: 296, expiringIn90: 438 },
        { accountKey: 'toyotaProvo', dealer: 'Toyota Provo', expiringIn30: 128, expiringIn60: 274, expiringIn90: 401 },
        { accountKey: 'subaruOgden', dealer: 'Subaru of Ogden', expiringIn30: 96, expiringIn60: 207, expiringIn90: 312 },
      ],
    },
  };
}

function buildPipeline(): SendPipelineResult {
  const scheduled: PipelineCampaign[] = [
    {
      id: 'mock-c-1',
      channel: 'email',
      name: 'Spring Service Reminder',
      status: 'scheduled',
      scheduledFor: daysFromNowIso(2, 4),
      startedAt: null,
      completedAt: null,
      totalRecipients: 4_812,
      sentCount: 0,
      failedCount: 0,
      accountKeys: ['youngHonda', 'toyotaProvo'],
      error: null,
      updatedAt: daysAgoIso(0, 1),
    },
    {
      id: 'mock-c-2',
      channel: 'sms',
      name: 'Lease End Outreach – Audi',
      status: 'scheduled',
      scheduledFor: daysFromNowIso(3, 2),
      startedAt: null,
      completedAt: null,
      totalRecipients: 84,
      sentCount: 0,
      failedCount: 0,
      accountKeys: ['audiLayton'],
      error: null,
      updatedAt: daysAgoIso(0, 3),
    },
    {
      id: 'mock-c-3',
      channel: 'email',
      name: 'Q2 Sales Event Save-the-Date',
      status: 'scheduled',
      scheduledFor: daysFromNowIso(5, 12),
      startedAt: null,
      completedAt: null,
      totalRecipients: 9_240,
      sentCount: 0,
      failedCount: 0,
      accountKeys: ['fordWestValley', 'youngHonda', 'subaruOgden'],
      error: null,
      updatedAt: daysAgoIso(1, 0),
    },
  ];

  const inFlight: PipelineCampaign[] = [
    {
      id: 'mock-c-4',
      channel: 'email',
      name: 'Warranty Expiration Nudge',
      status: 'processing',
      scheduledFor: daysAgoIso(0, 1),
      startedAt: daysAgoIso(0, 1),
      completedAt: null,
      totalRecipients: 1_945,
      sentCount: 1_312,
      failedCount: 8,
      accountKeys: ['fordWestValley'],
      error: null,
      updatedAt: daysAgoIso(0, 0),
    },
  ];

  const recentlyFailed: PipelineCampaign[] = [
    {
      id: 'mock-c-5',
      channel: 'email',
      name: 'BMW Spring Promo (test send)',
      status: 'failed',
      scheduledFor: daysAgoIso(2, 4),
      startedAt: daysAgoIso(2, 4),
      completedAt: null,
      totalRecipients: 320,
      sentCount: 8,
      failedCount: 312,
      accountKeys: ['bmwSaltlake'],
      error: 'SendGrid auth: missing verified sender identity',
      updatedAt: daysAgoIso(2, 3),
    },
  ];

  return { scheduled, inFlight, recentlyFailed };
}

function buildAccountHealth(): AccountHealthRow[] {
  const rows: AccountHealthRow[] = [
    {
      accountKey: 'youngHonda',
      dealer: 'Young Honda',
      contactCount: 28_412,
      sentInPeriod: 6_240,
      deliveredInPeriod: 6_124,
      opensInPeriod: 1_624,
      clicksInPeriod: 264,
      bouncesInPeriod: 88,
      openRate: 0.265,
      clickRate: 0.043,
      bounceRate: 0.014,
      suppressionGrowth: 32,
      lastSentAt: daysAgoIso(1, 4),
      daysSinceLastSend: 1,
      healthScore: 88,
    },
    {
      accountKey: 'toyotaProvo',
      dealer: 'Toyota Provo',
      contactCount: 24_186,
      sentInPeriod: 5_820,
      deliveredInPeriod: 5_701,
      opensInPeriod: 1_421,
      clicksInPeriod: 198,
      bouncesInPeriod: 84,
      openRate: 0.249,
      clickRate: 0.035,
      bounceRate: 0.014,
      suppressionGrowth: 28,
      lastSentAt: daysAgoIso(2, 8),
      daysSinceLastSend: 2,
      healthScore: 82,
    },
    {
      accountKey: 'fordWestValley',
      dealer: 'Ford West Valley',
      contactCount: 19_874,
      sentInPeriod: 4_510,
      deliveredInPeriod: 4_402,
      opensInPeriod: 982,
      clicksInPeriod: 146,
      bouncesInPeriod: 78,
      openRate: 0.223,
      clickRate: 0.033,
      bounceRate: 0.017,
      suppressionGrowth: 41,
      lastSentAt: daysAgoIso(3, 1),
      daysSinceLastSend: 3,
      healthScore: 74,
    },
    {
      accountKey: 'subaruOgden',
      dealer: 'Subaru of Ogden',
      contactCount: 17_312,
      sentInPeriod: 3_880,
      deliveredInPeriod: 3_794,
      opensInPeriod: 824,
      clicksInPeriod: 122,
      bouncesInPeriod: 62,
      openRate: 0.217,
      clickRate: 0.032,
      bounceRate: 0.016,
      suppressionGrowth: 18,
      lastSentAt: daysAgoIso(6, 0),
      daysSinceLastSend: 6,
      healthScore: 69,
    },
    {
      accountKey: 'audiLayton',
      dealer: 'Audi Layton',
      contactCount: 12_948,
      sentInPeriod: 2_140,
      deliveredInPeriod: 2_098,
      opensInPeriod: 612,
      clicksInPeriod: 98,
      bouncesInPeriod: 34,
      openRate: 0.292,
      clickRate: 0.047,
      bounceRate: 0.016,
      suppressionGrowth: 12,
      lastSentAt: daysAgoIso(1, 12),
      daysSinceLastSend: 1,
      healthScore: 91,
    },
    {
      accountKey: 'lexusDraper',
      dealer: 'Lexus of Draper',
      contactCount: 9_412,
      sentInPeriod: 1_620,
      deliveredInPeriod: 1_592,
      opensInPeriod: 487,
      clicksInPeriod: 81,
      bouncesInPeriod: 24,
      openRate: 0.306,
      clickRate: 0.051,
      bounceRate: 0.015,
      suppressionGrowth: 8,
      lastSentAt: daysAgoIso(4, 8),
      daysSinceLastSend: 4,
      healthScore: 86,
    },
    {
      accountKey: 'bmwSaltlake',
      dealer: 'BMW of Salt Lake',
      contactCount: 14_624,
      sentInPeriod: 320,
      deliveredInPeriod: 280,
      opensInPeriod: 38,
      clicksInPeriod: 4,
      bouncesInPeriod: 38,
      openRate: 0.136,
      clickRate: 0.014,
      bounceRate: 0.119,
      suppressionGrowth: 86,
      lastSentAt: daysAgoIso(2, 3),
      daysSinceLastSend: 2,
      healthScore: 32,
    },
    {
      accountKey: 'mazdaLehi',
      dealer: 'Mazda Lehi',
      contactCount: 15_510,
      sentInPeriod: 0,
      deliveredInPeriod: 0,
      opensInPeriod: 0,
      clicksInPeriod: 0,
      bouncesInPeriod: 0,
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
      suppressionGrowth: 0,
      lastSentAt: daysAgoIso(48, 6),
      daysSinceLastSend: 48,
      healthScore: 22,
    },
  ];
  return rows;
}

function buildAnomalies(): AnomalyAlert[] {
  const now = new Date().toISOString();
  // Mock account keys don't resolve to real slugs in the dev DB, so we
  // omit account-bound hrefs (the widget renders these as non-clickable
  // rows). System-page hrefs (/messaging/...) point to real routes.
  return [
    {
      id: 'mock-anom-1',
      severity: 'critical',
      title: 'Bounce rate spike',
      detail: '11.9% bounces on 320 sends (7d). Check sender reputation + list hygiene.',
      accountKey: 'bmwSaltlake',
      dealer: 'BMW of Salt Lake',
      timestamp: now,
    },
    {
      id: 'mock-anom-2',
      severity: 'critical',
      title: 'Campaign failed',
      detail: 'BMW Spring Promo (test send): SendGrid auth: missing verified sender identity',
      accountKey: 'bmwSaltlake',
      dealer: 'BMW of Salt Lake',
      href: '/messaging/blasts',
      timestamp: daysAgoIso(2, 3),
    },
    {
      id: 'mock-anom-3',
      severity: 'warning',
      title: 'Dormant account',
      detail: 'No sends in 48 days (15,510 contacts).',
      accountKey: 'mazdaLehi',
      dealer: 'Mazda Lehi',
      timestamp: now,
    },
    {
      id: 'mock-anom-4',
      severity: 'warning',
      title: 'Suppression list growing fast',
      detail: '86 new suppressions in 7d (0.6% of list).',
      accountKey: 'bmwSaltlake',
      dealer: 'BMW of Salt Lake',
      href: '/messaging/settings/suppressions',
      timestamp: now,
    },
    {
      id: 'mock-anom-5',
      severity: 'info',
      title: 'Spam complaints',
      detail: '2 spam complaints in the last 30 days.',
      accountKey: 'fordWestValley',
      dealer: 'Ford West Valley',
      timestamp: daysAgoIso(1, 0),
    },
  ];
}

function buildTopCampaigns(): TopCampaignRow[] {
  return [
    {
      campaignId: 'mock-top-1',
      campaignName: 'Lexus IS Trade-In Offer',
      channel: 'email',
      accountKeys: ['lexusDraper'],
      sent: 1_124,
      delivered: 1_108,
      uniqueOpens: 412,
      uniqueClicks: 86,
      openRate: 0.372,
      clickRate: 0.078,
      sentAt: daysAgoIso(5, 0),
    },
    {
      campaignId: 'mock-top-2',
      campaignName: 'Audi Q5 Lease Pull-Ahead',
      channel: 'email',
      accountKeys: ['audiLayton'],
      sent: 824,
      delivered: 810,
      uniqueOpens: 288,
      uniqueClicks: 52,
      openRate: 0.356,
      clickRate: 0.064,
      sentAt: daysAgoIso(8, 0),
    },
    {
      campaignId: 'mock-top-3',
      campaignName: 'Honda CR-V Service Special',
      channel: 'email',
      accountKeys: ['youngHonda'],
      sent: 3_240,
      delivered: 3_181,
      uniqueOpens: 962,
      uniqueClicks: 168,
      openRate: 0.302,
      clickRate: 0.053,
      sentAt: daysAgoIso(11, 0),
    },
    {
      campaignId: 'mock-top-4',
      campaignName: 'Ford F-150 Warranty Extension',
      channel: 'email',
      accountKeys: ['fordWestValley'],
      sent: 1_945,
      delivered: 1_902,
      uniqueOpens: 524,
      uniqueClicks: 86,
      openRate: 0.276,
      clickRate: 0.045,
      sentAt: daysAgoIso(14, 0),
    },
    {
      campaignId: 'mock-top-5',
      campaignName: 'Toyota Camry Service Reminder',
      channel: 'email',
      accountKeys: ['toyotaProvo'],
      sent: 2_412,
      delivered: 2_374,
      uniqueOpens: 612,
      uniqueClicks: 94,
      openRate: 0.258,
      clickRate: 0.040,
      sentAt: daysAgoIso(18, 0),
    },
  ];
}

function buildEngagedContacts(): EngagedContactsBreakdown {
  const byAccount = [
    { accountKey: 'youngHonda', dealer: 'Young Honda', engagedCount: 8_412, totalCount: 28_412, rate: 0.296 },
    { accountKey: 'toyotaProvo', dealer: 'Toyota Provo', engagedCount: 6_840, totalCount: 24_186, rate: 0.283 },
    { accountKey: 'fordWestValley', dealer: 'Ford West Valley', engagedCount: 4_896, totalCount: 19_874, rate: 0.246 },
    { accountKey: 'audiLayton', dealer: 'Audi Layton', engagedCount: 4_412, totalCount: 12_948, rate: 0.341 },
    { accountKey: 'subaruOgden', dealer: 'Subaru of Ogden', engagedCount: 4_124, totalCount: 17_312, rate: 0.238 },
    { accountKey: 'lexusDraper', dealer: 'Lexus of Draper', engagedCount: 3_842, totalCount: 9_412, rate: 0.408 },
    { accountKey: 'bmwSaltlake', dealer: 'BMW of Salt Lake', engagedCount: 1_124, totalCount: 14_624, rate: 0.077 },
    { accountKey: 'mazdaLehi', dealer: 'Mazda Lehi', engagedCount: 0, totalCount: 15_510, rate: 0 },
  ];
  return {
    windowDays: 90,
    engagedTotal: byAccount.reduce((s, r) => s + r.engagedCount, 0),
    engagedByAccount: byAccount,
  };
}

function buildSuppression(): SuppressionHealthResult {
  return {
    emailTotal: 4_218,
    smsTotal: 612,
    emailAddedInPeriod: 187,
    smsAddedInPeriod: 31,
    emailReasons: [
      { reason: 'bounce', count: 108 },
      { reason: 'unsubscribe', count: 62 },
      { reason: 'spamreport', count: 12 },
      { reason: 'manual', count: 5 },
    ],
    smsReasons: [
      { reason: 'stop', count: 27 },
      { reason: 'undelivered', count: 3 },
      { reason: 'manual', count: 1 },
    ],
  };
}

function buildActivity(): ActivityEntry[] {
  return [
    {
      id: 'mock-act-1',
      kind: 'campaign-launched',
      title: 'Email campaign sent',
      detail: 'Honda CR-V Service Special — 3,181 delivered',
      accountKey: 'youngHonda',
      dealer: 'Young Honda',
      timestamp: daysAgoIso(0, 2),
    },
    {
      id: 'mock-act-2',
      kind: 'campaign-failed',
      title: 'Email campaign failed',
      detail: 'BMW Spring Promo (test send): missing verified sender identity',
      accountKey: 'bmwSaltlake',
      dealer: 'BMW of Salt Lake',
      timestamp: daysAgoIso(0, 6),
    },
    {
      id: 'mock-act-3',
      kind: 'campaign-scheduled',
      title: 'Email scheduled',
      detail: 'Spring Service Reminder — fires Friday 9:00 AM',
      accountKey: 'youngHonda',
      dealer: 'Young Honda',
      timestamp: daysAgoIso(1, 0),
    },
    {
      id: 'mock-act-4',
      kind: 'list-created',
      title: 'Contact list created',
      detail: 'Q2 Lease Ends — Audi Q5/Q7',
      accountKey: 'audiLayton',
      dealer: 'Audi Layton',
      timestamp: daysAgoIso(1, 4),
    },
    {
      id: 'mock-act-5',
      kind: 'campaign-launched',
      title: 'SMS campaign sent',
      detail: 'Service appointment reminder — 312 delivered',
      accountKey: 'toyotaProvo',
      dealer: 'Toyota Provo',
      timestamp: daysAgoIso(2, 1),
    },
    {
      id: 'mock-act-6',
      kind: 'campaign-launched',
      title: 'Email campaign sent',
      detail: 'Ford F-150 Warranty Extension — 1,902 delivered',
      accountKey: 'fordWestValley',
      dealer: 'Ford West Valley',
      timestamp: daysAgoIso(2, 8),
    },
    {
      id: 'mock-act-7',
      kind: 'list-created',
      title: 'Contact list created',
      detail: 'Lexus IS owners — model year 2020-2022',
      accountKey: 'lexusDraper',
      dealer: 'Lexus of Draper',
      timestamp: daysAgoIso(3, 2),
    },
    {
      id: 'mock-act-8',
      kind: 'campaign-scheduled',
      title: 'Email scheduled',
      detail: 'Q2 Sales Event Save-the-Date — fires next Wednesday',
      accountKey: 'fordWestValley',
      dealer: 'Ford West Valley',
      timestamp: daysAgoIso(3, 6),
    },
  ];
}

function buildRepPerformance(): RepPerformanceRow[] {
  return [
    {
      repId: 'rep-sarah',
      repName: 'Sarah Chen',
      accountCount: 3,
      contactCount: 52_448,
      sentInPeriod: 8_180,
      deliveredInPeriod: 7_996,
      opensInPeriod: 2_149,
      clicksInPeriod: 349,
      openRate: 0.269,
      clickRate: 0.044,
      averageHealthScore: 88,
    },
    {
      repId: 'rep-marcus',
      repName: 'Marcus Reid',
      accountCount: 2,
      contactCount: 30_260,
      sentInPeriod: 6_020,
      deliveredInPeriod: 5_892,
      opensInPeriod: 1_436,
      clicksInPeriod: 220,
      openRate: 0.244,
      clickRate: 0.037,
      averageHealthScore: 76,
    },
    {
      repId: 'rep-jenna',
      repName: 'Jenna Park',
      accountCount: 2,
      contactCount: 44_060,
      sentInPeriod: 10_330,
      deliveredInPeriod: 10_103,
      opensInPeriod: 2_403,
      clicksInPeriod: 344,
      openRate: 0.238,
      clickRate: 0.034,
      averageHealthScore: 78,
    },
    {
      repId: null,
      repName: 'Unassigned',
      accountCount: 1,
      contactCount: 15_510,
      sentInPeriod: 0,
      deliveredInPeriod: 0,
      opensInPeriod: 0,
      clicksInPeriod: 0,
      openRate: 0,
      clickRate: 0,
      averageHealthScore: 22,
    },
  ];
}

function buildMetaPacer(): MetaPacerSummaryRow[] {
  const period = new Date().toISOString().slice(0, 7);
  return [
    {
      accountKey: 'youngHonda',
      dealer: 'Young Honda',
      baseBudgetGoal: 18_000,
      addedBudgetGoal: 4_000,
      totalBudgetGoal: 22_000,
      actualSpend: 16_240,
      pacingPct: 16_240 / 22_000,
      adCount: 12,
      period,
    },
    {
      accountKey: 'fordWestValley',
      dealer: 'Ford West Valley',
      baseBudgetGoal: 15_000,
      addedBudgetGoal: 3_000,
      totalBudgetGoal: 18_000,
      actualSpend: 19_842,
      pacingPct: 19_842 / 18_000,
      adCount: 9,
      period,
    },
    {
      accountKey: 'toyotaProvo',
      dealer: 'Toyota Provo',
      baseBudgetGoal: 12_000,
      addedBudgetGoal: 2_000,
      totalBudgetGoal: 14_000,
      actualSpend: 9_148,
      pacingPct: 9_148 / 14_000,
      adCount: 8,
      period,
    },
    {
      accountKey: 'audiLayton',
      dealer: 'Audi Layton',
      baseBudgetGoal: 10_000,
      addedBudgetGoal: 2_500,
      totalBudgetGoal: 12_500,
      actualSpend: 7_894,
      pacingPct: 7_894 / 12_500,
      adCount: 7,
      period,
    },
    {
      accountKey: 'subaruOgden',
      dealer: 'Subaru of Ogden',
      baseBudgetGoal: 8_000,
      addedBudgetGoal: 1_500,
      totalBudgetGoal: 9_500,
      actualSpend: 3_420,
      pacingPct: 3_420 / 9_500,
      adCount: 6,
      period,
    },
  ];
}

export function isDashboardMockEnabled(): boolean {
  return (
    process.env.DASHBOARD_DUMMY_DATA === '1' ||
    process.env.NEXT_PUBLIC_DASHBOARD_DUMMY_DATA === '1'
  );
}

export function generateMockPortfolio(args: {
  start: Date;
  end: Date;
  engagedWindowDays: number;
  role: string;
  accountKeys: string[];
}): MockPortfolio {
  const full: MockPortfolio = {
    meta: {
      accountKeys: MOCK_ACCOUNTS.map((a) => a.key),
      start: args.start.toISOString(),
      end: args.end.toISOString(),
      engagedWindowDays: args.engagedWindowDays,
      role: args.role,
    },
    kpis: buildKpis(),
    timeline: buildTimeline(),
    engagedContacts: buildEngagedContacts(),
    lifecycle: buildLifecycle(),
    pipeline: buildPipeline(),
    accountHealth: buildAccountHealth(),
    anomalies: buildAnomalies(),
    topCampaigns: buildTopCampaigns(),
    activity: buildActivity(),
    repPerformance: args.role === 'super_admin' || args.role === 'developer' ? buildRepPerformance() : [],
    suppression: buildSuppression(),
    metaPacer: buildMetaPacer(),
    errors: {},
  };

  // Portfolio view: caller has visibility into every (or no) account.
  if (args.accountKeys.length === 0 || args.accountKeys.length >= MOCK_ACCOUNTS.length) {
    return full;
  }

  return scopePortfolio(full, args.accountKeys, args.role);
}

// Scope a fully-built mock portfolio down to a subset of accounts.
// The requested account keys are mapped to the first N mock accounts
// (so the dashboard at /accounts/<anything> shows data for ONE
// representative mock account when the caller passes a single key).
function scopePortfolio(full: MockPortfolio, requestedKeys: string[], role: string): MockPortfolio {
  const scopedMockAccounts = MOCK_ACCOUNTS.slice(0, requestedKeys.length);
  const scopedKeys = new Set(scopedMockAccounts.map((a) => a.key));
  const scopedRepIds = new Set(scopedMockAccounts.map((a) => a.repId));

  const accountHealth = full.accountHealth.filter((r) => scopedKeys.has(r.accountKey));
  const sumHealth = (selector: (r: typeof accountHealth[number]) => number) =>
    accountHealth.reduce((sum, r) => sum + selector(r), 0);

  const sent = sumHealth((r) => r.sentInPeriod);
  const delivered = sumHealth((r) => r.deliveredInPeriod);
  const opens = sumHealth((r) => r.opensInPeriod);
  const clicks = sumHealth((r) => r.clicksInPeriod);
  const bounces = sumHealth((r) => r.bouncesInPeriod);

  // Scale globals (timeline, SMS, suppression totals) by the share of
  // accounts in scope. Keeps ratios realistic without per-account
  // breakdowns for those dimensions.
  const scaleRatio = scopedMockAccounts.length / MOCK_ACCOUNTS.length;
  const scale = (n: number) => Math.round(n * scaleRatio);

  const scaledSpamReports = scale(full.kpis.emailSpamReports);

  const kpis: PortfolioKpis = {
    accountsTotal: accountHealth.length,
    accountsActive: accountHealth.filter((r) => r.sentInPeriod > 0).length,
    contactsTotal: sumHealth((r) => r.contactCount),
    contactsAdded: scale(full.kpis.contactsAdded),
    emailsSent: sent,
    smsSent: scale(full.kpis.smsSent),
    emailDelivered: delivered,
    emailOpens: opens,
    emailClicks: clicks,
    emailBounces: bounces,
    emailSpamReports: scaledSpamReports,
    emailUnsubscribes: scale(full.kpis.emailUnsubscribes),
    smsDelivered: scale(full.kpis.smsDelivered),
    smsFailed: scale(full.kpis.smsFailed),
    smsStops: scale(full.kpis.smsStops),
    emailDeliveryRate: sent > 0 ? delivered / sent : 0,
    emailOpenRate: delivered > 0 ? opens / delivered : 0,
    emailClickRate: delivered > 0 ? clicks / delivered : 0,
    emailBounceRate: sent > 0 ? bounces / sent : 0,
    emailSpamRate: delivered > 0 ? scaledSpamReports / delivered : 0,
    smsDeliveryRate: full.kpis.smsDeliveryRate,
    suppressionsAdded: sumHealth((r) => r.suppressionGrowth),
  };

  const timeline = full.timeline.map((p) => ({
    date: p.date,
    emailDelivered: scale(p.emailDelivered),
    emailOpens: scale(p.emailOpens),
    emailClicks: scale(p.emailClicks),
    emailBounces: scale(p.emailBounces),
    smsDelivered: scale(p.smsDelivered),
  }));

  const engagedByAccount = full.engagedContacts.engagedByAccount.filter((r) => scopedKeys.has(r.accountKey));
  const engagedContacts = {
    windowDays: full.engagedContacts.windowDays,
    engagedTotal: engagedByAccount.reduce((s, r) => s + r.engagedCount, 0),
    engagedByAccount,
  };

  const serviceByAccount = full.lifecycle.service.byAccount.filter((r) => scopedKeys.has(r.accountKey));
  const leaseByAccount = full.lifecycle.lease.byAccount.filter((r) => scopedKeys.has(r.accountKey));
  const warrantyByAccount = full.lifecycle.warranty.byAccount.filter((r) => scopedKeys.has(r.accountKey));
  const lifecycle = {
    service: {
      dueIn30: serviceByAccount.reduce((s, r) => s + r.dueIn30, 0),
      dueIn60: serviceByAccount.reduce((s, r) => s + r.dueIn60, 0),
      dueIn90: serviceByAccount.reduce((s, r) => s + r.dueIn90, 0),
      byAccount: serviceByAccount,
    },
    lease: {
      endingIn30: leaseByAccount.reduce((s, r) => s + r.endingIn30, 0),
      endingIn60: leaseByAccount.reduce((s, r) => s + r.endingIn60, 0),
      endingIn90: leaseByAccount.reduce((s, r) => s + r.endingIn90, 0),
      byAccount: leaseByAccount,
    },
    warranty: {
      expiringIn30: warrantyByAccount.reduce((s, r) => s + r.expiringIn30, 0),
      expiringIn60: warrantyByAccount.reduce((s, r) => s + r.expiringIn60, 0),
      expiringIn90: warrantyByAccount.reduce((s, r) => s + r.expiringIn90, 0),
      byAccount: warrantyByAccount,
    },
  };

  const filterCampaign = (c: { accountKeys: string[] }) => c.accountKeys.some((k) => scopedKeys.has(k));
  const pipeline = {
    scheduled: full.pipeline.scheduled.filter(filterCampaign),
    inFlight: full.pipeline.inFlight.filter(filterCampaign),
    recentlyFailed: full.pipeline.recentlyFailed.filter(filterCampaign),
  };

  const anomalies = full.anomalies.filter((a) => scopedKeys.has(a.accountKey));
  const topCampaigns = full.topCampaigns.filter(filterCampaign);
  const activity = full.activity.filter((a) => scopedKeys.has(a.accountKey));
  const repPerformance =
    role === 'super_admin' || role === 'developer'
      ? full.repPerformance.filter((r) => scopedRepIds.has(r.repId))
      : [];

  const suppression = {
    emailTotal: scale(full.suppression.emailTotal),
    smsTotal: scale(full.suppression.smsTotal),
    emailAddedInPeriod: scale(full.suppression.emailAddedInPeriod),
    smsAddedInPeriod: scale(full.suppression.smsAddedInPeriod),
    emailReasons: full.suppression.emailReasons.map((r) => ({ reason: r.reason, count: scale(r.count) })),
    smsReasons: full.suppression.smsReasons.map((r) => ({ reason: r.reason, count: scale(r.count) })),
  };

  const metaPacer = full.metaPacer.filter((r) => scopedKeys.has(r.accountKey));

  return {
    meta: { ...full.meta, accountKeys: requestedKeys },
    kpis,
    timeline,
    engagedContacts,
    lifecycle,
    pipeline,
    accountHealth,
    anomalies,
    topCampaigns,
    activity,
    repPerformance,
    suppression,
    metaPacer,
    errors: {},
  };
}
