// Automatic face tagging: matching, the face-service client, queue jobs, eligibility and admin.
// Design: docs/superpowers/specs/2026-11-25-face-tagging-design.md, changed by 2026-11-26-face-tagging-batch-design.md

export const FACE_BAR = 0.35;
export const FACE_MODEL = 'buffalo_l/w600k_r50';

export const faceMode = env => ['off','shadow','on'].includes(env?.FACE_TAGGING) ? env.FACE_TAGGING : 'off';

// Members without a profile picture of their own (the "2006 group") are matched only through 2006 references
// (a hand-tagged single-face photo such as the Placecom album, the iimages yearbook PDF, the seed portrait). Their own
// switch, FACE_TAGGING_2006 (off | shadow | on, unset = off), can never go further than FACE_TAGGING, and stays off
// until migration 0021 has run.
const LEVEL = {off: 0, shadow: 1, on: 2};
export const faceMode2006 = env => {
  const own = ['off','shadow','on'].includes(env?.FACE_TAGGING_2006) ? env.FACE_TAGGING_2006 : 'off';
  return LEVEL[own] < LEVEL[faceMode(env)] ? own : faceMode(env);
};

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

// Memory is billed while the container runs, so it stops after one idle minute (the next photo waits for a cold start).
const IDLE_MS = 60 * 1000;
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

// Who can be matched. Members who uploaded their own profile picture always; with FACE_TAGGING_2006 shadow or on,
// everyone on the roster (whether they can actually be found depends on having a usable reference face).
// Nobody is asked; Not me is the only control.
export const OWN_PICTURE = member => `EXISTS(SELECT 1 FROM profile_fields pf WHERE pf.member=${member} AND pf.field='portraitObject' AND trim(pf.value)<>'')`;
export const ELIGIBLE = (member, wide = false) => wide ? `EXISTS(SELECT 1 FROM roster er WHERE er.id=${member})` : OWN_PICTURE(member);

// Migration 0021 (tagged and archive references, notes) may not have run yet; until it has, the 2006 group stays off.
const refs2006Ready = new WeakSet();
async function refs2006Schema(db) {
  if (refs2006Ready.has(db)) return true;
  try { await db.prepare('SELECT member FROM face_archive LIMIT 0').bind().all(); } catch { return false; }
  refs2006Ready.add(db);
  return true;
}
// Is the 2006 group being matched right now (shadow or on)?
export const wide2006 = async env => faceMode2006(env) !== 'off' && await refs2006Schema(env.DB);

// Migration 0019 may not have run yet (it must follow the deploy). Until it has, face tagging stays hidden and
// nothing touches its tables or columns. Only a positive answer is cached, per database binding.
const schemaReady = new WeakSet();
export async function faceSchema(db) {
  if (schemaReady.has(db)) return true;
  try {
    await db.prepare('SELECT origin FROM photo_tags LIMIT 0').bind().all();
    await db.prepare('SELECT notified FROM active_face_matches LIMIT 0').bind().all();
  } catch { return false; }
  schemaReady.add(db);
  return true;
}

// R2 key of a photo shown in a visible memory, or null.
export async function mediaObject(db, media) {
  const [kind, a, b] = String(media).split('/');
  let row = null;
  if (kind === 'post' && a) row = await first(db, `SELECT a.object_key FROM active_uploads a JOIN posts p ON p.id=a.post WHERE a.id=? AND ${POST_VISIBLE}`, a);
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

async function eligibleRefs(env, except = new Set()) {
  const refs = new Map();
  for (const ref of await rows(env.DB, `SELECT r.member,r.embedding FROM face_refs r WHERE ${ELIGIBLE('r.member', await wide2006(env))}`)) {
    if (except.has(ref.member)) continue;
    if (!refs.has(ref.member)) refs.set(ref.member, []);
    refs.get(ref.member).push(toVector(ref.embedding));
  }
  return refs;
}

// A match may be written only if: no manual tag for that person on that photo, no "Not me", the person is still
// eligible, and the face is not already someone else's. Parameters: ?1 post, ?2 media, ?3 member as text, ?4 member, ?5 face.
const allowed = wide => `NOT EXISTS(SELECT 1 FROM removed_album_photos WHERE ?2='post/'||photo) AND NOT EXISTS(SELECT 1 FROM photo_tags WHERE post=?1 AND media=?2 AND kind='person' AND target=?3 AND origin='manual')
  AND NOT EXISTS(SELECT 1 FROM active_face_matches WHERE media=?2 AND member=?4 AND state='removed')
  AND ${ELIGIBLE('?4', wide)}
  AND NOT EXISTS(SELECT 1 FROM active_face_matches WHERE media=?2 AND face=?5 AND member<>?4 AND state IN ('shadow','auto'))`;

// Members (of those given) with a profile picture of their own.
async function withOwnPicture(db, members) {
  const list = [...new Set(members)];
  if (!list.length) return new Set();
  return new Set((await rows(db, `SELECT DISTINCT pf.member FROM profile_fields pf, json_each(?) j
    WHERE pf.member=j.value AND pf.field='portraitObject' AND trim(pf.value)<>''`, JSON.stringify(list))).map(r => r.member));
}

// Write matches the same way for every path. notify 'post': one notification per member per memory now (new
// memories). notify 'later': no notification now; summarise() tells each member once (backlog, re-matching, publishing).
// Returns the matches that changed something: a new tag ('on') or a new shadow match ('shadow').
export async function writeMatches(env, matches, notify = 'later') {
  const db = env.DB, stamp = Date.now();
  if (faceMode(env) === 'off' || !matches.length) return [];
  const wide = await wide2006(env), ALLOWED = allowed(wide);
  const written = [];
  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK), jobs = [], tagIndex = [];
    const own = wide ? await withOwnPicture(db, chunk.map(m => m.member)) : null;
    for (const m of chunk) {
      const args = [m.post, m.media, String(m.member), m.member, m.face ?? null];
      // The 2006 group follows its own switch: shadow there means shadow even while FACE_TAGGING is on.
      const mode = own && !own.has(m.member) ? faceMode2006(env) : faceMode(env);
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
// tagged but not counted. Runs at the end of each batch and after publishing.
export async function summarise(env, member = null) {
  const db = env.DB;
  if (faceMode(env) !== 'on' || !await faceSchema(db)) return 0;
  const who = member === null ? '' : ' AND m.member=?';
  const extra = member === null ? [] : [member];
  const pending = await rows(db, `SELECT m.member,count(*) AS n FROM active_face_matches m JOIN posts p ON p.id=m.post
    WHERE m.state='auto' AND m.notified=0 AND p.author<>m.member${who} GROUP BY m.member`, ...extra);
  const stamp = Date.now();
  for (const {member: person, n} of pending) {
    const newest = await first(db, `SELECT m.post,m.media FROM active_face_matches m JOIN posts p ON p.id=m.post
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
  const ids = (await rows(db, 'SELECT id FROM active_faces WHERE media=? ORDER BY id', media)).map(r => r.id);
  // A photo with one face and one person tagged by hand can be that person's reference (the next batch rebuilds it).
  if (result.faces.length === 1 && await wide2006(env)) {
    const tagged = await rows(db, `SELECT CAST(target AS INTEGER) AS member,origin FROM active_photo_tags WHERE media=? AND kind='person'`, media);
    if (tagged.length === 1 && tagged[0].origin === 'manual') await markRefs(env, tagged[0].member);
  }
  // People who said "Not me" or were tagged by hand here are left out before assigning, so the face can go to someone else.
  const skip = new Set((await rows(db, `SELECT member FROM active_face_matches WHERE media=? AND state='removed'
    UNION SELECT CAST(target AS INTEGER) FROM photo_tags WHERE media=? AND kind='person' AND origin='manual'`, media, media)).map(r => r.member));
  const pairs = assign(result.faces.map((f, i) => ({id: ids[i], vector: f.vector})), await eligibleRefs(env, skip));
  const kept = pairs.map(p => p.member);
  const others = kept.length ? ` AND member NOT IN (${kept.map(() => '?').join(',')})` : '';
  const stale = (await rows(db, `SELECT member FROM active_face_matches WHERE media=? AND state IN ('auto','shadow')${others}`, media, ...kept)).map(r => r.member);
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
      // Notifications wait for the run's finish job: one summary per person per run.
      if (job.type === 'media') await scanPhoto(env, job.post, job.media);
      else if (job.type === 'ref' && faceMode(env) !== 'off') await refreshRefs(env, job.member);
      else if (job.type === 'finish') await finishRun(env);
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
        if (job.type === 'media') await q(env.DB, `INSERT INTO face_scans(media,post,status,faces,model,scanned,tries) VALUES(?,?,'failed',0,?,?,1)
          ON CONFLICT(media) DO UPDATE SET status='failed',scanned=excluded.scanned,tries=face_scans.tries+1`,
          job.media, job.post, FACE_MODEL, Date.now()).run().catch(() => {});
        if (job.type === 'ref') await q(env.DB, `INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(?1,1,?2,1,?2)
          ON CONFLICT(member) DO UPDATE SET ref_tries=face_prefs.ref_tries+1,ref_tried=?2`, job.member, Date.now()).run().catch(() => {});
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

// ---------- reference faces ----------

const safeNext = value => /^\/(?![\/\\])[^\r\n\\]*$/.test(String(value || '')) ? String(value) : '/';
const see = url => new Response(null, {status: 303, headers: {Location: url}});
const missingPage = () => new Response('Page unavailable', {status: 404});
const eligible = async (env, member) => !!await first(env.DB, `SELECT 1 AS ok WHERE ${ELIGIBLE('?', await wide2006(env))}`, member);

// Home nudges members who cannot be matched yet (no profile picture, and the 2006 group is off), while face tagging runs.
export async function faceNudge(env, me) {
  if (faceMode(env) === 'off' || !await faceSchema(env.DB)) return false;
  return !await eligible(env, me);
}

// After a profile photo changes, or the member is tagged by hand: mark their references for a rebuild by the next
// batch. Never throws.
export async function markRefs(env, member) {
  try {
    if (!await faceSchema(env.DB)) return;
    await q(env.DB, `INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(?,1,?,0,NULL)
      ON CONFLICT(member) DO UPDATE SET ref_tries=0,ref_tried=NULL`, member, Date.now()).run();
  } catch (error) { console.error('face refs', error?.message); }
}

// Reference photos to analyse, anchor first: the approved seed portrait (or the imported yearbook portrait), then the
// member's own photos.
async function refSources(db, member) {
  const sources = [];
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

export const TAGGED_MIN_SIZE = 80;   // px; smaller faces make poor references

// References that need no analysis (migration 0021): the member's largest face on a photo tagged by hand where the
// photo has exactly one face and exactly one person tag, and their face from the iimages 2006 yearbook PDF.
async function storedRefs(db, member) {
  const found = [];
  const tagged = await first(db, `SELECT f.media AS object_key,f.embedding FROM active_photo_tags t
    JOIN active_faces f ON f.media=t.media JOIN posts p ON p.id=t.post
    WHERE t.kind='person' AND t.origin='manual' AND t.target=? AND f.size>=? AND ${POST_VISIBLE}
      AND (SELECT count(*) FROM active_photo_tags o WHERE o.media=t.media AND o.kind='person')=1
      AND (SELECT count(*) FROM active_faces o WHERE o.media=t.media)=1
    ORDER BY f.size DESC,f.media LIMIT 1`, String(member), TAGGED_MIN_SIZE);
  if (tagged) found.push({source: 'tagged', key: tagged.object_key, bytes: tagged.embedding});
  const archive = await first(db, 'SELECT object_key,embedding FROM face_archive WHERE member=? AND model=?', member, FACE_MODEL);
  if (archive) found.push({source: 'archive', key: archive.object_key, bytes: archive.embedding});
  return found.map(r => {
    const vector = toVector(r.bytes);
    return {...r, vector, bytes: vectorBytes(vector)};
  });
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

// Consistency check. A reference must look like at least one of the member's other references (AGREE or more); the
// ones that do not (a seed portrait of someone else, a logo, a face hidden by hair, a poor scan) are left out and
// noted for the admin. If no two references agree, only the most trusted one is kept.
export const AGREE = 0.30;
const TRUST = ['portrait', 'tagged', 'yearbook', 'then', 'now', 'archive'];
export function consistent(refs) {
  if (refs.length < 2) return {kept: refs, dropped: []};
  const best = refs.map((a, i) => Math.max(...refs.map((b, j) => (i === j ? -1 : similarity(a.vector, b.vector)))));
  const core = refs.filter((_, i) => best[i] >= AGREE);
  const kept = core.length ? core : [refs.reduce((a, b) => (TRUST.indexOf(b.source) < TRUST.indexOf(a.source) ? b : a))];
  return {kept, dropped: refs.filter(r => !kept.includes(r)).map(r => ({...r, agreement: best[refs.indexOf(r)]}))};
}

export async function refreshRefs(env, member) {
  const db = env.DB;
  if (!await eligible(env, member)) return 0;
  const wide = await wide2006(env);
  const found = wide ? await storedRefs(db, member) : [], unreadable = [];
  const chosen = found.map(r => r.vector);
  for (const [source, key] of await refSources(db, member)) {
    try {
      const bytes = await readObject(env, key);
      if (!bytes) continue;
      const face = pickFace(source, (await analyseImage(env, bytes, 'photo', 'ref-' + member)).faces, chosen);
      if (!face) continue;
      found.push({source, key, bytes: face.bytes, vector: face.vector});
      chosen.push(face.vector);
    } catch (error) {
      console.error('face ref', source, error?.message);
      unreadable.push(source);   // keep an earlier reference for this source rather than lose it
    }
  }
  const {kept, dropped} = consistent(found);
  const ELIG = ELIGIBLE('?6', wide), stamp = Date.now();
  const saved = [];
  for (const ref of kept) {
    const result = await q(db, `INSERT OR REPLACE INTO face_refs SELECT ?1,?2,?3,?4,?5 WHERE ${ELIG}`,
      member, ref.source, ref.key, ref.bytes, FACE_MODEL, member).run();
    if (changes(result) > 0) saved.push(ref.source);
  }
  const keep = [...saved, ...unreadable];
  await q(db, `DELETE FROM face_refs WHERE member=? AND source NOT IN (${keep.map(() => '?').join(',') || "''"})`, member, ...keep).run();
  if (wide) await db.batch([
    q(db, 'DELETE FROM face_ref_notes WHERE member=?', member),
    ...dropped.map(r => q(db, 'INSERT OR REPLACE INTO face_ref_notes VALUES(?,?,?,?,?)', member, r.source, r.key, r.agreement, stamp)),
  ]);
  // No usable photo counts as a try: the batch retries once a day, three times at most, until a profile photo changes.
  await q(db, `INSERT INTO face_prefs(member,recognise,decided,ref_tries,ref_tried) VALUES(?1,1,?2,?3,?2)
    ON CONFLICT(member) DO UPDATE SET ref_tries=${saved.length ? '0' : 'face_prefs.ref_tries+1'},ref_tried=?2`,
    member, Date.now(), saved.length ? 0 : 1).run();
  return saved.length;
}

// Match members against every face already stored (photos shared before their references were built), reading the
// stored faces once for all of them. Each member's best face per photo is offered; writeMatches applies the rules.
export async function rematchMembers(env, members) {
  const db = env.DB, refs = new Map();
  for (const member of members) {
    if (!await eligible(env, member)) continue;
    const vectors = (await rows(db, 'SELECT embedding FROM face_refs WHERE member=?', member)).map(r => toVector(r.embedding));
    if (vectors.length) refs.set(member, vectors);
  }
  if (!refs.size) return 0;
  const best = new Map();   // member/media -> match
  for (let after = 0; ;) {
    const page = await rows(db, 'SELECT id,media,post,embedding FROM active_faces WHERE id>? ORDER BY id LIMIT 500', after);
    if (!page.length) break;
    for (const face of page) {
      const vector = toVector(face.embedding);
      for (const [member, vectors] of refs) {
        let score = -1;
        for (const ref of vectors) score = Math.max(score, similarity(vector, ref));
        const key = member + '/' + face.media;
        if (score >= FACE_BAR && !(best.get(key)?.score >= score)) best.set(key, {media: face.media, post: face.post, member, face: face.id, score});
      }
    }
    after = page[page.length - 1].id;
  }
  return (await writeMatches(env, [...best.values()], 'later')).length;
}

export const rematchMember = (env, member) => rematchMembers(env, [member]);

// Every photo the member is tagged in, newest memory first.
export const photosOfYou = (db, me) => rows(db, `SELECT pt.post,pt.media,pt.origin FROM active_photo_tags pt JOIN posts p ON p.id=pt.post
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

// A gallery correction is scoped to the signed-in member; other tags and uploads stay intact.
async function removeGalleryTags(req, env, me) {
  const form=await req.formData();
  const media=[...new Set(form.getAll('media').map(String))];
  if(!media.length||media.length>300||media.some(key=>key.length>200))return new Response('Select between 1 and 300 photos.',{status:400});
  let removed=0;
  for(let i=0;i<media.length;i+=30){
    const chunk=media.slice(i,i+30);
    const tags=await rows(env.DB,`SELECT pt.media,pt.post FROM active_photo_tags pt JOIN posts p ON p.id=pt.post
      WHERE pt.kind='person' AND pt.target=? AND pt.media IN (${chunk.map(()=>'?').join(',')}) AND ${POST_VISIBLE}`,String(me),...chunk);
    if(!tags.length)continue;
    await env.DB.batch(tags.flatMap(tag=>[
      q(env.DB,`DELETE FROM photo_tags WHERE media=? AND kind='person' AND target=?`,tag.media,String(me)),
      q(env.DB,`INSERT INTO face_matches(media,member,post,face,score,state,created) VALUES(?,?,?,NULL,0,'removed',?)
        ON CONFLICT(media,member) DO UPDATE SET state='removed'`,tag.media,me,tag.post,Date.now()),
      q(env.DB,`DELETE FROM notifications WHERE recipient=? AND event_key='found:'||? AND NOT EXISTS(SELECT 1 FROM photo_tags
        WHERE post=? AND kind='person' AND target=? AND origin='auto')`,me,tag.post,tag.post,String(me))
    ]));
    removed+=tags.length;
  }
  if(removed) await markRefs(env,me);   // one of those photos may have been my face reference
  return see('/photos-of-you?removed='+removed);
}

export async function faceRoute({req, env, me, path, post}) {
  if (!post || !['/faces/not-me','/faces/gallery-remove'].includes(path)) return null;
  if (!await faceSchema(env.DB)) return missingPage();
  return path==='/faces/gallery-remove'?removeGalleryTags(req,env,me):notMe(req,env,me);
}

// ---------- the 3-hour batch and the admin page ----------

// Every photo shown in a visible memory, with the media id the site uses for it.
const SHOWN_PHOTOS = `SELECT 'post/'||a.id AS media,p.id AS post FROM active_uploads a JOIN posts p ON p.id=a.post WHERE ${POST_VISIBLE}
    UNION ALL
    SELECT 'legacy/'||p.id||'/'||ROW_NUMBER() OVER(PARTITION BY p.id ORDER BY ph.object_key) AS media,p.id AS post
      FROM posts p JOIN photos ph ON ph.submission=p.origin WHERE ${POST_VISIBLE}`;
// Never scanned, or failed more than a day ago and fewer than three times (?1 = a day ago).
const UNSCANNED = `SELECT media,post FROM (${SHOWN_PHOTOS}) shown
  WHERE NOT EXISTS(SELECT 1 FROM face_scans s WHERE s.media=shown.media
    AND (s.status IN ('done','skipped') OR (s.status='failed' AND (s.tries>=3 OR s.scanned>?1))))`;
const DAY_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const FINISH_DELAY_S = 40 * 60;      // the run's photo and reference jobs are done well within this
const REMATCH_WINDOW_MS = 6 * HOUR_MS;   // two runs: a rebuild finished after one run's finish is caught by the next

// Members to (re)build references for: eligible and new, marked after a profile photo changed or a hand tag, or
// without usable references and last tried over a day ago (three tries at most until a photo changes). ?1 = a day ago.
const needsRefs = wide => `SELECT e.id AS member FROM roster e LEFT JOIN face_prefs f ON f.member=e.id
  WHERE ${ELIGIBLE('e.id', wide)} AND (f.member IS NULL OR (f.ref_tries<3 AND (f.ref_tried IS NULL
    OR (f.ref_tried<?1 AND NOT EXISTS(SELECT 1 FROM face_refs r WHERE r.member=e.id)))))
  ORDER BY e.id LIMIT ?2`;

// Anyone no longer eligible (no profile picture, and the 2006 group switched off) loses their references and automatic
// tags (Not me and manual tags stay).
async function dropIneligible(env) {
  const db = env.DB;
  const gone = await rows(db, `SELECT member FROM (SELECT member FROM face_refs UNION SELECT member FROM active_face_matches
    WHERE state<>'removed') x WHERE NOT ${ELIGIBLE('x.member', await wide2006(env))} LIMIT 100`);
  for (const {member} of gone) await db.batch([
    q(db, 'DELETE FROM face_refs WHERE member=?', member),
    q(db, "DELETE FROM photo_tags WHERE kind='person' AND target=? AND origin='auto'", String(member)),
    q(db, "DELETE FROM face_matches WHERE member=? AND state<>'removed'", member),
    q(db, "DELETE FROM notifications WHERE recipient=? AND (event_key LIKE 'found:%' OR event_key LIKE 'found-all:%')", member),
  ]);
  return gone.length;
}

// The batch, every 3 hours (and the admin's "Scan all photos now"): queue new or failed photos and reference
// rebuilds, then one finish job, delayed so the rest is done first. Returns the number of photos queued.
export async function sweep(env, limit = 500) {
  if (faceMode(env) === 'off' || !env.FACE_JOBS || !await faceSchema(env.DB)) return 0;
  await dropIneligible(env);
  const dayAgo = Date.now() - DAY_MS;
  const todo = await rows(env.DB, UNSCANNED + ' LIMIT ?2', dayAgo, limit);
  const people = await rows(env.DB, needsRefs(await wide2006(env)), dayAgo, 100);
  const jobs = [...todo.map(t => ({body: {type: 'media', post: t.post, media: t.media}})),
    ...people.map(p => ({body: {type: 'ref', member: p.member}}))];
  for (let i = 0; i < jobs.length; i += 100) await env.FACE_JOBS.sendBatch(jobs.slice(i, i + 100));
  await env.FACE_JOBS.send({type: 'finish'}, {delaySeconds: FINISH_DELAY_S});
  return todo.length;
}

// End of a run: match everyone whose references were rebuilt recently against every stored face (this also catches
// a photo scanned while their references were being built), then send each person one summary.
export async function finishRun(env) {
  const db = env.DB;
  if (faceMode(env) === 'off' || !await faceSchema(db)) return;
  const recent = await rows(db, `SELECT f.member FROM face_prefs f WHERE f.ref_tried>=? AND ${ELIGIBLE('f.member', await wide2006(env))}
    AND EXISTS(SELECT 1 FROM face_refs r WHERE r.member=f.member) ORDER BY f.member LIMIT 100`, Date.now() - REMATCH_WINDOW_MS);
  await rematchMembers(env, recent.map(r => r.member));
  await summarise(env);
}

export async function faceCron(env) {
  await summarise(env);   // anything left over from the previous run
  await sweep(env);
}

export async function faceAdminData(env) {
  const db = env.DB;
  if (!await faceSchema(db)) return {mode: faceMode(env), ready: false, counts: {}, shadow: [], notes: []};
  const count = async (query, ...args) => (await first(db, query, ...args)).n;
  const ready2006 = await refs2006Schema(db);
  return {
    mode: faceMode(env), mode2006: faceMode2006(env), ready: true, ready2006,
    counts: {
      photos: await count(`SELECT count(*) n FROM (${SHOWN_PHOTOS})`),
      scanned: await count(`SELECT count(*) n FROM face_scans WHERE status='done'`),
      failed: await count(`SELECT count(*) n FROM face_scans WHERE status='failed'`),
      faces: await count('SELECT count(*) n FROM active_faces'),
      eligible: await count(`SELECT count(*) n FROM members m WHERE ${OWN_PICTURE('m.id')}`),
      found2006: await count(`SELECT count(DISTINCT r.member) n FROM face_refs r WHERE NOT ${OWN_PICTURE('r.member')}`),
      archive: ready2006 ? await count('SELECT count(*) n FROM face_archive') : 0,
      shadow: await count(`SELECT count(*) n FROM active_face_matches WHERE state='shadow'`),
      auto: await count(`SELECT count(*) n FROM active_face_matches WHERE state='auto'`),
      removed: await count(`SELECT count(*) n FROM active_face_matches WHERE state='removed'`),
    },
    // Lowest scores first: those are the ones worth checking by eye.
    shadow: await rows(db, `SELECT m.media,m.post,m.score,r.name,NOT ${OWN_PICTURE('m.member')} AS via2006
      FROM active_face_matches m JOIN roster r ON r.id=m.member WHERE m.state='shadow' ORDER BY m.score LIMIT 200`),
    // Reference photos the consistency check left out, worst first.
    notes: ready2006 ? await rows(db, `SELECT n.member,n.source,n.object_key,n.agreement,r.name FROM face_ref_notes n
      JOIN roster r ON r.id=n.member ORDER BY n.agreement LIMIT 200`) : [],
  };
}

// Turn shadow matches into real tags, then tell each member once.
export async function publishShadow(env) {
  if (faceMode(env) !== 'on' || !await faceSchema(env.DB)) return null;
  // While the 2006 group is in shadow, only members with their own profile picture are published.
  const ownOnly = faceMode2006(env) !== 'on' ? ` AND ${OWN_PICTURE('s.member')}` : '';
  const shadow = await rows(env.DB, `SELECT media,post,member,face,score FROM active_face_matches s WHERE state='shadow' AND score>=?${ownOnly}
    ORDER BY member`, FACE_BAR);
  const written = await writeMatches(env, shadow, 'later');
  await summarise(env);
  return written.length;
}
