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

import { assign, toVector, vectorBytes, faceMode, FACE_BAR } from '../faces.mjs';
const unitVec=i=>{const a=new Float32Array(512);a[i]=1;return a;};
const mixVec=(i,j,w)=>{const a=new Float32Array(512);a[i]=w;a[j]=Math.sqrt(1-w*w);return a;};

test('assign gives each face and each member at most once, best first, at or above the bar', ()=>{
  const refs=new Map([[7,[unitVec(0),unitVec(5)]],[8,[unitVec(1)]]]);
  const faces=[{id:1,vector:mixVec(0,1,0.9)},{id:2,vector:mixVec(0,1,0.8)},{id:3,vector:unitVec(9)}];
  assert.deepEqual(assign(faces,refs).map(p=>[p.face,p.member]),[[1,7],[2,8]]);
});
test('a member just under the bar is not assigned', ()=>{
  assert.equal(FACE_BAR,0.35);
  assert.deepEqual(assign([{id:1,vector:mixVec(0,1,0.349)}],new Map([[7,[unitVec(0)]]])),[]);
  assert.equal(assign([{id:1,vector:mixVec(0,1,0.351)}],new Map([[7,[unitVec(0)]]])).length,1);
});
test('toVector reads every blob shape D1 and node:sqlite return', ()=>{
  const f=new Float32Array([0.5,-1]); const bytes=vectorBytes(f);
  for (const blob of [bytes,bytes.buffer,[...bytes]]) assert.deepEqual([...toVector(blob)],[0.5,-1]);
});
test('faceMode defaults to off', ()=>{
  assert.equal(faceMode({}),'off'); assert.equal(faceMode({FACE_TAGGING:'shadow'}),'shadow');
  assert.equal(faceMode({FACE_TAGGING:'on'}),'on'); assert.equal(faceMode({FACE_TAGGING:'yes'}),'off');
});
