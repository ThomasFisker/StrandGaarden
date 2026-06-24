/**
 * Bulk-seed the Strandgaarden controlled Persons list from the validated
 * people master (people.csv — produced/curated via extract-house-info.ts).
 *
 * For every row with include=1 it POSTs the person's tag name to
 * /persons, which creates an APPROVED person. The platform derives the
 * slug from the name the same way this script does (shared slugify), and
 * a slug collision returns 409 — so re-runs are idempotent and any name
 * that already exists is reported as "skipped-existing".
 *
 * The name pushed to the app is `tagName` when set, else `displayName`.
 * tagName only differs from displayName when a name collision forced a
 * birth-year disambiguator (e.g. "Else Larsen (f. 1864)"). The richer
 * columns in people.csv (occupation, town, relationships, …) are NOT sent
 * — the app's Persons list is name-only.
 *
 * Usage:
 *   # Dry run — shows what would be created (GETs /persons if JWT given):
 *   JWT=<id_token> npx tsx infra/scripts/import-persons.ts --dry-run
 *
 *   # Real import:
 *   JWT=<id_token> npx tsx infra/scripts/import-persons.ts
 *
 * Flags:
 *   --file <path>   CSV to import (default: "House Information/people.csv")
 *   --dry-run       don't POST anything; just report planned actions
 *
 * CSV: a header row is required. Columns used: displayName, tagName
 *   (optional — falls back to displayName), include (optional — set 0 to
 *   skip a row). The slug is recomputed from the pushed name with the
 *   platform's slugify; other columns are ignored.
 *
 * How to get JWT (admin/Udvalg login required):
 *   1. Log in as an admin on https://medlemmer.strandgaardenis.dk
 *   2. DevTools → Application → Local Storage → idToken value
 *   3. Token expires in ~1h and the script does not refresh it — re-run
 *      with a fresh token on 401.
 *
 * Writes persons-report.csv next to the input CSV.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { slugify, normalizeDisplayName } from '../lambdas/persons-shared';

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';
const DEFAULT_CSV = path.resolve('House Information', 'people.csv');

interface CliArgs {
  file: string;
  dryRun: boolean;
}

const parseArgs = (): CliArgs => {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get('file');
  return {
    file: file ? path.resolve(file) : DEFAULT_CSV,
    dryRun: argv.includes('--dry-run'),
  };
};

const args = parseArgs();
const jwt = process.env.JWT;
if (!args.dryRun && !jwt) {
  console.error('Missing JWT env var (skip with --dry-run).');
  process.exit(1);
}

// ─── Minimal RFC-4180 CSV parser (handles quotes, commas, newlines) ───

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (file may not end with newline).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows (e.g. trailing blank line).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
};

// ─── API helpers ──────────────────────────────────────────────────────

interface PersonRow {
  slug: string;
  displayName: string;
  state: string;
}

const loadExistingPersons = async (): Promise<PersonRow[]> => {
  const r = await fetch(`${API_BASE}/persons`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (r.status === 401) {
    console.error('401 Unauthorized — JWT expired. Refresh and re-run.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`GET /persons → HTTP ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { items?: PersonRow[] };
  return body.items ?? [];
};

type CreateResult = 'created' | 'exists' | 'error';

const createPerson = async (displayName: string): Promise<{ result: CreateResult; message: string }> => {
  const r = await fetch(`${API_BASE}/persons`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (r.status === 401) {
    console.error('401 Unauthorized — JWT expired. Refresh and re-run.');
    process.exit(2);
  }
  if (r.status === 201) return { result: 'created', message: '' };
  if (r.status === 409) return { result: 'exists', message: 'slug already exists' };
  return { result: 'error', message: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
};

// ─── Main ─────────────────────────────────────────────────────────────

interface ReportRow {
  displayName: string;
  slug: string;
  status: string;
  message: string;
}

const csvEscape = (s: string): string =>
  /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

const main = async () => {
  let text: string;
  try {
    text = await fs.readFile(args.file, 'utf8');
  } catch (e) {
    console.error(`Cannot read CSV ${args.file}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.log('CSV has no data rows. Nothing to do.');
    return;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col('displayname');
  const iTag = col('tagname');
  const iInclude = col('include');
  if (iName < 0) {
    console.error('CSV missing required "displayName" column.');
    process.exit(1);
  }

  // Parse + filter rows, dedupe within the file by slug. The name pushed
  // to the app is tagName when present, else displayName.
  const seen = new Set<string>();
  const planned: { displayName: string; slug: string }[] = [];
  let excluded = 0;
  let invalid = 0;
  for (const r of rows.slice(1)) {
    const include = iInclude >= 0 ? (r[iInclude] ?? '').trim() : '1';
    if (include !== '' && include !== '1' && include.toLowerCase() !== 'true') {
      excluded++;
      continue;
    }
    const tag = iTag >= 0 ? normalizeDisplayName(r[iTag] ?? '') : '';
    const displayName = tag || normalizeDisplayName(r[iName] ?? '');
    const slug = slugify(displayName);
    if (!displayName || !slug) {
      invalid++;
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    planned.push({ displayName, slug });
  }

  console.log(
    `CSV ${args.file}: ${planned.length} unique name(s) to import (${excluded} excluded, ${invalid} invalid).`,
  );

  // Dedupe against what's already in the platform.
  const existingSlugs = new Set<string>();
  if (jwt) {
    try {
      const existing = await loadExistingPersons();
      for (const p of existing) existingSlugs.add(p.slug);
      console.log(`API: ${existingSlugs.size} person(s) already exist.`);
    } catch (e) {
      if (!args.dryRun) throw e;
      console.log(`DRY RUN — could not GET /persons (${e instanceof Error ? e.message : e}).`);
    }
  } else {
    console.log('DRY RUN — no JWT, cannot check existing persons; treating all as new.');
  }

  const report: ReportRow[] = [];
  let created = 0;
  let existed = 0;
  let errored = 0;

  for (const p of planned) {
    if (existingSlugs.has(p.slug)) {
      report.push({ ...p, status: 'skipped-existing', message: 'already in Persons list' });
      existed++;
      continue;
    }
    if (args.dryRun) {
      report.push({ ...p, status: 'dryRun', message: 'would create' });
      console.log(`  + (dry) ${p.displayName}`);
      continue;
    }
    const { result, message } = await createPerson(p.displayName);
    if (result === 'created') {
      report.push({ ...p, status: 'created', message: '' });
      console.log(`  ✓ ${p.displayName}`);
      created++;
    } else if (result === 'exists') {
      report.push({ ...p, status: 'skipped-existing', message });
      existed++;
    } else {
      report.push({ ...p, status: 'error', message });
      console.error(`  ! ${p.displayName}: ${message}`);
      errored++;
    }
  }

  const reportPath = path.join(path.dirname(args.file), 'persons-report.csv');
  const lines = report.map((r) =>
    [r.displayName, r.slug, r.status, r.message].map(csvEscape).join(','),
  );
  // UTF-8 BOM so Excel on Windows shows æ/ø/å correctly (not Ã¦/Ã¸/Ã¥).
  const bom = String.fromCharCode(0xfeff);
  await fs.writeFile(reportPath, bom + ['displayName,slug,status,message', ...lines].join('\n') + '\n', 'utf8');

  const dry = report.filter((r) => r.status === 'dryRun').length;
  console.log(
    `\nDone. created=${created} dryRun=${dry} skipped-existing=${existed} errors=${errored}\nReport: ${reportPath}`,
  );
};

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
