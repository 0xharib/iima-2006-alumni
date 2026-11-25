-- Per-member profile completion summary.
-- Home reads this small table instead of resolving every classmate's profile fields on each visit.
-- The 0017 triggers re-evaluated the whole-roster completion view on every profile write, including
-- writes unrelated to completion. These replacements resolve only the changed member, and only when a
-- source that can affect the seven requirements changes.
--
-- Safe to rerun. It is additive for the Worker: code that still uses the 0017 completion query keeps
-- working, and profile_completion keeps its first-completion history and semantics.

CREATE TABLE IF NOT EXISTS profile_completion_state (
 member INTEGER PRIMARY KEY REFERENCES roster(id),
 -- Public counts approved enrichment only; pilot also counts pending enrichment (ACCESS_MODE=pilot).
 complete_public INTEGER NOT NULL DEFAULT 0,
 complete_pilot INTEGER NOT NULL DEFAULT 0,
 city_public TEXT,
 life_public TEXT,
 city_pilot TEXT,
 life_pilot TEXT,
 refreshed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS profile_completion_state_public ON profile_completion_state(member) WHERE complete_public=1;
CREATE INDEX IF NOT EXISTS profile_completion_state_pilot ON profile_completion_state(member) WHERE complete_pilot=1;

-- Inserting a member here recomputes that member's summary inside the same statement and transaction
-- as the source write. record_history=0 is used only by the backfill below.
CREATE TABLE IF NOT EXISTS profile_completion_refresh (
 member INTEGER NOT NULL,
 record_history INTEGER NOT NULL DEFAULT 1
);

DROP TRIGGER IF EXISTS profile_completion_refresh_apply;
CREATE TRIGGER profile_completion_refresh_apply AFTER INSERT ON profile_completion_refresh
BEGIN
 INSERT INTO profile_completion_state(member,complete_public,complete_pilot,city_public,life_public,city_pilot,life_pilot,refreshed_at)
 SELECT member,
  base_ok AND trim(coalesce(city_public,''))<>'' AND trim(coalesce(life_public,''))<>'',
  base_ok AND trim(coalesce(city_pilot,''))<>'' AND trim(coalesce(life_pilot,''))<>'',
  city_public,life_public,city_pilot,life_pilot,
  CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 FROM (
  SELECT member,
   trim(coalesce(dorm,''))<>'' AND trim(coalesce(nickname,''))<>'' AND trim(coalesce(family,''))<>''
    AND has_then AND has_now AS base_ok,
   coalesce(owner_city,yearbook_city,CASE WHEN seed_status='approved' THEN seed_city END) AS city_public,
   coalesce(owner_life,yearbook_life,CASE WHEN seed_status='approved' THEN seed_life END) AS life_public,
   coalesce(owner_city,yearbook_city,seed_city) AS city_pilot,
   coalesce(owner_life,yearbook_life,seed_life) AS life_pilot
  FROM (
   SELECT r.id AS member,
    -- Owner rows win, including an explicitly blank owner value; then the published yearbook entry;
    -- then selected enrichment. Matches selected_profile_fields and the 0017 completion view.
    coalesce((SELECT value FROM profile_fields WHERE member=r.id AND field='dorm'),
     CASE WHEN json_type(y.fields,'$.dorm')='text' THEN json_extract(y.fields,'$.dorm') END,r.dorm) AS dorm,
    coalesce((SELECT value FROM profile_fields WHERE member=r.id AND field='nickname'),
     CASE WHEN json_type(y.fields,'$.nickname')='text' THEN json_extract(y.fields,'$.nickname') END,r.nickname) AS nickname,
    coalesce((SELECT value FROM profile_fields WHERE member=r.id AND field='family'),
     CASE WHEN json_type(y.fields,'$.family')='text' THEN json_extract(y.fields,'$.family') END) AS family,
    (SELECT value FROM profile_fields WHERE member=r.id AND field='city') AS owner_city,
    (SELECT value FROM profile_fields WHERE member=r.id AND field='life') AS owner_life,
    CASE WHEN json_type(y.fields,'$.city')='text' THEN json_extract(y.fields,'$.city') END AS yearbook_city,
    CASE WHEN json_type(y.fields,'$.life')='text' THEN json_extract(y.fields,'$.life') END AS yearbook_life,
    s.review_status AS seed_status,
    CASE WHEN json_type(s.source_data,'$."Tracker city"')='text' THEN json_extract(s.source_data,'$."Tracker city"') END AS seed_city,
    CASE WHEN json_type(s.source_data,'$."Life, Lately draft"')='text' THEN json_extract(s.source_data,'$."Life, Lately draft"') END AS seed_life,
    EXISTS(SELECT 1 FROM profile_fields WHERE member=r.id AND field='thenPhotoObject' AND trim(value)<>'')
     OR EXISTS(SELECT 1 FROM yearbook_public yp,json_each(yp.images) j
      JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission') AND ph.object_key=json_extract(j.value,'$.key')
      WHERE yp.member=r.id AND ph.slot='then') AS has_then,
    EXISTS(SELECT 1 FROM profile_fields WHERE member=r.id AND field='nowPhotoObject' AND trim(value)<>'')
     OR EXISTS(SELECT 1 FROM yearbook_public yp,json_each(yp.images) j
      JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission') AND ph.object_key=json_extract(j.value,'$.key')
      WHERE yp.member=r.id AND ph.slot='now') AS has_now
   FROM roster r
   LEFT JOIN (SELECT member,fields FROM yearbook_public WHERE member=NEW.member AND json_valid(fields)) y ON y.member=r.id
   LEFT JOIN (SELECT roster_id,review_status,source_data FROM profile_seeds
     WHERE roster_id=NEW.member AND review_status IN ('approved','pending') AND json_valid(source_data)) s ON s.roster_id=r.id
   WHERE r.id=NEW.member
  )
 ) WHERE 1
 ON CONFLICT(member) DO UPDATE SET complete_public=excluded.complete_public,complete_pilot=excluded.complete_pilot,
  city_public=excluded.city_public,life_public=excluded.life_public,city_pilot=excluded.city_pilot,
  life_pilot=excluded.life_pilot,refreshed_at=excluded.refreshed_at;
 -- First public completion is recorded once and never moved by later edits or recompletion.
 INSERT INTO profile_completion(member,completed_at,basis)
 SELECT member,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),'recorded'
 FROM profile_completion_state WHERE member=NEW.member AND complete_public=1 AND NEW.record_history=1
 ON CONFLICT(member) DO NOTHING;
 DELETE FROM profile_completion_refresh WHERE member=NEW.member;
END;

-- Replace the 0017 whole-roster triggers with member-scoped ones.
DROP TRIGGER IF EXISTS completion_profile_fields_insert;
DROP TRIGGER IF EXISTS completion_profile_fields_update;
DROP TRIGGER IF EXISTS completion_profile_fields_delete;
DROP TRIGGER IF EXISTS completion_yearbook_public_insert;
DROP TRIGGER IF EXISTS completion_yearbook_public_update;
DROP TRIGGER IF EXISTS completion_yearbook_public_delete;
DROP TRIGGER IF EXISTS completion_roster_insert;
DROP TRIGGER IF EXISTS completion_roster_update;
DROP TRIGGER IF EXISTS completion_profile_seeds_insert;
DROP TRIGGER IF EXISTS completion_profile_seeds_update;
DROP TRIGGER IF EXISTS completion_photos_insert;
DROP TRIGGER IF EXISTS completion_photos_update;

-- Only these profile fields can change completion or the summary's display values.
CREATE TRIGGER IF NOT EXISTS completion_summary_profile_fields_insert AFTER INSERT ON profile_fields
WHEN NEW.field IN ('dorm','nickname','city','life','family','thenPhotoObject','nowPhotoObject')
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(NEW.member); END;
CREATE TRIGGER IF NOT EXISTS completion_summary_profile_fields_update AFTER UPDATE ON profile_fields
WHEN (NEW.field IN ('dorm','nickname','city','life','family','thenPhotoObject','nowPhotoObject')
  OR OLD.field IN ('dorm','nickname','city','life','family','thenPhotoObject','nowPhotoObject'))
 AND (OLD.value IS NOT NEW.value OR OLD.field IS NOT NEW.field OR OLD.member IS NOT NEW.member)
BEGIN
 INSERT INTO profile_completion_refresh(member) VALUES(NEW.member);
 INSERT INTO profile_completion_refresh(member) SELECT OLD.member WHERE OLD.member IS NOT NEW.member;
END;
-- Deleting an owner override can reveal an imported value, so deletes refresh too.
CREATE TRIGGER IF NOT EXISTS completion_summary_profile_fields_delete AFTER DELETE ON profile_fields
WHEN OLD.field IN ('dorm','nickname','city','life','family','thenPhotoObject','nowPhotoObject')
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(OLD.member); END;

CREATE TRIGGER IF NOT EXISTS completion_summary_yearbook_insert AFTER INSERT ON yearbook_public
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(NEW.member); END;
CREATE TRIGGER IF NOT EXISTS completion_summary_yearbook_update AFTER UPDATE ON yearbook_public
WHEN OLD.fields IS NOT NEW.fields OR OLD.images IS NOT NEW.images OR OLD.member IS NOT NEW.member
BEGIN
 INSERT INTO profile_completion_refresh(member) VALUES(NEW.member);
 INSERT INTO profile_completion_refresh(member) SELECT OLD.member WHERE OLD.member IS NOT NEW.member;
END;
CREATE TRIGGER IF NOT EXISTS completion_summary_yearbook_delete AFTER DELETE ON yearbook_public
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(OLD.member); END;

CREATE TRIGGER IF NOT EXISTS completion_summary_roster_insert AFTER INSERT ON roster
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(NEW.id); END;
CREATE TRIGGER IF NOT EXISTS completion_summary_roster_update AFTER UPDATE ON roster
WHEN OLD.dorm IS NOT NEW.dorm OR OLD.nickname IS NOT NEW.nickname OR OLD.id IS NOT NEW.id
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(NEW.id); END;

CREATE TRIGGER IF NOT EXISTS completion_summary_seeds_insert AFTER INSERT ON profile_seeds
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(NEW.roster_id); END;
CREATE TRIGGER IF NOT EXISTS completion_summary_seeds_update AFTER UPDATE ON profile_seeds
WHEN OLD.review_status IS NOT NEW.review_status OR OLD.source_data IS NOT NEW.source_data OR OLD.roster_id IS NOT NEW.roster_id
BEGIN
 INSERT INTO profile_completion_refresh(member) VALUES(NEW.roster_id);
 INSERT INTO profile_completion_refresh(member) SELECT OLD.roster_id WHERE OLD.roster_id IS NOT NEW.roster_id;
END;
CREATE TRIGGER IF NOT EXISTS completion_summary_seeds_delete AFTER DELETE ON profile_seeds
BEGIN INSERT INTO profile_completion_refresh(member) VALUES(OLD.roster_id); END;

-- Legacy yearbook photos count through the published entry that references them.
CREATE TRIGGER IF NOT EXISTS completion_summary_photos_insert AFTER INSERT ON photos
WHEN NEW.slot IN ('then','now')
BEGIN INSERT INTO profile_completion_refresh(member) SELECT subject FROM submissions WHERE id=NEW.submission AND subject IS NOT NULL; END;
CREATE TRIGGER IF NOT EXISTS completion_summary_photos_update AFTER UPDATE ON photos
WHEN OLD.slot IS NOT NEW.slot OR OLD.submission IS NOT NEW.submission OR OLD.object_key IS NOT NEW.object_key
BEGIN
 INSERT INTO profile_completion_refresh(member) SELECT subject FROM submissions
  WHERE id IN (NEW.submission,OLD.submission) AND subject IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS completion_summary_photos_delete AFTER DELETE ON photos
WHEN OLD.slot IN ('then','now')
BEGIN INSERT INTO profile_completion_refresh(member) SELECT subject FROM submissions WHERE id=OLD.submission AND subject IS NOT NULL; END;

-- One-time bounded backfill: one refresh per roster member, without inventing completion dates.
INSERT INTO profile_completion_refresh(member,record_history) SELECT id,0 FROM roster;
-- A currently complete profile with no recorded history keeps an unknown (baseline) date.
INSERT INTO profile_completion(member,basis)
 SELECT member,'baseline' FROM profile_completion_state WHERE complete_public=1
 ON CONFLICT(member) DO NOTHING;
