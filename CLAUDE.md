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

## Implemented (as of 2026-04-19)

Full end-to-end member → committee → viewer flow.

- **Infra stacks (all in `eu-west-1`):** Foundation, Ci, Storage, Data,
  Auth, Api, ImagePipeline, Hosting.
- **Auth:** Cognito pool `eu-west-1_wiSTL2jB6`, SRP-only SPA client, three
  groups `admin` / `member` / `viewer`. Admin-only user creation via
  /admin/users (invite + change role + delete).
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
- **CI/CD:** GitHub Actions OIDC role; push to `main` runs
  `npm run build -w @strandgaarden/web` then `cdk deploy --all`.

## Still to do (priority order)

**Blocking before real member invites:**
1. **Removal requests (GDPR).** Anyone (auth or not) submits "please remove
   this photo"; flows to committee queue; admin hard-deletes (original +
   derivatives + DDB row + audit).
2. **Admin photo-removal endpoint + UI.** Hard-delete bad uploads from the
   Review page today.
3. **Danish help page** "Sådan bruger du siden".
4. **SES** for password resets / approval notices / committee emails
   (currently Cognito default sender, low quota).
5. **Shared viewer credential.** One-off `AdminCreateUser` via /admin/users
   for the committee's shared viewer login.

**Should-have fairly early:**
6. Bulk ZIP download of `visibilityBook=true` photos for the printed
   catalog.
7. Cross-region replication of the originals bucket (locked in the
   architecture).
8. CloudWatch log retention on every Lambda (currently never expire).
9. Committee can edit photo metadata during review (retag persons, fix
   typos).
10. Merge two persons into one.

**Nice-to-have:** audit log viewer, PWA manifest, blurhash LQIP
placeholder render, enforced server-side upload size limit via
`createPresignedPost`, member self-edit of own uploads, narrow-viewport
header overflow.

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
2. `git status` — should be clean (last commit `de210b7`, Phase 2 hosting).
3. Open https://d2wq22ivboh02d.cloudfront.net/ and smoke-test login. If it
   works, the whole dev environment is reachable.
4. Pick the next item from "Still to do" above. Recommended next pair:
   **admin photo-removal + GDPR removal requests** (both small-to-medium;
   completes the "must-have before invites" list).
5. If something's broken:
   - API alive: `curl https://ajsrhml5fi.execute-api.eu-west-1.amazonaws.com/health`.
   - Stack statuses: `aws cloudformation list-stacks --profile strandgaarden --region eu-west-1 --query 'StackSummaries[?starts_with(StackName,\`Strandgaarden-\`) && StackStatus!=\`DELETE_COMPLETE\`].{name:StackName,status:StackStatus}'`.
   - Any photos stuck in `Uploaded`: the pipeline Lambda log group is
     `/aws/lambda/strandgaarden-dev-process-image`.

Claude will auto-load `CLAUDE.md` (this file) and the
`memory/project_*.md` entries at session start, so the full context is
available without re-briefing.
