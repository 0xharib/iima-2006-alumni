-- Preserve explicit owner selections. Only the most recent self-entry represents each profile.
WITH latest AS (
  SELECT s.*, row_number() OVER (PARTITION BY s.subject ORDER BY s.created DESC, s.id DESC) AS rank
  FROM submissions s JOIN roster r ON r.id=s.subject
  WHERE kind='self' AND subject=contributor AND json_valid(payload)
)
INSERT OR IGNORE INTO yearbook_public (member,fields,images)
SELECT subject,
  (SELECT json_group_object(key,value) FROM json_each(payload)
    WHERE type='text' AND trim(value)<>'' AND key IN
    ('life','city','company','education','dorm','family','nickname','interests','outsideWork',
     'moment','firstDayAdvice','reunionStory','anythingElse','extra','prompt','printName')),
  (SELECT json_group_array(json_object('submission',submission,'key',object_key))
    FROM (SELECT submission,object_key FROM photos WHERE submission=latest.id ORDER BY slot,object_key))
FROM latest WHERE rank=1;

-- Legacy contributions retain their subject and attribution, and reuse private photo objects.
INSERT OR IGNORE INTO posts (id,author,subject,body,created,origin)
SELECT 'legacy-'||s.id,s.contributor,s.subject,
  coalesce(nullif(trim(json_extract(s.payload,'$.story')),''),'Shared a yearbook photo.'),
  coalesce(unixepoch(s.created)*1000,0),s.id
FROM submissions s
JOIN roster author ON author.id=s.contributor
JOIN roster subject ON subject.id=s.subject
WHERE s.kind='memory' AND json_valid(s.payload)
AND (nullif(trim(json_extract(s.payload,'$.story')),'') IS NOT NULL
     OR EXISTS(SELECT 1 FROM photos WHERE submission=s.id));

UPDATE profile_seeds SET review_status='approved' WHERE review_status='pending';
