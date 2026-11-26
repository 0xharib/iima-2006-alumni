-- Preview album editing: preserve removed originals, tags and face records.
CREATE TABLE IF NOT EXISTS removed_album_photos (
 photo TEXT PRIMARY KEY REFERENCES uploads(id), removed INTEGER NOT NULL
);
CREATE VIEW IF NOT EXISTS active_uploads AS
 SELECT u.* FROM uploads u WHERE NOT EXISTS(SELECT 1 FROM removed_album_photos r WHERE r.photo=u.id);
CREATE VIEW IF NOT EXISTS active_photo_tags AS
 SELECT t.* FROM photo_tags t WHERE NOT EXISTS(SELECT 1 FROM removed_album_photos r WHERE t.media='post/'||r.photo);

CREATE TABLE IF NOT EXISTS album_versions(post TEXT PRIMARY KEY REFERENCES posts(id),version INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS guard_album_version BEFORE INSERT ON album_versions
WHEN NEW.version <> coalesce((SELECT version FROM album_versions WHERE post=NEW.post),0)+1
BEGIN SELECT RAISE(ABORT,'Album changed'); END;

CREATE VIEW IF NOT EXISTS active_faces AS
 SELECT f.* FROM faces f WHERE NOT EXISTS(SELECT 1 FROM removed_album_photos r WHERE f.media='post/'||r.photo);
CREATE VIEW IF NOT EXISTS active_face_matches AS
 SELECT f.* FROM face_matches f WHERE NOT EXISTS(SELECT 1 FROM removed_album_photos r WHERE f.media='post/'||r.photo);
