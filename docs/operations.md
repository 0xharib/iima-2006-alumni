# Operations and data handling

The application runs as a Cloudflare Worker. D1 holds roster and app records. R2 holds original photos and cached responsive thumbnails. The Worker checks access before serving private media. The Images binding generates thumbnails when available.

## Deployment configuration

Cloudflare’s Git integration deploys main with the production `wrangler.toml`. For local commands use `--config wrangler.local.toml`. Use a separate configuration for any other hosted environment. Fill in its own D1 database, R2 bucket, and application origin. Configure `MAIL_FROM` and `SITE_ORIGIN` for the intended environment and supply `RESEND_API_KEY` as a Worker secret. Keep database exports, member records, photos, local environment files, and credentials out of Git. Use dedicated test addresses and verify the sender domain and its DNS authentication before enabling mail.

`ACCESS_MODE=pilot` restricts entry to invited members and admins. `ACCESS_MODE=batch` lets eligible roster members sign in with the unique address on file. Sending the link to a small group in batch mode limits invitations only.

## Database changes

New local databases can apply the checked-in migrations in order. Existing environments may have had earlier migrations applied directly. Inspect the database and its migration history, back it up, and reconcile applied changes before running the migration runner against a hosted environment.

`0002_publish_imports.sql` is a historical data migration. It creates published profiles and memories from legacy rows and approves pending seeds. Review changes against an isolated copy first if a target contains any unpublished data. Treat legacy submissions and enrichment sources as distinct from owner edits. Profile pages resolve owner edits ahead of published yearbook data and selected enrichment. An explicitly blank owner value hides a fallback.

`0014_meet_wishes.sql` adds the "Looking forward to meeting" table. It only creates a table and an index, so it is safe to run on its own against production: `npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0014_meet_wishes.sql`. Until it runs, the Worker hides the feature rather than failing.

## WhatsApp story

WhatsApp Insights require a signed-in member with all seven profile requirements complete: dorm number, dorm name, current city, Life, Lately, family, a Then photo and a Now photo. Home, the owner profile and the locked Insights page show a checklist. Both story pages and all `/wa/api/` endpoints enforce this on the server; no admin bypass is applied. Existing published profile values and Then/Now photos count; explicit blank owner text values override imported values. Optional prompts are not required.

`/wa/` shows each signed-in classmate their own WhatsApp story. `/wa/batch` is the batch story. It is not in any menu; personal pages link to it. Both come from the batch WhatsApp pipeline's microsite kit, which holds every batchmate's personal data. The kit lives only in R2 under `whatsapp-v1/` and must never be committed. Load or refresh it from an unzipped kit:

```sh
tools/import-whatsapp.sh path/to/iima06-whatsapp-microsite-kit --remote
```

The script uploads people files first and the login index last, and skips `organiser/` and `data/pages/`. Until a kit is loaded, `/wa/` says the story isn't up yet.

- A classmate is matched to their story by the emails in `reminder_contacts`, then the numbers in `reminder_mobiles` (normalised to E.164), against the kit's `data/index.json`. The person id always comes from the session. Admins can preview anyone with `/wa/?person=P123`.
- Classmates with fewer than 30 messages (`QUIET_BELOW` in `whatsapp.mjs`), including those who never posted, get a short page of their own ("You're a quiet one…") with a link to the batch story. So do classmates who weren't in the group, can't be matched, or opted out, each with their own wording.
- The Worker reskins the kit pages as it serves them: site fonts instead of Google Fonts, site colours in both themes, the validated chart palette, and the site's bar. It adds a per-response nonce for their inline scripts. Responses are `private, no-store` and `noindex`.

## Theme

Pages are dark unless the visitor chooses light. The choice is a `theme` cookie, set by `POST /theme`, and the Worker flips `data-theme` on the `<html>` element before sending the page.

## Pilot checks

- Request a link to a test address, check Inbox and Junk, open the link once, and confirm that signing out invalidates the session.
- On a phone, check profile and Then / Now uploads, album creation, and a photo mention.
- Confirm that a notification opens the relevant photo or comment, and that only admins can open the admin dashboard and exports.
- Check the reunion form for a confirmed attendee and for an account without a confirmed RSVP.
- Check Admin View coverage and the analytics dashboard. Email acceptance indicates that the provider accepted the send request. Verify inbox placement separately.


## Catch-up requests and persistent notifications

Apply `0015_catchup_notifications.sql` once, followed by `0016_notification_history.sql`, before deploying the catch-up acceptance UI. Migration 0015 preserves notification IDs and read flags while extending event kinds, adds stable request IDs and acceptance timestamps, and turns existing picks into notified requests. Database triggers enqueue one request alert and one acceptance alert per request, including for roster members who have not created an account. Only the recipient may accept an exact request ID. Retrying is idempotent; withdrawn requests cannot be accepted through old links. Read and withdrawn events remain in history.

Migration 0016 backfills genuine historical likes, comments and mentions using the same deduplication keys as live events. It is safe to rerun; existing read flags remain unchanged. The actor of a historical tag edit is left unknown rather than attributed to the wrong person. Legacy events use the associated memory timestamp when their exact event time was not recorded. Signing in does not delete notifications or mark them read. The notification bell counts unread events; the inbox shows the latest 100 by timestamp with Accept request controls. Owners can also accept from Requests received on their profile. Catch-up request recipients now see the sender’s name; the previous anonymous-count behavior has been replaced.


## Mobile navigation

`navigation.mjs` owns the shared five-tab mobile bar and its styles. It is a direct child of the body on both main-site and reskinned WhatsApp pages, outside sticky headers and content containers. Keep its dimensions and safe-area padding in this shared module. The desktop menu remains in the header. At phone widths, full-width main containers must not also have horizontal outer margins: that creates a horizontal scrollbar which reduces the usable viewport and shifts fixed navigation.


## Memories completion prompt

Home and Memories wrap the real memory feed in a blurred, inert preview until the same seven profile requirements as WhatsApp Insights are complete. The overlay shows completion progress, missing items and a Complete my profile action. This is deliberately a visual completion incentive: memory details, media, notifications and feed endpoints retain their existing signed-in access. The preview disables interaction and automatic infinite-feed loading within the blurred area. Completing the profile removes the treatment on the next page load. WhatsApp Insights retains its server-enforced completion requirement.


## Completion focus and catch-up masking

Incomplete profiles continue to show their incoming catch-up count and can send requests. Incoming request identities, photos and acceptance controls stay masked on profiles and in Notifications until all seven profile requirements are complete. Acceptance also checks completion on the server. Notifications remain stored and reveal normally after completion.

On an owner profile, the checklist links target stable `profile-field-*` anchors. Clicking an Add link opens the enclosing details panels, opens the exact field editor and focuses its input; photo links focus the corresponding visible upload button. Missing required fields/photos have a Required to unlock badge, while optional missing details are grouped separately. Profile headshots, company, education and optional questions are explicitly excluded from the completion rule.


## Profile and footer cleanup

Owner profiles use one compact completion summary with missing-item links and a single Continue profile action. The full seven-item checklist is collapsed under All 7 requirements. The masked catch-up section links back to this summary rather than repeating its own completion button. On mobile, missing required details appear before Then/Now photos; catch-up and optional details follow. Home no longer repeats a separate WhatsApp completion banner above the memories incentive. Own profiles omit the self-report control. The footer now contains branding and the theme switch only, since the main header and persistent mobile bar already provide navigation.


## Sign-out behavior

The server removes the session and expires the cookie. It returns a small confirmation to JavaScript clients or redirects for native form submissions; it does not request a browser-wide cache clear. The client waits up to eight seconds for confirmation, then replaces the page with the signed-out sign-in screen. A failed or timed-out request restores the Log out button and shows a retry message. Profile life text is visibly headed Life, Lately, matching the checklist and editor labels.


## Reunion browsing

Reunion attendees use two compact square-thumbnail cards per mobile row with responsive 256/480/768px image candidates. Personal reunion details are collapsed when the existing completeness rules are satisfied, and stay open when required details are missing or after a save. The review link and child/detail fragment links reopen the accordion. The agenda is a compact expandable section near the top, before personal details and the attendee list.


## Performance: completion summary, lightweight actions and in-place profile saves

**Migration 0018 (`0018_completion_summary.sql`).** Adds `profile_completion_state`, one row per roster member with current public and pilot completeness plus the city and Life, Lately shown on Home. Triggers on `profile_fields` (only dorm, nickname, city, life, family and the Then/Now photo fields), `yearbook_public`, `profile_seeds`, `roster` and legacy `photos` recompute just the changed member, in the same transaction as the write, through `profile_completion_refresh`. They replace the 0017 triggers, which evaluated the whole-roster view on every profile write. `profile_completion` keeps its meaning: the first public completion is recorded once and later edits, blank overrides or incomplete/recomplete cycles never move it. All writes inside triggers use explicit UPSERT clauses, so an outer `INSERT OR REPLACE` cannot replace history.

The migration is additive and safe to rerun. It backfills every roster member once without recording history; a currently complete profile with no history row gets `basis='baseline'` (unknown date), never a new completion date. The current production Worker works unchanged against the migrated schema, and the new Worker falls back to the old query if the table is missing.

Apply it before deploying the new code, after noting a restore point:

```sh
npx wrangler d1 time-travel info iima-2006-alumni          # note the bookmark
npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0018_completion_summary.sql
npx wrangler d1 execute iima-2006-alumni --remote --command "SELECT count(*) AS members, sum(complete_public) AS complete FROM profile_completion_state"
```

The member count should equal the roster size, and the complete count should equal the number of profiles the current Home logic treats as complete.

To return to the 0017 triggers without restoring the database, drop the new triggers and rerun 0017 (it only recreates missing triggers and inserts baseline rows that do not exist):

```sh
npx wrangler d1 execute iima-2006-alumni --remote --command "DROP TRIGGER IF EXISTS profile_completion_refresh_apply; DROP TRIGGER IF EXISTS completion_summary_profile_fields_insert; DROP TRIGGER IF EXISTS completion_summary_profile_fields_update; DROP TRIGGER IF EXISTS completion_summary_profile_fields_delete; DROP TRIGGER IF EXISTS completion_summary_yearbook_insert; DROP TRIGGER IF EXISTS completion_summary_yearbook_update; DROP TRIGGER IF EXISTS completion_summary_yearbook_delete; DROP TRIGGER IF EXISTS completion_summary_roster_insert; DROP TRIGGER IF EXISTS completion_summary_roster_update; DROP TRIGGER IF EXISTS completion_summary_seeds_insert; DROP TRIGGER IF EXISTS completion_summary_seeds_update; DROP TRIGGER IF EXISTS completion_summary_seeds_delete; DROP TRIGGER IF EXISTS completion_summary_photos_insert; DROP TRIGGER IF EXISTS completion_summary_photos_update; DROP TRIGGER IF EXISTS completion_summary_photos_delete"
npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0017_profile_completion.sql
```

Do this only after rolling the Worker back too; the new Worker reads `profile_completion_state`, which would stop updating.

**Page chrome.** The header avatar and unread count load only when an HTML page is rendered for a signed-in GET (started early when the browser asks for HTML). JSON panels, fragments and actions skip them.

**Memory actions.** Likes, comments, comment edits/deletes, tag accept/remove, unassociate, edit and delete check one authorized, visible post rather than loading the full memory card. A like answers `{liked,likes}` from a single count query. The comments panel reads only comments. Tag-add still loads the full card because it validates photo scope and returns rendered tags.

**Profile editor.** With JavaScript, `/profile` saves with `Accept: application/json` and receives `{saved, profile, checks, complete, missing, photos, lifeGenerated, name}`; the editor updates in place and the member stays on the editor with a link to their profile. Without JavaScript the form still redirects to the profile. Then/Now preview URLs carry `&v=` derived from the stored object key, so a replacement is shown at once; existing media cache headers are unchanged.

**Cache invalidation.** `social.js` is versioned in the page (`?v=21`) and cached for five minutes, so browsers pick up the new editor script on their next page load after deploy. No HTML is cached publicly.

**Measuring.** `node tools/perf-bench.mjs [roster] [posts] [runs]` builds an in-memory synthetic roster and reports top-level SQL statements, time and payload per route. It never contacts Cloudflare or production data.

**Shared stylesheet.** The site theme, fonts and navigation styles are served at `/styles/site-<hash>.css`, where the hash is computed from the stylesheet text when the Worker loads. The current URL is cached `public, max-age=31536000, immutable`; any older hashed URL returns current styles with a five-minute cache, so pages rendered just before a deploy are never unstyled. HTML remains `private, no-store`. CSP `style-src` allows `'self'` alongside the existing inline allowance. Sign-in and WhatsApp pages keep their own inline styles.

**Classmates directory.** `/people` renders 30 cards at a time, in the same order as before (published yearbook entry 2, memories by others 2, portrait 1, then name), with the total count above the grid. "Show more classmates" is a keyset link (`after=<rank>-<id>`) that JavaScript turns into an in-place append via `fragment=1`; it works as a plain link without JavaScript. Filters carry into the next page. The "memories by others" set is computed once per request rather than per classmate. `/reunion` still lists every attendee, sorted by catch-up state.

## Performance, part 2: memory cards, photo sizes and browser requests

No migration is needed for this release.

**Memory card tags.** Card tag labels are built from each memory's own subject, person/topic links and accepted tags instead of testing every classmate and topic per card. Results are identical; card queries are roughly 15× cheaper, which matters most on profiles and the gallery (100 cards).

**Photo sizes.** Responsive sizes are still stored in R2 under `variants/webp-v1/<width>/<original key>`. A newly requested size is returned as soon as it is generated and stored afterwards (`waitUntil`). Concurrent requests for the same new size in one isolate share a single transformation. If a size would not be smaller than the original, an empty marker object is stored under `variants/webp-v1-original/<width>/<original key>` (never at the variant key, which older Worker versions would serve as an image) and the original is served from then on, without re-attempting the transformation. Right after upload, memory photos get 480 and 1200 px and profile photos get 96, 256 and 480 px in the background. Originals are never changed or removed by this. Deleting a stored variant or marker is always safe: it is regenerated on the next request. Rolling the Worker back needs no R2 cleanup. Media authorization and cache headers are unchanged.

**Browser requests.** `social.js` (now `?v=24`) routes likes, comments, tags, the comments panel, infinite memory loading, photo uploads, publishing and tag search through one helper with a per-request deadline and readable errors, including a sign-in message when a session has expired. Nothing is retried automatically. Photo uploads and publishing use stable ids, so pressing again after an unconfirmed attempt never duplicates a memory or photo.


## Face tagging

Batchmates who say yes are found in memory photos and tagged automatically. Each photo is sent to a face service
(`face-service/`, InsightFace in a Cloudflare Container), every face's embedding is kept in D1, and faces are compared
with the member's own profile photos (portrait, Then, Now) and their 2006 yearbook portrait. A match scoring 0.35 or
more (`FACE_BAR` in `faces.mjs`) becomes a photo tag with `origin='auto'`. Design and test results:
`docs/superpowers/specs/2026-11-25-face-tagging-design.md`, changed by `2026-11-26-face-tagging-batch-design.md`.

**Modes.** `FACE_TAGGING` is set as a variable on the Worker in the Cloudflare dashboard, not in
`wrangler.toml`; `keep_vars = true` keeps it across deploys, and unset means `off`.
- `off`: nothing is scanned, queued or shown.
- `shadow`: photos are scanned and matched, but nobody is tagged or notified. Admins see the would-be tags at
  `/admin/faces`, lowest scores first.
- `on`: matches become tags, and each person gets one "We found you in N photos" notification per batch.

**Who is matched.** Every member who has uploaded their own profile picture; nobody is asked. Their Then/Now photos
and their approved seed portrait are used as extra reference faces. "Not me" on a photo removes that tag for good and
is the only control.

**The 2006 group** (`docs/superpowers/specs/2026-11-27-face-refs-2006-design.md`). Members without a profile picture
are matched through 2006 photos only while `FACE_TAGGING_2006` (off | shadow | on, set in the dashboard like
`FACE_TAGGING`; unset means off) allows it. It never goes further than `FACE_TAGGING`. Their references are:
- `tagged`: a photo tagged by hand that has exactly one face (80 px or more) and one person tag, such as the Placecom
  album. Tagging someone by hand marks their references for a rebuild.
- `archive`: their face from the iimages 2006 yearbook PDF, imported once into `face_archive` (see below).
- the approved seed portrait.
A match through a `tagged` or `archive` reference needs 0.40 (`FACE_BAR_2006`), not 0.35.
Every member's references must agree with each other (0.30 or more against at least one other); the ones that don't
are left out and listed under "Reference photos left out" on `/admin/faces`. In shadow, the group's matches are marked
"2006" on that page and **Publish** leaves them alone. Members who cannot be matched see "Add a profile picture to be
found in batch photos" on Home. Anyone no longer eligible (no profile picture, and the 2006 group off) loses their
references and automatic tags at the next batch (Not me and manual tags stay).

**Setting up the 2006 group (once).**
1. After this Worker is deployed: `npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0021_face_refs_2006.sql`.
2. Import the yearbook PDF faces: `npx wrangler d1 execute iima-2006-alumni --remote --file face-archive-2006.sql`.
   That file is kept outside this repository (it holds face data); it was generated offline with the same model and
   pipeline as `face-service/app.py`.
3. Set `FACE_TAGGING_2006=shadow`. After the next batch's finish job, check the "2006" shadow matches and the left-out
   reference photos at `/admin/faces`.
4. Set `FACE_TAGGING_2006=on` and press **Publish**.

**The batch.** Nothing happens when a memory is posted or a profile photo is saved (saving only marks the member's
references for a rebuild). Every 3 hours (cron `17 */3 * * *`, at 05:47, 08:47, 11:47 … 02:47 IST) the Worker:
1. removes the references and automatic tags of anyone no longer eligible;
2. queues photos not yet scanned (and failed ones; see below), up to 500;
3. queues reference rebuilds for eligible members who are new, changed a profile photo or were tagged by hand, up to 100;
4. queues one finish job, delayed 40 minutes: it matches everyone rebuilt in the last 6 hours against every stored
   face, then sends each person one summary notification. Your own uploads are tagged but not counted.
**Scan all photos now** on `/admin/faces` runs the same batch at once, with up to 5,000 photos and reference rebuilds
for everyone who needs one (the 3-hour batch takes 100 people at a time). The finish job re-matches everyone rebuilt
in the last 6 hours, 100 at a time, up to 600 per run.

**One-time setup (Arun), in this order.** The order matters: Workers deployed before this one insert into
`photo_tags` without column names, so the migration must come *after* this Worker is live. This Worker works with or
without the migration; until it has run, face tagging stays hidden.
1. Create the queues: `npx wrangler queues create face-jobs` and `npx wrangler queues create face-jobs-dlq`.
2. Merge. The Git integration runs `npx wrangler deploy`, which also builds `face-service/Dockerfile` (pip install
   plus a ~190 MB model download) and rolls out the container. Check the build log for the image step.
3. Back up D1, then add the tables:
   `npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0019_face_tagging.sql`.
4. Set `FACE_TAGGING=shadow` in the dashboard.
5. At `/admin/faces`, press **Scan all photos now** (the next batch would get there too). Check a sample of the
   shadow matches after the finish job has run (40 minutes).
6. Set `FACE_TAGGING=on`, then press **Publish**. Each member gets one "We found you in N photos". From then on the
   3-hour batch does the rest.

If a face job fails (for example while the container is still starting) it is retried; after five tries photos are
marked failed. The batch retries a failed photo, and a member with a profile picture but no usable reference face,
once a day and three times at most (until a profile photo changes), so nothing keeps waking the container. Posting is never affected.
Photos over 15 MB are shrunk to 1600 px with Cloudflare Images before matching. A photo the face service cannot read is
marked skipped and is not retried.

**Staging.** Workers that contain a Durable Object get no preview URLs from `wrangler versions upload`. If the staging
Worker deploys from this `wrangler.toml`, it now needs its own queues too; otherwise leave `FACE_TAGGING` unset there.

**Running costs.** The container (`standard-2`, one vCPU; at most 2 instances, at most 2 jobs at a time) starts when
a batch has work and stops after one idle minute (memory is billed while it runs; the cost is a 10–30 s cold start for the
first photo after a quiet spell). Each container analyses one photo at a time, a few seconds each, which is
within the usage included in Workers Paid for a few thousand photos a month.

**Licence.** The InsightFace `buffalo_l` models are licensed for non-commercial research use; Hari has taken
responsibility for that question. The models are downloaded when the image is built and are never committed.

**Local development.** Run the service with the models unpacked locally:
`cd face-service && FACE_MODELS=/path/to/buffalo_l PORT=8080 python3 app.py`, and start the Worker with
`FACE_SERVICE_URL=http://localhost:8080` and `FACE_TAGGING=shadow` in `.dev.vars`. `wrangler.local.toml` has no queue, so
photos are only scanned locally if you copy the two queue blocks from `wrangler.toml` into it. Tests:
`cd face-service && python3 -m unittest` (add `FACE_MODELS=…` to include the model check).

## 300-photo album preview

`preview/album-300-editor` is a preview-only release. Use `wrangler.preview.toml` for the isolated `iima-album-preview` Worker, D1 database and R2 bucket. The production config, main branch, database and media are unchanged. This public QA sandbox contains synthetic classmates only; `PREVIEW_DEMO=1` lets visitors try either test account through `/preview-demo`. Never enable that flag on an environment holding real member data. Sign-in email and scheduled face processing are disabled in this sandbox.

Apply migration `0020_album_editing.sql` to the target database before deploying this code. It adds indexed removal markers, active-photo/tag/face views, and an atomic version guard. It neither deletes nor reassigns existing originals or interactions. A removed photo stops appearing in media, profile galleries, tag projections and face jobs. Likes, comments, remaining tags and face IDs retain their original identities. Removed originals and historical tags remain stored; no storage cleanup is performed by album editing.

Owners can edit an uploaded memory's caption/title, append photos, select a cover, reorder with Move earlier/later, and select multiple photos for removal. Imported legacy yearbook photos keep their existing editing behavior. New and edited albums accept 1–300 distinct JPEG/PNG photos, 15 MB per file; text-only memories remain supported. Album editing rejects stale saves and retries of a confirmed save are harmless.

Drafts are scoped to the signed-in member and compose/edit destination in IndexedDB on that device and browser. File blobs are stored once, separately from draft metadata; confirmed uploads are skipped after a retry or reload. Uploads remain three at a time and retain the existing original-quality processing. Browser storage quotas/private modes can prevent persistence; the form then asks the user to keep the page open. Metadata edits preserve the original photo IDs. Publishing clears the local draft and its stored blobs. Gallery images and draft thumbnails load lazily. Large ID lists use one `json_each` parameter instead of exceeding D1's 100-bound-parameter limit; bulk removal uses one SQL statement.

Validation: `node --test` covers the 300/301 boundary, duplicate IDs, ownership, foreign photos, stale edits, retry idempotency, ordering, retained comments/likes/tags/face scans, inaccessible removed media and the version guard. Existing face tests exercise the matching subsystem with synthetic embeddings. Live recognition is not enabled in the sandbox. Before promoting, run browser upload/reload/retry checks on a phone and apply migration 0020 to the production target only with an explicit production release instruction.
