CREATE TABLE IF NOT EXISTS memory_about (
  post TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','topic')),
  target TEXT NOT NULL,
  PRIMARY KEY (post,kind,target)
);
CREATE INDEX IF NOT EXISTS memory_about_target ON memory_about(kind,target,post);
