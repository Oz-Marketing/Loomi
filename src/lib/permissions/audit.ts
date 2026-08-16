/**
 * The permission audit trail. Server-only.
 *
 * Records two different things in one table, because the question you actually
 * ask is a mix of both: "who gave this person the ability to send blasts, and
 * what have they sent since?"
 *
 *   • Administrative changes — `grant`, `revoke`, `role_change`
 *   • Exercises of a sensitive capability — `use`, and `bypass` for a
 *     developer-tier user passing a check they hold no grant for
 *
 * Every write is best-effort: a failed audit insert must never break the action
 * it was describing. A blast that sent but wasn't logged is bad; a blast that
 * failed to send *because* logging failed is worse. Failures go to the console
 * where the existing log pipeline picks them up.
 *
 * See docs/permissions-architecture.md.
 */
import { prisma } from '@/lib/prisma';
import type { Permission } from './registry';

export type AuditKind = 'grant' | 'revoke' | 'role_change' | 'use' | 'bypass';

export type AuditActor = {
  id: string;
  email: string;
};

export type AuditEntry = {
  kind: AuditKind;
  actor: AuditActor;
  /** Omit for `use` / `bypass` — the actor is the subject. */
  subjectId?: string;
  permission: Permission | string;
  scopeKey?: string | null;
  detail?: string | null;
};

/**
 * Append one entry. Never throws.
 *
 * Deliberately not awaited by most callers — see `recordCapabilityUse`, which
 * is the fire-and-forget wrapper the route handlers use.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.permissionAuditLog.create({
      data: {
        kind: entry.kind,
        actorId: entry.actor.id,
        actorEmail: entry.actor.email,
        subjectId: entry.subjectId ?? entry.actor.id,
        permission: String(entry.permission),
        scopeKey: entry.scopeKey ?? null,
        detail: entry.detail ?? null,
      },
    });
  } catch (err) {
    console.error('[permission-audit] failed to record entry', {
      kind: entry.kind,
      permission: entry.permission,
      err,
    });
  }
}

/**
 * Log the use of a sensitive capability without making the caller wait.
 *
 * The action has already happened (or is about to) — the audit row is a side
 * effect, and blocking a send on a database insert would trade a real feature
 * for a bookkeeping one.
 */
export function recordCapabilityUse(
  actor: AuditActor,
  permission: Permission,
  detail: string,
  scopeKey?: string | null,
): void {
  void recordAudit({ kind: 'use', actor, permission, detail, scopeKey });
}

/**
 * Log a developer-tier bypass: the capability check passed only because the
 * user is `developer`, not because anyone granted it.
 *
 * Break-glass access is intentional — see `resolvePermissions` — but it should
 * leave a mark. Without this, "the developer account can do anything" is both
 * true and invisible.
 */
export function recordBypass(
  actor: AuditActor,
  permission: Permission,
  detail?: string,
): void {
  void recordAudit({ kind: 'bypass', actor, permission, detail });
}

export type AuditQuery = {
  subjectId?: string;
  actorId?: string;
  permission?: string;
  kind?: AuditKind;
  limit?: number;
};

/** Most recent first. Used by the Users screen's access history. */
export async function listAudit(query: AuditQuery = {}) {
  return prisma.permissionAuditLog.findMany({
    where: {
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.permission ? { permission: query.permission } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(query.limit ?? 50, 200),
    select: {
      id: true,
      kind: true,
      actorEmail: true,
      subjectId: true,
      permission: true,
      scopeKey: true,
      detail: true,
      createdAt: true,
    },
  });
}
