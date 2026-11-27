# Profile "From the 2006 yearbook" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each batchmate's profile shows their *iimages 2006* yearbook photo, heading and proofread write-up, which the
owner (or an admin) can hide.

**Architecture:** Two repositories. The yearbook repo (Hari's IIMA_Year_Book folder, Python) proofreads the
write-ups and exports a private import bundle (SQL + WebP photos + R2 upload script) into `people/private/iimages-2006/`.
The site repo (Cloudflare Worker, D1, R2) gets migration 0022, a new `/media/iimages/<member>` case, a profile section
and owner/admin hide controls, all behind a schema guard so the code can deploy before the migration.

**Tech Stack:** Python 3 + PyYAML + Pillow (yearbook repo); JavaScript ES modules on Cloudflare Workers, D1 (SQLite),
R2, `node --test` with `test/fixture.mjs` (site repo).

**Spec:** `docs/superpowers/specs/2026-11-27-profile-2006-and-flair-design.md`

## Global Constraints

- No flair of any kind (Poll of the Year, posts, Young Alumni Achiever) in this work.
- Write-ups shown exactly as printed (printed spelling, punctuation, emoticons kept); every write-up proofread before import.
- No 2006 text or images in the site repository; import files live only in `people/private/iimages-2006/` (git-ignored).
- The import never sets `hidden`; re-running it keeps owners' choices.
- Imported rows: `roster_join.csv` match in `high`, `confirmed`, `likely`, `in memoriam` (274 people).
- No link to the scanned page. No use of the yearbook photo as a portrait or fallback.
- Every D1 statement under 100 KB.
- Section title "From the 2006 yearbook"; hidden owner line "Your 2006 write-up is hidden from batchmates." with "Show it again"; owner button "Hide my 2006 write-up".

## Review Focus

1. A write-up containing `<`, `&`, quotes or emoji must render as text, never as HTML (escape everything).
2. A hidden entry's photo must not be reachable by a visitor through `/media/iimages/<id>` (direct URL), while the owner and admins still see it.
3. Re-running the import after an owner hid their entry must leave `hidden=1`.
4. A member with an entry but no printed photo (`photo_key` NULL) gets the section without an image and no broken `<img>`.
5. The site before migration 0022 (table missing) must render profiles and `/media/iimages/…` without a 500.

---

### Task 1: Proofread every write-up (yearbook repo)

**Files:**
- Create: `content/people/writeups/p030.yaml` … `p132.yaml` (one per page with profiles)
- Modify: `iimages/people_table.py` (`load_profiles`)
- Modify: `content/REVIEW_LOG.md`

**Interfaces:**
- Produces: `output/people/yearbook_people.csv` with `writeup_status == "reviewed"` for every row; each
  `content/people/writeups/pNNN.yaml` is `entries: [{heading: <exact heading from profiles_p30_132.tsv>, text: <str>}]`,
  paragraphs separated by a blank line.

- [ ] **Step 1:** For each page in `profiles_p30_132.tsv`, read `build/pages/pNNN.jpg` and the OCR draft for each of its headings, and write the page's YAML with the text corrected to match the print exactly (line breaks inside a paragraph joined; printed errors kept).
- [ ] **Step 2:** In `load_profiles`, when `content/people/writeups/p{page:03d}.yaml` has an entry with the row's heading, use its text and `text_status = "reviewed"`; otherwise keep the OCR draft as `ocr_draft`.
- [ ] **Step 3:** Run `python3 -c "from iimages.people_table import build; build()"` then
  `python3 -c "import csv;r=list(csv.DictReader(open('output/people/yearbook_people.csv')));print(len(r),sum(x['writeup_status']!='reviewed' for x in r))"`
  Expected: `279 0`.
- [ ] **Step 4:** Re-run the roster join (`python3 -c "from iimages.roster_join import join; join()"`) so `people/roster_join.csv` carries the reviewed text. Spot-check 10 random write-ups against their page images.
- [ ] **Step 5:** Commit `content/people/writeups/`, `iimages/people_table.py`, `content/REVIEW_LOG.md`: "Yearbook write-ups: proofread pages 30–132 against the scans".

### Task 2: Export the private import bundle (yearbook repo)

**Files:**
- Create: `iimages/site_export.py`
- Create (output, git-ignored): `people/private/iimages-2006/iimages-2006.sql`, `people/private/iimages-2006/photos/<member>.webp`, `people/private/iimages-2006/upload-photos.sh`

**Interfaces:**
- Consumes: `people/roster_join.csv` (Task 1).
- Produces: `export(out_dir: Path) -> dict` returning `{"rows": int, "photos": int}`; SQL rows of the form
  `INSERT INTO iimages_2006(member,heading,dorm,writeup,page,photo_key) VALUES(…) ON CONFLICT(member) DO UPDATE SET heading=excluded.heading,dorm=excluded.dorm,writeup=excluded.writeup,page=excluded.page,photo_key=excluded.photo_key;`
  with `photo_key = 'iimages-2006/photo/<member>.webp'` or NULL; upload script lines
  `npx wrangler r2 object put iima-2006-alumni-media/iimages-2006/photo/<member>.webp --file "<abs path>" --content-type image/webp --remote`.

- [ ] **Step 1:** Write `export`: filter rows by the four match values; SQL-quote text by doubling `'`; WebP at quality 88, crop size kept; one statement per member.
- [ ] **Step 2:** Run `python3 -c "from pathlib import Path;from iimages.site_export import export;print(export(Path('people/private/iimages-2006')))"`. Expected: `{'rows': 274, 'photos': 272}` (or 273/272 if Sachin's row has a photo; the count must equal the roster-joined rows).
- [ ] **Step 3:** Load the SQL into a scratch SQLite with migration 0022 (Task 3) applied, twice, after setting `hidden=1` for one member between runs. Expected: 274 rows, that member still `hidden=1`, no statement over 100 KB.
- [ ] **Step 4:** Commit `iimages/site_export.py` only: "Export the yearbook write-ups and photos for the site".

### Task 3: Table, data access and media (site repo)

**Files:**
- Create: `migrations/0022_iimages_2006.sql` (table exactly as in the spec)
- Create: `iimages2006.mjs`
- Modify: `worker.mjs` (`/media/` route, around the `seed` case)
- Test: `test/iimages2006.test.mjs`

**Interfaces:**
- Produces (in `iimages2006.mjs`):
  - `iimagesSchema(db) -> Promise<boolean>` (cached true once the table exists, like `faceSchema`)
  - `yearbookEntry(db, member, viewer, isAdmin) -> Promise<{heading, dorm, writeup, hasPhoto, hidden} | null>` — null when no table, no row, or `hidden` and the viewer is neither the member nor an admin
  - `setYearbookHidden(db, member, hidden: boolean, actor) -> Promise<void>`
  - `yearbookPhotoKey(db, member, viewer, isAdmin) -> Promise<string|null>`

- [ ] **Step 1: Write failing tests** in `test/iimages2006.test.mjs`: `entry is returned to everyone while shown`; `hidden entry is null for others but returned to owner and admin`; `/media/iimages/<id> serves the photo to a visitor, 404s when hidden, serves owner and admin`; `before migration 0022 a profile and /media/iimages/1 do not 500` (fixture with `skip:['0022_iimages_2006.sql']`); `re-running the import upsert keeps hidden=1`; `photo_key NULL gives hasPhoto false`.
- [ ] **Step 2:** Run `node --test test/iimages2006.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the migration, the four functions, and the `bits[0]==='iimages'` media case calling `yearbookPhotoKey` then `servePhoto`.
- [ ] **Step 4:** Run `node --test`. Expected: all pass.
- [ ] **Step 5:** Commit: "feat(profile): 2006 yearbook table and photo route".

### Task 4: Profile section and hide/show (site repo)

**Files:**
- Modify: `views.mjs` (`page.person`: new `yearbook` argument rendered after Then / Now)
- Modify: `worker.mjs` (person route passes `yearbookEntry`; `/profile` POST handles `iimages-hide` / `iimages-show`; admin action pair `iimages-hide`/`iimages-show` with `audit`)
- Modify: `theme.mjs` (section styles: photo 4:5 frame, 4px radius, stacked under 700px)
- Modify: `docs/operations.md` (import steps)
- Test: `test/iimages2006.test.mjs`

**Interfaces:**
- Consumes: Task 3 functions.
- Produces: section markup `<section class="profile-section profile-iimages" id="iimages-2006">` with `<h2>From the 2006 yearbook</h2>`, `<img src="/media/iimages/<id>?w=480">` when `hasPhoto`, heading + `· <dorm>`, write-up paragraphs as `<p>`.

- [ ] **Step 1: Write failing tests:** `profile shows heading, dorm and every paragraph`; `write-up with <script> & "quotes" is escaped`; `visitor sees no section when hidden; owner sees the hidden line and Show it again`; `owner Hide then Show round-trips`; `another member cannot hide someone else's entry` (POST as member 2 for member 1 changes nothing); `admin hide writes audit`; `no section and no img when no entry / no photo`.
- [ ] **Step 2:** Run `node --test test/iimages2006.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the section, the routes and the styles.
- [ ] **Step 4:** Run `node --test`. Expected: all pass.
- [ ] **Step 5:** Commit: "feat(profile): From the 2006 yearbook section with owner hide"; produce `0006-profile-2006-yearbook.patch` for Hari.

### Task 5: Go live (Hari, with checks)

- [ ] **Step 1:** Hari merges the PR; Cloudflare deploys.
- [ ] **Step 2:** `npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0022_iimages_2006.sql`
- [ ] **Step 3:** `bash people/private/iimages-2006/upload-photos.sh` (272 uploads).
- [ ] **Step 4:** `npx wrangler d1 execute iima-2006-alumni --remote --file people/private/iimages-2006/iimages-2006.sql`
- [ ] **Step 5:** Check in the browser: `/people/251` shows Tahseen's photo and write-up; Hari's own profile shows Hide; after Hide a visitor view (another admin preview) shows no section and `/media/iimages/88` 404s for others.
