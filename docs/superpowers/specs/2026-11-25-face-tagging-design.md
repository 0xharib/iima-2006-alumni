# Automatic face tagging — design

Date: 25 Nov 2026 · Owner: Hari (branch `hb`, PR to Arun) · Status: model chosen after testing; design for approval

## Intent

Batchmates are uploading a lot of photos to Memories. Nobody should have to tag people by hand. The site
recognises batchmates who have created a profile, tags them in photos automatically, and tells them. "You're in
a new photo from Arun" is the reason to come back to the site.

## Goals

- Uploaders do nothing: tags appear on their own, seconds after a memory is posted.
- Anyone with a profile is found in every photo on the site, including photos uploaded before they joined
  ("We found you in 23 photos").
- Tags are right. A wrong tag is worse than a missing one.
- Open-source models only, running inside Cloudflare. No Google Photos, AWS Rekognition or similar.

## Non-goals (v1)

- Tagging people who have not created a profile, even if a seed or yearbook portrait of them exists.
- "Is this you?" suggestions for low-scoring matches (testing showed they would mostly be wrong; see Matching).
- Face boxes drawn over photos in the lightbox (boxes are stored, so this can come later).
- Email digests of new tags (in-app notifications only, as today).
- Video, GIFs.
- Any face work in the browser.

## Anti-goals (a failure even if it works)

- Tagging and notifying the wrong person, such as a batchmate's partner or child tagged as a batchmate.
- Face data reachable by anyone: no endpoint ever returns embeddings, and they are never sent to a browser.
- Notification floods: 30 notifications for one album, or a burst when the backlog is processed.
- Spamming uploaders with "X was tagged in your photo" for every automatic tag.

## Constraints

- The site is a Cloudflare Worker (`worker.mjs`) with D1 (`DB`), R2 (`MEDIA`) and the Images binding (`IMAGES`).
  Workers cannot run native face libraries. R2 holds the original uploads, so the matcher reads originals rather
  than the resized copies the pages show.
- Arun's account is on Workers Paid ($5/month), which includes Containers and Queues. Containers include
  375 vCPU-minutes, 25 GiB-hours of memory and 200 GB-hours of disk per month. In testing, InsightFace took about
  2 seconds per photo on 2 vCPUs, so a few thousand photos a month fits the included usage. Arun deploys, so the
  new bindings need his review.
- Cloudflare's Git integration deploys `main` with the production `wrangler.toml`; `keep_vars = true`, so
  variables set in the dashboard survive deploys. Hosted D1 migrations are run by hand by Arun with
  `wrangler d1 execute --remote --file …` (see `docs/operations.md`).
- Existing photo tags live in `photo_tags(post, media, kind, target)`. Inserting a `person` row fires the
  `notify_photo` trigger (migration 0015): the tagged person gets a `mention`, and the post author gets a `tag`
  unless the author is the actor. With no `notification_tag_actor` row, the actor falls back to the post author.
  Automatic tags need their own notification instead (below).
- Today the tagged person cannot remove a person tag on a photo (only `tags`, the memory-level tags, have
  `tag-remove`). A "Not me" action is needed.
- Media ids are `post/<upload id>` for uploads and `legacy/<post>/<n>` for imported photos (the `photos` table).
  Both are shown in memories and both get scanned.
- Privacy law: face embeddings are biometric personal data under India's DPDP Act and, for batchmates in the EU or
  UK, special-category data under GDPR. Consent (below) and deletion on request are needed.

## Approaches considered

1. **Server-side matcher in a Cloudflare Container, triggered on upload (chosen).** Python with ONNX models runs in a
   container. The Worker sends it photos and gets back faces and embeddings; matching happens in the Worker.
   Pros: best models, covers the backlog, photos stay inside Cloudflare, tags land in seconds. Cons: a new
   container and queue to deploy and look after.
2. **In-browser matching at upload time (rejected by Hari).** Every browser would download a 5–10 MB model and
   every batchmate's face data. That is a privacy leak, slow on phones, and does nothing for existing photos.
3. **Both (rejected).** The only gain over 1 is instant tags, which 1 already gets close to, at the cost of two
   matchers to keep in agreement and the privacy problem of 2.

Hari picked 1.

## Model: InsightFace (decided by Hari after testing, 25 Nov)

SCRFD-10G detector (`det_10g.onnx`) and ArcFace R50 recogniser (`w600k_r50.onnx`) from InsightFace's `buffalo_l`
pack, run with onnxruntime on CPU. The models are licensed for non-commercial research use only; Hari has taken
responsibility for the licence question.

What the test showed (test bench in `IIMA_Year_Book/face-test/bench`, data pulled from the site):

- **Own photo against 222 yearbook portraits.** For 21 batchmates' own portrait/Then/Now photos, InsightFace put
  the right person first every time (21 of 21). Right-person scores had a median of 0.61. No wrong person scored
  above 0.33. SFace got 17 of 21, and wrong people scored up to 0.45.
- **32 memory photos, 275 faces, labelled by Hari** (120 batchmate faces of 77 people, mostly 2004–06 group
  shots, many faces 30–50 px across). Compared against 231 batchmates' own photos and yearbook portraits:

  | Score bar | Found | Wrong person | Non-batchmate tagged |
  |---|---|---|---|
  | 0.30 | 112 (93%) | 0 | 7 |
  | **0.35** | **111 (92%)** | **0** | **0** |
  | 0.40 | 107 (89%) | 0 | 0 |

  SFace had to go up to 0.45–0.50 to stop tagging the wrong people, and still tagged strangers.
- Caveats: Hari labelled with the models' guesses on screen, and 78 faces he couldn't place were left out, so the
  live hit rate will be somewhat lower. Re-check the bar once a few hundred real tags exist (see Rollout).

Lessons from the test that the build must keep:

- **Never enlarge before detection, and retry with a border.** SCRFD misses a face that fills the frame (tight
  portraits). With a 40% black border added on retry, it went from missing 37 of 222 yearbook portraits to about 1
  in 80.
- **Fixed detector input sizes** (320, 512, 768 or 1024 square). A different size per photo made onnxruntime's
  memory grow until the process was killed.
- **Downscale to 1600 px on the long side** before detection, from the original upload.

## Design

### Pieces

```
memory posted ──► Queue "face-jobs" ──► queue() consumer in worker.mjs
                                      │ R2 get (original) → IMAGES resize (≤1600px long side)
                                      ▼
                         FaceContainer (Durable Object + container)
                         POST /faces  → [{box, score, landmarks, embedding}]
                                      │
                                      ▼
                   D1: face_scans, faces  → match vs face_refs (JS, cosine)
                                      │
                         photo_tags (score ≥ bar)  +  face_matches
                                      │
                         notifications (one per person per memory)

profile created / photo saved / consent given ──► "ref" job ──► face_refs ──► re-match stored faces for that person
cron (hourly) ──► sweep: any media without a face_scans row, any failed job; this is also the backlog run
```

- **Container:** Python + onnxruntime + OpenCV, stateless, `standard-2` (1 vCPU), one analysis at a time; jobs are
  spread over two containers and the queue runs at most two at once. The two model files (about
  190 MB) are downloaded from InsightFace's GitHub release when the image is built, not committed to git. One
  endpoint takes image bytes and a mode (`photo` or `portrait`) and returns faces: box, detector score, five
  landmarks, normalised 512-d embedding, face size. `max_instances` 2. It sleeps when idle.
- **Queue:** `face-jobs`, consumer in `worker.mjs`, dead-letter queue `face-jobs-dlq` that the cron sweep
  re-drives. Messages: `{type:'media', post, media}` and `{type:'ref', member}`.
- **Enqueue points:** after the `db.batch` in `/compose` succeeds, one message per photo in the memory. Staged
  uploads (`/compose/photo`) are enqueued when they join a post, not before. Profile saves of `portraitObject`,
  `thenPhotoObject` or `nowPhotoObject`, and a member giving consent, enqueue a `ref` job.
- **Switch:** a `FACE_TAGGING` variable: `off`, `shadow` (scan and match, write `face_matches`, no tags or
  notifications, admins see results) or `on`.

### Data (new migration)

- `face_scans(media PRIMARY KEY, post, scanned_at, model, status)`: one row per photo scanned.
- `faces(id, media, post, box_json, det_score, size, embedding BLOB)`: every face found, whoever it is. Kept so
  that a batchmate who joins later is matched against every past photo without re-scanning.
- `face_refs(member, source, object_key, embedding BLOB, model, PRIMARY KEY(member, source))`: reference faces.
  `source` is `portrait`, `then`, `now` or `yearbook`. The yearbook portrait (an approved `profile_seeds` portrait,
  else `yearbook_public`) is added only for members who have consented. In a portrait/Then/Now photo with several
  faces (family photos), only a face matching the yearbook portrait is used; otherwise that photo is skipped. In testing it was what
  made the 2004–06 photos work.
- `face_matches(face_id, member, score, state)`: `state` is `auto`, `removed` or `shadow`. A removed pair is never
  re-tagged.
- `face_prefs(member PRIMARY KEY, recognise INTEGER, decided_at)`: the consent setting (see "Open for Hari").
- `photo_tags` gets an `origin` column (`manual` default, `auto`), so automatic rows can be told apart and skipped
  by the existing `notify_photo` trigger.

### Matching rules

- A person's score for a face is the best cosine similarity across their references.
- Within one photo, each face goes to at most one person and each person to at most one face, assigned greedily by
  score.
- **Score ≥ 0.35** (one constant in `worker.mjs`, stored with the model name): insert into `photo_tags` with
  `origin='auto'` and record `face_matches.state='auto'`.
- Below 0.35, nothing is tagged. The face is stored, so later references (a new profile photo) can still match it.
- No "Is this you?" band in v1: between 0.25 and 0.35, only 3 of 36 matches were right in testing.
- The person in the photo always has the last word: "Not me" removes the tag and records `removed`.
- A manual tag on a photo is never removed or duplicated by the matcher.

### Notifications

- No new notification kind, so the live `notifications` table is not rebuilt. Face notifications use the existing
  `mention` kind with their own `event_key`, and the page shows their own wording:
  - One notification per person per memory (`event_key 'found:<post>'`): "You're in a photo" / "You're in 3 photos",
    from the uploader, opening the photo.
  - Only photos in a new memory notify straight away. Everything else (the backlog, re-matching after a new profile
    photo or consent, publishing shadow results) is gathered into one "We found you in 23 photos" notification
    (`event_key 'found-all:<n>:<time>'`, byline "Batch photos") sent straight after re-matching or publishing, or by
    the hourly cron. Only tags the member hasn't been told about are counted (`face_matches.notified`), and their own
    uploads are left out of the count.
  - Uploaders get nothing for automatic tags, and nobody is notified about their own upload.
- `notify_photo` ignores `origin='auto'` rows; face notifications are written by the consumer.

### Where people see it

- Their profile's photo section shows photos they are tagged in. Today the profile gallery (`gallery()` in
  `worker.mjs`) only finds photos whose whole memory is about the person (`subject`, `memory_about`, `tags`). It
  ignores `photo_tags`, so photo-level tags, manual or automatic, never reach the profile. Add a branch that pulls
  the individual photos where `photo_tags` has `kind='person'` and `target` is the member.
- A "Photos of you" view lists their automatic and manual photo tags, with "Not me" on each automatic one.
- On the memory page, automatic tags look the same as manual ones. The person tagged can remove theirs.

### Privacy and deletion

- No route returns embeddings or face crops.
- Turning recognition off deletes that member's `face_refs` and removes their automatic tags; manual tags stay.
- Hiding a memory or deleting a photo deletes its `faces` rows.
- One plain sentence where consent is asked and where profile photos are uploaded: "We use your profile photos and
  your 2006 yearbook photo to find you in batch photos. You can turn this off any time."
- The admin view gets counts only (photos scanned, faces found, tags made, removals, failures), the shadow-mode
  results, and a "Scan all photos" button.

### Rollout

1. Ship with `FACE_TAGGING=shadow`. Scan all photos. An admin checks a sample of the would-be tags.
2. Switch to `on` in the Cloudflare dashboard. The backlog's tags go out as one collapsed notification per person.
3. After a few hundred live tags, look at "Not me" removals and re-check the 0.35 bar.

### Deployment (Hari builds, Arun deploys)

- Hari: build on `hb` with tests (synthetic embeddings, no real faces in git). Run locally with `wrangler dev`
  (needs Docker for the container). Open a PR to Arun.
- Arun, in this order: create the queues; merge (the Git integration deploys the Worker and builds the image);
  back up D1 and run `migrations/0019_face_tagging.sql`; set `FACE_TAGGING=shadow`; after the shadow check, set
  `on` and publish. The migration must follow the deploy, because older Workers insert into `photo_tags` without
  column names. The new Worker works without the migration and keeps face tagging hidden until it has run.

## Open for Hari

- **Consent default.** (a) Opt-out: everyone with a profile is matched, with a notice and a toggle. Most reach,
  more legal exposure. (b) A one-time prompt on next sign-in: "Find me in batch photos? Yes / Not now". Explicit
  consent and an engagement moment of its own, but people who rarely sign in will not be matched until they do.
  Recommendation: (b), with "Yes" as the obvious button.

## Left to the builder

Exact table columns and indexes, queue batch sizes, the container's Dockerfile and HTTP shape, notification copy
polish, and test fixtures.
