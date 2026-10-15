/**
 * Draft one monday deliverable now, in this process, and print what came out.
 *
 * The hand-run end to end of docs/email-drafting.md: what the intake would do
 * for this subitem on its next pass, without waiting for the worker or needing
 * DRAFTING_INTAKE_ENABLED. It writes to monday exactly as the pipeline does —
 * Draft Files, the Loomi Template link and one update — so outside production
 * the subitem must be nominated:
 *
 *   DRAFTING_MONDAY_WRITE_SUBITEMS=<id> npx tsx --env-file=.env.local \
 *     scripts/drafting-run.ts --subitem <id> [--account <key>] [--reread]
 *
 *   --account  skip the Client → account match and draft for this account key
 *   --reread   discard the saved reading and read the creative again
 *
 * Needs MONDAY_API_TOKEN, ANTHROPIC_API_KEY and the S3_* settings (the creative
 * is the email's hero image, so it needs a lasting URL).
 */
import { prisma } from '../src/lib/prisma';
import { stopBoss } from '../src/lib/queue/boss';
import { isMondayConfigured } from '../src/lib/monday/client';
import { suggestAccount } from '../src/lib/drafting/accounts';
import { accountOptions } from '../src/lib/drafting/intake';
import { runDraftingJob } from '../src/lib/drafting/job';
import { getDeliverable } from '../src/lib/drafting/monday-board';
import { parseReading } from '../src/lib/drafting/reading';
import { startDraftRequest } from '../src/lib/drafting/requests';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

function json<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const subitemId = arg('subitem');
  if (!subitemId) throw new Error('Pass --subitem <id>.');
  if (!isMondayConfigured()) throw new Error('MONDAY_API_TOKEN is not set.');

  let accountKey = arg('account');
  let clientName: string | null = null;
  if (!accountKey) {
    const d = await getDeliverable(subitemId);
    const clients = d?.project?.clients ?? [];
    if (clients.length !== 1) throw new Error(`The project names ${clients.length} clients (${clients.join(', ')}); pass --account.`);
    clientName = clients[0];
    const match = suggestAccount(clientName, await accountOptions());
    if (!match.accountKey) throw new Error(`${match.reason ?? 'No account match.'} Pass --account.`);
    accountKey = match.accountKey;
  }
  console.log(`Account: ${accountKey}${clientName ? ` (from monday Client "${clientName}")` : ''}`);

  if (has('reread')) {
    await prisma.draftRequest.updateMany({ where: { mondaySubitemId: subitemId }, data: { extraction: null } });
  }
  const started = await startDraftRequest({ subitemId, accountKey, clientName });
  if (!started.ok) throw new Error(`Couldn't start: ${started.error}`);

  // The worker would pick the queued job up; run it here instead. Its claim is
  // a conditional update, so a worker that also sees the job finds nothing to do.
  await runDraftingJob(started.requestId);

  const request = await prisma.draftRequest.findUniqueOrThrow({
    where: { id: started.requestId },
    include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
  });
  console.log(`\nStatus: ${request.status}${request.error ? ` — ${request.error}` : ''}`);

  const reading = parseReading(request.extraction);
  if (reading) {
    console.log(`\nRead as: ${reading.requestType} (${reading.model})`);
    for (const f of reading.fields) console.log(`  ${f.label}: ${f.value}${f.confidence === 'low' ? '  [LOW]' : ''}`);
    console.log(`  Disclaimer${reading.disclaimer?.confidence === 'low' ? ' [LOW]' : ''}: ${reading.disclaimer?.text ?? '(none)'}`);
    for (const u of reading.unreadable ?? []) console.log(`  Unreadable: ${u}`);
  }
  for (const c of json<{ label: string; creative: string; request: string }[]>(request.conflicts, [])) {
    console.log(`\nCONFLICT ${c.label}\n  creative: ${c.creative}\n  request:  ${c.request}`);
  }

  const v = request.versions[0];
  if (v) {
    console.log(`\nVersion ${v.number}`);
    for (const s of json<{ kind: string; text: string }[]>(v.subjects, [])) console.log(`  subject (${s.kind}): ${s.text}`);
    for (const p of json<{ kind: string; text: string }[]>(v.previews, [])) console.log(`  preview (${p.kind}): ${p.text}`);
    const evaluation = json<{ violations: { severity: string; ruleId: string; message: string }[] }>(v.evaluation, { violations: [] });
    for (const x of evaluation.violations) console.log(`  ${x.severity.toUpperCase()} ${x.ruleId}: ${x.message}`);
    for (const n of json<string[]>(v.notes, [])) console.log(`  note: ${n}`);
    console.log(v.uploadedAt ? `  Uploaded to Draft Files ${v.uploadedAt.toISOString()}` : '  Not uploaded.');
  }
  if (request.blastId) {
    const blast = await prisma.emailBlast.findUnique({ where: { id: request.blastId }, select: { name: true, status: true, subject: true } });
    if (blast) console.log(`\nDraft blast: "${blast.name}" (${blast.status}) — /messaging/blasts/${request.blastId}/template`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  // The enqueue opened a pg-boss connection; without stopping it the script never exits.
  .finally(async () => {
    await stopBoss().catch(() => {});
    await prisma.$disconnect();
  });
