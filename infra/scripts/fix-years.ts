/**
 * One-shot: re-apply the year-resolution rules to existing documents
 * after the rule was tightened. The original rule treated all meeting-
 * bound docs as fiscal-year (month>=6 → y+1), which is wrong for
 * assembly (generalforsamling) meetings — a GF closes the just-ended
 * FY, so its docs should be filed under the calendar year of the GF
 * (= ending year of the FY just closed). Board (bestyrelsesmøde)
 * meetings keep the fiscal-year rule. Budget/Regnskab/Årsregnskab
 * are always left alone — they use the period's slutår.
 *
 * Usage:
 *   JWT=<token> npx tsx infra/scripts/fix-years.ts [--apply]
 *
 * Default is dry-run (lists proposed changes). Pass --apply to
 * actually PATCH the docs. Idempotent: docs whose year already
 * matches the rule are skipped.
 */

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';
const apply = process.argv.includes('--apply');

const jwt = process.env.JWT;
if (!jwt) {
  console.error('Missing JWT env var.');
  process.exit(1);
}

interface MeetingRow {
  meetingId: string;
  kind: string;
  date: string;
  title: string;
}

interface DocRow {
  docId: string;
  title: string;
  category: string;
  year: number | null;
  meetingId: string | null;
  tags: string[];
  note: string | null;
  summary: string | null;
  originalFilename: string;
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

const yearForMeetingDoc = (
  isoDate: string,
  kind: 'board' | 'assembly',
): number | null => {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (kind === 'assembly') return y;
  return mo >= 6 ? y + 1 : y;
};

const isFiscalPeriodDoc = (category: string): boolean =>
  /^(budget|regnskab|.rsregnskab)/i.test(category);

const main = async () => {
  const meetings = await apiGet<{ items: MeetingRow[] }>('/meetings');
  const meetingsById = new Map<string, MeetingRow>();
  for (const m of meetings.items) meetingsById.set(m.meetingId, m);
  console.log(`Loaded ${meetings.items.length} meetings.`);

  const docList = await apiGet<{ items: DocRow[] }>('/documents');
  const docs = docList.items ?? [];
  console.log(`Loaded ${docs.length} documents.\n`);

  let toFix = 0;
  let skippedFiscal = 0;
  let skippedNoMeeting = 0;
  let skippedAlreadyCorrect = 0;
  const changes: { doc: DocRow; newYear: number }[] = [];

  for (const d of docs) {
    if (!d.meetingId) {
      skippedNoMeeting++;
      continue;
    }
    if (isFiscalPeriodDoc(d.category)) {
      skippedFiscal++;
      continue;
    }
    const meeting = meetingsById.get(d.meetingId);
    if (!meeting) {
      console.log(`! ${d.docId.slice(0, 8)} ${d.title} — meeting ${d.meetingId.slice(0, 8)} not found`);
      continue;
    }
    if (meeting.kind !== 'board' && meeting.kind !== 'assembly') {
      console.log(`! ${d.docId.slice(0, 8)} ${d.title} — unknown meeting kind: ${meeting.kind}`);
      continue;
    }
    const correctYear = yearForMeetingDoc(meeting.date, meeting.kind);
    if (correctYear === null) {
      console.log(`! ${d.docId.slice(0, 8)} ${d.title} — could not compute year from ${meeting.date}`);
      continue;
    }
    if (d.year === correctYear) {
      skippedAlreadyCorrect++;
      continue;
    }
    toFix++;
    changes.push({ doc: d, newYear: correctYear });
    console.log(
      `${apply ? '✎' : '→'} [${meeting.kind} ${meeting.date}] ${d.title} — year ${d.year} → ${correctYear}`,
    );
  }

  console.log(
    `\nSummary: ${toFix} to fix · ${skippedAlreadyCorrect} already correct · ${skippedFiscal} financial (unchanged) · ${skippedNoMeeting} no meeting (skipped)`,
  );

  if (!apply) {
    console.log(`\nDry-run only. Re-run with --apply to PATCH ${toFix} document(s).`);
    return;
  }

  let patched = 0;
  let failed = 0;
  for (const { doc, newYear } of changes) {
    try {
      await apiPatch(`/documents/${encodeURIComponent(doc.docId)}`, {
        title: doc.title,
        category: doc.category,
        year: newYear,
        meetingId: doc.meetingId,
        tags: doc.tags ?? [],
        note: doc.note ?? '',
        summary: doc.summary ?? '',
      });
      patched++;
    } catch (e) {
      failed++;
      console.error(`✗ ${doc.docId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\nApplied: patched=${patched} failed=${failed}`);
};

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
