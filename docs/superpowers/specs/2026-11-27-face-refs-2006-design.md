# Face tagging: 2006 reference photos (short design)

Changes `2026-11-26-face-tagging-batch-design.md`. Asked for by Hari on 26–27 Nov 2026: batchmates without a profile
picture should be found in photos too, using the Placecom album (post `9f4bdfad…`, 270 studio portraits from 2006) and
the iimages 2006 yearbook PDF as the base for everyone's appearance.

## What changes

- **The 2006 group.** Members without a profile picture of their own. They are matched only when the new switch
  `FACE_TAGGING_2006` (off | shadow | on, unset = off) allows it. It never goes further than `FACE_TAGGING`, and it stays
  off until migration 0021 has run. With it at shadow or on, everyone on the roster is eligible; whether someone can be
  found depends on having a usable reference face. Members with a profile picture are unaffected by the switch.
- **Two new reference sources** (migration 0021 widens `face_refs.source`):
  - `tagged`: a photo tagged by hand where the photo has exactly one face (80 px or more) and exactly one person tag.
    The face comes from the stored scan, so nothing is analysed again. This covers the Placecom album.
  - `archive`: one face per member from the iimages yearbook PDF, stored in `face_archive`. The embeddings are computed
    offline with the same model and pipeline as `face-service/app.py` and imported once by an admin; the crops are not
    stored on the site.
- **Consistency check.** A member's references must agree: each one has to score 0.30 (`AGREE`) or more against at
  least one of the member's other references. The ones that don't are left out and listed for admins at
  `/admin/faces` (`face_ref_notes`). If no two agree, only the most trusted is kept (profile picture, tagged photo, seed
  portrait, Then, Now, yearbook PDF).
- **A higher bar for 2006 photos.** A match that rests on a `tagged` or `archive` reference needs 0.40
  (`FACE_BAR_2006`); current photos (profile picture, Then/Now, seed portrait) keep 0.35. In Hari's labelled test photos
  the 2006 references at 0.35 named two wrong people (Jay Dave and Arup Ghosh at 0.36, which Hari rejected on 27 Nov);
  at 0.40 there were none and nobody else was lost.
- **Rebuilds.** A hand tag on a photo marks that person's references for a rebuild, and so does scanning a one-face
  photo that carries one hand tag. The batch builds references for the whole roster while the 2006 group is on.
- **Shadow for the new group.** While `FACE_TAGGING=on` and `FACE_TAGGING_2006=shadow`, the 2006 group's matches are
  written as shadow matches (marked "2006" on the admin page) and **Publish** leaves them alone; members with a profile
  picture are tagged as before.
- **Switching it off** removes the 2006 group's references and automatic tags at the next batch (Not me and hand tags
  stay), as for anyone who is no longer eligible.
- The Home nudge ("Add a profile picture…") is shown only to people who cannot be matched.

## Evidence (offline, 26 Nov 2026; `face-test/refs2006` in Hari's yearbook folder)

InsightFace buffalo_l, bar 0.35:
- Placecom face vs everyone's yearbook PDF face: right person first 196/204; at 0.35, 187 right, 0 wrong.
- Seed portrait vs the 2006 photos: 213/217 first; at 0.35, 206 right, 0 wrong.
- Labelled site photos (with Hari's 27 Nov answers): seeds + 2006 found 114/120. At 0.35 for everything it also made 2
  wrong matches; with 0.40 for 2006 references it made none and still found 114/120, plus 18 people with no current
  portrait in faces that had been labelled "not in profiles".
- The consistency check, run on the same data, leaves out exactly the bad references found by eye (a seed portrait of
  someone else, a seed with the face hidden, a half-hidden Then photo, poor PDF scans) and changes none of the results.
- Coverage: 52 people have no usable current portrait; 51 of them get a 2006 reference.

## Rollout

1. Deploy, then run `migrations/0021_face_refs_2006.sql`.
2. Import the yearbook PDF faces (`face-archive-2006.sql`, kept outside the repository because it holds face data).
3. Set `FACE_TAGGING_2006=shadow`. After the next batch and its finish job, check the "2006" shadow matches and the
   "Reference photos left out" list at `/admin/faces`.
4. Set `FACE_TAGGING_2006=on`, then press **Publish** at `/admin/faces`: the 2006 group's shadow matches become tags
   and each person gets one summary. From then on the 3-hour batch does the rest.
