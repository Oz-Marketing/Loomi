'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { buildPreviewVariableMap, type PreviewContact } from '@/lib/preview-variables';
import {
  ArrowLeftIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  UserCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDesign(design: string) {
  return design.split('-').map(w => capitalize(w)).join(' ');
}

const FORCED_MOBILE_STYLE_ID = 'loomi-forced-mobile-styles';
const FORCED_MOBILE_NORMALIZE_STYLE_ID = 'loomi-forced-mobile-normalize';

function syncPreviewMobileStyles(doc: Document, isMobile: boolean) {
  const existing = doc.getElementById(FORCED_MOBILE_STYLE_ID) as HTMLStyleElement | null;
  if (!isMobile) {
    existing?.remove();
    return;
  }

  const forcedRules: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }

    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.MEDIA_RULE) continue;
      const mediaRule = rule as CSSMediaRule;
      if (!/max-width\s*:\s*600px/i.test(mediaRule.conditionText)) continue;
      for (const nestedRule of Array.from(mediaRule.cssRules)) {
        forcedRules.push(nestedRule.cssText);
      }
    }
  }

  if (forcedRules.length === 0) {
    existing?.remove();
    return;
  }

  const styleEl = existing || doc.createElement('style');
  styleEl.id = FORCED_MOBILE_STYLE_ID;
  styleEl.textContent = forcedRules.join('\n');
  if (!existing) doc.head?.appendChild(styleEl);
}

function syncPreviewMobileNormalizeStyle(doc: Document, isMobile: boolean) {
  const existing = doc.getElementById(FORCED_MOBILE_NORMALIZE_STYLE_ID) as HTMLStyleElement | null;
  if (!isMobile) {
    existing?.remove();
    return;
  }

  const css = `
    html, body {
      overflow-x: hidden !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    table.email-container,
    table[width="600"],
    table[width="600px"],
    table[style*="max-width: 600px"],
    table[style*="max-width:600px"] {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }
    img[width="600"],
    img[width="600px"] {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
    }
    .loomi-btn-row > td,
    .loomi-btn-gap,
    .loomi-btn-gap + td {
      display: block !important;
      width: 100% !important;
      padding-right: 0 !important;
    }
    .loomi-btn-secondary-cell,
    .loomi-btn-gap + td {
      padding-top: 10px !important;
    }
    .loomi-btn-primary,
    .loomi-btn-secondary {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      text-align: center !important;
    }
    .loomi-headline,
    .loomi-subheadline {
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    .email-container,
    .email-container table {
      table-layout: fixed !important;
    }
    td {
      min-width: 0 !important;
    }
    td, p, span, a, h1, h2, h3, h4, h5, h6, div {
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  `;

  const styleEl = existing || doc.createElement('style');
  styleEl.id = FORCED_MOBILE_NORMALIZE_STYLE_ID;
  styleEl.textContent = css;
  if (!existing) doc.head?.appendChild(styleEl);
}

function normalizePreviewMobileLayout(doc: Document, isMobile: boolean) {
  if (!isMobile) return;

  const root = doc.documentElement as HTMLElement | null;
  if (root) {
    root.style.overflowX = 'hidden';
    root.style.maxWidth = '100%';
  }
  if (doc.body) {
    doc.body.style.overflowX = 'hidden';
    doc.body.style.width = '100%';
    doc.body.style.maxWidth = '100%';
  }

  doc.querySelectorAll('table').forEach((node) => {
    const table = node as HTMLTableElement;
    const widthAttr = (table.getAttribute('width') || '').trim();
    const numericWidth = parseInt(widthAttr, 10);
    const inlineStyle = table.getAttribute('style') || '';
    const looksLikeDesktopContainer =
      (!Number.isNaN(numericWidth) && numericWidth >= 500) ||
      /max-width\s*:\s*600px/i.test(inlineStyle) ||
      table.classList.contains('email-container');
    if (!looksLikeDesktopContainer) return;
    table.setAttribute('width', '100%');
    table.style.width = '100%';
    table.style.maxWidth = '100%';
    table.style.minWidth = '0';
  });

  doc.querySelectorAll('img[width]').forEach((node) => {
    const img = node as HTMLImageElement;
    const numericWidth = parseInt(img.getAttribute('width') || '', 10);
    if (Number.isNaN(numericWidth) || numericWidth < 500) return;
    img.style.maxWidth = '100%';
    img.style.width = '100%';
    img.style.height = 'auto';
  });

  const normalizeHeroButtonRow = (row: HTMLElement) => {
    const cells = Array.from(row.children).filter(
      (child) => child.tagName.toLowerCase() === 'td',
    ) as HTMLTableCellElement[];
    cells.forEach((td, idx) => {
      td.style.display = 'block';
      td.style.width = '100%';
      td.style.paddingRight = '0';
      if (idx > 0) td.style.paddingTop = '10px';
    });
  };
  doc.querySelectorAll('.loomi-btn-row').forEach((node) => {
    normalizeHeroButtonRow(node as HTMLElement);
  });
  doc.querySelectorAll('.loomi-btn-gap').forEach((node) => {
    const td = node as HTMLTableCellElement;
    const row = td.parentElement;
    if (row && row.tagName.toLowerCase() === 'tr') {
      normalizeHeroButtonRow(row as HTMLElement);
    }
  });
  doc.querySelectorAll('.loomi-btn-primary, .loomi-btn-secondary').forEach((node) => {
    const el = node as HTMLElement;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.maxWidth = '100%';
    el.style.boxSizing = 'border-box';
    el.style.textAlign = 'center';
  });
  doc.querySelectorAll('.loomi-headline, .loomi-subheadline').forEach((node) => {
    const el = node as HTMLElement;
    el.style.overflowWrap = 'anywhere';
    el.style.wordBreak = 'break-word';
  });
}

export default function TemplatePreviewPage() {
  const params = useParams();
  const router = useRouter();
  const design = params.design as string;
  const { accountKey, accountData } = useAccount();

  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [previewContacts, setPreviewContacts] = useState<PreviewContact[]>([]);
  const [previewContactsLoading, setPreviewContactsLoading] = useState(false);
  const [previewContactsError, setPreviewContactsError] = useState('');
  const [selectedPreviewContactId, setSelectedPreviewContactId] = useState('__sample__');
  const [showCreateEmail, setShowCreateEmail] = useState(false);
  const [emailName, setEmailName] = useState('');
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState('');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const selectedPreviewContact = useMemo(
    () => previewContacts.find((c) => c.id === selectedPreviewContactId) || null,
    [previewContacts, selectedPreviewContactId],
  );

  const previewVariableMap = useMemo(
    () => buildPreviewVariableMap(accountData, selectedPreviewContact),
    [accountData, selectedPreviewContact],
  );

  const loadPreviewContacts = useCallback(async () => {
    if (!accountKey) {
      setPreviewContacts([]);
      setPreviewContactsError('');
      setSelectedPreviewContactId('__sample__');
      return;
    }

    setPreviewContactsLoading(true);
    setPreviewContactsError('');
    try {
      const res = await fetch(`/api/contacts?accountKey=${encodeURIComponent(accountKey)}&limit=30`);
      const data = await res.json();
      if (!res.ok) {
        setPreviewContacts([]);
        setPreviewContactsError(data.error || 'Unable to load contacts');
        return;
      }
      const contacts = Array.isArray(data.contacts) ? data.contacts as PreviewContact[] : [];
      setPreviewContacts(contacts);
      setSelectedPreviewContactId((prev) => {
        if (prev !== '__sample__' && !contacts.some((c) => c.id === prev)) return '__sample__';
        return prev;
      });
    } catch {
      setPreviewContacts([]);
      setPreviewContactsError('Unable to load contacts');
    } finally {
      setPreviewContactsLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    loadPreviewContacts();
  }, [loadPreviewContacts]);

  // Fetch + compile template
  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(design)}&format=raw`);
      if (!rawRes.ok) throw new Error('Template not found');
      const rawData = await rawRes.json();
      if (!rawData.raw) throw new Error('No raw content');
      if (typeof rawData.id === 'string') {
        setTemplateId(rawData.id);
      }

      const previewRes = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: rawData.raw,
          project: 'core',
          previewValues: previewVariableMap,
        }),
      });
      if (!previewRes.ok) throw new Error('Compilation failed');
      const previewData = await previewRes.json();
      if (!previewData.html) throw new Error('No HTML output');

      setHtml(previewData.html);
    } catch (err: any) {
      setError(err.message || 'Failed to load preview');
    }
    setLoading(false);
  }, [design, previewVariableMap]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  async function handleCreateEmail() {
    if (!emailName.trim() || saving || !accountKey || !templateId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: emailName.trim(),
          templateId,
          accountKey,
        }),
      });
      if (res.ok) {
        const email = await res.json();
        router.push(`/templates/editor?design=${encodeURIComponent(design)}&email=${email.id}`);
      }
    } catch {
      // ignore
    }
    setSaving(false);
  }

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      syncPreviewMobileNormalizeStyle(doc, previewWidth === 'mobile');
      syncPreviewMobileStyles(doc, previewWidth === 'mobile');
      normalizePreviewMobileLayout(doc, previewWidth === 'mobile');
      const height = doc.body?.scrollHeight;
      if (height && height > 100) {
        iframe.style.height = `${height + 20}px`;
      }
    } catch {}
  };

  const designLabel = formatDesign(design);

  return (
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 h-14 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        {/* Left: Back + title */}
        <button
          onClick={() => router.push('/email/templates')}
          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Back to Library"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">{designLabel}</h1>
          <p className="text-[10px] text-[var(--muted-foreground)]">{design}/template.html</p>
        </div>

        {/* Center: Device toggle */}
        <div className="flex items-center bg-[var(--muted)] rounded-lg p-0.5">
          <button
            onClick={() => setPreviewWidth('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              previewWidth === 'desktop'
                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ComputerDesktopIcon className="w-4 h-4" />
            Desktop
          </button>
          <button
            onClick={() => setPreviewWidth('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              previewWidth === 'mobile'
                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <DevicePhoneMobileIcon className="w-4 h-4" />
            Mobile
          </button>
        </div>

        {/* Preview As */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--muted)]">
          <UserCircleIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
          <select
            value={selectedPreviewContactId}
            onChange={(e) => setSelectedPreviewContactId(e.target.value)}
            className="bg-transparent text-xs text-[var(--foreground)] focus:outline-none"
          >
            <option value="__sample__">Preview As: Sample</option>
            {previewContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || contact.id}
              </option>
            ))}
          </select>
          <button
            onClick={loadPreviewContacts}
            disabled={!accountKey || previewContactsLoading}
            className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
            title={accountKey ? 'Refresh contacts' : 'Switch to a connected account to load contacts'}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${previewContactsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Right: Use Template */}
        {showCreateEmail ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Email name..."
              value={emailName}
              onChange={e => setEmailName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateEmail();
                if (e.key === 'Escape') { setShowCreateEmail(false); setEmailName(''); }
              }}
              autoFocus
              className="w-48 px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              onClick={handleCreateEmail}
              disabled={!emailName.trim() || saving}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreateEmail(false); setEmailName(''); }}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setShowCreateEmail(true); setEmailName(''); }}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity"
          >
            Use This Template
          </button>
        )}
      </div>

      {previewContactsError && (
        <div className="px-6 py-1.5 text-[10px] text-amber-400 border-b border-[var(--border)] bg-[var(--card)]">
          {previewContactsError}
        </div>
      )}

      {/* Preview area */}
      <div className="flex-1 overflow-y-auto bg-zinc-700 flex justify-center">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">Compiling template...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-red-400 text-sm font-medium">Preview Error</p>
            <p className="text-xs text-zinc-400">{error}</p>
            <button
              onClick={() => router.push('/email/templates')}
              className="mt-2 text-sm text-[var(--primary)] hover:underline"
            >
              Back to Library
            </button>
          </div>
        )}

        {html && !loading && (
          <div
            className="transition-all duration-300 ease-in-out"
            style={{
              width: previewWidth === 'mobile' ? '375px' : '100%',
              maxWidth: previewWidth === 'desktop' ? '700px' : '375px',
            }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={html}
              className="w-full border-0 bg-white"
              style={{ minHeight: '100vh' }}
              title={`${design} preview`}
              sandbox="allow-same-origin"
              onLoad={handleIframeLoad}
            />
          </div>
        )}
      </div>
    </div>
  );
}
