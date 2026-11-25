// Automatic face tagging: matching, the face-service client, queue jobs, consent and admin.
// Design: docs/superpowers/specs/2026-11-25-face-tagging-design.md

export const FACE_BAR = 0.35;
export const FACE_MODEL = 'buffalo_l/w600k_r50';

export const faceMode = env => ['off','shadow','on'].includes(env?.FACE_TAGGING) ? env.FACE_TAGGING : 'off';

// D1 hands BLOBs back as ArrayBuffer or number[]; node:sqlite as Uint8Array.
export function toVector(blob) {
  const bytes = blob instanceof Uint8Array ? blob : blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export const vectorBytes = vector => new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function similarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Each face goes to at most one member and each member to at most one face, best score first.
export function assign(faces, refs) {
  const pairs = [];
  for (const face of faces) {
    for (const [member, vectors] of refs) {
      let best = -1;
      for (const ref of vectors) best = Math.max(best, similarity(face.vector, ref));
      if (best >= FACE_BAR) pairs.push({face: face.id, member, score: best});
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedFaces = new Set(), usedMembers = new Set(), chosen = [];
  for (const pair of pairs) {
    if (usedFaces.has(pair.face) || usedMembers.has(pair.member)) continue;
    usedFaces.add(pair.face); usedMembers.add(pair.member); chosen.push(pair);
  }
  return chosen;
}

// ---------- the container that runs face-service/app.py ----------

const IDLE_MS = 5 * 60 * 1000;
const START_TIMEOUT_MS = 60 * 1000;

// A plain Durable Object class (no `cloudflare:workers` import, so tests can load this module).
export class FaceContainer {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.clock = () => Date.now();
    this.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    const container = this.state.container;
    if (!container.running) container.start({enableInternet: false});
    await this.state.storage.put('lastUsed', this.clock());
    await this.state.storage.setAlarm(this.clock() + IDLE_MS);
    const deadline = this.clock() + START_TIMEOUT_MS;
    // The container takes a few seconds to load the models after a cold start.
    for (;;) {
      try {
        return await container.getTcpPort(8080).fetch('http://container' + url.pathname + url.search,
          {method: request.method, body, headers: {'Content-Type': 'application/octet-stream'}});
      } catch (error) {
        if (this.clock() >= deadline) return new Response('face service unavailable', {status: 503});
        await this.sleep(500);
      }
    }
  }

  async alarm() {
    const lastUsed = (await this.state.storage.get('lastUsed')) || 0;
    if (this.clock() - lastUsed >= IDLE_MS) {
      if (this.state.container.running) await this.state.container.destroy();
    } else {
      await this.state.storage.setAlarm(lastUsed + IDLE_MS);
    }
  }
}

// Send image bytes to the face service. Locally, FACE_SERVICE_URL points at `python3 face-service/app.py`.
export async function analyseImage(env, bytes, mode) {
  const path = '/faces?mode=' + mode;
  const init = {method: 'POST', body: bytes, headers: {'Content-Type': 'application/octet-stream'}};
  const response = env.FACE_SERVICE_URL
    ? await fetch(env.FACE_SERVICE_URL.replace(/\/$/, '') + path, init)
    : await env.FACES.get(env.FACES.idFromName('matcher')).fetch('https://faces' + path, init);
  if (response.status !== 200) throw new Error('face service ' + response.status);
  const result = await response.json();
  return {...result, faces: result.faces.map(face => {
    const faceBytes = fromBase64(face.embedding);
    return {box: face.box, score: face.score, size: face.size, bytes: faceBytes, vector: toVector(faceBytes)};
  })};
}

// ---------- photo jobs ----------

const POST_VISIBLE = 'p.hidden=0 AND (p.topic IS NULL OR EXISTS(SELECT 1 FROM topics t WHERE t.id=p.topic AND t.hidden=0))';
const q = (db, query, ...args) => db.prepare(query).bind(...args);
const first = (db, query, ...args) => q(db, query, ...args).first();
const rows = async (db, query, ...args) => (await q(db, query, ...args).all()).results;
const anchorFor = media => 'photo-' + media.replace(/\//g, '-');

// Queue every photo of a memory for scanning. Never throws: posting must not fail because of face tagging.
export async function enqueuePhotos(env, post, media) {
  if (faceMode(env) === 'off' || !env.FACE_JOBS || !media.length) return;
  try {
    for (let i = 0; i < media.length; i += 100)
      await env.FACE_JOBS.sendBatch(media.slice(i, i + 100).map(m => ({body: {type: 'media', post, media: m}})));
  } catch (error) { console.error('face queue', error?.message); }
}

// R2 key of a photo shown in a visible memory, or null.
export async function mediaObject(db, media) {
  const [kind, a, b] = String(media).split('/');
  let row = null;
  if (kind === 'post' && a) row = await first(db, `SELECT a.object_key FROM uploads a JOIN posts p ON p.id=a.post WHERE a.id=? AND ${POST_VISIBLE}`, a);
  else if (kind === 'legacy' && a && Number(b) > 0) row = await first(db, `SELECT ph.object_key FROM posts p JOIN photos ph ON ph.submission=p.origin
    WHERE p.id=? AND ${POST_VISIBLE} ORDER BY ph.object_key LIMIT 1 OFFSET ?`, a, Number(b) - 1);
  return row?.object_key || null;
}

async function readObject(env, key) {
  const object = await env.MEDIA.get(key);
  if (!object) return null;
  if (object.arrayBuffer) return new Uint8Array(await object.arrayBuffer());
  return object.body instanceof Uint8Array ? object.body : new Uint8Array(await new Response(object.body).arrayBuffer());
}

async function consentingRefs(db) {
  const refs = new Map();
  for (const ref of await rows(db, `SELECT r.member,r.embedding FROM face_refs r JOIN face_prefs f ON f.member=r.member AND f.recognise=1`)) {
    if (!refs.has(ref.member)) refs.set(ref.member, []);
    refs.get(ref.member).push(toVector(ref.embedding));
  }
  return refs;
}

// Write matches the same way for every path (new photo, new references, publishing shadow results).
// rows: [{media, post, member, face, score}]. notify: 'post' (one per member per memory) or 'summary' (one per member).
export async function writeMatches(env, matches, notify = 'post') {
  const db = env.DB, mode = faceMode(env), stamp = Date.now();
  if (mode === 'off') return [];
  const written = [];
  for (const m of matches) {
    const blocked = await first(db, `SELECT
      EXISTS(SELECT 1 FROM photo_tags WHERE post=? AND media=? AND kind='person' AND target=? AND origin='manual') AS manual,
      EXISTS(SELECT 1 FROM face_matches WHERE media=? AND member=? AND state='removed') AS removed`,
      m.post, m.media, String(m.member), m.media, m.member);
    if (blocked.manual || blocked.removed) continue;
    const jobs = [];
    if (mode === 'shadow') {
      jobs.push(q(db, `INSERT INTO face_matches VALUES(?,?,?,?,?,'shadow',?) ON CONFLICT(media,member)
        DO UPDATE SET face=excluded.face,score=excluded.score WHERE face_matches.state='shadow'`, m.media, m.member, m.post, m.face, m.score, stamp));
    } else {
      jobs.push(q(db, `INSERT INTO face_matches VALUES(?,?,?,?,?,'auto',?) ON CONFLICT(media,member)
        DO UPDATE SET face=excluded.face,score=excluded.score,state='auto' WHERE face_matches.state<>'removed'`, m.media, m.member, m.post, m.face, m.score, stamp));
      jobs.push(q(db, `INSERT OR IGNORE INTO photo_tags(post,media,kind,target,origin) VALUES(?,?,'person',?,'auto')`, m.post, m.media, String(m.member)));
      if (notify === 'post') jobs.push(q(db, `INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
        SELECT ?,p.author,'mention',p.id,?,'found:'||p.id FROM posts p WHERE p.id=? AND p.author<>?`, m.member, anchorFor(m.media), m.post, m.member));
    }
    await db.batch(jobs);
    written.push(m);
  }
  if (mode === 'on' && notify === 'summary') {
    const byMember = new Map();
    for (const m of written) { if (!byMember.has(m.member)) byMember.set(m.member, []); byMember.get(m.member).push(m); }
    for (const [member, found] of byMember) {
      const posts = await rows(db, `SELECT id,created FROM posts WHERE id IN (${found.map(() => '?').join(',')})`, ...found.map(f => f.post));
      const newest = posts.sort((a, b) => b.created - a.created)[0];
      const pick = found.find(f => f.post === newest.id);
      await q(db, `INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key) VALUES(?,NULL,'mention',?,?,?)`,
        member, pick.post, anchorFor(pick.media), `found-all:${found.length}:${stamp}`).run();
    }
  }
  return written;
}

export async function scanPhoto(env, post, media) {
  const db = env.DB;
  if (faceMode(env) === 'off') return {faces: 0, tagged: []};
  const key = await mediaObject(db, media);
  const bytes = key && await readObject(env, key);
  if (!bytes) return {faces: 0, tagged: []};
  const result = await analyseImage(env, bytes, 'photo');
  const stamp = Date.now();
  await db.batch([
    q(db, 'DELETE FROM faces WHERE media=?', media),
    ...result.faces.map(f => q(db, 'INSERT INTO faces(media,post,box,score,size,embedding,model) VALUES(?,?,?,?,?,?,?)',
      media, post, JSON.stringify(f.box), f.score, f.size, f.bytes, result.model)),
    q(db, `INSERT INTO face_scans VALUES(?,?,'done',?,?,?) ON CONFLICT(media) DO UPDATE SET status='done',faces=excluded.faces,
      model=excluded.model,scanned=excluded.scanned`, media, post, result.faces.length, result.model, stamp),
  ]);
  const ids = (await rows(db, 'SELECT id FROM faces WHERE media=? ORDER BY id', media)).map(r => r.id);
  const pairs = assign(result.faces.map((f, i) => ({id: ids[i], vector: f.vector})), await consentingRefs(db));
  const written = await writeMatches(env, pairs.map(p => ({media, post, member: p.member, face: p.face, score: p.score})), 'post');
  return {faces: result.faces.length, tagged: written.map(w => w.member)};
}

export async function handleQueue(batch, env) {
  for (const msg of batch.messages) {
    const job = msg.body || {};
    try {
      if (job.type === 'media') await scanPhoto(env, job.post, job.media);
      else if (job.type === 'ref' && faceMode(env) !== 'off') { await refreshRefs(env, job.member); await rematchMember(env, job.member); }
      msg.ack();
    } catch (error) {
      console.error('face job', job.type, error?.message);
      if (job.type === 'media' && msg.attempts >= 5) {
        await q(env.DB, `INSERT INTO face_scans VALUES(?,?,'failed',0,?,?) ON CONFLICT(media) DO UPDATE SET status='failed',scanned=excluded.scanned`,
          job.media, job.post, FACE_MODEL, Date.now()).run().catch(() => {});
        msg.ack();
      } else msg.retry({delaySeconds: Math.min(300, 30 * (msg.attempts || 1))});
    }
  }
}

// Statements that forget a hidden memory's faces (Not me choices are kept).
export const forgetPostFaces = (db, post) => [
  q(db, 'DELETE FROM faces WHERE post=?', post),
  q(db, 'DELETE FROM face_scans WHERE post=?', post),
  q(db, "DELETE FROM face_matches WHERE post=? AND state<>'removed'", post),
];

// ---------- consent and reference faces ----------

export const FACE_COPY = 'We use your profile photos and your 2006 yearbook photo to find you in batch photos. You can turn this off any time.';
const safeNext = value => /^\/(?![\/\\])[^\r\n\\]*$/.test(String(value || '')) ? String(value) : '/';
const see = url => new Response(null, {status: 303, headers: {Location: url}});

// 'hidden' while face tagging is off; 'ask' until the member has answered; then 'on' or 'off'.
export async function consentState(env, me) {
  if (faceMode(env) === 'off') return 'hidden';
  const row = await first(env.DB, 'SELECT recognise FROM face_prefs WHERE member=?', me);
  return !row ? 'ask' : row.recognise ? 'on' : 'off';
}

async function sendJob(env, body) {
  try { if (env.FACE_JOBS) await env.FACE_JOBS.send(body); } catch (error) { console.error('face queue', error?.message); }
}

// After a profile photo changes: rebuild that member's references, if they have said yes.
export async function enqueueRefs(env, member) {
  if (faceMode(env) === 'off') return;
  const row = await first(env.DB, 'SELECT recognise FROM face_prefs WHERE member=?', member);
  if (row?.recognise) await sendJob(env, {type: 'ref', member});
}

async function refSources(db, member) {
  const sources = {};
  for (const row of await rows(db, `SELECT field,value FROM profile_fields WHERE member=? AND field IN ('portraitObject','thenPhotoObject','nowPhotoObject') AND trim(value)<>''`, member))
    sources[{portraitObject: 'portrait', thenPhotoObject: 'then', nowPhotoObject: 'now'}[row.field]] = row.value;
  const seed = await first(db, `SELECT portrait_key FROM profile_seeds WHERE roster_id=? AND portrait_key IS NOT NULL AND portrait_key<>''`, member);
  const yearbook = seed || await first(db, `SELECT ph.object_key AS portrait_key FROM yearbook_public y,json_each(y.images) j
    JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission') AND ph.object_key=json_extract(j.value,'$.key')
    WHERE y.member=? ORDER BY j.key LIMIT 1`, member);
  if (yearbook?.portrait_key) sources.yearbook = yearbook.portrait_key;
  return sources;
}

export async function refreshRefs(env, member) {
  const db = env.DB, kept = [];
  for (const [source, key] of Object.entries(await refSources(db, member))) {
    const bytes = await readObject(env, key);
    if (!bytes) continue;
    const face = (await analyseImage(env, bytes, 'portrait')).faces[0];
    if (!face) continue;
    await q(db, 'INSERT OR REPLACE INTO face_refs VALUES(?,?,?,?,?)', member, source, key, face.bytes, FACE_MODEL).run();
    kept.push(source);
  }
  await q(db, `DELETE FROM face_refs WHERE member=? AND source NOT IN (${kept.map(() => '?').join(',') || "''"})`, member, ...kept).run();
  return kept.length;
}

// Match one member against every face already stored (photos shared before they joined or said yes).
export async function rematchMember(env, member) {
  const db = env.DB;
  if (!(await first(db, 'SELECT recognise FROM face_prefs WHERE member=?', member))?.recognise) return 0;
  const refs = (await rows(db, 'SELECT embedding FROM face_refs WHERE member=?', member)).map(r => toVector(r.embedding));
  if (!refs.length) return 0;
  const best = new Map();
  for (let after = 0; ;) {
    const page = await rows(db, 'SELECT id,media,post,embedding FROM faces WHERE id>? ORDER BY id LIMIT 500', after);
    if (!page.length) break;
    for (const face of page) {
      const vector = toVector(face.embedding);
      let score = -1;
      for (const ref of refs) score = Math.max(score, similarity(vector, ref));
      if (score >= FACE_BAR && !(best.get(face.media)?.score >= score)) best.set(face.media, {media: face.media, post: face.post, member, face: face.id, score});
    }
    after = page[page.length - 1].id;
  }
  const matches = [];
  for (const m of best.values()) {
    const taken = await first(db, `SELECT 1 AS yes FROM face_matches WHERE media=? AND face=? AND member<>? AND state IN ('shadow','auto')`, m.media, m.face, member);
    if (!taken) matches.push(m);
  }
  return (await writeMatches(env, matches, 'summary')).length;
}

export async function faceRoute({req, env, me, path, post}) {
  if (path !== '/faces/consent' || !post) return null;
  if (faceMode(env) === 'off') return new Response('Page unavailable', {status: 404});
  const form = await req.formData();
  const choice = String(form.get('choice') || '');
  if (!['yes', 'no'].includes(choice)) return new Response('Choose yes or no.', {status: 400});
  const db = env.DB;
  const pref = q(db, 'INSERT INTO face_prefs VALUES(?,?,?) ON CONFLICT(member) DO UPDATE SET recognise=excluded.recognise,decided=excluded.decided',
    me, +(choice === 'yes'), Date.now());
  if (choice === 'yes') {
    await pref.run();
    await sendJob(env, {type: 'ref', member: me});
  } else {
    await db.batch([pref,
      q(db, 'DELETE FROM face_refs WHERE member=?', me),
      q(db, "DELETE FROM photo_tags WHERE kind='person' AND target=? AND origin='auto'", String(me)),
      q(db, "DELETE FROM face_matches WHERE member=? AND state<>'removed'", me)]);
  }
  return see(safeNext(form.get('next')));
}
