/**
 * Extract a people master dataset + a per-house history archive from the
 * Strandgaarden anniversary-book house pages.
 *
 * Each "Short story Number <N>.pdf" is one scanned book page: a short
 * Danish history plus an owner table
 *   (Ejer nr. | Navn | ejerskab/optagelse år | født | død | hus opført | hus nyt/renoveret).
 * Claude reads the page (vision; rotated scans are fine) and returns rich
 * structured JSON. We then build a small relational dataset (joined by a
 * stable personId) so people-/house-stories can be built later WITHOUT
 * re-reading the PDFs — see infra/scripts/IMPORT-PERSONS.md.
 *
 * Principle: capture rich here; the deployed app only consumes a name.
 *
 * Outputs (written into <root>):
 *   - houses/house-<N>.md            human-readable history + owner table
 *   - people.generated.csv           one row per distinct person
 *   - person_house.generated.csv     person↔house links (owner/spouse/…); many per person
 *   - relationships.generated.csv    person↔person (spouse/parent/sibling/…)
 *   - houses.generated.csv           house-level facts (names, built, renov, photos)
 *   - stories.generated.csv          story-seed anecdotes
 *   - collisions.csv                 same-slug people from different houses — REVIEW
 *
 * The *.generated.csv files are CANDIDATES — review them, then merge the new
 * rows into the validated master (people.csv, person_house.csv,
 * relationships.csv, houses.csv, stories.csv). To protect curated work the
 * script SKIPS any house whose houses/house-<N>.md already exists unless you
 * pass --force. Collision detection + relation resolution also read the
 * validated people.csv (if present) so new houses are checked against it.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> \
 *     npx tsx infra/scripts/extract-house-info.ts --root "House Information"
 *
 * Flags:
 *   --root <path>   folder holding the "Short story Number N.pdf" files (required)
 *   --house <N>     only process house number N
 *   --limit <K>     process at most K houses
 *   --force         re-extract even if houses/house-<N>.md already exists
 *
 * Get ANTHROPIC_API_KEY: console.anthropic.com → Settings → API Keys.
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { slugify } from '../lambdas/persons-shared';

const MODEL = 'claude-opus-4-8';
const PDF_MAX_BYTES = 32 * 1024 * 1024; // Anthropic doc-block limit

interface CliArgs {
  root: string;
  house: number | null;
  limit: number | null;
  force: boolean;
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
  const house = get('house');
  const limit = get('limit');
  return {
    root: path.resolve(root),
    house: house ? Number(house) : null,
    limit: limit ? Number(limit) : null,
    force: has('force'),
  };
};

const args = parseArgs();
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Missing ANTHROPIC_API_KEY env var.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

// ─── Types (Claude reply) ─────────────────────────────────────────────

type PersonRole = 'owner' | 'spouse' | 'child' | 'relative' | 'founder' | 'builder' | 'tenant';
type RelType = 'spouse' | 'parent' | 'child' | 'sibling' | 'in-law' | 'grandparent';

interface RawRelation {
  toName: string;
  type: RelType;
}
interface RawPerson {
  displayName: string;
  role: PersonRole;
  occupation: string | null;
  town: string | null;
  nicknames: string | null;
  bornYear: string | null;
  diedYear: string | null;
  note: string | null;
  relations: RawRelation[];
}
interface RawOwner {
  ejerNr: number | null;
  rawNavn: string;
  ejerskabFrom: string | null;
  ejerskabTo: string | null;
  persons: RawPerson[];
}
interface RawAnecdote {
  scope: 'person' | 'house';
  who: string | null;
  title: string;
  text: string;
}
interface RawBookPhoto {
  caption: string;
  year: string | null;
}
interface ExtractedHouse {
  houseNumber: number;
  houseName: string | null;
  formerNames: string[];
  builtYear: string | null;
  renovations: string | null;
  foundingNote: string | null;
  bookPhotos: RawBookPhoto[];
  history: string;
  owners: RawOwner[];
  anecdotes: RawAnecdote[];
}

// ─── Accumulated (output) ─────────────────────────────────────────────

interface SeedPerson {
  personId: string;
  displayName: string;
  nicknames: string;
  bornYear: string;
  diedYear: string;
  occupation: string;
  town: string;
  sourceHouses: Set<number>;
  notes: string;
}
interface PersonHouseRow {
  personId: string;
  houseNumber: number;
  role: PersonRole;
  ejerNr: number | null;
  notes: string;
}
interface RelRow {
  a: string;
  b: string;
  type: RelType;
  notes: string;
}
interface HouseRow {
  houseNumber: number;
  names: string;
  builtYear: string;
  renovations: string;
  foundingNote: string;
  bookPhotos: string;
  notes: string;
}
interface StoryRow {
  storyId: string;
  scope: 'person' | 'house';
  refId: string;
  title: string;
  seed: string;
  sourceHouse: number;
}
interface CollisionRow {
  slug: string;
  houseNumber: number;
  displayName: string;
  bornYear: string;
  occupation: string;
  against: string; // where the same slug was already seen
}

// ─── Claude extraction ────────────────────────────────────────────────

const buildPrompt = (houseNumber: number): string =>
  `Du analyserer én side fra en dansk sommerhusforenings jubilæumsbog
(Strandgaarden Interessentskab), nemlig siden for hus nr. ${houseNumber}.
Siden indeholder: overskrift ("Strandgaarden nr. ${houseNumber}", evt. husnavn),
et par fotos med billedtekster, en kort historie i brødtekst, og en ejertabel
med kolonnerne: Ejer nr. | Navn | ejerskab/optagelse år | født | død | hus
opført | hus nyt/renoveret.

OBS: nogle sider kan være scannet på hovedet — læs dem alligevel.

Returnér UDELUKKENDE et JSON-objekt (ingen tekst udenom):
{
  "houseNumber": ${houseNumber},
  "houseName": string | null,            // nuværende husnavn i citationstegn, fx "Solgaarden"; ellers null
  "formerNames": string[],               // tidligere navne, hvis nævnt (fx ["Villa Strandasters"]); ellers []
  "builtYear": string | null,            // hus opført (fx "1939-40"); ellers null
  "renovations": string | null,          // renoveringer/udvidelser kort (fx "1967; sidebygning 2003")
  "foundingNote": string | null,         // hvis ejeren var medstifter/interessent — kort note; ellers null
  "bookPhotos": [ { "caption": string, "year": string | null } ],  // billedteksterne
  "history": string,                     // brødteksten ORDRET, afsnit adskilt med \\n\\n. Ret kun åbenlyse OCR-fejl.
  "owners": [
    {
      "ejerNr": number | null,
      "rawNavn": string,                 // HELE Navn-cellen ordret
      "ejerskabFrom": string | null,     // ejerskab/optagelse-årets start (fx "1937")
      "ejerskabTo": string | null,       // hvis udledelig fra næste ejer; ellers null
      "persons": [
        {
          "displayName": string,         // KUN navnet — uden titel/erhverv/by/relationsord
          "role": "owner" | "spouse" | "child" | "relative" | "founder" | "builder" | "tenant",
          "occupation": string | null,   // erhverv/titel (smedemester, skibsfører, hotelejer ...)
          "town": string | null,         // by (Aalborg, Hals ...)
          "nicknames": string | null,    // kælenavn(e), fx "Lotte"
          "bornYear": string | null,     // fra født-kolonnen, matchet til denne person
          "diedYear": string | null,     // fra død-kolonnen
          "note": string | null,         // relation/kontekst kort, fx "datter af X"; nævn uoverensstemmelser
          "relations": [ { "toName": string, "type": "spouse"|"parent"|"child"|"sibling"|"in-law"|"grandparent" } ]
        }
      ]
    }
  ],
  "anecdotes": [
    { "scope": "person" | "house", "who": string | null, "title": string, "text": string }
  ]
}

Regler:
- Udtræk ALLE navngivne personer i hver Navn-celle: hovedejer (role "owner"),
  ægtefælle efter "gm:" (role "spouse"), børn/slægtninge (role "child"/"relative").
  Håndværkere nævnt i teksten (fx tømrermester der byggede huset) tages KUN med
  hvis de optræder i ejertabellen; ellers omtal dem i en anecdote i stedet.
- displayName er KUN personens navn — fjern titel/erhverv, by og relationsord
  (datter, søn, barnebarn, mor til X). Læg erhverv i "occupation", by i "town".
- Kælenavne i parentes → "nicknames", IKKE displayName. Fx
  "Rigmor Christiansen (Lotte)" → displayName "Rigmor Christiansen", nicknames "Lotte".
- Forkortede efternavne ("Margit L.") → gæt fulde efternavn ud fra konteksten,
  sæt displayName "Margit Larsen" og skriv i note at efternavnet er antaget.
- "relations": medtag ægteskaber (spouse) og slægt (parent/child/sibling/
  grandparent/in-law) til ANDRE navngivne personer på siden. Brug toName =
  personens displayName (rensede navn). For "parent" er denne person forælder
  til toName.
- Hvis samme person optræder i flere ejer-rækker (fx ejer 2 og ejer 4), brug
  SAMME displayName begge steder.
- "anecdotes": 0-4 korte historie-frø fra brødteksten (interessante episoder,
  navne på huset, særlige begivenheder). Hver med en kort dansk titel.
- Hvis tekst og tabel er uenige om et navn/årstal, brug tabellens form og nævn
  uoverensstemmelsen i "note". Brug danske bogstaver (æ ø å) korrekt.`;

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asStringOrNull = (v: unknown): string | null => {
  const s = asString(v);
  return s ? s : null;
};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const ROLES: PersonRole[] = ['owner', 'spouse', 'child', 'relative', 'founder', 'builder', 'tenant'];
const REL_TYPES: RelType[] = ['spouse', 'parent', 'child', 'sibling', 'in-law', 'grandparent'];

const extractHouse = async (houseNumber: number, pdfBytes: Buffer): Promise<ExtractedHouse> => {
  if (pdfBytes.length > PDF_MAX_BYTES) {
    throw new Error(`PDF too large (${pdfBytes.length} bytes, max ${PDF_MAX_BYTES}).`);
  }
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBytes.toString('base64') },
          },
          { type: 'text', text: buildPrompt(houseNumber) },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
  return parseHouseReply(text, houseNumber);
};

const parseHouseReply = (raw: string, fallbackHouse: number): ExtractedHouse => {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/, '')
    .replace(/\s*```[\s\S]*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`No JSON object in reply: ${raw.slice(0, 200)}`);
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

  const owners: RawOwner[] = asArray(obj.owners).map((o) => {
    const ow = (o ?? {}) as Record<string, unknown>;
    const persons: RawPerson[] = asArray(ow.persons)
      .map((p) => {
        const pr = (p ?? {}) as Record<string, unknown>;
        const role = asString(pr.role) as PersonRole;
        const relations: RawRelation[] = asArray(pr.relations)
          .map((rl) => {
            const r = (rl ?? {}) as Record<string, unknown>;
            const type = asString(r.type) as RelType;
            return {
              toName: asString(r.toName),
              type: REL_TYPES.includes(type) ? type : ('relative' as unknown as RelType),
            };
          })
          .filter((r) => r.toName && REL_TYPES.includes(r.type));
        return {
          displayName: asString(pr.displayName).replace(/\s+/g, ' ').trim(),
          role: ROLES.includes(role) ? role : 'owner',
          occupation: asStringOrNull(pr.occupation),
          town: asStringOrNull(pr.town),
          nicknames: asStringOrNull(pr.nicknames),
          bornYear: asStringOrNull(pr.bornYear),
          diedYear: asStringOrNull(pr.diedYear),
          note: asStringOrNull(pr.note),
          relations,
        };
      })
      .filter((p) => p.displayName);
    return {
      ejerNr: Number.isInteger(ow.ejerNr) ? (ow.ejerNr as number) : null,
      rawNavn: asString(ow.rawNavn).replace(/\s+/g, ' ').trim(),
      ejerskabFrom: asStringOrNull(ow.ejerskabFrom),
      ejerskabTo: asStringOrNull(ow.ejerskabTo),
      persons,
    };
  });

  const anecdotes: RawAnecdote[] = asArray(obj.anecdotes)
    .map((a) => {
      const an = (a ?? {}) as Record<string, unknown>;
      const scope: 'person' | 'house' = asString(an.scope) === 'person' ? 'person' : 'house';
      return { scope, who: asStringOrNull(an.who), title: asString(an.title), text: asString(an.text) };
    })
    .filter((a) => a.text);

  const bookPhotos: RawBookPhoto[] = asArray(obj.bookPhotos)
    .map((p) => {
      const ph = (p ?? {}) as Record<string, unknown>;
      return { caption: asString(ph.caption), year: asStringOrNull(ph.year) };
    })
    .filter((p) => p.caption);

  return {
    houseNumber: Number.isInteger(obj.houseNumber) ? (obj.houseNumber as number) : fallbackHouse,
    houseName: asStringOrNull(obj.houseName),
    formerNames: asArray(obj.formerNames).map(asString).filter(Boolean),
    builtYear: asStringOrNull(obj.builtYear),
    renovations: asStringOrNull(obj.renovations),
    foundingNote: asStringOrNull(obj.foundingNote),
    bookPhotos,
    history: asString(obj.history),
    owners,
    anecdotes,
  };
};

// ─── CSV / Markdown helpers ───────────────────────────────────────────

const csvEscape = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csv = (rows: (string | number)[][]): string =>
  rows.map((r) => r.map((c) => csvEscape(String(c))).join(',')).join('\n') + '\n';

const mdCell = (s: string | null): string => (s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

const renderHouseMd = (h: ExtractedHouse): string => {
  const allNames = [h.houseName, ...h.formerNames].filter(Boolean) as string[];
  const title = allNames.length
    ? `# Strandgaarden nr. ${h.houseNumber} — ${allNames.join(' / ')}`
    : `# Strandgaarden nr. ${h.houseNumber}`;
  const photoLine = h.bookPhotos.length
    ? `> Kilde: jubilæumsbogens hus-side (foto: ${h.bookPhotos.map((p) => p.caption).join(' og ')}).`
    : `> Kilde: jubilæumsbogens hus-side.`;
  const rows = h.owners
    .map((o) => {
      const navn = mdCell(o.rawNavn);
      const ejer = mdCell([o.ejerskabFrom, o.ejerskabTo].filter(Boolean).join('–'));
      return `| ${o.ejerNr ?? ''} | ${navn} | ${ejer} |`;
    })
    .join('\n');
  return `${title}

${photoLine}
> Genereret af extract-house-info.ts — gennemlæs mod kilden.

## Historie

${h.history}

## Ejere (oversigt)

| Ejer nr. | Navn | Ejerskab |
|---|---|---|
${rows}
`;
};

// ─── Main ─────────────────────────────────────────────────────────────

const houseNumberFromName = (name: string): number | null => {
  const m = /short\s*story\s*number\s*(\d+)/i.exec(name);
  return m ? Number(m[1]) : null;
};

/** Read the validated master people.csv (if present) so collision checks
 * and relation resolution see already-curated people. Returns slug→source. */
const loadExistingPeople = async (root: string): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  try {
    const raw = await fs.readFile(path.join(root, 'people.csv'), 'utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return out;
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const iId = header.indexOf('personid');
    const iHouses = header.indexOf('sourcehouses');
    for (const line of lines.slice(1)) {
      // people.csv ids/houses are simple (no embedded commas) — split is safe here.
      const cells = line.split(',');
      const id = (cells[iId] ?? '').trim();
      if (id) out.set(id, `master (hus ${cells[iHouses]?.trim() ?? '?'})`);
    }
  } catch {
    /* no master yet */
  }
  return out;
};

const main = async () => {
  console.log(`Scanning ${args.root} for house PDFs…`);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(args.root);
  } catch (e) {
    console.error(`Cannot read --root ${args.root}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  let houses = entries
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .map((name) => ({ name, num: houseNumberFromName(name) }))
    .filter((f): f is { name: string; num: number } => f.num !== null)
    .sort((a, b) => a.num - b.num);

  if (args.house !== null) houses = houses.filter((f) => f.num === args.house);
  if (args.limit !== null) houses = houses.slice(0, args.limit);

  if (houses.length === 0) {
    console.log('No matching "Short story Number N.pdf" files. Nothing to do.');
    return;
  }
  console.log(`Found ${houses.length} house PDF(s): ${houses.map((h) => h.num).join(', ')}`);

  const housesDir = path.join(args.root, 'houses');
  await fs.mkdir(housesDir, { recursive: true });

  // Seed the slug→source map from the validated master so new houses are
  // checked against already-curated people.
  const personSource = await loadExistingPeople(args.root);
  if (personSource.size) console.log(`Master people.csv: ${personSource.size} existing person(s) for collision checks.`);

  const people = new Map<string, SeedPerson>();
  const personHouse: PersonHouseRow[] = [];
  const relPairs = new Map<string, RelRow>();
  const houseRows: HouseRow[] = [];
  const storyRows: StoryRow[] = [];
  const collisions: CollisionRow[] = [];

  let processed = 0;
  let skipped = 0;

  for (const { name, num } of houses) {
    const mdPath = path.join(housesDir, `house-${num}.md`);
    if (!args.force) {
      try {
        await fs.access(mdPath);
        console.log(`  · skip house ${num} — ${path.relative(args.root, mdPath)} exists (use --force)`);
        skipped++;
        continue;
      } catch {
        /* proceed */
      }
    }

    console.log(`  READ  house ${num} (${name})`);
    let house: ExtractedHouse;
    try {
      const bytes = await fs.readFile(path.join(args.root, name));
      house = await extractHouse(num, bytes);
    } catch (err) {
      console.error(`  ! house ${num} failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    await fs.writeFile(mdPath, renderHouseMd(house), 'utf8');
    console.log(`  ✓ wrote ${path.relative(args.root, mdPath)} (${house.owners.length} ejere)`);

    // Persons + person_house. Same displayName within a house = one person,
    // but each owner row yields its own person_house link (handles repeat
    // ownership like ejer 2 + ejer 4).
    const seenThisHouse = new Set<string>();
    for (const owner of house.owners) {
      for (const person of owner.persons) {
        const slug = slugify(person.displayName);
        if (!slug) continue;

        // Collision: this slug was first seen elsewhere (master or another
        // house this run). Same house = same person, no collision.
        const prior = personSource.get(slug);
        if (prior && !prior.startsWith(`hus ${num}`)) {
          collisions.push({
            slug,
            houseNumber: num,
            displayName: person.displayName,
            bornYear: person.bornYear ?? '',
            occupation: person.occupation ?? '',
            against: prior,
          });
        }
        if (!personSource.has(slug)) personSource.set(slug, `hus ${num}`);

        const existing = people.get(slug);
        if (existing) {
          existing.sourceHouses.add(num);
          if (!existing.bornYear && person.bornYear) existing.bornYear = person.bornYear;
          if (!existing.diedYear && person.diedYear) existing.diedYear = person.diedYear;
          if (!existing.occupation && person.occupation) existing.occupation = person.occupation;
          if (!existing.town && person.town) existing.town = person.town;
          if (!existing.nicknames && person.nicknames) existing.nicknames = person.nicknames;
          if (person.note && !existing.notes.includes(person.note)) {
            existing.notes = existing.notes ? `${existing.notes}; ${person.note}` : person.note;
          }
        } else {
          people.set(slug, {
            personId: slug,
            displayName: person.displayName,
            nicknames: person.nicknames ?? '',
            bornYear: person.bornYear ?? '',
            diedYear: person.diedYear ?? '',
            occupation: person.occupation ?? '',
            town: person.town ?? '',
            sourceHouses: new Set([num]),
            notes: person.note ?? '',
          });
        }

        personHouse.push({
          personId: slug,
          houseNumber: num,
          role: person.role,
          ejerNr: owner.ejerNr,
          notes: [owner.ejerskabFrom, owner.ejerskabTo].filter(Boolean).join('–'),
        });
        seenThisHouse.add(slug);

        // Relationships (resolve target name → slug; flag unresolved).
        for (const rel of person.relations) {
          const toSlug = slugify(rel.toName);
          if (!toSlug) continue;
          addRelationship(relPairs, slug, toSlug, rel.type, personSource.has(toSlug) ? '' : `uafklaret reference: "${rel.toName}"`);
        }
      }
    }

    // House facts.
    houseRows.push({
      houseNumber: num,
      names: [house.houseName, ...house.formerNames].filter(Boolean).join(' → '),
      builtYear: house.builtYear ?? '',
      renovations: house.renovations ?? '',
      foundingNote: house.foundingNote ?? '',
      bookPhotos: house.bookPhotos
        .map((p) => [p.caption, p.year].filter(Boolean).join(' '))
        .join('; '),
      notes: '',
    });

    // Stories.
    house.anecdotes.forEach((a, i) => {
      let refId = String(num);
      let scope: 'person' | 'house' = a.scope;
      if (a.scope === 'person' && a.who) {
        const s = slugify(a.who);
        if (s) refId = s;
        else scope = 'house';
      } else {
        scope = 'house';
      }
      storyRows.push({
        storyId: `h${num}-a${i + 1}`,
        scope,
        refId,
        title: a.title || `Hus ${num}`,
        seed: a.text,
        sourceHouse: num,
      });
    });

    processed++;
  }

  if (processed === 0) {
    console.log(`\nNo houses processed (${skipped} skipped). No CSVs written.`);
    return;
  }

  // ── Write generated CSVs ──────────────────────────────────────────
  // Prefix CSVs with a UTF-8 BOM so Excel on Windows detects the encoding
  // and shows æ/ø/å correctly instead of mojibake (Ã¦/Ã¸/Ã¥). All our CSV
  // readers strip the BOM.
  const BOM = String.fromCharCode(0xfeff);
  const w = (file: string, content: string) =>
    fs.writeFile(path.join(args.root, file), (file.endsWith('.csv') ? BOM : '') + content, 'utf8');

  const peopleRows = [...people.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'da'),
  );
  await w(
    'people.generated.csv',
    csv([
      ['personId', 'displayName', 'tagName', 'nicknames', 'bornYear', 'diedYear', 'occupation', 'town', 'sourceHouses', 'notes', 'include'],
      ...peopleRows.map((p) => [
        p.personId,
        p.displayName,
        '',
        p.nicknames,
        p.bornYear,
        p.diedYear,
        p.occupation,
        p.town,
        [...p.sourceHouses].sort((x, y) => x - y).join(' '),
        p.notes,
        '1',
      ]),
    ]),
  );

  await w(
    'person_house.generated.csv',
    csv([
      ['personId', 'houseNumber', 'role', 'ejerNr', 'fromYear', 'toYear', 'notes'],
      ...personHouse.map((r) => {
        const [from, to] = r.notes.split('–');
        return [r.personId, r.houseNumber, r.role, r.ejerNr ?? '', from ?? '', to ?? '', ''];
      }),
    ]),
  );

  await w(
    'relationships.generated.csv',
    csv([
      ['personIdA', 'personIdB', 'type', 'notes'],
      ...[...relPairs.values()].map((r) => [r.a, r.b, r.type, r.notes]),
    ]),
  );

  await w(
    'houses.generated.csv',
    csv([
      ['houseNumber', 'names', 'builtYear', 'renovations', 'foundingNote', 'bookPhotos', 'notes'],
      ...houseRows.map((h) => [h.houseNumber, h.names, h.builtYear, h.renovations, h.foundingNote, h.bookPhotos, h.notes]),
    ]),
  );

  await w(
    'stories.generated.csv',
    csv([
      ['storyId', 'scope', 'refId', 'title', 'seed', 'sourceHouse'],
      ...storyRows.map((s) => [s.storyId, s.scope, s.refId, s.title, s.seed, s.sourceHouse]),
    ]),
  );

  await w(
    'collisions.csv',
    csv([
      ['slug', 'houseNumber', 'displayName', 'bornYear', 'occupation', 'alreadySeenIn'],
      ...collisions.map((c) => [c.slug, c.houseNumber, c.displayName, c.bornYear, c.occupation, c.against]),
    ]),
  );

  console.log(
    `\nDone. houses processed=${processed} skipped=${skipped}\n` +
      `  people=${people.size} person_house=${personHouse.length} relationships=${relPairs.size} ` +
      `stories=${storyRows.length} collisions=${collisions.length}`,
  );
  if (collisions.length) {
    console.log(
      `  ⚠ ${collisions.length} possible name collision(s) — review collisions.csv: same name, different house.`,
    );
  }
  console.log(
    'NEXT: review the *.generated.csv files, resolve collisions.csv, then merge the new rows into the validated master (people.csv etc.) before import-persons.ts.',
  );
};

/** Insert a relationship, de-duplicating and canonicalising direction.
 * spouse/sibling/in-law are symmetric (sort the pair). child is folded
 * into parent (swap). parent/grandparent keep A→B direction. */
const addRelationship = (
  map: Map<string, RelRow>,
  a: string,
  b: string,
  type: RelType,
  notes: string,
): void => {
  if (a === b) return;
  let A = a;
  let B = b;
  let T = type;
  if (T === 'child') {
    [A, B] = [b, a];
    T = 'parent';
  }
  if (T === 'spouse' || T === 'sibling' || T === 'in-law') {
    if (A > B) [A, B] = [B, A];
  }
  const key = `${A}|${B}|${T}`;
  if (!map.has(key)) map.set(key, { a: A, b: B, type: T, notes });
};

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
