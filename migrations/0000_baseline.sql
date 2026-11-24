CREATE TABLE IF NOT EXISTS roster(id INTEGER PRIMARY KEY,name TEXT,dorm TEXT,nickname TEXT);
CREATE TABLE IF NOT EXISTS reminder_contacts(batchmate_id INTEGER,email TEXT);
CREATE TABLE IF NOT EXISTS reminder_mobiles(batchmate_id INTEGER,mobile TEXT);
CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,subject INTEGER,contributor INTEGER,kind TEXT,payload TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS photos(submission TEXT,object_key TEXT,slot TEXT,caption TEXT,PRIMARY KEY(submission,object_key));
CREATE TABLE IF NOT EXISTS profile_seeds(roster_id INTEGER PRIMARY KEY,source_data TEXT,review_status TEXT,portrait_key TEXT);
