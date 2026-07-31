import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { renderGuidelinePreview } from '@/lib/ad-generator/guideline-preview';
async function main() {
  const f = '/Users/connorkelly/Oz Marketing/Projects/Loomi/co-op-guidelines/GMCAdStandards.pdf';
  const t0 = Date.now();
  const bytes = new Uint8Array(await readFile(f));
  console.log(`${(bytes.byteLength / 1048576).toFixed(1)} MB`);
  const p = await renderGuidelinePreview(bytes, 'application/pdf');
  console.log(p ? `ok ${p.pageCount}pp ${p.width}x${p.height} in ${Date.now() - t0}ms` : `FAILED after ${Date.now() - t0}ms`);
}
main();
