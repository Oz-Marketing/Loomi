import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/users/password-reset-email';
import { normalizePassword, validatePassword } from '@/lib/users/password-policy';

const DEFAULT_RESET_TTL_MINUTES = 60;

/**
 * Minimum gap between reset emails for one account. Repeat requests inside the
 * window are accepted and silently ignored, so hammering the form can't be used
 * to mail-bomb someone.
 */
const RESEND_COOLDOWN_MS = 60 * 1000;

function getResetTtlMinutes(): number {
  const parsed = Number(process.env.PASSWORD_RESET_TTL_MINUTES || DEFAULT_RESET_TTL_MINUTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RESET_TTL_MINUTES;
  return Math.floor(parsed);
}

function resolveAppBaseUrl(): string {
  const fallback = 'http://127.0.0.1:3000';
  const raw = (process.env.NEXTAUTH_URL || fallback).trim();
  return raw.replace(/\/+$/, '');
}

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Issue a reset token and email it.
 *
 * Callers must treat the return value as advisory only and always report success
 * to the browser — telling an anonymous visitor whether an address has an
 * account is an enumeration oracle. The `outcome` is here for server logs.
 */
export async function requestPasswordReset(rawEmail: string): Promise<{
  outcome: 'sent' | 'unknown_email' | 'throttled';
}> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { outcome: 'unknown_email' };

  const user = await prisma.user.findFirst({
    // Stored emails are lower-cased by the users API, but match
    // case-insensitively so a legacy mixed-case row still resolves.
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  });
  if (!user) return { outcome: 'unknown_email' };

  const recent = await prisma.passwordReset.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return { outcome: 'throttled' };

  // Any older outstanding link for this user stops working the moment a new one
  // is issued — one live reset token per account.
  await prisma.passwordReset.deleteMany({
    where: { userId: user.id, usedAt: null },
  });

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + getResetTtlMinutes() * 60 * 1000);

  const reset = await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt },
    select: { id: true, expiresAt: true },
  });

  const resetUrl = `${resolveAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendPasswordResetEmail({
      to: user.email,
      recipientName: user.name,
      resetUrl,
      expiresAt: reset.expiresAt,
    });
  } catch (err) {
    // Don't leave a live token behind for an email that never went out.
    await prisma.passwordReset.delete({ where: { id: reset.id } }).catch(() => {});
    throw err;
  }

  return { outcome: 'sent' };
}

export async function findActiveResetByToken(rawToken: string) {
  const token = rawToken.trim();
  if (!token) return null;

  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!reset) return null;
  if (reset.usedAt) return null;
  if (reset.expiresAt.getTime() <= Date.now()) return null;

  return reset;
}

/**
 * Set the new password and burn the token. Returns null when the token is
 * missing, already used, or expired; throws when the password fails policy.
 */
export async function completePasswordReset(input: {
  token: string;
  password: string;
}) {
  const reset = await findActiveResetByToken(input.token);
  if (!reset) return null;

  const passwordError = validatePassword(input.password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const passwordHash = await bcryptjs.hash(normalizePassword(input.password), 12);
  const usedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: reset.user.id },
      data: { password: passwordHash },
    });

    await tx.passwordReset.update({
      where: { id: reset.id },
      data: { usedAt },
    });

    // Belt and braces: drop any other outstanding reset AND any unused invite,
    // so an old link can't be replayed to overwrite the password just set.
    await tx.passwordReset.deleteMany({
      where: { userId: reset.user.id, usedAt: null },
    });
    await tx.userInvite.deleteMany({
      where: { userId: reset.user.id, usedAt: null },
    });
  });

  return { user: reset.user, usedAt };
}
