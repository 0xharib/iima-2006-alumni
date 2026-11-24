CREATE TABLE IF NOT EXISTS roster_sections (
  member INTEGER PRIMARY KEY REFERENCES roster(id),
  section TEXT NOT NULL
);
INSERT OR IGNORE INTO topics(id,title,kind) VALUES
 ('chaos','Chaos','Event'),('confluence','Confluence','Event'),
 ('taanstafl','Taanstafl','Place'),('lkp','LKP','Place');
UPDATE tags SET status='accepted' WHERE status='pending';
