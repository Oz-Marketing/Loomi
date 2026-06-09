'use client';

import { useEffect, useState } from 'react';
import { PlusIcon, XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import PrimaryButton from '@/components/primary-button';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useIndustries } from '@/lib/hooks/use-industries';

interface ClientData {
  dealer: string;
  category?: string;
  logos: {
    light: string;
    dark: string;
    white?: string;
    black?: string;
  };
}

export default function ClientsPage() {
  const { confirm } = useLoomiDialog();
  const categorySuggestions = useIndustries();
  const [clients, setClients] = useState<Record<string, ClientData> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Create client
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDealer, setNewDealer] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(data => setClients(data))
      .catch(err => console.error(err));
  }, []);

  const handleSave = async () => {
    if (!clients) return;
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clients),
      });
      if (res.ok) {
        setMessage('Saved!');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch {
      setMessage('Error');
    }
    setSaving(false);
  };

  const updateClient = (key: string, field: string, value: string) => {
    if (!clients) return;
    setClients({
      ...clients,
      [key]: { ...clients[key], [field]: value },
    });
  };

  const handleCreate = async () => {
    if (!newKey.trim() || !newDealer.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), dealer: newDealer.trim(), category: newCategory }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create'); setCreating(false); return; }
      const updated = await fetch('/api/clients').then(r => r.json());
      setClients(updated);
      setNewKey(''); setNewDealer(''); setNewCategory('General'); setShowCreate(false);
    } catch {
      setError('Failed to create client');
    }
    setCreating(false);
  };

  const handleDelete = async (key: string) => {
    const confirmed = await confirm({
      title: 'Delete Client',
      message: `Delete client "${clients?.[key]?.dealer || key}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/clients?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to delete'); return; }
      setClients(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      setError('Failed to delete client');
    }
  };

  if (!clients) return <div className="text-[var(--muted-foreground)]">Loading...</div>;

  return (
    <AdminOnly><div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-[var(--muted-foreground)] mt-1">
            {Object.keys(clients).length} client configurations
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-sm text-green-400">{message}</span>}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] text-[var(--foreground)] rounded-lg text-sm font-medium hover:bg-[var(--muted)] transition-colors"
          >
            <PlusIcon className="w-4 h-4" /> New Client
          </button>
          <PrimaryButton
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </PrimaryButton>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="p-0.5 hover:text-red-300"><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* Create client */}
      {showCreate && (
        <div className="mb-4 p-4 border border-[var(--primary)]/30 rounded-xl bg-[var(--card)]">
          <label className="text-sm font-medium block mb-2">New Client</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="Client key (e.g. youngFord)" autoFocus />
            <input type="text" value={newDealer} onChange={(e) => setNewDealer(e.target.value)} className="text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]" placeholder="Client name (e.g. Young Ford)" />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]">
              {categorySuggestions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={handleCreate} disabled={!newKey.trim() || !newDealer.trim() || creating}>{creating ? 'Creating...' : 'Create'}</PrimaryButton>
            <button onClick={() => { setShowCreate(false); setNewKey(''); setNewDealer(''); setNewCategory('General'); }} className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"><XMarkIcon className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {Object.entries(clients).map(([key, client]) => (
          <div
            key={key}
            className="p-4 border border-[var(--border)] rounded-xl bg-[var(--card)]"
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-[var(--muted)] flex items-center justify-center overflow-hidden flex-shrink-0">
                {client.logos?.light ? (
                  <img src={client.logos.light} alt={client.dealer} className="max-w-full max-h-full object-contain p-1" />
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">No logo</span>
                )}
              </div>

              <div className="flex-1 grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Client Key</label>
                  <p className="text-sm font-mono">{key}</p>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Client Name</label>
                  <input
                    type="text"
                    value={client.dealer}
                    onChange={(e) => updateClient(key, 'dealer', e.target.value)}
                    className="w-full mt-0.5 bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-[var(--muted-foreground)]">Category</label>
                    <select
                      value={client.category || 'General'}
                      onChange={(e) => updateClient(key, 'category', e.target.value)}
                      className="w-full mt-0.5 bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                    >
                      {categorySuggestions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={() => handleDelete(key)}
                    className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors mb-0.5"
                    title="Delete client"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div></AdminOnly>
  );
}
