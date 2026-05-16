/**
 * One-off cleanup: wipe documents and/or meetings from the platform
 * so the bulk-import script can repopulate from a clean slate.
 *
 * Usage:
 *   JWT=<id_token> npx tsx infra/scripts/cleanup-documents.ts [flags]
 *
 * Flags (no flag = dry-run listing, nothing is deleted):
 *   --delete-documents   delete every document (also frees the S3 object)
 *   --delete-meetings    delete every meeting (orphans any remaining docs)
 *   --delete-all         shorthand for both
 *   --confirm            required alongside any --delete-* flag — without
 *                        it the script lists what *would* be deleted but
 *                        makes no API calls
 *
 * Order matters when --delete-all is used: documents are removed first
 * so we don't end up with orphans pointing at deleted meetings during
 * the brief window between the two passes.
 *
 * The script writes nothing to disk and uses only the platform's
 * regular DELETE endpoints — same authz path the SPA's Slet-button
 * uses, so anything you can't delete via the UI you can't delete here
 * either. Documents are removed properly (S3 object + DDB partition +
 * top-level AUDIT row); meetings just remove the meeting row.
 *
 * JWT: log in as administrator on the SPA, copy idToken from DevTools.
 * Token expires in 1h.
 */

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';

interface Args {
  deleteDocuments: boolean;
  deleteMeetings: boolean;
  confirmed: boolean;
}

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const all = has('delete-all');
  return {
    deleteDocuments: all || has('delete-documents'),
    deleteMeetings: all || has('delete-meetings'),
    confirmed: has('confirm'),
  };
};

const args = parseArgs();
const jwt = process.env.JWT;
if (!jwt) {
  console.error('Missing JWT env var. Log in as administrator and copy idToken.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${jwt}` };

const apiGet = async <T>(suffix: string): Promise<T> => {
  const r = await fetch(`${API_BASE}${suffix}`, { headers });
  if (r.status === 401) {
    console.error('401 Unauthorized — JWT expired. Refresh and re-run.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`GET ${suffix} → HTTP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
};

const apiDelete = async (suffix: string): Promise<void> => {
  const r = await fetch(`${API_BASE}${suffix}`, { method: 'DELETE', headers });
  if (r.status === 401) {
    console.error('401 Unauthorized — JWT expired. Refresh and re-run.');
    process.exit(2);
  }
  if (!r.ok) throw new Error(`DELETE ${suffix} → HTTP ${r.status}: ${await r.text()}`);
};

interface DocRow {
  docId: string;
  title: string;
  category: string;
  year: number | null;
  meetingId: string | null;
  originalFilename: string;
}
interface MeetingRow {
  meetingId: string;
  kind: string;
  date: string;
  title: string;
}

const main = async () => {
  const docList = await apiGet<{ items: DocRow[] }>('/documents');
  const meetingList = await apiGet<{ items: MeetingRow[] }>('/meetings');
  const docs = docList.items ?? [];
  const meetings = meetingList.items ?? [];

  console.log(`Found ${meetings.length} meetings, ${docs.length} documents.\n`);

  const doDocs = args.deleteDocuments;
  const doMeetings = args.deleteMeetings;

  if (!doDocs && !doMeetings) {
    console.log('No --delete-* flag given — listing only (read-only).\n');
  } else if (!args.confirmed) {
    console.log('No --confirm flag — DRY RUN, nothing will be deleted.\n');
  } else {
    console.log('PROCEEDING — items below WILL be deleted permanently.\n');
  }

  if (doDocs || (!doDocs && !doMeetings)) {
    console.log('=== Documents ===');
    for (const d of docs) {
      console.log(
        `  ${d.docId.slice(0, 8)}  [${d.category}]  ${d.title}  (${d.originalFilename})`,
      );
    }
    console.log();
  }
  if (doMeetings || (!doDocs && !doMeetings)) {
    console.log('=== Meetings ===');
    for (const m of meetings) {
      console.log(`  ${m.meetingId.slice(0, 8)}  ${m.date}  [${m.kind}]  ${m.title}`);
    }
    console.log();
  }

  if (!args.confirmed) {
    if (doDocs || doMeetings) {
      console.log('Re-run with --confirm to actually delete.');
    } else {
      console.log('Read-only listing — pass --delete-documents / --delete-meetings / --delete-all + --confirm to clean.');
    }
    return;
  }

  // Always delete documents first so meeting deletion doesn't generate
  // orphans we then have to chase.
  if (doDocs) {
    let okCount = 0;
    let failCount = 0;
    for (const d of docs) {
      try {
        await apiDelete(`/documents/${encodeURIComponent(d.docId)}`);
        console.log(`  ✓ doc ${d.docId.slice(0, 8)} ${d.title}`);
        okCount++;
      } catch (e) {
        console.error(`  ✗ doc ${d.docId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
        failCount++;
      }
    }
    console.log(`Documents: ${okCount} deleted, ${failCount} failed.\n`);
  }

  if (doMeetings) {
    let okCount = 0;
    let failCount = 0;
    for (const m of meetings) {
      try {
        await apiDelete(`/meetings/${encodeURIComponent(m.meetingId)}`);
        console.log(`  ✓ meeting ${m.meetingId.slice(0, 8)} ${m.date} ${m.title}`);
        okCount++;
      } catch (e) {
        console.error(`  ✗ meeting ${m.meetingId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
        failCount++;
      }
    }
    console.log(`Meetings: ${okCount} deleted, ${failCount} failed.\n`);
  }

  console.log('Done.');
};

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
