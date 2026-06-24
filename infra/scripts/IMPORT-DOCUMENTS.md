# Backlog document import — how it works & what you do

This is the **one-off / occasional backlog import** for historical
foreningsdokumenter (referater, indkaldelser, regnskaber, budgetter,
vedtægter …). It is **not** part of the deployed app — it's a local
script you run by hand when you have a new batch of scanned papers to
get into the platform. The code lives in
[`import-documents.ts`](import-documents.ts).

> Status: **parked / run-as-needed.** No automation. You run it from
> your machine when you want to load a folder of documents.

---

## What the script actually does

For every PDF / Word file under a folder tree you point it at, it:

1. **Reads the file** (PDFs go straight to Claude; `.docx` text is
   extracted first with `mammoth`).
2. **Asks Claude** to classify it: pick a category, write a precise
   Danish title, a 2–4 sentence summary (with key figures for
   regnskab/budget), the document's primary date, and the year it
   belongs to.
3. **Groups files by folder** and figures out the meeting each folder
   represents (a `Bestyrelsesmøde` or `Generalforsamling` on a given
   date). If that meeting doesn't already exist in the platform, it
   **creates it**; otherwise it reuses the existing one.
4. **Files everything under the right year.** The forening's fiscal
   year runs **1 June → 31 May**. Assemblies file under their calendar
   year (a GF closes the just-ended FY); board meetings file under the
   fiscal year they sit inside; regnskab/budget use the period's
   end-year. You don't have to think about this — it's automatic.
5. **Uploads** each file to the platform (presigned S3 PUT) with all
   that metadata attached, tied to its meeting.
6. **Writes two artifacts** back into the root folder:
   - `report.csv` — one row per file (status, category, title, year,
     meeting, any error). **Read this after every run.**
   - `renamed/` — a mirror tree with canonical filenames (your
     originals are never touched).

After import you can fix anything Claude got wrong in the UI at
`/dokumenter/:id` (re-tag category, edit title, etc.).

---

## What YOU have to do

### 1. Lay the files out the way the script expects

The folder structure **is** the metadata. Put files like this under one
root folder:

```
<root>/
  <YYYY>/                                  ← fiscal/calendar year folder
    <MeetingKind>/                         ← optional: a meeting type
      <YYYY-MM-DD>/                        ← optional: the meeting date
        referat.pdf
        indkaldelse.pdf
      <YYYY-MM-DD>/
        ...
    regnskab-2024-2025.pdf                 ← year-level doc, no meeting
    vedtaegter.pdf
```

**`<MeetingKind>` must be one of these folder names** (ASCII or Danish
spelling both work):

| Folder name                        | Becomes                              |
|------------------------------------|--------------------------------------|
| `Bestyrelsesmoede` / `Bestyrelsesmøde` | Bestyrelsesmøde (board)          |
| `Generalforsamling`                | Ordinær generalforsamling (assembly) |
| `Ordinaer-Generalforsamling`       | Ordinær generalforsamling            |
| `Ekstraordinaer-Generalforsamling` | Ekstraordinær generalforsamling      |

Rules of thumb:
- **Always use the `YYYY-MM-DD` date folder for meetings.** It's how
  the script names and de-duplicates the meeting. Put both the referat
  and the indkaldelse for one meeting in the *same* date folder.
- Documents that aren't tied to a meeting (vedtægter, årsregnskab,
  budget, generelle meddelelser) can sit directly under the `<YYYY>`
  folder — no meeting folder needed.
- Naming of the **files themselves doesn't matter** — Claude reads the
  content and proposes a clean name. Folder structure is what counts.

### 2. Make sure the categories exist first

Claude is only allowed to choose from the platform's live
**dokument-kategorier** list. If a category you need isn't there yet,
add it in the admin UI **before** importing, otherwise the doc lands in
**"Andet"** as a fallback (you can re-tag later, but it's easier
up-front).

### 3. Get the two secrets

- **`JWT`** — log in as admin on https://medlemmer.strandgaardenis.dk,
  open DevTools → Application → Local Storage, copy the `idToken`
  value. **It expires after ~1 hour** and the script does not refresh
  it — if you get a `401`, grab a fresh token and re-run.
- **`ANTHROPIC_API_KEY`** — from console.anthropic.com → Settings →
  API Keys.

### 4. Run it — dry-run first, always

From the repo root (the `tsx` runner reads the script from
`infra/scripts/`):

```bash
# 1) Dry run: classify + write report.csv + renamed/, but NO uploads,
#    NO meetings created. Inspect report.csv to sanity-check Claude.
ANTHROPIC_API_KEY=sk-... npx tsx infra/scripts/import-documents.ts \
  --root "C:/path/to/DokumenterUpload" --dry-run

# 2) Real run once the dry-run report looks right:
JWT=eyJ... ANTHROPIC_API_KEY=sk-... npx tsx infra/scripts/import-documents.ts \
  --root "C:/path/to/DokumenterUpload"
```

Re-runs are safe to repeat — the script skips its own `renamed/` and
`report.csv` outputs. (It does **not** dedupe already-uploaded
documents, though — see caveats. Use `--limit` while testing.)

**Useful flags:**

| Flag              | What it does                                              |
|-------------------|----------------------------------------------------------|
| `--root <path>`   | **Required.** Root of the document tree.                 |
| `--dry-run`       | Classify + report only. No uploads, no meeting creates.  |
| `--limit N`       | Process at most N files (handy for a first test).        |
| `--only-cat <name>` | Only upload files Claude classifies as `<name>` — good for retrying one bucket. |
| `--no-rename`     | Skip writing the `renamed/` mirror tree.                 |

### 5. Check `report.csv` and clean up in the UI

Open `report.csv` from the root folder. Anything `status=error` or
`status=skipped` needs attention; anything that landed in **"Andet"**
or under the wrong year/meeting can be fixed at `/dokumenter/:id`.

---

## Caveats / known limits

- **Legacy `.doc` (old Word) is not supported** — the script skips it.
  Open it in Word and "Save As → PDF" first, then re-run.
- **PDFs over 32 MB are rejected** (Anthropic doc-block limit). Split
  or re-scan at a lower DPI.
- **No upload dedupe.** Running the *real* import twice over the same
  tree uploads the documents twice (meetings are de-duped by
  kind+date, but documents are not). Import a given batch once; use
  `--dry-run` freely.
- **Indkaldelse-only folders get the wrong meeting date.** The meeting
  date is taken from the **referat** (the actual mødedato) when one is
  present. If a folder has only an indkaldelse, the script uses the
  indkaldelse's *udsendelsesdato* (usually weeks before the meeting),
  so the meeting date will be off — fix it afterwards with a manual
  edit. (If you have the referat, just drop it in the same date folder
  and this resolves itself.)
- **Token expiry mid-run.** A large batch can outlast the 1-hour JWT.
  If it dies on `401`, get a fresh token and re-run (use `--only-cat`
  or move already-done folders aside to avoid re-uploading).

---

## Where the data lives

The scanned-document working folders (`DokumenterUpload/`, `Inbox/`,
`_import_2017_2019/`, `drafts/`) and the script's `renamed/` +
`report.csv` outputs are **git-ignored** — they're per-machine working
data, not app source. Keep them locally / in OneDrive; they don't get
committed.
