CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY,
 recipient INTEGER NOT NULL REFERENCES roster(id),
 actor INTEGER REFERENCES roster(id),
 kind TEXT NOT NULL CHECK(kind IN ('mention','like','comment','tag')),
 post TEXT REFERENCES posts(id),
 anchor TEXT NOT NULL DEFAULT '',
 event_key TEXT NOT NULL,
 created INTEGER NOT NULL DEFAULT (unixepoch()),
 is_read INTEGER NOT NULL DEFAULT 0,
 sample INTEGER NOT NULL DEFAULT 0,
 UNIQUE(recipient,event_key)
);
CREATE INDEX IF NOT EXISTS notification_inbox ON notifications(recipient,is_read,id);

CREATE TABLE IF NOT EXISTS notification_tag_actor (
 post TEXT PRIMARY KEY REFERENCES posts(id), actor INTEGER NOT NULL REFERENCES roster(id)
);

CREATE TRIGGER IF NOT EXISTS notify_like AFTER INSERT ON likes
WHEN 1
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,NEW.member,'like',p.id,'','like:'||NEW.post||':'||NEW.member
 FROM posts p WHERE p.id=NEW.post AND p.author<>NEW.member;
END;

CREATE TRIGGER IF NOT EXISTS notify_comment AFTER INSERT ON comments
WHEN NEW.hidden=0
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,NEW.author,'comment',p.id,'comment-'||NEW.id,'comment:'||NEW.id
 FROM posts p WHERE p.id=NEW.post AND p.author<>NEW.author;
END;

CREATE TRIGGER IF NOT EXISTS notify_accepted_mention AFTER INSERT ON tags
WHEN NEW.status='accepted' AND (SELECT actor FROM notification_tag_actor WHERE post=NEW.post) IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT r.id,(SELECT actor FROM notification_tag_actor WHERE post=NEW.post),'mention',NEW.post,'','mention:'||NEW.post||':'||''
 FROM roster r WHERE 1 AND r.id=NEW.member AND r.id<>(SELECT actor FROM notification_tag_actor WHERE post=NEW.post);
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,(SELECT actor FROM notification_tag_actor WHERE post=NEW.post),'tag',p.id,'','person:'||NEW.post||':'||NEW.member
 FROM posts p WHERE p.id=NEW.post AND p.author<>(SELECT actor FROM notification_tag_actor WHERE post=NEW.post);
END;

CREATE TRIGGER IF NOT EXISTS notify_updated_mention AFTER UPDATE OF status ON tags
WHEN NEW.status='accepted' AND OLD.status='pending' AND (SELECT actor FROM notification_tag_actor WHERE post=NEW.post) IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT r.id,(SELECT actor FROM notification_tag_actor WHERE post=NEW.post),'mention',NEW.post,'','mention:'||NEW.post||':'||''
 FROM roster r WHERE 1 AND r.id=NEW.member AND r.id<>(SELECT actor FROM notification_tag_actor WHERE post=NEW.post);
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,(SELECT actor FROM notification_tag_actor WHERE post=NEW.post),'tag',p.id,'','person:'||NEW.post||':'||NEW.member
 FROM posts p WHERE p.id=NEW.post AND p.author<>(SELECT actor FROM notification_tag_actor WHERE post=NEW.post);
END;

CREATE TRIGGER IF NOT EXISTS notify_about AFTER INSERT ON memory_about
WHEN NEW.kind IN ('person','topic')
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT r.id,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'mention',NEW.post,'','mention:'||NEW.post||':'||''
 FROM roster r WHERE NEW.kind='person' AND r.id=CAST(NEW.target AS INTEGER) AND r.id<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'tag',p.id,'','about:'||NEW.post||':'||''||':'||NEW.kind||':'||NEW.target
 FROM posts p WHERE p.id=NEW.post AND p.author<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
END;

CREATE TRIGGER IF NOT EXISTS notify_photo AFTER INSERT ON photo_tags
WHEN NEW.kind IN ('person','topic')
BEGIN
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT r.id,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'mention',NEW.post,'photo-'||replace(NEW.media,'/','-'),'mention:'||NEW.post||':'||'photo-'||replace(NEW.media,'/','-')
 FROM roster r WHERE NEW.kind='person' AND r.id=CAST(NEW.target AS INTEGER) AND r.id<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
 INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
 SELECT p.author,coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post)),'tag',p.id,'photo-'||replace(NEW.media,'/','-'),'photo:'||NEW.post||':'||'photo-'||replace(NEW.media,'/','-')||':'||NEW.kind||':'||NEW.target
 FROM posts p WHERE p.id=NEW.post AND p.author<>coalesce((SELECT actor FROM notification_tag_actor WHERE post=NEW.post),(SELECT author FROM posts WHERE id=NEW.post));
END;

INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key,created,is_read)
 SELECT p.author,c.author,'comment',p.id,'comment-'||c.id,'comment:'||c.id,c.created/1000,
   c.created<=coalesce(r.seen,0)
 FROM comments c JOIN posts p ON p.id=c.post
 LEFT JOIN notification_reads r ON r.member=p.author
 WHERE c.hidden=0 AND c.author<>p.author;
