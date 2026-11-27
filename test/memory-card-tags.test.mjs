// A memory card on /memories shows who is tagged on its photo, when the memory has just one photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

function world() {
  const fx = fixture(); const {sqlite} = fx;
  sqlite.exec(`INSERT INTO roster VALUES(3,'Third Person','D3','TP')`);
  fx.photo = (post, id) => {
    if (!sqlite.prepare('SELECT 1 FROM posts WHERE id=?').get(post)) sqlite.prepare('INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?)').run(post, 2, 'Study group', 5);
    sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)').run(id, 2, 'social/' + id, 'image/jpeg', 'h' + id, '', post, 1);
    return 'post/' + id;
  };
  fx.photoTag = (post, media, kind, target) => sqlite.prepare('INSERT INTO photo_tags(post,media,kind,target) VALUES(?,?,?,?)').run(post, media, kind, String(target));
  fx.card = async (post) => {
    const html = await (await fx.call('/memories', await fx.session(1, 'aaaa'))).text();
    const start = html.indexOf(`data-post="${post}"`);
    return html.slice(start, html.indexOf('</article>', start));
  };
  return fx;
}
const people = card => [...(card.match(/<div data-memory-tags>([\s\S]*?)<\/div><\/div>|<div data-memory-tags><\/div>/)?.[0] ?? '').matchAll(/href="\/people\/(\d+)"/g)].map(m => Number(m[1]));

test('a one-photo memory card lists the people tagged on its photo, with the memory tags, once each', async () => {
  const w = world();
  const m = w.photo('p1', 'u1');
  w.sqlite.exec("INSERT INTO memory_about VALUES('p1','person','3')");
  w.photoTag('p1', m, 'person', 2); w.photoTag('p1', m, 'person', 3);
  assert.deepEqual(people(await w.card('p1')).sort(), [2, 3]);
});

test('a one-photo yearbook memory card lists the photo tags too', async () => {
  const w = world();
  w.sqlite.exec(`INSERT INTO posts(id,author,body,created,origin) VALUES('lp',2,'me and sonali',5,'sub1');
    INSERT INTO photos VALUES('sub1','old1.jpg','memory','Old one');
    INSERT INTO memory_about VALUES('lp','person','3')`);
  w.photoTag('lp', 'legacy/lp/1', 'person', 2);
  assert.deepEqual(people(await w.card('lp')).sort(), [2, 3]);
});

test('an album card still lists only the album tags', async () => {
  const w = world();
  const a = w.photo('al', 'a1'); w.photo('al', 'a2');
  w.sqlite.exec(`INSERT INTO memory_albums(post,title,cover,photo_order) VALUES('al','Trip','a1','["a1","a2"]')`);
  w.photoTag('al', a, 'person', 3);
  assert.deepEqual(people(await w.card('al')), []);
});

test('the memory page keeps photo tags with the photo and memory tags below it', async () => {
  const w = world();
  const m = w.photo('p1', 'u1');
  w.sqlite.exec("INSERT INTO memory_about VALUES('p1','person','3')");
  w.photoTag('p1', m, 'person', 2);
  const html = await (await w.call('/posts/p1', await w.session(1, 'aaab'))).text();
  const below = html.slice(html.lastIndexOf('<div data-memory-tags>'));
  assert.deepEqual([...below.slice(0, below.indexOf('</div></div>') + 12).matchAll(/href="\/people\/(\d+)"/g)].map(x => Number(x[1])), [3]);
});

test('adding a tag from a card returns the card tags with the photo tags', async () => {
  const w = world();
  const m = w.photo('p1', 'u1');
  w.photoTag('p1', m, 'person', 2);
  const res = await w.call('/posts/p1', await w.session(1, 'aaac'), {action: 'tag-add', tag: '3'}, {Accept: 'application/json'});
  const body = await res.json();
  assert.match(body.cardTags, /\/people\/2"/);
  assert.match(body.cardTags, /\/people\/3"/);
  assert.doesNotMatch(body.tags, /\/people\/2"/);
});
