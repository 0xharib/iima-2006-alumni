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
  assert.equal(log.alarm,1000+60*1000);
});
test('FaceContainer gives up with 503 when the container never answers', async()=>{
  const {state}=fakeState(1e9);
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t; box.sleep=async ms=>{t+=ms;};
  const res=await box.fetch(new Request('https://faces/health'));
  assert.equal(res.status,503);
});
test('FaceContainer stops the container after one idle minute', async()=>{
  const {state,log}=fakeState(0);
  const box=new FaceContainer(state,{}); let t=0; box.clock=()=>t; box.sleep=async()=>{};
  await box.fetch(new Request('https://faces/health'));
  t=30*1000; await box.alarm(); assert.equal(log.destroyed,0); assert.equal(log.alarm,60*1000);
  t=61*1000; await box.alarm(); assert.equal(log.destroyed,1);
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
  // A member with reference faces; picture=0 means no profile picture of their own, so they are not eligible.
  fx.consent=(member,dim,picture=1)=>{
    sqlite.prepare('INSERT OR REPLACE INTO face_prefs(member,recognise,decided,ref_tried) VALUES(?,1,1,1)').run(member);
    sqlite.prepare("INSERT OR REPLACE INTO face_refs VALUES(?,'portrait','k',?,'buffalo_l/w600k_r50')").run(member,vectorBytes(unitVec(dim)));
    if(picture) sqlite.prepare("INSERT OR REPLACE INTO profile_fields VALUES(?,'portraitObject',?)").run(member,'profile/own'+member);
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
test('hiding a post removes its faces', async()=>{
  const w=faceWorld(); w.consent(2,0); const m=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',m);
  const ck=await w.session(1,'aaaa');
  assert.equal((await w.call('/posts/p1',ck,{action:'delete'})).status,303);
  for (const t of ['faces','face_scans','face_matches']) assert.equal(w.sqlite.prepare(`SELECT count(*) n FROM ${t}`).get().n,0,t);
  assert.deepEqual(await scanPhoto(w.env,'p1',m),{faces:0,tagged:[]});
});

import { refreshRefs, rematchMember, summarise } from '../faces.mjs';
const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
const storedFace=(w,media,post,dim)=>w.sqlite.prepare("INSERT INTO faces(media,post,box,score,size,embedding,model) VALUES(?,?,'[0,0,40,40]',0.9,40,?,'buffalo_l/w600k_r50')").run(media,post,vectorBytes(unitVec(dim))).lastInsertRowid;

test('a reference job builds refs from own photos and the yearbook portrait', async()=>{
  const w=faceWorld();
  w.objects.set('profile/p2',new Uint8Array([5])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'portraitObject','profile/p2')");
  w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'");
  w.photoFaces[5]=[0]; w.photoFaces[1]=[0];   // portrait.jpg (the fixture's yearbook portrait) starts with byte 1
  await handleQueue({messages:[message({type:'ref',member:2})]},w.env);
  assert.deepEqual(w.sqlite.prepare('SELECT source,object_key FROM face_refs WHERE member=2 ORDER BY source').all().map(r=>[r.source,r.object_key]),
    [['portrait','profile/p2'],['yearbook','portrait.jpg']]);
});
test('a profile photo with no face leaves no reference', async()=>{
  const w=faceWorld(); w.consent(2,0);
  w.objects.set('profile/p2',new Uint8Array([7])); w.sqlite.exec("INSERT OR REPLACE INTO profile_fields VALUES(2,'portraitObject','profile/p2')");
  w.sqlite.exec("UPDATE face_refs SET object_key='profile/p2'");   // the old portrait ref
  assert.equal(await refreshRefs(w.env,2),0);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs WHERE member=2').get().n,0);
});
test('rematch tags earlier photos and sends one summary', async()=>{
  const w=faceWorld(); w.consent(2,0);
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2);
  w.sqlite.exec("UPDATE posts SET created=5 WHERE id='p2'");
  storedFace(w,a,'p1',0); storedFace(w,b,'p2',0); storedFace(w,b,'p2',9);
  assert.equal(await rematchMember(w.env,2),2); await summarise(w.env);
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
  await rematchMember(w.env,2); await summarise(w.env);
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
test('Photos of you renders one bulk selection form and no repeated Not me buttons', async()=>{
  const w=faceWorld(); const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1), b=w.photo('p2','u2',2);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1',?,'person','2','auto'),('p2',?,'person','2','manual')").run(a,b);
  const page=await (await w.call('/photos-of-you',ck)).text();
  assert.match(page,/\/media\/post\/u1/); assert.match(page,/\/media\/post\/u2/);
  assert.equal((page.match(/action="\/faces\/gallery-remove"/g)||[]).length,1);
  assert.doesNotMatch(page,/action="\/faces\/not-me"/);
  assert.equal((page.match(/name="media"/g)||[]).length,2);
  assert.match(page,/data-album-memory/);
});
test('bulk gallery correction removes only the viewer’s selected person tags and preserves images',async()=>{
  const w=faceWorld();const ck=await w.session(2,'bbbb');
  const a=w.photo('p1','u1',1),b=w.photo('p1','u2',2),c=w.photo('p2','u3',3);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1',?,'person','2','auto'),('p1',?,'person','2','manual'),('p2',?,'person','3','manual'),('p1',?,'person','3','auto')").run(a,b,c,a);
  const form=new FormData();for(const media of [a,b,c,a])form.append('media',media);
  const response=await w.call('/faces/gallery-remove',ck,form);
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/photos-of-you?removed=2');
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='2'").get().n,0);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='3'").get().n,2);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM face_matches WHERE member=2 AND state='removed'").get().n,2);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM active_uploads WHERE post='p1'").get().n,2);
  const retry=await w.call('/faces/gallery-remove',ck,form);assert.equal(retry.headers.get('Location'),'/photos-of-you?removed=0');
  assert.equal((await w.call('/faces/gallery-remove',ck,new FormData())).status,400);
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
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async()=>{}};
  const a=w.photo('p1','u1',1); w.sqlite.prepare("INSERT INTO face_scans(media,post,status,faces,model,scanned) VALUES(?,'p1','failed',0,'m',1)").run(a);
  assert.equal(await sweep(w.env),1);
});
test('the Worker runs the sweep on its schedule', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async b=>{sent.push({body:b});}}; w.photo('p1','u1',1);
  await workerModule.default.scheduled({cron:'17 */3 * * *'},w.env,{waitUntil(){}});
  assert.deepEqual(sent.map(m=>m.body.type),['media','finish']);
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
  const w=faceWorld('shadow'); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async()=>{}};
  w.photo('p1','u1',1); w.photo('p2','u2',2);
  const res=await w.call('/admin/faces',await w.session(1,'aaaa'),{action:'scan-all'});
  assert.equal(res.status,303); assert.equal(res.headers.get('location'),'/admin/faces?queued=2'); assert.equal(sent.length,2);
});

// ---------- final review fixes ----------
import { publishShadow, writeMatches } from '../faces.mjs';

test('C1: before migration 0017 the site works and hides face tagging', async()=>{
  const w=fixture({skip:['0019_face_tagging.sql']}); w.env.FACE_TAGGING='shadow';
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

test('I2: the sweep re-queues reference jobs for members with a profile picture but no references', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async b=>{sent.push({body:b});}};
  w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided) VALUES(2,1,1),(3,0,1)'); picture(w,2); w.consent(4,0);
  await sweep(w.env);
  assert.deepEqual(sent.filter(m=>m.body.type==='ref').map(m=>m.body.member),[2]);
  const msg=message({type:'ref',member:2}); msg.attempts=5; w.serviceDown=true;
  await handleQueue({messages:[msg]},w.env); assert.equal(msg.acked,1);   // given up on; the sweep retries it
});

test('I3/I4: re-matching many photos stays within D1 limits and summarises only new tags, once', async()=>{
  const w=faceWorld(); w.consent(2,0);
  let queries=0; const prepare=w.env.DB.prepare.bind(w.env.DB);
  w.env.DB={...w.env.DB,prepare(sql){ if((sql.match(/\?/g)||[]).length>100) throw new Error('too many SQL variables'); queries++; return prepare(sql); },batch:w.env.DB.batch.bind(w.env.DB)};
  for(let i=0;i<150;i++){ const m=w.photo('p'+i,'u'+i,1); storedFace(w,m,'p'+i,0); }
  assert.equal(await rematchMember(w.env,2),150); await summarise(w.env);
  assert.ok(queries<400,'queries '+queries);
  const notes=()=>w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all().map(r=>r.event_key);
  assert.equal(notes().length,1); assert.match(notes()[0],/^found-all:150:/);
  assert.equal(await rematchMember(w.env,2),0); await summarise(w.env);   // a profile photo change: nothing new, no new summary
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
test('I5: a family Then photo uses the face that matches the yearbook, or none', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); picture(w,2);
  w.objects.set('profile/t2',new Uint8Array([6])); w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'thenPhotoObject','profile/t2')");
  w.photoFaces[1]=[0]; w.photoFaces[6]=[3,0];          // partner (dim 3) first, the batchmate (dim 0) second
  assert.equal(await refreshRefs(w.env,2),2);
  const then=w.sqlite.prepare("SELECT embedding FROM face_refs WHERE member=2 AND source='then'").get();
  assert.equal(toVector(then.embedding)[0],1);
  w.photoFaces[1]=[];                                   // no yearbook face to compare with: drop the family photo
  assert.equal(await refreshRefs(w.env,2),0);
});
test('I6: only an approved seed portrait is used', async()=>{
  const w=faceWorld(); picture(w,2); w.photoFaces[1]=[0];
  assert.equal(await refreshRefs(w.env,2),0);           // the fixture's seed is pending review
  w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'");
  assert.equal(await refreshRefs(w.env,2),1);
});
test('M10: one unreadable reference photo does not stop the others', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); picture(w,2);
  w.photoFaces[1]=[0];
  w.sqlite.exec("INSERT INTO profile_fields VALUES(2,'nowPhotoObject','profile/missing')");
  const real=w.env.FACES; w.env.FACES={idFromName:n=>n,get:id=>({fetch:async(u,init)=>new Uint8Array(init.body)[0]===9?new Response('bad',{status:400}):real.get(id).fetch(u,init)})};
  w.objects.set('profile/missing',new Uint8Array([9]));
  assert.equal(await refreshRefs(w.env,2),1);
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
  const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async()=>{}};
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
  const sql=readFileSync(new URL('../migrations/0019_face_tagging.sql',import.meta.url),'utf8');
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


// ---------- cost: retry what keeps failing once a day, three times at most ----------
const DAY=24*60*60*1000;
test('C: a failed photo is retried once a day, three times at most', async()=>{
  const w=faceWorld(); const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async()=>{}};
  const a=w.photo('p1','u1',1);
  const fail=(tries,ago)=>w.sqlite.prepare("INSERT OR REPLACE INTO face_scans(media,post,status,faces,model,scanned,tries) VALUES(?,'p1','failed',0,'m',?,?)").run(a,Date.now()-ago,tries);
  fail(1,60*60*1000); assert.equal(await sweep(w.env),0);      // failed an hour ago: wait
  fail(1,DAY+1000);   assert.equal(await sweep(w.env),1);      // a day later: try again
  fail(3,DAY+1000);   assert.equal(await sweep(w.env),0);      // three failures: given up
});
test('C: each failure of a photo job counts one try', async()=>{
  const w=faceWorld(); const a=w.photo('p1','u1',1); w.serviceDown=true;
  for (let i=0;i<2;i++){ const msg=message({type:'media',post:'p1',media:a}); msg.attempts=5; await handleQueue({messages:[msg]},w.env); }
  assert.equal(w.sqlite.prepare("SELECT tries FROM face_scans WHERE media=?").get(a).tries,2);
});
test('C: a member without usable photos is retried once a day, three times at most; a new profile photo resets it', async()=>{
  const w=faceWorld(); const ck=await w.session(2,'bbbb'); picture(w,2);
  const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async b=>{sent.push({body:b});}};
  const refs=()=>sent.filter(m=>m.body.type==='ref').length;
  w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided) VALUES(2,1,1)');
  await handleQueue({messages:[message({type:'ref',member:2})]},w.env);          // no usable photo: one try used
  assert.equal(w.sqlite.prepare('SELECT ref_tries FROM face_prefs WHERE member=2').get().ref_tries,1);
  await sweep(w.env); assert.equal(refs(),0);                                      // tried just now: wait a day
  w.sqlite.prepare('UPDATE face_prefs SET ref_tried=? WHERE member=2').run(Date.now()-DAY-1000);
  await sweep(w.env); assert.equal(refs(),1);
  w.sqlite.prepare('UPDATE face_prefs SET ref_tries=3,ref_tried=? WHERE member=2').run(Date.now()-DAY-1000);
  await sweep(w.env); assert.equal(refs(),1);                                      // given up
  const f=new FormData(); f.set('field','nowPhotoObject'); f.set('photo',new File([pngBytes],'n.png',{type:'image/png'}));
  await w.call('/profile',ck,f);                                                   // a new photo starts again
  assert.equal(w.sqlite.prepare('SELECT ref_tries FROM face_prefs WHERE member=2').get().ref_tries,0);
});
test('C: finding a usable photo resets the member\'s tries', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); w.photoFaces[1]=[0];
  picture(w,2); w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(2,1,1,2,1)');
  await handleQueue({messages:[message({type:'ref',member:2})]},w.env);
  assert.equal(w.sqlite.prepare('SELECT ref_tries FROM face_prefs WHERE member=2').get().ref_tries,0);
});
test('face pages show their title once and no publish notice unless asked', async()=>{
  const w=faceWorld('shadow'); const h1=page=>(page.match(/<h1[\s>]/g)||[]).length;
  const mine=await (await w.call('/photos-of-you',await w.session(2,'bbbb'))).text();
  assert.equal(h1(mine),1);
  const ck=await w.session(1,'aaaa'); const admin=await (await w.call('/admin/faces',ck)).text();
  assert.equal(h1(admin),1);
  assert.doesNotMatch(admin,/Published \d+ tags/);
  assert.match(await (await w.call('/admin/faces?published=3',ck)).text(),/Published 3 tags/);
});

// ---------- 26 Nov: no consent step; a profile picture makes you eligible ----------
const picture=(w,member,byte=50)=>{ w.objects.set('profile/pic'+member,new Uint8Array([byte])); w.sqlite.prepare("INSERT OR REPLACE INTO profile_fields VALUES(?,'portraitObject',?)").run(member,'profile/pic'+member); };
const ref=(w,member,dim,source='portrait')=>w.sqlite.prepare("INSERT OR REPLACE INTO face_refs VALUES(?,?,'k',?,'buffalo_l/w600k_r50')").run(member,source,vectorBytes(unitVec(dim)));
const autoTags=(w,member)=>w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target=? AND origin='auto'").get(String(member)).n;

test('E1: a member with a profile picture is matched without being asked', async()=>{
  const w=faceWorld(); picture(w,2); ref(w,2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.equal(autoTags(w,2),1);
});
test('E2: a yearbook reference or an old yes without a profile picture is never matched', async()=>{
  const w=faceWorld(); ref(w,2,0,'yearbook');
  w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided) VALUES(2,1,1)');
  const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.equal(autoTags(w,2),0);
  storedFace(w,a,'p1',0); assert.equal(await rematchMember(w.env,2),0);
});
test('E3: an earlier Not now does not stop matching once there is a profile picture', async()=>{
  const w=faceWorld(); picture(w,2); ref(w,2,0);
  w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided) VALUES(2,0,1)');
  const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await scanPhoto(w.env,'p1',a);
  assert.equal(autoTags(w,2),1);
});
test('E4: references are built for an eligible member with no earlier answer, and not without a picture', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'");
  w.photoFaces[50]=[0]; w.photoFaces[1]=[0];   // the profile picture, and the fixture's yearbook portrait (first byte 1)
  assert.equal(await refreshRefs(w.env,2),0);   // yearbook only: not eligible
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs WHERE member=2').get().n,0);
  picture(w,2);
  assert.equal(await refreshRefs(w.env,2),2);
  assert.deepEqual(w.sqlite.prepare('SELECT source FROM face_refs WHERE member=2 ORDER BY source').all().map(r=>r.source),['portrait','yearbook']);
  assert.ok(w.sqlite.prepare('SELECT ref_tried FROM face_prefs WHERE member=2').get().ref_tried>0);
});
test('E5: no consent card, no switch, and the consent route is gone', async()=>{
  const w=faceWorld(); picture(w,2); const ck=await w.session(2,'bbbb');
  assert.doesNotMatch(await (await w.call('/',ck)).text(),/Find me in batch photos/);
  assert.doesNotMatch(await (await w.call('/people/2',ck)).text(),/Find me in batch photos/);
  assert.equal((await w.call('/faces/consent',ck,{choice:'no'})).status,404);
});
test('E6: Home nudges only members without a profile picture, and only while face tagging runs', async()=>{
  const nudge=/Add a profile picture to be found in batch photos/;
  const w=faceWorld(); const ck=await w.session(2,'bbbb');
  assert.match(await (await w.call('/',ck)).text(),nudge);
  picture(w,2); assert.doesNotMatch(await (await w.call('/',ck)).text(),nudge);
  const off=faceWorld('off'); assert.doesNotMatch(await (await off.call('/',await off.session(2,'bbbb'))).text(),nudge);
});
test('E7: saving a profile photo, inline or with the full form, marks a rebuild and queues nothing', async()=>{
  for (const how of ['inline','form']) {
    const w=faceWorld(); const ck=await w.session(2,'bbbb'); const sent=[];
    w.env.FACE_JOBS={send:async b=>{sent.push(b);},sendBatch:async m=>{sent.push(...m);}};
    w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(2,1,1,3,99)');
    const f=new FormData();
    if(how==='inline'){ f.set('field','portraitObject'); f.set('photo',new File([pngBytes],'p.png',{type:'image/png'})); }
    else { f.set('profile_form','all'); f.set('portraitPhoto',new File([pngBytes],'p.png',{type:'image/png'})); }
    const res=await w.call('/profile',ck,f); assert.equal(res.status,303,how+' '+await res.text());
    assert.deepEqual({...w.sqlite.prepare('SELECT ref_tries,ref_tried FROM face_prefs WHERE member=2').get()},{ref_tries:0,ref_tried:null},how);
    assert.deepEqual(sent,[],how);
  }
});

// ---------- 26 Nov: one batch every 3 hours ----------
import { finishRun } from '../faces.mjs';
const recorder=w=>{ const sent=[]; w.env.FACE_JOBS={sendBatch:async m=>{sent.push(...m);},send:async(b,o)=>{sent.push({body:b,...o});}}; return sent; };
const HOUR=60*60*1000;

test('B1: posting a memory queues nothing and never fails because of face tagging', async()=>{
  const w=faceWorld(); const sent=recorder(w); const ck=await w.session(2,'bbbb');
  const f=new FormData(); f.set('id',crypto.randomUUID()); f.set('body','Hello'); f.append('images',new File([pngBytes],'a.png',{type:'image/png'}));
  assert.equal((await w.call('/compose',ck,f)).status,303);
  assert.deepEqual(sent,[]);
});
test('B2: the batch queues new photos, rebuilds for new or changed profiles, and one delayed finish job', async()=>{
  const w=faceWorld(); const sent=recorder(w); w.photo('p1','u1',1);
  picture(w,2);                                                            // new: no row yet
  picture(w,3); w.consent(3,0); w.sqlite.exec('UPDATE face_prefs SET ref_tried=NULL WHERE member=3');   // changed photo
  w.consent(4,1);                                                          // built and unchanged
  w.sqlite.exec('INSERT INTO face_prefs(member,recognise,decided) VALUES(1,1,1)');   // no profile picture
  await sweep(w.env);
  assert.deepEqual(sent.filter(m=>m.body.type==='media').map(m=>m.body.media),['post/u1']);
  assert.deepEqual(sent.filter(m=>m.body.type==='ref').map(m=>m.body.member).sort(),[2,3]);
  const finish=sent.filter(m=>m.body.type==='finish');
  assert.equal(finish.length,1); assert.equal(finish[0].delaySeconds,2400);
});
test('B3: a reference job only rebuilds; the finish job re-matches recent rebuilds and sends one summary each', async()=>{
  const w=faceWorld(); w.sqlite.exec("UPDATE profile_seeds SET review_status='approved'"); w.photoFaces[50]=[0];
  picture(w,2); const a=w.photo('p1','u1',1); storedFace(w,a,'p1',0);
  await handleQueue({messages:[message({type:'ref',member:2})]},w.env);
  assert.equal(autoTags(w,2),0);                                          // nothing until the run finishes
  picture(w,3); w.consent(3,5); w.sqlite.prepare('UPDATE face_prefs SET ref_tried=? WHERE member=3').run(Date.now()-7*HOUR);
  const b=w.photo('p2','u2',2); storedFace(w,b,'p2',5);                   // 3 was rebuilt too long ago to re-match
  const msg=message({type:'finish'}); await handleQueue({messages:[msg]},w.env); assert.equal(msg.acked,1);
  assert.equal(autoTags(w,2),1); assert.equal(autoTags(w,3),0);
  const notes=w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").all();
  assert.equal(notes.length,1); assert.match(notes[0].event_key,/^found-all:1:/);
});
test('B4: a photo and a new profile picture handled at the same moment still meet at the finish', async()=>{
  const w=faceWorld(); w.photoFaces[1]=[0]; w.photoFaces[50]=[0]; picture(w,2);
  const a=w.photo('p1','u1',1);
  await scanPhoto(w.env,'p1',a);                                          // scanned before 2's references existed
  await refreshRefs(w.env,2);                                             // built after the scan read the references
  assert.equal(autoTags(w,2),0);
  await finishRun(w.env);
  assert.equal(autoTags(w,2),1);
});
test('B5: photo jobs never notify per memory; the finish job sends the summary', async()=>{
  const w=faceWorld(); w.consent(2,0); const a=w.photo('p1','u1',1); w.photoFaces[1]=[0];
  await handleQueue({messages:[message({type:'media',post:'p1',media:a,notify:'post'})]},w.env);
  assert.equal(autoTags(w,2),1);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM notifications WHERE recipient=2").get().n,0);
  await finishRun(w.env);
  assert.match(w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=2").get().event_key,/^found-all:1:/);
});
test('B6: the batch removes the automatic tags of anyone without a profile picture, keeping Not me and manual tags', async()=>{
  const w=faceWorld(); recorder(w); w.consent(3,0,0);
  const a=w.photo('p1','u1',1), b=w.photo('p1','u2',2), c=w.photo('p1','u3',3);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target,origin) VALUES('p1',?,'person','3','auto'),('p1',?,'person','3','manual')").run(a,b);
  w.sqlite.prepare("INSERT INTO face_matches(media,member,post,face,score,state,created) VALUES(?,3,'p1',NULL,0.9,'auto',1),(?,3,'p1',NULL,0,'removed',1)").run(a,c);
  w.sqlite.exec("INSERT INTO notifications(recipient,actor,kind,post,anchor,event_key) VALUES(3,NULL,'mention','p1','x','found-all:1:1'),(3,1,'like','p1','','like:p1:1')");
  await sweep(w.env);
  assert.deepEqual(w.sqlite.prepare("SELECT origin FROM photo_tags WHERE target='3'").all().map(r=>r.origin),['manual']);
  assert.deepEqual(w.sqlite.prepare("SELECT state FROM face_matches WHERE member=3").all().map(r=>r.state),['removed']);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs WHERE member=3').get().n,0);
  const keys=w.sqlite.prepare("SELECT event_key FROM notifications WHERE recipient=3").all().map(r=>r.event_key);
  assert.ok(keys.includes('like:p1:1')); assert.ok(!keys.some(k=>k.startsWith('found')),keys.join());
});
test('B7: the batch runs every 3 hours', ()=>{
  assert.match(readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8'),/crons = \["17 \*\/3 \* \* \*"\]/);
});
test('B8: the finish job reads the stored faces once for everyone it re-matches', async()=>{
  const w=faceWorld();
  for(let m=10;m<70;m++){ w.sqlite.prepare("INSERT INTO roster VALUES(?,?,'D','N')").run(m,'P'+m); w.sqlite.prepare('INSERT OR IGNORE INTO members(id) VALUES(?)').run(m);
    picture(w,m); w.consent(m,m%8); w.sqlite.prepare('UPDATE face_prefs SET ref_tried=? WHERE member=?').run(Date.now(),m); }
  for(let i=0;i<1200;i++){ const media=w.photo('p'+i,'u'+i,1); storedFace(w,media,'p'+i,20+(i%5)); }   // nobody's face
  let pages=0; const prepare=w.env.DB.prepare.bind(w.env.DB);
  w.env.DB={...w.env.DB,prepare(sql){ if(/FROM faces WHERE id>/.test(sql)) pages++; return prepare(sql); },batch:w.env.DB.batch.bind(w.env.DB)};
  await finishRun(w.env);
  assert.ok(pages<=4,'pages '+pages);
});
test('B9: a new member whose reference job keeps failing waits a day before the next try', async()=>{
  const w=faceWorld(); const sent=recorder(w); picture(w,2);
  const db=w.env.DB, prepare=db.prepare.bind(db);
  w.env.DB={...db,batch:db.batch.bind(db),prepare(sql){ if(/FROM profile_seeds/.test(sql)) throw new Error('D1 busy'); return prepare(sql); }};
  const msg=message({type:'ref',member:2}); msg.attempts=5;
  await handleQueue({messages:[msg]},w.env); assert.equal(msg.acked,1);
  w.env.DB=db; await sweep(w.env);
  assert.deepEqual(sent.filter(m=>m.body.type==='ref'),[]);
});
