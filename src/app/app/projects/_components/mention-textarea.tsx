'use client';

import { useRef, useState, type ReactNode } from 'react';
import { UserAvatar } from '@/components/user-avatar';

export type MentionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** Collect the ids of users @-mentioned in `text` (matches `@Full Name`). */
export function extractMentions(text: string, users: MentionUser[]): string[] {
  const ids = new Set<string>();
  for (const u of users) {
    if (u.name && text.includes(`@${u.name}`)) ids.add(u.id);
  }
  return [...ids];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render comment body with @mentions shown as inline avatar+name chips. */
export function MentionText({ text, users }: { text: string; users: MentionUser[] }): ReactNode {
  const named = users.filter((u) => u.name);
  if (named.length === 0) return text;
  const byName = new Map(named.map((u) => [u.name, u]));
  const re = new RegExp(`@(${named.map((u) => escapeRegExp(u.name)).join('|')})`, 'g');
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const u = byName.get(m[1])!;
    out.push(
      <span
        key={i++}
        className="mx-0.5 inline-flex items-center gap-1 rounded bg-[var(--primary)]/15 px-1 py-0.5 align-middle text-[0.8125rem] font-medium text-[var(--primary)]"
      >
        <UserAvatar
          name={u.name}
          email={u.email}
          avatarUrl={u.avatarUrl}
          size={14}
          className="rounded-full"
        />
        {u.name}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// ── Caret pixel position (mirror-div technique) ────────────────────────
const MIRROR_PROPS = [
  'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize',
] as const;

function caretCoords(el: HTMLTextAreaElement, position: number) {
  const div = document.createElement('div');
  const computed = getComputedStyle(el);
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  for (const p of MIRROR_PROPS) {
    div.style[p] = computed[p];
  }
  div.textContent = el.value.slice(0, position);
  const span = document.createElement('span');
  span.textContent = el.value.slice(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop + parseInt(computed.borderTopWidth || '0', 10);
  const left = span.offsetLeft + parseInt(computed.borderLeftWidth || '0', 10);
  const height = parseInt(computed.lineHeight || '18', 10);
  document.body.removeChild(div);
  return { top, left, height };
}

export function MentionTextarea({
  value,
  onChange,
  users,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  users: MentionUser[];
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{
    query: string;
    at: number;
    left: number;
    top: number | null;
    bottom: number | null;
    up: boolean;
  } | null>(null);
  const [hi, setHi] = useState(0);

  const matches = menu
    ? users.filter((u) => u.name.toLowerCase().includes(menu.query.toLowerCase())).slice(0, 6)
    : [];

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    const v = el.value;
    onChange(v);
    const pos = el.selectionStart ?? v.length;
    const m = /(?:^|\s)@(\S*)$/.exec(v.slice(0, pos));
    if (m) {
      const at = pos - m[1].length - 1; // index of the '@'
      const c = caretCoords(el, at);
      const anchorTop = c.top - el.scrollTop; // caret line top within the wrapper
      const left = Math.max(0, c.left - el.scrollLeft - 12); // arrow (~12px in) aligns under @

      // Flip above the @ when there isn't room below in the viewport.
      const rect = el.getBoundingClientRect();
      const count = Math.max(
        1,
        users.filter((u) => u.name.toLowerCase().includes(m[1].toLowerCase())).slice(0, 6).length,
      );
      const estHeight = Math.min(300, 52 + count * 44);
      const caretViewportTop = rect.top + anchorTop;
      const spaceBelow = window.innerHeight - (caretViewportTop + c.height);
      const up = spaceBelow < estHeight && caretViewportTop > spaceBelow;

      setMenu({
        query: m[1],
        at,
        left,
        up,
        top: up ? null : anchorTop + c.height + 8,
        bottom: up ? el.offsetHeight - anchorTop + 8 : null,
      });
      setHi(0);
    } else {
      setMenu(null);
    }
  }

  function pick(u: MentionUser) {
    if (!menu) return;
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, menu.at);
    const after = value.slice(cursor);
    const inserted = `@${u.name} `;
    onChange(before + inserted + after);
    setMenu(null);
    requestAnimationFrame(() => {
      const p = (before + inserted).length;
      ref.current?.focus();
      ref.current?.setSelectionRange(p, p);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!menu || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(matches.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(matches[hi]);
    } else if (e.key === 'Escape') {
      setMenu(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
        rows={rows}
        placeholder={placeholder}
        className="loomi-input resize-y"
      />
      {menu && matches.length > 0 && (
        <div
          className="absolute z-30 w-64"
          style={{ top: menu.top ?? undefined, bottom: menu.bottom ?? undefined, left: menu.left }}
        >
          {/* arrow pointing at the @ — above the list when below, under it when flipped up */}
          {menu.up ? (
            <div className="absolute -bottom-1.5 left-3 h-3 w-3 rotate-45 border-b border-r border-[var(--border)] bg-[var(--card-strong)]" />
          ) : (
            <div className="absolute -top-1.5 left-3 h-3 w-3 rotate-45 border-l border-t border-[var(--border)] bg-[var(--card-strong)]" />
          )}
          <div className="relative max-h-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl backdrop-saturate-150">
            <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              People
            </p>
            <ul className="max-h-52 overflow-y-auto p-1">
              {matches.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(u);
                    }}
                    onMouseEnter={() => setHi(i)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      i === hi
                        ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    <UserAvatar
                      name={u.name}
                      email={u.email}
                      avatarUrl={u.avatarUrl}
                      size={24}
                      className="rounded-full flex-shrink-0"
                    />
                    <span className="truncate">{u.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
