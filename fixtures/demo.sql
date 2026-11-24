INSERT OR IGNORE INTO roster(id,name,dorm,nickname) VALUES
 (1,'Demo Admin','Dorm 1',''), (2,'Demo Classmate','Dorm 2','');
INSERT INTO reminder_contacts(batchmate_id,email)
 SELECT 2,'classmate@example.test'
 WHERE NOT EXISTS (SELECT 1 FROM reminder_contacts WHERE batchmate_id=2);
INSERT OR IGNORE INTO members(id,role,invited) VALUES (1,'admin',1),(2,'member',1);
INSERT OR IGNORE INTO reunion_tracker(member,status) VALUES (2,'attending');
