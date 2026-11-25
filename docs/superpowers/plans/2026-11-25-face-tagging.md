# Automatic Face Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag consenting batchmates in memory photos automatically with InsightFace, and tell them.

**Architecture:** A Python face service (InsightFace SCRFD + ArcFace on onnxruntime) runs in a Cloudflare Container behind a
Durable Object. The Worker queues one job per photo, sends the original bytes to the service, stores every face's
embedding in D1, matches in JavaScript against consenting members' reference faces, and writes `photo_tags` rows with
`origin='auto'`. A `FACE_TAGGING` variable (`off` / `shadow` / `on`) gates everything.

**Tech Stack:** Cloudflare Workers (plain ES modules, no npm dependencies), D1, R2, Queues, Containers, Cron Triggers;
Python 3.12, onnxruntime, insightface, OpenCV, Pillow; `node --test` with `node:sqlite`; Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-11-25-face-tagging-design.md`

## Global Constraints

- Model: InsightFace `buffalo_l` files `det_10g.onnx` and `w600k_r50.onnx`, downloaded at image build from
  `https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip`. Never committed to git.
- Model id string stored with every face and reference: `buffalo_l/w600k_r50`.
- Auto-tag bar: `FACE_BAR = 0.35` (cosine similarity, one constant in `faces.mjs`).
- Detector: never enlarge; square input sizes 320, 512, 768 or 1024 only (smallest ≥ min(long side, 1024)); if no
  face is found, retry once with a black border of 40% of the long side and shift results back.
- Downscale to 1600 px on the long side (EXIF-rotated first) before detection.
- One face → at most one member; one member → at most one face per photo; greedy by score.
- `FACE_TAGGING` unset means `off`. It is set in the Cloudflare dashboard, never in `wrangler.toml` (`keep_vars = true`).
- Consent copy (exact): "We use your profile photos and your 2006 yearbook photo to find you in batch photos. You can
  turn this off any time." Buttons: "Yes, find me" and "Not now".
- No route returns embeddings. No real faces in git: tests use synthetic vectors and generated images.
- The Worker stays dependency-free and importable by `node --test` (no `cloudflare:workers` import).
- Posting a memory must never fail because the queue or face service is unavailable.

## Review Focus

1. **Face service cold or not yet deployed** (Worker goes live before the container): jobs must retry, nothing is
   lost, posting still works. → Task 5 test `media job retries when the face service fails`.
2. **An album's photos processed in parallel**: one notification per person per memory, never one per photo.
   → Task 5 test `one notification per person per memory`.
3. **The uploader is in their own photo**: tagged, but no notification to themselves. → Task 5 test
   `uploader is tagged without notifying themselves`.
4. **Withdraw then re-consent**: earlier "Not me" choices still hold; other tags come back. → Task 6 test
   `re-consent restores tags but keeps Not me`.
5. **Phone photos with EXIF rotation**: boxes refer to the rotated image the site shows. → Task 3 test
   `test_exif_rotation_is_applied`.

---

## File Structure

- Create `migrations/0019_face_tagging.sql` — new tables, `photo_tags.origin`, `notify_photo` trigger skipping auto rows.
- Create `faces.mjs` — everything face-related on the Worker side: vector helpers, matching, face-service client,
  queue consumer, cron sweep, consent and "Not me" routes, admin page data. Exports `FaceContainer`.
- Modify `worker.mjs` — export `queue`, `scheduled` and `FaceContainer`; call `faceRoute`; enqueue on compose and
  profile photo saves; explicit column lists for `photo_tags` inserts; clean up faces when a post is hidden;
  include photo tags in the profile gallery; notification copy and links.
- Modify `views.mjs` — consent card on Home, toggle on own profile, notification copy, "Photos of you" page, "Not me"
  on own auto tags, admin face page.
- Create `face-service/app.py`, `face-service/Dockerfile`, `face-service/requirements.txt`,
  `face-service/test_app.py` — the container's HTTP service.
- Create `test/fixture.mjs` (moved from `test/worker.test.mjs`), `test/faces.test.mjs`.
- Modify `wrangler.toml`, `docs/operations.md`, `README.md`.

---

### Task 1: Schema, auto-tag origin and a shared test fixture

**Files:**
- Create: `migrations/0019_face_tagging.sql`, `test/fixture.mjs`, `test/faces.test.mjs`
- Modify: `test/worker.test.mjs:1-58` (move `fixture` and `body` to `test/fixture.mjs`, import them), `worker.mjs:723,726,732,902`

**Interfaces:**
- Produces tables:
  - `face_prefs(member INTEGER PRIMARY KEY REFERENCES roster(id), recognise INTEGER NOT NULL CHECK(recognise IN (0,1)), decided INTEGER NOT NULL)`
  - `face_refs(member INTEGER NOT NULL REFERENCES roster(id), source TEXT NOT NULL CHECK(source IN ('portrait','then','now','yearbook')), object_key TEXT NOT NULL, embedding BLOB NOT NULL, model TEXT NOT NULL, PRIMARY KEY(member,source))`
  - `face_scans(media TEXT PRIMARY KEY, post TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('done','failed')), faces INTEGER NOT NULL DEFAULT 0, model TEXT NOT NULL, scanned INTEGER NOT NULL)`
  - `faces(id INTEGER PRIMARY KEY, media TEXT NOT NULL, post TEXT NOT NULL, box TEXT NOT NULL, score REAL NOT NULL, size INTEGER NOT NULL, embedding BLOB NOT NULL, model TEXT NOT NULL)` + index `faces_media(media)`
  - `face_matches(media TEXT NOT NULL, member INTEGER NOT NULL, post TEXT NOT NULL, face INTEGER, score REAL NOT NULL, state TEXT NOT NULL CHECK(state IN ('shadow','auto','removed')), created INTEGER NOT NULL, PRIMARY KEY(media,member))`
  - `photo_tags.origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','auto'))`
- Produces `fixture()` in `test/fixture.mjs` returning `{call, session, sqlite, env, objects}` (same as today plus the
  `objects` map) and `body(response)`.

- [ ] **Step 1: Move `fixture` and `body` into `test/fixture.mjs`** (exported, `objects` added to the return) and import
  them in `test/worker.test.mjs`. Run `node --test`; expected: 31 pass.
- [ ] **Step 2: Write failing tests in `test/faces.test.mjs`**

```js
test('manual photo tags still notify; auto photo tags do not', async()=>{
  const {sqlite}=fixture();
  sqlite.exec(`INSERT INTO posts(id,author,body,created) VALUES('p1',1,'x',1)`);
  sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target) VALUES('p1','post/a','person','2')`);
  sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1','post/b','person','2','auto')`);
  const rows=sqlite.prepare("SELECT anchor FROM notifications WHERE recipient=2").all();
  assert.deepEqual(rows.map(r=>r.anchor),['photo-post-a']);
});
test('face tables exist and photo_tags rejects an unknown origin', ()=>{
  const {sqlite}=fixture();
  for (const t of ['face_prefs','face_refs','face_scans','faces','face_matches'])
    assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t));
  assert.throws(()=>sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('x','m','person','2','robot')`));
});
```

- [ ] **Step 3: Run `node --test test/faces.test.mjs`** — expected FAIL (no `origin` column).
- [ ] **Step 4: Write `migrations/0019_face_tagging.sql`.** Create the tables above; `ALTER TABLE photo_tags ADD COLUMN origin …`;
  `DROP TRIGGER IF EXISTS notify_photo;` then recreate it with the body from `0015_catchup_notifications.sql:81-90`
  copied verbatim, changing only the `WHEN` clause to `WHEN NEW.kind IN ('person','topic') AND NEW.origin='manual'`.
  Header comment: safe to run on its own, like 0014.
- [ ] **Step 5: Give every `INSERT … INTO photo_tags` in `worker.mjs` an explicit column list `(post,media,kind,target)`**
  (lines 723, 726, 732 and the merge at 902), so the new column takes its default.
- [ ] **Step 6: Run `node --test`** — expected: all pass (31 + 2).
- [ ] **Step 7: Commit** `feat(faces): schema for face tagging; auto photo tags skip the mention trigger`.

---

### Task 2: Matching core (pure functions)

**Files:**
- Create: `faces.mjs`
- Test: `test/faces.test.mjs`

**Interfaces:**
- Produces, exported from `faces.mjs`:
  - `FACE_BAR = 0.35`, `FACE_MODEL = 'buffalo_l/w600k_r50'`
  - `faceMode(env) -> 'off'|'shadow'|'on'` (anything else → `'off'`)
  - `toVector(blob) -> Float32Array` (accepts `ArrayBuffer`, `Uint8Array`, `number[]` as D1 or `node:sqlite` return them)
  - `fromBase64(b64) -> Uint8Array`, `vectorBytes(float32) -> Uint8Array`
  - `similarity(a: Float32Array, b: Float32Array) -> number` (dot product; inputs are already unit length)
  - `assign(faces: {id, vector}[], refs: Map<member, Float32Array[]>) -> {face, member, score}[]` — every pair's score
    is the best over that member's refs; greedy by score so each face and each member appear once; only pairs with
    `score >= FACE_BAR` are returned, highest first.

- [ ] **Step 1: Write failing tests**

```js
test('assign gives each face and each member at most once, best first, at or above the bar', ()=>{
  const v=i=>{const a=new Float32Array(512);a[i]=1;return a;};
  const mix=(i,j,w)=>{const a=new Float32Array(512);a[i]=w;a[j]=Math.sqrt(1-w*w);return a;};
  const refs=new Map([[7,[v(0),v(5)]],[8,[v(1)]]]);
  const faces=[{id:1,vector:mix(0,1,0.9)},{id:2,vector:mix(0,1,0.8)},{id:3,vector:v(9)}];
  assert.deepEqual(assign(faces,refs).map(p=>[p.face,p.member]),[[1,7],[2,8]]);
});
test('a member just under the bar is not assigned', ()=>{
  const a=new Float32Array(512);a[0]=0.349;a[1]=Math.sqrt(1-0.349**2);
  const r=new Float32Array(512);r[0]=1;
  assert.deepEqual(assign([{id:1,vector:a}],new Map([[7,[r]]])),[]);
});
test('toVector reads every blob shape D1 and node:sqlite return', ()=>{
  const f=new Float32Array([0.5,-1]); const bytes=vectorBytes(f);
  for (const blob of [bytes,bytes.buffer,[...bytes]]) assert.deepEqual([...toVector(blob)],[0.5,-1]);
});
test('faceMode defaults to off', ()=>{
  assert.equal(faceMode({}),'off'); assert.equal(faceMode({FACE_TAGGING:'shadow'}),'shadow'); assert.equal(faceMode({FACE_TAGGING:'yes'}),'off');
});
```

- [ ] **Step 2: Run** `node --test test/faces.test.mjs` — expected FAIL (module missing).
- [ ] **Step 3: Implement the exports above in `faces.mjs`.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): matching core`.

---

### Task 3: Face service (Python, runs in the container)

**Files:**
- Create: `face-service/app.py`, `face-service/requirements.txt`, `face-service/Dockerfile`, `face-service/test_app.py`

**Interfaces:**
- Produces HTTP on port 8080:
  - `GET /health` → `200 {"ok": true, "model": "buffalo_l/w600k_r50"}` once models are loaded.
  - `POST /faces?mode=photo|portrait`, body = image bytes (JPEG/PNG/WebP) →
    `200 {"model": "buffalo_l/w600k_r50", "width": int, "height": int, "faces": [{"box": [x1,y1,x2,y2], "score": float, "size": int, "embedding": "<base64 of 512 little-endian float32, unit length>"}]}`.
    `width`/`height` and `box` are in the EXIF-rotated, downscaled (≤1600 px) image. `size` = round(min(box width, box height)).
    `portrait` mode returns only the largest face (area × score). Undecodable body → `400 {"error": "unreadable image"}`.
- Python functions (in `app.py`, tested directly): `prepare(data: bytes) -> np.ndarray` (BGR, EXIF-rotated, ≤1600),
  `input_side(h: int, w: int) -> int`, `detect(img, detector) -> list[(box, score, kps)]` (with the border retry),
  `analyse(data: bytes, mode: str) -> dict`.
- `requirements.txt` pins what the test bench used: `insightface==2.1`, `onnxruntime==1.29.0`,
  `opencv-python-headless==5.0.0.93`, `numpy==2.5.3`, `pillow==13.0.0`.
- `Dockerfile`: `python:3.12-slim`; install `libgl1 libglib2.0-0` (insightface pulls `opencv-python`); `pip install -r`;
  download and unzip `buffalo_l.zip` into `/models` keeping only `det_10g.onnx` and `w600k_r50.onnx`; `EXPOSE 8080`;
  `CMD ["python","app.py"]`. Models are loaded once at start.

- [ ] **Step 1: Write failing tests in `face-service/test_app.py`** (unittest; a fake detector stands in for SCRFD so tests
  need no models; one integration test runs only if `/models` or `FACE_MODELS` dir exists):

```python
def test_input_side_never_enlarges(self):
    self.assertEqual(app.input_side(300, 200), 320); self.assertEqual(app.input_side(600, 900), 1024)
    self.assertEqual(app.input_side(1600, 1200), 1024); self.assertEqual(app.input_side(500, 512), 512)
def test_border_retry_shifts_boxes_back(self):
    # fake detector finds nothing on the raw image, one face on the padded one at (pad+10, pad+20)
    ...  # assert detect() returns box [10,20,..] and landmarks shifted by the same pad
def test_exif_rotation_is_applied(self):
    # a 200x100 JPEG with EXIF Orientation=6 → prepare() returns shape (200, 100, 3)
def test_downscales_to_1600(self):
    # a 4000x3000 PNG → prepare() long side 1600
def test_unreadable_image_is_400(self):  # via analyse() raising ValueError → handler returns 400
def test_portrait_mode_returns_largest_face_only(self):  # fake detector with two faces
```

- [ ] **Step 2: Run** `cd face-service && python3 -m unittest -v` — expected FAIL (no app).
- [ ] **Step 3: Implement `app.py`** with `http.server.ThreadingHTTPServer`, porting the bench's `SCRFD` (bucketed sizes,
  border retry) and ArcFace (`face_align.norm_crop` on the five landmarks, `get_feat`, L2-normalise). Model dir from
  `FACE_MODELS` env, default `/models`.
- [ ] **Step 4: Run unit tests** — expected PASS. Then run the integration test with the bench models:
  `FACE_MODELS=/home/claude/facetest/models/buffalo_l python3 -m unittest -v` — expected PASS (`analyse` on a generated
  blank image returns `faces: []`).
- [ ] **Step 5: Build and smoke-test the image:** `docker build -t face-service face-service && docker run -d -p 8080:8080 face-service`,
  then `curl localhost:8080/health` → `{"ok": true, …}` and `curl --data-binary @<generated blank jpg> localhost:8080/faces`
  → `faces: []`. If Docker Hub or GitHub downloads are blocked, record that and fall back to Step 4's local run.
- [ ] **Step 6: Commit** `feat(faces): face service container`.

---

### Task 4: Container Durable Object and the face-service client

**Files:**
- Modify: `faces.mjs`, `worker.mjs` (re-export `FaceContainer`)
- Test: `test/faces.test.mjs`

**Interfaces:**
- Produces:
  - `class FaceContainer { constructor(state, env); fetch(request); alarm() }` — plain class (no `cloudflare:workers`
    import). `fetch` starts `state.container` if not running, proxies to `state.container.getTcpPort(8080).fetch('http://container'+path, init)`,
    retrying connection errors every 500 ms for up to 60 s; records `lastUsed` in `state.storage` and sets an alarm 5
    minutes out. `alarm()` calls `state.container.destroy()` if unused for 5 minutes, otherwise re-arms.
  - `analyseImage(env, bytes: Uint8Array, mode: 'photo'|'portrait') -> Promise<{model, width, height, faces:[{box, score, size, vector: Float32Array, bytes: Uint8Array}]}>`
    — uses `env.FACE_SERVICE_URL` (local development) if set, else `env.FACES.get(env.FACES.idFromName('matcher')).fetch('https://faces/faces?mode='+mode, {method:'POST', body: bytes})`.
    Throws on non-200.

- [ ] **Step 1: Write failing tests** — `FaceContainer` with a fake `state` whose `container.getTcpPort().fetch` fails
  twice then succeeds: the request is answered and `start` was called once; `alarm()` destroys after 5 idle minutes
  (inject `Date.now` via a `clock` field). `analyseImage` with a fake `env.FACES` decodes base64 into unit vectors and
  throws on a 503.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test` — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): container durable object and client`.

---

### Task 5: Photo jobs: scan, match, tag, notify

**Files:**
- Modify: `faces.mjs`, `worker.mjs` (default export gains `queue`; `/compose` enqueues; post hide cleans up)
- Test: `test/faces.test.mjs`

**Interfaces:**
- Consumes: `assign`, `analyseImage`, `faceMode`, `FACE_BAR`, `FACE_MODEL`.
- Produces:
  - `enqueuePhotos(env, post: string, media: string[]) -> Promise<void>` — `env.FACE_JOBS.sendBatch` of `{type:'media', post, media}`;
    no-op when mode is `off` or the binding is missing; swallows and logs errors.
  - `mediaObject(db, media) -> Promise<string|null>` — `post/<id>` → `uploads.object_key`; `legacy/<post>/<n>` → the same
    query as the `/media/legacy` route (`worker.mjs:325-326`); null if the post is hidden.
  - `scanPhoto(env, post, media) -> Promise<{faces:number, tagged:number[]}>`.
  - `handleQueue(batch, env) -> Promise<void>`; `worker.mjs` default export: `queue: (batch, env, ctx) => handleQueue(batch, env)`.
- Behaviour of `scanPhoto`, in order:
  1. Mode `off` → return without work. Media missing or post hidden → write nothing, return.
  2. `analyseImage(photo)`; on error rethrow (message is retried; `handleQueue` calls `msg.retry({delaySeconds: 30*attempts})`).
  3. Replace that media's rows in `faces` and upsert `face_scans(status='done', faces=n, model, scanned)` in one batch.
  4. Load refs of members with `face_prefs.recognise=1`; `assign`.
  5. Skip a pair if a `photo_tags` person row for that media+member exists, or `face_matches` for media+member is `removed`.
  6. Mode `shadow` → upsert `face_matches(state='shadow')`. Mode `on` → `face_matches(state='auto')` + `photo_tags(…, origin='auto')`
     + one notification per member per post: `INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
     VALUES(member, post author, 'mention', post, 'photo-'||replace(media,'/','-'), 'found:'||post)`, skipped when member = author.
- `/compose` (after `db.batch` succeeds at `worker.mjs:672`): `ctx`-less, so `await enqueuePhotos(env, key, order.map(i=>'post/'+i))` inside try/catch.
- Post hidden (`worker.mjs:748` and the `hide-post` admin action at 883): also `DELETE FROM faces WHERE post=?`,
  `DELETE FROM face_scans WHERE post=?`, `DELETE FROM face_matches WHERE post=? AND state<>'removed'`.

- [ ] **Step 1: Write failing tests** (fake `env.FACES` returning synthetic vectors keyed by the R2 object's first byte;
  `env.FACE_TAGGING='on'`; members 2 and 3 with `face_prefs.recognise=1` and refs inserted directly):
  - `on mode tags a consenting member and records the match` — `photo_tags` row with `origin='auto'`, `face_matches.state='auto'`.
  - `shadow mode records matches but tags and notifies nobody`.
  - `non-consenting members are never matched` — member 4 has refs but `recognise=0`.
  - `one notification per person per memory` — two photos of member 2 in one post → exactly one notification with `event_key='found:'||post`.
  - `uploader is tagged without notifying themselves`.
  - `Not me is respected on rescan` — `face_matches.state='removed'` → no tag after `scanPhoto` again.
  - `media job retries when the face service fails` — fake returns 503 → `msg.retry` called, nothing written; compose with
    no `FACE_JOBS` binding still redirects to the post.
  - `hiding a post removes its faces`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test` — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): photo jobs tag consenting members`.

---

### Task 6: Consent, reference faces and re-matching

**Files:**
- Modify: `faces.mjs`, `worker.mjs` (call `faceRoute` near the top of `route`; profile photo saves at `worker.mjs:540-551` call `enqueueRefs`),
  `views.mjs` (consent card in `home`, toggle on the owner's profile)
- Test: `test/faces.test.mjs`

**Interfaces:**
- Produces:
  - `faceRoute({req, env, me, path, post, data}) -> Promise<Response|null>` handling `POST /faces/consent` with
    `choice=yes|no`, `next` (redirect target via the existing `destination()` rule; default `/`).
    `yes` → upsert `face_prefs(recognise=1)` and enqueue `{type:'ref', member: me}`. `no` → upsert `recognise=0`, delete the
    member's `face_refs`, delete their `photo_tags` with `origin='auto'`, delete their `face_matches` except `removed`.
  - `consentState(db, me) -> Promise<'ask'|'on'|'off'|'hidden'>` — `hidden` when mode is `off`; `ask` when no `face_prefs` row.
  - `enqueueRefs(env, db, member)` — sends a `ref` job only if the member has `recognise=1`.
  - `refreshRefs(env, member) -> Promise<number>` — for each source: `portrait|then|now` from `profile_fields`
    (`portraitObject`, `thenPhotoObject`, `nowPhotoObject`); `yearbook` = `profile_seeds.portrait_key` for that roster id,
    else the first `yearbook_public` image's `photos.object_key`. Calls `analyseImage(…,'portrait')`, upserts `face_refs`,
    deletes refs whose source has gone. Returns the count.
  - `rematchMember(env, member) -> Promise<number>` — pages through `faces` (500 rows at a time, consenting member's refs
    only); per media keeps this member's best face ≥ `FACE_BAR`; skips media where the member already has a person tag
    or a `removed` match, or where that face already belongs to another member in `face_matches`; writes as in Task 5
    step 6. In `on` mode, if anything was tagged, one summary notification: kind `'mention'`, actor NULL, post = the newest
    tagged post, anchor = its photo anchor, `event_key = 'found-all:'||count||':'||Date.now()`.
  - `handleQueue` routes `{type:'ref'}` to `refreshRefs` then `rematchMember`.
- Views: `home` shows, when state is `ask`, a card with heading "Find me in batch photos?", the consent copy from Global
  Constraints, and two buttons posting to `/faces/consent`. Own profile shows "Find me in batch photos: On/Off" with a
  one-click switch when state is `on`/`off`, and the consent copy as a one-line note beside the profile photo upload
  buttons whenever state is not `hidden`.

- [ ] **Step 1: Write failing tests**
  - `consent card shows once and Not now hides it` — GET `/` contains "Find me in batch photos?"; after POST `choice=no`, it doesn't.
  - `consent card is hidden while face tagging is off`.
  - `yes builds refs from own photos and the yearbook portrait` — `face_refs` sources `portrait` and `yearbook`.
  - `rematch tags earlier photos and sends one summary` — two stored faces of the member in two posts → two auto tags,
    one notification whose `event_key` starts `found-all:2:`.
  - `withdrawing removes auto tags but keeps manual tags`.
  - `re-consent restores tags but keeps Not me`.
  - `saving a new Then photo queues a ref job only for consenting members`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test` — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): consent, reference faces and re-matching`.

---

### Task 7: Where people see it: notifications, "Photos of you", "Not me", profile gallery

**Files:**
- Modify: `faces.mjs` (`/photos-of-you`, `POST /faces/not-me`), `worker.mjs` (gallery at 301-307, notification open at
  788-791, notification rows query at 793 adds `found_count`), `views.mjs` (`notifications` at 447-470, post page photo tags, new `photosOfYou`)
- Test: `test/faces.test.mjs`

**Interfaces:**
- Produces:
  - `GET /photos-of-you` (signed in) — every photo with a person `photo_tags` row for me, newest first, each linking to
    `/posts/<post>#photo-…`; auto ones carry a "Not me" button.
  - `POST /faces/not-me` with `media` — only for my own `origin='auto'` tag: delete it, set `face_matches.state='removed'`,
    redirect back (`next`).
  - Notification rows gain `found_count` = number of my `origin='auto'` person tags on that post.
- Copy (exact): `found:` → "You're in a photo" / "You're in {n} photos", open → the post at the photo anchor.
  `found-all:<n>:…` → byline "Batch photos" (no actor), "We found you in {n} photos", open → `/photos-of-you`.
- Gallery: the `uploads` and `memories` branches also include individual photos where `photo_tags` has
  `kind='person'` and `target=CAST(? AS TEXT)` for that media (wrap `memories` in a subquery so the computed `legacy/…`
  media id can be compared).

- [ ] **Step 1: Write failing tests**
  - `found notification reads You're in 2 photos and opens the photo`.
  - `found-all notification opens Photos of you`.
  - `Not me removes only my own auto tag and sticks` — another member's tag and my manual tag are untouched; a rescan does not re-tag.
  - `profile gallery shows a photo I'm tagged in` — `/people/2` contains `/media/post/<id>` after an auto tag.
  - `Photos of you shows Not me only on auto tags`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test` — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): notifications, Photos of you and Not me`.

---

### Task 8: Admin page and the hourly sweep

**Files:**
- Modify: `faces.mjs`, `worker.mjs` (default export gains `scheduled`; admin link), `views.mjs` (`adminFaces`)
- Test: `test/faces.test.mjs`

**Interfaces:**
- Produces:
  - `sweep(env, limit=200) -> Promise<number>` — enqueues media of visible posts with no `face_scans` row or `status='failed'`
    (uploads with a post, and legacy photos as `legacy/<post>/<n>`); no-op when `off`. `scheduled: (event, env) => sweep(env)`.
  - `GET /admin/faces` (admins only): mode; counts (photos, scanned, faces found, consenting members, shadow matches,
    auto tags, removals, failed scans); the 200 lowest-scoring shadow matches as thumbnail (`/media/<media>?w=256`),
    name, score. Never shows embeddings.
  - `POST /admin/faces` `action=scan-all` → `sweep(env, 5000)`; `action=publish` (only when mode is `on`) → for each member
    with shadow matches ≥ bar, convert them as `rematchMember` would write them in `on` mode, with one `found-all`
    summary per member.
- Link from the admin tools page (`page.admin`) to `/admin/faces`.

- [ ] **Step 1: Write failing tests**
  - `sweep queues unscanned visible photos including legacy ones, and nothing when off`.
  - `admin faces page is admin-only and shows counts without embeddings`.
  - `publish turns shadow matches into tags with one summary each`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test` — expected PASS.
- [ ] **Step 5: Commit** `feat(faces): admin page and hourly sweep`.

---

### Task 9: Deployment config and docs

**Files:**
- Modify: `wrangler.toml`, `docs/operations.md`, `README.md`

**Interfaces:**
- `wrangler.toml` additions:

```toml
[[queues.producers]]
binding = "FACE_JOBS"
queue = "face-jobs"

[[queues.consumers]]
queue = "face-jobs"
max_batch_size = 4
max_retries = 5
dead_letter_queue = "face-jobs-dlq"

[[containers]]
class_name = "FaceContainer"
image = "./face-service/Dockerfile"
instance_type = "standard-1"
max_instances = 2

[[durable_objects.bindings]]
name = "FACES"
class_name = "FaceContainer"

[[migrations]]
tag = "faces-v1"
new_sqlite_classes = ["FaceContainer"]

[triggers]
crons = ["17 * * * *"]
```

- `docs/operations.md`: a "Face tagging" section with Arun's one-time steps (create both queues, back up D1, run
  `npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0019_face_tagging.sql`, set `FACE_TAGGING=shadow`
  in the dashboard), what each mode does, the shadow check, switching to `on` and pressing Publish, local development
  with `FACE_SERVICE_URL=http://localhost:8080`, the licence note, and that the first deploy may serve the Worker
  before the container is ready (jobs retry).
- `README.md`: one line pointing to that section and `cd face-service && python3 -m unittest`.

- [ ] **Step 1: Edit the three files.**
- [ ] **Step 2: Validate the config:** `npx --yes wrangler@latest deploy --dry-run --outdir /tmp/dry` — expected: no
  configuration errors (a container build or account error from the dry run is acceptable and noted).
- [ ] **Step 3: Run** `node --test` and `cd face-service && python3 -m unittest` — expected PASS.
- [ ] **Step 4: Commit** `docs(faces): deployment and operations`.
