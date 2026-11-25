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

import { FaceContainer, analyseImage } from '../faces.mjs';

function fakeState(failures) {
  const log={started:0,destroyed:0,calls:0,alarm:null,stored:{}};
  const state={
    container:{running:false,start(){log.started++;this.running=true;},
      getTcpPort(port){assert.equal(port,8080);return {fetch:async(url,init)=>{log.calls++;
        if(log.calls<=failures) throw new Error('connection refused');
        log.url=url; log.body=new Uint8Array(init.body); return new Response('{"ok":true}');}};},
      destroy:async()=>{log.destroyed++;state.container.running=false;}},
    storage:{get:async k=>log.stored[k],put:async(k,v)=>{log.stored[k]=v;},setAlarm:async t=>{log.alarm=t;}}
  };
  return {state,log};
}

test('FaceContainer starts the container once and retries until it answers', async()=>{
  const {state,log}=fakeState(2);
  const box=new FaceContainer(state,{}); box.clock=()=>1000; box.sleep=async()=>{};
  const res=await box.fetch(new Request('https://faces/faces?mode=photo',{method:'POST',body:new Uint8Array([1,2,3])}));
  assert.equal(res.status,200); assert.equal(log.started,1); assert.equal(log.calls,3);
  assert.equal(log.url,'http://container/faces?mode=photo'); assert.deepEqual([...log.body],[1,2,3]);
  assert.equal(log.alarm,1000+5*60*1000);
});
test('FaceContainer gives up with 503 when the container never answers', async()=>{
  const {state}=fakeState(1e9);
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t; box.sleep=async ms=>{t+=ms;};
  const res=await box.fetch(new Request('https://faces/health'));
  assert.equal(res.status,503);
});
test('FaceContainer stops the container after five idle minutes', async()=>{
  const {state,log}=fakeState(0);
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t; box.sleep=async()=>{};
  await box.fetch(new Request('https://faces/health'));
  t=2*60*1000; await box.alarm(); assert.equal(log.destroyed,0); assert.equal(log.alarm,5*60*1000);
  t=6*60*1000; await box.alarm(); assert.equal(log.destroyed,1);
});

const serviceReply=(faces,status=200)=>({idFromName:n=>n,get:id=>({fetch:async(url,init)=>{
  assert.equal(id,'matcher'); assert.match(url,/^https:\/\/faces\/faces\?mode=(photo|portrait)$/);
  return new Response(JSON.stringify({model:'buffalo_l/w600k_r50',width:100,height:80,faces}),{status});}})});
const b64=vec=>Buffer.from(new Uint8Array(new Float32Array(vec).buffer)).toString('base64');

test('analyseImage decodes embeddings into vectors and bytes', async()=>{
  const v=new Float32Array(512); v[3]=1;
  const out=await analyseImage({FACES:serviceReply([{box:[1,2,30,40],score:0.9,size:29,embedding:b64(v)}])},new Uint8Array([9]),'photo');
  assert.equal(out.faces.length,1); assert.equal(out.faces[0].vector[3],1); assert.equal(out.faces[0].bytes.byteLength,2048);
  assert.deepEqual(out.faces[0].box,[1,2,30,40]); assert.equal(out.model,'buffalo_l/w600k_r50');
});
test('analyseImage throws when the face service fails', async()=>{
  await assert.rejects(analyseImage({FACES:serviceReply([],503)},new Uint8Array([9]),'photo'),/face service 503/);
});
test('analyseImage uses FACE_SERVICE_URL for local development', async()=>{
  const real=globalThis.fetch; let seen;
  globalThis.fetch=async(url)=>{seen=url;return new Response(JSON.stringify({model:'m',width:1,height:1,faces:[]}));};
  try { await analyseImage({FACE_SERVICE_URL:'http://localhost:8080'},new Uint8Array([1]),'portrait'); }
  finally { globalThis.fetch=real; }
  assert.equal(seen,'http://localhost:8080/faces?mode=portrait');
});
import * as workerModule from '../worker.mjs';
test('the Worker entry exports the container class', ()=>{ assert.equal(workerModule.FaceContainer,FaceContainer); });
