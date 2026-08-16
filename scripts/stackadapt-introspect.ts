/**
 * Print every field StackAdapt exposes on its delivery-stats type.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Video completion rate is the deliverable for a CTV/OTT product — impressions
 * and clicks say almost nothing about a connected-TV buy. Adding it needs the
 * exact field names on `DeliveryStatsRecord`, and StackAdapt's schema is
 * proprietary: it is not in their public docs, and the field list Loomi uses
 * today was copied verbatim from Oz Dealer Tools' PHP fragment rather than
 * derived from the schema.
 *
 * Guessing was the alternative and it is a bad one. `METRICS_FRAGMENT` in
 * lib/integrations/stackadapt.ts is shared by the account, campaign,
 * campaign-group, daily AND creative queries, so one invalid field name does
 * not degrade the video section — it fails every one of those requests and
 * takes the whole StackAdapt report down.
 *
 * Run this once against an environment that has STACKADAPT_API_KEY, paste the
 * video-ish field names into the implementation, and the guesswork is gone.
 *
 *   npx tsx scripts/stackadapt-introspect.ts
 *   npx tsx scripts/stackadapt-introspect.ts --type SomeOtherType
 */

const ENDPOINT = 'https://api.stackadapt.com/graphql';

const QUERY = `
  query IntrospectType($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
        description
        type { name kind ofType { name kind } }
      }
    }
  }
`;

interface IntrospectedField {
  name: string;
  description: string | null;
  type: { name: string | null; kind: string; ofType: { name: string | null; kind: string } | null };
}

/** Unwrap NON_NULL / LIST wrappers to something printable. */
function typeName(t: IntrospectedField['type']): string {
  return t.name ?? t.ofType?.name ?? t.kind;
}

async function main() {
  const apiKey = process.env.STACKADAPT_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      '[stackadapt-introspect] STACKADAPT_API_KEY is not set.\n' +
        'Run this where the key lives (a droplet, or locally with it exported).',
    );
    process.exit(1);
  }

  const typeArg = process.argv.indexOf('--type');
  const typeName_ = typeArg > -1 ? process.argv[typeArg + 1] : 'DeliveryStatsRecord';

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: QUERY, variables: { name: typeName_ } }),
  });

  if (!res.ok) {
    console.error(`[stackadapt-introspect] HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const json = (await res.json()) as {
    data?: { __type?: { name: string; fields: IntrospectedField[] } | null };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    console.error('[stackadapt-introspect] GraphQL errors:');
    json.errors.forEach((e) => console.error(`  - ${e.message}`));
    // Introspection is commonly disabled on production GraphQL endpoints; say
    // so plainly rather than leaving the reader to infer it from a null type.
    console.error(
      '\nIf this says introspection is disabled, ask StackAdapt support for the\n' +
        'DeliveryStatsRecord field list — specifically the video completion and\n' +
        'quartile fields.',
    );
    process.exit(1);
  }

  const fields = json.data?.__type?.fields;
  if (!fields?.length) {
    console.error(`[stackadapt-introspect] No type named "${typeName_}" in the schema.`);
    process.exit(1);
  }

  console.log(`\n${typeName_} — ${fields.length} fields\n`);
  for (const f of fields) {
    console.log(`  ${f.name.padEnd(38)} ${typeName(f.type).padEnd(12)} ${f.description ?? ''}`);
  }

  // The point of the exercise, surfaced rather than left to a manual scan.
  const interesting = fields.filter((f) => /video|complet|quartile|vcr|view|reach/i.test(f.name));
  if (interesting.length) {
    console.log('\nVideo / completion candidates:\n');
    for (const f of interesting) {
      console.log(`  ${f.name.padEnd(38)} ${typeName(f.type)}`);
    }
  } else {
    console.log('\nNo video-looking fields on this type — completion data may live on another.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('[stackadapt-introspect] failed', err);
  process.exit(1);
});
