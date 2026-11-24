import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from '../worker.mjs';

function fixture() {
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
  return {call,session,sqlite,env};
}
async function body(response) { const text=await response.text(); assert.equal(response.status,200,text); return text; }

test('current interactions and feed',async()=>{
 const {call,session,sqlite}=fixture();
 const cookie=await session(2,'bbbb');
 const script=await call('/social.js?v=2');
 assert.equal(script.status,200);
 const source=await script.text();
 assert.doesNotMatch(source,/__name/);new Function(source);
 assert.equal((await call('/profile',cookie,{field:'attendance',value:'attending'})).status,303);
 assert.equal(sqlite.prepare('SELECT status FROM attendance WHERE member=2').get().status,'attending');
 assert.equal((await call('/profile',cookie,{field:'city',value:'Bangalore'})).status,303);
 const profile=await call('/people/2',cookie);assert.equal(profile.status,200);assert.match(await profile.text(),/Bangalore/);
 const post=await call('/compose',cookie,{id:crypto.randomUUID(),body:'Campus words',about:'person:1'});
 assert.equal(post.status,303);
 const url=post.headers.get('location');
 assert.equal((await call(url,cookie,{action:'like',liked:'1'})).status,303);
 assert.equal((await call(url,cookie,{action:'comment',body:'Found through comments'})).status,303);
 assert.equal((await call(url,cookie,{action:'tag-add',tag:'1'})).status,303);
 const fragment=await call('/memories?fragment=1&q=Found',cookie);
 assert.equal(fragment.status,200);assert.match((await fragment.json()).html,/Campus words/);
 const home=await call('/',cookie);assert.equal(home.status,200);assert.match(await home.text(),/Campus words/);
});

test('verification is one-time and redirects directly',async()=>{
 const {call,sqlite}=fixture();
 const raw='fixture-token';
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');
 sqlite.prepare('INSERT INTO login_links VALUES(?,?,?,?)').run(digest,2,Date.now()+3600000,'/people/2');
 const page=await call('/verify');
 assert.match(await page.text(),/id="verify-form" hidden/);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM login_links').get().n,1);
 const response=await call('/verify',null,{token:raw});
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),'/people/2');
 assert.match(response.headers.get('set-cookie'),/__Host-alumni=/);
 const replay=await call('/verify',null,{token:raw});
 assert.match(await replay.text(),/Request a fresh link/);
 assert.equal(replay.headers.get('set-cookie'),null);
});
test('featured cards and comment controls',async()=>{
 const {call,session}=fixture();
 const ck=await session(1,'aaaa');
 const home=await body(await call('/',ck));
 assert.match(home,/What are they up to\?/);
 assert.equal((home.match(/class="person-tile"/g)||[]).length,1);
 const profile=await body(await call('/people/2',ck));
 assert.match(profile,/Add a memory about this classmate/);
 const created=await call('/compose',ck,{id:crypto.randomUUID(),body:'Campus',about:'person:2'});
 const path=created.headers.get('location');
 const added=await call(path,ck,{action:'comment',body:'Author only'});
 assert.match(added.headers.get('location'),/comment-posted=1/);
 const result=await (await call(path+'?panel=comments',ck)).json();
 assert.equal(result[0].canDelete,true);
 const other=await session(2,'bbbb');
 assert.equal((await (await call(path+'?panel=comments',other)).json())[0].canDelete,false);
 await call(path,other,{action:'delete-comment',comment:result[0].id});
 assert.equal((await (await call(path+'?panel=comments',ck)).json()).length,1);
 await call(path,ck,{action:'delete-comment',comment:result[0].id});
 assert.equal((await (await call(path+'?panel=comments',ck)).json()).length,0);
});
test('directory and reunion resolve and home features up to twelve submitters',async()=>{
 const {call,session,sqlite}=fixture();
 const ck=await session(1,'aaaa');
 for(let id=3;id<=15;id++){
  sqlite.prepare('INSERT INTO roster VALUES(?,?,?,?)').run(id,'Classmate '+id,'D3','');
  sqlite.prepare("INSERT INTO submissions(id,subject,contributor,kind,payload) VALUES(?,?,?,'self','{}')").run('self-'+id,id,id);
 }
 const home=await body(await call('/',ck));
 assert.match(home,/<a href="\/people">Classmates<\/a>/);
 assert.equal((home.match(/class="person-tile"/g)||[]).length,12);
 assert.match(await body(await call('/people',ck)),/Test Admin/);
 const search=await body(await call('/people?q=Test%20Admin',ck));
 assert.match(search,/Test Admin/);
 assert.doesNotMatch(search,/Test Classmate/);
 assert.match(await body(await call('/reunion',ck)),/December reunion/);
});

test('reunion gate, tracker prefill, saved details and private attendance',async()=>{
 const {call,session,sqlite}=fixture();
 const admin=await session(1,'aaaa');
 const attendee=await session(2,'bbbb');
 sqlite.exec("INSERT INTO reunion_tracker VALUES (1,'declined',NULL,NULL,NULL),(2,'attending',1,2,1)");
 let html=await body(await call('/reunion?status=declined',admin));
 assert.match(html,/Reunion agenda/);
 assert.match(html,/T-Nite Section Wars/);
 assert.match(html,/href="\/people\/2"/);
 assert.doesNotMatch(html,/Edit Your T-shirt size|You’re confirmed for the reunion/);
 assert.equal((await call('/reunion',admin,{shirt:'L'})).status,403);
 assert.equal((await call('/admin/export?kind=reunion',attendee)).status,404);
 html=await body(await call('/reunion',attendee));
 assert.match(html,/You’re confirmed for the reunion, Test Classmate/);
 assert.match(html,/Coming with your spouse or partner and 2 children/);
 assert.match(html,/How many children are joining\?<\/dt><dd class="field-display">2/);
 assert.equal((await call('/reunion',attendee,{field:'shirt',value:'M'})).status,303);
 const prefill=JSON.parse(sqlite.prepare('SELECT details FROM reunion_logistics WHERE member=2').get().details);
 assert.deepEqual([prefill.shirt,prefill.spouse,prefill.children,prefill.bothNights],['M','1','2','1']);
 assert.equal((await call('/reunion',attendee,{shirt:'L',spouse:'0',children:'0',kidName0:'IGNORE',spouseName:'IGNORE'})).status,303);
 assert.equal((await call('/reunion',attendee,{field:'shirt',value:'XL'})).status,303);
 assert.equal((await call('/reunion',attendee,{field:'spouseName',value:'Unavailable'})).status,400);
 sqlite.exec("UPDATE reunion_tracker SET spouse=1,children=1 WHERE member=2");
 html=await body(await call('/reunion?saved=1',attendee));
 assert.match(html,/Coming solo/);
 assert.match(html,/Your reunion details are saved/);
 const exported=await (await call('/admin/export?kind=reunion',admin)).json();
 assert.equal(exported[0].details.shirt,'XL');
 assert.equal(exported[0].details.spouseName,'');
 assert.deepEqual(exported[0].details.kids,[]);
 sqlite.exec('UPDATE members SET attendance_private=1 WHERE id=2');
 assert.doesNotMatch(await body(await call('/reunion',admin)),/href="\/people\/2"/);
 assert.match(await body(await call('/reunion',attendee)),/Edit Your T-shirt size/);
 sqlite.exec("UPDATE reunion_tracker SET status='declined' WHERE member=2");
 assert.equal((await call('/reunion',attendee,{shirt:'S'})).status,403);
 const home=await body(await call('/',attendee));
 assert.match(home,/href="\/people\/2">Complete your profile/);
 assert.match(home,/Share your memories/);
 assert.doesNotMatch(home,/to be featured/);
});

test('share metadata, personal profile rank and child age prompt',async()=>{
 const {call,session,sqlite}=fixture();
 const guest=await body(await call('/'));
 assert.match(guest,/og:title.*Kal · Aaj · Aur Kal/);
 assert.match(guest,/og:description/);
 const ck=await session(2,'bbbb');
 sqlite.exec("INSERT INTO profile_fields VALUES(2,'life','Own bio'),(2,'city','Mumbai')");
 let html=await body(await call('/',ck));
 assert.doesNotMatch(html,/home-completion/);
 sqlite.exec("INSERT INTO profile_fields VALUES(1,'life','My bio'),(1,'city','Delhi')");
 html=await body(await call('/',ck));
 assert.doesNotMatch(html,/home-completion/);
 sqlite.exec("INSERT INTO reunion_tracker VALUES(2,'attending',0,0,1)");
 const response=await call('/reunion',ck,{field:'children',value:'2'});
 assert.equal(response.headers.get('location'),'/reunion?saved=1#reunion-children');
 html=await body(await call('/reunion?saved=1',ck));
 assert.match(html,/id="reunion-children"/);
 assert.equal((html.match(/Add age for activity planning/g)||[]).length,2);
 assert.equal((await call('/reunion',ck,{field:'kidAge0',value:'0'})).status,303);
 assert.match(await body(await call('/reunion',ck)),/Age<\/dt><dd class="field-display">0/);
});

test('album upload, linked tags, cover and album view',async()=>{
 const {call,session}=fixture();
 const ck=await session(2,'bbbb'), other=await session(1,'aaaa');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
 const ids=[crypto.randomUUID(),crypto.randomUUID()];
 for(const id of ids){
   const f=new FormData();f.set('photo',new File([png],'photo.png',{type:'image/png'}));
   assert.equal((await call('/compose/photo?id='+id,ck,f)).status,200);
   assert.equal((await call('/media/post/'+id,other)).status,404);
 }
 const draft=new FormData();
 draft.set('id',crypto.randomUUID());
 draft.set('title','Campus 2005');draft.set('body','Our old photos');draft.set('cover',ids[1]);
 draft.append('about','person:1');draft.append('about','new-event:Confluence');
 for(const id of ids)draft.append('photoId',id);
 assert.equal((await call('/compose',other,draft)).status,400);
 const response=await call('/compose',ck,draft);
 assert.equal(response.status,303,await response.text());
 const url=response.headers.get('location');
 const home=await body(await call('/memories?q=Campus+2005',ck));
 assert.equal((home.match(/class="collage-card"/g)||[]).length,1);
 assert.match(home,/2 photos/);
 assert.match(home,new RegExp('/media/post/'+ids[1]));
 assert.match(home,/href="\/people\/1">@Test Admin/);
 assert.match(home,/href="\/topics\/[^"]+">#Confluence/);
 const album=await body(await call(url,ck));
 assert.equal((album.match(/data-album-photo/g)||[]).length,2);
 assert.ok(album.indexOf(ids[0])<album.indexOf(ids[1]));
 const photo='post/'+ids[0];
 assert.equal((await call(url,other,{action:'tag-add',tag:'person:2',photo:'post/'+crypto.randomUUID()})).status,404);
 for(const tag of ['person:2','topic:lkp']){
   const added=await call(url,other,{action:'tag-add',tag,photo},{Accept:'application/json'});
   assert.equal(added.status,200);
 }
 const taggedAlbum=await body(await call(url,ck));
 const photoCards=taggedAlbum.split('data-photo-scope=');
 assert.doesNotMatch(photoCards[0],/#LKP|@Test Classmate/);
 assert.match(photoCards[1],/#LKP/);
 assert.match(photoCards[1],/@Test Classmate/);
 assert.doesNotMatch(photoCards[2],/#LKP|@Test Classmate/);
 assert.match(await body(await call('/topics/lkp',ck)),/Campus 2005/);
 const inbox=await body(await call('/notifications',ck));
 assert.match(inbox,new RegExp('/media/post/'+ids[0]+'\\?w=256'));
 assert.match(inbox,/View photo/);
 assert.match(inbox,/Campus 2005/);
 const picks=await (await call('/memory-targets?q=%23confl',ck)).json();
 assert.equal(picks[0].category,'Events');
 assert.equal(picks.length,1);
 assert.match(await body(await call('/people/1',ck)),/name="about" value="person:1"/);
});

test('classmate filters combine and card tags are immediately linked',async()=>{
 const {call,session,sqlite}=fixture();
 const ck=await session(2,'bbbb');
 sqlite.exec("INSERT INTO roster_sections VALUES(1,'A'),(2,'B'); INSERT INTO reunion_tracker(member,status) VALUES(1,'attending'),(2,'declined')");
 const directory=await body(await call('/people?dorm=D1&section=A&status=attending&q=Test',ck));
 assert.match(directory,/Section A/);
 assert.doesNotMatch(directory,/Section B/);
 const memory=await call('/compose',ck,{id:crypto.randomUUID(),body:'Campus trip'});
 const url=memory.headers.get('location');
 assert.equal((await call(url,ck,{action:'tag-add',tag:'person:1'})).status,303);
 const tag=await call(url,ck,{action:'tag-add',tag:'topic:lkp'},{Accept:'application/json'});
 assert.match((await tag.json()).tags,/#LKP/);
 const html=await body(await call(url,ck));
 assert.match(html,/href="\/people\/1">@Test Admin/);
 assert.match(html,/href="\/topics\/lkp">#LKP/);
});

test('profile source precedence, retirement of old entry links, and reunion prompts',async()=>{
 const {call,session,sqlite}=fixture();
 const ck=await session(2,'bbbb');
 sqlite.exec(`INSERT INTO yearbook_public VALUES(2,'{"life":"Published life","family":"Published family"}','[]');
   INSERT INTO profile_fields VALUES(2,'life','Owner life'),(2,'family','');
   INSERT INTO reunion_tracker VALUES(2,'attending',1,0,1);`);
 const profile=await body(await call('/people/2',ck));
 assert.match(profile,/Owner life/);
 assert.doesNotMatch(profile,/Published life|Published family|Review yearbook/);
 assert.equal((await call('/yearbook',ck)).headers.get('location'),'/people/2');
 const reunion=await body(await call('/reunion',ck));
 assert.match(reunion,/Your attendance details are missing/);
 assert.match(reunion,/Choose an outing or select Skip the outing/);
 assert.equal((reunion.match(/<details><summary>|<details>/g)||[]).length>0,true);
 assert.doesNotMatch(reunion,/<div class="reunion-days"><details open/);
});

test('photo sizes are private, cached, and leave the original available',async()=>{
 const {call,session,sqlite,env}=fixture();
 const ck=await session(2,'bbbb');
 sqlite.exec("INSERT INTO profile_fields VALUES(2,'portraitObject','original.jpg')");
 const original=new Uint8Array(100);
 const variant=new Uint8Array(12);
 await env.MEDIA.put('original.jpg',original);
 const get=env.MEDIA.get;
 env.MEDIA.get=async key=>{
   const object=await get(key);
   return object && {...object,size:object.body.byteLength,httpEtag:key.includes('variants')?'"small"':'"original"'};
 };
 let transforms=0;
 env.IMAGES={input:()=>({transform(options){
   assert.deepEqual(options,{width:96,height:192,fit:'scale-down'});
   transforms++;
   return {async output(){return {response:()=>new Response(variant)};}};
 }})};
 const url='/media/portrait/2?w=96';
 assert.equal((await call(url)).status,303);
 const first=await call(url,ck);
 assert.equal(first.headers.get('content-type'),'image/webp');
 assert.equal(first.headers.get('cache-control'),'private, max-age=60, must-revalidate');
 assert.equal(first.headers.get('vary'),'Cookie');
 assert.equal((await first.arrayBuffer()).byteLength,12);
 assert.equal((await call(url,ck,undefined,{'If-None-Match':'"small"'})).status,304);
 assert.equal(transforms,1);
 assert.equal((await (await call('/media/portrait/2',ck)).arrayBuffer()).byteLength,100);
 assert.equal((await call(url)).status,303);
});

test('analytics protects named activity and excludes URL parameters and previews',async()=>{
 const {call,session,sqlite}=fixture();
 const admin=await session(1,'aaaa'), member=await session(2,'bbbb');
 await call('/?private=ignored');
 await call('/',undefined,undefined,{'User-Agent':'WhatsApp/2.26'});
 await call('/people/1?private=ignored',member);
 const rows=sqlite.prepare('SELECT event,member,path FROM site_events ORDER BY id').all();
 assert.deepEqual(rows.map(row=>[row.event,row.member,row.path]),[['page_view',null,'/'],['page_view',2,'/people/1']]);
 assert.equal((await call('/admin/analytics',member)).status,404);
 const data=await (await call('/admin/analytics?format=json',admin)).json();
 assert.equal(data.events[0].name,'Test Classmate');
 assert.equal(data.events.length,2);
});

test('notifications for mentions, owner activity and sample cleanup',async()=>{
 const {call,session,sqlite}=fixture();
 const author=await session(1,'aaaa'), actor=await session(2,'bbbb');
 const post=await call('/compose',author,{id:crypto.randomUUID(),body:'A memory'});
 const url=post.headers.get('location');
 await call(url,actor,{action:'like',liked:'1'});
 await call(url,actor,{action:'like',liked:'1'});
 await call(url,actor,{action:'comment',body:'A comment'});
 await call(url,actor,{action:'tag-add',tag:'person:1'});
 await call(url,actor,{action:'tag-add',tag:'topic:lkp'});
 const rows=sqlite.prepare('SELECT id,kind,recipient FROM notifications ORDER BY id').all();
 assert.deepEqual(rows.map(x=>[x.kind,x.recipient]),[['like',1],['comment',1],['mention',1],['tag',1],['tag',1]]);
 assert.equal((await call('/notifications?open='+rows[1].id,actor)).status,404);
 const link=await call('/notifications?open='+rows[1].id,author);
 assert.match(link.headers.get('location'),/#comment-/);
 const inbox=await body(await call('/notifications',author));
 assert.match(inbox,/4 unread/);
 assert.match(inbox,/A comment/);
 assert.match(inbox,/View comment/);
 await call('/compose',actor,{id:crypto.randomUUID(),body:'A mention',about:'person:1'});
 assert.equal(sqlite.prepare("SELECT count(*) n FROM notifications WHERE kind='mention'").get().n,2);
 sqlite.exec("INSERT INTO notifications(recipient,kind,event_key,sample) VALUES(1,'like','test',1)");
 assert.match(await body(await call('/notifications',author)),/Remove test notifications/);
 await call('/notifications',author,{action:'clear-samples'});
 assert.equal(sqlite.prepare('SELECT count(*) n FROM notifications').get().n,6);
});

test('admin landing distinguishes batch coverage and attendee logistics',async()=>{
 const {call,session,sqlite}=fixture();
 const admin=await session(1,'aaaa'), member=await session(2,'bbbb');
 sqlite.exec("INSERT INTO reunion_tracker VALUES(2,'attending',1,0,1)");
 assert.equal((await call('/admin',member)).status,404);
 const html=await body(await call('/admin',admin));
 assert.match(html,/Yearbook submissions/);
 assert.match(html,/Enriched information/);
 assert.match(html,/Attendee T-shirt size, Spouse T-shirt size, Sunday outing/);
 assert.match(html,/Admin View/);
 assert.doesNotMatch(html,/<div class="account-menu">[^\n]+>Notifications</);
 assert.match(await body(await call('/admin?view=tools',admin)),/Take action/);
});

test('logout invalidates the session and confirms sign-out even after a retry',async()=>{
 const {call,session,sqlite}=fixture();
 const ck=await session(2,'bbbb');
 for(let i=0;i<2;i++){
   const result=await call('/logout',ck,{});
   assert.equal(result.status,303);
   assert.equal(result.headers.get('location'),'/signin?signed-out=1');
   assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 }
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
 assert.equal((await call('/people/1',ck)).status,303);
 assert.match(await body(await call('/signin?signed-out=1')),/You’re signed out/);
});
