import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from '../worker.mjs';

export function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0000_baseline.sql',import.meta.url),'utf8'));
  sqlite.exec(`
    INSERT INTO roster VALUES(1,'Test Admin','D1','Admin'),(2,'Test Classmate','D2','TC');
    INSERT INTO reminder_contacts VALUES(1,'admin@example.test'),(2,'classmate@example.test');
    INSERT INTO profile_seeds VALUES(2,'{"Life, Lately draft":"An imported bio"}','pending','portrait.jpg');
    INSERT INTO submissions VALUES('self-2',2,2,'self','{"family":"Private family note","life":"Owner yearbook answer"}','2026-11-23');
    INSERT INTO photos VALUES('self-2','legacy.jpg','then','Then');
  `);
  for (const filename of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
    if(filename==='0000_baseline.sql'||filename==='0002_publish_imports.sql') continue;
    sqlite.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'));
  }
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
  function call(path,cookie,fields,headers={}) {
    if(cookie)headers.Cookie=cookie;
    let options={headers};
    if(fields){headers.Origin='https://test.example';options={headers,method:'POST',body:fields instanceof FormData?fields:new URLSearchParams(fields)};}
    return worker.fetch(new Request('https://test.example'+path,options),env);
  }
  return {call,session,sqlite,env,objects};
}
export async function body(response) { const text=await response.text(); assert.equal(response.status,200,text); return text; }
