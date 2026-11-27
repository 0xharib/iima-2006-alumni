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
