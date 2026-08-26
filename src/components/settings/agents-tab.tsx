'use client';

/**
 * Agency Settings → Agents.
 *
 * Replaces the single Knowledge Base editor. That was one markdown blob feeding
 * one generic assistant, which meant nobody could own a piece of it: editing "the
 * knowledge base" meant reading past everyone else's section and risking a change
 * that degraded an unrelated answer. So in practice nobody edited it and it went
 * stale.
 *
 * Here each specialist is a row, and each row opens the brief for the team that
 * owns that realm. What is NOT editable — its tools, its permissions, its
 * guardrails — is listed beside the editor rather than hidden, so the boundary is
 * visible instead of surprising.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { Select } from '@/components/select';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { invalidateAgentIdentities } from '@/hooks/use-agent-identity';
import { ArrowUturnLeftIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';

interface RosterAgent {
  key: string;
  name: string;
  role: string;
  portraitUrl: string | null;
  accent: string;
  toolCount: number;
  customized: boolean;
  updatedAt: string | null;
  manageable: boolean;
}

interface Capability {
  name: string;
  description: string;
}

interface ProfilePayload {
  key: string;
  name: string;
  role: string;
  instructions: string;
  notes: string;
  effort: string;
  portraitUrl: string | null;
  accent: string;
  customized: boolean;
  updatedAt: string | null;
}

interface AvatarCharacter {
  slug: string;
  name: string;
  url: string;
  accent: string;
}

const EFFORTS = [
  { value: 'low', label: 'Low — quick, mechanical answers' },
  { value: 'medium', label: 'Medium — everyday questions' },
  { value: 'high', label: 'High — reasons across documents' },
  { value: 'max', label: 'Max — slowest, most thorough' },
];

function AgentCard({ agent, onOpen }: { agent: RosterAgent; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!agent.manageable}
      className={`flex flex-col items-center gap-2.5 rounded-2xl border border-[var(--border)] p-5 text-center transition-colors ${
        agent.manageable
          ? 'hover:border-[var(--ring)] hover:bg-[var(--muted)]'
          : 'cursor-not-allowed opacity-60'
      }`}
    >
      <AvatarDisc url={agent.portraitUrl} accent={agent.accent} size={104} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--foreground)]">
          {agent.name}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted-foreground)]">
          {agent.role}
        </span>
      </span>
      <span className="mt-auto flex items-center gap-2 pt-1 text-[10px] text-[var(--muted-foreground)]">
        <span>{agent.toolCount} tools</span>
        <span aria-hidden>·</span>
        <span>{agent.customized ? 'Edited' : 'Default'}</span>
      </span>
    </button>
  );
}

/** The circular face plus its accent ring — the roster card, the detail header,
 *  and the picker all draw the same thing at different sizes. */
function AvatarDisc({
  url,
  accent,
  size,
  selected = false,
}: {
  url: string | null;
  accent: string;
  size: number;
  selected?: boolean;
}) {
  return (
    <span
      className="inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${accent} 18%, transparent)`,
        boxShadow: selected
          ? `0 0 0 2px ${accent}`
          : `inset 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent)`,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}

export function AgentsTab() {
  const { markClean, markDirty } = useUnsavedChanges();
  const [roster, setRoster] = useState<RosterAgent[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [library, setLibrary] = useState<AvatarCharacter[]>([]);
  const [name, setName] = useState('');
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [effort, setEffort] = useState('high');
  const [saving, setSaving] = useState(false);

  const dirty =
    profile !== null &&
    (instructions !== profile.instructions ||
      notes !== profile.notes ||
      effort !== profile.effort ||
      name !== profile.name ||
      portraitUrl !== profile.portraitUrl);

  useEffect(() => {
    if (dirty) markDirty();
    else markClean();
    // markClean/markDirty are stable refs from context — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Could not load agents');
      const data = await res.json();
      setRoster(data.agents ?? []);
    } catch {
      toast.error('Could not load agents');
      setRoster([]);
    }
  }, []);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const openAgent = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/api/agents/${key}/profile`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProfile(data.profile);
      setCapabilities(data.capabilities ?? []);
      setLibrary(data.library ?? []);
      setName(data.profile.name);
      setPortraitUrl(data.profile.portraitUrl);
      setInstructions(data.profile.instructions);
      setNotes(data.profile.notes);
      setEffort(data.profile.effort);
      setOpenKey(key);
    } catch {
      toast.error('Could not open that agent');
    }
  }, []);

  async function save() {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${profile.key}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, instructions, notes, effort, portraitUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      setProfile({ ...profile, name, instructions, notes, effort, portraitUrl, customized: true });
      markClean();
      // Any open assistant panel is holding the old name and face.
      invalidateAgentIdentities();
      toast.success(`${name} updated — her next answer uses this.`);
      void loadRoster();
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!profile) return;
    setSaving(true);
    try {
      await fetch(`/api/agents/${profile.key}/profile`, { method: 'DELETE' });
      invalidateAgentIdentities();
      toast.success(`${profile.name} is back to her built-in brief.`);
      await openAgent(profile.key);
      void loadRoster();
    } finally {
      setSaving(false);
    }
  }

  if (openKey && profile) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => {
            setOpenKey(null);
            setProfile(null);
            markClean();
          }}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> All agents
        </button>

        <div className="flex items-start gap-4">
          <AvatarDisc
            url={portraitUrl}
            accent={
              library.find((c) => c.url === portraitUrl)?.accent ?? profile.accent
            }
            size={88}
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">{profile.role}</p>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
            Face
          </label>
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
            Pick a character from the shared library. Choosing one also sets the accent
            drawn behind her, so a face and its colour always travel together.
          </p>
          <div className="flex flex-wrap gap-2">
            {library.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => setPortraitUrl(c.url)}
                title={c.name}
                aria-label={c.name}
                aria-pressed={portraitUrl === c.url}
                className="rounded-full transition-transform hover:scale-105"
              >
                <AvatarDisc
                  url={c.url}
                  accent={c.accent}
                  size={56}
                  selected={portraitUrl === c.url}
                />
              </button>
            ))}
            {library.length === 0 && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                No characters in the library yet.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
            Brief
          </label>
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
            How she works and what she must always do. Written to her, in plain language.
          </p>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={16}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] p-3 font-mono text-[11px] leading-relaxed text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
            House notes
          </label>
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
            What isn&apos;t in any document — rep guidance, verbal exceptions, known
            rejections. She treats these as true about our own practice and attributes
            them as house guidance, not as manufacturer text.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            placeholder="e.g. Chevrolet rejects co-branded lockups even though the 2026 guidelines are silent on them."
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] p-3 text-[11px] leading-relaxed text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div className="max-w-sm">
          <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
            Depth
          </label>
          <Select
            value={effort}
            onChange={setEffort}
            options={EFFORTS.map((e) => ({ value: e.value, label: e.label }))}
          />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="text-xs font-medium text-[var(--foreground)]">
              What she can look up
            </span>
          </div>
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
            Set in code, not here. These are read-only — she cannot change anything, and
            she can only ever see what you can see.
          </p>
          <ul className="space-y-1">
            {capabilities.map((c) => (
              <li key={c.name} className="text-[11px] text-[var(--muted-foreground)]">
                <code className="text-[var(--foreground)]">{c.name}</code>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
          <PrimaryButton onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
          {profile.customized && (
            <button
              type="button"
              onClick={resetToDefault}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Reset to default
            </button>
          )}
          {profile.updatedAt && (
            <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
              Last edited {new Date(profile.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        Each specialist knows one area and is managed by the team that owns it. Their
        tools and permissions are set in code; their brief and house notes are yours.
      </p>
      {roster === null && (
        <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">Loading…</p>
      )}
      {roster?.length === 0 && (
        <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
          No specialists yet.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {roster?.map((a) => (
          <AgentCard key={a.key} agent={a} onOpen={() => void openAgent(a.key)} />
        ))}
      </div>
    </div>
  );
}
