CREATE TABLE IF NOT EXISTS memory_albums (
  post TEXT PRIMARY KEY REFERENCES posts(id),
  title TEXT NOT NULL,
  cover TEXT NOT NULL,
  photo_order TEXT NOT NULL CHECK(json_valid(photo_order))
);

CREATE TRIGGER IF NOT EXISTS prevent_memory_photo_reassignment
BEFORE UPDATE OF post ON uploads
WHEN OLD.post IS NOT NULL AND NEW.post IS NOT OLD.post
BEGIN
  SELECT RAISE(ABORT,'Photo already belongs to a memory');
END;
