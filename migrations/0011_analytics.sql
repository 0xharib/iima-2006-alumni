CREATE TABLE IF NOT EXISTS site_events (
 id INTEGER PRIMARY KEY, occurred INTEGER NOT NULL, member INTEGER,
 event TEXT NOT NULL CHECK(event IN ('page_view','sign_in','email_accepted','email_failed','link_invalid')),
 path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_events_date ON site_events(occurred DESC);
