// Preflight for Google Customer Match: can this environment's Google Ads
// credentials actually create and populate a customer list?
//
// Answers the three separate questions people tend to collapse into one:
//
//   1. AUTH — do the credentials work, and which customers can they see?
//   2. WRITE — may they mutate user lists on a given customer? Checked
//      with `validateOnly: true`, so Google validates the operation and
//      returns the errors it *would* have raised without creating
//      anything.
//   3. ELIGIBILITY — is Customer Match actually usable on that account?
//      This is a policy question, not an API-permission one, and a
//      POLICY_ERROR / CUSTOMER_NOT_ELIGIBLE from step 2 is what surfaces
//      it.
//
// Read-only by construction: every mutate below sets validateOnly.
//
//   npx tsx scripts/check-google-customer-match-access.ts [customerId …]
//
// With no arguments it checks every Account.googleAdsCustomerId on file.

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { getGoogleAdsConfig, type GoogleAdsConfig } from '../src/lib/integrations/google-ads';

const REAL_BASE = 'https://googleads.googleapis.com';

async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth refresh failed: ${json.error_description ?? res.status}`);
  }
  return json.access_token;
}

function headers(cfg: GoogleAdsConfig, token: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  };
  if (cfg.loginCustomerId) h['login-customer-id'] = cfg.loginCustomerId;
  return h;
}

const strip = (id: string) => id.replace(/\D/g, '');

async function main() {
  const cfg = getGoogleAdsConfig();
  if (!cfg) {
    console.error(
      'Google Ads is not configured in this environment.\n' +
        'Needs GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`API version : ${cfg.apiVersion}`);
  console.log(`Login (MCC) : ${cfg.loginCustomerId ?? '(none — direct accounts)'}`);

  // ── 1. Auth ──
  let token: string;
  try {
    token = await accessToken(cfg);
    console.log('OAuth       : ✅ refresh token exchanged');
  } catch (err) {
    console.error(`OAuth       : ❌ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  const accessibleRes = await fetch(
    `${REAL_BASE}/${cfg.apiVersion}/customers:listAccessibleCustomers`,
    { headers: headers(cfg, token) },
  );
  const accessibleJson = (await accessibleRes.json().catch(() => ({}))) as {
    resourceNames?: string[];
  };
  if (!accessibleRes.ok) {
    console.error(
      `Accessible  : ❌ ${accessibleRes.status} ${JSON.stringify(accessibleJson).slice(0, 400)}`,
    );
    console.error(
      '\nA 401/403 here usually means the developer token is test-account-only,\n' +
        'or the refresh token belongs to a Google account with no access to the MCC.',
    );
    process.exitCode = 1;
    return;
  }
  const accessible = (accessibleJson.resourceNames ?? []).map((r) => r.split('/')[1]);
  console.log(`Accessible  : ✅ ${accessible.length} customer(s) visible to these credentials`);

  // ── Which customers to check ──
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-')).map(strip);
  let targets: Array<{ customerId: string; label: string }>;
  if (args.length > 0) {
    targets = args.map((id) => ({ customerId: id, label: '(from argv)' }));
  } else {
    const accounts = await prisma.account.findMany({
      where: { googleAdsCustomerId: { not: null } },
      select: { key: true, dealer: true, googleAdsCustomerId: true },
      orderBy: { dealer: 'asc' },
    });
    targets = accounts.map((a) => ({
      customerId: strip(a.googleAdsCustomerId!),
      label: `${a.dealer} (${a.key})`,
    }));
  }

  if (targets.length === 0) {
    console.log('\nNo customer ids to check — no Account has googleAdsCustomerId set.');
    return;
  }

  console.log(`\nChecking ${targets.length} customer account(s)…\n`);

  let writable = 0;
  for (const target of targets) {
    const label = `${target.customerId} ${target.label}`;

    // ── 2. Can we READ user lists? Proves the scope covers the resource. ──
    const readRes = await fetch(
      `${REAL_BASE}/${cfg.apiVersion}/customers/${target.customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: headers(cfg, token),
        body: JSON.stringify({
          query:
            'SELECT user_list.id, user_list.name, user_list.type FROM user_list LIMIT 5',
        }),
      },
    );
    if (!readRes.ok) {
      const body = await readRes.text();
      console.log(`❌ ${label}\n   read user_list → ${readRes.status} ${firstError(body)}`);
      continue;
    }

    // ── 3. Can we WRITE one? validateOnly — nothing is created. ──
    const mutateRes = await fetch(
      `${REAL_BASE}/${cfg.apiVersion}/customers/${target.customerId}/userLists:mutate`,
      {
        method: 'POST',
        headers: headers(cfg, token),
        body: JSON.stringify({
          validateOnly: true,
          operations: [
            {
              create: {
                name: `__preflight_check_${Date.now()}`,
                description: 'Validate-only Customer Match preflight. Never created.',
                membershipLifeSpan: '30',
                crmBasedUserList: { uploadKeyType: 'CONTACT_INFO' },
              },
            },
          ],
        }),
      },
    );

    if (mutateRes.ok) {
      writable += 1;
      console.log(`✅ ${label}\n   read user_list ✓   create user_list (validate-only) ✓`);
      continue;
    }

    const body = await mutateRes.text();
    const detail = firstError(body);
    const eligibility = /POLICY|NOT_ELIGIBLE|CUSTOMER_MATCH|USER_LIST/i.test(body)
      ? '   ↳ looks like a Customer Match ELIGIBILITY/policy issue, not a permission one'
      : /PERMISSION|UNAUTHOR|DEVELOPER_TOKEN/i.test(body)
        ? '   ↳ looks like a PERMISSION / developer-token issue'
        : '';
    console.log(
      `⚠️  ${label}\n   read user_list ✓   create user_list (validate-only) → ${mutateRes.status} ${detail}` +
        (eligibility ? `\n${eligibility}` : ''),
    );
  }

  console.log(
    `\n${writable}/${targets.length} account(s) can create a Customer Match list with these credentials.`,
  );
  console.log(
    '\nStill worth checking by hand (not exposed over the API):\n' +
      '  • Developer token ACCESS LEVEL — Google Ads UI → MCC → Tools & Settings →\n' +
      '    Setup → API Center. "Basic" carries a daily operations cap; a 40k-member\n' +
      '    audience is 40k identifiers, so a large first upload can hit it.\n' +
      '  • Customer Match availability per account — Tools & Settings → Shared\n' +
      '    Library → Audience Manager → Segments → + → Customer list. A greyed-out\n' +
      '    or policy-warned option there is the same signal as a POLICY error above.',
  );
}

/** Pull the most useful line out of a Google Ads error payload. */
function firstError(body: string): string {
  try {
    const json = JSON.parse(body) as {
      error?: { message?: string; details?: Array<{ errors?: Array<{ message?: string; errorCode?: unknown }> }> };
    };
    const nested = json.error?.details?.[0]?.errors?.[0];
    if (nested?.message) {
      const code = JSON.stringify(nested.errorCode ?? {}).replace(/[{}"]/g, '');
      return `${nested.message}${code ? ` [${code}]` : ''}`;
    }
    if (json.error?.message) return json.error.message;
  } catch {
    /* fall through */
  }
  return body.slice(0, 300);
}

main()
  .catch((err) => {
    console.error('[check-google-customer-match-access] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
