// "Photos of you" also counts a tag on the memory as a whole when the memory has only one photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { vectorBytes, refreshRefs } from '../faces.mjs';

const unitVec = i => { const a = new Float32Array(512); a[i] = 1; return a; };

function world() {
  const fx = fixture(); const {sqlite, env, objects} = fx;
  sqlite.exec(`INSERT INTO roster VALUES(3,'Third Person','D3','TP'),(4,'Fourth Person','D4','FP')`);
  env.FACE_TAGGING = 'on'; env.FACE_TAGGING_2006 = 'shadow';
  env.FACES = {idFromName: n => n, get: () => ({fetch: async () => Response.json({model: 'buffalo_l/w600k_r50', width: 100, height: 100, faces: []})})};
  fx.photo = (post, id, author = 1) => {
    if (!sqlite.prepare('SELECT 1 FROM posts WHERE id=?').get(post)) sqlite.prepare('INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?)').run(post, author, 'x', 1);
    objects.set('social/' + id, new Uint8Array([1]));
    sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)').run(id, author, 'social/' + id, 'image/jpeg', 'h' + id, '', post, 1);
    return 'post/' + id;
  };
  fx.about = (post, member) => sqlite.prepare("INSERT INTO memory_about VALUES(?,'person',?)").run(post, String(member));
  fx.face = (media, post, dim, size = 200) => sqlite.prepare(`INSERT INTO faces(media,post,box,score,size,embedding,model)
    VALUES(?,?,'[0,0,200,200]',0.9,?,?,'buffalo_l/w600k_r50')`).run(media, post, size, vectorBytes(unitVec(dim)));
  fx.gallery = async member => (await fx.call('/photos-of-you', await fx.session(member, 'ab' + member))).text();
  return fx;
}

test('a memory tag on a single-photo memory puts that photo in Photos of you', async () => {
  const w = world();
  w.photo('p1', 'u1'); w.about('p1', 2);
  w.photo('p2', 'u2'); w.sqlite.exec("INSERT INTO tags VALUES('p2',2,'accepted')");
  w.photo('p3', 'u3'); w.sqlite.exec("INSERT INTO tags VALUES('p3',2,'pending')");
  const page = await w.gallery(2);
  assert.match(page, /\/media\/post\/u1/);
  assert.match(page, /\/media\/post\/u2/);
  assert.doesNotMatch(page, /\/media\/post\/u3/);
  assert.doesNotMatch(await w.gallery(3), /\/media\/post\/u1/);
});

test('a memory tag on an album does not', async () => {
  const w = world();
  w.photo('album', 'a1'); w.photo('album', 'a2'); w.about('album', 2);
  assert.doesNotMatch(await w.gallery(2), /\/media\/post\/a[12]/);
});

test('a photo with both a photo tag and a memory tag shows once', async () => {
  const w = world();
  const m = w.photo('p1', 'u1'); w.about('p1', 2);
  w.sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES('p1',?,'person','2')").run(m);
  assert.equal(((await w.gallery(2)).match(/name="media" value="post\/u1"/g) || []).length, 1);
});

test('a single-photo yearbook memory tagged on the memory shows its photo', async () => {
  const w = world();
  w.sqlite.exec(`INSERT INTO posts(id,author,body,created,origin) VALUES('lp',1,'old',1,'sub1');
    INSERT INTO photos VALUES('sub1','old1.jpg','memory','Old one');
    INSERT INTO memory_about VALUES('lp','person','2')`);
  assert.match(await w.gallery(2), /\/media\/legacy\/lp\/1/);
});

test('hidden memories and muted subjects stay out', async () => {
  const w = world();
  w.photo('p1', 'u1'); w.about('p1', 2); w.sqlite.exec("UPDATE posts SET hidden=1 WHERE id='p1'");
  w.photo('p2', 'u2'); w.sqlite.exec("UPDATE posts SET subject=2 WHERE id='p2'; INSERT INTO muted_subjects VALUES('p2')");
  const page = await w.gallery(2);
  assert.doesNotMatch(page, /\/media\/post\/u1/);
  assert.doesNotMatch(page, /\/media\/post\/u2/);
});

test('removing it from the gallery keeps it out and leaves the memory tag alone', async () => {
  const w = world();
  const m = w.photo('p1', 'u1'); w.about('p1', 2);
  const form = new FormData(); form.append('media', m);
  const res = await w.call('/faces/gallery-remove', await w.session(2, 'cd02'), form);
  assert.equal(res.headers.get('Location'), '/photos-of-you?removed=1');
  assert.doesNotMatch(await w.gallery(2), /\/media\/post\/u1/);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM memory_about WHERE post='p1' AND target='2'").get().n, 1);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE media=? AND member=2").get(m).state, 'removed');
});

test('a one-face photo on a memory tagged with only that person becomes their face reference', async () => {
  const w = world();
  const m = w.photo('p1', 'u1'); w.about('p1', 3); w.face(m, 'p1', 7);
  assert.ok(await refreshRefs(w.env, 3) >= 1);
  assert.deepEqual(w.sqlite.prepare('SELECT source,object_key FROM face_refs WHERE member=3').all().map(r => [r.source, r.object_key]), [['tagged', m]]);
});

test('no face reference when the memory tags two people', async () => {
  const w = world();
  const m = w.photo('p1', 'u1'); w.about('p1', 3); w.about('p1', 4); w.face(m, 'p1', 7);
  await refreshRefs(w.env, 3);
  assert.deepEqual(w.sqlite.prepare('SELECT source FROM face_refs WHERE member=3').all(), []);
});

test('tagging someone on a memory, or removing it, asks for their face references to be rebuilt', async () => {
  const w = world();
  w.photo('p1', 'u1');
  const prefs = () => w.sqlite.prepare('SELECT ref_tries FROM face_prefs WHERE member=3').get();
  assert.equal(prefs(), undefined);
  await w.call('/posts/p1', await w.session(1, 'aaaa'), {action: 'tag-add', tag: '3'});
  assert.equal(prefs().ref_tries, 0);
  w.sqlite.exec('UPDATE face_prefs SET ref_tries=3 WHERE member=3');
  await w.call('/posts/p1', await w.session(1, 'aaab'), {action: 'tag-correct', tag: '3'});
  assert.equal(prefs().ref_tries, 0);
});

test('a new one-photo memory tagged with a classmate asks for their references to be rebuilt; an album does not', async () => {
  const w = world();
  const stage = () => { const id = crypto.randomUUID(); w.sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,NULL,?)').run(id, 2, 'test/' + id, 'image/png', 'd', '', 1); return id; };
  const compose = ids => { const f = new FormData(); f.set('id', crypto.randomUUID()); f.set('body', 'Night out'); f.set('title', 'Night out'); f.set('revision', '0');
    ids.forEach(id => f.append('photoId', id)); f.append('about', 'person:3'); f.append('about', 'person:4'); return f; };
  const ck = await w.session(2, 'bbbb');
  assert.equal((await w.call('/compose', ck, compose([stage(), stage()]))).status, 303);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_prefs WHERE member IN (3,4)').get().n, 0);
  assert.equal((await w.call('/compose', ck, compose([stage()]))).status, 303);
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_prefs WHERE member IN (3,4)').get().n, 2);
});
