import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcryptjs from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { resolveOrgAccountKeys } from '@/lib/services/organizations';

// Re-export client-safe role types/constants so server code can import from either file
export type { UserRole } from '@/lib/roles';
export { ELEVATED_ROLES, MANAGEMENT_ROLES, ALL_ROLES, roleDisplayName } from '@/lib/roles';
import type { UserRole } from '@/lib/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      title: string | null;
      email: string;
      avatarUrl: string | null;
      role: UserRole;
      accountKeys: string[];
      // Organization keys the user is granted directly. Distinct from
      // accountKeys (which already includes every rooftop these orgs expand
      // to); used by the client to offer org-mode in the switcher.
      orgKeys: string[];
      originalUserId?: string | null;
    };
  }

  interface User {
    id: string;
    name: string;
    title: string | null;
    email: string;
    avatarUrl: string | null;
    role: UserRole;
    accountKeys: string[];
    orgKeys: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    title?: string | null;
    avatarUrl: string | null;
    role: UserRole;
    accountKeys: string[];
    // Org grants held by the user (raw, before expansion into accountKeys).
    orgKeys: string[];
    defaultAccountSlug?: string | null;
    originalUserId?: string;
    _roleCheckedAt?: number;
  }
}

async function getAllAccountKeys(): Promise<string[]> {
  try {
    const accounts = await prisma.account.findMany({ select: { key: true } });
    return accounts.filter((a) => !a.key.startsWith('_')).map((a) => a.key);
  } catch {
    return [];
  }
}

async function getDefaultAccountSlug(accountKeys: string[]): Promise<string | null> {
  if (accountKeys.length === 0) return null;
  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKeys[0] },
      select: { slug: true },
    });
    return account?.slug ?? null;
  } catch {
    return null;
  }
}

function parseStoredAccountKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// Cross-subdomain session sharing.
//
// In prod (`https://` NEXTAUTH_URL) we scope NextAuth cookies to `.loomilm.com`
// so a single login covers every Loomi surface (studio, reporting, future
// subdomains). NextAuth's default `__Host-` prefix on the CSRF cookie does
// NOT permit a `domain` attribute, so we drop down to `__Secure-` for all
// three cookies that participate in the auth flow.
//
// In dev (NEXTAUTH_URL=http://localhost:3000) we omit the domain and the
// secure flag; sessions are scoped to whichever localhost host you signed in
// on. Cross-subdomain testing locally (e.g. localhost ↔ reporting.localhost)
// requires logging in on each — rare in practice.
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const cookiePrefix = useSecureCookies ? '__Secure-' : '';
const cookieDomain = useSecureCookies ? '.loomilm.com' : undefined;

export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
    callbackUrl: {
      name: `${cookiePrefix}next-auth.callback-url`,
      options: {
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
    csrfToken: {
      // NextAuth defaults this to `__Host-next-auth.csrf-token`, which
      // forbids setting `domain`. We switch to `__Secure-` so the token
      // can be shared across subdomains.
      name: `${cookiePrefix}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const isValid = await bcryptjs.compare(credentials.password, user.password);
        if (!isValid) return null;

        const loginTimestamp = new Date();
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: loginTimestamp },
          });
        } catch {
          // Do not block sign-in if audit metadata update fails.
        }

        const accountKeys = parseStoredAccountKeys(user.accountKeys);
        const orgKeys = parseStoredAccountKeys(user.orgKeys);
        return {
          id: user.id,
          name: user.name,
          title: user.title ?? null,
          email: user.email,
          avatarUrl: user.avatarUrl,
          role: user.role as UserRole,
          accountKeys,
          orgKeys,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.title = user.title ?? null;
        token.avatarUrl = user.avatarUrl;
        token.role = user.role;
        const accountKeys = Array.isArray(user.accountKeys) ? user.accountKeys : [];
        token.accountKeys = accountKeys;
        token.orgKeys = Array.isArray(user.orgKeys) ? user.orgKeys : [];
        if (user.role === 'client' && accountKeys.length > 0) {
          token.defaultAccountSlug = await getDefaultAccountSlug(accountKeys);
        }
      }

      if (trigger === 'update' && session) {
        const s = session as Record<string, unknown>;

        if (s.name !== undefined) {
          token.name = (s.name as string);
        }
        if (s.email !== undefined) {
          token.email = (s.email as string);
        }

        // Avatar update
        if (s.avatarUrl !== undefined) {
          token.avatarUrl = (s.avatarUrl as string | null);
        }
        if (s.title !== undefined) {
          token.title = (s.title as string | null);
        }
        if (s.role !== undefined) {
          token.role = s.role as UserRole;
        }
        if (s.accountKeys !== undefined) {
          token.accountKeys = Array.isArray(s.accountKeys) ? (s.accountKeys as string[]) : [];
        }
        if (s.orgKeys !== undefined) {
          token.orgKeys = Array.isArray(s.orgKeys) ? (s.orgKeys as string[]) : [];
        }

        // Start impersonation — overwrite token with target user data
        if (s.impersonateAs) {
          const imp = s.impersonateAs as {
            id: string; name: string; email: string;
            title: string | null; avatarUrl: string | null; role: UserRole;
            accountKeys?: string[]; orgKeys?: string[]; originalUserId: string;
          };
          const accountKeys = Array.isArray(imp.accountKeys) ? imp.accountKeys : [];
          token.id = imp.id;
          token.name = imp.name;
          token.email = imp.email;
          token.title = imp.title;
          token.avatarUrl = imp.avatarUrl;
          token.role = imp.role;
          token.accountKeys = accountKeys;
          token.orgKeys = Array.isArray(imp.orgKeys) ? imp.orgKeys : [];
          token.originalUserId = imp.originalUserId;
        }

        // Stop impersonation — revert to original user data
        if (s.revertImpersonation) {
          const rev = s.revertImpersonation as {
            id: string; name: string; email: string;
            title: string | null; avatarUrl: string | null; role: UserRole;
            accountKeys?: string[]; orgKeys?: string[];
          };
          const accountKeys = Array.isArray(rev.accountKeys) ? rev.accountKeys : [];
          token.id = rev.id;
          token.name = rev.name;
          token.email = rev.email;
          token.title = rev.title;
          token.avatarUrl = rev.avatarUrl;
          token.role = rev.role;
          token.accountKeys = accountKeys;
          token.orgKeys = Array.isArray(rev.orgKeys) ? rev.orgKeys : [];
          delete token.originalUserId;
        }
      }

      // Periodically refresh role & accountKeys from DB so admin-side changes
      // (e.g. promoting a user) take effect without requiring re-login.
      const ROLE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      if (!token._roleCheckedAt || now - token._roleCheckedAt > ROLE_REFRESH_MS) {
        token._roleCheckedAt = now;
        try {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.id },
            select: { role: true, accountKeys: true, orgKeys: true },
          });
          if (freshUser) {
            token.role = freshUser.role as UserRole;
            const freshKeys = parseStoredAccountKeys(freshUser.accountKeys);
            token.accountKeys = freshKeys;
            token.orgKeys = parseStoredAccountKeys(freshUser.orgKeys);
            if (freshUser.role === 'client' && freshKeys.length > 0) {
              token.defaultAccountSlug = await getDefaultAccountSlug(freshKeys);
            }
          }
        } catch {
          // Swallow — keep existing token values on DB failure
        }
      }

      if (!Array.isArray(token.accountKeys)) {
        token.accountKeys = [];
      }
      if (!Array.isArray(token.orgKeys)) {
        token.orgKeys = [];
      }

      // Expand org grants into per-account access. A user assigned to an
      // Organization transparently gains access to every rooftop under it, so
      // all existing accountKey-scoped auth/queries keep working unchanged.
      // Skipped for elevated roles (they already see everything) and when the
      // user holds no org grants.
      if (
        token.orgKeys.length > 0 &&
        token.role !== 'developer' &&
        token.role !== 'super_admin'
      ) {
        const orgChildKeys = await resolveOrgAccountKeys(token.orgKeys);
        if (orgChildKeys.length > 0) {
          token.accountKeys = Array.from(
            new Set([...token.accountKeys, ...orgChildKeys]),
          );
        }
      }

      // Admins / super-admins with no explicit account assignments get full access.
      if ((token.role === 'admin' || token.role === 'super_admin') && token.accountKeys.length === 0) {
        token.accountKeys = await getAllAccountKeys();
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.name = token.name || session.user.name;
      session.user.email = token.email || session.user.email;
      session.user.title = token.title ?? null;
      session.user.avatarUrl = token.avatarUrl ?? null;
      session.user.role = token.role;
      session.user.accountKeys = token.accountKeys;
      session.user.orgKeys = token.orgKeys ?? [];
      session.user.originalUserId = token.originalUserId ?? null;
      return session;
    },
  },
};
