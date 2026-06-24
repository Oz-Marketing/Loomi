'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  CodeBracketIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DocumentPlusIcon,
  PhotoIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { LandingPageHtmlTemplate } from '../types';
import EmbeddedFormBlock from '../components/EmbeddedForm';
import { InsertEmbedModal, type InsertEmbedTab } from './InsertEmbedModal';
import { LpAiPanel } from './LpAiPanel';

const MOBILE_PREVIEW_WIDTH = 390;
const PREVIEW_DEBOUNCE_MS = 300;

// Resizable editor pane — mirrors the blocks editor's sidebar
// resize pattern. The Monaco pane is the "sidebar"; the preview
// takes the remaining space.
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MAX_WIDTH = 1200;
const EDITOR_DEFAULT_WIDTH = 560;
const EDITOR_STEP_PX = 24;

interface LandingPageHtmlEditorShellProps {
  template: LandingPageHtmlTemplate;
  onChange: (next: LandingPageHtmlTemplate) => void;
  /** Landing-page id — used by the Iris tab to reach its chat endpoint. */
  pageId: string;
  /** Account key for the LP — scopes the Media + Forms tabs in the
   *  Insert modal so the user only sees their subaccount's assets. */
  accountKey: string | null;
  /** Undo/redo plumbing from the builder page. Surfaced in the action
   *  bar — Monaco's internal undo also works (Cmd/Ctrl-Z), but the
   *  buttons let users see what's available. */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

/**
 * HTML-mode editor for landing pages. Monaco on the left, sandboxed
 * iframe preview on the right. Form embeds are wired via the
 * `<div data-loomi-form="<id>"></div>` placeholder — the action bar
 * has an "Insert form" picker that injects the tag at the Monaco
 * cursor, and the preview swaps each placeholder for a labeled card
 * so users can see the embed in place without booting a live form.
 */
export function LandingPageHtmlEditorShell({
  template,
  onChange,
  pageId,
  accountKey,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: LandingPageHtmlEditorShellProps) {
  const [previewDevice, setPreviewDevice] = React.useState<'desktop' | 'mobile'>('desktop');
  const [insertModalTab, setInsertModalTab] = React.useState<InsertEmbedTab | null>(null);
  // Left pane toggles between the raw HTML editor and the Iris chat. Both share
  // the resizable pane width; the preview on the right stays visible for both,
  // so Iris's edits render live as the user chats.
  const [leftTab, setLeftTab] = React.useState<'html' | 'iris'>('html');
  const editorRef = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  // ── Resizable editor pane (matches the blocks editor's pattern) ──
  const [editorWidth, setEditorWidth] = React.useState(EDITOR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeStartRef = React.useRef<{ x: number; width: number } | null>(null);

  const clampEditorWidth = React.useCallback(
    (desired: number) =>
      Math.round(Math.min(Math.max(desired, EDITOR_MIN_WIDTH), EDITOR_MAX_WIDTH)),
    [],
  );

  const handleResizerMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeStartRef.current = { x: e.clientX, width: editorWidth };
      setIsResizing(true);
    },
    [editorWidth],
  );

  const adjustEditorWidth = React.useCallback(
    (delta: number) => setEditorWidth((prev) => clampEditorWidth(prev + delta)),
    [clampEditorWidth],
  );

  React.useEffect(() => {
    if (!isResizing || typeof window === 'undefined') return;
    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setEditorWidth(clampEditorWidth(start.width + (e.clientX - start.x)));
    };
    const stopResizing = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
    };
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('blur', stopResizing);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('blur', stopResizing);
    };
  }, [isResizing, clampEditorWidth]);

  // Debounce the iframe srcDoc — full document re-parse on every
  // keystroke would lag at scale.
  const [debouncedHtml, setDebouncedHtml] = React.useState(template.html);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedHtml(template.html), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [template.html]);

  const handleEditorMount: OnMount = (ed) => {
    editorRef.current = ed;
  };

  const handleHtmlChange = (next: string | undefined) => {
    onChange({ ...template, html: next ?? '' });
  };

  const insertAtCursor = (text: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const sel = ed.getSelection();
    if (!sel) return;
    ed.executeEdits('lp-html-insert', [
      { range: sel, text, forceMoveMarkers: true },
    ]);
    ed.focus();
  };

  return (
    <div className="flex w-full h-full min-h-0 flex-col gap-3">
      <ActionBar
        previewDevice={previewDevice}
        onChangePreviewDevice={setPreviewDevice}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      <InsertEmbedModal
        open={insertModalTab !== null}
        defaultTab={insertModalTab ?? 'media'}
        accountKey={accountKey}
        onClose={() => setInsertModalTab(null)}
        onInsert={(snippet) => insertAtCursor(snippet)}
      />

      <div className="flex-1 min-h-0 flex gap-3">
        <div
          className="min-h-0 flex-shrink-0 flex flex-col gap-2"
          style={{ width: `${editorWidth}px` }}
        >
          {/* Left-pane header: tab switcher, plus the insert actions for the
              HTML editor (hidden on the Iris tab — they only target Monaco). */}
          <div className="flex items-center justify-between gap-2 flex-shrink-0">
            <LeftPaneTabs tab={leftTab} onChange={setLeftTab} />
            {leftTab === 'html' && (
              <div className="flex items-center gap-0.5">
                <ActionIconButton
                  label="Insert media"
                  icon={<PhotoIcon className="w-4 h-4" />}
                  onClick={() => setInsertModalTab('media')}
                />
                <ActionIconButton
                  label="Insert form"
                  icon={<DocumentPlusIcon className="w-4 h-4" />}
                  onClick={() => setInsertModalTab('forms')}
                />
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 relative">
            {/* HTML editor — kept mounted (hidden, never unmounted) when the
                Iris tab is active so the Monaco cursor and insertAtCursor keep
                working, and so "Insert form/media" still target the editor. */}
            <div
              className={`absolute inset-0 border border-[var(--border)] rounded-xl overflow-hidden bg-[#1e1e1e] ${
                leftTab === 'html' ? '' : 'hidden'
              }`}
            >
              <Editor
                defaultLanguage="html"
                value={template.html}
                onChange={handleHtmlChange}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={{
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  insertSpaces: true,
                  automaticLayout: true,
                  bracketPairColorization: { enabled: true },
                  autoClosingBrackets: 'always',
                  autoClosingQuotes: 'always',
                  renderLineHighlight: 'line',
                  padding: { top: 12 },
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>

            {/* Iris chat — applies its HTML through onChange / insertAtCursor so
                autosave + undo/redo are shared with manual edits. The panel
                owns its own rounded corners + rainbow border (see
                .ai-assist-panel), so this wrapper only positions it — adding a
                border/rounding here would double up and clip the ring. */}
            <div
              className={`absolute inset-0 ${leftTab === 'iris' ? '' : 'hidden'}`}
            >
              <LpAiPanel
                pageId={pageId}
                getHtml={() => template.html}
                onReplaceHtml={(html) => onChange({ ...template, html })}
                onInsertHtml={insertAtCursor}
              />
            </div>
          </div>
        </div>

        {/* Resize handle — drag to widen/narrow the editor pane.
            Keyboard-accessible (Arrow keys when focused) and matches
            the blocks editor's separator pattern. */}
        <div
          role="separator"
          aria-label="Resize editor and preview panes"
          aria-orientation="vertical"
          aria-valuenow={editorWidth}
          aria-valuemin={EDITOR_MIN_WIDTH}
          aria-valuemax={EDITOR_MAX_WIDTH}
          tabIndex={0}
          onMouseDown={handleResizerMouseDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              adjustEditorWidth(-EDITOR_STEP_PX);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              adjustEditorWidth(EDITOR_STEP_PX);
            }
          }}
          className={`group flex-shrink-0 self-stretch w-2 -mx-1 rounded cursor-col-resize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
            isResizing ? 'bg-[var(--primary)]/15' : 'hover:bg-[var(--muted)]'
          }`}
          title="Drag to resize"
        >
          <span
            className={`mx-auto block h-full w-[2px] rounded-full transition-colors ${
              isResizing
                ? 'bg-[var(--primary)]'
                : 'bg-[var(--border)] group-hover:bg-[var(--primary)]'
            }`}
          />
        </div>

        <div className="flex-1 min-w-0 min-h-0 border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--muted)]/40 flex flex-col">
          <PreviewPane html={debouncedHtml} device={previewDevice} />
        </div>
      </div>
    </div>
  );
}

// ── Left-pane tabs (HTML ⇄ Iris) ───────────────────────────────────

function LeftPaneTabs({
  tab,
  onChange,
}: {
  tab: 'html' | 'iris';
  onChange: (t: 'html' | 'iris') => void;
}) {
  return (
    <div className="inline-flex items-center self-start rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5 flex-shrink-0">
      <LeftPaneTabButton
        active={tab === 'html'}
        onClick={() => onChange('html')}
        icon={<CodeBracketIcon className="w-3.5 h-3.5" />}
        label="HTML"
      />
      <LeftPaneTabButton
        active={tab === 'iris'}
        onClick={() => onChange('iris')}
        icon={<SparklesIcon className="w-3.5 h-3.5" />}
        label="Iris"
      />
    </div>
  );
}

function LeftPaneTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
        active
          ? 'bg-[var(--primary)] text-white'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Action bar ─────────────────────────────────────────────────────

function ActionBar({
  previewDevice,
  onChangePreviewDevice,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  previewDevice: 'desktop' | 'mobile';
  onChangePreviewDevice: (d: 'desktop' | 'mobile') => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 flex-shrink-0">
      {/* Undo/redo sit over the editor (left); the device toggle sits over
          the preview (right). */}
      <div className="flex items-center gap-0.5">
        {onUndo && (
          <ActionIconButton
            label="Undo"
            shortcut="⌘Z"
            disabled={!canUndo}
            onClick={onUndo}
            icon={<ArrowUturnLeftIcon className="w-4 h-4" />}
          />
        )}
        {onRedo && (
          <ActionIconButton
            label="Redo"
            shortcut="⌘⇧Z"
            disabled={!canRedo}
            onClick={onRedo}
            icon={<ArrowUturnRightIcon className="w-4 h-4" />}
          />
        )}
      </div>

      <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5">
        <PreviewToggleButton
          active={previewDevice === 'desktop'}
          onClick={() => onChangePreviewDevice('desktop')}
          title="Desktop preview"
          icon={<ComputerDesktopIcon className="w-3.5 h-3.5" />}
          label="Desktop"
        />
        <PreviewToggleButton
          active={previewDevice === 'mobile'}
          onClick={() => onChangePreviewDevice('mobile')}
          title="Mobile preview"
          icon={<DevicePhoneMobileIcon className="w-3.5 h-3.5" />}
          label="Mobile"
        />
      </div>
    </div>
  );
}

function ActionIconButton({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
    </button>
  );
}

function PreviewToggleButton({
  active,
  onClick,
  title,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
        active
          ? 'bg-[var(--primary)] text-white'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Preview pane ───────────────────────────────────────────────────

/**
 * The preview is a same-origin iframe we populate programmatically:
 * the parent React app writes the user's HTML into the iframe doc,
 * then createPortal-mounts the real EmbeddedFormBlock into each
 * `[data-loomi-form]` placeholder inside the iframe. That gives users
 * a fully interactive form in the preview — same behavior they'll get
 * on the published page — without re-implementing form rendering for
 * the editor.
 *
 * The iframe is same-origin (no srcDoc, no `sandbox` attribute) so
 * the parent can reach into `contentDocument`. The user's content
 * runs in the parent's origin, which is fine for an editor preview
 * (they're previewing their own page; there is no cross-site trust
 * boundary to defend).
 *
 * Mobile preview is implemented by narrowing the iframe's container
 * width — the iframe's own viewport meta tag picks up the responsive
 * styles the user wrote.
 */
function PreviewPane({
  html,
  device,
}: {
  html: string;
  device: 'desktop' | 'mobile';
}) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [portals, setPortals] = React.useState<PortalTarget[]>([]);

  // Whenever the (debounced) HTML changes, rewrite the iframe doc
  // and rediscover form placeholders. Each rewrite tears down the
  // previous portal targets (their host elements are detached), so
  // we replace `portals` wholesale rather than diffing.
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    // open() drops any previous content; write() injects fresh
    // markup; close() finalizes. This is the standard pattern for
    // programmatically populating an iframe.
    doc.open();
    doc.write(buildPreviewDocument(html));
    doc.close();

    // Empty each placeholder so the live form doesn't render
    // alongside any user-typed inner content, then collect the
    // host elements for the cross-frame portals.
    const targets: PortalTarget[] = [];
    doc.querySelectorAll<HTMLElement>('[data-loomi-form]').forEach((el, idx) => {
      const formId = el.getAttribute('data-loomi-form');
      if (!formId) return;
      el.innerHTML = '';
      targets.push({ key: `${formId}-${idx}`, el, formId });
    });
    setPortals(targets);
  }, [html]);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--muted)]/30 p-4">
      <div
        className="bg-white shadow-sm mx-auto h-full"
        style={{
          maxWidth: device === 'mobile' ? `${MOBILE_PREVIEW_WIDTH}px` : '100%',
          transition: 'max-width 150ms ease',
        }}
      >
        <iframe
          ref={iframeRef}
          title="HTML preview"
          className="w-full h-full border-0 bg-white"
          style={{ minHeight: 600 }}
        />
      </div>

      {/* Cross-frame portals — these render the live, interactive
          EmbeddedFormBlock into each placeholder inside the iframe.
          The form's SWR fetch goes to /api/forms/[id] (auth'd, since
          the editor is auth'd) so the schema arrives without any
          extra plumbing. */}
      {portals.map(({ key, el, formId }) =>
        createPortal(<EmbeddedFormBlock formId={formId} />, el, key),
      )}
    </div>
  );
}

interface PortalTarget {
  key: string;
  el: HTMLElement;
  formId: string;
}

/** Minimal document shell for the preview iframe. The body inherits
 *  the user's HTML verbatim. We inject only the tiny media-query
 *  stylesheet that the form components need for responsive column
 *  stacking — the rest of the form is inline-styled, so no Tailwind
 *  or app stylesheets are required for the form to look right. */
function buildPreviewDocument(html: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; }
    @media (max-width: 500px) {
      .loomi-form-root .loomi-form-stack {
        flex-basis: 100% !important;
        width: 100% !important;
      }
      .loomi-form-root [data-form-columns-row] {
        flex-direction: column !important;
      }
    }
  </style>
</head>
<body>${html}</body>
</html>`;
}

