/**
 * Server-side report → PDF. Renders a {@link ReportDoc} to a branded, print-
 * friendly HTML document, then rasterizes it with headless Chromium.
 *
 * The browser-launch mirrors src/lib/email/screenshot.ts: full `puppeteer`
 * (bundled Chromium) in dev, @sparticuz/chromium in production (the droplet
 * has no system Chrome). Kept self-contained so the working screenshot path
 * is untouched.
 */
import puppeteerCore, { type Browser } from 'puppeteer-core';
import { type ReportDoc, formatCell } from './report-doc';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function launchBrowser(): Promise<Browser> {
  if (IS_PRODUCTION) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as Promise<Browser>;
  }
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }) as unknown as Promise<Browser>;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Build the branded print HTML for a report document. */
export function renderReportHtml(doc: ReportDoc, generatedAt: string): string {
  const metaRow = (doc.meta ?? [])
    .map((m) => `<span class="meta-item"><span class="meta-label">${esc(m.label)}</span> ${esc(m.value)}</span>`)
    .join('');

  const kpis = (doc.kpis ?? [])
    .map(
      (k) => `
        <div class="kpi">
          <div class="kpi-label">${esc(k.label)}</div>
          <div class="kpi-value">${esc(k.value)}</div>
          ${k.secondary ? `<div class="kpi-sub">${esc(k.secondary)}</div>` : ''}
        </div>`,
    )
    .join('');

  const totalMode = (c: ReportDoc['sections'][number]['columns'][number]) =>
    c.total ?? (c.type === 'percent' ? 'avg' : c.type === 'text' ? 'none' : 'sum');

  const sections = doc.sections
    .map((s) => {
      const head = s.columns
        .map((c) => `<th class="${c.type === 'text' ? 'l' : ''}">${esc(c.header)}</th>`)
        .join('');
      const body = s.rows.length
        ? s.rows
            .map(
              (r) =>
                `<tr>${r
                  .map((c, i) => {
                    const col = s.columns[i];
                    const cls = col?.type === 'text' ? 'l' : '';
                    return `<td class="${cls}">${esc(col ? formatCell(c, col.type) : c)}</td>`;
                  })
                  .join('')}</tr>`,
            )
            .join('')
        : `<tr><td class="empty" colspan="${s.columns.length}">No data in this range.</td></tr>`;

      // TOTAL row (matches the Excel export): sum counts/money, average rates,
      // skip non-additive columns (Quality Score, CPM, …).
      let totals = '';
      if (s.rows.length) {
        const cells = s.columns.map((col, i) => {
          const mode = totalMode(col);
          const cls = col.type === 'text' ? 'l' : '';
          if (mode === 'none') return `<td class="${cls}">${i === 0 ? 'TOTAL' : ''}</td>`;
          const nums = s.rows.map((r) => r[i]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          const agg = mode === 'avg'
            ? nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN
            : nums.reduce((a, b) => a + b, 0);
          return `<td class="${cls}">${esc(formatCell(agg, col.type))}</td>`;
        });
        totals = `<tr class="total">${cells.join('')}</tr>`;
      }

      return `
        <section class="block">
          <h2>${esc(s.title)} <span class="count">${s.rows.length}</span></h2>
          <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}${totals}</tbody>
          </table>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #18181b; margin: 0; padding: 0; font-size: 12px; }
  .header { border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: #52525b; font-size: 13px; }
  .meta { margin-top: 8px; color: #71717a; font-size: 11px; }
  .meta-item { margin-right: 16px; }
  .meta-label { color: #a1a1aa; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; }
  .kpi { border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 12px; }
  .kpi-label { text-transform: uppercase; letter-spacing: .04em; font-size: 9px; color: #71717a; }
  .kpi-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .kpi-sub { font-size: 10px; color: #71717a; margin-top: 1px; }
  .block { margin-bottom: 22px; }
  h2 { font-size: 13px; margin: 0 0 8px; color: #3f3f46; break-after: avoid; }
  .count { color: #a1a1aa; font-weight: 400; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  /* Repeat the header row on every page a long table spans. */
  thead { display: table-header-group; }
  tbody tr { break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em;
       color: #ffffff; background: #6366f1; padding: 6px 8px; }
  td { text-align: right; padding: 5px 8px; border-bottom: 1px solid #f4f4f5; font-variant-numeric: tabular-nums; }
  th.l, td.l { text-align: left; }
  td.l { font-weight: 500; }
  tbody tr:nth-child(even) td { background: #f8f8fb; }
  tr.total td { font-weight: 700; background: #ededf2; border-top: 1.5px solid #6366f1; border-bottom: none; }
  td.empty { text-align: center; color: #a1a1aa; padding: 14px; }
  .footer { margin-top: 14px; color: #a1a1aa; font-size: 9px; text-align: right; }
</style></head>
<body>
  <div class="header">
    <h1>${esc(doc.title)}</h1>
    ${doc.subtitle ? `<div class="subtitle">${esc(doc.subtitle)}</div>` : ''}
    ${metaRow ? `<div class="meta">${metaRow}</div>` : ''}
  </div>
  ${kpis ? `<div class="kpis">${kpis}</div>` : ''}
  ${sections}
  <div class="footer">Generated ${esc(generatedAt)} · Loomi Studio</div>
</body></html>`;
}

/** Render a report document to a PDF buffer. */
export async function renderReportPdf(doc: ReportDoc): Promise<Buffer> {
  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const html = renderReportHtml(doc, generatedAt);

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: 15000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
