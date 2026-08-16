'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, PlusIcon, TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Select } from '@/components/select';
import { SYSTEM_FIELDS } from '@/lib/ad-generator/system-fields';
import { OFFER_TYPES } from '@/lib/ad-generator/offer-text';
import {
  RULE_KIND_META,
  suggestRuleId,
  validatePack,
  packIsValid,
  type DraftPack,
  type DraftRule,
  type RuleKind,
} from '@/lib/ad-generator/coop-rule-authoring';
import type { LimitTerm } from '@/lib/ad-generator/coop-rules';

/**
 * Writing down what a manufacturer's guidelines require.
 *
 * The person using this has read the PDF; the tool's job is to let them say what
 * it requires without writing a seed script, and to refuse anything it couldn't
 * actually check. It deliberately does NOT read the document and propose rules —
 * a plausible but wrong threshold is worse than a missing one, because nobody
 * goes looking for it.
 *
 * Two guards worth knowing about:
 *   - Fields are PICKED from the real schema, never typed. A field key with a
 *     typo produces a rule that matches nothing and reports nothing, which looks
 *     exactly like compliance.
 *   - Saving retracts verification. The sign-off says a person checked THESE
 *     rules; changing them makes that false.
 */

/** Fields a rule can name. Brand values aren't in the field schema but are the
 *  things co-op rules care about most, so they're offered alongside. */
const BRAND_KEYS = [
  { key: 'logoUrl', label: 'Brand logo' },
  { key: 'dealerName', label: 'Dealer name' },
  { key: 'eventLogoUrl', label: 'Sales event logo' },
];

const FIELD_OPTIONS = [
  ...BRAND_KEYS.map((b) => ({ value: b.key, label: b.label })),
  ...SYSTEM_FIELDS.map((f) => ({ value: f.key, label: f.label })),
];

const blankRule = (make: string, taken: string[]): DraftRule => ({
  id: suggestRuleId(make, 'new rule', taken),
  kind: 'banned_phrase',
  severity: 'error',
  description: '',
  citation: '',
  offerTypes: [],
});

export function CoopPackEditor({
  make,
  initial,
  onClose,
  onSaved,
}: {
  make: string;
  /** Editing an existing pack, or undefined to author a new one. */
  initial?: DraftPack;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pack, setPack] = useState<DraftPack>(
    () => initial ?? { make, version: '', source: '', rules: [] },
  );
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const problems = useMemo(() => validatePack(pack), [pack]);
  const valid = packIsValid(problems);

  const setRule = (id: string, patch: Partial<DraftRule>) =>
    setPack((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const addRule = () => {
    const r = blankRule(make, pack.rules.map((x) => x.id));
    setPack((p) => ({ ...p, rules: [...p.rules, r] }));
    setOpenRule(r.id);
  };

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      toast.error('Some rules are incomplete.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ad-generator/oem-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_pack', ...pack }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; unverified?: boolean };
      if (!res.ok) {
        toast.error(d.error || 'Could not save the rules.');
        return;
      }
      toast.success(
        d.unverified
          ? 'Rules saved. Approval was withdrawn because the rules changed — re-approve when you have re-checked them.'
          : 'Rules saved. They warn until someone approves them for enforcement.',
      );
      onSaved();
      onClose();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    // z-260: opened from the Co-op Guidelines tab, which lives inside the
    // Agency Settings modal (z-200) — at 200 this would sit behind it.
    <div className="fixed inset-0 z-[260] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => !saving && onClose()}>
      <div
        className="my-8 w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {initial ? 'Edit' : 'New'} {make} rules
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Write down what the guidelines require. Every rule needs the section it came from — that
              is what a dealer sees when an ad is blocked.
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        {/* ── the document these came from ── */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[var(--foreground)]">Guideline edition</span>
            <input
              value={pack.version}
              onChange={(e) => setPack((p) => ({ ...p, version: e.target.value }))}
              placeholder="2026-Q3"
              className={inputClass}
            />
            <span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">
              Packs are versioned, never overwritten — last quarter&rsquo;s ads stay explicable.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[var(--foreground)]">Document</span>
            <input
              value={pack.source}
              onChange={(e) => setPack((p) => ({ ...p, source: e.target.value }))}
              placeholder="Mazda MCAP Guidelines, Aug 2025"
              className={inputClass}
            />
          </label>
        </div>

        {/* ── rules ── */}
        <div className="mt-5 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Rules ({pack.rules.length})
          </h3>
          <button onClick={addRule} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] hover:border-[var(--primary)]">
            <PlusIcon className="h-3 w-3" /> Add rule
          </button>
        </div>

        {pack.rules.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
            No rules yet. Add only what the document actually states — a rule nobody can point at is
            worse than a missing one.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {pack.rules.map((r) => {
              const errs = showErrors ? problems.rules[r.id] ?? [] : [];
              const meta = RULE_KIND_META.find((m) => m.kind === r.kind);
              const open = openRule === r.id;
              return (
                <div key={r.id} className={`rounded-xl border ${errs.length ? 'border-rose-500/40' : 'border-[var(--border)]'}`}>
                  <button
                    onClick={() => setOpenRule(open ? null : r.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-[var(--foreground)]">
                        {r.description || <span className="text-[var(--muted-foreground)]">Untitled rule</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {meta?.label} · {r.severity === 'error' ? 'can block' : 'warns only'}
                        {r.citation ? ` · ${r.citation}` : ''}
                      </div>
                    </div>
                    {errs.length > 0 && <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 text-rose-500" />}
                  </button>

                  {open && (
                    <div className="space-y-3 border-t border-[var(--border)] p-3">
                      <RuleForm rule={r} onChange={(patch) => setRule(r.id, patch)} />
                      {errs.length > 0 && (
                        <ul className="space-y-1 rounded-lg bg-rose-500/10 px-3 py-2">
                          {errs.map((e) => (
                            <li key={e} className="text-[11px] text-rose-500">{e}</li>
                          ))}
                        </ul>
                      )}
                      <button
                        onClick={() => {
                          setPack((p) => ({ ...p, rules: p.rules.filter((x) => x.id !== r.id) }));
                          setOpenRule(null);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline"
                      >
                        <TrashIcon className="h-3 w-3" /> Remove this rule
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showErrors && problems.pack.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-rose-500/10 px-3 py-2">
            {problems.pack.map((e) => (
              <li key={e} className="text-[11px] text-rose-500">{e}</li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Saved rules only <strong>warn</strong> until a person approves them for enforcement.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Cancel
            </button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save rules'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">{hint}</span>}
    </label>
  );
}

function RuleForm({ rule, onChange }: { rule: DraftRule; onChange: (p: Partial<DraftRule>) => void }) {
  const meta = RULE_KIND_META.find((m) => m.kind === rule.kind);
  return (
    <>
      <Row label="What kind of rule" hint={meta?.blurb}>
        <Select
          value={rule.kind}
          onChange={(v) => onChange({ kind: v as RuleKind })}
          previewFont={false}
          options={RULE_KIND_META.map((m) => ({ value: m.kind, label: m.label }))}
        />
      </Row>

      <Row label="What it requires" hint="Written for the person who gets blocked by it.">
        <input
          value={rule.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Finance disclaimers must state a credit qualification."
          className={inputClass}
        />
      </Row>

      <Row label="Where it says so" hint="Section and page, so a blocked ad comes with something to read.">
        <input
          value={rule.citation}
          onChange={(e) => onChange({ citation: e.target.value })}
          placeholder="MCAP Guidelines Aug 2025 — §4.2, p.11"
          className={inputClass}
        />
      </Row>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="How strict" hint={rule.severity === 'error' ? 'Blocks the ad.' : 'Shows a warning; the ad still ships.'}>
          <Select
            value={rule.severity}
            onChange={(v) => onChange({ severity: v as 'error' | 'warning' })}
            previewFont={false}
            options={[
              { value: 'error', label: 'Blocks the ad' },
              { value: 'warning', label: 'Warns only' },
            ]}
          />
        </Row>
        <Row label="Applies to" hint="Leave empty for every offer type.">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {OFFER_TYPES.map((t) => {
              const on = rule.offerTypes?.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    onChange({
                      offerTypes: on
                        ? (rule.offerTypes ?? []).filter((x) => x !== t.value)
                        : [...(rule.offerTypes ?? []), t.value],
                    })
                  }
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    on
                      ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--foreground)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Row>
      </div>

      <KindFields rule={rule} onChange={onChange} />
    </>
  );
}

/** The half of the form that depends on the rule kind. */
function KindFields({ rule, onChange }: { rule: DraftRule; onChange: (p: Partial<DraftRule>) => void }) {
  // Fields are PICKED, never typed: a key with a typo yields a rule that matches
  // nothing and reports nothing, which is indistinguishable from compliance.
  const fieldPicker = (label: string, hint?: string) => (
    <Row label={label} hint={hint}>
      <Select
        value={rule.field ?? ''}
        onChange={(v) => onChange({ field: v })}
        previewFont={false}
        options={[{ value: '', label: 'Choose…' }, ...FIELD_OPTIONS]}
      />
    </Row>
  );

  const wording = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Row label="Exact wording" hint="Matched anywhere in the text, ignoring case.">
        <input value={rule.phrase ?? ''} onChange={(e) => onChange({ phrase: e.target.value })} placeholder="approved credit" className={inputClass} />
      </Row>
      <Row label="…or a pattern" hint="For several wordings at once: approved credit|well-qualified">
        <input value={rule.pattern ?? ''} onChange={(e) => onChange({ pattern: e.target.value })} placeholder="optional" className={inputClass} />
      </Row>
    </div>
  );

  switch (rule.kind) {
    case 'required_phrase':
      return (
        <>
          {fieldPicker('Which field must contain it')}
          {wording}
        </>
      );
    case 'banned_phrase':
      return (
        <>
          {wording}
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Checked against every text field on the ad, including the AI-written copy.
          </p>
        </>
      );
    case 'required_element':
      return fieldPicker('What has to appear', 'The ad is blocked if this is missing or hidden in every size.');
    case 'min_font_size':
      return (
        <>
          {fieldPicker('Which text')}
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Minimum size (px)" hint="At the design's own canvas size.">
              <input
                value={rule.minPx ?? ''}
                onChange={(e) => onChange({ minPx: Number(e.target.value) || undefined })}
                inputMode="decimal"
                className={inputClass}
              />
            </Row>
            <Row label="…or share of the short edge" hint="0.012 = 1.2%. Transfers across ad sizes.">
              <input
                value={rule.minShortEdgeFraction ?? ''}
                onChange={(e) => onChange({ minShortEdgeFraction: Number(e.target.value) || undefined })}
                inputMode="decimal"
                className={inputClass}
              />
            </Row>
          </div>
        </>
      );
    case 'element_zone': {
      const z = rule.zone ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
      const setZ = (k: keyof typeof z, v: string) => onChange({ zone: { ...z, [k]: Number(v) || 0 } });
      return (
        <>
          {fieldPicker('What has to stay inside')}
          <Row label="Area" hint="Fractions of the ad: 0,0 is the top left and 1,1 the bottom right.">
            <div className="grid grid-cols-4 gap-2">
              {(['x0', 'y0', 'x1', 'y1'] as const).map((k) => (
                <div key={k}>
                  <span className="mb-0.5 block text-[10px] text-[var(--muted-foreground)]">{k}</span>
                  <input value={z[k]} onChange={(e) => setZ(k, e.target.value)} inputMode="decimal" className={inputClass} />
                </div>
              ))}
            </div>
          </Row>
        </>
      );
    }
    case 'min_element_size':
      return (
        <>
          {fieldPicker('What the minimum applies to')}
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Minimum width" hint="0.25 = a quarter of the ad's width.">
              <input value={rule.minWidthFraction ?? ''} onChange={(e) => onChange({ minWidthFraction: Number(e.target.value) || undefined })} inputMode="decimal" className={inputClass} />
            </Row>
            <Row label="Minimum height">
              <input value={rule.minHeightFraction ?? ''} onChange={(e) => onChange({ minHeightFraction: Number(e.target.value) || undefined })} inputMode="decimal" className={inputClass} />
            </Row>
          </div>
        </>
      );
    case 'numeric_limit':
      return <NumericLimitFields rule={rule} onChange={onChange} fieldPicker={fieldPicker} />;
  }
}

function NumericLimitFields({
  rule,
  onChange,
  fieldPicker,
}: {
  rule: DraftRule;
  onChange: (p: Partial<DraftRule>) => void;
  fieldPicker: (label: string, hint?: string) => React.ReactNode;
}) {
  const limits = rule.limits ?? [[]];
  const setLimits = (next: LimitTerm[][]) => onChange({ limits: next });
  const setTerm = (li: number, ti: number, patch: Partial<LimitTerm>) =>
    setLimits(limits.map((terms, i) => (i === li ? terms.map((t, j) => (j === ti ? { ...t, ...patch } : t)) : terms)));

  return (
    <>
      {fieldPicker('Which figure is limited', 'The advertised number this rule tests.')}
      <Row label="Floor or ceiling">
        <Select
          value={rule.bound ?? 'min'}
          onChange={(v) => onChange({ bound: v as 'min' | 'max' })}
          previewFont={false}
          options={[
            { value: 'min', label: 'May not go below the limit' },
            { value: 'max', label: 'May not go above the limit' },
          ]}
        />
      </Row>

      <div className="space-y-2">
        <span className="block text-[11px] font-medium text-[var(--foreground)]">How the limit is worked out</span>
        {limits.map((terms, li) => (
          <div key={li} className="rounded-lg border border-[var(--border)] p-2.5">
            {limits.length > 1 && (
              <div className="mb-1.5 text-[10px] text-[var(--muted-foreground)]">Limit {li + 1}</div>
            )}
            <div className="space-y-1.5">
              {terms.map((t, ti) => (
                <div key={ti} className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
                  <Select
                    value={t.op ?? 'add'}
                    onChange={(v) => setTerm(li, ti, { op: v as 'add' | 'subtract' })}
                    previewFont={false}
                    options={[
                      { value: 'add', label: ti === 0 ? 'Start with' : 'plus' },
                      { value: 'subtract', label: 'minus' },
                    ]}
                  />
                  {typeof t.literal === 'number' ? (
                    <input
                      value={t.literal}
                      onChange={(e) => setTerm(li, ti, { literal: Number(e.target.value) || 0 })}
                      inputMode="decimal"
                      className={inputClass}
                    />
                  ) : (
                    <Select
                      value={t.field ?? ''}
                      onChange={(v) => setTerm(li, ti, { field: v })}
                      previewFont={false}
                      options={[{ value: '', label: 'Choose a figure…' }, ...FIELD_OPTIONS]}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setLimits(limits.map((x, i) => (i === li ? x.filter((_, j) => j !== ti) : x)))}
                    className="rounded p-1 text-[var(--muted-foreground)] hover:text-rose-500"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setLimits(limits.map((x, i) => (i === li ? [...x, { field: '' }] : x)))}
                className="text-[10px] text-[var(--primary)] hover:underline"
              >
                + a figure
              </button>
              <button
                type="button"
                onClick={() => setLimits(limits.map((x, i) => (i === li ? [...x, { literal: 0 }] : x)))}
                className="text-[10px] text-[var(--primary)] hover:underline"
              >
                + a fixed amount
              </button>
              {/* A percentage of another figure — the shape of every cap we've seen. */}
              <button
                type="button"
                onClick={() => setLimits(limits.map((x, i) => (i === li ? [...x, { field: 'msrp', factor: 0.2 }] : x)))}
                className="text-[10px] text-[var(--primary)] hover:underline"
              >
                + a percentage
              </button>
            </div>
            {terms.some((t) => t.factor != null && t.factor !== 1) && (
              <div className="mt-2 grid gap-1.5">
                {terms.map((t, ti) =>
                  t.factor != null && t.factor !== 1 ? (
                    <label key={ti} className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                      Percentage of {t.field || 'the figure'}
                      <input
                        value={Math.round((t.factor ?? 0) * 1000) / 10}
                        onChange={(e) => setTerm(li, ti, { factor: (Number(e.target.value) || 0) / 100 })}
                        inputMode="decimal"
                        className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)]"
                      />
                      %
                    </label>
                  ) : null,
                )}
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setLimits([...limits, []])} className="text-[11px] text-[var(--primary)] hover:underline">
          + another limit
        </button>
      </div>

      {/* Only meaningful with more than one candidate — and then it's required,
          because the engine refuses to guess which one governs. */}
      {limits.filter((t) => t.length > 0).length > 1 && (
        <Row label="Which limit governs" hint="The document states two; say which one applies.">
          <Select
            value={rule.select ?? ''}
            onChange={(v) => onChange({ select: v as 'lowest' | 'highest' })}
            previewFont={false}
            options={[
              { value: '', label: 'Choose…' },
              { value: 'lowest', label: 'Whichever is lower' },
              { value: 'highest', label: 'Whichever is higher' },
            ]}
          />
        </Row>
      )}
    </>
  );
}
