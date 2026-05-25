'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  XMarkIcon,
  CheckIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  Squares2X2Icon,
  ListBulletIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderArrowDownIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { StatusFilter, type StatusFilterValue } from '@/components/status-filter';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import {
  parseEmailFoldersPayload,
  foldersMapToArray,
  type FolderAssignments,
} from '@/lib/email-folders-payload';
import {
  parseEmailListPayload,
  type EmailListItem,
} from '@/lib/email-list-payload';

interface TemplateEntry {
  id: string;
  design: string;
  name: string;
}

interface AccountData {
  dealer: string;
  logos: { light: string; dark: string };
}

const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f59e0b20', text: '#f59e0b' },
  active: { bg: '#10b98120', text: '#10b981' },
  archived: { bg: '#6b728020', text: '#6b7280' },
};

const VIEW_KEY = 'loomi-email-view';

function loadView(): 'card' | 'list' {
  if (typeof window === 'undefined') return 'card';
  return (localStorage.getItem(VIEW_KEY) as 'card' | 'list') || 'card';
}

export function EmailFolderPage() {
  const params = useParams();
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const { isAccount, accountKey } = useAccount();
  const backLabel = 'Templates';
  const listPageLabel = 'templates';
  const folderName = decodeURIComponent(params.name as string);
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [accounts, setAccounts] = useState<Record<string, AccountData>>({});
  const [folders, setFolders] = useState<FolderAssignments>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [moveModalEmail, setMoveModalEmail] = useState<string | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [showDeleteFolder, setShowDeleteFolder] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Create email
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesign, setNewDesign] = useState('');
  const [newAccountKey, setNewAccountKey] = useState('');
  const [creating, setCreating] = useState(false);
  // Bulk selection
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Status filter — drives the API fetch + the StatusFilter dropdown
  // in the toolbar. Default 'all' (everything except archived).
  // Archived rows auto-purge after 30 days regardless.
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');

  useEffect(() => { setViewMode(loadView()); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadData = async () => {
    try {
      const emailParams = new URLSearchParams();
      if (isAccount && accountKey) emailParams.set('accountKey', accountKey);
      emailParams.set('status', statusFilter);
      const emailUrl = `/api/emails${emailParams.toString() ? `?${emailParams.toString()}` : ''}`;
      const [emailsRes, tplRes, accountsRes, foldersRes] = await Promise.all([
        fetch(emailUrl),
        fetch('/api/templates'),
        fetch('/api/accounts'),
        fetch('/api/email-folders'),
      ]);
      setEmails(parseEmailListPayload(await emailsRes.json()));
      setTemplates(await tplRes.json());
      setAccounts(await accountsRes.json());
      setFolders(parseEmailFoldersPayload(await foldersRes.json()));
    } catch (err) {
      console.error('Failed to load:', err);
    }
    setLoading(false);
  };

  // Re-fetch emails when the status filter changes so the list
  // reflects the current scope without a full page reload.
  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const saveFolders = async (newFolders: FolderAssignments) => {
    setFolders(newFolders);
    await fetch('/api/email-folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: foldersMapToArray(newFolders) }),
    });
  };

  const emailMap = useMemo(() => {
    const map: Record<string, EmailListItem> = {};
    for (const e of emails) map[e.id] = e;
    return map;
  }, [emails]);

  const accountKeys = useMemo(() => Object.keys(accounts).sort(), [accounts]);

  const folderEmails = (folders[folderName] || []).filter(id => emailMap[id]);

  const getAccountLabel = (key: string) => accounts[key]?.dealer || key;
  const getTemplateLabel = (email: EmailListItem) => email.templateTitle;
  const openEmailEditor = (email: EmailListItem) => {
    if (!email.templateSlug) {
      toast.error('Template is unavailable for this email');
      return;
    }
    router.push(`/templates/editor?design=${encodeURIComponent(email.templateSlug)}&email=${email.id}`);
  };

  const handleMoveToFolder = async (id: string, targetFolder: string) => {
    const nf = { ...folders };
    for (const [f, list] of Object.entries(nf)) nf[f] = list.filter(eid => eid !== id);
    if (targetFolder !== '__unfiled__') nf[targetFolder] = [...(nf[targetFolder] || []), id];
    await saveFolders(nf);
    setMoveModalEmail(null);
  };

  const handleRenameFolder = async () => {
    if (!folderRenameValue.trim() || folderRenameValue.trim() === folderName) { setIsRenamingFolder(false); return; }
    const newName = folderRenameValue.trim();
    if (folders[newName]) { toast.error('Folder already exists'); return; }
    const nf = { ...folders };
    nf[newName] = nf[folderName] || [];
    delete nf[folderName];
    await saveFolders(nf);
    router.replace(`/templates/folder/${encodeURIComponent(newName)}`);
  };

  const handleDeleteFolder = async () => {
    const nf = { ...folders };
    delete nf[folderName];
    await saveFolders(nf);
    router.push('/email/templates');
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const name = newFolderName.trim();
    if (folders[name]) { toast.error('Folder already exists'); return; }
    await saveFolders({ ...folders, [name]: [] });
    setNewFolderName(''); setShowNewFolder(false);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newDesign || !newAccountKey || creating) return;
    const selectedTemplate = templates.find((template) => template.design === newDesign);
    if (!selectedTemplate) {
      toast.error('Please select a valid template');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          templateId: selectedTemplate.id,
          accountKey: newAccountKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create'); setCreating(false); return; }
      // Add to this folder
      const nf = { ...folders };
      nf[folderName] = [...(nf[folderName] || []), data.id];
      await saveFolders(nf);
      await loadData();
      setNewName(''); setNewDesign(''); setNewAccountKey(''); setShowCreate(false);
    } catch {
      toast.error('Failed to create email');
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/emails?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed to delete'); return; }
      const nf = { ...folders };
      for (const [f, list] of Object.entries(nf)) nf[f] = list.filter(eid => eid !== id);
      await saveFolders(nf);
      setEmails(prev => prev.filter(e => e.id !== id));
    } catch {
      toast.error('Failed to delete email');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkMove = async (targetFolder: string) => {
    const nf = { ...folders };
    for (const id of selectedEmails) {
      for (const [f, list] of Object.entries(nf)) nf[f] = list.filter(eid => eid !== id);
      if (targetFolder !== '__unfiled__') nf[targetFolder] = [...(nf[targetFolder] || []), id];
    }
    await saveFolders(nf);
    setSelectedEmails(new Set());
    setShowBulkMoveModal(false);
  };

  // ── Three-dot menu ──
  const ThreeDotsMenu = ({ id }: { id: string }) => {
    const isOpen = openMenu === id;
    const email = emailMap[id];
    return (
      <div className="relative" ref={isOpen ? menuRef : undefined}>
        <button
          onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen ? null : id); }}
          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <EllipsisVerticalIcon className="w-4 h-4" />
        </button>
        {isOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setOpenMenu(null); setMoveModalEmail(id); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">
              <FolderArrowDownIcon className="w-4 h-4" /> Move to Folder
            </button>
            <button
              onClick={async () => {
                setOpenMenu(null);
                const confirmed = await confirm({
                  title: 'Delete Email',
                  message: `Delete "${email?.name || id}"?`,
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (confirmed) {
                  await handleDelete(id);
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <TrashIcon className="w-4 h-4" /> Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Email Card ──
  const EmailCard = ({ id }: { id: string }) => {
    const email = emailMap[id];
    if (!email) return null;
    const isSelected = selectedEmails.has(id);
    const sc = statusColors[email.status] || statusColors.draft;

    return (
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}
        className={`glass-card rounded-xl group ${isSelected ? '!border-[var(--primary)] ring-2 ring-[var(--primary)]/20' : ''}`}
      >
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2 relative">
            <label
              className={`absolute -top-1 -left-1 flex items-center justify-center w-5 h-5 rounded border cursor-pointer transition-all ${isSelected ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-[var(--muted)] border-[var(--border)] opacity-0 group-hover:opacity-100'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(id)} className="sr-only" />
              {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
            </label>
            {!isAccount && <span className="text-xs text-[var(--muted-foreground)] flex-1 truncate">{getAccountLabel(email.accountKey)}</span>}
            {isAccount && <span className="flex-1" />}
            <ThreeDotsMenu id={id} />
          </div>
          <p
            className="text-sm font-semibold cursor-pointer mb-1"
            onClick={() => openEmailEditor(email)}
          >
            {email.name}
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)] mb-2">{getTemplateLabel(email)}</p>
          <span
            className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: sc.bg, color: sc.text }}
          >
            {email.status}
          </span>
        </div>
      </div>
    );
  };

  // ── Email Row ──
  const EmailRow = ({ id }: { id: string }) => {
    const email = emailMap[id];
    if (!email) return null;
    const isSelected = selectedEmails.has(id);
    const sc = statusColors[email.status] || statusColors.draft;

    return (
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}
        className={`flex items-center gap-4 p-3 glass-card rounded-xl group ${isSelected ? '!border-[var(--primary)] ring-2 ring-[var(--primary)]/20' : ''}`}
      >
        <label className="flex items-center justify-center w-5 h-5 flex-shrink-0 cursor-pointer">
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(id)} className="sr-only" />
          <div className={`w-4.5 h-4.5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-[var(--primary)] border-[var(--primary)]' : 'border-[var(--border)] group-hover:border-[var(--muted-foreground)]'}`}>
            {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
          </div>
        </label>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => openEmailEditor(email)}
        >
          <h3 className="font-semibold text-sm">{email.name}</h3>
          <p className="text-[10px] text-[var(--muted-foreground)]">{!isAccount && <>{getAccountLabel(email.accountKey)} &middot; </>}{getTemplateLabel(email)}</p>
        </div>
        <span
          className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: sc.bg, color: sc.text }}
        >
          {email.status}
        </span>
        <ThreeDotsMenu id={id} />
      </div>
    );
  };

  if (loading) return <div className="text-[var(--muted-foreground)]">Loading...</div>;

  if (!folders[folderName]) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Folder not found.</p>
        <button onClick={() => router.push('/email/templates')} className="mt-4 text-sm text-[var(--primary)] hover:underline">{`Back to ${backLabel}`}</button>
      </div>
    );
  }

  const folderNames = Object.keys(folders);

  return (
    <div>
      {/* Header */}
      <div className="page-sticky-header flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/email/templates')} className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">
            <ArrowLeftIcon className="w-4 h-4" />
          </button>
          <FolderIcon className="w-5 h-5 text-[var(--muted-foreground)]" />
          {isRenamingFolder ? (
            <div className="flex items-center gap-2">
              <input type="text" value={folderRenameValue} onChange={(e) => setFolderRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(); if (e.key === 'Escape') setIsRenamingFolder(false); }} className="text-xl font-bold bg-[var(--input)] border border-[var(--border)] rounded-lg px-2 py-0.5 text-[var(--foreground)] w-56" autoFocus />
              <button onClick={handleRenameFolder} className="p-1 text-green-400 hover:bg-green-500/10 rounded"><CheckIcon className="w-4 h-4" /></button>
              <button onClick={() => setIsRenamingFolder(false)} className="p-1 text-[var(--muted-foreground)] rounded"><XMarkIcon className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{folderName}</h2>
              <span className="text-sm text-[var(--muted-foreground)]">({folderEmails.length})</span>
              <button onClick={() => { setIsRenamingFolder(true); setFolderRenameValue(folderName); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]" title="Rename folder">
                <PencilSquareIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showDeleteFolder ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete folder?</span>
              <button onClick={handleDeleteFolder} className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30">Yes</button>
              <button onClick={() => setShowDeleteFolder(false)} className="px-3 py-1.5 text-xs text-[var(--muted-foreground)]">No</button>
            </div>
          ) : (
            <>
              <div className="flex items-center bg-[var(--muted)] rounded-lg p-0.5">
                <button onClick={() => setViewMode('card')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}>
                  <Squares2X2Icon className="w-4 h-4" />
                </button>
                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}>
                  <ListBulletIcon className="w-4 h-4" />
                </button>
              </div>
              <StatusFilter
                value={statusFilter}
                onChange={setStatusFilter}
              />
              <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] text-[var(--foreground)] rounded-lg text-sm font-medium hover:bg-[var(--muted)] transition-colors">
                <FolderPlusIcon className="w-4 h-4" /> New Folder
              </button>
              <PrimaryButton onClick={() => setShowCreate(true)}>
                <PlusIcon className="w-4 h-4" /> New Email
              </PrimaryButton>
              <button onClick={() => setShowDeleteFolder(true)} className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10" title="Delete folder">
                <TrashIcon className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Create email */}
      {showCreate && (
        <div className="mb-4 p-4 border border-[var(--primary)]/30 rounded-xl bg-[var(--card)]">
          <label className="text-sm font-medium block mb-2">New Email</label>
          <div className="flex flex-col gap-2">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="Email name..." autoFocus />
            <div className="flex items-center gap-2">
              <select value={newAccountKey} onChange={(e) => setNewAccountKey(e.target.value)} className="text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]">
                <option value="">Select account...</option>
                {accountKeys.map(k => <option key={k} value={k}>{accounts[k].dealer} ({k})</option>)}
              </select>
              <select
                value={newDesign}
                onChange={(e) => setNewDesign(e.target.value)}
                className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
              >
                <option value="">Select template...</option>
                {templates.map(t => (
                  <option key={t.design} value={t.design}>
                    {t.name || t.design}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <PrimaryButton onClick={handleCreate} disabled={!newName.trim() || !newDesign || !newAccountKey || creating}>{creating ? 'Creating...' : 'Create Email'}</PrimaryButton>
              <button onClick={() => { setShowCreate(false); setNewName(''); setNewDesign(''); setNewAccountKey(''); }} className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"><XMarkIcon className="w-4 h-4" /></button>
            </div>
          </div>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1.5">Will be added to this folder automatically.</p>
        </div>
      )}

      {/* Create folder */}
      {showNewFolder && (
        <div className="mb-4 p-4 border border-[var(--border)] rounded-xl bg-[var(--card)]">
          <label className="text-sm font-medium block mb-2">Folder Name</label>
          <div className="flex items-center gap-2">
            <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="e.g. January Campaigns, Q1 Service..." autoFocus />
            <button onClick={handleCreateFolder} disabled={!newFolderName.trim()} className="px-4 py-2 bg-[var(--foreground)] text-[var(--background)] rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">Create</button>
            <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"><XMarkIcon className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {folderEmails.length > 0 ? (
        viewMode === 'card' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {folderEmails.map(id => <EmailCard key={id} id={id} />)}
          </div>
        ) : (
          <div className="space-y-1.5">
            {folderEmails.map(id => <EmailRow key={id} id={id} />)}
          </div>
        )
      ) : (
        <div className="text-center py-12 text-[var(--muted-foreground)]">
          <p className="text-sm">No emails in this folder yet.</p>
          <p className="text-xs mt-1">{`Use the Move to Folder option from the ${listPageLabel} page to add emails here.`}</p>
        </div>
      )}

      {/* Move to Folder Modal */}
      {moveModalEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setMoveModalEmail(null)}>
          <div className="glass-modal w-[360px] max-h-[400px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold">Move email to folder</h3>
              <button onClick={() => setMoveModalEmail(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><XMarkIcon className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto max-h-[300px] p-2">
              <button
                onClick={() => handleMoveToFolder(moveModalEmail, '__unfiled__')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)]"
              >
                <XMarkIcon className="w-4 h-4" /> Remove from folder
              </button>
              {folderNames.map((fn) => {
                const isInThisFolder = (folders[fn] || []).includes(moveModalEmail);
                return (
                  <button
                    key={fn}
                    onClick={() => handleMoveToFolder(moveModalEmail, fn)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-[var(--muted)] transition-colors ${isInThisFolder ? 'text-[var(--primary)] font-medium' : 'text-[var(--foreground)]'}`}
                  >
                    <FolderIcon className="w-4 h-4" />
                    {fn}
                    {isInThisFolder && <span className="text-xs text-[var(--muted-foreground)] ml-auto">(current)</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bulk selection action bar */}
      {selectedEmails.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 glass-action-bar">
          <span className="text-sm font-medium text-[var(--foreground)]">
            {selectedEmails.size} selected
          </span>
          <div className="w-px h-5 bg-[var(--border)]" />
          <button
            onClick={() => {
              if (selectedEmails.size === folderEmails.length && folderEmails.every(id => selectedEmails.has(id))) {
                setSelectedEmails(new Set());
              } else {
                setSelectedEmails(new Set(folderEmails));
              }
            }}
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {selectedEmails.size === folderEmails.length && folderEmails.every(id => selectedEmails.has(id)) ? 'Deselect All' : 'Select All'}
          </button>
          <div className="w-px h-5 bg-[var(--border)]" />
          <button
            onClick={() => setShowBulkMoveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <FolderArrowDownIcon className="w-4 h-4" /> Move to Folder
          </button>
          <button
            onClick={() => setSelectedEmails(new Set())}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk Move to Folder Modal */}
      {showBulkMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setShowBulkMoveModal(false)}>
          <div className="glass-modal w-[360px] max-h-[400px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold">Move {selectedEmails.size} email{selectedEmails.size > 1 ? 's' : ''} to folder</h3>
              <button onClick={() => setShowBulkMoveModal(false)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><XMarkIcon className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto max-h-[300px] p-2">
              <button
                onClick={() => handleBulkMove('__unfiled__')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)]"
              >
                <XMarkIcon className="w-4 h-4" /> Remove from folder
              </button>
              {folderNames.map((fn) => (
                <button
                  key={fn}
                  onClick={() => handleBulkMove(fn)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-[var(--muted)] transition-colors ${fn === folderName ? 'text-[var(--primary)] font-medium' : 'text-[var(--foreground)]'}`}
                >
                  <FolderIcon className="w-4 h-4" />
                  {fn}
                  {fn === folderName && <span className="text-xs text-[var(--muted-foreground)] ml-auto">(current)</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
