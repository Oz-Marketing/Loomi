/**
 * The specialist roster — code-owned.
 *
 * A registry entry says what a specialist CAN DO: its tools, its executor, how hard
 * it thinks, and which permission you need to talk to it. None of that is editable
 * from the UI, because all of it is code or security.
 *
 * What IS editable (Phase 2) is the profile: the brief, the curated notes, the
 * depth. `buildSystemPrompt` takes that profile as an argument for exactly that
 * reason — today it's a constant, tomorrow it's a database row, and no call site
 * changes.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentToolResult } from '@/lib/ai/agent-runtime';
import type { Permission } from '@/lib/permissions/registry';
import { COOP_TOOLS, executeCoopTool, describeCoopTool } from './coop-tools';
import { COOP_BRIEF } from './coop-brief';
import { type SpecialistKey, agentIdentity } from './identity';

export interface SpecialistProfile {
  /** The brief. A DB-backed override once profiles ship; the code default until then. */
  instructions: string;
  /** Curated notes — what isn't in any document. Empty until the team writes some. */
  notes?: string;
}

export interface SpecialistDefinition {
  key: SpecialistKey;
  /** Who may talk to this specialist at all. Checked before the loop starts. */
  permission: Permission;
  /**
   * Who may EDIT its brief and notes — a different, narrower question than who may
   * ask it something. The team that owns the realm owns the specialist: co-op is
   * managed by the people who manage co-op, not by whoever can open Agency Settings.
   */
  managePermission: Permission;
  tools: Anthropic.Tool[];
  execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<AgentToolResult<unknown>> | AgentToolResult<unknown>;
  /** Advisory specialists are supposed to think hard. See "Two grades of AI". */
  effort: 'low' | 'medium' | 'high' | 'max';
  maxIterations: number;
  /** Human phrasing for a tool call, shown in the panel's progress trail. */
  describeToolCall?(toolName: string, input: Record<string, unknown>): string | null;
  defaultProfile: SpecialistProfile;
  buildSystemPrompt(profile: SpecialistProfile): string;
}

/**
 * Shared preamble — the "house knowledge" every specialist gets.
 *
 * Deliberately short. Everything a specialist needs to know about ITS realm belongs
 * in its own brief or, better, behind a tool; this is only what's true platform-wide.
 * The old global knowledge base grew to 400 lines precisely because there was
 * nowhere else to put anything.
 */
function houseKnowledge(identityKey: SpecialistKey): string {
  const id = agentIdentity(identityKey);
  return [
    `You are ${id.name}, a specialist inside Loomi — the marketing platform Oz Marketing`,
    'runs for its dealership clients. You are one of several specialists; each owns a',
    'different area. If a question belongs to someone else, say so briefly and name the',
    'area rather than guessing.',
    '',
    `Your realm: ${id.role}.`,
    '',
    'Talk like a knowledgeable colleague: direct, specific, no preamble. Never invent a',
    'document, rule, page number, account, or feature. If you do not know, say what you',
    'checked and what you would need.',
  ].join('\n');
}

/**
 * Every named specialist. One so far.
 *
 * The flow builder's assistant and the landing-page assistant are NOT here: they
 * are the system assistant (Loomi AI) embedded in a builder, running their own
 * routes with their own per-request state. A specialist earns an entry when it has
 * a realm, a name, and tools over shared data — see docs/specialist-agents.md.
 */
export const SPECIALISTS: Record<SpecialistKey, SpecialistDefinition> = {
  coop: {
    key: 'coop',
    // Reading the guideline library is what the co-op surface already gates on.
    permission: 'studio.adgen.view',
    managePermission: 'agency.coop.manage',
    tools: COOP_TOOLS,
    execute: executeCoopTool,
    describeToolCall: describeCoopTool,
    // Advisory and expected to reason across documents — this is the specialist
    // the "don't inherit the compliance engine's posture" decision was about.
    effort: 'high',
    maxIterations: 12,
    defaultProfile: { instructions: COOP_BRIEF },
    buildSystemPrompt(profile) {
      return [
        houseKnowledge('coop'),
        '',
        profile.instructions,
        ...(profile.notes
          ? [
              '',
              '## House notes',
              '',
              'Written by the co-op team. These are things NOT in any document — rep',
              'guidance, verbal exceptions, known rejections. Treat them as authoritative',
              'about our own practice, and attribute them as house guidance rather than',
              'as manufacturer text.',
              '',
              profile.notes,
            ]
          : []),
      ].join('\n');
    },
  },

};

export function getSpecialist(key: string): SpecialistDefinition | null {
  if (!(key in SPECIALISTS)) return null;
  return SPECIALISTS[key as SpecialistKey];
}
