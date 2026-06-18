'use client';

/**
 * §9 Alert Rules settings tab — tune the config-driven alert engine without a
 * redeploy. Admins enable/disable rules and adjust their thresholds, tier, and
 * cooldown. Structural fields (metric, resource, baseline type) are fixed at
 * seed time and shown read-only. Elevated roles only — gated in settings/page.tsx
 * and again by the PUT /api/alert-rules/[id] route.
 *
 * Today the evaluable rules are Meta FIXED-threshold (account pace, budget burn);
 * Google-metric rules (rolling/period/duration baselines) appear here as rows
 * once the Google Ads API is connected (§8), tunable but flagged not-yet-running.
 */
import { useEffect, useState } from 'react';
import PrimaryButton from '@/components/primary-button';
import { toast } from '@/lib/toast';

interface AlertRule {
  id: string;
  key: string;
  name: string;
  description: string | null;
  channel: string;
  metric: string;
  resource: string;
  baselineType: string;
  baselineParams: string;
  fireCondition: string;
  tier: string;
  minVolumeGate: number | null;
  cooldownHours: number;
  phase: number;
  enabled: boolean;
}

interface Draft {
  enabled: boolean;
  tier: string;
  cooldownHours: string;
  minVolumeGate: string;
  comparator: string;
  value: string;
  low: string;
  high: string;
  minDaysLeft: string;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toDraft(r: AlertRule): Draft {
  const fc = safeParse(r.fireCondition);
  const bp = safeParse(r.baselineParams);
  const numStr = (v: unknown) => (typeof v === 'number' ? String(v) : '');
  return {
    enabled: r.enabled,
    tier: r.tier,
    cooldownHours: String(r.cooldownHours),
    minVolumeGate: r.minVolumeGate == null ? '' : String(r.minVolumeGate),
    comparator: typeof fc.comparator === 'string' ? fc.comparator : 'gt',
    value: numStr(fc.value),
    low: numStr(fc.low),
    high: numStr(fc.high),
    minDaysLeft: numStr(bp.minDaysLeft),
  };
}

export function AlertRulesTab() {
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/alert-rules')
      .then((r) => r.json())
      .then((d) => {
        const list: AlertRule[] = Array.isArray(d.rules) ? d.rules : [];
        setRules(list);
        setDrafts(Object.fromEntries(list.map((r) => [r.id, toDraft(r)])));
      })
      .catch(() => setLoadError('Failed to load alert rules'));
  }, []);

  function patch(id: string, p: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  }

  async function save(rule: AlertRule) {
    const d = drafts[rule.id];
    if (!d) return;

    // Reconstruct fireCondition from the per-comparator inputs.
    const fc: Record<string, unknown> = { comparator: d.comparator };
    if (d.comparator === 'outside' || d.comparator === 'inside') {
      fc.low = Number(d.low);
      fc.high = Number(d.high);
      if (!Number.isFinite(fc.low as number) || !Number.isFinite(fc.high as number)) {
        toast.error('Enter both band bounds.');
        return;
      }
    } else {
      fc.value = Number(d.value);
      if (!Number.isFinite(fc.value as number)) {
        toast.error('Enter a threshold value.');
        return;
      }
    }

    // Merge minDaysLeft back into the existing baselineParams (preserve others).
    const bp = safeParse(rule.baselineParams);
    if (d.minDaysLeft.trim() !== '') {
      const n = Number(d.minDaysLeft);
      if (!Number.isInteger(n) || n < 0) {
        toast.error('Min days left must be a whole number.');
        return;
      }
      bp.minDaysLeft = n;
    }

    const cooldown = Number(d.cooldownHours);
    if (!Number.isInteger(cooldown) || cooldown < 0) {
      toast.error('Cooldown must be a whole number of hours.');
      return;
    }

    const body = {
      enabled: d.enabled,
      tier: d.tier,
      cooldownHours: cooldown,
      minVolumeGate: d.minVolumeGate.trim() === '' ? null : Number(d.minVolumeGate),
      fireCondition: JSON.stringify(fc),
      baselineParams: JSON.stringify(bp),
    };

    setSavingId(rule.id);
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to save rule');
        return;
      }
      const updated: AlertRule = data.rule;
      setRules((rs) => rs?.map((r) => (r.id === rule.id ? updated : r)) ?? rs);
      setDrafts((dm) => ({ ...dm, [rule.id]: toDraft(updated) }));
      toast.success(`Saved "${updated.name}".`);
    } catch {
      toast.error('Failed to save rule');
    } finally {
      setSavingId(null);
    }
  }

  if (loadError) {
    return <div className="text-center py-16 text-sm text-red-400">{loadError}</div>;
  }
  if (!rules) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">Loading alert rules…</p>
      </div>
    );
  }
  if (rules.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--muted-foreground)]">
          No alert rules seeded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        Config-driven monitoring (§9). Each rule fires a notification off
        Loomi&apos;s trusted pacing numbers — only on live, allocated, in-flight
        campaigns, and never more often than its cooldown. Tune thresholds here;
        no redeploy needed.
      </p>

      {rules.map((rule) => {
        const d = drafts[rule.id];
        if (!d) return null;
        const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(rule));
        const isFixed = rule.baselineType === 'FIXED';
        const isBand = d.comparator === 'outside' || d.comparator === 'inside';
        const hasMinDaysLeft = safeParse(rule.baselineParams).minDaysLeft !== undefined;

        return (
          <RuleCard
            key={rule.id}
            rule={rule}
            draft={d}
            dirty={dirty}
            isFixed={isFixed}
            isBand={isBand}
            hasMinDaysLeft={hasMinDaysLeft}
            saving={savingId === rule.id}
            onPatch={(p) => patch(rule.id, p)}
            onSave={() => save(rule)}
          />
        );
      })}
    </div>
  );
}

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'urgent' | 'warn' }) {
  const cls =
    tone === 'urgent'
      ? 'bg-red-500/10 text-red-400 border-red-500/30'
      : tone === 'warn'
        ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
        : 'bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

const FIELD =
  'rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--primary)]';
const SMALL_LABEL = 'block text-[10px] font-medium text-[var(--muted-foreground)] mb-1';

function RuleCard({
  rule,
  draft,
  dirty,
  isFixed,
  isBand,
  hasMinDaysLeft,
  saving,
  onPatch,
  onSave,
}: {
  rule: AlertRule;
  draft: Draft;
  dirty: boolean;
  isFixed: boolean;
  isBand: boolean;
  hasMinDaysLeft: boolean;
  saving: boolean;
  onPatch: (p: Partial<Draft>) => void;
  onSave: () => void;
}) {
  return (
    <section className="glass-section-card rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{rule.name}</h3>
            <Badge tone={draft.tier === 'URGENT' ? 'urgent' : 'warn'}>{draft.tier}</Badge>
            <Badge>{rule.channel}</Badge>
            {rule.phase === 2 && <Badge>phase 2</Badge>}
            {!draft.enabled && <Badge>off</Badge>}
          </div>
          {rule.description && (
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {rule.description}
            </p>
          )}
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            {rule.metric} · {rule.resource} · {rule.baselineType}
          </p>
        </div>
        <label className="flex items-center gap-2 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <span className="text-xs text-[var(--muted-foreground)]">Enabled</span>
        </label>
      </div>

      {!isFixed && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
          This baseline type needs a metric history Loomi doesn&apos;t have yet —
          it activates once the Google Ads API is connected (§8). You can still set
          its tier, cooldown, and enable state now.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {isFixed && isBand && (
          <>
            <div>
              <label className={SMALL_LABEL}>Under below (%)</label>
              <input
                className={`${FIELD} w-[110px]`}
                inputMode="decimal"
                value={draft.low}
                onChange={(e) => onPatch({ low: e.target.value })}
              />
            </div>
            <div>
              <label className={SMALL_LABEL}>Over above (%)</label>
              <input
                className={`${FIELD} w-[110px]`}
                inputMode="decimal"
                value={draft.high}
                onChange={(e) => onPatch({ high: e.target.value })}
              />
            </div>
          </>
        )}
        {isFixed && !isBand && (
          <div>
            <label className={SMALL_LABEL}>Threshold ({draft.comparator})</label>
            <input
              className={`${FIELD} w-[120px]`}
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => onPatch({ value: e.target.value })}
            />
          </div>
        )}
        {hasMinDaysLeft && (
          <div>
            <label className={SMALL_LABEL}>Min days left</label>
            <input
              className={`${FIELD} w-[100px]`}
              inputMode="numeric"
              value={draft.minDaysLeft}
              onChange={(e) => onPatch({ minDaysLeft: e.target.value })}
            />
          </div>
        )}
        <div>
          <label className={SMALL_LABEL}>Tier</label>
          <select
            className={`${FIELD} w-[110px]`}
            value={draft.tier}
            onChange={(e) => onPatch({ tier: e.target.value })}
          >
            <option value="URGENT">URGENT</option>
            <option value="FYI">FYI</option>
          </select>
        </div>
        <div>
          <label className={SMALL_LABEL}>Cooldown (h)</label>
          <input
            className={`${FIELD} w-[90px]`}
            inputMode="numeric"
            value={draft.cooldownHours}
            onChange={(e) => onPatch({ cooldownHours: e.target.value })}
          />
        </div>
        <div>
          <label className={SMALL_LABEL}>Min volume ($)</label>
          <input
            className={`${FIELD} w-[110px]`}
            inputMode="decimal"
            placeholder="none"
            value={draft.minVolumeGate}
            onChange={(e) => onPatch({ minVolumeGate: e.target.value })}
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          {dirty && <span className="text-xs font-medium text-amber-500">Unsaved</span>}
          <PrimaryButton onClick={onSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </div>
    </section>
  );
}
