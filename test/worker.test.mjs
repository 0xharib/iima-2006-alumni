import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE roster(id INTEGER PRIMARY KEY,name TEXT,dorm TEXT,nickname TEXT);
    CREATE TABLE reminder_contacts(batchmate_id INTEGER,email TEXT);
    CREATE TABLE reminder_mobiles(batchmate_id INTEGER,mobile TEXT);
    CREATE TABLE submissions(id TEXT PRIMARY KEY,subject INTEGER,contributor INTEGER,kind TEXT,payload TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE photos(submission TEXT,object_key TEXT,slot TEXT,caption TEXT,PRIMARY KEY(submission,object_key));
    CREATE TABLE profile_seeds(roster_id INTEGER PRIMARY KEY,source_data TEXT,review_status TEXT,portrait_key TEXT);
    INSERT INTO roster VALUES(1,'Test Admin','D1','Admin'),(2,'Test Classmate','D2','TC');
    INSERT INTO reminder_contacts VALUES(1,'admin@example.test'),(2,'classmate@example.test');
    INSERT INTO profile_seeds VALUES(2,'{"Life, Lately draft":"An imported bio"}','pending','portrait.jpg');
    INSERT INTO submissions VALUES('self-2',2,2,'self','{"family":"Private family note","life":"Owner yearbook answer"}','2026-11-23');
    INSERT INTO photos VALUES('self-2','legacy.jpg','then','Then');
  `);
  sqlite.exec(readFileSync(new URL('../migrations/0001_social.sql',import.meta.url),'utf8'));
  sqlite.exec("INSERT INTO members(id,role,invited) VALUES(1,'admin',1),(2,'member',1)");
  const objects=new Map([['portrait.jpg',new Uint8Array([1])],['legacy.jpg',new Uint8Array([2])]]);
  const DB={
    prepare(query){
      return {bind(...args){
        const stmt=sqlite.prepare(query);
        return {
          first: async()=>stmt.get(...args) ?? null,
          all: async()=>({results:stmt.all(...args)}),
          run: async()=>stmt.run(...args),
        };
      }};
    },
    async batch(jobs){
      sqlite.exec('BEGIN');
      try { const results=[]; for (const job of jobs) results.push(await job.run()); sqlite.exec('COMMIT'); return results; }
      catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  };
  const env={DB,DIAGNOSTICS:'true',ACCESS_MODE:'pilot',MEDIA:{
    put:async(key,bytes)=>objects.set(key,bytes),
    delete:async key=>objects.delete(key),
    get:async key=>objects.has(key)?{body:objects.get(key),httpMetadata:{contentType:'image/jpeg'}}:null
  }};
  async function session(member, token) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(Buffer.from(digest).toString('hex'),member,Date.now()+100000);
    return '__Host-alumni='+token;
  }
  function call(path,cookie,fields) {
    const headers={};
    if(cookie)headers.Cookie=cookie;
    let options={headers};
    if(fields){headers.Origin='https://test.example';options={headers,method:'POST',body:new URLSearchParams(fields)};}
    return worker.fetch(new Request('https://test.example'+path,options),env);
  }
  return {call,session,sqlite,env};
}
async function body(response) { const text=await response.text(); assert.equal(response.status,200,text); return text; }

test('pilot access, combined profile, selective yearbook and authorized media',async()=>{
  const {call,session,env}=fixture();
  const admin=await session(1,'aaa'), owner=await session(2,'bbb');
  assert.equal((await call('/people/2')).status,303);
  assert.match(await body(await call('/signin?id=2')),/claXXX@example.test/);
  assert.match(await body(await call('/people/2',admin)),/An imported bio/);
  assert.equal((await call('/media/seed/2',admin)).status,200);
  assert.doesNotMatch(await body(await call('/people/2',admin)),/Private family note/);
  assert.equal((await call('/yearbook-preview/0',admin)).status,404);
  assert.equal((await call('/yearbook-preview/0',owner)).status,200);
  assert.equal((await call('/yearbook',owner,{life:'on',image_0:'on',announce:'on'})).status,303);
  const profile=await body(await call('/people/2',admin));
  assert.match(profile,/Owner yearbook answer/);
  assert.match(profile,/media\/yearbook\/2\/0/);
  assert.match(await body(await call('/gallery',admin)),/media\/seed\/2/);
  env.ACCESS_MODE='batch';
  assert.equal((await call('/media/seed/2',admin)).status,404);
  assert.equal((await call('/media/yearbook/2/0',admin)).status,200);
  await call('/yearbook',owner,{unused:'1'});
  assert.equal((await call('/media/yearbook/2/0',admin)).status,404);
});

test('topics, memories, moderation and absence of private RSVP inference',async()=>{
  const {call,session}=fixture();
  const admin=await session(1,'aaa'), other=await session(2,'bbb');
  const key='c8b6be0e-c1f2-44e1-a37a-65fab60d5bc2';
  assert.equal((await call('/compose',admin,{id:key,body:'First memory',title:'Brick steps',kind:'Place',subject:'2'})).status,303);
  assert.match(await body(await call('/topics',other)),/Brick steps/);
  assert.match(await body(await call('/people/2',other)),/First memory/);
  await call('/posts/'+key,other,{action:'unassociate'});
  assert.doesNotMatch(await body(await call('/people/2',other)),/First memory/);
  await call('/posts/'+key,other,{action:'comment',body:'Second memory'});
  assert.match(await body(await call('/notifications',admin)),/commented/);
  await call('/admin',admin,{action:'hide-post',target:key,reason:'Test'});
  assert.equal((await call('/posts/'+key,other)).status,404);
  assert.match(await body(await call('/admin',admin)),/Reunion tracker/);
  assert.equal((await call('/admin',admin,{action:'attendance-apply',rsvp:'roster_id,status\n2,declined'})).status,303);
  assert.match(await body(await call('/reunion?status=declined',other)),/Test Classmate/);
  assert.doesNotMatch(await body(await call('/reunion?status=declined',other)),/Test Admin/);
});
