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
    this.ensureStarted();
    await this.state.storage.put('lastUsed', this.clock());
    await this.state.storage.setAlarm(this.clock() + IDLE_MS);
    const deadline = this.clock() + START_TIMEOUT_MS;
    // The container takes a few seconds to load the models after a cold start.
    for (;;) {
      try {
        return await this.state.container.getTcpPort(8080).fetch('http://container' + url.pathname + url.search,
          {method: request.method, body, headers: {'Content-Type': 'application/octet-stream'}});
      } catch (error) {
        if (this.clock() >= deadline) return new Response('face service unavailable', {status: 503});
        await this.sleep(500);
        this.ensureStarted();   // starts it again if it exited while we waited
      }
    }
  }

  // Start the container unless it is running or already starting (two requests can arrive together on a cold start).
  ensureStarted() {
    const container = this.state.container;
    if (container.running || this.starting) return;
    container.start({enableInternet: false});
    this.starting = true;
    const done = () => { this.starting = false; };
    container.monitor?.().then(done, done);
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
// Two containers share the work (max_instances = 2): the key (a media id or member) picks one.
const shard = key => { let sum = 0; for (const ch of String(key)) sum += ch.charCodeAt(0); return 'matcher-' + (sum % 2); };

export async function analyseImage(env, bytes, mode, key = '') {
  const path = '/faces?mode=' + mode;
  const init = {method: 'POST', body: bytes, headers: {'Content-Type': 'application/octet-stream'}};
  const response = env.FACE_SERVICE_URL
    ? await fetch(env.FACE_SERVICE_URL.replace(/\/$/, '') + path, init)
    : await env.FACES.get(env.FACES.idFromName(shard(key))).fetch('https://faces' + path, init);
  if (response.status !== 200) throw Object.assign(new Error('face service ' + response.status), {status: response.status});
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
const changes = result => result?.meta?.changes ?? result?.changes ?? 0;
const CHUNK = 30;   // matches per db.batch: three statements each, well inside D1's limits

// Migration 0019 may not have run yet (it must follow the deploy). Until it has, face tagging stays hidden and
// nothing touches its tables or columns. Only a positive answer is cached, per database binding.
const schemaReady = new WeakSet();
export async function faceSchema(db) {
  if (schemaReady.has(db)) return true;
  try {
    await db.prepare('SELECT origin FROM photo_tags LIMIT 0').bind().all();
    await db.prepare('SELECT notified FROM face_matches LIMIT 0').bind().all();
  } catch { return false; }
  schemaReady.add(db);
  return true;
}

// Queue every photo of a new memory. Never throws: posting must not fail because of face tagging.
export async function enqueuePhotos(env, post, media) {
  if (faceMode(env) === 'off' || !env.FACE_JOBS || !media.length) return;
  try {
    if (!await faceSchema(env.DB)) return;
    for (let i = 0; i < media.length; i += 100)
      await env.FACE_JOBS.sendBatch(media.slice(i, i + 100).map(m => ({body: {type: 'media', post, media: m, notify: 'post'}})));
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

const MAX_SEND = 15 * 1024 * 1024;

// A photo to analyse: the original, or for a very large one a 1600 px copy made with Cloudflare Images.
async function photoBytes(env, key) {
  const bytes = await readObject(env, key);
  if (!bytes || bytes.byteLength <= MAX_SEND || !env.IMAGES) return bytes;
  const result = await env.IMAGES.input(new Response(bytes).body).transform({width: 1600, height: 1600, fit: 'scale-down'})
    .output({format: 'image/jpeg', quality: 90});
  return new Uint8Array(await result.response().arrayBuffer());
}

async function readObject(env, key) {
  const object = await env.MEDIA.get(key);
  if (!object) return null;
  if (object.arrayBuffer) return new Uint8Array(await object.arrayBuffer());
  return object.body instanceof Uint8Array ? object.body : new Uint8Array(await new Response(object.body).arrayBuffer());
}

async function consentingRefs(db, except = new Set()) {
  const refs = new Map();
  for (const ref of await rows(db, `SELECT r.member,r.embedding FROM face_refs r JOIN face_prefs f ON f.member=r.member AND f.recognise=1`)) {
    if (except.has(ref.member)) continue;
    if (!refs.has(ref.member)) refs.set(ref.member, []);
    refs.get(ref.member).push(toVector(ref.embedding));
  }
  return refs;
}

// A match may be written only if: no manual tag for that person on that photo, no "Not me", the person still says
// yes, and the face is not already someone else's. Parameters: ?1 post, ?2 media, ?3 member as text, ?4 member, ?5 face.
const ALLOWED = `NOT EXISTS(SELECT 1 FROM photo_tags WHERE post=?1 AND media=?2 AND kind='person' AND target=?3 AND origin='manual')
  AND NOT EXISTS(SELECT 1 FROM face_matches WHERE media=?2 AND member=?4 AND state='removed')
  AND EXISTS(SELECT 1 FROM face_prefs WHERE member=?4 AND recognise=1)
  AND NOT EXISTS(SELECT 1 FROM face_matches WHERE media=?2 AND face=?5 AND member<>?4 AND state IN ('shadow','auto'))`;

// Write matches the same way for every path. notify 'post': one notification per member per memory now (new
// memories). notify 'later': no notification now; summarise() tells each member once (backlog, re-matching, publishing).
// Returns the matches that changed something: a new tag ('on') or a new shadow match ('shadow').
export async function writeMatches(env, matches, notify = 'later') {
  const db = env.DB, mode = faceMode(env), stamp = Date.now();
  if (mode === 'off' || !matches.length) return [];
  const written = [];
  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK), jobs = [], tagIndex = [];
    for (const m of chunk) {
      const args = [m.post, m.media, String(m.member), m.member, m.face ?? null];
      if (mode === 'shadow') {
        tagIndex.push(jobs.length);
        jobs.push(q(db, `INSERT INTO face_matches(media,member,post,face,score,state,created,notified)
          SELECT ?2,?4,?1,?5,?6,'shadow',?7,0 WHERE ${ALLOWED}
          ON CONFLICT(media,member) DO UPDATE SET face=excluded.face,score=excluded.score WHERE face_matches.state='shadow'`, ...args, m.score, stamp));
        continue;
      }
      const told = notify === 'post' ? 1 : 0;
      tagIndex.push(jobs.length);
      jobs.push(q(db, `INSERT OR IGNORE INTO photo_tags(post,media,kind,target,origin) SELECT ?1,?2,'person',?3,'auto' WHERE ${ALLOWED}`, ...args));
      jobs.push(q(db, `INSERT INTO face_matches(media,member,post,face,score,state,created,notified)
        SELECT ?2,?4,?1,?5,?6,'auto',?7,?8 WHERE ${ALLOWED}
        ON CONFLICT(media,member) DO UPDATE SET face=excluded.face,score=excluded.score,
          notified=CASE WHEN face_matches.state='shadow' THEN excluded.notified ELSE face_matches.notified END,state='auto'
        WHERE face_matches.state<>'removed'`, ...args, m.score, stamp, told));
      if (notify === 'post') jobs.push(q(db, `INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key)
        SELECT ?4,p.author,'mention',p.id,?6,'found:'||p.id FROM posts p WHERE p.id=?1 AND p.author<>?4
          AND EXISTS(SELECT 1 FROM photo_tags WHERE post=?1 AND media=?2 AND kind='person' AND target=?3 AND origin='auto')`,
        ...args, anchorFor(m.media)));
    }
    const results = await db.batch(jobs);
    chunk.forEach((m, k) => { if (changes(results[tagIndex[k]]) > 0) written.push(m); });
  }
  return written;
}

// One "We found you in N photos" per member for automatic tags they haven't been told about. Your own uploads are
// tagged but not counted. Runs hourly and straight after re-matching or publishing.
export async function summarise(env, member = null) {
  const db = env.DB;
  if (faceMode(env) !== 'on' || !await faceSchema(db)) return 0;
  const who = member === null ? '' : ' AND m.member=?';
  const extra = member === null ? [] : [member];
  const pending = await rows(db, `SELECT m.member,count(*) AS n FROM face_matches m JOIN posts p ON p.id=m.post
    WHERE m.state='auto' AND m.notified=0 AND p.author<>m.member${who} GROUP BY m.member`, ...extra);
  const stamp = Date.now();
  for (const {member: person, n} of pending) {
    const newest = await first(db, `SELECT m.post,m.media FROM face_matches m JOIN posts p ON p.id=m.post
      WHERE m.member=? AND m.state='auto' AND m.notified=0 AND p.author<>m.member ORDER BY p.created DESC,m.media LIMIT 1`, person);
    await db.batch([
      q(db, `INSERT OR IGNORE INTO notifications(recipient,actor,kind,post,anchor,event_key) VALUES(?,NULL,'mention',?,?,?)`,
        person, newest.post, anchorFor(newest.media), `found-all:${n}:${stamp}`),
      q(db, `UPDATE face_matches SET notified=1 WHERE member=? AND state='auto' AND notified=0`, person),
    ]);
  }
  await q(db, `UPDATE face_matches SET notified=1 WHERE state='auto' AND notified=0${member === null ? '' : ' AND member=?'}`, ...extra).run();
  return pending.length;
}

export async function scanPhoto(env, post, media, notify = 'later') {
  const db = env.DB;
  if (faceMode(env) === 'off') return {faces: 0, tagged: []};
  const key = await mediaObject(db, media);
  const bytes = key && await photoBytes(env, key);
  if (!bytes) return {faces: 0, tagged: []};
  const result = await analyseImage(env, bytes, 'photo', media);
  const stamp = Date.now();
  await db.batch([
    q(db, 'DELETE FROM faces WHERE media=?', media),
    ...result.faces.map(f => q(db, 'INSERT INTO faces(media,post,box,score,size,embedding,model) VALUES(?,?,?,?,?,?,?)',
      media, post, JSON.stringify(f.box), f.score, f.size, f.bytes, result.model)),
    q(db, `INSERT INTO face_scans(media,post,status,faces,width,height,model,scanned) VALUES(?,?,'done',?,?,?,?,?)
      ON CONFLICT(media) DO UPDATE SET status='done',faces=excluded.faces,width=excluded.width,height=excluded.height,
      model=excluded.model,scanned=excluded.scanned`, media, post, result.faces.length, result.width ?? null, result.height ?? null, result.model, stamp),
  ]);
  const ids = (await rows(db, 'SELECT id FROM faces WHERE media=? ORDER BY id', media)).map(r => r.id);
  // People who said "Not me" or were tagged by hand here are left out before assigning, so the face can go to someone else.
  const skip = new Set((await rows(db, `SELECT member FROM face_matches WHERE media=? AND state='removed'
    UNION SELECT CAST(target AS INTEGER) FROM photo_tags WHERE media=? AND kind='person' AND origin='manual'`, media, media)).map(r => r.member));
  const pairs = assign(result.faces.map((f, i) => ({id: ids[i], vector: f.vector})), await consentingRefs(db, skip));
  const kept = pairs.map(p => p.member);
  const others = kept.length ? ` AND member NOT IN (${kept.map(() => '?').join(',')})` : '';
  const stale = (await rows(db, `SELECT member FROM face_matches WHERE media=? AND state IN ('auto','shadow')${others}`, media, ...kept)).map(r => r.member);
  if (stale.length) await db.batch(stale.flatMap(member => [
    q(db, `DELETE FROM photo_tags WHERE media=? AND kind='person' AND target=? AND origin='auto'`, media, String(member)),
    q(db, `DELETE FROM face_matches WHERE media=? AND member=? AND state IN ('auto','shadow')`, media, member),
  ]));
  const written = await writeMatches(env, pairs.map(p => ({media, post, member: p.member, face: p.face, score: p.score})), notify);
  return {faces: result.faces.length, tagged: written.map(w => w.member)};
}

export async function handleQueue(batch, env) {
  for (const msg of batch.messages) {
    const job = msg.body || {};
    try {
      if (job.type === 'media') await scanPhoto(env, job.post, job.media, job.notify === 'post' ? 'post' : 'later');
      else if (job.type === 'ref' && faceMode(env) !== 'off') { await refreshRefs(env, job.member); await rematchMember(env, job.member); }
      msg.ack();
    } catch (error) {
      console.error('face job', job.type, error?.message);
      if (job.type === 'media' && error?.status === 400) {
        // The service cannot read this image: retrying will not help, and the sweep leaves skipped photos alone.
        await q(env.DB, `INSERT INTO face_scans(media,post,status,faces,model,scanned) VALUES(?,?,'skipped',0,?,?)
          ON CONFLICT(media) DO UPDATE SET status='skipped',scanned=excluded.scanned`, job.media, job.post, FACE_MODEL, Date.now()).run().catch(() => {});
        msg.ack();
      } else if (msg.attempts >= 5) {
        // Give up for now; the hourly sweep picks up failed photos and members still without references.
        if (job.type === 'media') await q(env.DB, `INSERT INTO face_scans(media,post,status,faces,model,scanned) VALUES(?,?,'failed',0,?,?) ON CONFLICT(media) DO UPDATE SET status='failed',scanned=excluded.scanned`,
          job.media, job.post, FACE_MODEL, Date.now()).run().catch(() => {});
        msg.ack();
      } else msg.retry({delaySeconds: Math.min(300, 30 * (msg.attempts || 1))});
    }
  }
}

// Statements that forget a hidden memory's faces (Not me choices are kept). Empty before migration 0019.
export async function forgetPostFaces(db, post) {
  if (!await faceSchema(db)) return [];
  return [
    q(db, 'DELETE FROM faces WHERE post=?', post),
    q(db, 'DELETE FROM face_scans WHERE post=?', post),
    q(db, "DELETE FROM face_matches WHERE post=? AND state<>'removed'", post),
  ];
}

// The same for every memory in a topic that is being hidden.
export async function forgetTopicFaces(db, topic) {
  if (!await faceSchema(db)) return [];
  const inTopic = 'SELECT id FROM posts WHERE topic=?';
  return [
    q(db, `DELETE FROM faces WHERE post IN (${inTopic})`, topic),
    q(db, `DELETE FROM face_scans WHERE post IN (${inTopic})`, topic),
    q(db, `DELETE FROM face_matches WHERE post IN (${inTopic}) AND state<>'removed'`, topic),
  ];
}

// ---------- consent and reference faces ----------

export const FACE_COPY = 'We use your profile photos and your 2006 yearbook photo to find you in batch photos. You can turn this off any time.';
const safeNext = value => /^\/(?![\/\\])[^\r\n\\]*$/.test(String(value || '')) ? String(value) : '/';
const see = url => new Response(null, {status: 303, headers: {Location: url}});
const missingPage = () => new Response('Page unavailable', {status: 404});

// 'hidden' before the migration, or while off unless the member said yes (they must always be able to withdraw);
// 'ask' until the member has answered; then 'on' or 'off'.
export async function consentState(env, me) {
  if (!await faceSchema(env.DB)) return 'hidden';
  const row = await first(env.DB, 'SELECT recognise FROM face_prefs WHERE member=?', me);
  if (faceMode(env) === 'off') return row?.recognise ? 'on' : 'hidden';
  return !row ? 'ask' : row.recognise ? 'on' : 'off';
}

async function sendJob(env, body) {
  try { if (env.FACE_JOBS) await env.FACE_JOBS.send(body); } catch (error) { console.error('face queue', error?.message); }
}

// After a profile photo changes: rebuild that member's references, if they have said yes. Never throws.
export async function enqueueRefs(env, member) {
  try {
    if (faceMode(env) === 'off' || !await faceSchema(env.DB)) return;
    const row = await first(env.DB, 'SELECT recognise FROM face_prefs WHERE member=?', member);
    if (row?.recognise) await sendJob(env, {type: 'ref', member});
  } catch (error) { console.error('face refs', error?.message); }
}

async function refSources(db, member) {
  const sources = [];
  // The 2006 portrait comes first: it is the anchor for choosing the right face in family photos.
  const seed = await first(db, `SELECT portrait_key FROM profile_seeds WHERE roster_id=? AND review_status='approved'
    AND portrait_key IS NOT NULL AND portrait_key<>''`, member);
  const yearbook = seed || await first(db, `SELECT ph.object_key AS portrait_key FROM yearbook_public y,json_each(y.images) j
    JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission') AND ph.object_key=json_extract(j.value,'$.key')
    WHERE y.member=? ORDER BY j.key LIMIT 1`, member);
  if (yearbook?.portrait_key) sources.push(['yearbook', yearbook.portrait_key]);
  const own = Object.fromEntries((await rows(db, `SELECT field,value FROM profile_fields WHERE member=?
    AND field IN ('portraitObject','thenPhotoObject','nowPhotoObject') AND trim(value)<>''`, member)).map(r => [r.field, r.value]));
  for (const [field, source] of [['portraitObject', 'portrait'], ['thenPhotoObject', 'then'], ['nowPhotoObject', 'now']])
    if (own[field]) sources.push([source, own[field]]);
  return sources;
}

// Pick the member's face in a reference photo. The yearbook portrait: its largest face. Other photos may show family:
// a single face is taken; with several, only one that matches a reference already chosen, otherwise none.
function pickFace(source, faces, chosen) {
  if (!faces.length) return null;
  if (source === 'yearbook') return faces.reduce((a, b) => (b.size > a.size ? b : a));
  if (faces.length === 1) return faces[0];
  let best = null, bestScore = FACE_BAR;
  for (const face of faces) for (const ref of chosen) {
    const score = similarity(face.vector, ref);
    if (score >= bestScore) { best = face; bestScore = score; }
  }
  return best;
}

export async function refreshRefs(env, member) {
  const db = env.DB;
  if (!(await first(db, 'SELECT recognise FROM face_prefs WHERE member=?', member))?.recognise) return 0;
  const kept = [], unreadable = [], chosen = [];
  for (const [source, key] of await refSources(db, member)) {
    try {
      const bytes = await readObject(env, key);
      if (!bytes) continue;
      const face = pickFace(source, (await analyseImage(env, bytes, 'photo', 'ref-' + member)).faces, chosen);
      if (!face) continue;
      const saved = await q(db, `INSERT OR REPLACE INTO face_refs SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM face_prefs WHERE member=? AND recognise=1)`,
        member, source, key, face.bytes, FACE_MODEL, member).run();
      if (changes(saved) > 0) { kept.push(source); chosen.push(face.vector); }
    } catch (error) {
      console.error('face ref', source, error?.message);
      unreadable.push(source);   // keep an earlier reference for this source rather than lose it
    }
  }
  const keep = [...kept, ...unreadable];
  await q(db, `DELETE FROM face_refs WHERE member=? AND source NOT IN (${keep.map(() => '?').join(',') || "''"})`, member, ...keep).run();
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
  const written = await writeMatches(env, [...best.values()], 'later');
  await summarise(env, member);
  return written.length;
}

// Every photo the member is tagged in, newest memory first.
export const photosOfYou = (db, me) => rows(db, `SELECT pt.post,pt.media,pt.origin FROM photo_tags pt JOIN posts p ON p.id=pt.post
  WHERE pt.kind='person' AND pt.target=? AND ${POST_VISIBLE} ORDER BY p.created DESC,pt.media`, String(me));

async function notMe(req, env, me) {
  const form = await req.formData();
  const media = String(form.get('media') || '');
  const tag = await first(env.DB, `SELECT post FROM photo_tags WHERE media=? AND kind='person' AND target=? AND origin='auto'`, media, String(me));
  if (!tag) return missingPage();
  await env.DB.batch([
    q(env.DB, `DELETE FROM photo_tags WHERE media=? AND kind='person' AND target=? AND origin='auto'`, media, String(me)),
    q(env.DB, `INSERT INTO face_matches(media,member,post,face,score,state,created) VALUES(?,?,?,NULL,0,'removed',?)
      ON CONFLICT(media,member) DO UPDATE SET state='removed'`, media, me, tag.post, Date.now()),
    // "You're in a photo" no longer applies once none of that memory's automatic tags of you are left.
    q(env.DB, `DELETE FROM notifications WHERE recipient=? AND event_key='found:'||? AND NOT EXISTS(SELECT 1 FROM photo_tags
      WHERE post=? AND kind='person' AND target=? AND origin='auto')`, me, tag.post, tag.post, String(me)),
  ]);
  return see(form.get('next') ? safeNext(form.get('next')) : '/photos-of-you');
}

export async function faceRoute({req, env, me, path, post}) {
  if (!post || !['/faces/not-me', '/faces/consent'].includes(path)) return null;
  if (!await faceSchema(env.DB)) return missingPage();
  if (path === '/faces/not-me') return notMe(req, env, me);
  const form = await req.formData();
  const choice = String(form.get('choice') || '');
  if (!['yes', 'no'].includes(choice)) return new Response('Choose yes or no.', {status: 400});
  if (choice === 'yes' && faceMode(env) === 'off') return missingPage();   // withdrawing always works
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
      q(db, "DELETE FROM face_matches WHERE member=? AND state<>'removed'", me),
      q(db, "DELETE FROM notifications WHERE recipient=? AND (event_key LIKE 'found:%' OR event_key LIKE 'found-all:%')", me)]);
  }
  return see(safeNext(form.get('next')));
}

// ---------- hourly sweep and the admin page ----------

// Every photo shown in a visible memory, with the media id the site uses for it.
const SHOWN_PHOTOS = `SELECT 'post/'||a.id AS media,p.id AS post FROM uploads a JOIN posts p ON p.id=a.post WHERE ${POST_VISIBLE}
    UNION ALL
    SELECT 'legacy/'||p.id||'/'||ROW_NUMBER() OVER(PARTITION BY p.id ORDER BY ph.object_key) AS media,p.id AS post
      FROM posts p JOIN photos ph ON ph.submission=p.origin WHERE ${POST_VISIBLE}`;
const UNSCANNED = `SELECT media,post FROM (${SHOWN_PHOTOS}) shown
  WHERE NOT EXISTS(SELECT 1 FROM face_scans s WHERE s.media=shown.media AND s.status IN ('done','skipped'))`;

// Queue photos never scanned (or whose scan failed), and members who said yes but have no references yet
// (their job may have failed while the container was starting). Runs hourly; also the backlog run.
export async function sweep(env, limit = 200) {
  if (faceMode(env) === 'off' || !env.FACE_JOBS || !await faceSchema(env.DB)) return 0;
  const todo = await rows(env.DB, UNSCANNED + ' LIMIT ?', limit);
  const people = await rows(env.DB, `SELECT member FROM face_prefs f WHERE recognise=1
    AND NOT EXISTS(SELECT 1 FROM face_refs r WHERE r.member=f.member) ORDER BY decided LIMIT 50`);
  const jobs = [...todo.map(t => ({body: {type: 'media', post: t.post, media: t.media}})),
    ...people.map(p => ({body: {type: 'ref', member: p.member}}))];
  for (let i = 0; i < jobs.length; i += 100) await env.FACE_JOBS.sendBatch(jobs.slice(i, i + 100));
  return todo.length;
}

export async function faceCron(env) {
  await summarise(env);
  await sweep(env);
}

export async function faceAdminData(env) {
  const db = env.DB;
  if (!await faceSchema(db)) return {mode: faceMode(env), ready: false, counts: {}, shadow: []};
  const count = async (query, ...args) => (await first(db, query, ...args)).n;
  return {
    mode: faceMode(env), ready: true,
    counts: {
      photos: await count(`SELECT count(*) n FROM (${SHOWN_PHOTOS})`),
      scanned: await count(`SELECT count(*) n FROM face_scans WHERE status='done'`),
      failed: await count(`SELECT count(*) n FROM face_scans WHERE status='failed'`),
      faces: await count('SELECT count(*) n FROM faces'),
      consenting: await count('SELECT count(*) n FROM face_prefs WHERE recognise=1'),
      shadow: await count(`SELECT count(*) n FROM face_matches WHERE state='shadow'`),
      auto: await count(`SELECT count(*) n FROM face_matches WHERE state='auto'`),
      removed: await count(`SELECT count(*) n FROM face_matches WHERE state='removed'`),
    },
    // Lowest scores first: those are the ones worth checking by eye.
    shadow: await rows(db, `SELECT m.media,m.post,m.score,r.name FROM face_matches m JOIN roster r ON r.id=m.member
      WHERE m.state='shadow' ORDER BY m.score LIMIT 200`),
  };
}

// Turn shadow matches into real tags, then tell each member once.
export async function publishShadow(env) {
  if (faceMode(env) !== 'on' || !await faceSchema(env.DB)) return null;
  const shadow = await rows(env.DB, `SELECT media,post,member,face,score FROM face_matches WHERE state='shadow' AND score>=? ORDER BY member`, FACE_BAR);
  const written = await writeMatches(env, shadow, 'later');
  await summarise(env);
  return written.length;
}
