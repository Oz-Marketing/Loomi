/**
 * Local test for campaign screenshot rendering.
 *
 * Usage:
 *   npx tsx scripts/test-screenshot.ts [path-to-email.html]
 *
 * If no HTML file is provided, uses a built-in sample email.
 * Outputs the PNG to scripts/test-screenshot-output.png
 */
import fs from 'fs';
import path from 'path';

// Force development mode so it uses local puppeteer.
// `process.env.NODE_ENV` is typed readonly in Node's env types.
(process.env as Record<string, string | undefined>).NODE_ENV = 'development';

async function main() {
  const { renderCampaignScreenshotFromHtml } = await import(
    '../src/lib/email/screenshot'
  );

  const htmlArg = process.argv[2];
  let html: string;

  if (htmlArg) {
    html = fs.readFileSync(path.resolve(htmlArg), 'utf-8');
    console.log(`Loaded HTML from: ${htmlArg} (${html.length} chars)`);
  } else {
    // Sample email HTML for testing
    html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #1a1a2e; padding: 40px 20px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 28px; }
    .header p { color: #a0a0b0; margin: 8px 0 0; font-size: 14px; }
    .body { padding: 32px 24px; }
    .body h2 { color: #1a1a2e; font-size: 22px; margin: 0 0 16px; }
    .body p { color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .cta { display: inline-block; background: #2563eb; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px; }
    .features { padding: 24px; background: #f0f4ff; }
    .features h3 { color: #1a1a2e; font-size: 18px; margin: 0 0 12px; }
    .feature-item { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
    .feature-icon { width: 32px; height: 32px; background: #2563eb; border-radius: 50%; flex-shrink: 0; }
    .feature-text { color: #555; font-size: 14px; line-height: 1.5; }
    .footer { background: #1a1a2e; padding: 24px; text-align: center; }
    .footer p { color: #a0a0b0; font-size: 12px; margin: 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Spring Tire Event</h1>
      <p>FREE alignment with tire purchase</p>
    </div>
    <div class="body">
      <h2>What's Included</h2>
      <p>Everything your vehicle needs for a smooth, safe spring — all in one visit.</p>
      <p>Premium tire installation, FREE 4-wheel alignment, multi-point vehicle inspection, and OEM-recommended tires.</p>
      <p style="text-align: center; margin-top: 24px;">
        <a href="#" class="cta">Find a Location Near You →</a>
      </p>
    </div>
    <div class="features">
      <h3>Why Thousands Trust Us</h3>
      <div class="feature-item">
        <div class="feature-icon"></div>
        <div class="feature-text"><strong>OEM-Certified Technicians</strong><br>Factory-trained pros who know your vehicle.</div>
      </div>
      <div class="feature-item">
        <div class="feature-icon"></div>
        <div class="feature-text"><strong>Genuine OEM Parts</strong><br>We use the exact parts your vehicle requires.</div>
      </div>
      <div class="feature-item">
        <div class="feature-icon"></div>
        <div class="feature-text"><strong>Flexible Scheduling</strong><br>Online booking, evening hours & Saturday service.</div>
      </div>
    </div>
    <div class="footer">
      <p>© 2026 Young Automotive Group · Serving Utah, Idaho, & Montana</p>
      <p style="margin-top: 8px;">Locations · Privacy Policy · Unsubscribe</p>
    </div>
  </div>
</body>
</html>`;
    console.log('Using built-in sample email HTML');
  }

  console.log('Rendering screenshot...');
  const start = Date.now();

  const result = await renderCampaignScreenshotFromHtml({
    html,
    filename: 'test-screenshot.png',
  });

  const outPath = path.join(__dirname, 'test-screenshot-output.png');
  fs.writeFileSync(outPath, result.image);

  console.log(`Done in ${Date.now() - start}ms`);
  console.log(`Output: ${outPath} (${(result.image.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
