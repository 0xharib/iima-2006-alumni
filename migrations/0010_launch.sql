CREATE VIEW IF NOT EXISTS selected_profile_fields AS
WITH seed_fields(field, source_key) AS (
 VALUES ('life','Life, Lately draft'),('city','Tracker city'),('company','Tracker company'),
 ('country','Tracker country'),('section','Section'),('education','Education'),
 ('professionalFocus','Professional focus'),('researchHighlight','Research highlight')
)
SELECT member,field,value,'owner' AS source,3 AS priority,0 AS pilot_only
 FROM profile_fields WHERE field<>'portraitObject'
UNION ALL
SELECT y.member,j.key,j.value,'published_submission',2,0
 FROM yearbook_public y, json_each(CASE WHEN json_valid(y.fields) THEN y.fields ELSE '{}' END) j
 WHERE j.type='text'
UNION ALL
SELECT s.roster_id,k.field,json_extract(s.source_data,'$."'||k.source_key||'"'),'selected_enrichment',1,s.review_status='pending'
 FROM profile_seeds s CROSS JOIN seed_fields k
 WHERE s.review_status IN ('approved','pending') AND json_valid(s.source_data)
 AND json_type(s.source_data,'$."'||k.source_key||'"')='text';

CREATE INDEX IF NOT EXISTS comments_post_visible ON comments(post,hidden,created,id);
CREATE INDEX IF NOT EXISTS uploads_post ON uploads(post,id);
CREATE INDEX IF NOT EXISTS posts_author_visible ON posts(author,hidden,created);
CREATE INDEX IF NOT EXISTS memory_about_target ON memory_about(kind,target,post);
CREATE INDEX IF NOT EXISTS tags_member_status ON tags(member,status,post);
CREATE INDEX IF NOT EXISTS submissions_subject_kind ON submissions(subject,kind,contributor);
