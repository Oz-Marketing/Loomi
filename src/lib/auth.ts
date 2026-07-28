import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcryptjs from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { expandAccountKeysWithDescendants } from '@/lib/services/accounts';

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
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    title?: string | null;
    avatarUrl: string | null;
    role: UserRole;
    accountKeys: string[];
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

// ── Google SSO ──
//
// Oz signs in with Google Workspace, and YAG staff will too. It's an
// ALTERNATIVE way to authenticate an existing Loomi user, never a way to create
// one: accounts are still provisioned by invite (see lib/users/invitations.ts),
// and `signIn` below rejects any Google identity without a matching User row —
// so roles and account grants keep coming from our own tables.
//
// The provider is only registered when both env vars are present, so
// environments without Google credentials boot normally with
// credentials-only sign-in (and the login page hides the button — it reads the
// live provider list from NextAuth).
//
// Microsoft/Entra is a planned second provider; it drops in the same way.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const googleSsoConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

/** The DB columns needed to build a session — shared by both providers. */
const AUTH_USER_SELECT = {
  id: true,
  name: true,
  title: true,
  email: true,
  avatarUrl: true,
  role: true,
  accountKeys: true,
} as const;

type AuthUserRow = {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  accountKeys: string;
};

/**
 * Case-insensitive email lookup. The users API stores addresses lower-cased,
 * but Google hands back whatever casing the profile carries and legacy rows may
 * be mixed-case, so neither side can be trusted to match exactly.
 */
async function findAuthUserByEmail(rawEmail: string): Promise<AuthUserRow | null> {
  const email = rawEmail.trim();
  if (!email) return null;
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: AUTH_USER_SELECT,
  });
}

function toSessionUser(row: AuthUserRow) {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? null,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role as UserRole,
    accountKeys: parseStoredAccountKeys(row.accountKeys),
  };
}

async function recordLogin(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  } catch {
    // Do not block sign-in if audit metadata update fails.
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
//
// Don't try to fix that by scoping the cookie to `localhost`: Chromium treats
// `localhost` as a public suffix and drops any cookie carrying that domain, so
// `*.localhost` siblings still never see it (tested). Sharing one dev session
// across surfaces needs a REGISTRABLE wildcard-to-127.0.0.1 parent domain
// (lvh.me and friends) plus the matching *_HOST vars the proxy reads.
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

        await recordLogin(user.id);

        return toSessionUser(user);
      },
    }),
    ...(googleSsoConfigured
      ? [
          GoogleProvider({
            clientId: GOOGLE_CLIENT_ID!,
            clientSecret: GOOGLE_CLIENT_SECRET!,
            authorization: {
              // Always show the chooser — Workspace users routinely have a
              // personal account signed in alongside their work one.
              params: { prompt: 'select_account' },
            },
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    // Send OAuth failures back to the sign-in form (with ?error=<code>) rather
    // than NextAuth's unstyled default error page.
    error: '/login',
  },
  callbacks: {
    /**
     * Only runs as a gate for OAuth — the credentials provider does its own
     * checking in `authorize`. A Google identity is admitted only when the
     * address is Google-verified AND already belongs to a Loomi user; returning
     * a URL string bounces the browser there with a code the login page renders.
     */
    async signIn({ account, profile, user }) {
      if (!account || account.provider === 'credentials') return true;

      const emailVerified = (profile as { email_verified?: boolean } | undefined)
        ?.email_verified;
      const email = (profile?.email ?? user?.email ?? '').trim();

      if (!email || emailVerified === false) {
        return '/login?error=OAuthUnverifiedEmail';
      }

      const existing = await findAuthUserByEmail(email);
      if (!existing) return '/login?error=OAuthNoAccount';

      await recordLogin(existing.id);
      return true;
    },

    async jwt({ token, user, account, trigger, session }) {
      if (user) {
        // OAuth hands us a provider profile (its `id` is the Google `sub`), not
        // a Loomi user row — so re-resolve against our own tables and seed the
        // token from there. `signIn` above already proved a match exists; if the
        // row somehow vanished between the two, fall through and let the token
        // stay unseeded rather than trusting provider data.
        const isOAuth = account ? account.provider !== 'credentials' : false;
        const seed = isOAuth
          ? await findAuthUserByEmail(user.email ?? '').then((row) =>
              row ? toSessionUser(row) : null,
            )
          : user;

        if (seed) {
          token.id = seed.id;
          token.name = seed.name;
          token.email = seed.email;
          token.title = seed.title ?? null;
          token.avatarUrl = seed.avatarUrl;
          token.role = seed.role;
          const accountKeys = Array.isArray(seed.accountKeys) ? seed.accountKeys : [];
          token.accountKeys = accountKeys;
          if (seed.role === 'client' && accountKeys.length > 0) {
            token.defaultAccountSlug = await getDefaultAccountSlug(accountKeys);
          }
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

        // Start impersonation — overwrite token with target user data
        if (s.impersonateAs) {
          const imp = s.impersonateAs as {
            id: string; name: string; email: string;
            title: string | null; avatarUrl: string | null; role: UserRole;
            accountKeys?: string[]; originalUserId: string;
          };
          const accountKeys = Array.isArray(imp.accountKeys) ? imp.accountKeys : [];
          token.id = imp.id;
          token.name = imp.name;
          token.email = imp.email;
          token.title = imp.title;
          token.avatarUrl = imp.avatarUrl;
          token.role = imp.role;
          token.accountKeys = accountKeys;
          token.originalUserId = imp.originalUserId;
        }

        // Stop impersonation — revert to original user data
        if (s.revertImpersonation) {
          const rev = s.revertImpersonation as {
            id: string; name: string; email: string;
            title: string | null; avatarUrl: string | null; role: UserRole;
            accountKeys?: string[];
          };
          const accountKeys = Array.isArray(rev.accountKeys) ? rev.accountKeys : [];
          token.id = rev.id;
          token.name = rev.name;
          token.email = rev.email;
          token.title = rev.title;
          token.avatarUrl = rev.avatarUrl;
          token.role = rev.role;
          token.accountKeys = accountKeys;
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
            select: { role: true, accountKeys: true },
          });
          if (freshUser) {
            token.role = freshUser.role as UserRole;
            const freshKeys = parseStoredAccountKeys(freshUser.accountKeys);
            token.accountKeys = freshKeys;
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

      // A grant on a group account (e.g. `youngAutomotiveGroup`) implies every
      // rooftop beneath it. Runs for every non-elevated user with grants.
      if (
        token.accountKeys.length > 0 &&
        token.role !== 'developer' &&
        token.role !== 'super_admin'
      ) {
        const withDescendants = await expandAccountKeysWithDescendants(token.accountKeys);
        if (withDescendants.length > token.accountKeys.length) {
          token.accountKeys = withDescendants;
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
      session.user.originalUserId = token.originalUserId ?? null;
      return session;
    },
  },
};
