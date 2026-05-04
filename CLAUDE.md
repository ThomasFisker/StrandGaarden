# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Strandgaarden IS 100-year anniversary photo platform.** Danish-only web app
for ~21 summerhouse-club members to upload, curate and share historical
photos ahead of the anniversary in June 2027. Target: ~500 photos, elderly
audience, large fonts, simple flows.

Stack: AWS CDK (TypeScript) · Cognito · API Gateway HTTP API · Lambda
(Node 22 / ARM64) · DynamoDB single-table · S3 + CloudFront · Vite + React
+ Tiptap.

## Live URLs

- **SPA**: https://d2wq22ivboh02d.cloudfront.net/ — log in with the admin
  user (`thomas.madsen@secondepic.com`, password `Picture1!`) or any user
  created via /admin/users.
- **API**: https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com
- **Custom domain** `jubilaeum.strandgaardenis.dk` — pending DNS
  delegation; when it lands, small additive change.

## Valid house numbers

The Strandgaarden site has 23 houses with **non-contiguous** numbers — no
houses 1, 2, 19, 21 etc. The canonical list (also the UI display order):

```
3 5 7 9 11 13 15 17    (odd, 8 houses)
4 6 8 10 12 14 16 18 20 22 24 26 28 30 32    (even, 15 houses)
```

Defined twice (must stay in sync):
- `infra/lambdas/users-shared.ts` → `VALID_HOUSES` + `isValidHouse(n)`
- `packages/web/src/types.ts` → `HOUSES`

## Implemented (as of 2026-05-04)

Full member → committee → viewer flow plus a multi-stage workflow
(indsamling → frys → public) that the committee can flip from
/admin/fase.

### Infra

- **Stacks (all `eu-west-1`):** Foundation, Ci, Storage, Data, Auth, Api,
  ImagePipeline, Hosting.
- **Auth:** Cognito pool `eu-west-1_wiSTL2jB6`, SRP-only SPA client, three
  groups `admin` / `member` / `viewer`. `preferred_username` stores the
  display name shown in the header.
- **CI/CD:** GitHub Actions OIDC role; **push to `main` runs
  `npm run build -w @strandgaarden/web` then `cdk deploy --all`**. This is
  the only deploy path — local `cdk deploy` is no longer used (running
  both in parallel races on CloudFormation locks; see commits 17c5af4 /
  e4506de aftermath in session transcript).

### Authentication & user lifecycle

- **Cognito password policy:** min 8 chars + at least 1 digit. No
  upper/lower/symbol requirement. (`infra/lib/auth-stack.ts`).
- **Admin user management** (/admin/users): invite + change role + delete
  + rename login name + reset password + assign house number. Inline
  password reset reads the new password aloud (no email; avoids Cognito
  default-sender quota).
- **GDPR consent gate** — `<GdprGate>` blocks every protected route until
  the caller has accepted the current GDPR text version. Records
  `gdprAcceptedAt` + `gdprAcceptedVersion` to the user's `USER#<sub>/META`
  row. Re-fires when an admin bumps the version on /admin/fase.
- **/samtykke page** — any authed user can re-read the current GDPR text
  and see when they accepted it. Linked from the upload page in place of
  the old per-upload consent checkbox.
- **First-login password prompt** — `<FirstLoginPrompt>` rendered inside
  `<GdprGate>` once GDPR is accepted. Voluntary: "Sæt min egen
  adgangskode" (current/new/confirm form → Cognito `ChangePassword`) or
  "Behold den jeg fik". Both paths persist `firstLoginAcked: true` on
  `USER#<sub>/META` via `POST /me/first-login-ack`, so the prompt is
  shown exactly once.
- **/glemt-adgangskode** — public route driving Cognito's
  `ForgotPassword` + `ConfirmForgotPassword`. Two-step page: email →
  6-digit code from Cognito's default sender → new password. Linked
  from the Login page (replacing the old "Kontakt udvalget" hint).
  `accountRecovery: EMAIL_ONLY` is set on the pool.
- **`<ProfileProvider>`** — single source of truth for /me on the client.
  Wraps the entire route tree in `App.tsx`; consumed by GdprGate,
  FirstLoginPrompt, StageBanner, Upload, Mine, GalleryPhoto, Header. One
  /me round trip per protected page load — no duplicates.

### Stage workflow

Singleton CONFIG row holds:
- `stage: 1 | 2 | 3` (default 3)
- `maxBookSlotsPerHouse: number` (default 7)
- `maxHouseTextChars: number` (default 900)
- `gdprText: string` + `gdprVersion: string`

Admins edit at /admin/fase (full form: radio for stage, threshold inputs,
GDPR textarea + "ny version" toggle).

- **Stage 1 — Indsamling.** Members upload to either:
  - Their own assigned house (locked, capped at `maxBookSlotsPerHouse`)
  - A club-wide activity (Sankt Hans, Generalforsamling, …) — picked from
    /activities list.
  Server enforces XOR for non-admins; cap is checked by counting Stage-1
  *priority slots* in the user's house (photos with `attribute_exists(priority)`),
  not every historical photo tagged with that house — pre-Stage-1 uploads
  don't compete for slots.
  Each Stage-1 house upload auto-gets the next free `priority` slot
  1..`maxBookSlotsPerHouse`. Activity uploads carry `priority=null`.
  A soft per-user **50-total** sanity bound applies across all uploads
  (admins exempt).
  Admins keep free-form upload behavior.
- **Stage 2 — Frys.** Non-admin write endpoints (`upload-url`,
  `comments-create`, `removals-create`, `photos-set-help-wanted`,
  `house-text-update`) reject with 423 Locked. `<StageBanner>` renders
  inside `<GdprGate>` above the outlet whenever stage ≠ 3. Forms hide
  themselves on Upload, Mine (helpWanted toggle), GalleryPhoto (comment +
  removal). Admins are exempt — they keep full access during freeze.
- **Stage 3 — Offentlig.** Today's behavior: free upload, gallery open.

### Activities

- /admin/aktiviteter — full CRUD on activity keywords (key, displayName,
  displayOrder).
- `loadActivityNameMap` helper joins `activityKey` → displayName at read
  time in `mine`, `review-list`, `book-list`, `gallery-list`,
  `gallery-detail`. Cards display "Aktivitet: X" when no houses are set.
- Stage-1 activity uploads write `activityKey` to the PHOTO row alongside
  empty `houseNumbers`.

### Mine page — two sections in Stage 1

In Stage 1 for non-admin members, /mine splits into:
- **Mine Hus Billeder** — house photos sorted by `priority` ascending.
  Each card has a copper `#N` badge and ↑ ↓ arrows. Up/down call
  `PATCH /photos/{id}/priority` which TransactWrite-swaps the priority
  values atomically. Disabled at boundaries and during Stage-2 freeze.
- **Andre billeder** — activity uploads (and any pre-Stage-1 photos
  without a priority). Flat list, no badges, no arrows.

In other stages, /mine collapses to a single flat list — no schema
migration, just the UI partition disappearing. The `priority` field
stays on the row forever.

Priority is a **member-only** concept: admins can't set or change it
via the gallery edit pencil. When admin re-tags a photo so it no
longer carries the uploader's own house, `photos-update` REMOVEs the
priority field. The photo then surfaces under "Andre billeder" until
the uploader re-uploads or the admin restores the house.

### House texts (book chapter intros)

- `HOUSETEXT#<n>/META` row per house: body (HTML) + audit fields.
- Members edit their own house's text on /mine via a Tiptap editor with
  three buttons (Overskrift / Fed / Kursiv). Visible-char counter
  (tag-stripped) against `maxHouseTextChars`. Locked when frozen.
- Admin /admin/hustekster — read-only overview of all 23 houses; written
  ones render through DOMPurify (allow-list: p/br/b/strong/i/em/h2),
  unwritten ones show a dashed empty card.
- Server validates length on visible chars; raw-bytes hard limit at 8×
  the cap blocks oversized empty markup.

### Gallery for admins

- /galleri shows the public-published photos to any authed user in
  stage 3. For non-admins in stage 1/2 the gallery is replaced with a
  stage-aware landing ("Vi samler billeder" / "Galleriet er på pause")
  pointing to /mine + /upload.
- Admin "Vis alle billeder" checkbox sends `?all=1` to `gallery-list`
  which skips the `visibilityWeb` filter — book-only photos show up with
  a dark "Kun bog" ribbon.
- Activity filter dropdown alongside year/house/person filters when any
  decided photo carries an `activityKey`.
- /galleri/:id allows admin access to non-published photos so they can
  use the existing edit pencil. /admin/bog cards link "Rediger / se
  detaljer" → /galleri/<id>.
- /admin/bog has a 3-way "Sortér" radio: by ID (default), by house, by
  activity. Headed sections under the chosen view; "Vis kun" dropdown
  scopes to a single house/activity bucket. "Vælg alle" respects the
  current view + filter.

### Existing features (carryover)

- **Image pipeline:** S3 PutObject → sharp Lambda → web 2400px JPEG +
  400px thumbnail + 4×4 blurhash + book-derivative <2 MB → derived
  bucket. EXIF rotation baked in; original GPS/EXIF stripped.
  `Uploaded → In Review` flip; audit row written.
- **Review** (/admin/gennemgang) — In Review queue, web/book checkboxes,
  decision advances to `Decided`.
- **Controlled person list** + admin /admin/personer.
- **Photo short ID** (`ID-00042`) via atomic counter row.
- **Hjælp søges** flag + ribbon + banner.
- **Comments + committee merge** (/admin/kommentarer).
- **GDPR removal requests** + admin queue (/admin/fjernelser); approve
  path writes top-level AUDIT row before scrubbing.
- **Jubilee book export** — admin selects from /admin/bog, downloads
  individual JPEGs or a ZIP via `/book/export`. Exports land under
  `exports/` in the derived bucket with a 7-day lifecycle rule.
- **Unified admin hub** /admin — 9 cards (Fase, Gennemgang, Kommentarer,
  Fjernelser, Bog, Aktiviteter, Personer, Hustekster, Brugere) with
  pending-count badges.
- **Design system "Coastal archival"** — paper / sea / copper / sage,
  Fraunces + Plus Jakarta Sans, eyebrow + display + lede pattern.

### API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | public | Liveness |
| GET | `/whoami` | authed | Echo claims |
| GET | `/me` | authed | Profile incl. `stage`, `houseNumber`, `myHouseSlotsUsed`, `myHouseText`, `firstLoginAcked`, GDPR fields |
| POST | `/me/gdpr-accept` | authed | Record GDPR acceptance |
| POST | `/me/first-login-ack` | authed | Suppress first-login prompt for future logins |
| GET | `/gdpr-text` | authed | Live GDPR text + version |
| POST | `/upload-url` | member/admin | Presigned S3 PUT + PHOTO stub (stage-aware) |
| GET | `/photos/mine` | authed | Caller's own uploads |
| GET | `/photos/review` | admin | In Review queue |
| PATCH | `/photos/{id}/decision` | admin | Set web/book visibility |
| DELETE | `/photos/{id}` | admin | Hard delete (S3 + DDB) |
| PATCH | `/photos/{id}` | admin | Edit metadata |
| PATCH | `/photos/{id}/help-wanted` | uploader/admin | Toggle flag |
| PATCH | `/photos/{id}/priority` | uploader only | Swap priority with neighbour (up/down) |
| POST | `/photos/{id}/comments` | authed | Post comment (pending) |
| GET | `/comments` | admin | Pending comments queue |
| POST | `/photos/{p}/comments/{c}/merge` | admin | Apply merge |
| DELETE | `/photos/{p}/comments/{c}` | admin | Reject |
| POST | `/photos/{id}/removals` | authed | Submit removal request |
| GET | `/removals` | admin | Pending removals |
| POST | `/photos/{p}/removals/{r}/decide` | admin | Approve/reject |
| GET | `/book` | admin | Book-flagged photos |
| POST | `/book/export` | admin | Bundle ZIP |
| GET | `/gallery` | authed | Public list (admin: `?all=1`, `?activity=`) |
| GET | `/gallery/{id}` | authed | Detail (admin can view non-public) |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Invite |
| PATCH | `/users/{u}/groups` | admin | Change role |
| PATCH | `/users/{u}/login-name` | admin | Rename `preferred_username` |
| PATCH | `/users/{u}/house` | admin | Assign house |
| POST | `/users/{u}/password` | admin | Set permanent password |
| DELETE | `/users/{u}` | admin | Delete |
| GET | `/persons` | authed | Person list (autocomplete) |
| POST | `/persons` | admin | Create approved |
| PATCH | `/persons/{slug}` | admin | Rename / approve |
| DELETE | `/persons/{slug}` | admin | Delete + scrub |
| GET | `/config` | admin | Read CONFIG |
| PATCH | `/config` | admin | Update stage/thresholds/GDPR text |
| GET | `/activities` | authed | List activity keywords |
| POST | `/activities` | admin | Create |
| PATCH | `/activities/{key}` | admin | Rename/reorder |
| DELETE | `/activities/{key}` | admin | Delete |
| GET | `/house-texts` | admin | All 23 house texts |
| PATCH | `/house-texts/{house}` | admin or member-of-house | Edit body |

## Deployment flow (push-only)

1. Edit code locally.
2. Type-check both sides:
   - `cd infra && npx tsc --noEmit`
   - `cd packages/web && npx tsc --noEmit`
3. Commit + `git push origin main`. CI runs `cdk deploy --all` (~3 min).
   Verify via the workflow run page or `gh run list` (no `gh` CLI on
   this machine — fall back to the GitHub REST API:
   `curl -sk https://api.github.com/repos/ThomasFisker/StrandGaarden/actions/runs?branch=main&per_page=1`).
4. Hard-refresh the live URL and smoke-test.

**Do NOT run `cdk deploy` locally.** It races CI's deploy on
CloudFormation locks and produces spurious failure emails (see Sample_Pictures/*.eml from the earlier session for the symptom).

## Local dev (no deploy)

For UI-only iteration without deploying:

```
export PATH="/c/Program Files/nodejs:$PATH"
npm run dev -w @strandgaarden/web   # localhost:5173 against the deployed dev API
```

For features that need real photo content, copy a few files from
`Sample_Pictures/` (gitignored) into `packages/web/public/` so Vite
serves them; fetch them from browser JS and feed them through the
/upload-url → S3 PUT path. Delete from `packages/web/public/` after.

DDB / S3 verification via `aws` CLI from
`/c/Program Files/Amazon/AWSCLIV2/aws.exe` with
`AWS_PROFILE=strandgaarden` and `MSYS_NO_PATHCONV=1` for path args.

## Verification convention

- After a deploy, share the URL + a brief smoke-test checklist (the
  user runs it; we don't have headless-browser auth to Cognito).
- For auth flows, document the manual steps explicitly.
- Note when a change isn't browser-observable (backend-only); skip the
  preview step in that case.

## Still to do (priority order)

**Blocking before real member invites:**
1. **Two committee members test-drive the system.** Email draft in
   the earlier session transcript; user creates accounts manually via
   /admin/users and sends the invite.
2. **Approve-path smoke test for GDPR removal.** Reject path is
   browser-tested; approve path (hard-delete) has only been exercised
   via the admin photo-delete button. Upload throwaway, anmod, godkend,
   verify AUDIT row + gone photo.
3. **End-to-end password flow with a real Outlook inbox.** /glemt-
   adgangskode is wired but unverified against Cognito's default email
   sender's deliverability. First send to Outlook commonly lands in
   spam — needs a real run.
4. **Danish help page** "Sådan bruger du siden" — onboarding for
   elderly members. Could use `horizon-meadow.jpg` as backdrop.
5. **SES** for password resets / approval notices / committee emails
   (currently Cognito default sender, ~50/day quota; deliverability
   unverified).
6. **Shared viewer credential** for the committee's shared kigge login
   (one `AdminCreateUser` via /admin/users).

**Should-have fairly early:**
6. Cross-region replication of the originals bucket (locked in the
   architecture).
7. CloudWatch log retention on every Lambda (currently never expire).
8. Merge two persons into one.

**Nice-to-have:** audit log viewer (top-level `PK=AUDIT` items exist),
PWA manifest, blurhash LQIP placeholder render, server-side upload size
limit via `createPresignedPost`, member self-edit of own uploads,
narrow-viewport header overflow, `horizon-meadow.jpg` decoration.

**Ops:** prod stage stacks (`-Prod-*`), CloudWatch alarms, automated
tests. Not urgent.

## Resuming next session

1. `cd "C:/Users/thoma/OneDrive - Second Epic/ClaudeProjects/Strandgaarden"`
2. `git status` — expect clean. Last commit `c0676d9`
   (`fix: Stage-1 house cap counts only priority slots, not all-time
   photos`). All pushed; CI green.
3. Open https://d2wq22ivboh02d.cloudfront.net/ (hard-refresh). Login as
   `thomas.madsen@secondepic.com` / `Picture1!`. Expected current bundle
   hash: **`index-C1HPs0KL.js`**.
4. **Open thread #1 — verify the cap fix.** As Thomas2 (member, house
   9), /upload should show "Til mit hus" enabled with the counter
   reading **"1 af 7 pladser brugt"** (not 7/7). A new house upload
   should succeed and become `#2` on /mine in the "Mine Hus Billeder"
   section. There are 6 pre-Stage-1 photos still tagged with house 9
   that have no `priority` field — they're visible to admin under
   /admin/gennemgang and /galleri but no longer block the cap. They
   live under "Andre billeder" on Thomas2's /mine. Optional cleanup:
   delete them via /admin/gennemgang or /galleri/:id when convenient.
5. **Open thread #2 — first-login password change still untested
   end-to-end.** Self-service /glemt-adgangskode worked. Open thread:
   does the in-prompt "Sæt min egen" form (FirstLoginPrompt) succeed
   when given a real current password + valid new one? Last attempt
   yesterday hit a Cognito "previousPassword" regex error — guards
   landed in `1c6bd64`. Yet untested with a non-empty current.
6. **Open thread #3 — real-Outlook deliverability** of /glemt-
   adgangskode email (Cognito default sender). Was on the to-do list
   yesterday; still open.
7. Quick visual-state check:
   - Header shows `Thomas1` + Galleri + Upload + Mine + Udvalget links.
   - /admin shows 9 cards with badges.
   - /admin/fase loads the stage editor; current stage is **1** (set
     during the session for testing) — flip to 3 if you want the
     "everything open" mode back.
   - /upload shows the GDPR reference note (no checkbox); the house
     selector lists the non-contiguous house numbers (3,5,7…17,
     4,6…32).
   - /mine for a member in Stage 1 shows two sections (Mine Hus
     Billeder + Andre billeder) with priority badges + ↑↓ arrows.
   - /login shows a "Glemt adgangskode?" link.
8. **Recommended next task** order (after the open threads above):
   committee-member invite (Danish draft from earlier session) → real
   user feedback unblocks the rest of the list.
6. If something's broken:
   - API alive: `curl -sk https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com/health`
     (use `-k` on this Windows shell — schannel revocation otherwise fails).
   - Stack statuses: `aws cloudformation list-stacks --profile strandgaarden --region eu-west-1 --query 'StackSummaries[?starts_with(StackName,\`Strandgaarden-\`) && StackStatus!=\`DELETE_COMPLETE\`].{name:StackName,status:StackStatus}'`.
   - Photos stuck in `Uploaded`: pipeline log group is
     `/aws/lambda/strandgaarden-dev-process-image`.
   - CDK synth EPERM on Windows OneDrive: rare now (only if local cdk
     deploy is run); if it happens just retry — `cdk.out/bundling-temp-*`
     rename hitting a file lock.

## Known dev test state

- All 7 early test photos (ID-00001 through ID-00007) were deleted in
  prior sessions. Counter `COUNTER#PHOTOID` at 10+ depending on
  intermediate test uploads.
- Thomas2 (`thomas.f.madsen@outlook.com`) password may still be
  `ResetTest99!` from an earlier reset — verify and rotate before
  real invites.
- Some test photos may have stale house numbers (1, 2, etc.) from before
  the non-contiguous fix landed. Readers don't validate; they just
  display whatever's stored. Edits will force admin to re-pick from the
  new valid set.

Claude will auto-load `CLAUDE.md` (this file) and the
`memory/project_*.md` entries at session start, so the full context is
available without re-briefing.
