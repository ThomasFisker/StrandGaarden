/**
 * One-off bulk import: walk a directory tree of scanned/native PDFs and
 * Word documents, classify + summarize each one with Claude, then upload
 * them to the deployed Strandgaarden API.
 *
 * Usage:
 *   JWT=<id_token> ANTHROPIC_API_KEY=<key> \
 *     npx tsx infra/scripts/import-documents.ts --root <path>
 *
 * Flags:
 *   --root <path>      root of the scanned tree (required)
 *                      expected layout:
 *                        <root>/<YYYY>/<MeetingKind>/<YYYY-MM-DD>/*.{pdf,docx,doc}
 *                        <root>/<YYYY>/<MeetingKind>/*.{pdf,docx,doc}
 *                        <root>/<YYYY>/*.{pdf,docx,doc}   (no meeting)
 *                      MeetingKind ∈ { Bestyrelsesmoede, Generalforsamling,
 *                                      Ekstraordinaer-Generalforsamling }
 *                      ASCII folder names — script normalizes to ddb meeting.kind.
 *   --dry-run          parse, classify, log — no API calls
 *   --no-rename        skip writing canonical-name copies to <root>/renamed/
 *   --only-cat <name>  only process files Claude classifies as <category>
 *                      (handy for retrying a single bucket)
 *   --limit N          process at most N files (debugging)
 *
 * How to get JWT:
 *   1. Log in as administrator on https://medlemmer.strandgaardenis.dk
 *   2. DevTools → Application → Local Storage → idToken value
 *   3. Token expires in 1h; the script retries no auth refresh, so re-run
 *      with a fresh token if you hit a 401.
 *
 * How to get ANTHROPIC_API_KEY:
 *   console.anthropic.com → Settings → API Keys → create.
 *
 * The script writes two artifacts in --root:
 *   - report.csv   one row per file: status, category, title, summary length, errors
 *   - renamed/     mirror tree of canonical filenames (originals untouched)
 *
 * Categories chosen by Claude must already exist in the platform's
 * doc-categories list — the script fetches the live list at startup and
 * passes it as a strict choice to Claude. Unrecognized matches fall back
 * to the first category named "Andet" (or whatever you've set up as a
 * catch-all); you can re-classify manually via /dokumenter/:id afterwards.
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';

const API_BASE = 'https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com';
const MODEL = 'claude-opus-4-7';
const PDF_MAX_BYTES = 32 * 1024 * 1024; // Anthropic doc-block limit

interface CliArgs {
  root: string;
  dryRun: boolean;
  noRename: boolean;
  onlyCat: string | null;
  limit: number | null;
}

const parseArgs = (): CliArgs => {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const root = get('root');
  if (!root) {
    console.error('Missing --root <path>. See script header for usage.');
    process.exit(1);
  }
  const limit = get('limit');
  return {
    root: path.resolve(root),
    dryRun: has('dry-run'),
    noRename: has('no-rename'),
    onlyCat: get('only-cat') ?? null,
    limit: limit ? Number(limit) : null,
  };
};

const args = parseArgs();
const jwt = process.env.JWT;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!args.dryRun && !jwt) {
  console.error('Missing JWT env var (skip with --dry-run).');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing ANTHROPIC_API_KEY env var.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

// ─── Folder-name normalization ────────────────────────────────────────

interface MeetingFolderInfo {
  kind: 'board' | 'assembly';
  /** True if the folder name says "Ekstraordinær Generalforsamling".
   * Always false for board meetings (no such distinction). Used to set
   * the meeting `title` so the ordinær vs ekstraordinær difference
   * survives the kind→2-value mapping. */
  isExtraordinaer: boolean;
}

const MEETING_KIND_MAP: Record<string, MeetingFolderInfo | null> = {
  bestyrelsesmoede: { kind: 'board', isExtraordinaer: false },
  bestyrelsesmøde: { kind: 'board', isExtraordinaer: false },
  bestyrelsesmoder: { kind: 'board', isExtraordinaer: false },
  generalforsamling: { kind: 'assembly', isExtraordinaer: false },
  'ordinaer-generalforsamling': { kind: 'assembly', isExtraordinaer: false },
  'ordinær-generalforsamling': { kind: 'assembly', isExtraordinaer: false },
  'ekstraordinaer-generalforsamling': { kind: 'assembly', isExtraordinaer: true },
  'ekstraordinær-generalforsamling': { kind: 'assembly', isExtraordinaer: true },
};

/**
 * Strandgaarden's fiscal year runs June 1 → May 31. We file every
 * date-bearing document under the fiscal year it falls within, using
 * the ENDING-year convention (e.g. Jun 2025–May 2026 = fiscal year
 * 2026). Cutover: month >= 6 → next calendar year. This keeps board
 * meetings, indkaldelser, referater, budget and regnskab for the same
 * period grouped under one year-filter value.
 *
 * Examples:
 *   2025-04-15  → 2025 (still in fiscal year 2024-2025)
 *   2025-05-31  → 2025 (last day of fiscal year 2024-2025)
 *   2025-06-01  → 2026 (first day of fiscal year 2025-2026)
 *   2025-10-15  → 2026 (fiscal year 2025-2026)
 *   2026-05-31  → 2026 (last day of fiscal year 2025-2026)
 *
 * For docs without a clear date (vedtægter, meddelelser without dato,
 * regnskab/budget which describe a period rather than a moment) we
 * trust Claude's `extractedYear` and skip the override.
 */
const fiscalYearFromIsoDate = (iso: string | null): number | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [yStr, mStr] = iso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  return m >= 6 ? y + 1 : y;
};

/** Year to file a meeting-bound document under, given the meeting's
 * date and kind. The two kinds differ because of when in the FY they
 * happen relative to the FY they belong to:
 *
 *   - Assembly (generalforsamling): held shortly AFTER the FY ends —
 *     reviews the regnskab for the just-closed FY. So a GF held in
 *     July 2021 closes FY 2020-2021 (slutår 2021) and the docs
 *     belong under year=2021 (calendar year of the GF == ending year
 *     of the FY it closes).
 *
 *   - Board (bestyrelsesmøde): held throughout the FY — belongs to
 *     the currently-running FY. A bestyrelsesmøde 15. oktober 2025
 *     is mid FY 2025-2026, so docs file under year=2026.
 *
 * Budget and Regnskab docs override both rules — they use Claude's
 * extractedYear since they describe a specific fiscal period rather
 * than a moment in time. That happens at the caller. */
const yearForMeetingDoc = (
  isoDate: string | null,
  kind: 'board' | 'assembly' | null,
): number | null => {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [yStr, mStr] = isoDate.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  if (kind === 'assembly') return y;
  if (kind === 'board') return m >= 6 ? y + 1 : y;
  return null;
};

/** ASCII-safe slug for folder-name lookup. Crucially Danish letters
 * are spelled out (æ→ae, ø→oe, å→aa) BEFORE stripping non-[a-z0-9],
 * so "Ordinær Generalforsamling" becomes "ordinaer-generalforsamling"
 * and matches MEETING_KIND_MAP — a previous NFKD-based version dropped
 * the bytes entirely and produced "ordin-r-generalforsamling", causing
 * every assembly meeting to silently skip the meeting-create step. */
const slug = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const meetingKindFromFolder = (name: string): MeetingFolderInfo | null => {
  const s = slug(name);
  return MEETING_KIND_MAP[s] ?? null;
};

const meetingKindLabel = (kind: 'board' | 'assembly'): string =>
  kind === 'board' ? 'Bestyrelsesmøde' : 'Generalforsamling';

/** Danish long-form date — used in the meeting `title` field so it
 * renders as "Bestyrelsesmøde: 15. april 2025 (15-04-2025)" without
 * repeating the kind or the ISO date. Falls back to the ISO string if
 * the input isn't a valid YYYY-MM-DD. */
const DK_MONTHS = [
  'januar',
  'februar',
  'marts',
  'april',
  'maj',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'december',
];

const formatDanishLongDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const day = Number(m[3]);
  const month = DK_MONTHS[Number(m[2]) - 1];
  if (!month || !Number.isInteger(day)) return iso;
  return `${day}. ${month} ${m[1]}`;
};

const buildMeetingTitle = (info: MeetingFolderInfo, isoDate: string): string => {
  const danish = formatDanishLongDate(isoDate);
  if (info.kind === 'assembly' && info.isExtraordinaer) {
    return `Ekstraordinær ${danish}`;
  }
  return danish;
};

// ─── API helpers (Strandgaarden platform) ─────────────────────────────

const callApi = async <T>(method: string, pathSuffix: string, body?: unknown): Promise<T> => {
  const r = await fetch(`${API_BASE}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    console.error('401 Unauthorized — JWT expired. Refresh and re-run.');
    process.exit(2);
  }
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`${method} ${pathSuffix} → HTTP ${r.status}: ${detail}`);
  }
  return r.json() as Promise<T>;
};

interface DocCategory {
  key: string;
  displayName: string;
  displayOrder: number;
}
interface MeetingRow {
  meetingId: string;
  kind: string;
  date: string;
  title: string;
}

const loadCategories = async (): Promise<DocCategory[]> => {
  const r = await callApi<{ items: DocCategory[] }>('GET', '/doc-categories');
  return r.items;
};

const loadMeetings = async (): Promise<MeetingRow[]> => {
  const r = await callApi<{ items: MeetingRow[] }>('GET', '/meetings');
  return r.items;
};

const createMeeting = async (
  kind: 'board' | 'assembly',
  date: string,
  title: string,
): Promise<string> => {
  const r = await callApi<{ meetingId: string }>('POST', '/meetings', {
    kind,
    date,
    title,
    description: '',
  });
  return r.meetingId;
};

interface UploadUrlRes {
  docId: string;
  uploadUrl: string;
  maxBytes: number;
}

const requestUploadUrl = async (body: {
  filename: string;
  contentType: string;
  title: string;
  category: string;
  year: number;
  meetingId: string | null;
  summary: string;
  tags: string[];
}): Promise<UploadUrlRes> => {
  return callApi<UploadUrlRes>('POST', '/documents/upload-url', body);
};

const putS3 = async (url: string, bytes: Buffer, contentType: string): Promise<void> => {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes,
  });
  if (!r.ok) throw new Error(`S3 PUT failed: HTTP ${r.status}`);
};

// ─── Claude classification ────────────────────────────────────────────

interface ClaudeResult {
  categoryDisplayName: string;
  title: string;
  summary: string;
  extractedDateIso: string | null;
  extractedYear: number | null;
  suggestedFilename: string;
}

const buildPrompt = (categories: DocCategory[], hintedKind: string | null, hintedDate: string | null): string => {
  const catList = categories.map((c) => `- ${c.displayName}`).join('\n');
  return `Du er assistent for en dansk sommerhusforening (Strandgaarden Interessentskab).
Dit job: klassificér et dokument, foreslå en præcis dansk titel, og skriv et kort resumé.

Tilgængelige kategorier (VÆLG NØJAGTIGT ÉN ud fra denne liste; brug det displayName som står her, præcis som det er skrevet):
${catList}

Konteksthints fra mappestrukturen (kan være forkerte, brug primært dokumentets indhold):
- Forventet mødetype: ${hintedKind ?? 'ukendt'}
- Forventet mødedato fra mappenavn: ${hintedDate ?? 'ukendt'}

Vigtige regler:

1. **Resumé på dansk**, 2-4 sætninger. Hvis dokumentet er et **regnskab eller budget**: medtag nøgletal fra det AKTUELLE år (ignorer sammenligningskolonne for tidligere år). Inkludér disse hvis de findes: Driftindtægter i alt, Driftomkostninger i alt, Resultat før renter, Resultat efter finansposter, Årets resultat, Egenkapital ultimo, Likvide beholdninger ultimo. Tilføj én linje med bemærkelsesværdige observationer (fx usædvanligt høje poster). Tal med danske separator-konventioner (1.234,56 kr.).

2. **Titel** skal være præcis og menneskelig (max 100 tegn). Eksempler:
   - "Referat fra bestyrelsesmøde 15. april 2024"
   - "Indkaldelse til generalforsamling 2025"
   - "Regnskab 2024-2025"
   - "Budget 2025-2026"
   - "Vedtægter (revideret juni 2023)"

3. **Dato (extractedDateIso)**: dokumentets PRIMÆRE dato. For indkaldelser: udsendelsesdatoen. For referater: mødedatoen. For breve/meddelelser: brevets dato. For budget/regnskab: null (perioden står i title/summary).

4. **År (extractedYear)**: heltal mellem 1900 og 2030. For regnskab/budget der dækker juni-juni: brug **slutåret** (et 2024-2025 regnskab har year=2025). For andre dokumenter: året dokumentet vedrører.

5. **suggestedFilename**: ASCII-sikkert canonisk filnavn UDEN sti og UDEN extension. Format:
   - Med dato: "YYYY-MM-DD - <kategori> - <kort beskrivelse>"
   - Uden dato: "YYYY - <kategori> - <kort beskrivelse>"
   - Max 80 tegn. Brug å→aa, ø→oe, æ→ae. Ingen specialtegn ud over bindestreg, mellemrum og punktum.
   - Eksempler: "2024-04-15 - Indkaldelse - generalforsamling 2024", "2025 - Regnskab - aar 2024-2025"

6. Hvis ingen kategori på listen passer: vælg "Andet" hvis den findes på listen; ellers den mest tilnærmede.

Returner UDELUKKENDE et JSON-objekt (ingen forklaring uden om) med disse felter:
{ "categoryDisplayName": string, "title": string, "summary": string, "extractedDateIso": string | null, "extractedYear": number | null, "suggestedFilename": string }`;
};

const callClaudeForPdf = async (
  pdfBytes: Buffer,
  prompt: string,
): Promise<ClaudeResult> => {
  if (pdfBytes.length > PDF_MAX_BYTES) {
    throw new Error(`PDF too large (${pdfBytes.length} bytes, max ${PDF_MAX_BYTES}).`);
  }
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBytes.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
  return parseJsonReply(text);
};

const callClaudeForText = async (
  docText: string,
  prompt: string,
): Promise<ClaudeResult> => {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Dokumentindhold:\n\n${docText}\n\n---\n\n${prompt}` },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
  return parseJsonReply(text);
};

const parseJsonReply = (raw: string): ClaudeResult => {
  // Strip ```json fences if Claude wraps the JSON.
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/, '')
    .replace(/\s*```[\s\S]*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`No JSON object in Claude reply: ${raw.slice(0, 200)}`);
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  return {
    categoryDisplayName: String(obj.categoryDisplayName ?? ''),
    title: String(obj.title ?? '').slice(0, 200),
    summary: String(obj.summary ?? '').slice(0, 2000),
    extractedDateIso: obj.extractedDateIso ? String(obj.extractedDateIso) : null,
    extractedYear: Number.isInteger(obj.extractedYear) ? Number(obj.extractedYear) : null,
    suggestedFilename: String(obj.suggestedFilename ?? '').slice(0, 80),
  };
};

// ─── File walking ─────────────────────────────────────────────────────

interface FileEntry {
  absPath: string;
  relPath: string;
  ext: 'pdf' | 'docx' | 'doc';
  // Folder hints (only filled in when path matches the expected layout).
  yearFolder: number | null;
  meetingFolder: MeetingFolderInfo | null;
  meetingDateFolder: string | null;
}

const walk = async (root: string): Promise<FileEntry[]> => {
  const out: FileEntry[] = [];
  const visit = async (dir: string) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip the report + renamed output so re-runs are idempotent.
      if (e.name === 'renamed' || e.name === 'report.csv') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(p);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        const ext = lower.endsWith('.pdf')
          ? 'pdf'
          : lower.endsWith('.docx')
            ? 'docx'
            : lower.endsWith('.doc')
              ? 'doc'
              : null;
        if (!ext) continue;
        const rel = path.relative(root, p).split(path.sep);
        // Try to interpret rel[0]=YYYY, rel[1]=<kind>, rel[2]=YYYY-MM-DD
        const yearFolder = rel[0] && /^\d{4}$/.test(rel[0]) ? Number(rel[0]) : null;
        const meetingFolder = rel[1] ? meetingKindFromFolder(rel[1]) : null;
        const dateFolder = rel[2] && /^\d{4}-\d{2}-\d{2}$/.test(rel[2]) ? rel[2] : null;
        out.push({
          absPath: p,
          relPath: rel.join('/'),
          ext,
          yearFolder,
          meetingFolder,
          meetingDateFolder: dateFolder,
        });
      }
    }
  };
  await visit(root);
  return out;
};

// ─── Main pipeline ────────────────────────────────────────────────────

interface ReportRow {
  file: string;
  status: 'ok' | 'dryRun' | 'skipped' | 'error';
  category: string;
  title: string;
  year: number | null;
  meetingId: string | null;
  summaryLen: number;
  renamedTo: string | null;
  message: string;
}

const csvEscape = (s: string): string => {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const writeReport = async (rows: ReportRow[]) => {
  const header = 'file,status,category,title,year,meetingId,summaryLen,renamedTo,message';
  const lines = rows.map((r) =>
    [
      r.file,
      r.status,
      r.category,
      r.title,
      r.year ?? '',
      r.meetingId ?? '',
      String(r.summaryLen),
      r.renamedTo ?? '',
      r.message,
    ]
      .map(csvEscape)
      .join(','),
  );
  await fs.writeFile(path.join(args.root, 'report.csv'), [header, ...lines].join('\n'), 'utf8');
};

const main = async () => {
  console.log(`Scanning ${args.root}…`);
  const files = await walk(args.root);
  console.log(`Found ${files.length} files (pdf/docx/doc).`);
  const trimmed = args.limit !== null ? files.slice(0, args.limit) : files;
  if (args.limit !== null) console.log(`Limited to first ${trimmed.length}.`);

  if (trimmed.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Load categories + existing meetings even in dry-run mode — both are
  // GET-only and the categories list is critical for evaluating
  // classification accuracy ("did Claude pick the right category?")
  // without the live list, Claude only sees "Andet" as a fallback.
  let categories: DocCategory[] = [];
  let meetings: MeetingRow[] = [];
  try {
    [categories, meetings] = await Promise.all([loadCategories(), loadMeetings()]);
    console.log(`API: ${categories.length} categories, ${meetings.length} existing meetings.`);
  } catch (e) {
    if (!args.dryRun) throw e;
    console.log(
      `DRY RUN — could not fetch categories/meetings (${e instanceof Error ? e.message : e}). Proceeding with "Andet"-only fallback.`,
    );
  }
  if (args.dryRun) console.log('DRY RUN — no uploads or meeting creates will happen.');
  // Dedupe key for meetings. Format: `<kind>:<o|x>:<date>` where the
  // middle byte is 'x' if the existing meeting's title starts with
  // "Ekstraordinær" (so an ordinær and an ekstraordinær generalforsamling
  // on the same date stay distinct). Board meetings always use 'o'.
  const meetingIndex = new Map<string, string>();
  for (const m of meetings) {
    const flag =
      m.kind === 'assembly' && /^ekstraordin/i.test(m.title.trim()) ? 'x' : 'o';
    meetingIndex.set(`${m.kind}:${flag}:${m.date}`, m.meetingId);
  }

  const rows: ReportRow[] = [];

  // ── Group files by parent folder ────────────────────────────────────
  // All files inside the same <root>/<YYYY>/<MeetingKind>/[<YYYY-MM-DD>]/
  // folder belong to the same meeting. We classify each file individually,
  // then pick the folder's meeting date from whichever file gave us the
  // strongest signal (referat or indkaldelse preferred; otherwise any
  // dated file), and tie every file in the folder to that meeting.
  const folderKey = (f: FileEntry): string => f.relPath.split('/').slice(0, -1).join('/');
  const groups = new Map<string, FileEntry[]>();
  for (const f of trimmed) {
    const k = folderKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  console.log(`Grouped into ${groups.size} folder(s).`);

  // Pre-classify everything + resolve a meeting per folder. Cached so
  // pass 2 doesn't re-call Claude.
  const classifications = new Map<string, ClaudeResult>();
  const classifyErrors = new Map<string, string>();
  const meetingIdByFolder = new Map<string, string | null>();
  const groupMeetingDateByFolder = new Map<string, string | null>();

  const isReferatCategory = (cat: string): boolean => /^referat/i.test(cat ?? '');
  const isIndkaldelseCategory = (cat: string): boolean =>
    /^(m[øo]deindkaldelse|indkaldelse)/i.test(cat ?? '');

  for (const [fp, groupFiles] of groups) {
    console.log(`\n── ${fp || '(root)'} (${groupFiles.length} files) ──`);
    for (const f of groupFiles) {
      if (f.ext === 'doc') {
        console.log(`  SKIP  ${f.relPath} — legacy .doc (convert to PDF first)`);
        continue;
      }
      try {
        console.log(`  READ  ${f.relPath}`);
        const bytes = await fs.readFile(f.absPath);
        const folderKindHint = f.meetingFolder
          ? f.meetingFolder.isExtraordinaer
            ? `Ekstraordinær ${meetingKindLabel(f.meetingFolder.kind)}`
            : meetingKindLabel(f.meetingFolder.kind)
          : null;
        const prompt = buildPrompt(
          categories.length
            ? categories
            : [{ key: 'andet', displayName: 'Andet', displayOrder: 999 }],
          folderKindHint,
          f.meetingDateFolder,
        );
        let result: ClaudeResult;
        if (f.ext === 'pdf') {
          result = await callClaudeForPdf(bytes, prompt);
        } else {
          const m = await mammoth.extractRawText({ buffer: bytes });
          if (!m.value.trim()) throw new Error('DOCX yielded empty text');
          result = await callClaudeForText(m.value, prompt);
        }
        classifications.set(f.relPath, result);
        console.log(
          `    → ${result.categoryDisplayName} | ${result.title} | date=${result.extractedDateIso ?? '—'} | year=${result.extractedYear ?? '—'}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ! classify failed: ${msg}`);
        classifyErrors.set(f.relPath, msg);
      }
    }

    // Pick this folder's meeting date. Referat wins over Indkaldelse:
    // the referat carries the actual mødedato while the indkaldelse
    // carries the udsendelsesdato (when the invitation was sent), which
    // is typically weeks earlier. Falling back to the indkaldelse can
    // still help when a folder has no referat — but if it titles the
    // meeting (e.g. "ordinær generalforsamling 8. juli 2019") we'd
    // ideally prefer that date too. The script doesn't currently parse
    // titles for dates, so an indkaldelse-only folder will need a
    // manual PATCH /meetings/{id}/date after import.
    const groupResults = groupFiles
      .map((f) => classifications.get(f.relPath))
      .filter((r): r is ClaudeResult => !!r);
    const datedReferat = groupResults.find(
      (r) => r.extractedDateIso && isReferatCategory(r.categoryDisplayName),
    );
    const datedIndkaldelse = groupResults.find(
      (r) => r.extractedDateIso && isIndkaldelseCategory(r.categoryDisplayName),
    );
    const datedFallback = groupResults.find((r) => r.extractedDateIso);
    const groupMeetingDate =
      datedReferat?.extractedDateIso ??
      datedIndkaldelse?.extractedDateIso ??
      datedFallback?.extractedDateIso ??
      null;
    groupMeetingDateByFolder.set(fp, groupMeetingDate);

    const folderInfo = groupFiles[0]?.meetingFolder ?? null;
    let groupMeetingId: string | null = null;
    if (folderInfo && groupMeetingDate) {
      const key = `${folderInfo.kind}:${folderInfo.isExtraordinaer ? 'x' : 'o'}:${groupMeetingDate}`;
      groupMeetingId = meetingIndex.get(key) ?? null;
      if (!groupMeetingId && !args.dryRun) {
        const title = buildMeetingTitle(folderInfo, groupMeetingDate);
        groupMeetingId = await createMeeting(folderInfo.kind, groupMeetingDate, title);
        meetingIndex.set(key, groupMeetingId);
        console.log(
          `  + meeting ${folderInfo.kind}${folderInfo.isExtraordinaer ? ' (ekstraordinær)' : ''} ${groupMeetingDate} → ${groupMeetingId}`,
        );
      } else if (groupMeetingId) {
        console.log(`  · existing meeting ${groupMeetingDate} → ${groupMeetingId.slice(0, 8)}`);
      } else {
        console.log(`  · dry-run meeting placeholder for ${folderInfo.kind} ${groupMeetingDate}`);
      }
    } else if (folderInfo && !groupMeetingDate) {
      console.log(`  ! no meeting date detected in this folder — files won't be tied to a meeting`);
    }
    meetingIdByFolder.set(fp, groupMeetingId);
  }

  // ── Pass 2: per-file upload + report ────────────────────────────────
  console.log('\n══ Uploading ══');
  for (const f of trimmed) {
    const reportBase: ReportRow = {
      file: f.relPath,
      status: 'error',
      category: '',
      title: '',
      year: null,
      meetingId: null,
      summaryLen: 0,
      renamedTo: null,
      message: '',
    };

    if (f.ext === 'doc') {
      rows.push({
        ...reportBase,
        status: 'skipped',
        message: 'Legacy .doc not supported. Convert to PDF manually and re-run.',
      });
      continue;
    }

    const result = classifications.get(f.relPath);
    if (!result) {
      const msg = classifyErrors.get(f.relPath) ?? 'classification missing';
      rows.push({ ...reportBase, status: 'error', message: msg });
      continue;
    }

    try {
      // Skip if --only-cat doesn't match.
      if (args.onlyCat && result.categoryDisplayName !== args.onlyCat) {
        rows.push({
          ...reportBase,
          status: 'skipped',
          category: result.categoryDisplayName,
          title: result.title,
          year: result.extractedYear,
          message: `filtered out by --only-cat ${args.onlyCat}`,
        });
        continue;
      }

      // Resolve category to a registered one
      let category = result.categoryDisplayName;
      if (categories.length) {
        const exists = categories.find((c) => c.displayName === category);
        if (!exists) {
          const fallback =
            categories.find((c) => c.displayName === 'Andet') ?? categories[0];
          console.log(`  ! ${f.relPath}: category "${category}" not in catalog → "${fallback.displayName}"`);
          category = fallback.displayName;
        }
      }

      // Folder-resolved meeting + year. The rule depends on meeting
      // kind: assemblies (GFs) file under their CALENDAR year because
      // a GF closes the just-ended FY (GF 12. juli 2021 reviews FY
      // 2020-2021 → year=2021). Board meetings file under the
      // FISCAL year they're inside of (board møde 15. okt 2025 is in
      // FY 2025-2026 → year=2026). Budget/Regnskab/Årsregnskab
      // override both — they describe a specific fiscal period and
      // use Claude's extractedYear (slutår of period).
      const fp = folderKey(f);
      const folderKind = f.meetingFolder?.kind ?? null;
      const groupMeetingId = meetingIdByFolder.get(fp) ?? null;
      const groupDate = groupMeetingDateByFolder.get(fp) ?? null;
      const isFiscalPeriodDoc = /^(budget|regnskab|.rsregnskab)/i.test(category);
      const yearFromGroup = isFiscalPeriodDoc
        ? null
        : yearForMeetingDoc(groupDate, folderKind);
      const yearFromDoc = isFiscalPeriodDoc
        ? null
        : yearForMeetingDoc(result.extractedDateIso, folderKind);
      const year =
        yearFromGroup ??
        yearFromDoc ??
        result.extractedYear ??
        f.yearFolder ??
        new Date().getUTCFullYear();

      // Canonical filename
      const baseName = result.suggestedFilename || `${year} - ${result.title}`;
      const uploadExt = f.ext === 'docx' ? 'docx' : 'pdf';
      const canonicalName = `${baseName}.${uploadExt}`.replace(/[\\/]/g, '_');

      // Renamed copy
      let renamedTo: string | null = null;
      if (!args.noRename) {
        const subdir = path.dirname(f.relPath);
        const outDir = path.join(args.root, 'renamed', subdir);
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, canonicalName);
        await fs.copyFile(f.absPath, outPath);
        renamedTo = path.relative(args.root, outPath);
      }

      if (args.dryRun) {
        rows.push({
          ...reportBase,
          status: 'dryRun',
          category,
          title: result.title,
          year,
          meetingId: groupMeetingId,
          summaryLen: result.summary.length,
          renamedTo,
          message: 'dry run, not uploaded',
        });
        continue;
      }

      const contentType =
        uploadExt === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const bytes = await fs.readFile(f.absPath);
      const upload = await requestUploadUrl({
        filename: canonicalName,
        contentType,
        title: result.title,
        category,
        year,
        meetingId: groupMeetingId,
        summary: result.summary,
        tags: [],
      });
      await putS3(upload.uploadUrl, bytes, contentType);
      console.log(`  ✓ ${f.relPath} → ${upload.docId}`);

      rows.push({
        ...reportBase,
        status: 'ok',
        category,
        title: result.title,
        year,
        meetingId: groupMeetingId,
        summaryLen: result.summary.length,
        renamedTo,
        message: `docId=${upload.docId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR ${f.relPath}: ${msg}`);
      rows.push({ ...reportBase, status: 'error', message: msg });
    }
  }

  await writeReport(rows);
  const ok = rows.filter((r) => r.status === 'ok').length;
  const dry = rows.filter((r) => r.status === 'dryRun').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const errored = rows.filter((r) => r.status === 'error').length;
  console.log(
    `\nDone. ok=${ok} dryRun=${dry} skipped=${skipped} errors=${errored}\nReport: ${path.join(args.root, 'report.csv')}`,
  );
  if (!args.noRename) console.log(`Renamed copies under: ${path.join(args.root, 'renamed')}`);
};

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

// Suppress unused-import warnings for node URL helper kept for future use.
void fileURLToPath;
