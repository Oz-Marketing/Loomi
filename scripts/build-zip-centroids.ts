/**
 * Regenerates src/lib/reporting/zip-centroids.json from the US Census ZCTA
 * Gazetteer.
 *
 *   npx tsx scripts/build-zip-centroids.ts [path/to/YYYY_Gaz_zcta_national.txt]
 *
 * With no argument it downloads the current vintage from census.gov.
 *
 * WHY THIS FILE EXISTS. The Customer Heatmap plots events by the customer's ZIP
 * and needs a coordinate per ZIP. The alternatives were a billed Maps API key
 * or third-party tile requests from every client's browser; a bundled centroid
 * table costs one megabyte on the SERVER only (the map API joins against it and
 * ships just the ZIPs that have data) and keeps dealer customer distributions
 * off other people's servers. See docs/odt-reporting-migration.md.
 *
 * LICENCE. US Census Bureau Gazetteer files are US Government works and are in
 * the public domain — no attribution required, no usage restrictions. This is
 * the same source most commercial ZIP-coordinate products are derived from.
 *
 * The Gazetteer is tab-delimited with a header row:
 *   GEOID  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG
 * INTPTLAT/INTPTLONG are *interior points* — guaranteed to fall inside the
 * ZCTA polygon, unlike a naive centroid which can land outside a crescent- or
 * ring-shaped ZIP.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Bump when pointing at a newer Gazetteer vintage. */
const VINTAGE = '2024';
const URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${VINTAGE}_Gazetteer/${VINTAGE}_Gaz_zcta_national.zip`;
const OUT = path.join(process.cwd(), 'src/lib/reporting/zip-centroids.json');

/** ~11m of precision. ZIP centroids do not deserve more, and it halves the file. */
const DECIMALS = 4;

function download(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gaz-'));
  const zip = path.join(dir, 'gaz.zip');
  console.log(`Downloading ${URL}`);
  execFileSync('curl', ['-sSL', '--max-time', '180', '-o', zip, URL]);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  return path.join(dir, `${VINTAGE}_Gaz_zcta_national.txt`);
}

function main() {
  const src = process.argv[2] ?? download();
  const lines = readFileSync(src, 'utf8').split('\n');

  const header = lines[0].split('\t').map((h) => h.trim());
  const iGeoid = header.indexOf('GEOID');
  const iLat = header.indexOf('INTPTLAT');
  const iLng = header.indexOf('INTPTLONG');
  if (iGeoid < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`Unexpected Gazetteer columns: ${header.join(', ')}`);
  }

  const centroids: Record<string, [number, number]> = {};
  let skipped = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const zip = (cols[iGeoid] ?? '').trim();
    const lat = Number((cols[iLat] ?? '').trim());
    const lng = Number((cols[iLng] ?? '').trim());

    // A ZCTA with no interior point is unusable for plotting; drop it rather
    // than emit a 0,0 that would render in the Gulf of Guinea.
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped += 1;
      continue;
    }
    centroids[zip] = [
      Number(lat.toFixed(DECIMALS)),
      Number(lng.toFixed(DECIMALS)),
    ];
  }

  const count = Object.keys(centroids).length;
  if (count < 30_000) {
    throw new Error(`Only ${count} ZIPs parsed — the source file looks wrong, refusing to write`);
  }

  writeFileSync(
    OUT,
    JSON.stringify({
      source: `US Census Bureau ${VINTAGE} ZCTA Gazetteer (public domain)`,
      url: URL,
      note: 'Interior points, not centroids — always inside the ZCTA polygon.',
      count,
      centroids,
    }),
  );

  console.log(`Wrote ${count} ZIP centroids to ${OUT} (skipped ${skipped})`);
}

main();
