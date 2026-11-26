import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,body} from './fixture.mjs';
import {socialScript} from '../social.mjs';

function staged(fx,count,owner=2){
 const ids=Array.from({length:count},()=>crypto.randomUUID());
 for(const id of ids)fx.sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,NULL,?)').run(id,owner,'test/'+id,'image/png','digest','',Date.now());
 return ids;
}
function fields(ids,{id=crypto.randomUUID(),title='Campus album',body='Our memories',cover=ids[0],revision='0'}={}){
 const f=new FormData();for(const [key,value]of Object.entries({id,title,body,cover,revision}))f.set(key,value);
 ids.forEach(id=>f.append('photoId',id));return f;
}
test('300 photos publish and edit within the D1 binding limit; 301 and duplicates fail',async()=>{
 const fx=fixture(),ck=await fx.session(2,'bbbb');
 const prepare=fx.env.DB.prepare;
 fx.env.DB.prepare=query=>({bind(...args){assert.ok(args.length<=100,'D1 has at most 100 bound parameters');return prepare(query).bind(...args);}});
 const ids=staged(fx,301),id=crypto.randomUUID();
 assert.equal((await fx.call('/compose',ck,fields(ids,{id}))).status,400);
 assert.equal((await fx.call('/compose',ck,fields([ids[0],ids[0]],{id}))).status,400);
 assert.equal((await fx.call('/compose',ck,fields(ids.slice(0,300),{id}))).status,303);
 assert.equal((await fx.call('/posts/'+id+'/album',ck,fields(ids.slice(0,300).reverse(),{cover:ids[299]}))).status,303);
 assert.deepEqual(JSON.parse(fx.sqlite.prepare('SELECT photo_order FROM memory_albums WHERE post=?').get(id).photo_order),ids.slice(0,300).reverse());
 assert.equal((await fx.call('/posts/'+id+'/album',ck,fields(ids))).status,400);
 assert.equal((await fx.call('/posts/'+id+'/album',ck,fields([]))).status,400);
});
test('owner editing preserves interactions, retained tags and faces; removals leave the gallery and media',async()=>{
 const fx=fixture(),ck=await fx.session(2,'bbbb'),other=await fx.session(1,'aaaa');
 const ids=staged(fx,3),id=crypto.randomUUID(),url='/posts/'+id;
 await fx.call('/compose',ck,fields(ids,{id}));
 await fx.call(url,other,{action:'like',liked:'1'});
 await fx.call(url,other,{action:'comment',body:'Keep this comment'});
 await fx.call(url,ck,{action:'tag-add',photo:'post/'+ids[0],tag:'person:1'});
 await fx.call(url,ck,{action:'tag-add',photo:'post/'+ids[1],tag:'person:1'});
 fx.sqlite.prepare("INSERT INTO face_scans(media,post,status,model,scanned) VALUES(?,?,'done','test-model',?)").run('post/'+ids[0],id,Date.now());
 const added=staged(fx,1)[0],foreign=staged(fx,1,1)[0];
 assert.equal((await fx.call(url+'/album',other)).status,404);
 assert.equal((await fx.call(url+'/album',other,fields(ids))).status,404);
 assert.equal((await fx.call(url+'/album',ck,fields([foreign]))).status,400);
 const save=fields([ids[2],ids[0],added],{title:'Updated',body:'New caption',cover:ids[2]});
 assert.equal((await fx.call(url+'/album',ck,save)).status,303);
 assert.equal((await fx.call(url+'/album',ck,save)).status,303,'lost-response retry is idempotent');
 assert.equal((await fx.call(url+'/album',ck,fields([ids[0]],{body:'Stale edit'}))).status,409);
 assert.equal(fx.sqlite.prepare('SELECT count(*) n FROM likes WHERE post=?').get(id).n,1);
 assert.equal(fx.sqlite.prepare('SELECT body FROM comments WHERE post=?').get(id).body,'Keep this comment');
 assert.equal(fx.sqlite.prepare('SELECT count(*) n FROM photo_tags WHERE post=?').get(id).n,2);
 assert.equal(fx.sqlite.prepare('SELECT count(*) n FROM active_photo_tags WHERE post=?').get(id).n,1);
 assert.equal(fx.sqlite.prepare('SELECT count(*) n FROM face_scans WHERE post=?').get(id).n,1);
 assert.equal((await fx.call('/media/post/'+ids[1],ck)).status,404);
 const html=await body(await fx.call(url,ck));
 assert.ok(html.indexOf('data-photo-scope="post/'+ids[2])<html.indexOf('data-photo-scope="post/'+ids[0]));
 assert.doesNotMatch(html,new RegExp('data-photo-scope="post/'+ids[1]));
 const editor=await body(await fx.call(url+'/album',ck));assert.match(editor,/data-album-edit/);assert.match(editor,/name="title" value="Updated"/);
 assert.match(editor,/name="revision" value="1"/);
});
test('album version guard rolls back stale writes atomically',()=>{
 const {sqlite}=fixture();
 sqlite.prepare("INSERT INTO posts(id,author,body,created) VALUES('album',2,'caption',1)").run();
 sqlite.prepare("INSERT INTO album_versions VALUES('album',1)").run();
 assert.throws(()=>sqlite.prepare("INSERT INTO album_versions VALUES('album',1) ON CONFLICT(post) DO UPDATE SET version=excluded.version").run(),/Album changed/);
 assert.equal(sqlite.prepare('SELECT version FROM album_versions').get().version,1);
});
test('client script is valid JavaScript after interpolation',()=>{assert.doesNotThrow(()=>new Function(socialScript));});
