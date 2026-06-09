'use client';

import {
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  XMarkIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { RailFeature } from './IconRail';
import type { FlowValidationIssue } from '@/lib/flows/validation';

// Shared left-side drawer that hosts the active rail feature's content.
// Iris is mounted by FlowBuilder (it needs flow-state callbacks);
// notes / version_history are stub content for now — backend wiring
// lands in follow-ups. The error_log drawer renders live validation
// issues from the FlowBuilder.

interface FeatureDrawerProps {
  feature: Exclude<RailFeature, 'sticky_notes' | 'stats' | 'iris'>;
  onClose: () => void;
  /** Active validation issues, used when feature === 'error_log'. */
  issues?: FlowValidationIssue[];
  /** Resolves a node id to its display label (from config.label or
   *  humanised node type). Used for the issue list. */
  nodeLabel?: (nodeId: string) => string;
  /** Click handler when a user taps an issue. Focuses + centers the
   *  matching node on the canvas. */
  onFocusNode?: (nodeId: string, severity?: 'error' | 'warning') => void;
}

const FEATURE_COPY: Record<
  Exclude<RailFeature, 'sticky_notes' | 'stats' | 'iris' | 'error_log'>,
  { title: string; subtitle: string; Icon: React.ComponentType<{ className?: string }>; body: string }
> = {
  notes: {
    title: 'Notes',
    subtitle: 'Annotate this flow for yourself or your team',
    Icon: DocumentTextIcon,
    body: 'Free-form notes attached to the flow. Coming soon — for now, write context in step labels or use the description field on the flow.',
  },
  version_history: {
    title: 'Version History',
    subtitle: 'See and restore prior drafts',
    Icon: ClockIcon,
    body: 'Snapshots of the graph captured on each publish + manual save. Coming soon — for now, autosave persists every meaningful edit.',
  },
};

export function FeatureDrawer({
  feature,
  onClose,
  issues = [],
  nodeLabel,
  onFocusNode,
}: FeatureDrawerProps) {
  if (feature === 'error_log') {
    return (
      <ErrorLogDrawer
        issues={issues}
        nodeLabel={nodeLabel}
        onFocusNode={onFocusNode}
        onClose={onClose}
      />
    );
  }

  const { title, subtitle, Icon, body } = FEATURE_COPY[feature];
  return (
    <aside
      className="w-80 flex-shrink-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150"
      aria-label={title}
    >
      <DrawerHeader title={title} subtitle={subtitle} Icon={Icon} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/30 p-4">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-1.5">
            Coming soon
          </p>
          <p className="text-xs text-[var(--foreground)] leading-relaxed">{body}</p>
        </div>
      </div>
    </aside>
  );
}

function DrawerHeader({
  title,
  subtitle,
  Icon,
  onClose,
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClose: () => void;
}) {
  return (
    <header className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-2">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-md bg-[var(--muted)] flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-[var(--muted-foreground)]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
            {title}
          </h3>
          <p className="text-[11px] text-[var(--muted-foreground)] truncate">
            {subtitle}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex items-center justify-center flex-shrink-0 transition-colors"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </header>
  );
}

function ErrorLogDrawer({
  issues,
  nodeLabel,
  onFocusNode,
  onClose,
}: {
  issues: FlowValidationIssue[];
  nodeLabel?: (nodeId: string) => string;
  onFocusNode?: (nodeId: string, severity?: 'error' | 'warning') => void;
  onClose: () => void;
}) {
  const errors = issues.filter((i) => (i.severity ?? 'error') === 'error');
  const warnings = issues.filter((i) => (i.severity ?? 'error') === 'warning');

  const subtitle =
    errors.length === 0 && warnings.length === 0
      ? 'No issues — ready to publish'
      : `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;

  return (
    <aside
      className="w-80 flex-shrink-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150"
      aria-label="Error Log"
    >
      <DrawerHeader
        title="Error Log"
        subtitle={subtitle}
        Icon={ExclamationTriangleIcon}
        onClose={onClose}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {errors.length === 0 && warnings.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-4 flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-md bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <CheckCircleIcon className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">
                This flow is ready to publish
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
                No errors or warnings detected in the current graph.
              </p>
            </div>
          </div>
        ) : null}

        {errors.length > 0 && (
          <IssueSection
            label="Errors"
            sub="These block publish"
            tone="error"
            issues={errors}
            nodeLabel={nodeLabel}
            onFocusNode={onFocusNode}
          />
        )}
        {warnings.length > 0 && (
          <IssueSection
            label="Warnings"
            sub="Advisory — won't block publish"
            tone="warning"
            issues={warnings}
            nodeLabel={nodeLabel}
            onFocusNode={onFocusNode}
          />
        )}
      </div>
    </aside>
  );
}

function IssueSection({
  label,
  sub,
  tone,
  issues,
  nodeLabel,
  onFocusNode,
}: {
  label: string;
  sub: string;
  tone: 'error' | 'warning';
  issues: FlowValidationIssue[];
  nodeLabel?: (nodeId: string) => string;
  onFocusNode?: (nodeId: string, severity?: 'error' | 'warning') => void;
}) {
  const toneClasses =
    tone === 'error'
      ? { dot: 'bg-red-400', text: 'text-red-400', ring: 'border-red-500/30', iconBg: 'bg-red-500/15' }
      : { dot: 'bg-amber-400', text: 'text-amber-400', ring: 'border-amber-500/30', iconBg: 'bg-amber-500/15' };
  const Icon = tone === 'error' ? XCircleIcon : ExclamationTriangleIcon;

  return (
    <section>
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${toneClasses.dot}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${toneClasses.text}`}>
          {label}
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">· {sub}</span>
      </div>
      <ul className="space-y-2">
        {issues.map((issue, i) => {
          const isNodeIssue = !!issue.nodeId;
          const label = isNodeIssue && nodeLabel && issue.nodeId ? nodeLabel(issue.nodeId) : 'Flow';
          const clickable = isNodeIssue && typeof onFocusNode === 'function';
          return (
            <li
              key={`${issue.nodeId ?? 'flow'}-${i}`}
              className={`rounded-lg border ${toneClasses.ring} bg-[var(--card)]/60 p-3 transition-colors ${
                clickable ? 'hover:bg-[var(--muted)] cursor-pointer' : ''
              }`}
              onClick={() => {
                if (clickable && issue.nodeId) onFocusNode(issue.nodeId, tone);
              }}
            >
              <div className="flex items-start gap-2">
                <div className={`w-6 h-6 rounded-md ${toneClasses.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-3.5 h-3.5 ${toneClasses.text}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
                    {label}
                  </p>
                  <p className="text-xs text-[var(--foreground)] leading-snug mt-0.5">
                    {issue.message}
                  </p>
                  {issue.fix && (
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-snug mt-1.5">
                      <span className="font-semibold text-[var(--foreground)]">Fix: </span>
                      {issue.fix}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
