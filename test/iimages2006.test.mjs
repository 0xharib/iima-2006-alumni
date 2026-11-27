import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { yearbookEntry, setYearbookHidden, yearbookPhotoKey } from '../iimages2006.mjs';

const UPSERT=`INSERT INTO iimages_2006(member,heading,dorm,writeup,page,photo_key) VALUES(?,?,?,?,?,?)
  ON CONFLICT(member) DO UPDATE SET heading=excluded.heading,dorm=excluded.dorm,writeup=excluded.writeup,page=excluded.page,photo_key=excluded.photo_key`;
function withEntry({photo=true}={}) {
  const fx=fixture();
  fx.sqlite.prepare(UPSERT).run(2,'Test Classmate aka TC','D-2','First para.\n\nSecond para.',12,photo?'iimages-2006/photo/2.webp':null);
  fx.objects.set('iimages-2006/photo/2.webp',new Uint8Array([9]));
  return fx;
}

test('entry is returned to everyone while shown', async()=>{
  const {env}=withEntry();
  const e=await yearbookEntry(env.DB,2,1,false);
  assert.deepEqual(e,{heading:'Test Classmate aka TC',dorm:'D-2',writeup:'First para.\n\nSecond para.',hasPhoto:true,hidden:false});
});

test('hidden entry is null for others but returned to owner and admin', async()=>{
  const {env}=withEntry();
  await setYearbookHidden(env.DB,2,true,2);
  assert.equal(await yearbookEntry(env.DB,2,3,false),null);
  assert.equal((await yearbookEntry(env.DB,2,2,false)).hidden,true);
  assert.equal((await yearbookEntry(env.DB,2,1,true)).hidden,true);
  await setYearbookHidden(env.DB,2,false,2);
  assert.equal((await yearbookEntry(env.DB,2,3,false)).hidden,false);
});

test('/media/iimages/<id> serves the photo to a visitor, 404s when hidden, serves owner and admin', async()=>{
  const fx=withEntry();
  const admin=await fx.session(1,'aaaa'), owner=await fx.session(2,'bbbb');
  fx.sqlite.exec("INSERT INTO roster VALUES(3,'Third Person','D3','TP')");
  fx.sqlite.exec("INSERT INTO members(id,role,invited) VALUES(3,'member',1)");
  const other=await fx.session(3,'cccc');
  assert.equal((await fx.call('/media/iimages/2',other)).status,200);
  await setYearbookHidden(fx.env.DB,2,true,2);
  assert.equal((await fx.call('/media/iimages/2',other)).status,404);
  assert.equal((await fx.call('/media/iimages/2',owner)).status,200);
  assert.equal((await fx.call('/media/iimages/2',admin)).status,200);
  assert.equal(await yearbookPhotoKey(fx.env.DB,2,3,false),null);
});

test('before migration 0022 a profile and /media/iimages/1 do not 500', async()=>{
  const fx=fixture({skip:['0022_iimages_2006.sql']});
  const admin=await fx.session(1,'aaaa');
  assert.equal(await yearbookEntry(fx.env.DB,2,1,true),null);
  assert.equal((await fx.call('/media/iimages/1',admin)).status,404);
  assert.equal((await fx.call('/people/2',admin)).status,200);
});

test('re-running the import upsert keeps hidden=1', async()=>{
  const fx=withEntry();
  await setYearbookHidden(fx.env.DB,2,true,1);
  fx.sqlite.prepare(UPSERT).run(2,'New heading','D-2','Text',12,null);
  const row=fx.sqlite.prepare('SELECT heading,hidden,hidden_by FROM iimages_2006 WHERE member=2').get();
  assert.deepEqual({...row},{heading:'New heading',hidden:1,hidden_by:1});
});

test('photo_key NULL gives hasPhoto false', async()=>{
  const {env}=withEntry({photo:false});
  assert.equal((await yearbookEntry(env.DB,2,2,false)).hasPhoto,false);
  assert.equal(await yearbookPhotoKey(env.DB,2,2,false),null);
});

// Task 4: the profile section and hide/show.
async function people() {
  const fx=withEntry();
  fx.sqlite.exec("INSERT INTO roster VALUES(3,'Third Person','D3','TP')");
  fx.sqlite.exec("INSERT INTO members(id,role,invited) VALUES(3,'member',1)");
  return {...fx, admin:await fx.session(1,'aaaa'), owner:await fx.session(2,'bbbb'), other:await fx.session(3,'cccc')};
}
const page=async(fx,cookie,id=2)=>(await fx.call('/people/'+id,cookie)).text();

test('profile shows heading, dorm and every paragraph', async()=>{
  const fx=await people();
  const html=await page(fx,fx.other);
  assert.match(html,/<section class="profile-section profile-iimages" id="iimages-2006">/);
  assert.match(html,/<h2>From the 2006 yearbook<\/h2>/);
  assert.match(html,/Test Classmate aka TC/);
  assert.match(html,/· D-2/);
  assert.match(html,/<p>First para\.<\/p>\s*<p>Second para\.<\/p>/);
  assert.match(html,/<img src="\/media\/iimages\/2\?w=480"/);
  assert.doesNotMatch(html,/Hide my 2006 write-up/);
});

test('write-up with <script> & "quotes" is escaped', async()=>{
  const fx=await people();
  fx.sqlite.prepare('UPDATE iimages_2006 SET writeup=?,heading=? WHERE member=2').run('<script>alert(1)</script> & "q"','A <b>');
  const html=await page(fx,fx.other);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;q&quot;|&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; "q"/);
  assert.match(html,/A &lt;b&gt;/);
});

test('visitor sees no section when hidden; owner sees the hidden line and Show it again', async()=>{
  const fx=await people();
  await setYearbookHidden(fx.env.DB,2,true,2);
  assert.doesNotMatch(await page(fx,fx.other),/iimages-2006/);
  const own=await page(fx,fx.owner);
  assert.match(own,/Your 2006 write-up is hidden from batchmates\./);
  assert.match(own,/Show it again/);
  assert.doesNotMatch(own,/First para/);
});

test('owner Hide then Show round-trips', async()=>{
  const fx=await people();
  assert.match(await page(fx,fx.owner),/Hide my 2006 write-up/);
  assert.equal((await fx.call('/profile',fx.owner,{action:'iimages-hide'})).status,303);
  assert.deepEqual({...fx.sqlite.prepare('SELECT hidden,hidden_by FROM iimages_2006 WHERE member=2').get()},{hidden:1,hidden_by:2});
  assert.doesNotMatch(await page(fx,fx.other),/iimages-2006/);
  await fx.call('/profile',fx.owner,{action:'iimages-show'});
  assert.equal(fx.sqlite.prepare('SELECT hidden FROM iimages_2006 WHERE member=2').get().hidden,0);
  assert.match(await page(fx,fx.other),/From the 2006 yearbook/);
});

test("another member cannot hide someone else's entry", async()=>{
  const fx=await people();
  await fx.call('/profile',fx.other,{action:'iimages-hide',target:'2',member:'2'});
  assert.equal(fx.sqlite.prepare('SELECT hidden FROM iimages_2006 WHERE member=2').get().hidden,0);
  await fx.call('/admin',fx.other,{action:'iimages-hide',target:'2',reason:'x'});
  assert.equal(fx.sqlite.prepare('SELECT hidden FROM iimages_2006 WHERE member=2').get().hidden,0);
});

test('admin hide writes audit', async()=>{
  const fx=await people();
  assert.match(await page(fx,fx.admin),/name="action" value="iimages-hide"/);
  assert.equal((await fx.call('/admin',fx.admin,{action:'iimages-hide',target:'2',reason:'Asked by email'})).status,303);
  assert.deepEqual({...fx.sqlite.prepare('SELECT hidden,hidden_by FROM iimages_2006 WHERE member=2').get()},{hidden:1,hidden_by:1});
  const a=fx.sqlite.prepare("SELECT actor,action,target,reason FROM audit WHERE action='iimages-hide'").get();
  assert.deepEqual({...a},{actor:1,action:'iimages-hide',target:'2',reason:'Asked by email'});
  assert.match(await page(fx,fx.admin),/hidden from batchmates/);
  await fx.call('/admin',fx.admin,{action:'iimages-show',target:'2',reason:'Asked again'});
  assert.equal(fx.sqlite.prepare('SELECT hidden FROM iimages_2006 WHERE member=2').get().hidden,0);
});

test('no section and no img when no entry / no photo', async()=>{
  const fx=await people();
  assert.doesNotMatch(await page(fx,fx.other,1),/iimages-2006/);
  fx.sqlite.exec('UPDATE iimages_2006 SET photo_key=NULL');
  const html=await page(fx,fx.other);
  assert.match(html,/From the 2006 yearbook/);
  assert.doesNotMatch(html,/\/media\/iimages\//);
});
