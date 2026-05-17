/**
 * One-shot repair: the first live run of import-documents.ts had a
 * slug bug that stripped Danish letters from the folder name "Ordinær
 * Generalforsamling", causing every assembly meeting to silently skip
 * the meeting-create step. All 46 documents got uploaded with
 * meetingId=null. This script reads the original run's log file,
 * extracts the relPath → docId mappings, creates the 6 missing
 * meetings, and PATCHes each document with the correct meetingId.
 *
 * Usage:
 *   JWT=<token> npx tsx infra/scripts/fix-meetings.ts <log-path>
 *
 * Idempotent: looks up existing meetings before POSTing. PATCH is also
 * idempotent — re-running with the same docs+meetings is a no-op.
 */

import { promises as fs } from 'node:fs';

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';

const logPath = process.argv[2];
if (!logPath) {
  console.error('Missing log file path as first positional arg.');
  process.exit(1);
}

const jwt = process.env.JWT;
if (!jwt) {
  console.error('Missing JWT env var.');
  process.exit(1);
}

interface DocCurrent {
  docId: string;
  title: string;
  category: string;
  year: number | null;
  meetingId: string | null;
  tags: string[];
  note: string | null;
  summary: string | null;
}

const headers = { Authorization: `Bearer ${jwt}` };
const jsonHeaders = { ...headers, 'content-type': 'application/json' };

const apiGet = async <T>(suffix: string): Promise<T> => {
  const r = await fetch(`${API_BASE}${suffix}`, { headers });
  if (r.status === 401) {
    console.error('401 — JWT expired.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`GET ${suffix} → HTTP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
};

const apiPost = async <T>(suffix: string, body: unknown): Promise<T> => {
  const r = await fetch(`${API_BASE}${suffix}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    console.error('401 — JWT expired.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`POST ${suffix} → HTTP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
};

const apiPatch = async (suffix: string, body: unknown): Promise<void> => {
  const r = await fetch(`${API_BASE}${suffix}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    console.error('401 — JWT expired.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`PATCH ${suffix} → HTTP ${r.status}: ${await r.text()}`);
};

// Known mappings: <folder prefix> → meeting metadata. From the dry-run
// output. The 2018/ and 2026/ files have no enclosing meeting kind
// folder so they stay unbound.
const FOLDER_TO_MEETING: { prefix: string; kind: 'assembly'; date: string; title: string }[] = [
  { prefix: '2020/Ordinær Generalforsamling/', kind: 'assembly', date: '2020-07-13', title: '13. juli 2020' },
  { prefix: '2021/Ordinær Generalforsamling/', kind: 'assembly', date: '2021-07-12', title: '12. juli 2021' },
  { prefix: '2022/Ordinær Generalforsamling/', kind: 'assembly', date: '2022-07-11', title: '11. juli 2022' },
  { prefix: '2023/Ordinær Generalforsamling/', kind: 'assembly', date: '2023-07-10', title: '10. juli 2023' },
  { prefix: '2024/Ordinær Generalforsamling/', kind: 'assembly', date: '2024-07-08', title: '8. juli 2024' },
  { prefix: '2025/Ordinær Generalforsamling/', kind: 'assembly', date: '2025-07-14', title: '14. juli 2025' },
];

const main = async () => {
  const logText = await fs.readFile(logPath, 'utf8');
  // Match: "  ✓ <relPath> → <docId>"
  // → is the rightwards arrow used by the import script.
  const re = /^\s+✓\s+(.+?)\s+→\s+([0-9a-f-]{36})\s*$/gm;
  const pairs: { relPath: string; docId: string }[] = [];
  for (const m of logText.matchAll(re)) {
    pairs.push({ relPath: m[1], docId: m[2] });
  }
  console.log(`Parsed ${pairs.length} doc upload records from log.`);

  // Look at existing meetings so we don't double-create.
  const existing = await apiGet<{ items: { meetingId: string; kind: string; date: string; title: string }[] }>('/meetings');
  const existingByKey = new Map<string, string>();
  for (const m of existing.items ?? []) {
    existingByKey.set(`${m.kind}:${m.date}`, m.meetingId);
  }

  // Create the 6 missing meetings.
  const meetingIdByPrefix = new Map<string, string>();
  for (const fm of FOLDER_TO_MEETING) {
    const key = `${fm.kind}:${fm.date}`;
    let mid = existingByKey.get(key);
    if (mid) {
      console.log(`· existing meeting ${fm.date} → ${mid}`);
    } else {
      const r = await apiPost<{ meetingId: string }>('/meetings', {
        kind: fm.kind,
        date: fm.date,
        title: fm.title,
        description: '',
      });
      mid = r.meetingId;
      existingByKey.set(key, mid);
      console.log(`+ meeting ${fm.date} → ${mid}`);
    }
    meetingIdByPrefix.set(fm.prefix, mid);
  }

  // PATCH each doc in those folders.
  let patched = 0;
  let skipped = 0;
  let failed = 0;
  for (const { relPath, docId } of pairs) {
    const fm = FOLDER_TO_MEETING.find((f) => relPath.startsWith(f.prefix));
    if (!fm) {
      console.log(`- ${relPath} — no folder match, skip`);
      skipped++;
      continue;
    }
    const meetingId = meetingIdByPrefix.get(fm.prefix)!;
    try {
      // PATCH /documents/{id} requires the full editable set in one go.
      const doc = await apiGet<DocCurrent>(`/documents/${encodeURIComponent(docId)}`);
      if (doc.meetingId === meetingId) {
        console.log(`= ${relPath} already tied to ${meetingId.slice(0, 8)}`);
        skipped++;
        continue;
      }
      await apiPatch(`/documents/${encodeURIComponent(docId)}`, {
        title: doc.title,
        category: doc.category,
        year: doc.year,
        meetingId,
        tags: doc.tags ?? [],
        note: doc.note ?? '',
        summary: doc.summary ?? '',
      });
      patched++;
      console.log(`✓ ${relPath} → meeting ${meetingId.slice(0, 8)}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${relPath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nDone. patched=${patched} skipped=${skipped} failed=${failed}`);
};

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
