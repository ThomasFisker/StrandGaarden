/**
 * One-off import: create Cognito users from a CSV file by calling the
 * platform's POST /users endpoint. Each row maps to one user, so
 * houseNumber + role + initial password are baked into the CSV.
 *
 * Usage:
 *   JWT=<id_token> npx tsx infra/scripts/import-users.ts
 *
 * Optional flags:
 *   --csv <path>   override the CSV path
 *                  (default: ../DokumenterUpload/medlemmer-import Updated.csv)
 *   --dry-run      parse + print what would be sent, make no API calls
 *
 * How to get the JWT:
 *   1. Log in to the deployed SPA as a user that can manage users
 *      (board or administrator).
 *   2. Open DevTools → Application → Local Storage. Find the
 *      CognitoIdentityServiceProvider.*.idToken entry and copy its value.
 *   3. Set it as JWT env var. Token expires in 1 hour — re-run if you hit
 *      a 401.
 *
 * Behavior:
 *   - HTTP 201 → user created, counted as ok
 *   - HTTP 409 → user already exists, counted as skipped (idempotent re-run)
 *   - HTTP 401 / 403 → auth failure, the script aborts immediately
 *   - any other non-2xx → row marked as failed, script continues to next
 *
 * CSV columns (header row required, comma-separated):
 *   loginName,email,houseNumber,role,password,note
 *
 * `note` is for human review only and is not sent to the API.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';

interface Row {
  lineNo: number;
  loginName: string;
  email: string;
  houseNumber: number | null;
  role: string;
  password: string;
}

const argFlag = (name: string): boolean => process.argv.includes(`--${name}`);
const argValue = (name: string): string | undefined => {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const csvPath = resolvePath(
  argValue('csv') ?? '../DokumenterUpload/medlemmer-import Updated.csv',
);
const dryRun = argFlag('dry-run');
const jwt = process.env.JWT ?? '';

if (!dryRun && !jwt) {
  console.error('Missing JWT env var. See header comment for how to get one.');
  process.exit(1);
}

const parseCsv = (text: string): Row[] => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows: Row[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (i === 0) continue; // header
    // First 5 commas split the data fields; everything after the 5th comma
    // is the (optional) note column — we ignore it for the API call.
    const parts = raw.split(',');
    if (parts.length < 5) {
      console.error(`Line ${i + 1}: too few columns, skipping: ${raw}`);
      continue;
    }
    const [loginName, email, houseStr, role, password] = parts;
    const houseNum = Number(houseStr.trim());
    rows.push({
      lineNo: i + 1,
      loginName: loginName.trim(),
      email: email.trim(),
      houseNumber: Number.isInteger(houseNum) && houseNum > 0 ? houseNum : null,
      role: role.trim(),
      password: password.trim(),
    });
  }
  return rows;
};

const main = async () => {
  let csvText: string;
  try {
    csvText = readFileSync(csvPath, 'utf8');
  } catch (e) {
    console.error(`Cannot read CSV at ${csvPath}:`, e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const rows = parseCsv(csvText);
  console.log(`Loaded ${rows.length} rows from ${csvPath}`);
  if (dryRun) {
    console.log('Dry run — would POST:');
    for (const r of rows) {
      console.log(
        `  line ${r.lineNo}: ${r.loginName} (${r.email}) hus=${r.houseNumber} role=${r.role}`,
      );
    }
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let houseFailed = 0;
  for (const r of rows) {
    // The API expects `group` + `initialPassword` (mirrors users-create.ts).
    // House number is set via a separate PATCH after the user is created.
    const createBody: Record<string, unknown> = {
      email: r.email,
      loginName: r.loginName,
      group: r.role,
      initialPassword: r.password,
    };

    const resp = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(createBody),
    });

    if (resp.status === 201) {
      ok++;
      const houseSuffix = await assignHouse(r);
      console.log(`✓ line ${r.lineNo} created: ${r.loginName} (${r.email})${houseSuffix}`);
    } else if (resp.status === 409) {
      console.log(`- line ${r.lineNo} exists, skipped: ${r.loginName} (${r.email})`);
      skipped++;
    } else if (resp.status === 401 || resp.status === 403) {
      console.error(`✗ line ${r.lineNo} auth failed (${resp.status}). Stopping.`);
      console.error(await resp.text());
      process.exit(1);
    } else {
      const errBody = await resp.text();
      console.error(
        `✗ line ${r.lineNo} HTTP ${resp.status}: ${r.loginName} (${r.email}) — ${errBody}`,
      );
      failed++;
    }
  }

  async function assignHouse(r: Row): Promise<string> {
    if (r.houseNumber === null) return ' (no house)';
    // Cognito stores the username as lowercase email; the PATCH path must
    // match or AdminGetUser returns UserNotFoundException. Mirrors the
    // toLowerCase() in users-create.ts.
    const resp = await fetch(
      `${API_BASE}/users/${encodeURIComponent(r.email.toLowerCase())}/house`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ houseNumber: r.houseNumber }),
      },
    );
    if (resp.ok) return ` + house ${r.houseNumber}`;
    houseFailed++;
    const errBody = await resp.text();
    return ` ⚠ house assignment failed: HTTP ${resp.status} ${errBody}`;
  }

  console.log('---');
  console.log(
    `Done. created=${ok} skipped=${skipped} failed=${failed} houseFailed=${houseFailed} total=${rows.length}`,
  );
  if (failed > 0 || houseFailed > 0) process.exit(1);
};

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
