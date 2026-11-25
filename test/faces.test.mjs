import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('manual photo tags still notify; auto photo tags do not', async()=>{
  const {sqlite}=fixture();
  sqlite.exec(`INSERT INTO posts(id,author,body,created) VALUES('p1',1,'x',1)`);
  sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target) VALUES('p1','post/a','person','2')`);
  sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1','post/b','person','2','auto')`);
  const rows=sqlite.prepare("SELECT anchor FROM notifications WHERE recipient=2").all();
  assert.deepEqual(rows.map(r=>r.anchor),['photo-post-a']);
});

test('face tables exist and photo_tags rejects an unknown origin', ()=>{
  const {sqlite}=fixture();
  for (const t of ['face_prefs','face_refs','face_scans','faces','face_matches'])
    assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t);
  sqlite.exec(`INSERT INTO posts(id,author,body,created) VALUES('x',1,'x',1)`);
  assert.throws(()=>sqlite.exec(`INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('x','m','person','2','robot')`));
});
