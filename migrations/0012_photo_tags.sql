CREATE TABLE IF NOT EXISTS photo_tags (
 post TEXT NOT NULL REFERENCES posts(id),
 media TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('person','topic')),
 target TEXT NOT NULL,
 PRIMARY KEY(post,media,kind,target)
);
