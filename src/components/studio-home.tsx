'use client';

/**
 * Studio home — the creative-tools landing page used at both
 * `/dashboard` and `/subaccount/[slug]/dashboard`. Analytics moved to
 * the reporting surface, so this page is now purely "what would you
 * like to build today?" — an AI campaign builder hero (visual
 * placeholder, real generation lives on the roadmap) plus quick links
 * into each builder.
 *
 * The hero deliberately mirrors the flow builder's empty-state hero
 * (`EmptyStateNodes.tsx`) — same aurora backdrop, rainbow gradient
 * orb, beam-wrapped textarea, preset chips — so creating a flow and
 * creating a multi-channel campaign feel like the same surface in
 * different contexts.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  ArrowUpIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  MegaphoneIcon,
  PhotoIcon,
  RectangleStackIcon,
  SparklesIcon,
  UserGroupIcon,
  UserPlusIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { useAccount } from '@/contexts/account-context';
import { toast } from '@/lib/toast';

// ── Animated placeholder examples ──
// Same typewriter cycle as the flow empty-state hero, but tuned for
// multi-channel campaign prompts since this surface produces emails +
// SMS + flows + LPs together rather than a single flow.
const ANIMATED_EXAMPLES = [
  'Re-engage customers who haven\'t opened the last 3 emails…',
  'Service reminder for anyone who hasn\'t been in for 6+ months.',
  'Build a Memorial Day weekend sale: email + SMS + landing page.',
  'New-lead welcome: 3 emails over 5 days with a final SMS.',
  'Lease ends in 60 days? Start a trade-in nudge series.',
];

const TYPE_SPEED_MS = 32;
const DELETE_SPEED_MS = 16;
const PAUSE_AT_FULL_MS = 2200;
const PAUSE_AT_EMPTY_MS = 350;

// ── Preset chips ──
// Match the flow hero's tone palette so the two surfaces feel coordinated.
interface CampaignPreset {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

const CAMPAIGN_PRESETS: CampaignPreset[] = [
  { label: 'Welcome series', Icon: UserPlusIcon, tone: 'bg-sky-100 text-sky-600' },
  { label: 'Service follow-up', Icon: WrenchScrewdriverIcon, tone: 'bg-emerald-100 text-emerald-600' },
  { label: 'Email campaigns', Icon: EnvelopeIcon, tone: 'bg-rose-100 text-rose-500' },
];

// ── Quick links ──
interface QuickLink {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone:
    | 'primary'
    | 'sky'
    | 'violet'
    | 'amber'
    | 'emerald'
    | 'rose'
    | 'zinc'
    | 'cyan';
}

const TONE_CLASSES: Record<
  QuickLink['tone'],
  { bg: string; text: string; border: string }
> = {
  primary: { bg: 'bg-[var(--primary)]/10', text: 'text-[var(--primary)]', border: 'hover:border-[var(--primary)]/40' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'hover:border-sky-400/40' },
  violet:  { bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'hover:border-violet-400/40' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'hover:border-amber-400/40' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'hover:border-emerald-400/40' },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'hover:border-rose-400/40' },
  zinc:    { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    border: 'hover:border-zinc-400/40' },
  cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    border: 'hover:border-cyan-400/40' },
};

function buildQuickLinks(prefix: string): QuickLink[] {
  // `prefix` is `''` in admin mode and `/subaccount/<slug>` in sub-account
  // mode so the destinations stay on the active surface.
  return [
    {
      href: `${prefix}/messaging/campaigns`,
      label: 'Build a Campaign',
      description: 'Email, SMS, or MMS sends across one or more sub-accounts.',
      icon: ChatBubbleLeftRightIcon,
      tone: 'primary',
    },
    {
      href: `${prefix}/flows`,
      label: 'Design a Flow',
      description: 'Trigger-based drip series — welcome, lifecycle, win-back.',
      icon: FlowIcon as React.ComponentType<{ className?: string }>,
      tone: 'violet',
    },
    {
      href: `${prefix}/email/templates`,
      label: 'Email Templates',
      description: 'Reusable email designs that any campaign can drop in.',
      icon: EnvelopeIcon,
      tone: 'sky',
    },
    {
      href: `${prefix}/websites/landing-pages`,
      label: 'Landing Pages',
      description: 'Standalone marketing pages with embedded form capture.',
      icon: RectangleStackIcon,
      tone: 'emerald',
    },
    {
      href: `${prefix}/websites/forms`,
      label: 'Forms',
      description: 'Lead capture surfaces — embed anywhere, route into Loomi.',
      icon: DocumentTextIcon,
      tone: 'cyan',
    },
    {
      href: `${prefix}/websites`,
      label: 'Websites',
      description: 'All public surfaces — landing pages, forms, snippets.',
      icon: GlobeAltIcon,
      tone: 'amber',
    },
    {
      href: `${prefix}/contacts`,
      label: 'Contacts',
      description: 'Manage lists, segments, and per-contact lifecycle.',
      icon: UserGroupIcon,
      tone: 'rose',
    },
    {
      href: '/tools/meta/ad-planner', // Tools are global (no sub-account prefix today)
      label: 'Ad Planner',
      description: 'Plan Meta ad spend by funnel stage and audience.',
      icon: MegaphoneIcon,
      tone: 'zinc',
    },
    {
      href: `${prefix}/media`,
      label: 'Media Library',
      description: 'Shared assets — images, logos, brand files.',
      icon: PhotoIcon,
      tone: 'sky',
    },
  ];
}

export function StudioHome({ prefix = '' }: { prefix?: string }) {
  const { data: session } = useSession();
  const { accountData, isAccount } = useAccount();
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';
  const accountLabel = isAccount && accountData?.dealer ? accountData.dealer : 'your accounts';

  // Animated typewriter placeholder — same cadence as the flow hero.
  const [placeholder, setPlaceholder] = useState('');
  const phaseRef = useRef<'typing' | 'pause-full' | 'deleting' | 'pause-empty'>('typing');
  const exampleIdxRef = useRef(0);
  const charIdxRef = useRef(0);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const example = ANIMATED_EXAMPLES[exampleIdxRef.current];
      const phase = phaseRef.current;
      if (phase === 'typing') {
        if (charIdxRef.current < example.length) {
          charIdxRef.current += 1;
          setPlaceholder(example.slice(0, charIdxRef.current));
          timeoutId = setTimeout(tick, TYPE_SPEED_MS);
        } else {
          phaseRef.current = 'pause-full';
          timeoutId = setTimeout(tick, PAUSE_AT_FULL_MS);
        }
      } else if (phase === 'pause-full') {
        phaseRef.current = 'deleting';
        timeoutId = setTimeout(tick, DELETE_SPEED_MS);
      } else if (phase === 'deleting') {
        if (charIdxRef.current > 0) {
          charIdxRef.current -= 1;
          setPlaceholder(example.slice(0, charIdxRef.current));
          timeoutId = setTimeout(tick, DELETE_SPEED_MS);
        } else {
          phaseRef.current = 'pause-empty';
          timeoutId = setTimeout(tick, PAUSE_AT_EMPTY_MS);
        }
      } else {
        exampleIdxRef.current = (exampleIdxRef.current + 1) % ANIMATED_EXAMPLES.length;
        phaseRef.current = 'typing';
        timeoutId = setTimeout(tick, TYPE_SPEED_MS);
      }
    };
    timeoutId = setTimeout(tick, TYPE_SPEED_MS);
    return () => clearTimeout(timeoutId);
  }, []);

  const handleComingSoon = () => {
    toast.info(
      'AI campaign builder is on the roadmap — keep an eye on the changelog.',
    );
  };

  const quickLinks = buildQuickLinks(prefix);

  return (
    <div className="animate-fade-in-up">
      {/* Welcome */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Build something new for {accountLabel}. Analytics live in{' '}
          <span className="font-medium text-[var(--foreground)]">Reporting</span>.
        </p>
      </header>

      {/* AI hero — visual parity with the flow builder's empty-state hero
          (`EmptyStateNodes.tsx`). Same aurora backdrop, rainbow orb,
          beam-wrapped textarea, preset chips. Generation isn't wired
          yet; the button fires a toast pointing at the roadmap. */}
      <section className="relative mb-12 flex justify-center">
        <div className="relative w-full max-w-[640px]">
          {/* Aurora — five independently-drifting colour blobs sitting
              behind the content (same iris-aurora-blob-X classes as the
              flow hero). */}
          <div aria-hidden className="absolute -inset-32 pointer-events-none">
            <span className="iris-aurora-blob iris-aurora-blob-1" />
            <span className="iris-aurora-blob iris-aurora-blob-2" />
            <span className="iris-aurora-blob iris-aurora-blob-3" />
            <span className="iris-aurora-blob iris-aurora-blob-4" />
            <span className="iris-aurora-blob iris-aurora-blob-5" />
          </div>

          <div className="relative p-7 space-y-5">
            {/* Title row */}
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex items-center gap-2.5">
                <div className="iris-rainbow-gradient w-9 h-9 rounded-full flex items-center justify-center shadow-md">
                  <SparklesIcon className="w-5 h-5 text-zinc-900" />
                </div>
                <h2 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">
                  Create a campaign with AI
                </h2>
                <span className="iris-rainbow-gradient text-[9px] uppercase tracking-[0.12em] font-bold px-2 py-1 rounded-md text-zinc-900 shadow-sm">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                Describe what you want to promote and Loomi will draft email,
                SMS, and landing-page touchpoints together.
              </p>
            </div>

            {/* Input — rainbow beam border + card-strong inner fill, same
                wrapper classes as the flow hero. Disabled until the AI
                campaign builder ships; clicking submit fires the
                "coming soon" toast. */}
            <div className="iris-beam-wrap rounded-2xl">
              <div className="relative bg-[var(--card-strong)] rounded-2xl">
                <textarea
                  disabled
                  placeholder={placeholder}
                  rows={3}
                  className="w-full resize-none px-4 py-3.5 pr-14 text-sm bg-transparent rounded-2xl text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none leading-relaxed disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={handleComingSoon}
                  title="Coming soon"
                  className="iris-rainbow-gradient absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center text-white opacity-60 hover:opacity-80 transition-all shadow-md"
                >
                  <ArrowUpIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Preset chips — same shape + tones as the flow hero. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {CAMPAIGN_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={handleComingSoon}
                  className="inline-flex items-center gap-1.5 pl-1.5 pr-3.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-all"
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center ${preset.tone}`}
                  >
                    <preset.Icon className="w-3 h-3" />
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--foreground)]">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Builder quick links */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Or pick a tool
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((link, i) => {
            const t = TONE_CLASSES[link.tone];
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`glass-card group relative flex items-start gap-3 rounded-xl p-5 transition animate-fade-in-up animate-stagger-${Math.min(i + 1, 6)} border border-transparent ${t.border}`}
              >
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.text}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">
                      {link.label}
                    </h3>
                    <ArrowRightIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    {link.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
