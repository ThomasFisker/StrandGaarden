# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Strandgaarden IS 100-year anniversary photo platform.** Danish-only web app
for ~21 summerhouse-club members to upload, curate and share historical
photos ahead of the anniversary in June 2027. Target: ~500 photos, elderly
audience, large fonts, simple flows.

Stack: AWS CDK (TypeScript) · Cognito · API Gateway HTTP API · Lambda
(Node 22 / ARM64) · DynamoDB single-table · S3 + CloudFront · Vite + React.

## Live URLs

- **SPA**: https://d2wq22ivboh02d.cloudfront.net/ — log in with the admin
  user (`thomas.madsen@secondepic.com`, password `Picture1!`) or any user
  created via /admin/users.
- **API**: https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com
- **Custom domain** `jubilaeum.strandgaardenis.dk` — pending DNS
  delegation; when it lands, small additive change.

## Implemented (as of 2026-04-24)

Full end-to-end member → committee → viewer flow with comment,
removal-request, and short-ID features. Editorial "Coastal archival"
design system in place.

- **Infra stacks (all in `eu-west-1`):** Foundation, Ci, Storage, Data,
  Auth, Api, ImagePipeline, Hosting.
- **Auth:** Cognito pool `eu-west-1_wiSTL2jB6`, SRP-only SPA client, three
  groups `admin` / `member` / `viewer`. Admin-only user creation via
  /admin/users (invite + change role + delete + **rename login name** +
  **reset password**).
- **Login name (display only):** Every user has a `preferred_username`
  attribute that the header shows instead of the email (e.g. "Thomas1").
  Login still uses email. Existing two users backfilled as `Thomas1` (the
  admin) and `Thomas2` (`thomas.f.madsen@outlook.com`) via
  `AdminUpdateUserAttributes`. No Auth stack schema change needed —
  `preferred_username` is a built-in Cognito standard attribute.
- **Admin password reset:** `POST /users/{username}/password` →
  `AdminSetUserPassword` with `Permanent: true`. Inline panel under the
  user row: password input → Gem → green confirmation with Luk button.
  Admin reads the new password out to the member verbally; no email
  involved (avoids Cognito default-sender quota).
- **Design system ("Coastal archival"):** Paper / sea / copper / sage
  palette in `packages/web/src/styles.css`. Fraunces variable serif
  (italic + opsz/SOFT axes) + Plus Jakarta Sans loaded from Google Fonts
  in `packages/web/index.html`. Two background photos copied from
  `Inbox/` to `packages/web/public/bg/` — `hero-beach.jpg` used on the
  Login split-hero, `horizon-meadow.jpg` still unused (candidate for
  404/help atmosphere). All pages adopted the eyebrow + Fraunces display
  h1 + lede pattern; Gallery has editorial filters strip + asymmetric
  tile grid (feature tiles 16:9 on 4-col); Photo-detail has paper frame
  with copper hairline + giant year in Fraunces. The old
  `design-preview/` mockups remain on disk as reference only.
- **Upload flow:** member form with file (JPEG/PNG/TIFF/HEIC, ≤100 MB),
  beskrivelse, hvem er på billedet (free text), year + "ca." flag,
  houses 1–23, consent, and controlled person tags (approved or proposed).
- **Image pipeline:** S3 PutObject → sharp Lambda → web 2400px JPEG + 400px
  thumbnail + 4×4 blurhash → derived bucket; EXIF-based rotation baked in;
  original GPS/EXIF stripped from derivatives; DDB row flips
  `Uploaded → In Review`; audit row written.
- **Review UI (admin):** queue of In Review photos with 200×200 thumbs
  linking to the web JPEG; two checkboxes (web/book) + "Gem beslutning"
  advances to `Decided` with visibility flags + audit row.
- **Gallery (any authed user):** thumbnail grid of Decided + visibilityWeb
  photos, filters by year / house / person; detail page with full web JPEG,
  clickable approved-person chips, and a presigned download URL.
- **Controlled person list:** approved + pending PERSON rows; member
  autocomplete at upload, admin CRUD at /admin/personer (godkend, afvis,
  omdøb, slet). Delete scrubs the slug from every tagged photo first.
- **Admin photo delete (Review page):** `DELETE /photos/{id}` — scrubs
  original + web + thumb from S3 and every DDB row under `PHOTO#<id>`.
  Red "Slet billede" button per review card with inline confirm panel.
- **Hjælp søges flag:** boolean on PHOTO META. Uploader checkbox at
  upload ("Jeg kender ikke alle på billedet"); uploader/admin toggle on
  /mine + /review; copper corner ribbon on Gallery tiles + warm banner
  on photo detail. `PATCH /photos/{id}/help-wanted` (uploader or admin).
- **Viewer comments + committee merge:** COMMENT item under
  `PHOTO#<id>`, status pending/merged/shown/rejected. Any authed user
  posts via the inline card on the detail page. Admin queue at
  /admin/kommentarer with three actions per comment: **Flet ind i
  beskrivelsen** (editor with current description + persons prefilled,
  full PersonTagInput), **Vis som tilføjelse** (renders as attributed
  addendum on the detail page with italic Fraunces "— Thomas1, apr.
  2026"), or **Afvis** (hard-delete). Pending comments live in a
  dedicated GSI1 partition `COMMENTSTATUS#pending`.
- **Photo short ID (ID-00042):** atomic counter item
  (`COUNTER#PHOTOID`, `ADD nextId :1`) assigned at upload time; existing
  photos backfilled 1..7 by createdAt via
  `infra/scripts/backfill-short-ids.ts`. Displayed as copper monospace
  badge on detail + Mine + Review + admin-comments + admin-removals.
  `formatShortId(n)` helper in types.ts pads to 5 digits.
- **GDPR removal requests:** REMOVAL item under `PHOTO#<id>`, GSI1
  partition `REMOVALSTATUS#pending`. Any authed user anmoder via
  inline form on gallery detail (reason required). Admin queue at
  /admin/fjernelser with **Godkend — slet for altid** (writes
  top-level AUDIT row with requestor/approver/reason/decisionNote/
  shortId BEFORE the S3 + DDB scrub, so the audit survives the
  photo) or **Afvis** (keeps photo, flips status, drops from pending
  partition). Single-admin approve, no notification (committee
  handles comms directly).
- **CI/CD:** GitHub Actions OIDC role; push to `main` runs
  `npm run build -w @strandgaarden/web` then `cdk deploy --all`.

## Still to do (priority order)

Working tree is clean (all committed + deployed + pushed). Current HEAD is
`4bd368a` on `main`; CI green on that sha.

Latest shipped in this session:
- **Committee inline edit** (`6a4f99f`) — admins click a pencil on
  any gallery-detail page to edit description, whoInPhoto, year,
  houses, and tagged persons. Full before/after audit row written.
  PATCH /photos/{id} via photos-update Lambda.
- **Jubilee book export** (`e6a77cb`) — process-image now makes a
  third derivative `book/<id>.jpg` <2 MB via a quality ladder,
  admins select photos at /admin/bog and download individual JPEGs
  or a ZIP (via book-export Lambda). Exports land in `exports/`
  with a 7-day S3 lifecycle rule.
- **Unified admin hub** (`4bd368a`) — 5 admin nav links replaced
  with a single "Udvalget" link → /admin hub page showing 6 cards
  (Gennemgang, Kommentarer, Fjernelser, Bog, Personer, Brugere)
  each with a live pending-count badge.
- **Short-ID badge on gallery tiles** (`b070ef0`) — small UI polish.

**Blocking before real member invites:**
1. **Two committee members test-drive the system.** Email draft in
   the session transcript; user creates their accounts manually via
   /admin/users and sends the invite. Goal: catch UX issues before
   opening to all 21 members.
2. **Danish help page** "Sådan bruger du siden".
3. **SES** for password resets / approval notices / committee emails
   (currently Cognito default sender, low quota).
4. **Shared viewer credential.** One-off `AdminCreateUser` via /admin/users
   for the committee's shared viewer login.
5. **Approve-path smoke test for GDPR removal.** Reject path is
   browser-tested; approve-path (hard-delete) has been exercised only
   via the admin photo-delete button (same code). Upload a throwaway
   photo, submit a removal request, approve it, verify AUDIT row +
   gone photo. Skipped today to avoid nuking the shared test photo.

**Should-have fairly early:**
6. Cross-region replication of the originals bucket (locked in the
   architecture).
7. CloudWatch log retention on every Lambda (currently never expire).
8. Merge two persons into one.

**Nice-to-have:** audit log viewer (top-level `PK=AUDIT` items now
exist from the GDPR flow), PWA manifest, blurhash LQIP placeholder
render, enforced server-side upload size limit via `createPresignedPost`,
member self-edit of own uploads, narrow-viewport header overflow, use
`horizon-meadow.jpg` as a decorative backdrop somewhere (404, help
page, empty-gallery state).

**Ops:** prod stage stacks (`-Prod-*`), CloudWatch alarms, automated
tests. Not urgent.

See memory `project_bootstrap_state.md` for the deployed-state snapshot.

## Test method in use

Each increment is built, deployed, and verified in a real browser before
commit+push. No automated test suite exists — manual preview-browser
verification is the sole test strategy for now.

**Local flow:**

1. `npm install` at repo root (workspaces: `infra`, `packages/web`).
2. Edit code. Type-check both sides:
   - `cd infra && npx tsc --noEmit`
   - `cd packages/web && npx tsc --noEmit`
3. Deploy affected stacks locally (for infra changes):
   ```
   cd infra
   AWS_PROFILE=strandgaarden AWS_REGION=eu-west-1 npx cdk deploy <stack> --require-approval never
   ```
4. Run the SPA against the deployed dev backend:
   ```
   npm run build -w @strandgaarden/web   # for hosting-stack redeploys
   npm run dev   -w @strandgaarden/web   # for local edits on localhost:5173
   ```
5. Exercise the new path in the browser. For committee/admin paths, log in
   as `thomas.madsen@secondepic.com` / `Picture1!`.
6. For features that need real photo content, copy a few files from
   `Sample_Pictures/` (gitignored) into `packages/web/public/` so Vite
   serves them; fetch them from browser JS and feed them through the
   /upload-url → S3 PUT path. Delete from `packages/web/public/` after.
7. Clean up test photos afterward: `AWS_PROFILE=strandgaarden aws dynamodb
   delete-item ... PHOTO#<id>/META` + matching `s3api delete-object` for
   originals/web/thumb keys + audit rows.

**Claude-driven verification inside these sessions:**

- Preview tool starts Vite via `.claude/launch.json` (`node
  node_modules/vite/bin/vite.js packages/web --port 5173`).
- Browser automation via `mcp__Claude_Preview__preview_*` (screenshot,
  snapshot, fill, click, eval). `Claude_in_Chrome` is used for real
  deployed URLs when available.
- DDB / S3 verification via `aws` CLI from `/c/Program Files/Amazon/AWSCLIV2/aws.exe`
  with `AWS_PROFILE=strandgaarden` and `MSYS_NO_PATHCONV=1` for path args.
- Node / npm live at `/c/Program Files/nodejs/` — not on PATH by default,
  so `export PATH="/c/Program Files/nodejs:$PATH"` in bash commands.

## Resuming tomorrow

1. `cd "C:/Users/thoma/OneDrive - Second Epic/ClaudeProjects/Strandgaarden"`
2. `git status` — expect clean. Last commit `4bd368a`
   (`feat: unified admin hub page — Udvalget`). Previous session
   shipped 4 commits: short-ID tile badge, committee inline edit,
   jubilee book export, admin hub page. All pushed; CI green.
3. Open https://d2wq22ivboh02d.cloudfront.net/ (hard-refresh if the
   cached bundle is stale) and smoke-test login as
   `thomas.madsen@secondepic.com` / `Picture1!`. Header should show
   `Thomas1` + a single "Udvalget" admin link. Clicking "Udvalget"
   lands on /admin with 6 cards (Gennemgang / Kommentarer /
   Fjernelser / Bog / Personer / Brugere) — each with a live
   pending-count badge. Gallery tiles should show a copper ID-XXXXX
   badge top-right. Expected current bundle hash is `index-yqcpcC_Y.js`.
4. **Recommended next task:** the committee-member invite email. A
   Danish draft is in the previous session's transcript (problem →
   hvad systemet gør → opfordring + link). User wants to create their
   accounts manually at /admin/users and send. Rest of the Still-to-do
   list (help page, SES, shared viewer credential, etc.) can wait
   until after the two testers have kicked the tires.
5. **Known test-state on dev (not a blocker, just awareness):**
   - All 7 early test photos (ID-00001 through ID-00007) were
     deleted during this session's cleanup, including the
     `a04b87ce-…` photo that had a test-merged description.
     Only shortIds 9 and 10 remain. Book derivatives
     (`book/<id>.jpg`) exist for those two.
   - Thomas2 (`thomas.f.madsen@outlook.com`) still has password
     `ResetTest99!` from an earlier smoke test — delete or reset
     before the real invites go out.
   - Counter `COUNTER#PHOTOID` is at 10; next upload becomes ID-00011.
6. If something's broken:
   - API alive: `curl -sk https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com/health`
     (use `-k` on this Windows shell — schannel revocation check otherwise fails).
   - Stack statuses: `aws cloudformation list-stacks --profile strandgaarden --region eu-west-1 --query 'StackSummaries[?starts_with(StackName,\`Strandgaarden-\`) && StackStatus!=\`DELETE_COMPLETE\`].{name:StackName,status:StackStatus}'`.
   - Any photos stuck in `Uploaded`: the pipeline Lambda log group is
     `/aws/lambda/strandgaarden-dev-process-image`.
   - CDK synth EPERM on Windows OneDrive: transient, just retry the
     `cdk deploy` — it's the `cdk.out/bundling-temp-*` rename hitting
     a file lock.

Claude will auto-load `CLAUDE.md` (this file) and the
`memory/project_*.md` entries at session start, so the full context is
available without re-briefing.

Add as a new ## Deployment & Verification section near the end of CLAUDE.md\n\n## Deployment & Verification
- After deploying to a public URL, always provide the URL and a brief smoke-test checklist
- For auth flows (Cognito SRP, OAuth), note when browser-based verification is required and document manual steps the user must run
- When git push requires interactive browser auth, stop and hand off to the user with the exact command to run
Add as a new ## Environment Setup section at the top of CLAUDE.md\n\n## Environment Setup
- Before running Node/npm commands, verify PATH with `which node` and `node --version`
- If a newly installed tool isn't found, source shell config or use absolute paths
- For Python document generation (DOCX/PDF), always validate the output file opens correctly before declaring done
Add as a new ## Notion Integration section\n\n## Notion Integration
- When populating Notion pages, reconstruct from local memory/context files first, then write
- Use the MCP Notion tools (notion-create-pages) rather than manual API calls
- Confirm page IDs before writing to avoid overwriting wrong pages
