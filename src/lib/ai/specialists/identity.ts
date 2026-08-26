/**
 * What a specialist LOOKS like — name, face, colour, voice.
 *
 * Separate from the specialist's capabilities (see `registry.ts`) because these two
 * change for completely different reasons: capabilities change when we ship a tool,
 * identity changes when someone in marketing decides Vera should be teal. Keeping
 * them apart means a rename never touches a file that can break an agent.
 *
 * ── Why marks rather than illustrated portraits (for now) ──
 *
 * The roster GROWS, and Phase 5 lets people create their own agents. Any identity
 * system that depends on commissioning artwork per agent stops working the moment
 * a user makes one at 4pm on a Tuesday. So a procedural identity — a glyph plus a
 * colour, derived from the agent itself — isn't the cheap version of the real thing;
 * it's the only version that survives the roadmap.
 *
 * Illustrated portraits stay possible as an upgrade for the flagship few: set
 * `portraitUrl` and the avatar renders it instead. Nothing else changes. See
 * docs/specialist-agents.md for the procurement options.
 */

/**
 * Named specialists. ONE today — add an entry only when the agent actually exists,
 * so the roster never advertises something that isn't there.
 */
export type SpecialistKey = 'coop';

/** The generalist. Not a specialist: it has no realm, it has the whole product. */
export const SYSTEM_KEY = 'system' as const;

export type AgentKey = SpecialistKey | typeof SYSTEM_KEY;

/** The glyph drawn in the avatar. Each is a simple, brand-neutral geometric form. */
export type AgentMark = 'aperture' | 'quill' | 'orbit' | 'prism';

export interface AgentIdentity {
  key: AgentKey;
  /**
   * The agent's name. A name rather than a job title because people refer to a
   * colleague by name, and the whole point of a specialist is that it reads as one.
   *
   * Iris predates this work — it's what the flow builder's assistant is already
   * called in shipped copy — so it keeps its name rather than being renamed for
   * tidiness.
   */
  name: string;
  /** One line under the name. What it's a master of. */
  role: string;
  /** First-person, shown as the empty-state greeting. Written in the agent's voice. */
  greeting: string;
  mark: AgentMark;
  /**
   * The agent's accent. Used for the avatar ring and the mark; deliberately NOT for
   * anything that carries meaning elsewhere in the UI, so a new agent's colour can
   * never collide with a status colour.
   */
  accent: string;
  /** Optional illustrated portrait. When set, the avatar renders this instead of the mark. */
  portraitUrl?: string;
}

export const AGENT_IDENTITIES: Record<SpecialistKey, AgentIdentity> = {
  coop: {
    key: 'coop',
    name: 'Vera',
    role: 'Co-op & manufacturer guidelines',
    greeting:
      "I'm Vera. I know the co-op guidelines on file inside out — ask me what a program allows, and I'll show you the page it's on.",
    mark: 'aperture',
    accent: '#38bdf8',
  },
};

/**
 * Loomi AI — the system assistant.
 *
 * The product's own voice rather than a character: it answers about Loomi itself
 * and hands off to a specialist when a question belongs to one. It deliberately has
 * NO name of its own and NO face — it keeps the sparkle mark the assistant has
 * always had, and a name+avatar appearing in that slot is the signal that you are
 * now talking to somebody in particular.
 *
 * (It was called "Iris" until 2026-08-25. A proper noun on the generalist made the
 * named specialists read as peers of the system itself rather than as experts
 * within it.)
 */
export const SYSTEM_AGENT: AgentIdentity = {
  key: SYSTEM_KEY,
  name: 'Loomi AI',
  role: 'Loomi Studio',
  greeting: 'Ask me anything about Loomi — or I can point you at the specialist who knows.',
  mark: 'prism',
  accent: 'var(--primary)',
};

/** True when this is the generalist, which renders the sparkle rather than a face. */
export function isSystemAgent(identity: AgentIdentity): boolean {
  return identity.key === SYSTEM_KEY;
}

export function agentIdentity(key: AgentKey): AgentIdentity {
  return key === SYSTEM_KEY ? SYSTEM_AGENT : AGENT_IDENTITIES[key];
}

/**
 * SVG path data for each mark, drawn in a 24×24 box.
 *
 * Paths rather than icon components so the same geometry can be rendered by the
 * avatar, an <img> data URI, or an email — none of which can import React.
 */
export const MARK_PATHS: Record<AgentMark, string[]> = {
  // A camera aperture: something that examines closely and shows you what it saw.
  aperture: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M12 7.5 15.9 14.25H8.1L12 7.5Z',
  ],
  // A nib.
  quill: ['M5 19 19 5', 'M14 5h5v5', 'M5 19l3.5-1 8-8L14 7.5l-8 8L5 19Z'],
  // A body and the path around it.
  orbit: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', 'M4 12a8 5.5 0 1 0 16 0 8 5.5 0 0 0-16 0Z'],
  // Fallback for agents without a chosen mark — a split of light.
  prism: ['M12 4 20 18H4L12 4Z', 'M12 10v8'],
};

/**
 * A deterministic mark + accent for an agent that has no designed identity —
 * every custom agent, once Phase 5 ships.
 *
 * Deterministic on the id so an agent's face never changes between page loads, and
 * so two people looking at the same agent see the same thing without storing a
 * colour on the row.
 */
export function derivedIdentity(id: string, name: string): Pick<AgentIdentity, 'mark' | 'accent'> {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const palette = ['#38bdf8', '#6366f1', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
  const marks: AgentMark[] = ['prism', 'aperture', 'orbit', 'quill'];
  void name;
  return {
    accent: palette[hash % palette.length],
    mark: marks[(hash >> 3) % marks.length],
  };
}
