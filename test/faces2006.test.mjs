// Face references from 2006 photos: the 2006 group, tagged and archive references, the consistency check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './fixture.mjs';
import { refScore, FACE_BAR_2006, faceMode2006, vectorBytes, scanPhoto, refreshRefs, handleQueue, sweep, publishShadow, rematchMember,
  consistent, AGREE, TAGGED_MIN_SIZE, faceAdminData, finishRun, SCAN_ALL_PEOPLE } from '../faces.mjs';

const unitVec = i => { const a = new Float32Array(512); a[i] = 1; return a; };
const mixVec = (i, j, w) => { const a = new Float32Array(512); a[i] = w; a[j] = Math.sqrt(1 - w * w); return a; };

function world(mode = 'on', mode2006 = 'shadow') {
  const fx = fixture(); const {sqlite, env, objects} = fx;
  sqlite.exec(`INSERT INTO roster VALUES(3,'Third Person','D3','TP'),(4,'Fourth Person','D4','FP')`);
  env.FACE_TAGGING = mode; if (mode2006) env.FACE_TAGGING_2006 = mode2006;
  fx.photoFaces = {};
  env.FACES = {idFromName: n => n, get: () => ({fetch: async (url, init) => {
    const dims = fx.photoFaces[new Uint8Array(init.body)[0]] || [];
    return Response.json({model: 'buffalo_l/w600k_r50', width: 100, height: 100, faces: dims.map((d, i) => ({box: [i * 50, 0, i * 50 + 40, 40],
      score: 0.9, size: 40, embedding: Buffer.from(vectorBytes(typeof d === 'number' ? unitVec(d) : d)).toString('base64')}))});
  }})};
  fx.post = (post, author = 1) => {
    if (!sqlite.prepare('SELECT 1 FROM posts WHERE id=?').get(post)) sqlite.prepare('INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?)').run(post, author, 'x', 1);
  };
  fx.photo = (post, id, byte, author = 1) => {
    fx.post(post, author);
    objects.set('social/' + id, new Uint8Array([byte]));
    sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)').run(id, author, 'social/' + id, 'image/jpeg', 'h' + id, '', post, 1);
    return 'post/' + id;
  };
  // A stored (already scanned) face.
  fx.face = (media, post, vec, size = 200) => sqlite.prepare(`INSERT INTO faces(media,post,box,score,size,embedding,model)
    VALUES(?,?,'[0,0,200,200]',0.9,?,?,'buffalo_l/w600k_r50')`).run(media, post, size, vectorBytes(typeof vec === 'number' ? unitVec(vec) : vec)).lastInsertRowid;
  fx.handTag = (post, media, member) => sqlite.prepare("INSERT INTO photo_tags(post,media,kind,target) VALUES(?,?,'person',?)").run(post, media, String(member));
  // A Placecom-style portrait: one face, tagged by hand with one person.
  fx.portrait2006 = (id, member, vec, size = 200) => {
    const m = fx.photo('album', id, 200); fx.face(m, 'album', vec, size); fx.handTag('album', m, member); return m;
  };
  fx.ownPicture = (member, dim) => {
    sqlite.prepare("INSERT OR REPLACE INTO face_refs VALUES(?,'portrait','k',?,'buffalo_l/w600k_r50')").run(member, vectorBytes(unitVec(dim)));
    sqlite.prepare("INSERT OR REPLACE INTO profile_fields VALUES(?,'portraitObject',?)").run(member, 'profile/own' + member);
    sqlite.prepare('INSERT OR REPLACE INTO face_prefs(member,recognise,decided,ref_tried) VALUES(?,1,1,1)').run(member);
  };
  fx.refs = member => sqlite.prepare('SELECT source,object_key FROM face_refs WHERE member=? ORDER BY source').all(member).map(r => [r.source, r.object_key]);
  return fx;
}

test('the 2006 switch defaults to off and never goes further than FACE_TAGGING', () => {
  assert.equal(faceMode2006({FACE_TAGGING: 'on'}), 'off');
  assert.equal(faceMode2006({FACE_TAGGING: 'on', FACE_TAGGING_2006: 'shadow'}), 'shadow');
  assert.equal(faceMode2006({FACE_TAGGING: 'shadow', FACE_TAGGING_2006: 'on'}), 'shadow');
  assert.equal(faceMode2006({FACE_TAGGING: 'off', FACE_TAGGING_2006: 'on'}), 'off');
  assert.equal(faceMode2006({FACE_TAGGING: 'on', FACE_TAGGING_2006: 'yes'}), 'off');
});

test('with the 2006 group off, a member without a profile picture gets no references and no tags', async () => {
  const w = world('on', null); w.portrait2006('pc1', 3, 5);
  assert.equal(await refreshRefs(w.env, 3), 0);
  assert.deepEqual(w.refs(3), []);
  const m = w.photo('p1', 'u1', 1); w.photoFaces[1] = [5];
  assert.deepEqual((await scanPhoto(w.env, 'p1', m)).tagged, []);
});

test('a hand-tagged one-face photo becomes a tagged reference, read from the stored scan', async () => {
  const w = world(); const media = w.portrait2006('pc1', 3, 5);
  let calls = 0; const real = w.env.FACES.get; w.env.FACES.get = id => { calls++; return real(id); };
  assert.equal(await refreshRefs(w.env, 3), 1);
  assert.deepEqual(w.refs(3), [['tagged', media]]);
  assert.equal(calls, 0, 'no photo is sent to the face service');
});

test('photos with two faces, two person tags or a small face are not used as references', async () => {
  const w = world();
  const two = w.portrait2006('pc1', 3, 5); w.face(two, 'album', 6);
  const tags = w.portrait2006('pc2', 3, 5); w.handTag('album', tags, 4);
  w.portrait2006('pc3', 3, 5, TAGGED_MIN_SIZE - 1);
  assert.equal(await refreshRefs(w.env, 3), 0);
  assert.deepEqual(w.refs(3), []);
});

test('an imported yearbook PDF face is an archive reference', async () => {
  const w = world();
  w.sqlite.prepare("INSERT INTO face_archive VALUES(3,'iimages/D-3/third.png',?,'buffalo_l/w600k_r50')").run(vectorBytes(unitVec(5)));
  assert.equal(await refreshRefs(w.env, 3), 1);
  assert.deepEqual(w.refs(3), [['archive', 'iimages/D-3/third.png']]);
});

test('the consistency check leaves out a seed portrait of someone else and notes it for the admin', async () => {
  const w = world();
  w.sqlite.exec("INSERT INTO profile_seeds VALUES(3,'{}','approved','seed3.jpg')");
  w.objects.set('seed3.jpg', new Uint8Array([9])); w.photoFaces[9] = [7];          // the seed shows a different face
  const media = w.portrait2006('pc1', 3, mixVec(5, 6, 0.9));
  w.sqlite.prepare("INSERT INTO face_archive VALUES(3,'iimages/D-3/third.png',?,'buffalo_l/w600k_r50')").run(vectorBytes(unitVec(5)));
  assert.equal(await refreshRefs(w.env, 3), 2);
  assert.deepEqual(w.refs(3), [['archive', 'iimages/D-3/third.png'], ['tagged', media]]);
  const notes = w.sqlite.prepare('SELECT source,object_key,agreement FROM face_ref_notes WHERE member=3').all();
  assert.equal(notes.length, 1); assert.equal(notes[0].source, 'yearbook'); assert.equal(notes[0].object_key, 'seed3.jpg');
  assert.ok(notes[0].agreement < AGREE);
  const page = await (await w.call('/admin/faces', await w.session(1, 'aaaa'))).text();
  assert.match(page, /Third Person/); assert.match(page, /seed portrait/i);
});

test('when no two references agree, only the most trusted is kept', () => {
  const r = (source, d) => ({source, vector: unitVec(d)});
  const out = consistent([r('archive', 1), r('yearbook', 2), r('tagged', 3)]);
  assert.deepEqual(out.kept.map(x => x.source), ['tagged']);
  assert.deepEqual(out.dropped.map(x => x.source).sort(), ['archive', 'yearbook']);
  assert.deepEqual(consistent([r('then', 1)]).kept.map(x => x.source), ['then']);
});

test('while the 2006 group is in shadow, its matches stay shadow and own-picture members are tagged', async () => {
  const w = world('on', 'shadow'); w.ownPicture(2, 0); w.portrait2006('pc1', 3, 5);
  await refreshRefs(w.env, 3);
  const m = w.photo('p1', 'u1', 1); w.photoFaces[1] = [0, 5];
  assert.deepEqual((await scanPhoto(w.env, 'p1', m)).tagged.sort(), [2, 3]);
  const states = Object.fromEntries(w.sqlite.prepare('SELECT member,state FROM face_matches WHERE media=?').all(m).map(r => [r.member, r.state]));
  assert.deepEqual(states, {2: 'auto', 3: 'shadow'});
  assert.deepEqual(w.sqlite.prepare("SELECT target FROM photo_tags WHERE origin='auto'").all().map(r => r.target), ['2']);
  // Publishing leaves the 2006 group's shadow matches alone.
  w.sqlite.exec("UPDATE face_matches SET state='shadow' WHERE member=2; DELETE FROM photo_tags WHERE origin='auto'");
  assert.equal(await publishShadow(w.env), 1);
  assert.equal(w.sqlite.prepare("SELECT state FROM face_matches WHERE member=3").get().state, 'shadow');
});

test('with the 2006 group on, a member found only through 2006 photos is tagged and told once', async () => {
  const w = world('on', 'on'); w.portrait2006('pc1', 3, 5);
  await refreshRefs(w.env, 3);
  const m = w.photo('p1', 'u1', 1); w.face(m, 'p1', mixVec(5, 9, 0.6), 60);
  assert.equal(await rematchMember(w.env, 3), 1);
  assert.equal(w.sqlite.prepare("SELECT origin FROM photo_tags WHERE media=? AND target='3'").get(m).origin, 'auto');
});

test('Not me still sticks for the 2006 group', async () => {
  const w = world('on', 'on'); w.portrait2006('pc1', 3, 5); await refreshRefs(w.env, 3);
  const m = w.photo('p1', 'u1', 1); w.photoFaces[1] = [5];
  w.sqlite.prepare("INSERT INTO face_matches VALUES(?,3,'p1',NULL,0.9,'removed',1,1)").run(m);
  assert.deepEqual((await scanPhoto(w.env, 'p1', m)).tagged, []);
});

test('tagging someone by hand on a photo marks their references for a rebuild', async () => {
  const w = world(); const m = w.photo('p1', 'u1', 1);
  w.sqlite.exec("INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(3,1,1,3,5)");
  const res = await w.call('/posts/p1', await w.session(1, 'aaaa'), {action: 'tag-add', photo: m, tag: '3'});
  assert.ok(res.status < 400);
  assert.deepEqual({...w.sqlite.prepare('SELECT ref_tries,ref_tried FROM face_prefs WHERE member=3').get()}, {ref_tries: 0, ref_tried: null});
});

test('correcting a wrong photo tag marks that person for a rebuild', async () => {
  const w = world(); const m = w.portrait2006('pc1', 3, 5);
  w.sqlite.exec("INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(3,1,1,3,5)");
  const res = await w.call('/posts/album', await w.session(1, 'aaaa'), {action: 'tag-correct', photo: m, tag: '3'});
  assert.ok(res.status < 400);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='3'").get().n, 0);
  assert.equal(w.sqlite.prepare('SELECT ref_tried FROM face_prefs WHERE member=3').get().ref_tried, null);
});

test('scanning a one-face photo with one hand tag marks that person for a rebuild', async () => {
  const w = world(); const m = w.photo('p1', 'u1', 1); w.photoFaces[1] = [5];
  w.handTag('p1', m, 3);
  w.sqlite.exec("INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(3,1,1,3,5)");
  await scanPhoto(w.env, 'p1', m);
  assert.equal(w.sqlite.prepare('SELECT ref_tried FROM face_prefs WHERE member=3').get().ref_tried, null);
});

test('the batch builds references for the whole roster only while the 2006 group is on or in shadow', async () => {
  for (const [mode2006, expected] of [[null, []], ['shadow', [1, 2, 3, 4]]]) {
    const w = world('on', mode2006); const sent = [];
    w.env.FACE_JOBS = {sendBatch: async m => { sent.push(...m); }, send: async () => {}};
    await sweep(w.env);
    assert.deepEqual(sent.filter(m => m.body.type === 'ref').map(m => m.body.member), expected, String(mode2006));
  }
});

test('switching the 2006 group off removes its references and automatic tags at the next batch', async () => {
  const w = world('on', 'on'); w.portrait2006('pc1', 3, 5); await refreshRefs(w.env, 3);
  const m = w.photo('p1', 'u1', 1); w.photoFaces[1] = [5]; await scanPhoto(w.env, 'p1', m);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='3' AND origin='auto'").get().n, 1);
  delete w.env.FACE_TAGGING_2006; w.env.FACE_JOBS = {sendBatch: async () => {}, send: async () => {}};
  await sweep(w.env);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='3' AND origin='auto'").get().n, 0);
  assert.deepEqual(w.refs(3), []);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='3' AND origin='manual'").get().n, 1);
});

test('before migration 0021 the 2006 group stays off', async () => {
  const w = fixture({skip: ['0021_face_refs_2006.sql']});
  w.sqlite.exec(`INSERT INTO roster VALUES(3,'Third Person','D3','TP')`);
  w.env.FACE_TAGGING = 'on'; w.env.FACE_TAGGING_2006 = 'on';
  assert.equal(await refreshRefs(w.env, 3), 0);
  const data = await faceAdminData(w.env);
  assert.equal(data.ready2006, false); assert.deepEqual(data.notes, []);
  assert.equal((await w.call('/admin/faces', await w.session(1, 'aaaa'))).status, 200);
});

test('migration 0021 keeps existing references and can be run again', () => {
  const w = fixture();
  w.sqlite.exec("INSERT INTO face_refs VALUES(2,'portrait','k',x'00','m')");
  w.sqlite.exec(readFileSync(new URL('../migrations/0021_face_refs_2006.sql', import.meta.url), 'utf8'));
  assert.equal(w.sqlite.prepare('SELECT count(*) n FROM face_refs').get().n, 1);
  w.sqlite.exec("INSERT INTO face_refs VALUES(2,'tagged','post/x',x'00','m'),(2,'archive','iimages/a.png',x'00','m')");
  assert.throws(() => w.sqlite.exec("INSERT INTO face_refs VALUES(2,'robot','k',x'00','m')"));
});

test('a match through a 2006 photo needs 0.40; through a current photo 0.35 is enough', async () => {
  assert.equal(FACE_BAR_2006, 0.40);
  const old = [{vector: unitVec(5), old: true}];
  assert.equal(refScore(mixVec(5, 9, 0.38), old), -1);
  assert.ok(Math.abs(refScore(mixVec(5, 9, 0.41), old) - 0.41) < 1e-6);
  assert.ok(Math.abs(refScore(mixVec(5, 9, 0.38), [unitVec(5)]) - 0.38) < 1e-6);
  const w = world('on', 'on'); w.portrait2006('pc1', 3, 5); await refreshRefs(w.env, 3);
  const a = w.photo('p1', 'u1', 1); w.photoFaces[1] = [mixVec(5, 9, 0.37)];
  assert.deepEqual((await scanPhoto(w.env, 'p1', a)).tagged, []);
  const b = w.photo('p2', 'u2', 2); w.photoFaces[2] = [mixVec(5, 9, 0.45)];
  assert.deepEqual((await scanPhoto(w.env, 'p2', b)).tagged, [3]);
  const c = w.photo('p3', 'u3', 3); w.face(c, 'p3', mixVec(5, 9, 0.37), 60);
  assert.equal(await rematchMember(w.env, 3), 0);
});

test('Scan all queues reference rebuilds for the whole roster, and the finish job re-matches all of them', async () => {
  const w = world('on', 'on');
  const ids = Array.from({length: 150}, (_, i) => 1000 + i);
  const ins = w.sqlite.prepare("INSERT INTO roster VALUES(?,?,'D','')");
  for (const id of ids) ins.run(id, 'Person ' + id);
  const sent = []; w.env.FACE_JOBS = {sendBatch: async m => { sent.push(...m); }, send: async () => {}};
  await w.call('/admin/faces', await w.session(1, 'aaaa'), {action: 'scan-all'});
  assert.ok(SCAN_ALL_PEOPLE >= 1000);
  assert.equal(sent.filter(m => m.body.type === 'ref').length, 154);
  // Every one of them has a reference and is in one stored photo; the finish job must reach the last one too.
  const m = w.photo('p1', 'u1', 1);
  const refStmt = w.sqlite.prepare("INSERT INTO face_refs VALUES(?,'archive','k',?,'buffalo_l/w600k_r50')");
  const pref = w.sqlite.prepare('INSERT OR REPLACE INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(?,1,1,0,?)');
  ids.forEach((id, i) => { refStmt.run(id, vectorBytes(unitVec(i))); pref.run(id, Date.now()); });
  w.face(m, 'p1', unitVec(149), 60);
  await finishRun(w.env);
  assert.equal(w.sqlite.prepare("SELECT count(*) n FROM photo_tags WHERE target='1149' AND origin='auto'").get().n, 1);
});
