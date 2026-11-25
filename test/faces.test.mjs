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
  assert.match(id,/^matcher-[01]$/); assert.match(url,/^https:\/\/faces\/faces\?mode=(photo|portrait)$/);
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

import { scanPhoto, handleQueue } from '../faces.mjs';

function faceWorld(mode='on'){
  const fx=fixture(); const {sqlite,env,objects}=fx;
  sqlite.exec(`INSERT INTO roster VALUES(3,'Third Person','D3','TP'),(4,'Fourth Person','D4','FP')`);
  env.FACE_TAGGING=mode;
  fx.photoFaces={}; fx.serviceDown=false;
  // The fake service reads the photo's first byte and returns one unit vector per listed dimension.
  env.FACES={idFromName:n=>n,get:()=>({fetch:async(url,init)=>{
    if(fx.serviceDown) return new Response('down',{status:503});
    const dims=fx.photoFaces[new Uint8Array(init.body)[0]]||[];
    return Response.json({model:'buffalo_l/w600k_r50',width:100,height:100,faces:dims.map((d,i)=>({box:[i*50,0,i*50+40,40],score:0.9,size:40,
      embedding:Buffer.from(vectorBytes(unitVec(d))).toString('base64')}))});
  }})};
  fx.consent=(member,dim,recognise=1)=>{
    sqlite.prepare('INSERT OR REPLACE INTO face_prefs VALUES(?,?,1)').run(member,recognise);
    sqlite.prepare("INSERT OR REPLACE INTO face_refs VALUES(?,'portrait','k',?,'buffalo_l/w600k_r50')").run(member,vectorBytes(unitVec(dim)));
  };
  fx.photo=(post,id,byte,author=1)=>{
    if(!sqlite.prepare('SELECT 1 FROM posts WHERE id=?').get(post)) sqlite.prepare('INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?)').run(post,author,'x',1);
    objects.set('social/'+id,new Uint8Array([byte]));
    sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)').run(id,author,'social/'+id,'image/jpeg','h'+id,'',post,1);
    return 'post/'+id;
  };
  return fx;
}
const message=body=>{const m={body,attempts:1,acked:0,retried:null,ack(){m.acked++;},retry(o){m.retried=o;}};return m;};

test('on mode tags a consenting member and records the match', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0,9];
  const out=await scanPhoto(w.env,'p1',m);
  assert.deepEqual(out,{faces:2,tagged:[2]});
  assert.deepEqual(w.sqlite.prepare("SELECT media,kind,target,origin FROM photo_tags").all().map(r=>({...r})),[{media:m,kind:'person',target:'2',origin:'auto'}]);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=? AND member=2").get(m).state,'auto');
  assert.equal(w.sqlite.prepare("SELECT status,faces FROM face_scans WHERE media=?").get(m).faces,2);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM faces WHERE media=?").get(m).n,2);
});
test('shadow mode records matches but tags and notifies nobody', async()=>{
  const w=faceWorld('shadow'); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',m);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=?").get(m).state,'shadow');
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags").get().n,0);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications").get().n,0);
});
test('off mode does nothing', async()=>{
  const w=faceWorld('off'); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  assert.deepEqual(await scanPhoto(w.env,'p1',m),{faces:0,tagged:[]});
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM face_scans").get().n,0);
});
test('non-consenting members are never matched', async()=>{
  const w=faceWorld(); w.consent(4,0,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  assert.deepEqual((await scanPhoto(w.env,'p1',m)).tagged,[]);
});
test('one notification per person per memory', async()=>{
  const w=faceWorld(); w.consent(2,0);
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0];
  await scanPhoto(w.env,'p1',a,'post'); await scanPhoto(w.env,'p1',b,'post');  // jobs from a new memory; the in-memory fixture cannot nest transactions
  const rows=w.sqlite.prepare("SELECT actor,kind,post,event_key FROM notifications WHERE recipient=2").all().map(r=>({...r}));
  assert.deepEqual(rows,[{actor:1,kind:'mention',post:'p1',event_key:'found:p1'}]);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2'").get().n,2);
});
test('uploader is tagged without notifying themselves', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1,2); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',m);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2'").get().n,1);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,0);
});
test('Not me is respected on rescan', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  w.sqlite.prepare("INSERT INTO face_matches VALUES(?,2,'p1',NULL,0.9,'removed',1,1)").run(m);
  assert.deepEqual((await scanPhoto(w.env,'p1',m)).tagged,[]);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=?").get(m).state,'removed');
});
test('a member already tagged by hand is not tagged again', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES('p1',?,'person','2')").run(m);
  assert.deepEqual((await scanPhoto(w.env,'p1',m)).tagged,[]);
  assert.equal(w.sqlite.prepare("SELECT origin FROM photo_tags").get().origin,'manual');
});
test('media job retries when the face service fails', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.serviceDown=true;
  const msg=message({type:'media',post:'p1',media:m});
  await handleQueue({messages:[msg]},w.env);
  assert.equal(msg.acked,0); assert.deepEqual(msg.retried,{delaySeconds:30});
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM faces").get().n,0);
  w.serviceDown=false; const ok=message({type:'media',post:'p1',media:m});
  await handleQueue({messages:[ok]},w.env); assert.equal(ok.acked,1);
});
test('a job that keeps failing is recorded as a failed scan', async()=>{
  const w=faceWorld(); const m=w.photo('p1','u1',1); w.serviceDown=true;
  const msg=message({type:'media',post:'p1',media:m}); msg.attempts=5;
  await handleQueue({messages:[msg]},w.env);
  assert.equal(w.sqlite.prepare("SELECT status FROM face_scans WHERE media=?").get(m).status,'failed');
});
test('posting queues each photo and never fails because of the queue', async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
  for (const queue of [undefined,{sendBatch:async()=>{throw new Error('queue down');}},'record']) {
    const w=faceWorld(); const ck=await w.session(2,'bbbb'); const sent=[];
    if(queue==='record') w.env.FACE_JOBS={sendBatch:async msgs=>{sent.push(...msgs);}}; else if(queue) w.env.FACE_JOBS=queue;
    const f=new FormData(); const key=crypto.randomUUID(); f.set('id',key); f.set('body','Hello');
    f.append('images',new File([png],'a.png',{type:'image/png'}));
    const res=await w.call('/compose',ck,f);
    assert.equal(res.status,303,await res.text());
    if(queue==='record'){
      assert.equal(sent.length,1); assert.equal(sent[0].body.type,'media'); assert.equal(sent[0].body.post,key);
      assert.match(sent[0].body.media,/^post\/[0-9a-f-]{36}$/);
    }
  }
});
test('hiding a post removes its faces', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',m);
  const ck=await w.session(1,'aaaa');
  assert.equal((await w.call('/posts/p1',ck,{action:'delete'})).status,303);
  for (const t of ['faces','face_scans','face_matches']) assert.equal(w.sqlite.prepare(`SELECT count(*) n FROM ${t}`).get().n,0,t);
  assert.deepEqual(await scanPhoto(w.env,'p1',m),{faces:0,tagged:[]});
});

import { refreshRefs, rematchMember } from '../faces.mjs';
const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
const storedFace=(w,media,post,dim)=>w.sqlite.prepare("INSERT INTO faces(media,post,box,score,size,embedding,model) VALUES(?,?,'[0,0,40,40]',0.9,40,?,'buffalo_l/w600k_r50')").run(media,post,vectorBytes(unitVec(dim))).lastInsertRowid;

test('consent card shows once and Not now hides it', async()=>{
  const w=faceWorld(); const ck=await w.session(2,'bbbb');
  const home=await (await w.call('/',ck)).text();
  assert.match(home,/Find me in batch photos\?/);
  assert.match(home,/We use your profile photos and your 2006 yearbook photo to find you in batch photos\. You can turn this off any time\./);
  const res=await w.call('/faces/consent',ck,{choice:'no',next:'/'});
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/');
  assert.doesNotMatch(await (await w.call('/',ck)).text(),/Find me in batch photos\?/);
  assert.equal(w.sqlite.prepare('SELECT recognise FROM face_prefs WHERE member=2').get().recognise,0);
});
test('consent card is hidden while face tagging is off', async()=>{
  const w=faceWorld('off'); const ck=await w.session(2,'bbbb');
  assert.doesNotMatch(await (await w.call('/',ck)).text(),/Find me in batch photos/);
  assert.equal((await w.call('/faces/consent',ck,{choice:'yes'})).status,404);
});
test('yes builds refs from own photos and the yearbook portrait', async()=>{
  const w=faceWorld(); const ck=await w.session(2,'bbbb'); const sent=[];
  w.env.FACE_JOBS={send:async body=>{sent.push(body);},sendBatch:async()=>{}};
  w.objects.set('profile/p2',new Uint8Array([5])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'portraitObject','profile/p2')");
  w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'");
  w.photoFaces[5]=[0]; w.photoFaces[1]=[0];   // portrait.jpg (the fixture's yearbook portrait) starts with byte 1
  assert.equal((await w.call('/faces/consent',ck,{choice:'yes',next:'/people/2'})).status,303);
  assert.deepEqual(sent,[{type:'ref',member:2}]);
  await handleQueue({messages:[message(sent[0])]},w.env);
  assert.deepEqual(w.sqlite.prepare('SELECT source,object_key FROM face_refs WHERE member=2 ORDER BY source').all().map(r=>[r.source,r.object_key]),
    [['portrait','profile/p2'],['yearbook','portrait.jpg']]);
});
test('a profile photo with no face leaves no reference', async()=>{
  const w=faceWorld(); w.consent(2,0);
  w.objects.set('profile/p2',new Uint8Array([7])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'portraitObject','profile/p2')");
  w.sqlite.exec("UPDATE face_refs SET object_key='profile/p2'");   // the old portrait ref
  assert.equal(await refreshRefs(w.env,2),0);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs WHERE member=2').get().n,0);
});
test('rematch tags earlier photos and sends one summary', async()=>{
  const w=faceWorld(); w.consent(2,0);
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2);
  w.sqlite.exec("UPDATE posts SET created=5 WHERE id='p2'");
  storedFace(w,a,'p1',0); storedFace(w,b,'p2',0); storedFace(w,b,'p2',9);
  assert.equal(await rematchMember(w.env,2),2);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2' AND origin='auto'").get().n,2);
  const notes=w.sqlite.prepare('SELECT actor,post,anchor,event_key FROM notifications WHERE recipient=2').all();
  assert.equal(notes.length,1); assert.equal(notes[0].actor,null); assert.equal(notes[0].post,'p2');
  assert.equal(notes[0].anchor,'photo-'+b.replace('/','-')); assert.match(notes[0].event_key,/^found-all:2:\d+$/);
});
test('rematch leaves a face that already belongs to someone else', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1);
  const face=storedFace(w,a,'p1',0);
  w.sqlite.prepare("INSERT INTO face_matches VALUES(?,3,'p1',?,0.95,'auto',1,1)").run(a,face);
  assert.equal(await rematchMember(w.env,2),0);
});
test('withdrawing removes auto tags but keeps manual tags', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES('p1',?,'person','2')").run(b);
  await w.call('/faces/consent',ck,{choice:'no'});
  assert.deepEqual(w.sqlite.prepare("SELECT media,origin FROM photo_tags WHERE target='2'").all().map(r=>[r.media,r.origin]),[[b,'manual']]);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs WHERE member=2').get().n,0);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_matches WHERE member=2').get().n,0);
});
test('re-consent restores tags but keeps Not me', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0];
  await scanPhoto(w.env,'p1',a); await scanPhoto(w.env,'p2',b);
  w.sqlite.prepare("UPDATE face_matches SET state='removed' WHERE media=?").run(b);
  w.sqlite.prepare("DELETE FROM photo_tags WHERE media=?").run(b);
  await w.call('/faces/consent',ck,{choice:'no'});
  w.consent(2,0);
  await rematchMember(w.env,2);
  assert.deepEqual(w.sqlite.prepare("SELECT media FROM photo_tags WHERE target='2'").all().map(r=>r.media),[a]);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=? AND member=2").get(b).state,'removed');
});
test('saving a new Then photo queues a ref job only for consenting members', async()=>{
  for (const recognise of [1,0]) {
    const w=faceWorld(); const ck=await w.session(2,'bbbb'); const sent=[];
    w.env.FACE_JOBS={send:async body=>{sent.push(body);},sendBatch:async()=>{}};
    w.sqlite.prepare('INSERT INTO face_prefs VALUES(2,?,1)').run(recognise);
    const f=new FormData(); f.set('field','thenPhotoObject'); f.set('photo',new File([pngBytes],'t.png',{type:'image/png'}));
    assert.equal((await w.call('/profile',ck,f)).status,303);
    assert.deepEqual(sent,recognise?[{type:'ref',member:2}]:[]);
  }
});
test('own profile shows the switch and the note beside photo uploads', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const page=await (await w.call('/people/2',ck)).text();
  assert.match(page,/Find me in batch photos: On/);
  assert.match(page,/We use your profile photos and your 2006 yearbook photo/);
  assert.doesNotMatch(await (await w.call('/people/2',await w.session(1,'aaaa'))).text(),/Find me in batch photos/);
});

const apostrophe="(?:'|&#39;|&#x27;|’)";
test('found notification reads You are in 2 photos and opens the photo', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0];
  await scanPhoto(w.env,'p1',a,'post'); await scanPhoto(w.env,'p1',b,'post');
  const page=await (await w.call('/notifications',ck)).text();
  assert.match(page,new RegExp(`You${apostrophe}re in 2 photos`));
  const id=w.sqlite.prepare("SELECT id FROM notifications WHERE recipient=2").get().id;
  const open=await w.call('/notifications?open='+id,ck);
  assert.equal(open.headers.get('location'),'/posts/p1#photo-post-u1');
});
test('found-all notification opens Photos of you', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2); storedFace(w,a,'p1',0); storedFace(w,b,'p2',0);
  await rematchMember(w.env,2);
  const page=await (await w.call('/notifications',ck)).text();
  assert.match(page,/We found you in 2 photos/); assert.match(page,/Batch photos/);
  const id=w.sqlite.prepare("SELECT id FROM notifications WHERE recipient=2").get().id;
  assert.equal((await w.call('/notifications?open='+id,ck)).headers.get('location'),'/photos-of-you');
});
test('Not me removes only my own auto tag and sticks', async()=>{
  const w=faceWorld(); w.consent(2,0); w.consent(3,1); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2); w.photoFaces[1]=[0,1];
  await scanPhoto(w.env,'p1',a);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES('p1',?,'person','2')").run(b);
  const res=await w.call('/faces/not-me',ck,{media:a,next:'/photos-of-you'});
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/photos-of-you');
  assert.deepEqual(w.sqlite.prepare("SELECT media,target,origin FROM photo_tags ORDER BY target,media").all().map(r=>[r.media,r.target,r.origin]),
    [[b,'2','manual'],[a,'3','auto']]);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=? AND member=2").get(a).state,'removed');
  assert.equal((await w.call('/faces/not-me',ck,{media:b})).status,404);
  await scanPhoto(w.env,'p1',a);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE media=? AND target='2'").get(a).n,0);
});
test('profile gallery shows photos I am tagged in, uploaded and legacy', async()=>{
  const w=faceWorld(); const ck=await w.session(1,'aaaa');
  const a=w.photo('p1','u1',1);
  w.sqlite.exec(`INSERT INTO posts(id,author,body,created,origin) VALUES('lp',1,'old',1,'sub1');
    INSERT INTO photos VALUES('sub1','old1.jpg','memory','Old one')`);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1',?,'person','2','auto'),('lp','legacy/lp/1','person','2','auto')").run(a);
  const page=await (await w.call('/people/2',ck)).text();
  assert.match(page,/\/media\/post\/u1/); assert.match(page,/\/media\/legacy\/lp\/1/);
});
test('Photos of you shows Not me only on auto tags', async()=>{
  const w=faceWorld(); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1',?,'person','2','auto'),('p2',?,'person','2','manual')").run(a,b);
  const page=await (await w.call('/photos-of-you',ck)).text();
  assert.match(page,/\/media\/post\/u1/); assert.match(page,/\/media\/post\/u2/);
  assert.equal((page.match(/action="\/faces\/not-me"/g)||[]).length,1);
});
test('the memory page offers Not me on my own auto tag only', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.match(await (await w.call('/posts/p1',await w.session(2,'bbbb'))).text(),/action="\/faces\/not-me"/);
  assert.doesNotMatch(await (await w.call('/posts/p1',await w.session(1,'aaaa'))).text(),/action="\/faces\/not-me"/);
});

import { sweep } from '../faces.mjs';
test('sweep queues unscanned visible photos including legacy ones, and nothing when off', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async()=>{}};
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2), hidden=w.photo('p3','u3',3);
  w.sqlite.exec(`UPDATE posts SET hidden=1 WHERE id='p3'; INSERT INTO posts(id,author,body,created,origin) VALUES('lp',1,'old',1,'sub1');
    INSERT INTO photos VALUES('sub1','old1.jpg','memory','Old one')`);
  w.sqlite.prepare("INSERT INTO face_scans(media,post,status,faces,model,scanned) VALUES(?,'p2','done',0,'m',1)").run(b);
  assert.equal(await sweep(w.env),2);
  assert.deepEqual(sent.map(m=>m.body.media).sort(),['legacy/lp/1',a]);
  assert.deepEqual(sent.map(m=>m.body.type),['media','media']);
  const off=faceWorld('off'); off.env.FACE_JOBS=w.env.FACE_JOBS; off.photo('p1','u1',1);
  assert.equal(await sweep(off.env),0);
});
test('failed scans are swept again', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);}};
  const a=w.photo('p1','u1',1); w.sqlite.prepare("INSERT INTO face_scans(media,post,status,faces,model,scanned) VALUES(?,'p1','failed',0,'m',1)").run(a);
  assert.equal(await sweep(w.env),1);
});
test('the Worker runs the sweep on its schedule', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);}}; w.photo('p1','u1',1);
  await workerModule.default.scheduled({cron:'17 * * * *'},w.env,{waitUntil(){}});
  assert.equal(sent.length,1);
});
test('admin faces page is admin-only and shows counts without embeddings', async()=>{
  const w=faceWorld('shadow'); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.notEqual((await w.call('/admin/faces',await w.session(2,'bbbb'))).status,200);
  const page=await (await w.call('/admin/faces',await w.session(1,'aaaa'))).text();
  assert.match(page,/Face tagging/); assert.match(page,/shadow/i); assert.match(page,/Test Classmate/);
  assert.match(page,/\/media\/post\/u1\?w=256/);
  assert.doesNotMatch(page,/embedding/i);
});
test('publish turns shadow matches into tags with one summary each', async()=>{
  const w=faceWorld('shadow'); w.consent(2,0); const ck=await w.session(1,'aaaa');
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0];
  await scanPhoto(w.env,'p1',a); await scanPhoto(w.env,'p2',b);
  assert.equal((await w.call('/admin/faces',ck,{action:'publish'})).status,400);   // only once switched on
  w.env.FACE_TAGGING='on';
  const res=await w.call('/admin/faces',ck,{action:'publish'});
  assert.equal(res.status,303);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2' AND origin='auto'").get().n,2);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM face_matches WHERE state='shadow'").get().n,0);
  const notes=w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all();
  assert.equal(notes.length,1); assert.match(notes[0].event_key,/^found-all:2:/);
});
test('scan-all queues everything unscanned', async()=>{
  const w=faceWorld('shadow'); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);}};
  w.photo('p1','u1',1); w.photo('p2','u2',2);
  const res=await w.call('/admin/faces',await w.session(1,'aaaa'),{action:'scan-all'});
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/admin/faces?queued=2'); assert.equal(sent.length,2);
});

// ---------- final review fixes ----------
import { consentState, publishShadow, writeMatches } from '../faces.mjs';

test('C1: before migration 0017 the site works and hides face tagging', async()=>{
  const w=fixture({skip:['0017_face_tagging.sql']}); w.env.FACE_TAGGING='shadow';
  const ck=await w.session(2,'bbbb'), admin=await w.session(1,'aaaa');
  w.sqlite.exec(`INSERT INTO posts(id,author,body,created) VALUES('p1',2,'x',1); INSERT INTO uploads VALUES('u1',2,'social/u1','image/jpeg','h','','p1',1)`);
  w.objects.set('social/u1',new Uint8Array([1]));
  const home=await w.call('/',ck); assert.equal(home.status,200); assert.doesNotMatch(await home.text(),/Find me in batch photos/);
  assert.equal((await w.call('/posts/p1',ck)).status,200);
  assert.equal((await w.call('/notifications',ck)).status,200);
  assert.equal((await w.call('/people/2',ck)).status,200);
  assert.equal((await w.call('/posts/p1',ck,{action:'tag-add',photo:'post/u1',tag:'1'})).status<500,true);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags").get().n,1);
  assert.equal((await w.call('/faces/consent',ck,{choice:'yes'})).status,404);
  assert.equal((await w.call('/posts/p1',ck,{action:'delete'})).status,303);
  assert.equal((await w.call('/admin/faces',admin)).status,200);
});

test('I2: the sweep re-queues reference jobs for members who said yes but have no references', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async b=>{sent.push({body:b});}};
  w.sqlite.exec('INSERT INTO face_prefs VALUES(2,1,1),(3,0,1)'); w.consent(4,0);
  await sweep(w.env);
  assert.deepEqual(sent.filter(m=>m.body.type==='ref').map(m=>m.body.member),[2]);
  const msg=message({type:'ref',member:2}); msg.attempts=5; w.serviceDown=true;
  w.objects.set('profile/p2',new Uint8Array([5])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'portraitObject','profile/p2')");
  await handleQueue({messages:[msg]},w.env); assert.equal(msg.acked,1);   // given up on; the sweep retries it
});

test('I3/I4: re-matching many photos stays within D1 limits and summarises only new tags, once', async()=>{
  const w=faceWorld(); w.consent(2,0);
  let queries=0; const prepare=w.env.DB.prepare.bind(w.env.DB);
  w.env.DB={...w.env.DB,prepare(sql){ if((sql.match(/\?/g)||[]).length>100) throw new Error('too many SQL variables'); queries++; return prepare(sql); },batch:w.env.DB.batch.bind(w.env.DB)};
  for(let i=0;i<150;i++){ const m=w.photo('p'+i,'u'+i,1); storedFace(w,m,'p'+i,0); }
  assert.equal(await rematchMember(w.env,2),150);
  assert.ok(queries<400,'queries '+queries);
  const notes=()=>w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all().map(r=>r.event_key);
  assert.equal(notes().length,1); assert.match(notes()[0],/^found-all:150:/);
  assert.equal(await rematchMember(w.env,2),0);         // a profile photo change: nothing new, no new summary
  assert.equal(notes().length,1);
});

test('I3: publishing hundreds of shadow matches converts them all with one summary each', async()=>{
  const w=faceWorld('shadow'); w.consent(2,0); w.consent(3,1);
  for(let i=0;i<300;i++){ const m=w.photo('p'+i,'u'+i,1);
    w.sqlite.prepare("INSERT INTO face_matches VALUES(?,?,?,NULL,0.6,'shadow',1,1)").run(m,2+(i%2),'p'+i); }
  w.env.FACE_TAGGING='on';
  assert.equal(await publishShadow(w.env),300);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE origin='auto'").get().n,300);
  assert.deepEqual(w.sqlite.prepare("SELECT recipient,event_key FROM notifications ORDER BY recipient").all().map(r=>[r.recipient,r.event_key.split(':')[1]]),[[2,'150'],[3,'150']]);
});

test('I10/M6: photos found by the sweep wait for one summary, which leaves out your own uploads', async()=>{
  const w=faceWorld(); w.consent(2,0);
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2), own=w.photo('p3','u3',3,2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0]; w.photoFaces[3]=[0];
  for (const [m,p] of [[a,'p1'],[b,'p2'],[own,'p3']]) await handleQueue({messages:[message({type:'media',post:p,media:m})]},w.env);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,0);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2'").get().n,3);
  await workerModule.default.scheduled({},w.env);
  const notes=w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all();
  assert.equal(notes.length,1); assert.match(notes[0].event_key,/^found-all:2:/);
  await workerModule.default.scheduled({},w.env);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,1);
});
test('I10: a photo job from a new memory still notifies per memory', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await handleQueue({messages:[message({type:'media',post:'p1',media:a,notify:'post'})]},w.env);
  assert.equal(w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").get().event_key,'found:p1');
  await workerModule.default.scheduled({},w.env);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,1);
});

test('I5: a family Then photo uses the face that matches the yearbook, or none', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); w.sqlite.exec('INSERT INTO face_prefs VALUES(2,1,1)');
  w.objects.set('profile/t2',new Uint8Array([6])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'thenPhotoObject','profile/t2')");
  w.photoFaces[1]=[0]; w.photoFaces[6]=[3,0];          // partner (dim 3) first, the batchmate (dim 0) second
  assert.equal(await refreshRefs(w.env,2),2);
  const then=w.sqlite.prepare("SELECT embedding FROM face_refs WHERE member=2 AND source='then'").get();
  assert.equal(toVector(then.embedding)[0],1);
  w.photoFaces[1]=[];                                   // no yearbook face to compare with: drop the family photo
  assert.equal(await refreshRefs(w.env,2),0);
});
test('I6: only an approved seed portrait is used', async()=>{
  const w=faceWorld(); w.sqlite.exec('INSERT INTO face_prefs VALUES(2,1,1)'); w.photoFaces[1]=[0];
  assert.equal(await refreshRefs(w.env,2),0);           // the fixture's seed is pending review
  w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'");
  assert.equal(await refreshRefs(w.env,2),1);
});
test('M10: one unreadable reference photo does not stop the others', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); w.sqlite.exec('INSERT INTO face_prefs VALUES(2,1,1)');
  w.photoFaces[1]=[0];
  w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'nowPhotoObject','profile/missing')");
  const real=w.env.FACES; w.env.FACES={idFromName:n=>n,get:id=>({fetch:async(u,init)=>new Uint8Array(init.body)[0]===9?new Response('bad',{status:400}):real.get(id).fetch(u,init)})};
  w.objects.set('profile/missing',new Uint8Array([9]));
  assert.equal(await refreshRefs(w.env,2),1);
});

test('I7: withdrawal works while face tagging is off', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  w.env.FACE_TAGGING='off';
  assert.equal(await consentState(w.env,2),'on');
  assert.match(await (await w.call('/people/2',ck)).text(),/Turn off/);
  assert.equal((await w.call('/faces/consent',ck,{choice:'no'})).status,303);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs').get().n,0);
  assert.equal((await w.call('/faces/consent',ck,{choice:'yes'})).status,404);
  assert.equal(await consentState(w.env,2),'hidden');
});

test('I8: a reference job that runs after withdrawal writes nothing', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); w.photoFaces[1]=[0];
  w.sqlite.exec('INSERT INTO face_prefs VALUES(2,0,1)');
  await handleQueue({messages:[message({type:'ref',member:2})]},w.env);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs').get().n,0);
  const a=w.photo('p1','u1',1);
  assert.deepEqual(await writeMatches(w.env,[{media:a,post:'p1',member:2,face:null,score:0.9}],'post'),[]);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM photo_tags').get().n,0);
});

test('M1: a face someone rejected can go to the next-best person', async()=>{
  const w=faceWorld(); w.consent(2,0); w.consent(3,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  w.sqlite.prepare("INSERT INTO face_matches VALUES(?,2,'p1',NULL,0.9,'removed',1,1)").run(a);
  w.sqlite.prepare("UPDATE face_refs SET embedding=? WHERE member=2").run(vectorBytes(mixVec(0,1,0.99)));
  assert.deepEqual((await scanPhoto(w.env,'p1',a)).tagged,[3]);
});

test('I9: jobs are spread over two containers', async()=>{
  const names=new Set(); const env={FACES:{idFromName:n=>{names.add(n);return n;},get:()=>({fetch:async()=>Response.json({model:'m',width:1,height:1,faces:[]})})}};
  for (const key of ['post/a','post/b','post/c','post/d','post/e','post/f']) await analyseImage(env,new Uint8Array([1]),'photo',key);
  assert.deepEqual([...names].sort(),['matcher-0','matcher-1']);
});

test('M5: tagging someone by hand over an automatic tag makes it manual', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(1,'aaaa'); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  w.sqlite.exec(`INSERT INTO memory_albums VALUES('p1','Album','u1','["u1"]')`);
  await scanPhoto(w.env,'p1',a);
  await w.call('/posts/p1',ck,{action:'tag-add',photo:a,tag:'2'});
  assert.equal(w.sqlite.prepare("SELECT origin FROM photo_tags WHERE target='2'").get().origin,'manual');
});

// ---------- small issues ----------
import { readFileSync } from 'node:fs';

test('S1: a re-scan removes automatic tags the new scan no longer supports', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE origin='auto'").get().n,1);
  w.photoFaces[1]=[9];                                  // the face no longer looks like member 2
  await scanPhoto(w.env,'p1',a);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags").get().n,0);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM face_matches").get().n,0);
});
test('S1: a re-scan keeps Not me and manual tags', async()=>{
  const w=faceWorld(); w.consent(2,0); w.consent(3,1); const a=w.photo('p1','u1',1); w.photoFaces[1]=[9];
  w.sqlite.prepare("INSERT INTO face_matches VALUES(?,2,'p1',NULL,0,'removed',1,1)").run(a);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES('p1',?,'person','3')").run(a);
  await scanPhoto(w.env,'p1',a);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE member=2").get().state,'removed');
  assert.equal(w.sqlite.prepare("SELECT origin FROM photo_tags WHERE target='3'").get().origin,'manual');
});

test('S2: a scan records the size of the image its face boxes refer to', async()=>{
  const w=faceWorld(); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  const row=w.sqlite.prepare("SELECT width,height FROM face_scans WHERE media=?").get(a);
  assert.deepEqual([row.width,row.height],[100,100]);
});

test('S3: a very large original is shrunk with Cloudflare Images before matching', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0]; w.photoFaces[7]=[0];
  const big=new Uint8Array(16*1024*1024); big[0]=1; w.objects.set('social/u1',big);
  let asked;
  w.env.IMAGES={input:()=>({transform(o){asked=o;return this;},output:async()=>({response:()=>new Response(new Uint8Array([7]))})})};
  assert.deepEqual((await scanPhoto(w.env,'p1',a)).tagged,[2]);
  assert.deepEqual(asked,{width:1600,height:1600,fit:'scale-down'});
});
test('S3: an image the service cannot read is skipped, not retried every hour', async()=>{
  const w=faceWorld(); const a=w.photo('p1','u1',1);
  w.env.FACES={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({error:'unreadable image'},{status:400})})};
  const msg=message({type:'media',post:'p1',media:a});
  await handleQueue({messages:[msg]},w.env);
  assert.equal(msg.acked,1);
  assert.equal(w.sqlite.prepare("SELECT status FROM face_scans WHERE media=?").get(a).status,'skipped');
  const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);}};
  assert.equal(await sweep(w.env),0);
});

test('S4: Not me clears that memory\'s face notification when nothing is left to show', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2); w.photoFaces[1]=[0]; w.photoFaces[2]=[0];
  await scanPhoto(w.env,'p1',a,'post'); await scanPhoto(w.env,'p1',b,'post');
  await w.call('/faces/not-me',ck,{media:a});
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,1);
  await w.call('/faces/not-me',ck,{media:b});
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,0);
});
test('S4: turning recognition off clears face notifications only', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a,'post');
  w.sqlite.exec("INSERT INTO notifications(recipient,actor,kind,post,anchor,event_key) VALUES(2,1,'like','p1','','like:p1:1'),(2,NULL,'mention','p1','x','found-all:3:1')");
  await w.call('/faces/consent',ck,{choice:'no'});
  assert.deepEqual(w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all().map(r=>r.event_key),['like:p1:1']);
});

test('S5: two requests at once start the container only once', async()=>{
  const log={started:0}; let up=false;
  const state={container:{get running(){return up;},start(){log.started++;},getTcpPort:()=>({fetch:async()=>{if(!up)throw new Error('refused');return new Response('ok');}}),
    destroy:async()=>{},monitor:()=>new Promise(()=>{})},storage:{get:async()=>0,put:async()=>{},setAlarm:async()=>{}}};
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t;
  box.sleep=async ms=>{t+=ms; if(t>=1000) up=true;};
  const [r1,r2]=await Promise.all([box.fetch(new Request('https://faces/health')),box.fetch(new Request('https://faces/health'))]);
  assert.equal(r1.status,200); assert.equal(r2.status,200); assert.equal(log.started,1);
});
test('S5: a container that dies while starting is started again', async()=>{
  const log={started:0}; let up=false, crashed=false;
  const state={container:{get running(){return up;},start(){log.started++; if(log.started>1) up=true;},
    getTcpPort:()=>({fetch:async()=>{if(!up)throw new Error('refused');return new Response('ok');}}),
    destroy:async()=>{},monitor:()=>new Promise((_,reject)=>{ if(!crashed){crashed=true; setTimeout(()=>reject(new Error('exit 1')),0);} })},
    storage:{get:async()=>0,put:async()=>{},setAlarm:async()=>{}}};
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t; box.sleep=async ms=>{t+=ms; await new Promise(r=>setTimeout(r,1));};
  const res=await box.fetch(new Request('https://faces/health'));
  assert.equal(res.status,200); assert.equal(log.started,2);
});

test('S6: migration 0017 can be run again after a failure part-way', ()=>{
  const w=fixture();
  const sql=readFileSync(new URL('../migrations/0017_face_tagging.sql',import.meta.url),'utf8');
  assert.throws(()=>w.sqlite.exec(sql),/duplicate column/);   // a second run fails only at its last step
  assert.match(sql.trim(),/ADD COLUMN origin[^;]*;$/);
  w.sqlite.exec(`INSERT INTO posts(id,author,body,created) VALUES('p1',1,'x',1);
    INSERT INTO photo_tags(post,media,kind,target) VALUES('p1','post/a','person','2')`);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,1);
});
test('S6: hiding a topic forgets the faces of its memories', async()=>{
  const w=faceWorld(); w.consent(2,0); const ck=await w.session(1,'aaaa');
  w.sqlite.exec("INSERT INTO topics(id,title,kind) VALUES('t1','Face test topic','Event')");
  const a=w.photo('p1','u1',1); w.sqlite.exec("UPDATE posts SET topic='t1' WHERE id='p1'"); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.equal((await w.call('/admin',ck,{action:'hide-topic',target:'t1',reason:'test'})).status,303);
  for (const t of ['faces','face_scans']) assert.equal(w.sqlite.prepare(`SELECT count(*) n FROM ${t}`).get().n,0,t);
});
