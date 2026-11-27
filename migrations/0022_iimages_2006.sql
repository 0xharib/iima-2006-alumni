-- The 2006 yearbook (iimages) entry for each classmate: heading, dorm and write-up as printed, plus the printed photo.
-- Filled by a private import (iimages-2006.sql) that upserts every column except hidden, so re-running it keeps
-- each owner's choice to hide their entry.
CREATE TABLE IF NOT EXISTS iimages_2006 (
  member INTEGER PRIMARY KEY REFERENCES roster(id),
  heading TEXT NOT NULL,
  dorm TEXT NOT NULL,
  writeup TEXT NOT NULL,
  page INTEGER NOT NULL,
  photo_key TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_by INTEGER,
  hidden_at INTEGER
);
