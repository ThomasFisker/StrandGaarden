# People master dataset + Persons seeding from the house-history book

Two goals, one pipeline:

1. **Pre-seed the app's controlled Persons list** (the validated names members
   pick when tagging photos) so people stop typing + admins stop approving.
2. **Build a local people master dataset** — who the people are, their
   occupations, who married whom, which houses they were tied to (incl. owners
   who moved between houses), plus story-seed anecdotes and book-photo
   references — so **people-/house-stories can be built later without
   re-reading the PDFs**.

Guiding principle: **capture rich locally, surface a plain name in the app.**
The deployed Persons API only stores `displayName`+`slug`; everything else lives
in local CSVs joined by a stable `personId`.

```
House Information/Short story Number N.pdf      ← scanned book pages (one per house)
        │  (1) extract-house-info.ts  — Claude reads each page
        ▼
houses/house-N.md            ← readable history + owner table (archive)
*.generated.csv              ← candidate rows for the master + collisions.csv
        │  (2) you review + merge into ↓
        ▼
people.csv · person_house.csv · relationships.csv · houses.csv · stories.csv   ← VALIDATED master
        │  (3) import-persons.ts  — pushes each name to /persons
        ▼
Deployed Persons list (state: approved)
```

> All of `House Information/` is git-ignored (large/possibly-copyrighted scans +
> derived data). It lives locally / in OneDrive, not in the repo.

---

## The master dataset (local CSVs, joined by `personId`)

| File | One row per | Key columns |
|------|-------------|-------------|
| `people.csv` | real person | `personId, displayName, tagName, nicknames, bornYear, diedYear, occupation, town, sourceHouses, notes, include` |
| `person_house.csv` | person↔house link | `personId, houseNumber, role, ejerNr, fromYear, toYear, notes` |
| `relationships.csv` | person↔person | `personIdA, personIdB, type, notes` |
| `houses.csv` | house | `houseNumber, names, builtYear, renovations, foundingNote, bookPhotos, notes` |
| `stories.csv` | story seed | `storyId, scope, refId, title, seed, sourceHouse` |
| `houses/house-N.md` | house | readable history + owner table |

Conventions that make stories possible later:
- **`personId` is the identity, never the bare name.** It's `slugify(displayName)`;
  on a true collision between *different* people sharing a name, append the birth
  year → `else-larsen-1864`. IDs are stable — relationships/person_house point at them.
- **`displayName`** = clean canonical name. **`tagName`** = what gets pushed to
  the app; it equals `displayName` except when a collision forced a `(f. YYYY)`
  disambiguator. Occupation/town/nicknames stay in the master, never in `tagName`.
- **`person_house` is many-to-many** — a person who owned, sold, and re-acquired
  (or moved between houses) simply has multiple rows. `role` ∈
  owner|spouse|child|relative|founder|builder|tenant; `ejerNr` is the book's
  owner number; `fromYear`/`toYear` give the period.
- **`relationships`** — `type` ∈ spouse|parent|child|sibling|in-law|grandparent.
  parent/child rows read "A is parent of B"; spouse/sibling are symmetric.
  Remarriage = two spouse rows.

---

## What each script does

### 1. `extract-house-info.ts` — PDF → master candidates + Markdown

Reads every `Short story Number <N>.pdf` under `--root`, asks Claude for rich
structured data per house (history, owner table, every named person with
occupation/town/nicknames/born/died/relations, plus anecdotes and photo
captions), then writes:
- `houses/house-<N>.md` (archive), and
- `people.generated.csv`, `person_house.generated.csv`,
  `relationships.generated.csv`, `houses.generated.csv`,
  `stories.generated.csv`, and `collisions.csv`.

`personId` uses the platform's own `slugify` (`infra/lambdas/persons-shared.ts`),
so master IDs and app slugs line up. It reads any existing validated `people.csv`
to check new houses against already-curated people.

**It will not clobber curated work:** a house whose `houses/house-<N>.md` already
exists is **skipped** (`--force` to re-extract). The `*.generated.csv` files are
overwritten each run — do your editing in the validated master, not the generated
files.

```bash
ANTHROPIC_API_KEY=sk-... npx tsx infra/scripts/extract-house-info.ts \
  --root "House Information"
```

| Flag | Purpose |
|------|---------|
| `--root <path>` | **Required.** Folder with the `Short story Number N.pdf` files. |
| `--house <N>` | Only process house number N. |
| `--limit <K>` | Process at most K houses. |
| `--force` | Re-extract even if `houses/house-<N>.md` exists (overwrites it). |

### 2. (you) Validate + merge

Review the `*.generated.csv` against the PDFs / `houses/*.md`, fix any mis-read
name or year, and **merge the new rows into the validated master CSVs**. Resolve
**`collisions.csv`** first:
- *Same person* seen in two houses (e.g. moved house) → keep **one** `personId`,
  add a second `person_house` row.
- *Different people, same name* → give the newcomer a birth-year `personId`
  (`else-larsen-1864`) and set its `tagName` to `Else Larsen (f. 1864)` so both
  can be tagged in the app (slugs must be unique there).

Set `include=0` on any `people.csv` row you don't want imported.

### 3. `import-persons.ts` — validated `people.csv` → deployed Persons list

POSTs each `include=1` person's `tagName` (fallback `displayName`) to
`POST /persons` (creates an **approved** person). The platform derives the slug
the same way and returns **409** on collision, so the import is **idempotent** —
re-runs report everything `skipped-existing`. It first `GET /persons` to skip
names that already exist, and writes `persons-report.csv`. Only the name is sent;
the richer master columns are not.

```bash
# Dry run first — shows what would be created (and what already exists):
JWT=eyJ... npx tsx infra/scripts/import-persons.ts --dry-run

# Real import:
JWT=eyJ... npx tsx infra/scripts/import-persons.ts
```

| Flag | Purpose |
|------|---------|
| `--file <path>` | CSV to import (default `House Information/people.csv`). |
| `--dry-run` | Don't POST; just report planned actions. |

**Getting the `JWT`** (admin / Udvalg login required): log in on
https://medlemmer.strandgaardenis.dk → DevTools → Application → Local Storage →
copy `idToken`. Expires in ~1h; on a `401`, grab a fresh token and re-run (safe —
already-created names are skipped).

---

## Secrets

- **`ANTHROPIC_API_KEY`** (extraction) — console.anthropic.com → API Keys.
- **`JWT`** (import) — admin `idToken` from the live site, as above.

## Verifying

After a real import, check `/admin/personer` (or `GET /persons`) shows the new
names, then on `/upload` or a photo edit confirm they appear in the person
autocomplete with no approval step. Re-run the import → all `skipped-existing`.

## Caveats

- **Edit the validated master, not the `*.generated.csv`** (those are overwritten).
- **Source quirks happen** — abbreviated surnames ("Margit L."), text/table name
  mismatches (Emil vs Egon), inconsistent years. The extractor guesses and notes
  them; the validation step + the `note` columns + per-house `.md` notes exist to
  catch these.
- **No deletes / merges.** This only adds names to the app. Removing or merging
  persons is done in the admin UI.
