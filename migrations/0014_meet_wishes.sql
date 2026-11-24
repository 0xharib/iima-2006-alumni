-- "Who are you looking forward to meeting?" Each row is one classmate hoping to meet another.
-- Members see their own list; a target only ever sees a count.
CREATE TABLE IF NOT EXISTS meet_wishes (
  member INTEGER NOT NULL REFERENCES roster(id),
  target INTEGER NOT NULL REFERENCES roster(id),
  created INTEGER NOT NULL,
  PRIMARY KEY(member,target),
  CHECK(member<>target)
);
CREATE INDEX IF NOT EXISTS meet_wishes_target ON meet_wishes(target);
