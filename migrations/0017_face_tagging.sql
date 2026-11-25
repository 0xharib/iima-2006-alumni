-- Automatic face tagging. Creates tables and adds photo_tags.origin; it changes no existing rows.
-- Run it only AFTER the Worker with face tagging is deployed: older Workers insert into photo_tags without column
-- names and would fail once the new column exists. The new Worker works with or without this migration.
--   npx wrangler d1 execute iima-2006-alumni --remote --file migrations/0017_face_tagging.sql
-- notify_photo is recreated unchanged except that it now ignores automatic tags, which send their own notification.

CREATE TABLE IF NOT EXISTS face_prefs (
 member INTEGER PRIMARY KEY REFERENCES roster(id),
 recognise INTEGER NOT NULL CHECK(recognise IN (0,1)),
 decided INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS face_refs (
 member INTEGER NOT NULL REFERENCES roster(id),
 source TEXT NOT NULL CHECK(source IN ('portrait','then','now','yearbook')),
 object_key TEXT NOT NULL,
 embedding BLOB NOT NULL,
 model TEXT NOT NULL,
 PRIMARY KEY(member,source)
);
CREATE TABLE IF NOT EXISTS face_scans (
 media TEXT PRIMARY KEY,
 post TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('done','failed')),
 faces INTEGER NOT NULL DEFAULT 0,
 model TEXT NOT NULL,
 scanned INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS face_scans_post ON face_scans(post);
CREATE TABLE IF NOT EXISTS faces (
 id INTEGER PRIMARY KEY,
 media TEXT NOT NULL,
 post TEXT NOT NULL,
 box TEXT NOT NULL,
 score REAL NOT NULL,
 size INTEGER NOT NULL,
 embedding BLOB NOT NULL,
 model TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS faces_media ON faces(media);
CREATE INDEX IF NOT EXISTS faces_post ON faces(post);
CREATE TABLE IF NOT EXISTS face_matches (
 media TEXT NOT NULL,
 member INTEGER NOT NULL REFERENCES roster(id),
 post TEXT NOT NULL,
 face INTEGER,
 score REAL NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('shadow','auto','removed')),
 created INTEGER NOT NULL,
 notified INTEGER NOT NULL DEFAULT 1,  -- 0: an automatic tag the member has not been told about yet (hourly summary)
 PRIMARY KEY(media,member)
);
CREATE INDEX IF NOT EXISTS face_matches_member ON face_matches(member,state);
CREATE INDEX IF NOT EXISTS face_matches_post ON face_matches(post);

ALTER TABLE photo_tags ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','auto'));

DROP TRIGGER IF EXISTS notify_photo;
CREATE TRIGGER notify_photo AFTER INSERT ON photo_tags
WHEN NEW.kind IN ('person','topic') AND NEW.origin='manual'
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT r.id,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'mention',NEW.post,'photo-'||replace(NEW.media,'/','-'),'mention:'||NEW.post||':'||'photo-'||replace(NEW.media,'/','-')
 FROM roster r WHERE NEW.kind='person' AND r.id=CAST(NEW.target AS INTEGER) AND r.id<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'tag',p.id,'photo-'||replace(NEW.media,'/','-'),'photo:'||NEW.post||':'||'photo-'||replace(NEW.media,'/','-')||':'||NEW.kind||':'||NEW.target
 FROM posts p WHERE p.id=NEW.post AND p.author<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
END;
