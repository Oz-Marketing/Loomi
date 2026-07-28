import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { sendUserInviteEmail } from '@/lib/users/invite-email';
import { normalizePassword, validatePassword } from '@/lib/users/password-policy';

const DEFAULT_INVITE_TTL_HOURS = 72;

function getInviteTtlHours(): number {
  const parsed = Number(process.env.USER_INVITE_TTL_HOURS || DEFAULT_INVITE_TTL_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INVITE_TTL_HOURS;
  return Math.floor(parsed);
}

function resolveAppBaseUrl(): string {
  const fallback = 'http://127.0.0.1:3000';
  const raw = (process.env.NEXTAUTH_URL || fallback).trim();
  return raw.replace(/\/+$/, '');
}

function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Kept as a named export so existing call sites read as invite-specific, but the
 * rule itself lives in `password-policy` alongside the reset flow's copy.
 */
export function validateInvitePassword(password: string): string | null {
  return validatePassword(password);
}

export async function issueAndSendUserInvite(input: {
  userId: string;
  invitedByName: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  await prisma.userInvite.deleteMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
  });

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + getInviteTtlHours() * 60 * 60 * 1000);

  const invite = await prisma.userInvite.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  const inviteUrl = `${resolveAppBaseUrl()}/onboarding?token=${encodeURIComponent(token)}`;
  try {
    await sendUserInviteEmail({
      to: user.email,
      recipientName: user.name,
      invitedByName: input.invitedByName,
      inviteUrl,
      expiresAt: invite.expiresAt,
      role: user.role,
    });
  } catch (err) {
    await prisma.userInvite.delete({
      where: { id: invite.id },
    }).catch(() => {});
    throw err;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    expiresAt: invite.expiresAt,
  };
}

export async function findActiveInviteByToken(rawToken: string) {
  const token = rawToken.trim();
  if (!token) return null;

  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  if (!invite) return null;
  if (invite.usedAt) return null;
  if (invite.expiresAt.getTime() <= Date.now()) return null;

  return invite;
}

export async function acceptInviteAndSetPassword(input: {
  token: string;
  password: string;
}) {
  const invite = await findActiveInviteByToken(input.token);
  if (!invite) return null;

  const passwordError = validateInvitePassword(input.password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const passwordHash = await bcryptjs.hash(normalizePassword(input.password), 12);
  const usedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: invite.user.id },
      data: { password: passwordHash },
    });

    await tx.userInvite.update({
      where: { id: invite.id },
      data: { usedAt },
    });

    await tx.userInvite.deleteMany({
      where: {
        userId: invite.user.id,
        usedAt: null,
      },
    });
  });

  return {
    user: invite.user,
    usedAt,
  };
}
