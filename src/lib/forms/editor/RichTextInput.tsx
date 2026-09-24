'use client';

import * as React from 'react';
import { CodeBracketIcon, DocumentTextIcon, LinkIcon } from '@heroicons/react/24/outline';
import { Collapse } from '@/components/ui/collapse';
import { sanitizeInlineHtml } from '../sanitize-inline';
import { ColorInput, ToggleGroup } from './PropertyControls';
import { LinkDialog, type LinkValue } from './LinkDialog';

/**
 * Editor for the inline-HTML text props (Consent text, Text block with
 * "Allow HTML" on). Two views over the same stored string:
 *
 *  - Text: a contentEditable preview of the markup — links look like
 *    links, and the toolbar writes bold / italic / underline, text color
 *    and links (through LinkDialog) for you.
 *  - Code: the raw markup in a monospace box, for pasting or tweaking
 *    attributes by hand.
 *
 * Both write the same sanitized inline subset the renderer accepts, so
 * nothing typed here can produce markup the public page would drop.
 */

type View = 'text' | 'code';

const VIEW_OPTIONS: { value: View; label: React.ReactNode; title: string }[] = [
  { value: 'text', label: <DocumentTextIcon className="w-3.5 h-3.5" />, title: 'Text view' },
  { value: 'code', label: <CodeBracketIcon className="w-3.5 h-3.5" />, title: 'Code view' },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const isColor = (c: string) => !!c && typeof CSS !== 'undefined' && CSS.supports('color', c);

/** `rgb(25, 124, 194)` → `#197cc2`, so the native color picker can show it. */
function toHex(color: string): string {
  const m = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return color;
  return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function setElementColor(el: HTMLElement, color: string) {
  el.style.color = isColor(color) ? color : '';
  if (!el.getAttribute('style')) el.removeAttribute('style');
}

export function RichTextInput({
  value,
  onChange,
  placeholder,
  inputClass,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputClass: string;
}) {
  const [view, setView] = React.useState<View>('text');
  const editorRef = React.useRef<HTMLDivElement>(null);
  // The last string this editor emitted. When `value` comes back equal to
  // it, the DOM already shows it — rewriting innerHTML would reset the caret.
  const emittedRef = React.useRef<string | null>(null);
  // Opening the link dialog or the color row moves focus out of the
  // editor, which drops the selection — keep it to put back on apply.
  const savedRangeRef = React.useRef<Range | null>(null);
  const [link, setLink] = React.useState<{ initial: LinkValue; editing: boolean } | null>(null);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [color, setColor] = React.useState('');

  React.useEffect(() => {
    if (view !== 'text') return;
    const el = editorRef.current;
    if (!el || value === emittedRef.current) return;
    el.innerHTML = sanitizeInlineHtml(value, { linkDefaults: false });
    emittedRef.current = value;
  }, [value, view]);

  // While the color row is open, a new selection in the editor is what
  // Apply should color — not the one that was current when it opened.
  React.useEffect(() => {
    if (!colorOpen) return;
    const track = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, [colorOpen]);

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    const next = sanitizeInlineHtml(el.innerHTML, { linkDefaults: false });
    emittedRef.current = next;
    onChange(next);
  };

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const saveSelection = (): Range | null => {
    const sel = window.getSelection();
    const range =
      sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    savedRangeRef.current = range;
    return range;
  };

  const restoreSelection = () => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    el.focus();
    sel.removeAllRanges();
    if (savedRangeRef.current) {
      sel.addRange(savedRangeRef.current);
    } else {
      // No caret yet — work at the end.
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      sel.addRange(end);
    }
  };

  /** The nearest `selector` match around the range start, inside this editor. */
  const closestInEditor = <T extends HTMLElement>(range: Range | null, selector: string): T | null => {
    if (!range) return null;
    const node = range.startContainer;
    const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const match = start?.closest<T>(selector);
    // `closest` can climb to the editor itself (a style on the box) — skip it.
    return match && match !== (editorRef.current as HTMLElement | null) && editorRef.current?.contains(match)
      ? match
      : null;
  };

  /** Elements the (restored) selection touches — for color changes. */
  const touched = (selector: string): HTMLElement[] => {
    const sel = window.getSelection();
    const el = editorRef.current;
    if (!sel || !el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(selector)).filter((n) => sel.containsNode(n, true));
  };

  // ── Links ──────────────────────────────────────────────────────

  const openLink = () => {
    setColorOpen(false);
    const range = saveSelection();
    const existing = closestInEditor<HTMLAnchorElement>(range, 'a');
    setLink({
      editing: !!existing,
      initial: existing
        ? {
            text: existing.textContent ?? '',
            url: existing.getAttribute('href') ?? '',
            color: existing.style.color ? toHex(existing.style.color) : '',
          }
        : { text: range?.toString() ?? '', url: '', color: '' },
    });
  };

  const applyLink = ({ text, url, color: linkColor }: LinkValue) => {
    setLink(null);
    restoreSelection();
    const range = savedRangeRef.current;
    const existing = closestInEditor<HTMLAnchorElement>(range, 'a');
    if (existing) {
      existing.setAttribute('href', url);
      if (text !== existing.textContent) existing.textContent = text;
      setElementColor(existing, linkColor);
      emit();
    } else if (range && !range.collapsed && text === range.toString()) {
      // Same words as selected: link them in place, keeping any bold etc.
      document.execCommand('createLink', false, url);
      touched('a').forEach((a) => a.getAttribute('href') === url && setElementColor(a, linkColor));
      emit();
    } else {
      const style = isColor(linkColor) ? ` style="color: ${escapeHtml(linkColor)}"` : '';
      exec('insertHTML', `<a href="${escapeHtml(url)}"${style}>${escapeHtml(text)}</a>`);
    }
  };

  const removeLink = () => {
    setLink(null);
    restoreSelection();
    const existing = closestInEditor<HTMLAnchorElement>(savedRangeRef.current, 'a');
    if (existing) {
      const range = document.createRange();
      range.selectNodeContents(existing);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    exec('unlink');
  };

  const cancelLink = () => {
    setLink(null);
    restoreSelection();
  };

  // ── Text color ─────────────────────────────────────────────────

  const toggleColor = () => {
    if (colorOpen) {
      setColorOpen(false);
      return;
    }
    const range = saveSelection();
    const colored = closestInEditor<HTMLElement>(range, '[style*="color"]');
    setColor(colored?.style.color ? toHex(colored.style.color) : '');
    setColorOpen(true);
  };

  const applyColor = () => {
    if (!isColor(color)) return;
    restoreSelection();
    // Without styleWithCSS Chrome writes <font color>, which the inline
    // sanitizer drops — a styled span survives it.
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, color);
    document.execCommand('styleWithCSS', false, 'false');
    emit();
    setColorOpen(false);
  };

  const resetColor = () => {
    restoreSelection();
    touched('[style*="color"]').forEach((n) => setElementColor(n, ''));
    emit();
    setColor('');
    setColorOpen(false);
  };

  // ── Keyboard + paste ───────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // A bare Enter would wrap lines in <div>s the inline sanitizer drops.
    if (e.key === 'Enter') {
      e.preventDefault();
      exec('insertLineBreak');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Rich paste drags in fonts, divs and tracking spans — take the text.
    e.preventDefault();
    exec('insertText', e.clipboardData.getData('text/plain'));
  };

  const toolButton =
    'inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors';
  // mousedown would move focus out of the editor and drop the selection.
  const keepSelection = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div
          className={`flex items-center gap-0.5 transition-opacity duration-150 ${
            view === 'text' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          inert={view !== 'text'}
        >
          <button type="button" className={`${toolButton} font-bold`} title="Bold (⌘B)" onMouseDown={keepSelection} onClick={() => exec('bold')}>
            B
          </button>
          <button type="button" className={`${toolButton} italic`} title="Italic (⌘I)" onMouseDown={keepSelection} onClick={() => exec('italic')}>
            I
          </button>
          <button type="button" className={`${toolButton} underline`} title="Underline (⌘U)" onMouseDown={keepSelection} onClick={() => exec('underline')}>
            U
          </button>
          <button
            type="button"
            className={`${toolButton} ${colorOpen ? 'bg-[var(--muted)] text-[var(--foreground)]' : ''}`}
            title="Text color"
            aria-expanded={colorOpen}
            onMouseDown={keepSelection}
            onClick={toggleColor}
          >
            <span className="relative font-semibold leading-none">
              A
              <span
                className="absolute -left-0.5 -right-0.5 -bottom-1 h-[3px] rounded-sm transition-colors"
                style={{ background: isColor(color) ? color : 'currentColor' }}
              />
            </span>
          </button>
          <button type="button" className={toolButton} title="Link (⌘K)" onMouseDown={keepSelection} onClick={openLink}>
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="w-[52px] flex-shrink-0">
          <ToggleGroup
            value={view}
            onChange={(v) => {
              setColorOpen(false);
              // Force the Text view to repaint from the (possibly hand-edited) value.
              if (v === 'text') emittedRef.current = null;
              setView(v);
            }}
            options={VIEW_OPTIONS}
            size="xs"
          />
        </div>
      </div>

      {/* Not clipped: the color picker's swatch panel hangs below the row. */}
      <Collapse open={colorOpen && view === 'text'} clip={false}>
        <div className="flex items-center gap-1.5 pb-1">
          <div className="flex-1 min-w-0">
            <ColorInput value={color} onChange={setColor} />
          </div>
          <button
            type="button"
            onClick={applyColor}
            disabled={!isColor(color)}
            className="h-9 px-2.5 rounded-md text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Apply
          </button>
          <button type="button" onClick={resetColor} className={`${toolButton} h-9`} title="Remove the color from the selected text">
            Reset
          </button>
        </div>
      </Collapse>

      {view === 'text' ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          data-placeholder={placeholder}
          onInput={emit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={`${inputClass} animate-fade-in-up min-h-[84px] max-h-[320px] overflow-y-auto leading-[1.5] break-words [&_a]:underline [&_a]:underline-offset-2 empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--muted-foreground)]`}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={`${inputClass} animate-fade-in-up resize-y font-mono text-[12px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]`}
          placeholder={placeholder}
        />
      )}

      {link && (
        <LinkDialog
          initial={link.initial}
          editing={link.editing}
          onApply={applyLink}
          onRemove={removeLink}
          onCancel={cancelLink}
        />
      )}
    </div>
  );
}
