/**
 * Exercise the email-drafting monday client against the real Development
 * Projects board. A script, not a feature: it proves the reads parse real data
 * and the one write lands where it should, before any pipeline is built on top.
 *
 * Reads (safe — they change nothing):
 *   npx tsx --env-file=.env.local scripts/drafting-monday-smoke.ts --list
 *   npx tsx --env-file=.env.local scripts/drafting-monday-smoke.ts --subitem <id>
 *   npx tsx --env-file=.env.local scripts/drafting-monday-smoke.ts --subitem <id> --download
 *
 * The one write — attach a file to the subitem's Draft Files column. Refused
 * unless the subitem is nominated in DRAFTING_MONDAY_WRITE_SUBITEMS:
 *   DRAFTING_MONDAY_WRITE_SUBITEMS=<id> npx tsx --env-file=.env.local \
 *     scripts/drafting-monday-smoke.ts --subitem <id> --upload ./draft.png
 *
 * Needs MONDAY_API_TOKEN. See docs/email-drafting.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { downloadMondayAsset, isMondayConfigured } from '../src/lib/monday/client';
import { getDeliverable, listReadyDeliverables, uploadDraftFile } from '../src/lib/drafting/monday-board';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
};

async function main(): Promise<void> {
  if (!isMondayConfigured()) {
    console.error('MONDAY_API_TOKEN is not set.');
    process.exit(1);
  }

  if (has('list')) {
    const ready = await listReadyDeliverables();
    console.log(`${ready.length} deliverable(s) with Assets Approved = Approved:`);
    for (const d of ready) {
      const state = d.hasDraftFiles ? 'has Draft Files' : 'ready to draft';
      console.log(`  ${d.id}  ${d.kind.padEnd(12)} ${d.name.padEnd(18)} ${state.padEnd(16)} ${d.projectName ?? '(no project)'}`);
    }
    return;
  }

  const subitemId = arg('subitem');
  if (!subitemId) {
    console.error('Pass --list, or --subitem <id> [--download | --upload <file>].');
    process.exit(1);
  }

  const upload = arg('upload');
  if (upload) {
    const bytes = fs.readFileSync(upload);
    const type = MIME[path.extname(upload).toLowerCase()] ?? 'application/octet-stream';
    const result = await uploadDraftFile(subitemId, new File([bytes], path.basename(upload), { type }));
    console.log(`Attached ${path.basename(upload)} to Draft Files on ${subitemId} (asset ${result.assetId ?? 'unknown'}).`);
    return;
  }

  const d = await getDeliverable(subitemId);
  if (!d) {
    console.error(`monday has no item ${subitemId}.`);
    process.exit(1);
  }
  console.log(JSON.stringify(d, null, 2));

  if (has('download')) {
    for (const f of d.designAssets) {
      const file = await downloadMondayAsset(f.assetId);
      console.log(`downloaded ${file.name}: ${file.bytes.length} bytes, ${file.contentType ?? 'unknown type'}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
