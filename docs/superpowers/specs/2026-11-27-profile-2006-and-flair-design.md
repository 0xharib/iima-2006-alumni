# Profile pages: "From the 2006 yearbook"

Asked for by Hari on 27 Nov 2026. Builds on the yearbook extraction in his IIMA_Year_Book folder
(`output/people/yearbook_people.csv`, `people/roster_join.csv`, the cropped yearbook photos) and the earlier decision
(26 Nov): "We will design a blast from the past section for each person on their profile page."

Scope, as Hari settled it on 27 Nov: the yearbook section only. "Actually remove all flairs. Let's just get the
yearbook profile page going." Write-ups are shown as printed and the owner can hide theirs.

## Intent

The site is a living yearbook for the 20-year reunion. Every batchmate's profile should carry their page from
*iimages 2006*: the photo and the write-up their dorm-mates printed about them, in the 2006 voice. It should feel like
turning to your own page in the old yearbook.

## Goals

1. **From the 2006 yearbook** section on each profile that has an entry: the yearbook photo, the heading as printed
   (e.g. "Tahseen aka Mixie"), the dorm, and the write-up as printed.
2. **Owner can hide** their 2006 write-up and photo, and show them again at any time. Admins can hide or show anyone's.
3. Members only: tables in D1, images in R2, served through the same signed-in media route as other photos.

## Non-goals

- Any flair: Poll of the Year awards, posts held, Young Alumni Achiever Awards (data kept, see "Later").
- Writing anything into `profile_fields`, `profile_seeds` or the roster (Hari, 26 Nov: "Write back nothing").
- Owners editing the write-up text. It is an archive: show or hide, nothing else.
- Using the yearbook photo as anyone's profile picture or portrait fallback.
- A link to the scanned page (other people's write-ups are on it, so a hidden write-up would still be readable there).
- The memorial/homage page for Sachin Kumar Suman (277). His entry is imported so a later homage change can use it.
- A yearbook browse or search page across everyone.

## Anti-goals

- Write-ups shown with machine-reading errors. Every write-up is proofread against its page before import.
- 2006 material readable outside the signed-in site: no data or images in the public GitHub repository, no public URLs.
- An owner's hide that doesn't stick, or that a later import silently undoes.

## Approaches considered

- **A. New members-only table, loaded by an import file (chosen by Hari).** Keeps the 2006 archive apart from what
  owners type into their profiles, so owner edits can never overwrite it and "hide" has one clear meaning.
- **B. Into the existing profile fields.** Mixes 2006 material with owner-edited fields; an owner's edit could replace
  the archive text.
- **C. Bundled into the site's code.** The repository is public on GitHub. Ruled out.

## Data

Source: `people/roster_join.csv` (yearbook profile → roster id) and `output/people/yearbook_people.csv` (heading,
dorm, page, photo file, write-up) in Hari's IIMA_Year_Book folder. Imported: rows whose match is `high`, `confirmed`,
`likely` or `in memoriam` (274 people). Not imported: `excluded` and `no roster row`.

**Write-ups.** 51 are reviewed; 228 are machine-read drafts. Before import every draft is proofread against its page
image (`pdf_page`) and corrected to match the print exactly (printed spelling, punctuation and emoticons kept). Done in
the yearbook repo, recorded as `writeup_status = reviewed`, committed there.

**Photos.** The 272 yearbook photo crops, converted to WebP at their crop size, uploaded to R2 as
`iimages-2006/photo/<member>.webp`.

## Design

### Table (migration `0022_iimages_2006.sql`)

```sql
CREATE TABLE IF NOT EXISTS iimages_2006 (
  member INTEGER PRIMARY KEY REFERENCES roster(id),
  heading TEXT NOT NULL,        -- as printed, e.g. 'Tahseen aka Mixie'
  dorm TEXT NOT NULL,           -- 'D-1'
  writeup TEXT NOT NULL,        -- proofread, as printed; paragraphs separated by a blank line
  page INTEGER NOT NULL,        -- page in the PDF (reference only; not linked)
  photo_key TEXT,               -- R2 key, or NULL if the yearbook printed no photo
  hidden INTEGER NOT NULL DEFAULT 0,   -- set by the owner or an admin; the import never touches it
  hidden_by INTEGER,
  hidden_at INTEGER
);
```

The import (`iimages-2006.sql`, generated in the yearbook repo, kept in Hari's private folder, outside git) uses
`INSERT … ON CONFLICT(member) DO UPDATE SET heading=…, dorm=…, writeup=…, page=…, photo_key=…` and never sets `hidden`,
so re-running it keeps every owner's choice. Photos are uploaded by a generated shell script of
`wrangler r2 object put` lines that Hari runs.

### Media

One new case in the signed-in `/media/` route, next to `seed` and `portrait`: `/media/iimages/<member>` serves
`photo_key` while `hidden = 0`, and always to the owner and admins. Sizes come from the existing `?w=` variants.

### Profile page

A section placed after Then / Now and before the long-form entries:

```
  FROM THE 2006 YEARBOOK                                              iimages 2006
  ┌──────────┐  Tahseen aka Mixie · D-1
  │  photo   │  If you are looking for a genuine smile, a shoulder to cry on, …
  │  (2006)  │  … You rock girl and we love you. Be just the way you are...always.
  └──────────┘
  [Hide my 2006 write-up]                                  ← owner only
```

- Photo left (4:5 frame, 4px radius), text right; stacked on mobile. Opens in the existing photo viewer.
- Heading in the display serif, dorm after it; write-up in the editorial serif, paragraphs preserved.
- **Owner view, hidden:** one line, "Your 2006 write-up is hidden from batchmates." with "Show it again".
  **Visitor view, hidden:** no section. **No entry:** no section.
- Hide/show: a form posting to `/profile` with `action=iimages-hide` / `iimages-show` (owner only), recorded in
  `hidden_by`/`hidden_at`. Admins: the same pair on the admin people view, written to `audit`.

### Before the migration has run

The page works as today: queries on the new table are guarded the way face tagging guards its tables, so the code can
be deployed first.

## Constraints

- Members-only; no new public routes. No 2006 data or images in the repository.
- Import statements under D1's 100 KB statement limit.
- Delivery: patch from Hari's folder, PR from his fork, merged into Arun's `main`; Hari runs migration, R2 upload and
  import with `wrangler`.
- Tests in `node --test` with the existing fixture.

## Left to the builder

- Exact styling within the redesign tokens; the admin control's placement.

## Order of work

1. Proofread the 228 draft write-ups in the yearbook repo; commit.
2. Generate the import SQL, WebP photos and R2 upload script into `people/private/iimages-2006/`.
3. Site: migration 0022, media case, section, hide/show, tests, docs. Patch to Hari.
4. Hari: merge, run migration, upload photos, run import. Check `/people/251` (Tahseen) and a hidden profile in owner
   and visitor views.

## Later (collected, not built)

Poll of the Year 2006 awards (48 people; the "Gandhi" and "Bihari" attributions confirmed by Hari on 27 Nov), posts
held 2004–06 (78 people), and the IIMA Young Alumni Achiever Awards (9 people: 111, 188, 159, 236, 69, 36, 33, 60, 152,
with years and categories in Hari's flair sheet). Adding them later is a new table and an import.
