'use client';

/**
 * `{{variable}}` text editing — the control the ad builder's inspector uses for
 * any text an element shows, extracted so the EMAIL builder can use the same one.
 *
 * WHY SHARED RATHER THAN REBUILT. Connor's call: binding data into a design
 * should feel identical on both sides. A second implementation would drift on
 * the details that make it usable — the `{{` autocomplete, the pill rendering,
 * the scroll-synced overlay — and a designer moving between an ad plate and an
 * offer email would have to learn it twice.
 *
 * The behaviour: type freely, drop `{{tokens}}` inline (via the icon or by
 * typing `{{`), and they render as coloured pills that resolve to live values.
 * Text is NOT a whole-field binding — a line can mix copy and data, which is
 * exactly what an offer card needs ("Lease a {{vehicleName}} for {{_offerMain}}").
 */
import * as React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, VariableIcon } from '@heroicons/react/24/outline';
import { offerTypePill } from '@/lib/ad-generator/offer-type-style';

/**
 * What a brand-new text box says before anybody types in it.
 *
 * Lives here because two behaviours depend on it: inserting a variable REPLACES
 * the placeholder rather than appending to it. Young's designers asked for that —
 * "it will save a lot of disclaimers from accidentally starting with 'new text'"
 * — and they were describing real published ads.
 */
export const NEW_TEXT_PLACEHOLDER = 'New text';
import { type SearchableSelectOption } from '@/components/flows/builder/SearchableSelect';

/** A variable the picker offers, plus what it means and resolves to. */
export type ContentSource = SearchableSelectOption & {
  /** One line on what the variable is for. */
  hint?: string;
  /** A typical value, when the field itself suggests one. */
  example?: string;
  /** Offer types this field fills for — absent means every type. Carries the
   *  type's own value so the pill can wear that type's colour. */
  offerTypes?: { value: string; label: string }[];
  /** What it resolves to right now, from the live preview data. */
  sample?: string;
};

const VAR_GROUP_NOTE: Record<string, string> = {
  'Computed offer text': 'Assembled from whichever offer type the ad runs — use these when one design has to serve lease, APR and cash.',
  Offer: 'Typed per ad. A badge means the field only fills for those offer types — on any other type it renders empty.',
};
/** Groups the picker leads with, most useful first. */
const VAR_GROUP_ORDER = ['Computed offer text', 'Offer', 'Vehicle', 'Copy', 'Brand', 'Custom'];
const VAR_GROUP_RANK = (g: string) => {
  const i = VAR_GROUP_ORDER.indexOf(g);
  return i < 0 ? VAR_GROUP_ORDER.length : i;
};

/**
 * A pill on a variable row: one offer type the field fills for, in that type's
 * own colour — the same palette as the canvas's offer-type preview tabs, so
 * "this is the APR one" is the same violet in both places.
 */
function VarBadge({ type, children }: { type: string; children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight"
      style={offerTypePill(type)}
    >
      {children}
    </span>
  );
}

export function TokenTextArea({
  value,
  onChange,
  placeholder,
  options = [],
  onTokenClick,
  scopeNote,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Field tokens offered by a `{{` autocomplete (value `field:<key>`). */
  options?: ContentSource[];
  /** Clicking inside a `{{token}}` calls this with the token key — the caller
   *  jumps to that field in the Fields panel. */
  onTokenClick?: (key: string) => void;
  /** Why the variable list is shorter than usual — the element's "Show for"
   *  scope. Said out loud so a filtered list doesn't read as a broken one. */
  scopeNote?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(0);
  const syncScroll = () => {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  // Once the user drags the resize grip, their height wins and we stop auto-sizing.
  const autoHRef = useRef(0);
  const [manualH, setManualH] = useState<number | null>(null);
  // Auto-grow to fit the content (up to a generous cap, then scroll) so a long
  // value is never clipped. The textarea drives the wrapper height and the
  // backdrop fills it (inset-0), so both grow together. The user can also drag
  // the grip to any height — that overrides auto-growing (see onPointerUp).
  useLayoutEffect(() => {
    if (manualH != null) return; // user took control of the height
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    // box-sizing:border-box → the height must include the border, or the last
    // line clips by the border width; add (offsetHeight - clientHeight) back.
    const chrome = ta.offsetHeight - ta.clientHeight;
    const cap = Math.max(200, Math.round(window.innerHeight * 0.6));
    const h = Math.min(ta.scrollHeight + chrome, cap);
    ta.style.height = `${h}px`;
    autoHRef.current = h;
    syncScroll();
  }, [value, manualH]);
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    escHtml(value).replace(
      /\{\{\s*[\w.]+\s*\}\}/g,
      (m) => `<span class="rounded bg-[var(--primary)]/15 font-medium text-[var(--primary)]">${m}</span>`,
    ) + '​';

  // Autocomplete: an OPEN `{{` (optionally with a partial key) right before the
  // caret, not yet closed by `}}`. Show matching field tokens; picking inserts
  // `{{key}}`. Typing `{{` alone lists everything.
  const openTok = /\{\{\s*([\w.]*)$/.exec(value.slice(0, caret));
  const partial = openTok ? openTok[1].toLowerCase() : null;
  const matches =
    partial == null
      ? []
      : options.filter((o) => {
          const key = o.value.replace(/^field:/, '');
          return key.toLowerCase().includes(partial) || o.label.toLowerCase().includes(partial);
        }).slice(0, 8);
  const showAc = acOpen && matches.length > 0;

  const insert = (opt: SearchableSelectOption) => {
    const key = opt.value.replace(/^field:/, '');
    const start = caret - (openTok?.[0].length ?? 0);
    const injected = `{{${key}}}`;
    const next = value.slice(0, start) + injected + value.slice(caret);
    onChange(next);
    setAcOpen(false);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = start + injected.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  // Variable picker (the top-right icon): insert `{{key}}` at the caret (or end),
  // with a space if needed so it doesn't glue onto the previous word.
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const pickRef = useRef<HTMLDivElement>(null);
  const pickMatches = options.filter((o) => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      o.value.replace(/^field:/, '').toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (o.hint ?? '').toLowerCase().includes(q)
    );
  });
  // Grouped, with the offer tokens FIRST: on a template that has to carry lease
  // and apr and cash, those are the only variables that fill for all of them, and
  // burying them mid-list is what made this a guessing game. The rest keep the
  // order the schema declares.
  const pickGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, ContentSource[]>();
    for (const o of pickMatches) {
      const g = o.group || 'Fields';
      const list = byGroup.get(g);
      if (list) list.push(o);
      else {
        byGroup.set(g, [o]);
        order.push(g);
      }
    }
    order.sort((a, b) => VAR_GROUP_RANK(a) - VAR_GROUP_RANK(b));
    return order.map((group) => ({ group, note: VAR_GROUP_NOTE[group], items: byGroup.get(group)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, pickQuery]);
  useEffect(() => {
    if (!pickOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setPickOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickOpen]);
  const insertToken = (opt: SearchableSelectOption) => {
    const key = opt.value.replace(/^field:/, '');
    // An untouched placeholder is REPLACED, not appended to: nobody means "New
    // text {{disclaimer}}", and that is how a legal line ends up starting with
    // "New text" on a live ad.
    const untouched = value.trim() === NEW_TEXT_PLACEHOLDER;
    const base = untouched ? '' : value;
    const pos = untouched ? 0 : Math.min(caret || base.length, base.length);
    const before = base.slice(0, pos);
    const after = base.slice(pos);
    const injected = `${before && !/\s$/.test(before) ? ' ' : ''}{{${key}}}`;
    onChange(before + injected + after);
    setPickOpen(false);
    setPickQuery('');
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const p = pos + injected.length;
      ta.focus();
      ta.setSelectionRange(p, p);
      setCaret(p);
    });
  };

  return (
    <div className="relative">
      <div
        ref={backRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent bg-[var(--card)] px-2 py-1.5 text-xs leading-normal text-[var(--foreground)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        ref={taRef}
        value={value}
        // An untouched placeholder is selected on focus, so typing replaces it
        // rather than typing around it. The same reason the token insert replaces
        // it: nobody wants a disclaimer that starts "New text".
        onFocus={(e) => {
          if (value.trim() === NEW_TEXT_PLACEHOLDER) e.currentTarget.select();
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          setAcOpen(true);
          setAcIdx(0);
        }}
        onClick={(e) => {
          // Clicking into an untouched placeholder selects it, so the first thing
          // typed replaces it. Doing this on focus alone did not survive: this
          // handler runs immediately after and would put the caret back.
          if (value.trim() === NEW_TEXT_PLACEHOLDER) {
            (e.target as HTMLTextAreaElement).select();
            setCaret(0);
            return;
          }
          const pos = (e.target as HTMLTextAreaElement).selectionStart ?? 0;
          setCaret(pos);
          // Clicking inside a {{token}} jumps to its field. Scan the value for the
          // token whose range contains the caret.
          if (onTokenClick) {
            const re = /\{\{\s*([\w.]+)\s*\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(value))) {
              if (pos > m.index && pos < m.index + m[0].length) {
                onTokenClick(m[1]);
                break;
              }
            }
          }
        }}
        onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0); }}
        onKeyDown={(e) => {
          if (!showAc) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((i) => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[Math.min(acIdx, matches.length - 1)]); }
          else if (e.key === 'Escape') { e.preventDefault(); setAcOpen(false); }
        }}
        onScroll={syncScroll}
        onPointerUp={() => {
          // Detect a manual drag of the resize grip: if the height no longer
          // matches what auto-grow set, the user owns it from here on.
          const ta = taRef.current;
          if (ta && Math.abs(ta.offsetHeight - autoHRef.current) > 2) setManualH(ta.offsetHeight);
        }}
        onBlur={() => setTimeout(() => setAcOpen(false), 120)}
        rows={2}
        placeholder={placeholder}
        spellCheck={false}
        className="relative block min-h-[3.25rem] max-h-[80vh] w-full resize-y overflow-y-auto rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 pr-8 text-xs leading-normal text-transparent caret-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
      />
      {options.length > 0 && (
        <div ref={pickRef} className="absolute right-1.5 top-1.5">
          <button
            type="button"
            title="Insert a variable"
            onClick={() => setPickOpen((o) => !o)}
            className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
              pickOpen ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
            } bg-[var(--card)]`}
          >
            <VariableIcon className="h-3.5 w-3.5" />
          </button>
          {pickOpen && (
            /* Width is capped by the inspector panel: it scrolls vertically, so
               anything wider than the panel is simply clipped off the left. */
            <div className="absolute right-0 top-full z-[90] mt-1 w-[15.5rem] rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-2xl backdrop-blur-2xl">
              <div className="relative mb-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="Search variables…"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-1 pl-7 pr-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              {scopeNote && (
                <p className="mb-1 rounded-md bg-[var(--primary)]/10 px-2 py-1 text-[10px] leading-snug text-[var(--primary)]">
                  {scopeNote}
                </p>
              )}
              <ul className="max-h-[22rem] overflow-y-auto">
                {pickGroups.length === 0 && <li className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">No variables</li>}
                {pickGroups.map(({ group, note, items }) => (
                  <li key={group}>
                    <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      {group}
                    </p>
                    {note && (
                      <p className="px-2.5 pb-1 text-[10px] leading-snug text-[var(--muted-foreground)]">{note}</p>
                    )}
                    <ul>
                      {items.map((o) => (
                        <li key={o.value}>
                          <button
                            type="button"
                            onClick={() => insertToken(o)}
                            className="group/var w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--muted)]"
                          >
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{o.label}</span>
                              {/* What it renders RIGHT NOW. The sample is the
                                  whole explanation for "amount" vs "number". */}
                              {(o.sample ?? o.example) && (
                                <span className="max-w-[45%] shrink-0 truncate rounded bg-[var(--muted)]/60 px-1.5 py-px font-mono text-[10px] text-[var(--foreground)] group-hover/var:bg-[var(--background)]">
                                  {o.sample ?? o.example}
                                </span>
                              )}
                            </span>
                            {/* Type badges only where they carry information: in
                                the computed group every row fills for every type,
                                and the heading already says so. */}
                            {(o.offerTypes?.length || o.hint) && (
                              <span className="mt-0.5 flex flex-wrap items-baseline gap-1">
                                {o.offerTypes?.map((t) => (
                                  <VarBadge key={t.value} type={t.value}>
                                    {t.label}
                                  </VarBadge>
                                ))}
                                {o.hint && (
                                  <span className="text-[10px] leading-snug text-[var(--muted-foreground)]">{o.hint}</span>
                                )}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {showAc && (
        <ul className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-2xl backdrop-blur-2xl">
          {matches.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insert(o); }}
                onMouseEnter={() => setAcIdx(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  i === Math.min(acIdx, matches.length - 1) ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {/* The live value beats the group name here: it's what tells you
                    this is the one you meant. */}
                <span
                  className={`ml-auto shrink-0 font-mono text-[10px] ${
                    i === Math.min(acIdx, matches.length - 1) ? 'text-white/80' : 'text-[var(--muted-foreground)]'
                  }`}
                >
                  {o.sample ?? o.example ?? o.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}