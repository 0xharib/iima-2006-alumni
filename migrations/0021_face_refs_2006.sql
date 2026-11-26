-- Face references from 2006 photos (docs/superpowers/specs/2026-11-27-face-refs-2006-design.md).
--   npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0021_face_refs_2006.sql
-- Run it after the Worker that knows these sources is deployed. Safe to run again: face_refs is rebuilt from itself.
-- Changes no tags, matches or notifications.

-- face_refs gains two sources:
--   tagged:  a hand-tagged photo with exactly one face and exactly one person tag (for example the Placecom album);
--            the face comes from the stored scan, so nothing is analysed again
--   archive: a face from the iimages 2006 yearbook PDF, imported once into face_archive
CREATE TABLE IF NOT EXISTS face_refs_next (
 member INTEGER NOT NULL REFERENCES roster(id),
 source TEXT NOT NULL CHECK(source IN ('portrait','then','now','yearbook','tagged','archive')),
 object_key TEXT NOT NULL,
 embedding BLOB NOT NULL,
 model TEXT NOT NULL,
 PRIMARY KEY(member,source)
);
INSERT OR IGNORE INTO face_refs_next SELECT member,source,object_key,embedding,model FROM face_refs;
DROP TABLE face_refs;
ALTER TABLE face_refs_next RENAME TO face_refs;

-- One face per member from the 2006 yearbook PDF. Embeddings are computed offline with the same model and imported
-- by an admin; the cropped photos themselves are not stored on the site.
CREATE TABLE IF NOT EXISTS face_archive (
 member INTEGER PRIMARY KEY REFERENCES roster(id),
 object_key TEXT NOT NULL,     -- where the crop came from, e.g. iimages/D-1/tahseen.png
 embedding BLOB NOT NULL,
 model TEXT NOT NULL
);

-- Reference photos left out because they disagree with the member's other references (wrong person, a logo, a face
-- hidden by hair, a poor scan). Shown to admins at /admin/faces; rewritten on every rebuild.
CREATE TABLE IF NOT EXISTS face_ref_notes (
 member INTEGER NOT NULL REFERENCES roster(id),
 source TEXT NOT NULL,
 object_key TEXT NOT NULL,
 agreement REAL NOT NULL,      -- best similarity to any of the member's other references
 noted INTEGER NOT NULL,
 PRIMARY KEY(member,source)
);
