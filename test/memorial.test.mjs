import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,body} from './fixture.mjs';
test('memorial is excluded from directory, reunion and sign-in but remains taggable',async()=>{
 const {call,session,sqlite,objects}=fixture();
 sqlite.exec("INSERT INTO roster VALUES(3,'Sachin Kumar Suman','21','Chipko'); INSERT INTO roster_sections VALUES(3,'C'); INSERT INTO reunion_tracker(member,status) VALUES(3,'attending');");
 objects.set('memorial/sachin/tribute.json',new TextEncoder().encode(JSON.stringify([['','A sample tribute.']])));
 const ck=await session(2,'bbbb');
 assert.equal((await call('/remembering-sachin',ck)).headers.get('Location'),'/people/3');
 let html=await body(await call('/people/3',ck));
 assert.ok(html.indexOf('Add a memory')<html.indexOf('Through the years'));assert.match(html,/In loving memory/);assert.match(html,/A sample tribute./);assert.match(html,/\/compose\?person=3/);assert.doesNotMatch(html,/Ask to catch up/);
 assert.doesNotMatch(await body(await call('/people',ck)),/href="\/people\/3"/);
 assert.match(await body(await call('/people?q=Sachin',ck)),/No classmates match/);
 assert.doesNotMatch((await (await call('/people?fragment=1',ck)).json()).html,/href="\/people\/3"/);
 assert.doesNotMatch(await body(await call('/reunion',ck)),/href="\/people\/3"/);
 assert.deepEqual(await (await call('/names?q=Sachin')).json(),[]);
 assert.deepEqual(await (await call('/tag-search?q=Sachin',ck)).json(),[]);
 assert.equal((await (await call('/memory-targets?q=Sachin',ck)).json())[0].value,'person:3');
 assert.equal((await call('/meet',ck,{action:'add',target:'3'})).status,400);
 assert.equal((await call('/compose',ck,{id:crypto.randomUUID(),body:'Remembering our friend',about:'person:3'})).status,303);
 assert.match(await body(await call('/people/3',ck)),/Remembering our friend/);
 objects.set('memorial/sachin/then.jpg',new Uint8Array([1,2,3]));
 assert.equal((await call('/memorial-photo/then',ck)).status,200);
 assert.equal((await call('/memorial-photo/then')).status,303);
});
test('private preview gate requires invitation before demo access',async()=>{
 const {call,env}=fixture();env.PREVIEW_LABEL='Isolated preview';env.MEMORIAL_PREVIEW_KEY='123abc';env.PREVIEW_DEMO='1';
 assert.equal((await call('/')).status,403);
 assert.equal((await call('/preview-access?key=wrong')).status,403);
 const access=await call('/preview-access?key=123abc');assert.equal(access.status,303);
 assert.match(access.headers.get('Set-Cookie'),/HttpOnly/);
 assert.match(await body(await call('/','memorial-preview=123abc')),/Enter preview/);
});

test('profile picture is visible before required fields and supports saving a replacement',async()=>{
 const {call,session,sqlite}=fixture();const ck=await session(2,'bbbb');
 let html=await body(await call('/profile',ck));
 assert.ok(html.indexOf('id="profile-field-portrait"')<html.indexOf('The essentials · 5 required details'));
 assert.equal((html.match(/name="portraitPhoto"/g)||[]).length,1);
 assert.match(html,/data-portrait-preview/);
 const jpeg=new Uint8Array([0xff,0xd8,0xff,0xdb,0,4,0,0,0xff,0xda,0,2,1,0xff,0xd9]);
 const form=new FormData();form.set('profile_form','all');form.set('portraitPhoto',new File([jpeg],'profile.jpg',{type:'image/jpeg'}));
 const result=await call('/profile',ck,form,{Accept:'application/json'});
 assert.equal(result.status,200);const state=await result.json();assert.match(state.portrait.src,/\/media\/portrait\/2\?w=256&v=/);
 html=await body(await call('/profile',ck));assert.match(html,/Change photo/);
 assert.match(html,/data-portrait-preview><img src="\/media\/portrait\/2\?w=256"/);
});

test('Sachin can be tagged on an individual image and on the entire album',async()=>{
 const {call,session,sqlite}=fixture();
 sqlite.exec("INSERT INTO roster VALUES(3,'Sachin Kumar Suman','21','Chipko'); INSERT INTO roster_sections VALUES(3,'C');");
 const author=await session(1,'aaaa'),viewer=await session(2,'bbbb');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
 const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()],albumId=crypto.randomUUID();
 for(const id of ids){const f=new FormData();f.set('photo',new File([png],'photo.png',{type:'image/png'}));assert.equal((await call('/compose/photo?id='+id,author,f)).status,200);}
 const form=new FormData();form.set('id',albumId);form.set('title','Sachin tagged album');for(const id of ids)form.append('photoId',id);
 assert.equal((await call('/compose',author,form)).status,303);
 const url='/posts/'+albumId,media='post/'+ids[1];
 assert.equal((await call(url,author,{action:'tag-add',tag:'person:3',photo:media})).status,303);
 let html=await body(await call('/people/3',viewer));
 assert.match(html,/D21 · Section C · Class of 2006/);assert.doesNotMatch(html,/1982–2024|A life well remembered|PGP ABM 2006/);
 assert.match(html,new RegExp('data-photo-scope="post/'+ids[1]+'"'));
 assert.match(html,/Photo from Sachin tagged album/);
 assert.equal((await call(url,author,{action:'tag-add',tag:'person:3'})).status,303);
 html=await body(await call('/people/3',viewer));assert.match(html,/album-collage-3/);assert.doesNotMatch(html,/data-photo-scope=/);
});

 test('desktop navigation exposes memorial, photos and insights while mobile keeps More',async()=>{
 const {call,session}=fixture();const ck=await session(2,'bbbb');const html=await body(await call('/',ck));
 const desktop=html.split('class="desktop-menu"')[1].split('</nav>')[0];
 for(const href of ['/photos-of-you','/remembering-sachin','/wa/'])assert.ok(desktop.includes('class="nav-desktop-extra" href="'+href+'"'));
 const mobile=html.split('aria-label="Mobile navigation"')[1];assert.match(mobile,/class="nav-more"/);assert.match(mobile,/In Memoriam · Sachin/);
 assert.doesNotMatch(html,/Campus & traditions/);
 });
