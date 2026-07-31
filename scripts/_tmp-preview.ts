import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { renderGuidelinePreview } from '@/lib/ad-generator/guideline-preview';

const DIR = '/Users/connorkelly/Oz Marketing/Projects/Loomi/co-op-guidelines';
const files = ['imrProgramGuidelines.pdf', 'Subaru_SAF_Guidelines_2026.pdf', '2025 Yamaha WaterCraft-Dealer Manual Final.pdf', 'MCAP_Interactive_Guidelines_Aug_2025.pdf'];

async function main() {
  for (const f of files) {
    const t0 = Date.now();
    const bytes = new Uint8Array(await readFile(`${DIR}/${f}`));
    const p = await renderGuidelinePreview(bytes, 'application/pdf');
    if (!p) { console.log(`FAIL  ${f}`); continue; }
    console.log(`ok    ${f}: ${p.pageCount}pp, ${p.width}x${p.height}, ${Math.round(p.dataUri.length / 1024)}KB uri, ${Date.now() - t0}ms`);
    await writeFile(`/tmp/prev-${f.slice(0, 12).replace(/[^a-z0-9]/gi, '_')}.webp`, Buffer.from(p.dataUri.split(',')[1], 'base64'));
  }
}
main();
